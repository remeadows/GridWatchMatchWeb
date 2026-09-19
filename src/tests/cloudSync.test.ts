import { describe, expect, it, vi } from "vitest";
import type { SavesClient } from "@gridwatch/account-kit";
import { createCloudSync, foldOutcomes, isCurrentProjection, settledSlots, type SlotOutcome } from "../services/cloudSync";
import { applyCloudPayload, freshSlot, projection, toCampaignPayload, toSettingsPayload, type CloudSlot } from "../state/cloudSaves";
import { defaultSaveState, normalizeSave, type SaveState } from "../state/save";

function fakeSaves() {
  const reconcile = vi.fn<SavesClient["reconcile"]>(async () => ({ status: "current" }));
  const store = vi.fn<SavesClient["store"]>(async () => ({ status: "stored", revision: 1, updatedAt: "t" }));
  const saves = { game: { gameSlug: "gridwatch-match", routeAlias: "match", slots: ["campaign", "settings"], schemaVersion: 1 }, load: vi.fn(), store, reconcile, dispose: vi.fn() } as unknown as SavesClient;
  return { saves, reconcile, store };
}

function makeSync(saves: SavesClient | undefined, enabled = true) {
  const onUseCloud = vi.fn();
  const onStored = vi.fn();
  return { sync: createCloudSync({ saves, enabled, onUseCloud, onStored }), onUseCloud, onStored };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

type StoreResult = Awaited<ReturnType<SavesClient["store"]>>;

/** A store promise the test settles by hand, so several stores for one slot can genuinely overlap. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const stored = (revision: number): StoreResult => ({ status: "stored", revision, updatedAt: "t" });

const cloudSave = (payload: Record<string, unknown>, revision = 2) => ({ revision, schemaVersion: 1, payload, updatedAt: "t" });

describe("foldOutcomes", () => {
  it("returns the current state by identity when nothing was replaced", () => {
    const current = defaultSaveState();
    const outcomes: SlotOutcome[] = [
      { slot: "campaign", result: { status: "current" } },
      { slot: "settings", result: { status: "nothing" } },
    ];
    const folded = foldOutcomes(current, outcomes);
    expect(folded.next).toBe(current);
    expect(folded.replaced).toEqual([]);
    expect(folded.failed).toBe(false);
  });

  it("applies use_cloud on campaign while keeping the local settings", () => {
    const current = defaultSaveState();
    current.settings.musicEnabled = false;
    const payload = { ...toCampaignPayload(defaultSaveState()), coins: 250 };
    const folded = foldOutcomes(current, [{ slot: "campaign", result: { status: "use_cloud", save: cloudSave(payload) } }]);
    expect(folded.next).not.toBe(current);
    expect(folded.next.coins).toBe(250);
    expect(folded.next.settings.musicEnabled).toBe(false); // local settings untouched
    expect(folded.replaced).toEqual(["campaign"]);
    expect(folded.failed).toBe(false);
  });

  it("resets only the settings slot for a fresh outcome", () => {
    const current = defaultSaveState();
    current.coins = 42;
    current.settings.musicEnabled = false;
    const folded = foldOutcomes(current, [{ slot: "settings", result: { status: "fresh" } }]);
    expect(folded.next.settings.musicEnabled).toBe(true);
    expect(folded.next.coins).toBe(42); // campaign untouched
    expect(folded.replaced).toEqual(["settings"]);
  });

  it("lists exactly the replaced slots when both slots are replaced", () => {
    const current = defaultSaveState();
    const payload = { ...toCampaignPayload(defaultSaveState()), coins: 7 };
    const folded = foldOutcomes(current, [
      { slot: "campaign", result: { status: "use_cloud", save: cloudSave(payload) } },
      { slot: "settings", result: { status: "fresh" } },
    ]);
    expect(folded.replaced).toEqual(["campaign", "settings"]);
    expect(folded.next.coins).toBe(7);
  });

  it("flags failed when any outcome is an error, and leaves that slot alone", () => {
    const current = defaultSaveState();
    const folded = foldOutcomes(current, [
      { slot: "campaign", result: { status: "error", error: { code: "network", message: "boom" } } },
      { slot: "settings", result: { status: "current" } },
    ]);
    expect(folded.failed).toBe(true);
    expect(folded.replaced).toEqual([]);
    expect(folded.next).toBe(current);
  });

  it("lists the slots the cloud accepted in `uploaded`, separately from `replaced`", () => {
    const current = defaultSaveState();
    const folded = foldOutcomes(current, [
      { slot: "campaign", result: { status: "uploaded", revision: 1 } },
      { slot: "settings", result: { status: "stored", revision: 4 } },
    ]);
    expect(folded.uploaded).toEqual(["campaign", "settings"]);
    expect(folded.replaced).toEqual([]);
    expect(folded.next).toBe(current); // an upload does not change local state
    expect(folded.failed).toBe(false);
  });

  it("leaves `uploaded` empty for outcomes that are not proof of an upload", () => {
    const current = defaultSaveState();
    const payload = { ...toCampaignPayload(defaultSaveState()), coins: 3 };
    const folded = foldOutcomes(current, [
      { slot: "campaign", result: { status: "use_cloud", save: cloudSave(payload) } },
      { slot: "settings", result: { status: "current" } },
    ]);
    expect(folded.uploaded).toEqual([]);
    expect(folded.replaced).toEqual(["campaign"]);
  });

  it("applies onto the CURRENT state, not the snapshot the reconcile started with", () => {
    // The run started from the defaults; while the GETs were in flight the player earned coins.
    const current = defaultSaveState();
    current.coins = 999; // a newer local value in the slot the cloud did NOT replace
    const folded = foldOutcomes(current, [{ slot: "settings", result: { status: "use_cloud", save: cloudSave({ ...toSettingsPayload(defaultSaveState()), musicEnabled: false }) } }]);
    expect(folded.next.settings.musicEnabled).toBe(false);
    expect(folded.next.coins).toBe(999); // the unrelated slot's newer value survives
    expect(folded.replaced).toEqual(["settings"]);
  });
});

describe("settledSlots", () => {
  /** The state the reconcile run started from — the snapshot the kit uploaded a projection of. */
  const startedWith = defaultSaveState();
  const withCoins = (base: SaveState, coins: number): SaveState => normalizeSave({ ...base, coins });
  const withMusic = (base: SaveState, musicEnabled: boolean): SaveState =>
    normalizeSave({ ...base, settings: { ...base.settings, musicEnabled } });

  it("clears and skips a replaced slot unconditionally", () => {
    // foldOutcomes applied the cloud payload onto the CURRENT state, so the cloud provably holds this
    // slot however much the player committed mid-flight — that edit is dropped by the player's own
    // choice, and the flag has nothing left to protect.
    const next = withCoins(startedWith, 250);
    expect(settledSlots({ startedWith, next, replaced: ["campaign"], uploaded: [] }))
      .toEqual({ clear: ["campaign"], skip: ["campaign"] });
  });

  it("clears and skips an uploaded slot that did not change since the snapshot the kit sent", () => {
    expect(settledSlots({ startedWith, next: startedWith, replaced: [], uploaded: ["settings"] }))
      .toEqual({ clear: ["settings"], skip: ["settings"] });
    // A structurally equal but distinct object is still "did not change".
    expect(settledSlots({ startedWith, next: normalizeSave({ ...startedWith }), replaced: [], uploaded: ["settings"] }))
      .toEqual({ clear: ["settings"], skip: ["settings"] });
  });

  it("neither clears nor skips an uploaded slot that CHANGED since the snapshot the kit sent", () => {
    // The kit sent projection(startedWith); this commit landed while that PUT was in flight, so the
    // cloud does not hold it. Its only route out is the settle-time flush, and it must stay flagged
    // until its own `stored` reply — skipping and clearing here is exactly how it went missing.
    const next = withMusic(startedWith, false);
    expect(settledSlots({ startedWith, next, replaced: [], uploaded: ["settings"] }))
      .toEqual({ clear: [], skip: [] });
  });

  it("neither clears nor skips a slot that was neither replaced nor uploaded", () => {
    const next = withCoins(startedWith, 9);
    expect(settledSlots({ startedWith, next, replaced: [], uploaded: [] })).toEqual({ clear: [], skip: [] });
    expect(settledSlots({ startedWith, next: startedWith, replaced: [], uploaded: [] })).toEqual({ clear: [], skip: [] });
  });

  it("decides each slot on its own: a replaced slot settles while a changed uploaded slot does not", () => {
    const next = withMusic(withCoins(startedWith, 250), false);
    expect(settledSlots({ startedWith, next, replaced: ["campaign"], uploaded: ["settings"] }))
      .toEqual({ clear: ["campaign"], skip: ["campaign"] });
  });

  it("returns slots in CLOUD_SLOTS order, in two independent arrays, without mutating its inputs", () => {
    const replaced = ["settings", "campaign"] as const;
    const result = settledSlots({ startedWith, next: startedWith, replaced, uploaded: [] });
    expect(result.clear).toEqual(["campaign", "settings"]);
    expect(result.skip).toEqual(["campaign", "settings"]);
    expect(result.skip).not.toBe(result.clear);
    expect(replaced).toEqual(["settings", "campaign"]);
  });
});

