// The first two are set only by `npm run cf:dev-instance` (scripts/dev-instance.mjs); unset in production and in tests.

/** True in a build made for the dev instance (gridwatch-match-dev): a static host with no `/api/*`. */
export const isDevInstance = import.meta.env.VITE_DEV_INSTANCE === "1";

/** The build's commit, e.g. `3fe1f5a-dev`; holds `-dirty` when the build was not a commit. */
export const buildLabel = import.meta.env.VITE_BUILD_LABEL ?? "";

/**
 * The board art a build shows unless `?theme=` says otherwise (src/game/boardTheme.ts). Dark realism
 * is the game's look (Russ, 2026-10-10: "Dark theme becomes production. Old theme is to be
 * archived."); only a build made with VITE_BOARD_THEME=classic starts on the archived classic art.
 */
export function boardThemeForBuild(setting: string | undefined): "classic" | "darkRealism" {
  return setting === "classic" ? "classic" : "darkRealism";
}

export const defaultBoardTheme = boardThemeForBuild(import.meta.env.VITE_BOARD_THEME);
