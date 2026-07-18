// Headroom over the nominal ~400ms swap->pop animation chain: on a loaded
// machine the browser event loop can delay each hop by over a second. A
// passing test still resolves as soon as the counter increments; only genuine
// failures (which never increment) pay the full wait.
export const GAMEPLAY_POLL_TIMEOUT_MS: number = 5_000;
export const BOARD_READY_TIMEOUT_MS: number = 5_000;
export const WIN_SEQUENCE_LEAD_IN_MS: number = 240;
export const WIN_ROW_DESTRUCTION_STAGGER_MS: number = 270;
export const WIN_ROW_DESTRUCTION_POP_MS: number = 560;
export const WIN_SEQUENCE_FINAL_HOLD_MS: number = 320;
