import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { presentationAudioUrl } from "../data/assets";
import { resolveImageAssetPath, webAudioOverridePath, webOverridePath } from "../data/assetOverrides";
import { presentationAudioManifest } from "../data/presentationAssets";

describe("web image asset overrides", () => {
  it("prefers a matching web override path when it exists", () => {
    const path = "assets/images/tiles/tile_packet.png";

    expect(resolveImageAssetPath(path, (candidate) => candidate === "assets/images/web-overrides/tiles/tile_packet.png")).toBe(
      "assets/images/web-overrides/tiles/tile_packet.png"
    );
  });

  it("normalizes whitespace and leading slashes before resolving overrides", () => {
    const path = " ///assets/images/tiles/tile_packet.png ";

    expect(webOverridePath(path)).toBe("assets/images/web-overrides/tiles/tile_packet.png");
    expect(resolveImageAssetPath(path, (candidate) => candidate === "assets/images/web-overrides/tiles/tile_packet.png")).toBe(
      "assets/images/web-overrides/tiles/tile_packet.png"
    );
  });

  it("falls back to the synced image when no override exists", () => {
    const path = "assets/images/powerups/powerup_tnt.png";

    expect(resolveImageAssetPath(path, () => false)).toBe(path);
  });

  it("ignores paths outside the image manifest", () => {
    const path = "assets/audio/sfx_power_up.mp3";

    expect(webOverridePath(path)).toBeNull();
    expect(resolveImageAssetPath(path, () => true)).toBe(path);
    expect(webOverridePath("//assets/audio/sfx_power_up.mp3")).toBeNull();
  });

  it("does not wrap an override path a second time", () => {
    const path = "assets/images/web-overrides/tiles/tile_key.png";

    expect(webOverridePath(path)).toBeNull();
    expect(resolveImageAssetPath(path, () => true)).toBe(path);
  });

  it("ignores empty and bare image prefix paths", () => {
    expect(webOverridePath("")).toBeNull();
    expect(resolveImageAssetPath("", () => true)).toBe("");
    expect(webOverridePath("assets/images/")).toBeNull();
    expect(resolveImageAssetPath("assets/images/", () => true)).toBe("assets/images/");
  });
});

describe("web audio asset overrides", () => {
  it("maps a board sound filename into the web-owned audio override root", () => {
    expect(webAudioOverridePath("tile_pop_a.mp3")).toBe("assets/audio/web-overrides/tile_pop_a.mp3");
  });

  it("normalizes whitespace and leading slashes without rewrapping overrides", () => {
    expect(webAudioOverridePath(" ///tile_pop_a.mp3 ")).toBe("assets/audio/web-overrides/tile_pop_a.mp3");
    expect(webAudioOverridePath("assets/audio/web-overrides/tile_pop_a.mp3")).toBeNull();
  });

  it("keeps empty paths empty", () => {
    expect(webAudioOverridePath("")).toBeNull();
    expect(webAudioOverridePath("   ")).toBeNull();
  });

  it("keeps every presentation sound under the audio override root with no duplicate files", () => {
    const paths = Object.values(presentationAudioManifest);

    expect(paths.every((path) => path.startsWith("assets/audio/web-overrides/"))).toBe(true);
    expect(new Set(paths).size).toBe(paths.length);
    expect(presentationAudioUrl("tilePopA")).toContain("assets/audio/web-overrides/tile_pop_a.mp3");
  });
});

const approvedPieceOverridePaths = [
  "tiles/tile_packet.png",
  "tiles/tile_firewall.png",
  "tiles/tile_key.png",
  "tiles/tile_threat.png",
  "tiles/tile_zeroday.png",
  "powerups/powerup_rocket_h.png",
  "powerups/powerup_rocket_v.png",
  "powerups/powerup_propeller.png",
  "powerups/powerup_tnt.png",
  "powerups/powerup_lightball.png",
  "boosters/booster_rocket_h.png",
  "boosters/booster_rocket_v.png",
  "boosters/booster_propeller.png",
  "boosters/booster_tnt.png",
  "boosters/booster_lightball.png"
] as const;

describe("approved GridWatch piece overrides", () => {
  it("contains every tile, power-up, and booster override within the file-size budget", () => {
    const overrideRoot = path.resolve(process.cwd(), "public/assets/images/web-overrides");

    for (const relativePath of approvedPieceOverridePaths) {
      const assetPath = path.join(overrideRoot, relativePath);
      expect(existsSync(assetPath), `missing approved override ${relativePath}`).toBe(true);
      expect(statSync(assetPath).size, `${relativePath} must not be empty`).toBeGreaterThan(0);
      expect(statSync(assetPath).size, `${relativePath} exceeds 700 KB`).toBeLessThanOrEqual(700 * 1024);
    }
  });
});