describe("isCurrentProjection", () => {
  it("is true when the payload is exactly what the slot projects right now", () => {
    const save = defaultSaveState();
    save.coins = 12;
    save.settings.musicEnabled = false;
    expect(isCurrentProjection(save, "campaign", projection(save, "campaign"))).toBe(true);
    expect(isCurrentProjection(save, "settings", projection(save, "settings"))).toBe(true);
  });

  it("is false once a later commit changed that slot, and stays true for the untouched one", () => {
    const sent = defaultSaveState();
    const settingsPayload = projection(sent, "settings");
    const campaignPayload = projection(sent, "campaign");
    const afterCommit = normalizeSave({ ...sent, settings: { ...sent.settings, voiceEnabled: false } });
    expect(isCurrentProjection(afterCommit, "settings", settingsPayload)).toBe(false);
    expect(isCurrentProjection(afterCommit, "campaign", campaignPayload)).toBe(true);
  });

  it("does not depend on the order the save's own keys were built in", () => {
    // normalizeSave spreads the defaults FIRST, so every save the app holds projects its keys in the
    // defaults' order regardless of how the caller's literal was written.
    const scrambled = normalizeSave({
      settings: { reducedMotion: false, voiceEnabled: true, sfxEnabled: true, musicEnabled: false },
      coins: 5,
    });
    const canonical = normalizeSave({
      coins: 5,
      settings: { musicEnabled: false, sfxEnabled: true, voiceEnabled: true, reducedMotion: false },
    });
    expect(isCurrentProjection(scrambled, "settings", projection(canonical, "settings"))).toBe(true);
    expect(isCurrentProjection(scrambled, "campaign", projection(canonical, "campaign"))).toBe(true);
  });

  it("is false for a payload whose keys are reordered, and for a non-object payload", () => {
    // Same JSON.stringify idiom changedSlots/isPristine already use: it compares bytes, so a
    // reordered payload reads as "not current". Conservative in the safe direction — a kept flag
    // costs a redundant upload or one extra prompt, never a lost commit. Nothing inside the app can
    // produce a reordered projection (see the test above); only a foreign payload could.
    const save = defaultSaveState();
    const ordered = projection(save, "settings");
    const reordered = {
      reducedMotion: ordered.reducedMotion, voiceEnabled: ordered.voiceEnabled,
      sfxEnabled: ordered.sfxEnabled, musicEnabled: ordered.musicEnabled,
    };
    expect(reordered).toEqual(ordered);
    expect(isCurrentProjection(save, "settings", reordered)).toBe(false);
    expect(isCurrentProjection(save, "settings", null)).toBe(false);
    expect(isCurrentProjection(save, "settings", undefined)).toBe(false);
  });
});

