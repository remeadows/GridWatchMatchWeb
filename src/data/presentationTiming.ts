// Power-up timings below were shortened on 2026-10-09 at Russ's request ("Faster, less waiting"):
// rocket flight 420 -> 320, propeller flight 450 -> 340, the light ball's beats 120 -> 80 to 100,
// the hold before the board falls 200 -> 140, and each combo by about a fifth.
export const DRAG_LIFT_MS = 65;
export const SWAP_TRAVEL_MS = 175;
export const SWAP_SETTLE_MS = 60;
export const MATCH_RECOGNITION_HOLD_MS = 140;
export const CASCADE_RECOGNITION_HOLD_MS = 100;
export const MATCH_POP_COMPRESSION_MS = 100;
export const MATCH_IMPACT_MS = 180;
export const MATCH_AFTERIMAGE_MS = 130;
export const MATCH_OPEN_HOLD_MS = 130;
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
export const TNT_CASCADE_AFTER_DETONATION_MS = 140;
export const TNT_SEQUENCE_BUDGET_MS = 800;
export const ROCKET_IGNITION_MS = 75;
export const ROCKET_LANE_FLIGHT_MS = 320;
export const ROCKET_EFFECT_TAIL_MS = 280;
export const ROCKET_TRAIL_LIFESPAN_MS = 180;
export const ROCKET_TRAIL_CLEANUP_MS = 80;
export const ROCKET_EDGE_BURST_LIFESPAN_MS = 190;
export const PROPELLER_LIFT_MS = 105;
export const PROPELLER_FLIGHT_MS = 340;
export const PROPELLER_RETICLE_DELAY_MS = 70;
export const PROPELLER_SECONDARY_STAGGER_MS = 32;
export const PROPELLER_SEQUENCE_BUDGET_MS = 780;
export const LIGHTBALL_WAVE_CONCURRENCY_CAP = 3;
export const LIGHTBALL_WAVE_COUNT = 3;
export const LIGHTBALL_DIM_MS = 80;
export const LIGHTBALL_CHARGE_MS = 100;
export const LIGHTBALL_WAVE_STAGGER_MS = 90;
export const LIGHTBALL_RELEASE_DELAY_MS = 90;
export const LIGHTBALL_EFFECT_WAVE_STAGGER_COUNT = 4;
export const LIGHTBALL_EFFECT_RELEASE_DELAY_COUNT = 2;
export const COMBO_CHOREOGRAPHY_TIMING = {
  "rocket+rocket": { chargeMs: 190, impactMs: 400, cascadeMs: 720, batchCount: 4 },
  "propeller+rocket": { chargeMs: 200, impactMs: 520, cascadeMs: 840, batchCount: 3 },
  "rocket+tnt": { chargeMs: 220, impactMs: 520, cascadeMs: 840, batchCount: 2 },
  "lightBall+rocket": { chargeMs: 240, impactMs: 660, cascadeMs: 860, batchCount: 4 },
  "propeller+propeller": { chargeMs: 190, impactMs: 500, cascadeMs: 780, batchCount: 2 },
  "propeller+tnt": { chargeMs: 210, impactMs: 580, cascadeMs: 900, batchCount: 3 },
  "lightBall+propeller": { chargeMs: 240, impactMs: 670, cascadeMs: 900, batchCount: 4 },
  "tnt+tnt": { chargeMs: 220, impactMs: 480, cascadeMs: 840, batchCount: 4 },
  "lightBall+tnt": { chargeMs: 240, impactMs: 640, cascadeMs: 900, batchCount: 5 },
  "lightBall+lightBall": { chargeMs: 260, impactMs: 680, cascadeMs: 920, batchCount: 5 }
} as const;
export const COMBO_BATCH_PARTICLE_CAP = 120;
export const COMBO_ARC_CAP = 16;
export const COMBO_PROJECTILE_CAP = 12;
export const COMBO_CHOREOGRAPHY_MAX_MS = 920;
export const COMBO_BATCH_TAIL_MS = 150;
export const POWERUP_CASCADE_HOLD_MS = 140;
export const MATCH_WAVE_PER_GRID_MS = 25;
export const MATCH_WAVE_MAX_MS = 80;
export const CASCADE_START_AFTER_IMPACT_MS = 230;
// A piece falls under constant acceleration, so its fall time grows with the square root of the
// distance: CASCADE_FALL_ONE_CELL_MS for one cell, capped at CASCADE_FALL_MAX_MS.
export const CASCADE_FALL_ONE_CELL_MS = 250;
export const CASCADE_FALL_MIN_MS = 250;
export const CASCADE_FALL_MAX_MS = 540;
// Landing: squash against the floor of the cell, one small hop, settle. 190 ms in all.
export const CASCADE_LANDING_SQUASH_MS = 55;
export const CASCADE_LANDING_HOP_MS = 70;
export const CASCADE_LANDING_SETTLE_MS = 65;
export const CASCADE_LANDING_TOTAL_MS = CASCADE_LANDING_SQUASH_MS + CASCADE_LANDING_HOP_MS + CASCADE_LANDING_SETTLE_MS;
// How hard a landing is, by fall distance: a one-cell drop is light, this many cells is the hardest.
export const CASCADE_LANDING_FULL_STRENGTH_CELLS = 5;
export const CASCADE_LANDING_MIN_STRENGTH = 0.35;
export const CASCADE_LANDING_SQUASH_DEPTH = 0.16;
export const CASCADE_LANDING_SQUASH_SPREAD = 0.12;
export const CASCADE_LANDING_HOP_TILE_FRACTION = 0.05;
// The board takes a small downward knock when this much lands at once, or from this high.
export const CASCADE_JOLT_MIN_PIECES = 8;
export const CASCADE_JOLT_MIN_CELLS = 3;
export const CASCADE_JOLT_TILE_FRACTION = 0.035;
export const CASCADE_JOLT_DOWN_MS = 40;
export const CASCADE_JOLT_RECOVER_MS = 110;
// A power-up that hits something solid knocks the board in the direction it was going.
export const POWERUP_JOLT_TILE_FRACTION = 0.03;
// A TNT blast shoves the pieces round it outward; they spring back before the board falls.
export const TNT_SHOVE_REACH_CELLS = 3.6;
export const TNT_SHOVE_TILE_FRACTION = 0.12;
export const TNT_SHOVE_OUT_MS = 60;
export const TNT_SHOVE_BACK_MS = 110;
// A swapped piece is lifted off the board while it travels, and set down as it stops.
export const SWAP_LIFT_SCALE = 1.08;
export const SWAP_SET_DOWN_SQUASH = 0.05;
export const CHAIN_PLAYBACK_RATE_STEP = 0.035;
export const CHAIN_PLAYBACK_RATE_MAX_DEPTH = 5;
export const TILE_POP_PLAYBACK_RATE_MIN = 0.94;
export const TILE_POP_PLAYBACK_RATE_MAX = 1.06;

export const PRESENTATION_TIMING = {
  dragLiftMs: DRAG_LIFT_MS,
  swapTravelMs: SWAP_TRAVEL_MS,
  swapSettleMs: SWAP_SETTLE_MS,
  recognitionHoldMs: MATCH_RECOGNITION_HOLD_MS,
  cascadeRecognitionHoldMs: CASCADE_RECOGNITION_HOLD_MS,
  popCompressionMs: MATCH_POP_COMPRESSION_MS,
  impactMs: MATCH_IMPACT_MS,
  afterimageMs: MATCH_AFTERIMAGE_MS,
  openHoldMs: MATCH_OPEN_HOLD_MS,
  debrisCleanupMs: MATCH_DEBRIS_CLEANUP_MS,
  matchWavePerGridMs: MATCH_WAVE_PER_GRID_MS,
  matchWaveMaxMs: MATCH_WAVE_MAX_MS,
  cascadeStartAfterImpactMs: CASCADE_START_AFTER_IMPACT_MS,
  cascadeLandingSquashMs: CASCADE_LANDING_SQUASH_MS,
  cascadeLandingHopMs: CASCADE_LANDING_HOP_MS,
  cascadeLandingSettleMs: CASCADE_LANDING_SETTLE_MS
} as const;
