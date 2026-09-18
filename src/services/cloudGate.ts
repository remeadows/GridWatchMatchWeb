/** How long an idle gate waits before another reconcile attempt for the same user. */
export const RECONCILE_RETRY_THROTTLE_MS = 30_000;

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
   *  Non-nullable: the caller guards, so `flushBase` being null can only ever mean "do not flush". */
  noteUnsent(previous: S): void;
  /** True when an idle gate for a signed-in user may attempt a reconcile now. */
  shouldRetry(userId: string | null, now: number): boolean;
}

export function createCloudGate<S>(retryThrottleMs: number = RECONCILE_RETRY_THROTTLE_MS): CloudGate<S> {
  let currentUserId: string | null = null;
  let status: CloudGateStatus = "idle";
  let token = 0;
  let pendingBase: S | undefined;
  let hasPending = false;
  /** When the last run for `currentUserId` was started; null means "never attempted". */
  let lastAttemptAt: number | null = null;

  /** A retry for the SAME user is throttled; a different user is a different run and never is. */
  function throttled(userId: string, now: number): boolean {
    return currentUserId === userId && lastAttemptAt !== null && now - lastAttemptAt < retryThrottleMs;
  }

  function pend(previous: S): void {
    if (hasPending) return; // first unsent commit wins: later ones must not move the base forward
    pendingBase = previous;
    hasPending = true;
  }

  return {
    get status() {
      return status;
    },

    begin(userId, now) {
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
      status = "running";
      lastAttemptAt = now;
      token += 1;
      return token;
    },

    settle(settlingToken, startedWith, failed) {
      if (settlingToken !== token) {
        // Superseded: its results are still folded by the caller (invariant 1 is absolute), but it
        // must not flush or report status. Its snapshot becomes the base for whoever succeeds.
        pend(startedWith);
        return { flushBase: null };
      }
      if (failed) {
        // Stores stay held; the retry paths (online / visibilitychange / next commit) re-arm it.
        status = "idle";
        return { flushBase: null };
      }
      status = "done";
      lastAttemptAt = null;
      const flushBase = hasPending && pendingBase !== undefined ? pendingBase : startedWith;
      pendingBase = undefined;
      hasPending = false;
      return { flushBase };
    },

    canStore(userId) {
      return userId !== null && userId === currentUserId && status === "done";
    },

    noteUnsent(previous) {
      pend(previous);
    },

    shouldRetry(userId, now) {
      if (userId === null || status !== "idle") return false;
      return !throttled(userId, now);
    },
  };
}
