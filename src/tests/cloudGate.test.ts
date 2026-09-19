import { describe, expect, it } from "vitest";
import { cloudRetryThrottleMs, createCloudGate, RECONCILE_RETRY_THROTTLE_MS } from "../services/cloudGate";

// The gate is pure bookkeeping over opaque snapshots, so the tests use plain string states.
type S = string;
const USER = "user-1";
const OTHER = "user-2";
const T0 = 1_000_000;

describe("createCloudGate", () => {
  it("holds stores until a run has settled successfully for this user", () => {
    const gate = createCloudGate<S>();
    expect(gate.status).toBe("idle");
    expect(gate.canStore(USER)).toBe(false); // idle: nothing may leave the app

    const token = gate.begin(USER, T0);
    expect(token).not.toBeNull();
    expect(gate.status).toBe("running");
    expect(gate.canStore(USER)).toBe(false); // running: still nothing

    const { flushBase } = gate.settle(token!, "s0", false);
    expect(gate.status).toBe("done");
    expect(gate.canStore(USER)).toBe(true);
    expect(flushBase).toBe("s0"); // nothing was pended, so the run's own snapshot is the base
  });

  it("(c) flushes from the FIRST unsent commit, including one made before the run began", () => {
    const gate = createCloudGate<S>();
    // The pre-run window: `save` has loaded but auth is still resolving, so no run exists yet.
    gate.noteUnsent("p0");
    const token = gate.begin(USER, T0)!;
    gate.noteUnsent("p1"); // during the run — first unsent wins, this must not move the base
    gate.noteUnsent("p2");
    expect(gate.settle(token, "s0", false).flushBase).toBe("p0");
    // Cleared: a second settle cannot reuse a base that has already been flushed.
    expect(gate.settle(token, "s1", false).flushBase).toBe("s1");
  });

  it("a failed run flushes nothing, stays idle, and preserves the pending base for the retry", () => {
    const gate = createCloudGate<S>();
    gate.noteUnsent("p0");
    const first = gate.begin(USER, T0)!;
    expect(gate.settle(first, "s0", true)).toEqual({ flushBase: null });
    expect(gate.status).toBe("idle");
    expect(gate.canStore(USER)).toBe(false); // stores stay held after an errored reconcile

    const retry = gate.begin(USER, T0 + RECONCILE_RETRY_THROTTLE_MS)!;
    expect(retry).not.toBeNull();
    expect(gate.settle(retry, "s1", false).flushBase).toBe("p0"); // the preserved base, not s1
    expect(gate.canStore(USER)).toBe(true);
  });

  it("(f) a superseded run never flushes and never latches done, but hands over its base", () => {
    const gate = createCloudGate<S>();
    const t1 = gate.begin(USER, T0)!;
    expect(gate.begin(null, T0 + 1)).toBeNull(); // sign-out
    expect(gate.status).toBe("idle");
    const t2 = gate.begin(USER, T0 + 2)!; // signed back in as the SAME user while t1 is in flight
    expect(t2).not.toBe(t1);
    expect(gate.status).toBe("running");

    // t1 settles late: it folds (the caller's job) but must not flush or speak for t2.
    expect(gate.settle(t1, "sA", false)).toEqual({ flushBase: null });
    expect(gate.status).toBe("running");
    expect(gate.canStore(USER)).toBe(false);

    // t2 settles: the flush starts from the EARLIEST base, i.e. t1's snapshot.
    expect(gate.settle(t2, "sB", false).flushBase).toBe("sA");
    expect(gate.canStore(USER)).toBe(true);
  });

  it("is latched per user id, and sign-out clears it", () => {
    const gate = createCloudGate<S>();
    const token = gate.begin(USER, T0)!;
    gate.settle(token, "s0", false);
    expect(gate.canStore(USER)).toBe(true);
    expect(gate.canStore(OTHER)).toBe(false); // done for USER says nothing about OTHER
    expect(gate.canStore(null)).toBe(false);

    expect(gate.begin(null, T0 + 1)).toBeNull();
    expect(gate.status).toBe("idle");
    expect(gate.canStore(USER)).toBe(false); // same-user re-sign-in must reconcile again
    expect(gate.canStore(null)).toBe(false);
    expect(gate.begin(USER, T0 + 2)).not.toBeNull();
  });

  it("starts at most one run per user, and throttles retries of an idle gate", () => {
    const gate = createCloudGate<S>();
    const token = gate.begin(USER, T0)!;
    expect(gate.begin(USER, T0 + 1)).toBeNull(); // already running
    gate.settle(token, "s0", false);
    expect(gate.begin(USER, T0 + 2)).toBeNull(); // already done

    // A different user is a different run, never throttled.
    const otherToken = gate.begin(OTHER, T0 + 3)!;
    expect(otherToken).not.toBeNull();
    gate.settle(otherToken, "s1", true); // errored → idle, retryable

    expect(gate.shouldRetry(OTHER, T0 + 3)).toBe(false);
    expect(gate.begin(OTHER, T0 + 3)).toBeNull();
    expect(gate.shouldRetry(OTHER, T0 + 3 + RECONCILE_RETRY_THROTTLE_MS - 1)).toBe(false);
    expect(gate.begin(OTHER, T0 + 3 + RECONCILE_RETRY_THROTTLE_MS - 1)).toBeNull();
    expect(gate.shouldRetry(OTHER, T0 + 3 + RECONCILE_RETRY_THROTTLE_MS)).toBe(true);
    expect(gate.begin(OTHER, T0 + 3 + RECONCILE_RETRY_THROTTLE_MS)).not.toBeNull();
  });

  it("never retries while signed out, and never while a run is live", () => {
    const gate = createCloudGate<S>();
    expect(gate.shouldRetry(null, T0)).toBe(false); // signed out / auth still loading
    expect(gate.shouldRetry(USER, T0)).toBe(true);  // idle, never attempted → retry now
    const token = gate.begin(USER, T0)!;
    expect(gate.shouldRetry(USER, T0 + 1)).toBe(false); // running
    gate.settle(token, "s0", false);
    expect(gate.shouldRetry(USER, T0 + 2)).toBe(false); // done
  });

  it("(f) a run settling after a plain sign-out cannot latch done", () => {
    const gate = createCloudGate<S>();
    const token = gate.begin(USER, T0)!;
    gate.begin(null, T0 + 1); // signed out while the run is in flight
    expect(gate.settle(token, "sA", false)).toEqual({ flushBase: null });
    expect(gate.status).toBe("idle");
    expect(gate.canStore(USER)).toBe(false);
    // Its snapshot is still the base for whatever run eventually succeeds.
    const next = gate.begin(USER, T0 + 2)!;
    expect(gate.settle(next, "sB", false).flushBase).toBe("sA");
  });

  /**
   * The pending base decides WHICH SLOTS the run that succeeds diffs and sends. A base noted while
   * account A was signed in must never decide that for account B: B's flush would then send every
   * slot "changed since A's base" under B's session, on B's own confirmed revisions — e.g. a
   * defaults upload right after B answered "Start fresh". A's commits are not lost by dropping it:
   * their persisted unsynced flags are untouched, so A's next reconcile still offers them.
   */
  describe("the pending base never crosses a user change", () => {
    it("drops a base noted under one user when a different user begins", () => {
      const gate = createCloudGate<S>();
      gate.begin(USER, T0);      // A's run starts...
      gate.noteUnsent("a0");     // ...and a commit is held under A
      const b = gate.begin(OTHER, T0 + 1)!; // B signs in, superseding A's run
      // B flushes from its OWN snapshot, never from A's.
      expect(gate.settle(b, "b0", false).flushBase).toBe("b0");

      // And A's base is really gone, not merely unused for this one run.
      const b2 = gate.begin(OTHER, T0 + 2);
      expect(b2).toBeNull(); // already done for B
      expect(gate.begin(null, T0 + 3)).toBeNull();
      const b3 = gate.begin(OTHER, T0 + 4)!;
      expect(gate.settle(b3, "b1", false).flushBase).toBe("b1");
    });

    it("keeps the base across a sign-out and a sign-in as the SAME user", () => {
      const gate = createCloudGate<S>();
      gate.begin(USER, T0);
      gate.noteUnsent("a0");
      expect(gate.begin(null, T0 + 1)).toBeNull(); // sign-out is not a user change
      const again = gate.begin(USER, T0 + 2)!;
      expect(gate.settle(again, "s1", false).flushBase).toBe("a0");
    });

    it("keeps a base noted before any user was known", () => {
      // The pre-sign-in window: `save` has loaded, auth is still resolving, and the player commits.
      // That commit belongs to this device, not to an account, so the first run to succeed owns it.
      const gate = createCloudGate<S>();
      gate.noteUnsent("p0");
      const token = gate.begin(USER, T0)!;
      expect(gate.settle(token, "s0", false).flushBase).toBe("p0");
    });

    it("attributes a commit made while signed out to the account last signed in", () => {
      // Signed-out play after A: that is A's held progress, so it is A's to flush and must not
      // become B's base either. (A commit made before ANY session has been seen is different — see
      // the test above — because there is no account it could belong to.)
      const forA = createCloudGate<S>();
      forA.begin(USER, T0);
      expect(forA.begin(null, T0 + 1)).toBeNull();
      forA.noteUnsent("a0");
      const again = forA.begin(USER, T0 + 2)!;
      expect(forA.settle(again, "s1", false).flushBase).toBe("a0"); // A comes back: still flushed

      const forB = createCloudGate<S>();
      forB.begin(USER, T0);
      expect(forB.begin(null, T0 + 1)).toBeNull();
      forB.noteUnsent("a0");
      const b = forB.begin(OTHER, T0 + 2)!; // B signs in on the same device instead
      expect(forB.settle(b, "b0", false).flushBase).toBe("b0");
    });

    it("does not let a superseded run's snapshot become another user's flush base", () => {
      // The same crossing by the other route: the pend happens at SETTLE time, after the new user's
      // run has already begun, so the begin-time check above never sees it.
      const gate = createCloudGate<S>();
      const a = gate.begin(USER, T0)!;
      const b = gate.begin(OTHER, T0 + 1)!;
      expect(gate.settle(a, "aSnapshot", false)).toEqual({ flushBase: null }); // superseded
      expect(gate.settle(b, "b0", false).flushBase).toBe("b0");
    });

    it("discards a superseded run's snapshot that settles AFTER the other user's run is done", () => {
      // The late route: B's run has already settled, so neither ownership check runs again for B.
      // If A's stale snapshot were pended here it would sit through B's whole session and become
      // A's flush base on A's return — diffed against a local save that by then holds B's progress.
      const gate = createCloudGate<S>();
      const a = gate.begin(USER, T0)!;
      const b = gate.begin(OTHER, T0 + 1)!;
      expect(gate.settle(b, "b0", false).flushBase).toBe("b0");
      expect(gate.settle(a, "aSnapshot", false)).toEqual({ flushBase: null }); // superseded, late
      expect(gate.begin(null, T0 + 2)).toBeNull();
      const a2 = gate.begin(USER, T0 + 3)!;
      expect(gate.settle(a2, "a2Snapshot", false).flushBase).toBe("a2Snapshot");
    });

    it("discards a superseded run's snapshot when the OTHER user signed out before it settled", () => {
      // Signed out is not "nobody else": the last account on this device was B, and the local save
      // holds B's reconciled progress. A's stale snapshot must not come back as A's flush base.
      const gate = createCloudGate<S>();
      const a = gate.begin(USER, T0)!;
      const b = gate.begin(OTHER, T0 + 1)!;
      expect(gate.settle(b, "b0", false).flushBase).toBe("b0");
      expect(gate.begin(null, T0 + 2)).toBeNull(); // B signs out
      expect(gate.settle(a, "aSnapshot", false)).toEqual({ flushBase: null }); // superseded, later still
      const a2 = gate.begin(USER, T0 + 3)!;
      expect(gate.settle(a2, "a2Snapshot", false).flushBase).toBe("a2Snapshot");
    });

    it("still hands a superseded run's snapshot to the SAME user's next run", () => {
      const gate = createCloudGate<S>();
      const a = gate.begin(USER, T0)!;
      expect(gate.begin(null, T0 + 1)).toBeNull();
      const a2 = gate.begin(USER, T0 + 2)!;
      expect(gate.settle(a, "aSnapshot", false)).toEqual({ flushBase: null });
      expect(gate.settle(a2, "s1", false).flushBase).toBe("aSnapshot");
    });
  });

  it("honours an injected throttle window", () => {
    const gate = createCloudGate<S>(5_000);
    const token = gate.begin(USER, T0)!;
    gate.settle(token, "s0", true);
    expect(gate.shouldRetry(USER, T0 + 4_999)).toBe(false);
    expect(gate.shouldRetry(USER, T0 + 5_000)).toBe(true);
  });
});

