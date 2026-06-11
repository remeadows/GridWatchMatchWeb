import { describe, expect, it } from "vitest";

import { resolveImageAssetPath, webOverridePath } from "../data/assetOverrides";

describe("web image asset overrides", () => {
  it("prefers a matching web override path when it exists", () => {
    const path = "assets/images/tiles/tile_packet.png";

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
  });

  it("does not wrap an override path a second time", () => {
    const path = "assets/images/web-overrides/tiles/tile_key.png";

    expect(webOverridePath(path)).toBeNull();
    expect(resolveImageAssetPath(path, () => true)).toBe(path);
  });
});
