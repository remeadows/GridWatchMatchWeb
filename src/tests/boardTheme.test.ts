import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  boardTileSize,
  matchV2Assets,
  matchV2BoardPartAsset,
  matchV2BoosterAsset,
  matchV2CellAsset,
  matchV2FrameSlices,
  matchV2PieceSizePx,
  matchV2PowerUpAsset,
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
    expect(matchV2PowerUpAsset("rocket_horizontal")?.visualId).toBe("powerup_rocket_h");
    expect(matchV2PowerUpAsset("rocket_vertical")?.visualId).toBe("powerup_rocket_v");
    expect(matchV2PowerUpAsset("tnt")?.visualId).toBe("powerup_tnt");
    expect(matchV2PowerUpAsset("propeller")?.visualId).toBe("powerup_propeller");
    expect(matchV2PowerUpAsset("lightBall")?.visualId).toBe("powerup_light_ball");
    expect(matchV2BoosterAsset("rocket")?.visualId).toBe("powerup_rocket_h");
    expect(matchV2BoosterAsset("rocketVertical")?.visualId).toBe("powerup_rocket_v");
    expect(matchV2BoosterAsset("lightBall")?.visualId).toBe("powerup_light_ball");
    expect(matchV2CellAsset("movable")?.visualId).toBe("cell_base");
    expect(matchV2CellAsset("held")?.visualId).toBe("cell_selected");
    expect(matchV2CellAsset("blocked")?.visualId).toBe("cell_blocked");
    expect(matchV2BoardPartAsset("cell:locked")?.visualId).toBe("cell_lock");
    expect(matchV2BoardPartAsset("overlay:encryptedVolume")?.visualId).toBe("cell_encrypted");
    expect(matchV2BoardPartAsset("underlay:malwarePropagation")?.visualId).toBe("cell_malware");
    expect(matchV2BoardPartAsset("generator:honeypot")?.visualId).toBe("cell_generator");
    expect(matchV2BoardPartAsset("board:frame")?.visualId).toBe("board_frame");
  });

  it("keeps the sprites that register on the grid exactly one cell wide", () => {
    for (const asset of matchV2Assets.filter((candidate) => candidate.type === "cell")) {
      expect(asset.opaqueBounds, asset.visualId).toEqual([0, 0, 1, 1]);
    }
  });

  it("cuts the board frame into corners and one-cell edge lengths", () => {
    const frame = matchV2BoardPartAsset("board:frame")!;
    const slices = matchV2FrameSlices(frame)!;
    expect(slices.border * 2 + slices.cell).toBe(frame.width);
    expect(slices.border / slices.cell).toBeCloseTo(frame.frameBorder!, 5);
    expect(matchV2FrameSlices(matchV2CellAsset("movable")!)).toBeNull();
  });
});

describe("board sizing", () => {
  it("is the classic sizing with a 12 px margin and no frame", () => {
    expect(boardTileSize(720, 720, 7, 7, 12, 0)).toBe(Math.floor(696 / 7));
    expect(boardTileSize(390, 600, 9, 7, 12, 0)).toBe(Math.floor(366 / 9));
    expect(boardTileSize(100, 100, 9, 9, 12, 0)).toBe(32);
  });

  it("leaves room for the frame inside the canvas", () => {
    const tile = boardTileSize(1170, 1170, 7, 7, 12, 0.1875);
    expect(tile * (7 + 2 * 0.1875) + 24).toBeLessThanOrEqual(1170);
    expect(boardTileSize(1170, 1170, 7, 7, 12, 0.1875)).toBeLessThan(boardTileSize(1170, 1170, 7, 7, 12, 0));
  });

  it("sizes a piece so its opaque body spans the asked fraction of the cell", () => {
    const route = matchV2TileAsset("packet")!;
    const [left, top, right, bottom] = route.opaqueBounds;
    const span = Math.max(right - left, bottom - top);
    expect(matchV2PieceSizePx(route, 100, 0.8) * span).toBeCloseTo(80, 5);
  });
});
