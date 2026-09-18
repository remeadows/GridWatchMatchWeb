import { describe, expect, it, vi } from "vitest";
import type { SavesClient } from "@gridwatch/account-kit";
import { createCloudSync, foldOutcomes, type SlotOutcome } from "../services/cloudSync";
import { toCampaignPayload, toSettingsPayload } from "../state/cloudSaves";
import { defaultSaveState } from "../state/save";

function fakeSaves() {
  const reconcile = vi.fn<SavesClient["reconcile"]>(async () => ({ status: "current" }));
  const store = vi.fn<SavesClient["store"]>(async () => ({ status: "stored", revision: 1, updatedAt: "t" }));
  const saves = { game: { gameSlug: "gridwatch-match", routeAlias: "match", slots: ["campaign", "settings"], schemaVersion: 1 }, load: vi.fn(), store, reconcile, dispose: vi.fn() } as unknown as SavesClient;
  return { saves, reconcile, store };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

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

describe("createCloudSync", () => {
  it("reconciles both slots concurrently and reports per-slot outcomes in slot order", async () => {
    const { saves, reconcile } = fakeSaves();
    const cloudCampaign = { ...toCampaignPayload(defaultSaveState()), coins: 99 };
    reconcile.mockImplementation(async (slot) => slot === "campaign"
      ? { status: "use_cloud", save: cloudSave(cloudCampaign) }
      : { status: "fresh" });
    const sync = createCloudSync({ saves, enabled: true, onUseCloud: vi.fn() });
    const local = defaultSaveState();
    local.settings.musicEnabled = false;
    const outcomes = await sync.reconcileAll(local);
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
    const sync = createCloudSync({ saves, enabled: true, onUseCloud: vi.fn() });
    await sync.reconcileAll(defaultSaveState());
    expect(reconcile.mock.calls[0][1]).toBeNull(); // campaign
    expect(reconcile.mock.calls[1][1]).toBeNull(); // settings
  });

  it("hands the kit the real projection only for the slot that actually changed", async () => {
    const { saves, reconcile } = fakeSaves();
    const sync = createCloudSync({ saves, enabled: true, onUseCloud: vi.fn() });
    const played = defaultSaveState();
    played.coins = 40; // campaign changed, settings still default
    await sync.reconcileAll(played);
    expect(reconcile.mock.calls[0][1]).toEqual(toCampaignPayload(played)); // campaign
    expect(reconcile.mock.calls[1][1]).toBeNull(); // settings still pristine
  });

  it("reports non-replacing statuses as-is so nothing is folded", async () => {
    const { saves, reconcile } = fakeSaves();
    const sync = createCloudSync({ saves, enabled: true, onUseCloud: vi.fn() });
    const local = defaultSaveState();
    for (const status of ["current", "nothing", "signed_out"] as const) {
      reconcile.mockResolvedValue({ status });
      const outcomes = await sync.reconcileAll(local);
      expect(outcomes.map((o) => o.result.status)).toEqual([status, status]);
      const folded = foldOutcomes(local, outcomes);
      expect(folded.next).toBe(local);
      expect(folded.failed).toBe(false);
    }
  });

  it("never rejects: a throwing client resolves to an error outcome for every slot", async () => {
    const { saves, reconcile } = fakeSaves();
    const sync = createCloudSync({ saves, enabled: true, onUseCloud: vi.fn() });
    const local = defaultSaveState();
    reconcile.mockRejectedValue(new Error("boom"));
    const outcomes = await sync.reconcileAll(local);
    expect(outcomes.map((o) => o.slot)).toEqual(["campaign", "settings"]);
    for (const outcome of outcomes) {
      expect(outcome.result).toEqual({ status: "error", error: { code: "network", message: "boom" } });
    }
    expect(foldOutcomes(local, outcomes).failed).toBe(true);
  });

  it("stores only changed slots and applies a use_cloud answer through onUseCloud", async () => {
    const { saves, store } = fakeSaves();
    const onUseCloud = vi.fn();
    const sync = createCloudSync({ saves, enabled: true, onUseCloud });
    const before = defaultSaveState();
    const after = { ...before, coins: 5 };
    const cloudCampaign = { ...toCampaignPayload(before), coins: 77 };
    store.mockResolvedValueOnce({ status: "use_cloud", save: cloudSave(cloudCampaign, 3) });
    sync.storeChanges(before, after);
    await tick();
    expect(store).toHaveBeenCalledTimes(1);
    expect(store.mock.calls[0]).toEqual(["campaign", toCampaignPayload(after)]);
    expect(onUseCloud).toHaveBeenCalledWith("campaign", cloudCampaign);
  });

  it("never stores a skipped slot, even when it changed", async () => {
    const { saves, store } = fakeSaves();
    const sync = createCloudSync({ saves, enabled: true, onUseCloud: vi.fn() });
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
    const disabled = createCloudSync({ saves, enabled: false, onUseCloud: vi.fn() });
    expect(await disabled.reconcileAll(local)).toEqual([]);
    disabled.storeChanges(null, local);
    const none = createCloudSync({ saves: undefined, enabled: true, onUseCloud: vi.fn() });
    expect(await none.reconcileAll(local)).toEqual([]);
    none.storeChanges(null, local);
    await tick();
    expect(store).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });
});
