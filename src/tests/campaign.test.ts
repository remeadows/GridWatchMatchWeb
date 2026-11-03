import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { areas, campaignLevelCount } from "../data/areas";
import { intelFiles } from "../data/intel";
import { assetManifest } from "../data/assetManifest.generated";
import { validateSubmission } from "../../worker/validation";

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
