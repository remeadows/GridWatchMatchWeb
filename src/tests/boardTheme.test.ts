import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  matchV2Assets,
  matchV2CellAsset,
  matchV2PieceSizePx,
  matchV2TileAsset,
  resolveBoardPixelRatio,
  resolveBoardTheme
} from "../game/boardTheme";

describe("board theme selection", () => {
  it("keeps the build default unless the query asks for a theme", () => {
    expect(resolveBoardTheme("", "classic")).toBe("classic");
    expect(resolveBoardTheme("?level=3", "darkRealism")).toBe("darkRealism");
    expect(resolveBoardTheme("?theme=dark", "classic")).toBe("darkRealism");
    expect(resolveBoardTheme("?theme=classic", "darkRealism")).toBe("classic");
    expect(resolveBoardTheme("?theme=nonsense", "classic")).toBe("classic");
  });

  it("draws device pixels only for the dark-realism board, capped at three", () => {
    expect(resolveBoardPixelRatio("", "classic", 3)).toBe(1);
    expect(resolveBoardPixelRatio("", "darkRealism", 2)).toBe(2);
    expect(resolveBoardPixelRatio("", "darkRealism", 4)).toBe(3);
    expect(resolveBoardPixelRatio("", "darkRealism", 0.5)).toBe(1);
    expect(resolveBoardPixelRatio("?hidpi=0", "darkRealism", 3)).toBe(1);
    expect(resolveBoardPixelRatio("?hidpi=1", "classic", 2)).toBe(2);
    expect(resolveBoardPixelRatio("", "darkRealism", Number.NaN)).toBe(1);
  });
});

describe("match v2 asset manifest", () => {
  it("lists only files that exist, byte for byte as exported", () => {
    expect(matchV2Assets.length).toBeGreaterThan(0);
    for (const asset of matchV2Assets) {
      const file = join(process.cwd(), "public", asset.path);
      expect(existsSync(file), asset.path).toBe(true);
      expect(createHash("sha256").update(readFileSync(file)).digest("hex"), asset.path).toBe(asset.sha256);
    }
  });

  it("maps game IDs to sprites without renaming them", () => {
    expect(matchV2TileAsset("packet")?.visualId).toBe("tile_route");
    expect(matchV2TileAsset("threat")?.visualId).toBe("tile_threat");
    expect(matchV2TileAsset("firewall")?.visualId).toBe("tile_defense");
    expect(matchV2TileAsset("key")?.visualId).toBe("tile_data");
    expect(matchV2TileAsset("zeroDay")?.visualId).toBe("tile_zeroday");
    expect(matchV2CellAsset("movable")?.visualId).toBe("cell_base");
    expect(matchV2CellAsset("held")?.visualId).toBe("cell_selected");
  });

  it("sizes a piece so its opaque body spans the asked fraction of the cell", () => {
    const route = matchV2TileAsset("packet")!;
    const [left, top, right, bottom] = route.opaqueBounds;
    const span = Math.max(right - left, bottom - top);
    expect(matchV2PieceSizePx(route, 100, 0.8) * span).toBeCloseTo(80, 5);
  });
});