/** The app has exactly one way in: the same exact `?gwTestMode=1` query the board's test hooks are
 *  gated on (see BoardScene.setBoardReadyFlag). Anything else is the 30 s default. It is a runtime
 *  hook, so it is reachable on any build, production included; the impact is bounded to one
 *  reconcile per online/visibility/commit event. */
describe("cloudRetryThrottleMs", () => {
  it("reads an override only under the exact gwTestMode=1 query", () => {
    expect(cloudRetryThrottleMs("?gwTestMode=1&gwCloudRetryThrottleMs=1500")).toBe(1_500);
    expect(cloudRetryThrottleMs("gwTestMode=1&gwCloudRetryThrottleMs=0")).toBe(0);
    // No flag, or a flag that is not exactly "1": the override is ignored outright.
    expect(cloudRetryThrottleMs("?gwCloudRetryThrottleMs=1500")).toBe(RECONCILE_RETRY_THROTTLE_MS);
    expect(cloudRetryThrottleMs("?gwTestMode=true&gwCloudRetryThrottleMs=1500")).toBe(RECONCILE_RETRY_THROTTLE_MS);
    expect(cloudRetryThrottleMs("?gwTestMode&gwCloudRetryThrottleMs=1500")).toBe(RECONCILE_RETRY_THROTTLE_MS);
  });

  it("falls back to the default for a missing, unparseable or negative value", () => {
    expect(cloudRetryThrottleMs("?gwTestMode=1")).toBe(RECONCILE_RETRY_THROTTLE_MS);
    expect(cloudRetryThrottleMs("?gwTestMode=1&gwCloudRetryThrottleMs=")).toBe(RECONCILE_RETRY_THROTTLE_MS);
    expect(cloudRetryThrottleMs("?gwTestMode=1&gwCloudRetryThrottleMs=soon")).toBe(RECONCILE_RETRY_THROTTLE_MS);
    expect(cloudRetryThrottleMs("?gwTestMode=1&gwCloudRetryThrottleMs=-1")).toBe(RECONCILE_RETRY_THROTTLE_MS);
    expect(cloudRetryThrottleMs("?gwTestMode=1&gwCloudRetryThrottleMs=Infinity")).toBe(RECONCILE_RETRY_THROTTLE_MS);
    expect(cloudRetryThrottleMs("")).toBe(RECONCILE_RETRY_THROTTLE_MS);
    expect(cloudRetryThrottleMs(undefined)).toBe(RECONCILE_RETRY_THROTTLE_MS);
  });

  it("is what the gate then throttles by", () => {
    const gate = createCloudGate<S>(cloudRetryThrottleMs("?gwTestMode=1&gwCloudRetryThrottleMs=1500"));
    const token = gate.begin(USER, T0)!;
    gate.settle(token, "s0", true);
    expect(gate.shouldRetry(USER, T0 + 1_499)).toBe(false);
    expect(gate.shouldRetry(USER, T0 + 1_500)).toBe(true);
  });
});
