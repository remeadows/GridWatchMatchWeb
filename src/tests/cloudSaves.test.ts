import { describe, expect, it } from "vitest";
import { applyCloudPayload, changedSlots, cloudSavesEnabled, freshSlot, isPristine, projection, toCampaignPayload, toSettingsPayload } from "../state/cloudSaves";
import { defaultSaveState, type SaveState } from "../state/save";

function played(): SaveState {
  const save = defaultSaveState();
  save.coins = 40;
  save.levels["1"] = { stars: 3, score: 900, completedAt: "2026-09-17T00:00:00.000Z" };
  save.settings.musicEnabled = false;
  return save;
}

describe("slot projections", () => {
  it("splits SaveState into campaign (no version, no settings) and settings", () => {
    const save = played();
    const campaign = toCampaignPayload(save);
    expect(campaign).not.toHaveProperty("version");
    expect(campaign).not.toHaveProperty("settings");
    expect(campaign.coins).toBe(40);
    expect(campaign.levels["1"].stars).toBe(3);
    expect(toSettingsPayload(save)).toEqual({ musicEnabled: false, sfxEnabled: true, voiceEnabled: true, reducedMotion: false });
    expect(projection(save, "campaign")).toEqual(campaign);
    expect(projection(save, "settings")).toEqual(toSettingsPayload(save));
  });
  it("applies a cloud payload through normalizeSave, keeping the other slot", () => {
    const local = played();
    const merged = applyCloudPayload(local, "campaign", { ...toCampaignPayload(defaultSaveState()), coins: 7, selectedHeroId: "vera" });
    expect(merged.version).toBe(1);
    expect(merged.coins).toBe(7);
    expect(merged.selectedHeroId).toBe("vera");
    expect(merged.levels).toEqual({});
    expect(merged.settings.musicEnabled).toBe(false);          // settings untouched
    expect(merged.boosters.rocket).toBe(3);                    // defaults filled in
    const withSettings = applyCloudPayload(local, "settings", { musicEnabled: true, sfxEnabled: false, voiceEnabled: true, reducedMotion: true });
    expect(withSettings.settings).toEqual({ musicEnabled: true, sfxEnabled: false, voiceEnabled: true, reducedMotion: true });
    expect(withSettings.coins).toBe(40);
  });
  it("tolerates junk from the cloud by falling back to defaults", () => {
    const merged = applyCloudPayload(played(), "campaign", { coins: "lots", levels: null } as unknown);
    expect(merged.coins).toBe("lots" as unknown as number); // normalizeSave does not type-check scalars (unchanged behaviour); the server schema is the guard
    expect(merged.levels).toEqual({});
  });
  it("resets one slot to defaults with freshSlot", () => {
    const fresh = freshSlot(played(), "campaign");
    expect(fresh.coins).toBe(0);
    expect(fresh.levels).toEqual({});
    expect(fresh.settings.musicEnabled).toBe(false);
    expect(freshSlot(played(), "settings").settings).toEqual(defaultSaveState().settings);
  });
  it("reports which slots changed", () => {
    const a = played();
    const b = { ...a, coins: 41 };
    const c = { ...a, settings: { ...a.settings, sfxEnabled: false } };
    expect(changedSlots(null, a)).toEqual(["campaign", "settings"]);
    expect(changedSlots(a, a)).toEqual([]);
    expect(changedSlots(a, b)).toEqual(["campaign"]);
    expect(changedSlots(a, c)).toEqual(["settings"]);
  });
  it("is enabled only on the Nexus origin", () => {
    expect(cloudSavesEnabled("https://nexus.warsignallabs.net", "https://nexus.warsignallabs.net")).toBe(true);
    expect(cloudSavesEnabled("https://gridwatchmatchweb.warsignallabs.net", "https://nexus.warsignallabs.net")).toBe(false);
    expect(cloudSavesEnabled("http://127.0.0.1:4173", "http://127.0.0.1:4173")).toBe(true);
  });
  it("treats a bit-for-bit default projection as pristine (no local save to protect)", () => {
    const defaults = defaultSaveState();
    expect(isPristine(defaults, "campaign")).toBe(true);
    expect(isPristine(defaults, "settings")).toBe(true);

    const withCoins = { ...defaultSaveState(), coins: 1 };
    expect(isPristine(withCoins, "campaign")).toBe(false);
    expect(isPristine(withCoins, "settings")).toBe(true); // settings untouched

    const toggled = defaultSaveState();
    toggled.settings.musicEnabled = false;
    expect(isPristine(toggled, "settings")).toBe(false);
    expect(isPristine(toggled, "campaign")).toBe(true); // campaign untouched
  });
});
