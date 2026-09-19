/** How long an idle gate waits before another reconcile attempt for the same user. */
export const RECONCILE_RETRY_THROTTLE_MS = 30_000;

/** Query parameter carrying the test-only throttle override, in milliseconds. */
export const RETRY_THROTTLE_PARAM = "gwCloudRetryThrottleMs";

/**
 * The throttle window `createCloudGate` should use for this page load.
 *
 * Test hook: 30 s of real waiting is the right production answer (an errored reconcile must not turn
 * `online` / `visibilitychange` into a request loop) but it makes the retry leg of an e2e scenario a
 * ~35 s sleep. Gated on the exact `?gwTestMode=1` query the rest of the app's test hooks use (see
 * `BoardScene.setBoardReadyFlag`). That is a RUNTIME query parameter, not a build-time flag, so it
 * is reachable on any build, production included — anyone can append it to a URL. Deliberate, and
 * consistent with the existing gwTestMode hooks: the impact is bounded to letting the gate
 * re-ATTEMPT a reconcile sooner, and a reconcile is still only ever armed by an online /
 * visibilitychange / commit event, i.e. at most one reconcile per event. It cannot bypass the gate,
 * unhold a store, or change what is sent. A missing, empty, non-numeric, negative or non-finite
 * value is the default too — this only ever narrows to a real number the caller asked for.
 *
 * Pure and string-in so it is directly testable, and so the caller keeps the `window` guard.
 */
export function cloudRetryThrottleMs(search: string | undefined): number {
  if (!search) return RECONCILE_RETRY_THROTTLE_MS;
  const params = new URLSearchParams(search);
  if (params.get("gwTestMode") !== "1") return RECONCILE_RETRY_THROTTLE_MS;
  const raw = params.get(RETRY_THROTTLE_PARAM);
  if (raw === null || raw.trim() === "") return RECONCILE_RETRY_THROTTLE_MS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return RECONCILE_RETRY_THROTTLE_MS;
  return value;
}

export type CloudGateStatus = "idle" | "running" | "done";

export interface CloudGateSettlement<S> {
  /** The snapshot the post-settle flush must diff against, or null when this run must not flush
   *  at all (it was superseded, or it errored). */
  flushBase: S | null;
}

/**
 * Ordering rules for cloud stores, kept out of React so they can be exercised directly.
 *
 * The single invariant it enforces: a cloud store may leave the app ONLY when a reconcile has
 * settled successfully for the CURRENT user id. Everything else — a gate that has not run yet, a
 * run in flight, a signed-out app, a run that errored — holds stores back and remembers the state
 * before the first commit it held, so the run that eventually succeeds can flush the whole batch
 * in one diff.
 *
 * Why it cannot be looser: the kit reads `baseRevision` at FLUSH time inside its per-slot
 * serialized chain. A store issued before or during a reconcile therefore waits behind that
 * reconcile and then flushes on the base the reconcile's own `confirmed()` just wrote — a 200 with
 * no 409 and no prompt, replacing the cloud row with a pre-reconcile projection.
 */
export interface CloudGate<S> {
  readonly status: CloudGateStatus;
  /** Sign-out (`userId` null) resets to idle and bumps the token, superseding any run in flight.
   *  Otherwise returns a token when a run should start for this user now, or null when one is
   *  already running or done for this user, or when an idle gate's retry is still throttled. */
  begin(userId: string | null, now: number): number | null;
  /** Record the outcome of run `token`. `flushBase` is non-null only when this token is still the
   *  current one AND the run did not fail; a superseded run hands its own `startedWith` over as
   *  the pending base instead. */
  settle(token: number, startedWith: S, failed: boolean): CloudGateSettlement<S>;
  /** True only when the gate is "done" for exactly this (non-null) user id. */
  canStore(userId: string | null): boolean;
  /** Called by `commitSave` for every commit that was NOT stored. First unsent commit wins.
   *  Non-nullable: the caller guards, so `flushBase` being null can only ever mean "do not flush".
   *  The base is remembered together with whose session it was noted under, and a run for a
   *  DIFFERENT account never inherits it — see `begin`. */
  noteUnsent(previous: S): void;
  /** True when an idle gate for a signed-in user may attempt a reconcile now. */
  shouldRetry(userId: string | null, now: number): boolean;
}

