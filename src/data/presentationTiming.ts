export const DRAG_LIFT_MS = 65;
export const SWAP_TRAVEL_MS = 160;
export const SWAP_SETTLE_MS = 50;
export const MATCH_RECOGNITION_HOLD_MS = 45;
export const MATCH_POP_COMPRESSION_MS = 40;
export const MATCH_IMPACT_MS = 100;
export const MATCH_AFTERIMAGE_MS = 70;
export const MATCH_COLORED_DEBRIS_COUNT = 7;
export const MATCH_SMOKE_PUFF_COUNT = 1;
export const MATCH_DEBRIS_LIFESPAN_MS = 320;
export const MATCH_DEBRIS_CLEANUP_MS = 400;
export const MATCH_SHAKE_WEAK_THRESHOLD_TILES = 4;
export const MATCH_SHAKE_STRONG_THRESHOLD_TILES = 5;
export const MATCH_SHAKE_WEAK_INTENSITY = 0.004;
export const MATCH_SHAKE_STRONG_INTENSITY = 0.006;
export const MATCH_SHAKE_DURATION_MS = 130;
export const TNT_ARM_AT_MS = 0;
export const TNT_CHARGE_AT_MS = 90;
export const TNT_DETONATION_AT_MS = 140;
export const TNT_RADIAL_IMPACT_STAGGER_MS = 24;
export const TNT_RADIAL_IMPACT_MAX_MS = 96;
export const TNT_CASCADE_AFTER_DETONATION_MS = 170;
export const TNT_SEQUENCE_BUDGET_MS = 800;
export const MATCH_WAVE_PER_GRID_MS = 18;
export const MATCH_WAVE_MAX_MS = 64;
export const CASCADE_START_AFTER_IMPACT_MS = 100;
export const CASCADE_FALL_BASE_MS = 120;
export const CASCADE_FALL_PER_CELL_MS = 45;
export const CASCADE_FALL_MIN_MS = 165;
export const CASCADE_FALL_MAX_MS = 320;
export const CASCADE_LANDING_SQUASH_MS = 50;
export const CASCADE_LANDING_SETTLE_MS = 50;
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
  afterimageMs: MATCH_AFTERIMAGE_MS,
  debrisCleanupMs: MATCH_DEBRIS_CLEANUP_MS,
  matchWavePerGridMs: MATCH_WAVE_PER_GRID_MS,
  matchWaveMaxMs: MATCH_WAVE_MAX_MS,
  cascadeStartAfterImpactMs: CASCADE_START_AFTER_IMPACT_MS,
  cascadeLandingSquashMs: CASCADE_LANDING_SQUASH_MS,
  cascadeLandingSettleMs: CASCADE_LANDING_SETTLE_MS
} as const;
