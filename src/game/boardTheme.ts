import manifestJson from "../data/matchV2Manifest.generated.json";
import type { BoosterType, TileType } from "../engine/types";
import { defaultBoardTheme } from "../services/buildInfo";

// The one selection point between the game's look, the Blender-built dark-realism set
// ("darkRealism", art/gridwatch-match), and the archived art it replaced ("classic"). Dark realism
// is what every build shows (Russ, 2026-10-10); classic is kept as a hidden fallback, reached only
// by `?theme=classic` or a build made with VITE_BOARD_THEME=classic, so rolling back is a query
// parameter or one build setting. A theme only swaps pictures: it never touches engine IDs, rules,
// timing or saved data.
export type BoardThemeId = "classic" | "darkRealism";

export interface MatchV2Asset {
  visualId: string;
  /** The game's own ID for what this pictures: a TileType, or `cell:<state>`. */
  runtimeId: string;
  type: string;
  path: string;
  width: number;
  height: number;
  sha256: string;
  /** Opaque extent as fractions of the frame: left, top, right, bottom. */
  opaqueBounds: number[];
  /** The board frame only: its width in cells. The sprite is that border round one cell. */
  frameBorder?: number;
}

export const matchV2Assets: readonly MatchV2Asset[] = manifestJson.assets;

/** The theme this page load uses: the board, the canvas resolution and the UI all read this. */
export function activeBoardTheme(): BoardThemeId {
  return resolveBoardTheme(typeof window === "undefined" ? "" : window.location.search, defaultBoardTheme);
}

export function resolveBoardTheme(search: string, buildDefault: BoardThemeId): BoardThemeId {
  const requested = new URLSearchParams(search).get("theme");
  if (requested === "classic") return "classic";
  if (requested === "dark" || requested === "darkRealism") return "darkRealism";
  return buildDefault;
}

/**
 * How many canvas pixels to draw per CSS pixel. The classic board draws one (its canvas is the
 * CSS size, which a phone then stretches about three times); the dark-realism art carries detail
 * that needs the real pixels. `?hidpi=0` / `?hidpi=1` overrides for a side-by-side comparison.
 * Capped at 3: past that the fill-rate cost buys nothing visible.
 */
export function resolveBoardPixelRatio(search: string, theme: BoardThemeId, devicePixelRatio: number): number {
  const requested = new URLSearchParams(search).get("hidpi");
  const enabled = requested === "1" || (requested !== "0" && theme === "darkRealism");
  if (!enabled || !Number.isFinite(devicePixelRatio)) return 1;
  return Math.min(3, Math.max(1, devicePixelRatio));
}

export function matchV2TextureKey(visualId: string): string {
  return `v2-${visualId}`;
}

function assetFor(runtimeId: string): MatchV2Asset | undefined {
  return matchV2Assets.find((asset) => asset.runtimeId === runtimeId);
}

/** The dark-realism sprite for a tile, or undefined while that tile has none yet. */
export function matchV2TileAsset(tile: TileType): MatchV2Asset | undefined {
  const asset = assetFor(tile);
  return asset?.type === "tile" ? asset : undefined;
}

export type MatchV2PowerUpId = "rocket_horizontal" | "rocket_vertical" | "propeller" | "tnt" | "lightBall";

export function matchV2PowerUpAsset(powerUp: MatchV2PowerUpId): MatchV2Asset | undefined {
  return assetFor(`powerup:${powerUp}`);
}

/** The booster tray shows the same pieces the board does. */
export function matchV2BoosterAsset(booster: BoosterType): MatchV2Asset | undefined {
  const powerUp: MatchV2PowerUpId = booster === "rocket" ? "rocket_horizontal" : booster === "rocketVertical" ? "rocket_vertical" : booster;
  return matchV2PowerUpAsset(powerUp);
}

export type MatchV2CellState = "movable" | "held" | "blocked";

export function matchV2CellAsset(state: MatchV2CellState): MatchV2Asset | undefined {
  return assetFor(`cell:${state}`);
}

/**
 * The other things a cell can carry, by the engine's own names: a design-locked tile's clamps,
 * the `encryptedVolume` overlay, the socket under a `malwarePropagation` underlay, the `honeypot`
 * generator, and the frame round the whole board.
 */
export type MatchV2BoardPart =
  | "cell:locked"
  | "overlay:encryptedVolume"
  | "underlay:malwarePropagation"
  | "generator:honeypot"
  | "board:frame";

export function matchV2BoardPartAsset(part: MatchV2BoardPart): MatchV2Asset | undefined {
  return assetFor(part);
}

/**
 * Where to cut the frame sprite, in its own pixels. It is a border of `frameBorder` cells round a
 * one-cell opening, so it yields four corners and four one-cell edge lengths that are laid round
 * a board of any size.
 */
export function matchV2FrameSlices(asset: MatchV2Asset): { border: number; cell: number } | null {
  const border = asset.frameBorder;
  if (!border || border <= 0) return null;
  const borderPx = Math.round((asset.width * border) / (1 + 2 * border));
  const cellPx = asset.width - 2 * borderPx;
  return borderPx > 0 && cellPx > 0 ? { border: borderPx, cell: cellPx } : null;
}

/**
 * Cell size for a canvas. `margin` is the clear space kept outside the board on each side, and
 * `frameBorder` the frame's width in cells (0 without one), so the frame is always inside the
 * canvas. With a 12 px margin and no frame this is the classic board's own sizing.
 */
export function boardTileSize(width: number, height: number, rows: number, cols: number, margin: number, frameBorder: number): number {
  const room = Math.min(width, height) - 2 * margin;
  return Math.max(32, Math.floor(room / (Math.max(rows, cols) + 2 * frameBorder)));
}

/**
 * How large to draw a piece sprite so its opaque body spans `bodyFraction` of the cell. The
 * renders keep padding around the body, and the padding differs from the classic art's.
 */
export function matchV2PieceSizePx(asset: MatchV2Asset, tileSize: number, bodyFraction = 0.82): number {
  const [left, top, right, bottom] = asset.opaqueBounds;
  const span = Math.max(right - left, bottom - top);
  return span > 0 ? (tileSize * bodyFraction) / span : tileSize * bodyFraction;
}

export const darkRealismChrome = {
  boardFill: 0x06080a,
  boardFillAlpha: 0.98,
  boardStroke: 0x3b424b,
  boardStrokeAlpha: 0.7,
  blockedCell: 0x0a0c0f,
  blockedCellAlpha: 0.96,
  blockedStroke: 0x2a3038,
  blockedStrokeAlpha: 0.8
} as const;
