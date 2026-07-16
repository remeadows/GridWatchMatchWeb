export const VFX_TIMING = {
  EMITTER_CLEANUP_BUFFER_MS: 80,
  PARTICLE_MIN_SPEED_RATIO: 0.35,
  SHOCKWAVE_INITIAL_ALPHA: 0.9,
  SHOCKWAVE_INITIAL_SCALE: 0.2,
  SHOCKWAVE_LINE_WIDTH: 3
} as const;

export const VFX_BUDGETS = {
  desktopIntensityCap: 1,
  longestParticleLifetimeMs: 420,
  mobileIntensityCap: 0.72,
  particleCleanupBufferMs: 80
} as const;

export const VFX_SCREEN_FLASH = {
  alpha: 0.38,
  durationMs: 80
} as const;

export const VFX_TEXTURE_CONFIG = {
  glow: {
    centerX: 16,
    centerY: 16,
    radius: 15,
    textureHeight: 32,
    textureWidth: 32
  },
  hotCore: {
    centerX: 12,
    centerY: 12,
    radius: 9,
    textureHeight: 24,
    textureWidth: 24
  },
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
  shardWide: {
    textureHeight: 8,
    textureWidth: 16,
    x1: 0,
    x2: 16,
    x3: 3,
    y1: 4,
    y2: 4,
    y3: 0
  },
  smoke: {
    centerX: 16,
    centerY: 16,
    radius: 12,
    textureHeight: 32,
    textureWidth: 32
  },
  spark: {
    centerX: 4,
    centerY: 4,
    radius: 3,
    textureHeight: 8,
    textureWidth: 8
  },
  streak: {
    textureHeight: 10,
    textureWidth: 28,
    x1: 0,
    x2: 28,
    x3: 5,
    y1: 5,
    y2: 5,
    y3: 1
  }
} as const;
