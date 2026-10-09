// Both are set only by `npm run cf:dev-instance` (scripts/dev-instance.mjs); unset in production and in tests.

/** True in a build made for the dev instance (gridwatch-match-dev): a static host with no `/api/*`. */
export const isDevInstance = import.meta.env.VITE_DEV_INSTANCE === "1";

/** The build's commit, e.g. `3fe1f5a-dev`; holds `-dirty` when the build was not a commit. */
export const buildLabel = import.meta.env.VITE_BUILD_LABEL ?? "";
