import Phaser from "phaser";
import { VFX_TIMING } from "./vfxTiming";

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
    const spark = scene.add.graphics();
    spark.fillStyle(0xffffff, 1);
    spark.fillCircle(4, 4, 3);
    spark.generateTexture(vfxTextureKeys.spark, 8, 8);
    spark.destroy();
  }

  if (!scene.textures.exists(vfxTextureKeys.shard)) {
    const shard = scene.add.graphics();
    shard.fillStyle(0xffffff, 1);
    shard.fillTriangle(5, 0, 10, 10, 0, 10);
    shard.generateTexture(vfxTextureKeys.shard, 10, 10);
    shard.destroy();
  }

  if (!scene.textures.exists(vfxTextureKeys.ring)) {
    const ring = scene.add.graphics();
    ring.lineStyle(2, 0xffffff, 1);
    ring.strokeCircle(8, 8, 6);
    ring.generateTexture(vfxTextureKeys.ring, 16, 16);
    ring.destroy();
  }
}

export function burst(
  scene: Phaser.Scene,
  layer: Phaser.GameObjects.Container,
  x: number,
  y: number,
  options: BurstOptions
): Phaser.GameObjects.Particles.ParticleEmitter {
  ensureVfxTextures(scene);
  const emitter = scene.add.particles(x, y, options.texture, {
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
  emitter.explode(options.count, x, y);
  scene.time.delayedCall(options.lifespanMs + VFX_TIMING.EMITTER_CLEANUP_BUFFER_MS, () => emitter.destroy());
  return emitter;
}

export function shockwave(
  scene: Phaser.Scene,
  layer: Phaser.GameObjects.Container,
  x: number,
  y: number,
  options: ShockwaveOptions
): Phaser.GameObjects.Graphics {
  const ring = scene.add.graphics();
  ring.setPosition(x, y);
  ring.setScale(0.2);
  ring.lineStyle(3, options.tint, 0.9);
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
  return ring;
}

export function shake(scene: Phaser.Scene, intensity: number, durationMs: number, reducedMotion = false): void {
  if (reducedMotion) return;
  scene.cameras.main.shake(durationMs, intensity);
}
