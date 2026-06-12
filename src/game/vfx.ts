import Phaser from "phaser";
import { VFX_TEXTURE_CONFIG, VFX_TIMING } from "./vfxTiming";

export const vfxTextureKeys = {
  spark: "vfx-spark",
  shard: "vfx-shard",
  ring: "vfx-ring"
} as const;

export type VfxTextureKey = typeof vfxTextureKeys[keyof typeof vfxTextureKeys];

export interface BurstOptions {
  texture: VfxTextureKey;
  count: number;
  speed: number;
  lifespanMs: number;
  tint: number;
  scale: number;
}

export interface ShockwaveOptions {
  radiusPx: number;
  durationMs: number;
  tint: number;
}

export function ensureVfxTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists(vfxTextureKeys.spark)) {
    const config = VFX_TEXTURE_CONFIG.spark;
    const spark = scene.add.graphics();
    spark.fillStyle(0xffffff, 1);
    spark.fillCircle(config.centerX, config.centerY, config.radius);
    spark.generateTexture(vfxTextureKeys.spark, config.textureWidth, config.textureHeight);
    spark.destroy();
  }

  if (!scene.textures.exists(vfxTextureKeys.shard)) {
    const config = VFX_TEXTURE_CONFIG.shard;
    const shard = scene.add.graphics();
    shard.fillStyle(0xffffff, 1);
    shard.fillTriangle(config.x1, config.y1, config.x2, config.y2, config.x3, config.y3);
    shard.generateTexture(vfxTextureKeys.shard, config.textureWidth, config.textureHeight);
    shard.destroy();
  }

  if (!scene.textures.exists(vfxTextureKeys.ring)) {
    const config = VFX_TEXTURE_CONFIG.ring;
    const ring = scene.add.graphics();
    ring.lineStyle(config.lineWidth, 0xffffff, 1);
    ring.strokeCircle(config.centerX, config.centerY, config.radius);
    ring.generateTexture(vfxTextureKeys.ring, config.textureWidth, config.textureHeight);
    ring.destroy();
  }
}

export function burst(
  scene: Phaser.Scene,
  layer: Phaser.GameObjects.Container,
  x: number,
  y: number,
  options: BurstOptions
): void {
  if (!layer) return;
  assertScene("burst", scene);
  assertFinite("burst", "x", x);
  assertFinite("burst", "y", y);
  assertPositiveFinite("burst", "count", options.count);
  assertPositiveFinite("burst", "speed", options.speed);
  assertPositiveFinite("burst", "lifespanMs", options.lifespanMs);
  assertPositiveFinite("burst", "scale", options.scale);
  assertFinite("burst", "tint", options.tint);
  ensureVfxTextures(scene);
  const localX = x - layer.x;
  const localY = y - layer.y;
  const emitter = scene.add.particles(localX, localY, options.texture, {
    alpha: { start: 1, end: 0 },
    blendMode: Phaser.BlendModes.ADD,
    emitting: false,
    lifespan: options.lifespanMs,
    rotate: { min: -180, max: 180 },
    scale: { start: options.scale, end: 0 },
    speed: { min: options.speed * VFX_TIMING.PARTICLE_MIN_SPEED_RATIO, max: options.speed },
    tint: options.tint
  });
  layer.add(emitter);
  emitter.explode(options.count, 0, 0);
  scene.time.delayedCall(options.lifespanMs + VFX_TIMING.EMITTER_CLEANUP_BUFFER_MS, () => emitter.destroy());
}

export function shockwave(
  scene: Phaser.Scene,
  layer: Phaser.GameObjects.Container,
  x: number,
  y: number,
  options: ShockwaveOptions
): void {
  if (!layer) return;
  assertScene("shockwave", scene);
  assertFinite("shockwave", "x", x);
  assertFinite("shockwave", "y", y);
  assertPositiveFinite("shockwave", "radiusPx", options.radiusPx);
  assertPositiveFinite("shockwave", "durationMs", options.durationMs);
  assertFinite("shockwave", "tint", options.tint);
  const localX = x - layer.x;
  const localY = y - layer.y;
  const ring = scene.add.graphics();
  ring.setPosition(localX, localY);
  ring.setScale(VFX_TIMING.SHOCKWAVE_INITIAL_SCALE);
  ring.lineStyle(VFX_TIMING.SHOCKWAVE_LINE_WIDTH, options.tint, VFX_TIMING.SHOCKWAVE_INITIAL_ALPHA);
  ring.strokeCircle(0, 0, options.radiusPx);
  layer.add(ring);
  scene.tweens.add({
    targets: ring,
    alpha: 0,
    scaleX: 1,
    scaleY: 1,
    duration: options.durationMs,
    ease: "Quad.easeOut",
    onComplete: () => ring.destroy()
  });
}

export function shake(scene: Phaser.Scene, intensity: number, durationMs: number, reducedMotion = false): void {
  if (reducedMotion) return;
  const camera = scene.cameras?.main;
  if (!camera) return;
  assertPositiveFinite("shake", "intensity", intensity);
  assertPositiveFinite("shake", "durationMs", durationMs);
  camera.shake(durationMs, intensity);
}

function assertScene(scope: string, scene: Phaser.Scene): void {
  if (!scene?.add) {
    throw new Error(`Invalid VFX ${scope} scene: expected a Phaser.Scene`);
  }
}

function assertPositiveFinite(scope: string, name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid VFX ${scope} ${name} (${value}): expected a positive finite number`);
  }
}

function assertFinite(scope: string, name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid VFX ${scope} ${name} (${value}): expected a finite number`);
  }
}
