import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { areas, campaignLevelCount } from "../data/areas";
import { intelFiles } from "../data/intel";
import { assetManifest } from "../data/assetManifest.generated";
import { moveLimitFor, starsFor, validateSubmission } from "../../worker/validation";
import { currentArea } from "../state/progress";
import { defaultSaveState, normalizeSave } from "../state/save";

describe("campaign length", () => {
  it("takes campaign length from the last sector", () => {
    expect(campaignLevelCount).toBe(areas[areas.length - 1].lastLevel);
  });

  it("rejects a level past the end of the campaign", () => {
    const result = validateSubmission({ levelId: campaignLevelCount + 1 });
    expect(result).toEqual({ ok: false, error: "Unknown level." });
  });
});

describe("villains", () => {
  it("gives sectors 5, 7, 8, 9 and 10 the new villains", () => {
    const byId = Object.fromEntries(areas.map((a) => [a.id, a.villainName]));
    expect([byId[5], byId[7], byId[8], byId[9], byId[10]]).toEqual(["DREAD", "VYRUS", "SHARD", "LOTUS", "MALUS"]);
  });

  it("keeps no team member in a dossier", () => {
    const names = intelFiles.map((file) => file.codename);
    for (const team of ["RUSTY", "TEE", "TISH", "HELIX", "AX-10M2"]) expect(names).not.toContain(team);
  });

  it("has a portrait file on disk for every sector villain", () => {
    for (const area of areas) {
      const path = (assetManifest.images.villains as Record<string, string>)[area.villainKey];
      expect(path, `manifest entry for ${area.villainKey}`).toBeTruthy();
      expect(existsSync(join(process.cwd(), "public", path)), path).toBe(true);
    }
  });
});

describe("the campaign of 200", () => {
  const second = areas.slice(10);

  it("has 200 levels in 20 sectors", () => {
    expect(areas).toHaveLength(20);
    expect(campaignLevelCount).toBe(200);
    areas.forEach((area, index) => {
      expect(area.id).toBe(index + 1);
      expect(area.firstLevel).toBe(index * 10 + 1);
      expect(area.lastLevel).toBe(index * 10 + 10);
    });
  });

  it("sectors 11 to 20 repeat the first ten villains in order", () => {
    expect(second.map((a) => a.villainKey)).toEqual(areas.slice(0, 10).map((a) => a.villainKey));
    expect(second.map((a) => a.villainName)).toEqual(areas.slice(0, 10).map((a) => a.villainName));
  });

  it("pays 1,100 to 2,000 and reuses the first tour's accent, icon and theme", () => {
    second.forEach((area, index) => {
      const first = areas[index];
      expect(area.completionReward).toBe(1100 + index * 100);
      expect(area.accent).toBe(first.accent);
      expect(area.icon).toBe(first.icon);
      expect(area.theme).toBe(first.theme);
    });
  });

  it("names the second tour as the spec does", () => {
    expect(second.map((a) => [a.name, a.subtitle])).toEqual([
      ["Perimeter Defense II", "VEXIS returns"],
      ["Threat Intelligence II", "KRON returns"],
      ["Incident Response II", "ZERO returns"],
      ["SOC Operations II", "AX-10M returns"],
      ["Zero-Day Defense II", "DREAD returns"],
      ["AI Counterattack II", "AURORA-6 returns"],
      ["Firmware Purge II", "VYRUS returns"],
      ["Protocol Override II", "SHARD returns"],
      ["Deep Net Sweep II", "LOTUS returns"],
      ["Final Breach II", "MALUS returns"]
    ]);
  });

  it("levels 1 to 10 are byte-identical to the frozen copies", () => {
    for (let id = 1; id <= 10; id++) {
      const name = `level_${String(id).padStart(3, "0")}.json`;
      const live = readFileSync(join(process.cwd(), "public", "levels", name));
      const frozen = readFileSync(join(process.cwd(), "src", "tests", "fixtures", "resolution", "levels", name));
      expect(live.equals(frozen), name).toBe(true);
    }
  });

  it("the server accepts a win on level 150", () => {
    const limit = moveLimitFor(150);
    expect(limit).not.toBeNull();
    const moveCount = limit! - 1;
    const result = validateSubmission({
      levelId: 150,
      telemetry: { tilesCleared: 60, powerUpEvents: 2, chainSum: 4, moveCount, stars: starsFor(moveCount, limit!, 150), playOnUsed: false },
      actionLog: [{ kind: "swap" }]
    });
    expect(result.ok).toBe(true);
  });

  it("an old save keeps its progress and is offered level 101", () => {
    const levels: Record<string, { stars: number; score: number; completedAt: string }> = {};
    for (let id = 1; id <= 100; id++) levels[String(id)] = { stars: 1, score: 1000, completedAt: "2026-01-01T00:00:00.000Z" };
    const old = { ...defaultSaveState(), levels } as Partial<ReturnType<typeof defaultSaveState>>;
    delete old.blockerIntrosSeen;
    const save = normalizeSave(old);
    expect(Object.keys(save.levels)).toHaveLength(100);
    expect(currentArea(save).id).toBe(11);
  });
});
