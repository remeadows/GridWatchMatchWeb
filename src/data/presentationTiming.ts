export const DRAG_LIFT_MS = 65;
export const SWAP_TRAVEL_MS = 175;
export const SWAP_SETTLE_MS = 60;
export const MATCH_RECOGNITION_HOLD_MS = 140;
export const MATCH_POP_COMPRESSION_MS = 100;
export const MATCH_IMPACT_MS = 180;
export const MATCH_AFTERIMAGE_MS = 130;
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
export const ROCKET_IGNITION_MS = 75;
export const ROCKET_LANE_FLIGHT_MS = 360;
export const ROCKET_TRAIL_LIFESPAN_MS = 180;
export const ROCKET_TRAIL_CLEANUP_MS = 80;
export const ROCKET_EDGE_BURST_LIFESPAN_MS = 190;
export const PROPELLER_LIFT_MS = 105;
export const PROPELLER_FLIGHT_MS = 380;
export const PROPELLER_RETICLE_DELAY_MS = 70;
export const PROPELLER_SECONDARY_STAGGER_MS = 32;
export const PROPELLER_SEQUENCE_BUDGET_MS = 780;
export const LIGHTBALL_WAVE_CONCURRENCY_CAP = 3;
export const LIGHTBALL_WAVE_COUNT = 3;
export const LIGHTBALL_DIM_MS = 120;
export const LIGHTBALL_CHARGE_MS = 120;
export const LIGHTBALL_WAVE_STAGGER_MS = 100;
export const LIGHTBALL_RELEASE_DELAY_MS = 120;
export const COMBO_CHOREOGRAPHY_TIMING = {
  "rocket+rocket": { chargeMs: 220, impactMs: 500, cascadeMs: 900, batchCount: 4 },
  "propeller+rocket": { chargeMs: 240, impactMs: 650, cascadeMs: 1_050, batchCount: 3 },
  "rocket+tnt": { chargeMs: 260, impactMs: 650, cascadeMs: 1_050, batchCount: 2 },
  "lightBall+rocket": { chargeMs: 280, impactMs: 820, cascadeMs: 1_080, batchCount: 4 },
  "propeller+propeller": { chargeMs: 220, impactMs: 620, cascadeMs: 980, batchCount: 2 },
  "propeller+tnt": { chargeMs: 250, impactMs: 720, cascadeMs: 1_120, batchCount: 3 },
  "lightBall+propeller": { chargeMs: 280, impactMs: 840, cascadeMs: 1_120, batchCount: 4 },
  "tnt+tnt": { chargeMs: 260, impactMs: 600, cascadeMs: 1_050, batchCount: 4 },
  "lightBall+tnt": { chargeMs: 280, impactMs: 800, cascadeMs: 1_120, batchCount: 5 },
  "lightBall+lightBall": { chargeMs: 300, impactMs: 850, cascadeMs: 1_150, batchCount: 5 }
} as const;
export const COMBO_BATCH_PARTICLE_CAP = 120;
export const COMBO_ARC_CAP = 16;
export const COMBO_PROJECTILE_CAP = 12;
export const COMBO_CHOREOGRAPHY_MAX_MS = 1_150;
export const POWERUP_CASCADE_HOLD_MS = 200;
export const MATCH_WAVE_PER_GRID_MS = 35;
export const MATCH_WAVE_MAX_MS = 150;
export const CASCADE_START_AFTER_IMPACT_MS = 230;
export const CASCADE_FALL_BASE_MS = 190;
export const CASCADE_FALL_PER_CELL_MS = 70;
export const CASCADE_FALL_MIN_MS = 260;
export const CASCADE_FALL_MAX_MS = 540;
export const CASCADE_LANDING_SQUASH_MS = 95;
export const CASCADE_LANDING_SETTLE_MS = 95;
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