describe("createCloudSync", () => {
  it("reconciles both slots concurrently and reports per-slot outcomes in slot order", async () => {
    const { saves, reconcile } = fakeSaves();
    const cloudCampaign = { ...toCampaignPayload(defaultSaveState()), coins: 99 };
    reconcile.mockImplementation(async (slot) => slot === "campaign"
      ? { status: "use_cloud", save: cloudSave(cloudCampaign) }
      : { status: "fresh" });
    const { sync } = makeSync(saves);
    const local = defaultSaveState();
    local.settings.musicEnabled = false;
    const outcomes = await sync.reconcileAll(local, []);
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(reconcile.mock.calls.map((c) => c[0])).toEqual(["campaign", "settings"]);
    expect(reconcile.mock.calls[0][1]).toBeNull(); // campaign untouched → pristine → null
    expect(reconcile.mock.calls[1][1]).toEqual(toSettingsPayload(local)); // settings changed → non-pristine
    expect(outcomes.map((o) => o.slot)).toEqual(["campaign", "settings"]);
    expect(outcomes[0].result.status).toBe("use_cloud");
    expect(outcomes[1].result.status).toBe("fresh");
    const folded = foldOutcomes(local, outcomes);
    expect(folded.next.coins).toBe(99);
    expect(folded.next.settings.musicEnabled).toBe(true); // "Start fresh" on settings → defaults
  });

  it("hands the kit null for a pristine slot instead of the default projection", async () => {
    const { saves, reconcile } = fakeSaves();
    const { sync } = makeSync(saves);
    await sync.reconcileAll(defaultSaveState(), []);
    expect(reconcile.mock.calls[0][1]).toBeNull(); // campaign
    expect(reconcile.mock.calls[1][1]).toBeNull(); // settings
  });

  it("hands the kit the real projection only for the slot that actually changed", async () => {
    const { saves, reconcile } = fakeSaves();
    const { sync } = makeSync(saves);
    const played = defaultSaveState();
    played.coins = 40; // campaign changed, settings still default
    await sync.reconcileAll(played, []);
    expect(reconcile.mock.calls[0][1]).toEqual(toCampaignPayload(played)); // campaign
    expect(reconcile.mock.calls[1][1]).toBeNull(); // settings still pristine
  });

  it("reports non-replacing statuses as-is so nothing is folded", async () => {
    const { saves, reconcile } = fakeSaves();
    const { sync } = makeSync(saves);
    const local = defaultSaveState();
    for (const status of ["current", "nothing", "signed_out"] as const) {
      reconcile.mockResolvedValue({ status });
      const outcomes = await sync.reconcileAll(local, []);
      expect(outcomes.map((o) => o.result.status)).toEqual([status, status]);
      const folded = foldOutcomes(local, outcomes);
      expect(folded.next).toBe(local);
      expect(folded.failed).toBe(false);
    }
  });

  it("never rejects: a throwing client resolves to an error outcome for every slot", async () => {
    const { saves, reconcile } = fakeSaves();
    const { sync } = makeSync(saves);
    const local = defaultSaveState();
    reconcile.mockRejectedValue(new Error("boom"));
    const outcomes = await sync.reconcileAll(local, []);
    expect(outcomes.map((o) => o.slot)).toEqual(["campaign", "settings"]);
    for (const outcome of outcomes) {
      expect(outcome.result).toEqual({ status: "error", error: { code: "network", message: "boom" } });
    }
    expect(foldOutcomes(local, outcomes).failed).toBe(true);
  });

  it("stores only changed slots and applies a use_cloud answer through onUseCloud", async () => {
    const { saves, store } = fakeSaves();
    const { sync, onUseCloud, onStored } = makeSync(saves);
    const before = defaultSaveState();
    const after = { ...before, coins: 5 };
    const cloudCampaign = { ...toCampaignPayload(before), coins: 77 };
    store.mockResolvedValueOnce({ status: "use_cloud", save: cloudSave(cloudCampaign, 3) });
    sync.storeChanges(before, after);
    await tick();
    expect(store).toHaveBeenCalledTimes(1);
    expect(store.mock.calls[0]).toEqual(["campaign", toCampaignPayload(after)]);
    expect(onUseCloud).toHaveBeenCalledWith("campaign", cloudCampaign, true);
    expect(onStored).not.toHaveBeenCalled(); // a use_cloud store is NOT proof of upload
  });

  it("sends a flagged slot as a real local copy with localChanged, even when it is pristine", async () => {
    const { saves, reconcile } = fakeSaves();
    const { sync } = makeSync(saves);
    const pristine = defaultSaveState();
    // `campaign` was deliberately RESET to the defaults while unsynced: bit-for-bit pristine, but
    // the flag says the cloud has never confirmed it, so it must go up as a real local copy.
    await sync.reconcileAll(pristine, ["campaign"]);
    expect(reconcile.mock.calls[0][1]).toEqual(toCampaignPayload(pristine));
    expect(reconcile.mock.calls[0][2]).toEqual({ localChanged: true });
    expect(reconcile.mock.calls[1][1]).toBeNull(); // settings not flagged and pristine → still null
    expect(reconcile.mock.calls[1][2]).toEqual({ localChanged: false });
  });

  it("passes localChanged false for a slot with real local changes that are already synced", async () => {
    const { saves, reconcile } = fakeSaves();
    const { sync } = makeSync(saves);
    const played = defaultSaveState();
    played.coins = 40;
    await sync.reconcileAll(played, ["settings"]);
    expect(reconcile.mock.calls[0][1]).toEqual(toCampaignPayload(played));
    expect(reconcile.mock.calls[0][2]).toEqual({ localChanged: false }); // changed, but synced
    expect(reconcile.mock.calls[1][1]).toEqual(toSettingsPayload(played)); // flagged → non-null
    expect(reconcile.mock.calls[1][2]).toEqual({ localChanged: true });
  });

  it("reports a stored slot through onStored, and only for `stored`", async () => {
    const { saves, store } = fakeSaves();
    const { sync, onStored } = makeSync(saves);
    const before = defaultSaveState();
    const after = { ...before, coins: 5, settings: { ...before.settings, musicEnabled: false } };
    store.mockImplementation(async (slot) => slot === "campaign"
      ? { status: "stored", revision: 2, updatedAt: "t" }
      : { status: "error", error: { code: "upstream", message: "503" } });
    sync.storeChanges(before, after);
    await tick();
    expect(store).toHaveBeenCalledTimes(2);
    expect(onStored.mock.calls).toEqual([["campaign", toCampaignPayload(after)]]); // settings errored → still unsynced
  });

  it("hands onStored the exact payload it stored, so the caller can check it is still current", async () => {
    const { saves, store } = fakeSaves();
    const { sync, onStored } = makeSync(saves);
    const before = defaultSaveState();
    const after = { ...before, coins: 5, settings: { ...before.settings, musicEnabled: false } };
    sync.storeChanges(before, after);
    await tick();
    expect(onStored.mock.calls).toEqual([
      ["campaign", toCampaignPayload(after)],
      ["settings", toSettingsPayload(after)],
    ]);
    // Not a re-projection taken at reply time: the very object that went to the wire. A commit made
    // between the store and its reply must therefore be visible as a difference to the caller.
    expect(onStored.mock.calls[0][1]).toBe(store.mock.calls[0][1]);
    expect(onStored.mock.calls[1][1]).toBe(store.mock.calls[1][1]);
  });

  it("does not report a signed_out store as stored", async () => {
    const { saves, store } = fakeSaves();
    const { sync, onStored } = makeSync(saves);
    const before = defaultSaveState();
    store.mockResolvedValue({ status: "signed_out" });
    sync.storeChanges(before, { ...before, coins: 5 });
    await tick();
    expect(store).toHaveBeenCalledTimes(1);
    expect(onStored).not.toHaveBeenCalled();
  });

  it("never stores a skipped slot, even when it changed", async () => {
    const { saves, store } = fakeSaves();
    const { sync } = makeSync(saves);
    const before = defaultSaveState();
    const after = { ...before, coins: 5, settings: { ...before.settings, musicEnabled: false } };
    sync.storeChanges(before, after, ["campaign"]);
    await tick();
    expect(store).toHaveBeenCalledTimes(1);
    expect(store.mock.calls[0][0]).toBe("settings");
  });

  it("does nothing when disabled or without a saves client", async () => {
    const { saves, store, reconcile } = fakeSaves();
    const local = defaultSaveState();
    const { sync: disabled } = makeSync(saves, false);
    expect(await disabled.reconcileAll(local, [])).toEqual([]);
    disabled.storeChanges(null, local);
    const { sync: none } = makeSync(undefined);
    expect(await none.reconcileAll(local, [])).toEqual([]);
    none.storeChanges(null, local);
    await tick();
    expect(store).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });
});

