import { describe, expect, it, vi } from "vitest";
import type { SavesClient } from "@gridwatch/account-kit";
import { createCloudSync } from "../services/cloudSync";
import { toCampaignPayload, toSettingsPayload } from "../state/cloudSaves";
import { defaultSaveState } from "../state/save";

function fakeSaves() {
  const reconcile = vi.fn<SavesClient["reconcile"]>(async () => ({ status: "current" }));
  const store = vi.fn<SavesClient["store"]>(async () => ({ status: "stored", revision: 1, updatedAt: "t" }));
  const saves = { game: { gameSlug: "gridwatch-match", routeAlias: "match", slots: ["campaign", "settings"], schemaVersion: 1 }, load: vi.fn(), store, reconcile, dispose: vi.fn() } as unknown as SavesClient;
  return { saves, reconcile, store };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createCloudSync", () => {
  it("reconciles both slots concurrently and folds cloud results into the state", async () => {
    const { saves, reconcile } = fakeSaves();
    const cloudCampaign = { ...toCampaignPayload(defaultSaveState()), coins: 99 };
    reconcile.mockImplementation(async (slot) => slot === "campaign"
      ? { status: "use_cloud", save: { revision: 2, schemaVersion: 1, payload: cloudCampaign, updatedAt: "t" } }
      : { status: "fresh" });
    const sync = createCloudSync({ saves, enabled: true, onUseCloud: vi.fn() });
    const local = defaultSaveState();
    local.settings.musicEnabled = false;
    const result = await sync.reconcileAll(local);
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(reconcile.mock.calls.map((c) => c[0])).toEqual(["campaign", "settings"]);
    expect(reconcile.mock.calls[0][1]).toEqual(toCampaignPayload(local));
    expect(reconcile.mock.calls[1][1]).toEqual(toSettingsPayload(local));
    expect(result.coins).toBe(99);
    expect(result.settings.musicEnabled).toBe(true); // "Start fresh" on settings → defaults
  });
  it("returns the input untouched for current/nothing/signed_out/uploaded/error", async () => {
    const { saves, reconcile } = fakeSaves();
    const sync = createCloudSync({ saves, enabled: true, onUseCloud: vi.fn() });
    const local = defaultSaveState();
    for (const status of ["current", "nothing", "signed_out"] as const) {
      reconcile.mockResolvedValue({ status });
      expect(await sync.reconcileAll(local)).toBe(local);
    }
    reconcile.mockResolvedValue({ status: "error", error: { code: "network", message: "x" } });
    expect(await sync.reconcileAll(local)).toBe(local);
    reconcile.mockRejectedValue(new Error("boom"));
    expect(await sync.reconcileAll(local)).toBe(local);
  });
  it("stores only changed slots and applies a use_cloud answer through onUseCloud", async () => {
    const { saves, store } = fakeSaves();
    const onUseCloud = vi.fn();
    const sync = createCloudSync({ saves, enabled: true, onUseCloud });
    const before = defaultSaveState();
    const after = { ...before, coins: 5 };
    const cloudCampaign = { ...toCampaignPayload(before), coins: 77 };
    store.mockResolvedValueOnce({ status: "use_cloud", save: { revision: 3, schemaVersion: 1, payload: cloudCampaign, updatedAt: "t" } });
    sync.storeChanges(before, after);
    await tick();
    expect(store).toHaveBeenCalledTimes(1);
    expect(store.mock.calls[0]).toEqual(["campaign", toCampaignPayload(after)]);
    expect(onUseCloud).toHaveBeenCalledWith("campaign", cloudCampaign);
  });
  it("does nothing when disabled or without a saves client", async () => {
    const { saves, store, reconcile } = fakeSaves();
    const local = defaultSaveState();
    const disabled = createCloudSync({ saves, enabled: false, onUseCloud: vi.fn() });
    expect(await disabled.reconcileAll(local)).toBe(local);
    disabled.storeChanges(null, local);
    const none = createCloudSync({ saves: undefined, enabled: true, onUseCloud: vi.fn() });
    expect(await none.reconcileAll(local)).toBe(local);
    none.storeChanges(null, local);
    await tick();
    expect(store).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });
});
