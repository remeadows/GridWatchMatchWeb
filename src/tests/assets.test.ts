import { describe, expect, it } from "vitest";

import { resolveImageAssetPath, webOverridePath } from "../data/assetOverrides";

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