/**
 * The kit serializes reconciles per slot and a slot's reconcile can sit on a player prompt for
 * minutes, so the two slots resolve at genuinely different times. A cloud answer must be applied the
 * moment ITS OWN slot resolves, and everything the player commits after that must survive.
 *
 * These tests compose the pieces exactly the way App.tsx's reconcile effect does — a `saveRef`
 * stand-in, the per-slot callback, the projection recorded right after each application, then the
 * end-of-run fold and `settledSlots` — because the bug being pinned is in the composition: the late
 * fold used to re-apply the payload over the newer commit, and `settledSlots` used to clear the
 * slot's flag and skip it in the flush, so that commit reached neither the cloud nor the next run.
 */
describe("createCloudSync per-slot reconcile resolution", () => {
  type ReconcileOutcome = Awaited<ReturnType<SavesClient["reconcile"]>>;

  /** App.tsx's reconcile effect, reduced to what these tests need to observe. */
  function appWiring(startedWith: SaveState) {
    const applied = new Map<CloudSlot, Record<string, unknown>>();
    const state = { current: startedWith, applications: 0 };
    const onResolved = ({ slot, result }: SlotOutcome): void => {
      if (result.status === "use_cloud") state.current = applyCloudPayload(state.current, slot, result.save.payload);
      else if (result.status === "fresh") state.current = freshSlot(state.current, slot);
      else return;
      state.applications += 1;
      // Recorded RIGHT AFTER application: what the cloud provably holds for this slot, as of now.
      applied.set(slot, projection(state.current, slot));
    };
    return { applied, state, onResolved };
  }

  const cloudSettings = { ...toSettingsPayload(defaultSaveState()), musicEnabled: false };

  it("applies a slot's cloud answer when THAT slot resolves, not when the whole run does", async () => {
    const { saves, reconcile } = fakeSaves();
    const { sync } = makeSync(saves);
    const campaignGate = deferred<ReconcileOutcome>();
    const settingsGate = deferred<ReconcileOutcome>();
    reconcile.mockImplementation((slot) => (slot === "campaign" ? campaignGate.promise : settingsGate.promise));

    const startedWith = defaultSaveState();
    const { applied, state, onResolved } = appWiring(startedWith);
    const run = sync.reconcileAll(startedWith, [], onResolved);

    // `settings` answers at once; `campaign` is still sitting on the kit's prompt.
    settingsGate.resolve({ status: "use_cloud", save: cloudSave(cloudSettings) });
    await tick();
    expect(state.current.settings.musicEnabled).toBe(false); // applied already, with campaign pending
    expect(state.applications).toBe(1);
    expect(applied.get("settings")).toEqual(projection(state.current, "settings"));

    campaignGate.resolve({ status: "nothing" });
    await run;
    expect(state.applications).toBe(1); // and the late fold did not apply it a second time
  });

  it("keeps a commit made after the answer was applied, and does not settle that slot", async () => {
    const { saves, reconcile } = fakeSaves();
    const { sync } = makeSync(saves);
    const campaignGate = deferred<ReconcileOutcome>();
    const settingsGate = deferred<ReconcileOutcome>();
    reconcile.mockImplementation((slot) => (slot === "campaign" ? campaignGate.promise : settingsGate.promise));

    const startedWith = defaultSaveState();
    const { applied, state, onResolved } = appWiring(startedWith);
    const run = sync.reconcileAll(startedWith, [], onResolved);

    settingsGate.resolve({ status: "use_cloud", save: cloudSave(cloudSettings) });
    await tick();
    // The player commits to the SAME slot while campaign is still waiting on its prompt. It sits on
    // top of the cloud state the answer just installed, and the gate is holding it.
    state.current = normalizeSave({ ...state.current, settings: { ...state.current.settings, reducedMotion: true } });

    campaignGate.resolve({ status: "nothing" });
    const outcomes = await run;
    const { next, replaced, uploaded } = foldOutcomes(state.current, outcomes, [...applied.keys()]);

    expect(state.applications).toBe(1);
    expect(next.settings.reducedMotion).toBe(true);  // the commit survived the fold
    expect(next.settings.musicEnabled).toBe(false);  // ...on top of the cloud copy
    expect(replaced).toEqual(["settings"]);          // still a replaced slot: the answer was not discarded
    // Moved since the answer was applied, so the cloud does NOT hold its current projection: keep the
    // flag and let the settle-time flush send it, exactly like a moved `uploaded` slot.
    expect(settledSlots({ startedWith, next, replaced, uploaded, applied })).toEqual({ clear: [], skip: [] });
  });

  it("settles the slot when nothing was committed after the answer was applied", async () => {
    // Control for the test above.
    const { saves, reconcile } = fakeSaves();
    const { sync } = makeSync(saves);
    const campaignGate = deferred<ReconcileOutcome>();
    reconcile.mockImplementation(async (slot) => (slot === "campaign"
      ? campaignGate.promise
      : { status: "use_cloud", save: cloudSave(cloudSettings) }));

    const startedWith = defaultSaveState();
    const { applied, state, onResolved } = appWiring(startedWith);
    const run = sync.reconcileAll(startedWith, [], onResolved);
    await tick();
    expect(state.current.settings.musicEnabled).toBe(false);

    campaignGate.resolve({ status: "nothing" });
    const outcomes = await run;
    const { next, replaced, uploaded } = foldOutcomes(state.current, outcomes, [...applied.keys()]);
    expect(settledSlots({ startedWith, next, replaced, uploaded, applied }))
      .toEqual({ clear: ["settings"], skip: ["settings"] });
  });

  it("gives a `fresh` outcome the same at-resolve treatment", async () => {
    const { saves, reconcile } = fakeSaves();
    const { sync } = makeSync(saves);
    const campaignGate = deferred<ReconcileOutcome>();
    const settingsGate = deferred<ReconcileOutcome>();
    reconcile.mockImplementation((slot) => (slot === "campaign" ? campaignGate.promise : settingsGate.promise));

    const startedWith = normalizeSave({ ...defaultSaveState(), settings: { ...defaultSaveState().settings, musicEnabled: false } });
    const { applied, state, onResolved } = appWiring(startedWith);
    const run = sync.reconcileAll(startedWith, ["settings"], onResolved);

    settingsGate.resolve({ status: "fresh" }); // "Start fresh": the slot goes back to the defaults
    await tick();
    expect(state.current.settings.musicEnabled).toBe(true); // reset at ITS resolve
    state.current = normalizeSave({ ...state.current, settings: { ...state.current.settings, sfxEnabled: false } });

    campaignGate.resolve({ status: "nothing" });
    const outcomes = await run;
    const { next, replaced, uploaded } = foldOutcomes(state.current, outcomes, [...applied.keys()]);
    expect(state.applications).toBe(1);
    expect(next.settings.sfxEnabled).toBe(false); // the post-reset commit survived
    expect(next.settings.musicEnabled).toBe(true);
    expect(replaced).toEqual(["settings"]);
    expect(settledSlots({ startedWith, next, replaced, uploaded, applied })).toEqual({ clear: [], skip: [] });
  });

  it("still folds an answer the caller did not apply at resolve, so no kit answer is ever discarded", async () => {
    // No per-slot callback at all (and the same backstop covers a slot whose callback could not run,
    // e.g. before the local save has loaded): the end-of-run fold is still the one that applies it.
    const { saves, reconcile } = fakeSaves();
    const { sync } = makeSync(saves);
    reconcile.mockImplementation(async (slot) => (slot === "campaign"
      ? { status: "nothing" }
      : { status: "use_cloud", save: cloudSave(cloudSettings) }));
    const startedWith = defaultSaveState();
    const outcomes = await sync.reconcileAll(startedWith, []);
    const { next, replaced, uploaded } = foldOutcomes(startedWith, outcomes, []);
    expect(next.settings.musicEnabled).toBe(false);
    expect(settledSlots({ startedWith, next, replaced, uploaded, applied: new Map() }))
      .toEqual({ clear: ["settings"], skip: ["settings"] });
  });

  it("reports every slot's outcome to the callback, in resolve order", async () => {
    const { saves, reconcile } = fakeSaves();
    const { sync } = makeSync(saves);
    const campaignGate = deferred<ReconcileOutcome>();
    const settingsGate = deferred<ReconcileOutcome>();
    reconcile.mockImplementation((slot) => (slot === "campaign" ? campaignGate.promise : settingsGate.promise));
    const seen: string[] = [];
    const run = sync.reconcileAll(defaultSaveState(), [], ({ slot, result }) => { seen.push(`${slot}:${result.status}`); });
    settingsGate.resolve({ status: "current" });
    await tick();
    expect(seen).toEqual(["settings:current"]);
    campaignGate.resolve({ status: "nothing" });
    await run;
    expect(seen).toEqual(["settings:current", "campaign:nothing"]);
  });

  it("never lets a throwing callback turn a good run into an errored one", async () => {
    const { saves, reconcile } = fakeSaves();
    const { sync } = makeSync(saves);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      reconcile.mockResolvedValue({ status: "current" });
      const outcomes = await sync.reconcileAll(defaultSaveState(), [], () => { throw new Error("render exploded"); });
      expect(outcomes.map((o) => o.result.status)).toEqual(["current", "current"]);
    } finally {
      warn.mockRestore();
    }
  });
});

