export const DRAG_LIFT_MS = 65;
export const SWAP_TRAVEL_MS = 160;
export const SWAP_SETTLE_MS = 50;
export const MATCH_RECOGNITION_HOLD_MS = 55;
export const MATCH_POP_COMPRESSION_MS = 45;
export const MATCH_IMPACT_MS = 120;
export const MATCH_WAVE_PER_GRID_MS = 18;
export const MATCH_WAVE_MAX_MS = 64;
export const CASCADE_START_AFTER_IMPACT_MS = 110;
export const CASCADE_FALL_BASE_MS = 120;
export const CASCADE_FALL_PER_CELL_MS = 45;
export const CASCADE_FALL_MIN_MS = 165;
export const CASCADE_FALL_MAX_MS = 320;
export const CASCADE_LANDING_SETTLE_MS = 100;
export const CHAIN_PLAYBACK_RATE_STEP = 0.035;
export const CHAIN_PLAYBACK_RATE_MAX_DEPTH = 5;
export const TILE_POP_PLAYBACK_RATE_MIN = 0.94;
export const TILE_POP_PLAYBACK_RATE_MAX = 1.06;

export const PRESENTATION_TIMING = {
  dragLiftMs: DRAG_LIFT_MS,
  swapTravelMs: SWAP_TRAVEL_MS,
  swapSettleMs: SWAP_SETTLE_MS,
  recognitionHoldMs: MATCH_RECOGNITION_HOLD_MS,
  popCompressionMs: MATCH_POP_COMPRESSION_MS,
  impactMs: MATCH_IMPACT_MS,
  matchWavePerGridMs: MATCH_WAVE_PER_GRID_MS,
  matchWaveMaxMs: MATCH_WAVE_MAX_MS,
  cascadeStartAfterImpactMs: CASCADE_START_AFTER_IMPACT_MS,
  cascadeLandingSettleMs: CASCADE_LANDING_SETTLE_MS
} as const;
