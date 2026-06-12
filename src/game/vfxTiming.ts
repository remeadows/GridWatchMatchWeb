export const VFX_TIMING = {
  EMITTER_CLEANUP_BUFFER_MS: 80,
  PARTICLE_MIN_SPEED_RATIO: 0.35,
  SHOCKWAVE_INITIAL_ALPHA: 0.9,
  SHOCKWAVE_INITIAL_SCALE: 0.2,
  SHOCKWAVE_LINE_WIDTH: 3
} as const;

export const VFX_TEXTURE_CONFIG = {
  ring: {
    centerX: 8,
    centerY: 8,
    lineWidth: 2,
    radius: 6,
    textureHeight: 16,
    textureWidth: 16
  },
  shard: {
    textureHeight: 10,
    textureWidth: 10,
    x1: 5,
    x2: 10,
    x3: 0,
    y1: 0,
    y2: 10,
    y3: 10
  },
  spark: {
    centerX: 4,
    centerY: 4,
    radius: 3,
    textureHeight: 8,
    textureWidth: 8
  }
} as const;