/**
 * `onStored` is the app's only proof that the cloud holds a slot, and the app clears the slot's
 * unsynced flag on it. A payload that matches the current projection is not enough on its own: the
 * match is point-in-time, and the kit serializes stores per slot, so a LATER store that is still
 * queued can move the cloud away again after the match was observed. These tests pin the second
 * half of the predicate — nothing else for that slot may still be outstanding.
 */
describe("createCloudSync outstanding stores", () => {
  const settingsOnly = (base: SaveState, settings: Partial<SaveState["settings"]>): SaveState =>
    normalizeSave({ ...base, settings: { ...base.settings, ...settings } });

  /** A = the defaults, B = music off, C = music off + sfx off. B and C differ only in `settings`. */
  const A = defaultSaveState();
  const B = settingsOnly(A, { musicEnabled: false });
  const C = settingsOnly(B, { sfxEnabled: false });

  it("does not report PUT1's stored reply when a later store for the same slot is still outstanding", async () => {
    // commit1 A->B (PUT1, slow reply); commit2 B->C queued behind it; commit3 C->B queued behind
    // that. PUT1's reply lands last-but-two and its payload IS the current projection (B again) —
    // the point-in-time check passes. Clearing there is the bug: PUT2 then puts the cloud at C, and
    // when PUT3 fails terminally the device holds B, the cloud holds C, and nothing is flagged.
    const { saves, store } = fakeSaves();
    const { sync, onStored } = makeSync(saves);
    const put1 = deferred<StoreResult>();
    const put2 = deferred<StoreResult>();
    const put3 = deferred<StoreResult>();
    store.mockReturnValueOnce(put1.promise).mockReturnValueOnce(put2.promise).mockReturnValueOnce(put3.promise);

    sync.storeChanges(A, B);
    sync.storeChanges(B, C);
    sync.storeChanges(C, B);
    expect(store).toHaveBeenCalledTimes(3);
    expect(store.mock.calls.map((call) => call[0])).toEqual(["settings", "settings", "settings"]);

    put1.resolve(stored(1));
    await tick();
    expect(onStored).not.toHaveBeenCalled(); // PUT2 and PUT3 still outstanding

    put2.resolve(stored(2));
    await tick();
    expect(onStored).not.toHaveBeenCalled(); // PUT3 still outstanding

    put3.reject(new Error("403 forbidden")); // terminal: the kit gives up, the cloud keeps C
    await tick();
    expect(onStored).not.toHaveBeenCalled();
  });

  it("reports a lone store whose payload the cloud took", async () => {
    const { saves, store } = fakeSaves();
    const { sync, onStored } = makeSync(saves);
    const put1 = deferred<StoreResult>();
    store.mockReturnValueOnce(put1.promise);
    sync.storeChanges(A, B);
    put1.resolve(stored(1));
    await tick();
    expect(onStored.mock.calls).toEqual([["settings", toSettingsPayload(B)]]);
  });

  it("reports only the LAST of two overlapping stores, on its own reply", async () => {
    const { saves, store } = fakeSaves();
    const { sync, onStored } = makeSync(saves);
    const put1 = deferred<StoreResult>();
    const put2 = deferred<StoreResult>();
    store.mockReturnValueOnce(put1.promise).mockReturnValueOnce(put2.promise);
    sync.storeChanges(A, B);
    sync.storeChanges(B, C);

    put1.resolve(stored(1));
    await tick();
    expect(onStored).not.toHaveBeenCalled();

    put2.resolve(stored(2));
    await tick();
    expect(onStored.mock.calls).toEqual([["settings", toSettingsPayload(C)]]);
  });

  it("counts down on an error result, so a later store is still reported", async () => {
    const { saves, store } = fakeSaves();
    const { sync, onStored } = makeSync(saves);
    const put1 = deferred<StoreResult>();
    const put2 = deferred<StoreResult>();
    store.mockReturnValueOnce(put1.promise).mockReturnValueOnce(put2.promise);
    sync.storeChanges(A, B);
    sync.storeChanges(B, C);
    put1.resolve({ status: "error", error: { code: "upstream", message: "503" } });
    await tick();
    expect(onStored).not.toHaveBeenCalled();
    put2.resolve(stored(1));
    await tick();
    expect(onStored.mock.calls).toEqual([["settings", toSettingsPayload(C)]]);
  });

  it("counts down on a thrown rejection, so a later store is still reported", async () => {
    const { saves, store } = fakeSaves();
    const { sync, onStored } = makeSync(saves);
    const put1 = deferred<StoreResult>();
    const put2 = deferred<StoreResult>();
    store.mockReturnValueOnce(put1.promise).mockReturnValueOnce(put2.promise);
    sync.storeChanges(A, B);
    sync.storeChanges(B, C);
    put1.reject(new Error("network down"));
    await tick();
    expect(onStored).not.toHaveBeenCalled();
    put2.resolve(stored(1));
    await tick();
    expect(onStored.mock.calls).toEqual([["settings", toSettingsPayload(C)]]);
  });

  it("applies a use_cloud answer but signals no clear while another store for the slot is outstanding", async () => {
    // commit1 A->B (PUT1); its 409 opens the kit's conflict prompt. An animation-driven commit2
    // B->C (no user input needed) queues PUT2 behind it. The player answers "Use cloud": the cloud
    // payload MUST still be applied — a kit answer is never discarded — but the flag must NOT be
    // cleared. PUT2 then flushes on the revision the answer just confirmed and lands C, the copy the
    // player rejected; with the flag clear and the kit's own record clean the next reconcile answers
    // `current` and nothing ever repairs it.
    const { saves, store } = fakeSaves();
    const { sync, onUseCloud, onStored } = makeSync(saves);
    const put1 = deferred<StoreResult>();
    const put2 = deferred<StoreResult>();
    store.mockReturnValueOnce(put1.promise).mockReturnValueOnce(put2.promise);
    sync.storeChanges(A, B);
    sync.storeChanges(B, C);

    const cloudPayload = { ...toSettingsPayload(A) };
    put1.resolve({ status: "use_cloud", save: cloudSave(cloudPayload, 4) });
    await tick();
    expect(onUseCloud.mock.calls).toEqual([["settings", cloudPayload, false]]);
    expect(onStored).not.toHaveBeenCalled();

    put2.resolve(stored(5));
    await tick();
    // PUT2's reply is the last word for the slot, so it IS reported — with its own payload (C).
    // Keeping the flag set through the answer is what makes the caller's freshness check reject it.
    expect(onStored.mock.calls).toEqual([["settings", toSettingsPayload(C)]]);
  });

  it("signals a clear for a lone store's use_cloud answer", async () => {
    // Control for the test above: nothing else is queued, so the cloud holds exactly what the answer
    // just put on screen and the flag has nothing left to protect.
    const { saves, store } = fakeSaves();
    const { sync, onUseCloud } = makeSync(saves);
    const put1 = deferred<StoreResult>();
    store.mockReturnValueOnce(put1.promise);
    sync.storeChanges(A, B);
    const cloudPayload = { ...toSettingsPayload(A) };
    put1.resolve({ status: "use_cloud", save: cloudSave(cloudPayload, 4) });
    await tick();
    expect(onUseCloud.mock.calls).toEqual([["settings", cloudPayload, true]]);
  });

  it("leaves the slot flagged end to end when the cloud ends up with the commit the player rejected", async () => {
    // The two halves of the predicate composed the way App.tsx composes them, over a one-slot flag
    // set: `settled` guards the use_cloud clear, `isCurrentProjection` guards the stored clear. The
    // point is the subtlety — after the cloud payload replaces commit2's content the flag is STILL
    // set, which is intended: the next reconcile repairs the slot via `restore_dirty`.
    const { saves, store } = fakeSaves();
    const put1 = deferred<StoreResult>();
    const put2 = deferred<StoreResult>();
    store.mockReturnValueOnce(put1.promise).mockReturnValueOnce(put2.promise);
    let current: SaveState = C; // what the device holds after commit2
    const flagged = new Set<CloudSlot>(["settings"]);
    const sync = createCloudSync({
      saves,
      enabled: true,
      onUseCloud: (slot, payload, settled) => {
        current = applyCloudPayload(current, slot, payload);
        if (settled) flagged.delete(slot);
      },
      onStored: (slot, payload) => {
        if (isCurrentProjection(current, slot, payload)) flagged.delete(slot);
      },
    });
    sync.storeChanges(A, B);
    sync.storeChanges(B, C);

    put1.resolve({ status: "use_cloud", save: cloudSave({ ...toSettingsPayload(A) }, 4) });
    await tick();
    expect(current.settings).toEqual(A.settings); // the kit's answer was applied, unconditionally
    expect([...flagged]).toEqual(["settings"]); // ...and the flag survived it

    put2.resolve(stored(5));
    await tick();
    // PUT2 put C in the cloud; the device holds the cloud copy the player chose. Not current, so
    // the flag stays — the slot really is out of sync, and only the flag says so.
    expect([...flagged]).toEqual(["settings"]);
  });

  it("releases the count and swallows a synchronous throw from store()", async () => {
    const { saves, store } = fakeSaves();
    const { sync, onStored } = makeSync(saves);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const settings1 = deferred<StoreResult>();
      store.mockImplementationOnce(() => { throw new Error("store exploded"); })
        .mockReturnValueOnce(settings1.promise);
      // One commit touching both slots. `campaign` throws synchronously: that must not escape into
      // commitSave (the local save is already committed and persisted by then, so a cloud-only
      // failure would abort the rest of the commit path) and must not cost `settings` its store.
      expect(() => sync.storeChanges(A, normalizeSave({ ...C, coins: 5 }))).not.toThrow();
      expect(store.mock.calls.map((call) => call[0])).toEqual(["campaign", "settings"]);
      expect(warn).toHaveBeenCalledTimes(1);
      settings1.resolve(stored(1));
      await tick();
      expect(onStored.mock.calls).toEqual([["settings", toSettingsPayload(C)]]);

      // The throw took a count for `campaign` that no promise will ever settle, so it has to be
      // released synchronously — otherwise this next store's own reply could never clear the slot.
      const campaign2 = deferred<StoreResult>();
      store.mockReturnValueOnce(campaign2.promise);
      sync.storeChanges(A, normalizeSave({ ...A, coins: 9 }));
      campaign2.resolve(stored(2));
      await tick();
      expect(onStored).toHaveBeenCalledTimes(2);
      expect(onStored.mock.calls[1][0]).toBe("campaign");
    } finally {
      warn.mockRestore();
    }
  });

  it("counts per slot: an outstanding campaign store does not hold back a settled settings store", async () => {
    const { saves, store } = fakeSaves();
    const { sync, onStored } = makeSync(saves);
    const campaign = deferred<StoreResult>();
    const settings = deferred<StoreResult>();
    // One commit changing BOTH slots: campaign is stored first (CLOUD_SLOTS order), settings second.
    store.mockReturnValueOnce(campaign.promise).mockReturnValueOnce(settings.promise);
    sync.storeChanges(A, normalizeSave({ ...B, coins: 5 }));
    expect(store.mock.calls.map((call) => call[0])).toEqual(["campaign", "settings"]);
    settings.resolve(stored(1));
    await tick();
    expect(onStored.mock.calls).toEqual([["settings", toSettingsPayload(B)]]);
    campaign.resolve(stored(1));
    await tick();
    expect(onStored).toHaveBeenCalledTimes(2);
  });
});