export function createCloudGate<S>(retryThrottleMs: number = RECONCILE_RETRY_THROTTLE_MS): CloudGate<S> {
  let currentUserId: string | null = null;
  /** The most recently signed-in user, NEVER cleared by a sign-out — the same idea as the kit's own
   *  `lastKnownUserId`. It is who a commit made while signed out is attributed to: such a commit is
   *  that player's held progress, so it must not become another account's flush base either. Null
   *  only before any session has ever been seen, which is the genuinely account-less window. */
  let lastKnownUserId: string | null = null;
  let status: CloudGateStatus = "idle";
  let token = 0;
  let pendingBase: S | undefined;
  let hasPending = false;
  /** Whose session the pending base was noted under, or null for one noted before any user was
   *  known (the pre-sign-in window). A null owner belongs to the device rather than to an account,
   *  so the first run to succeed may use it; a non-null one is usable only by that same user. */
  let baseUserId: string | null = null;
  /** The user each live run was begun for, so a run that settles late is attributed to ITS user and
   *  not to whoever is signed in by then. Deleted at settle, so it holds one entry per unsettled
   *  run — in practice one. */
  const runUsers = new Map<number, string>();
  /** When the last run for `currentUserId` was started; null means "never attempted". */
  let lastAttemptAt: number | null = null;

  /** A retry for the SAME user is throttled; a different user is a different run and never is. */
  function throttled(userId: string, now: number): boolean {
    return currentUserId === userId && lastAttemptAt !== null && now - lastAttemptAt < retryThrottleMs;
  }

  function pend(previous: S, owner: string | null): void {
    if (hasPending) return; // first unsent commit wins: later ones must not move the base forward
    pendingBase = previous;
    hasPending = true;
    baseUserId = owner;
  }

  function dropPending(): void {
    pendingBase = undefined;
    hasPending = false;
    baseUserId = null;
  }

  /** True when the pending base was noted under a DIFFERENT account than `userId`. A base noted with
   *  no user at all (null) is nobody's and never crosses anything. */
  function baseIsForeignTo(userId: string | null): boolean {
    return hasPending && baseUserId !== null && baseUserId !== userId;
  }

  return {
    get status() {
      return status;
    },

    begin(userId, now) {
      // A pending base noted under ANOTHER account is dropped here, because the base is what decides
      // WHICH SLOTS the run that succeeds diffs and sends. Keeping it meant account B's flush sent
      // every slot "changed since A's base", under B's session and on B's own confirmed revisions —
      // e.g. a defaults upload immediately after B answered "Start fresh". Nothing of A's is lost by
      // dropping it: A's commits are still marked by their persisted unsynced flags, which this
      // module never touches, so A's next reconcile offers them to the kit as a real local copy.
      //
      // A SIGN-OUT (userId null) is not a user change and does not drop anything: signing back in as
      // the same account must still flush the commits made in between, and while signed out there is
      // no other account for them to cross into. Nor is a base noted before any user was known
      // (`baseUserId` null) ever dropped — that commit belongs to the device, not to an account.
      if (baseIsForeignTo(userId) && userId !== null) dropPending();
      if (userId === null) {
        // Sign-out. Bumping the token supersedes any run in flight, so it can neither latch "done"
        // nor flush. Unsent commits stay pending — they are still unsent.
        currentUserId = null;
        status = "idle";
        token += 1;
        lastAttemptAt = null;
        return null;
      }
      if (currentUserId === userId && status !== "idle") return null; // running, or already done
      if (throttled(userId, now)) return null;
      currentUserId = userId;
      lastKnownUserId = userId;
      status = "running";
      lastAttemptAt = now;
      token += 1;
      runUsers.set(token, userId);
      return token;
    },

    settle(settlingToken, startedWith, failed) {
      const runUser = runUsers.get(settlingToken) ?? null;
      runUsers.delete(settlingToken);
      if (settlingToken !== token) {
        // Superseded: its results are still folded by the caller (invariant 1 is absolute), but it
        // must not flush or report status. Its snapshot becomes the base for whoever succeeds —
        // attributed to ITS OWN user, not to whoever is signed in by now, which is the whole point:
        // this pend happens AFTER the new user's `begin`, so the check there cannot catch it.
        pend(startedWith, runUser);
        return { flushBase: null };
      }
      if (failed) {
        // Stores stay held; the retry paths (online / visibilitychange / next commit) re-arm it.
        status = "idle";
        return { flushBase: null };
      }
      status = "done";
      lastAttemptAt = null;
      // The same ownership rule as `begin`, for the base a superseded run pended after this run had
      // already begun.
      if (baseIsForeignTo(currentUserId)) dropPending();
      const flushBase = hasPending && pendingBase !== undefined ? pendingBase : startedWith;
      dropPending();
      return { flushBase };
    },

    canStore(userId) {
      return userId !== null && userId === currentUserId && status === "done";
    },

    noteUnsent(previous) {
      pend(previous, lastKnownUserId);
    },

    shouldRetry(userId, now) {
      if (userId === null || status !== "idle") return false;
      return !throttled(userId, now);
    },
  };
}
