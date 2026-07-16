import Phaser from "phaser";
import { VFX_BUDGETS, VFX_SCREEN_FLASH, VFX_TEXTURE_CONFIG, VFX_TIMING } from "./vfxTiming";

export const vfxTextureKeys = {
  glow: "vfx-glow",
  hotCore: "vfx-hot-core",
  spark: "vfx-spark",
  shard: "vfx-shard",
  shardWide: "vfx-shard-wide",
  ring: "vfx-ring",
  smoke: "vfx-smoke",
  streak: "vfx-streak"
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

export interface ScreenFlashOptions {
  alpha?: number;
  durationMs?: number;
  reducedMotion?: boolean;
  tint?: number;
}

export interface BoardDimmerOptions {
  alpha: number;
  durationMs: number;
  tint?: number;
}

export interface LaneBlastOptions {
  durationMs: number;
  scale: number;
  tint: number;
}

export interface ElectricArcOptions {
  durationMs: number;
  seed: string;
  segments?: number;
  tint: number;
  width?: number;
}

export interface ImpactBurstOptions {
  intensity: number;
  lifespanMs?: number;
  reducedMotion?: boolean;
  tint: number;
}

type VfxDisposable = { destroy?: () => void; remove?: () => void; stop?: () => void };

/** Owns transient Phaser resources so a scene shutdown cannot leave orphaned FX alive. */
export class VfxCleanupRegistry {
  private readonly objects = new Set<VfxDisposable>();
  private readonly timers = new Set<VfxDisposable>();
  private readonly tweens = new Set<VfxDisposable>();

  trackObject<T extends VfxDisposable>(object: T): T {
    this.objects.add(object);
    return object;
  }

  trackTimer<T extends VfxDisposable>(timer: T): T {
    this.timers.add(timer);
    return timer;
  }

  trackTween<T extends VfxDisposable>(tween: T): T {
    this.tweens.add(tween);
    return tween;
  }

  release(resource: VfxDisposable): void {
    this.objects.delete(resource);
    this.timers.delete(resource);
    this.tweens.delete(resource);
  }

  schedule(scene: Phaser.Scene, delayMs: number, callback: () => void): Phaser.Time.TimerEvent {
    assertScene("cleanup", scene);
    assertPositiveFinite("cleanup", "delayMs", delayMs);
    let timer: Phaser.Time.TimerEvent;
    timer = scene.time.delayedCall(delayMs, () => {
      this.release(timer);
      callback();
    });
    return this.trackTimer(timer);
  }

  dispose(): void {
    for (const tween of this.tweens) {
      tween.stop?.();
      tween.remove?.();
      tween.destroy?.();
    }
    for (const timer of this.timers) {
      timer.remove?.();
      timer.destroy?.();
    }
    for (const object of this.objects) object.destroy?.();
    this.objects.clear();
    this.timers.clear();
    this.tweens.clear();
  }
}

export function vfxIntensity(affectedCount: number, isCombo: boolean, viewport: "desktop" | "mobile"): number {
  if (!Number.isFinite(affectedCount)) throw new Error(`Invalid VFX affectedCount (${affectedCount}): expected a finite number`);
  const cap = viewport === "mobile" ? VFX_BUDGETS.mobileIntensityCap : VFX_BUDGETS.desktopIntensityCap;
  return Math.min(cap, Math.max(0, (isCombo ? 0.45 : 0.18) + Math.max(0, affectedCount) * 0.07));
}

export function vfxCleanupDelayMs(lifespanMs: number): number {
  if (!Number.isFinite(lifespanMs) || lifespanMs <= 0) throw new Error(`Invalid VFX lifespanMs (${lifespanMs}): expected a positive finite number`);
  return lifespanMs + VFX_BUDGETS.particleCleanupBufferMs;
}

export function reducedMotionVfxPlan(reducedMotion: boolean): { flash: boolean; particles: boolean; shake: boolean; travel: boolean } {
  return reducedMotion
    ? { flash: false, particles: false, shake: false, travel: false }
    : { flash: true, particles: true, shake: true, travel: true };
}

export function screenFlash(
  scene: Phaser.Scene,
  layer: Phaser.GameObjects.Container,
  options: ScreenFlashOptions = {},
  cleanup?: VfxCleanupRegistry
): void {
  assertScene("screenFlash", scene);
  const alpha = options.alpha ?? VFX_SCREEN_FLASH.alpha;
  const durationMs = options.durationMs ?? VFX_SCREEN_FLASH.durationMs;
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha > VFX_SCREEN_FLASH.alpha) {
    throw new Error(`Invalid VFX screenFlash alpha (${alpha}): expected a positive value at or below ${VFX_SCREEN_FLASH.alpha}`);
  }
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > VFX_SCREEN_FLASH.durationMs) {
    throw new Error(`Invalid VFX screenFlash durationMs (${durationMs}): expected a positive value at or below ${VFX_SCREEN_FLASH.durationMs}`);
  }
  if (!layer || options.reducedMotion) return;
  const flash = scene.add.graphics();
  flash.fillStyle(options.tint ?? 0xffffff, alpha);
  flash.fillRect(-layer.x, -layer.y, scene.scale.width, scene.scale.height);
  layer.add(flash);
  cleanup?.trackObject(flash);
  const tween = scene.tweens.add({
    targets: flash,
    alpha: 0,
    duration: durationMs,
    ease: "Quad.easeOut",
    onComplete: () => {
      cleanup?.release(flash);
      cleanup?.release(tween);
      flash.destroy();
    }
  });
  cleanup?.trackTween(tween);
}

export function boardDimmer(
  scene: Phaser.Scene,
  layer: Phaser.GameObjects.Container,
  options: BoardDimmerOptions,
  cleanup?: VfxCleanupRegistry
): void {
  assertScene("boardDimmer", scene);
  if (!Number.isFinite(options.alpha) || options.alpha <= 0 || options.alpha > 0.6) {
    throw new Error(`Invalid VFX boardDimmer alpha (${options.alpha}): expected a positive value at or below 0.6`);
  }
  assertPositiveFinite("boardDimmer", "durationMs", options.durationMs);
  if (!layer) return;
  const dimmer = scene.add.graphics();
  dimmer.fillStyle(options.tint ?? 0x020712, options.alpha);
  dimmer.fillRect(-layer.x, -layer.y, scene.scale.width, scene.scale.height);
  layer.add(dimmer);
  cleanup?.trackObject(dimmer);
  const tween = scene.tweens.add({
    targets: dimmer,
    alpha: 0,
    duration: options.durationMs,
    ease: "Sine.easeInOut",
    onComplete: () => {
      cleanup?.release(dimmer);
      cleanup?.release(tween);
      dimmer.destroy();
    }
  });
  cleanup?.trackTween(tween);
}

export function laneBlast(
  scene: Phaser.Scene,
  layer: Phaser.GameObjects.Container,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options: LaneBlastOptions,
  cleanup?: VfxCleanupRegistry
): void {
  assertScene("laneBlast", scene);
  assertFinite("laneBlast", "from.x", from.x);
  assertFinite("laneBlast", "from.y", from.y);
  assertFinite("laneBlast", "to.x", to.x);
  assertFinite("laneBlast", "to.y", to.y);
  assertPositiveFinite("laneBlast", "durationMs", options.durationMs);
  assertPositiveFinite("laneBlast", "scale", options.scale);
  assertFinite("laneBlast", "tint", options.tint);
  if (!layer) return;
  ensureVfxTextures(scene);
  const streak = scene.add.image(from.x - layer.x, from.y - layer.y, vfxTextureKeys.streak);
  streak.setTint(options.tint);
  streak.setScale(options.scale);
  streak.setRotation(Phaser.Math.Angle.Between(from.x, from.y, to.x, to.y));
  streak.setBlendMode(Phaser.BlendModes.ADD);
  layer.add(streak);
  cleanup?.trackObject(streak);
  const tween = scene.tweens.add({
    targets: streak,
    x: to.x - layer.x,
    y: to.y - layer.y,
    alpha: 0,
    duration: options.durationMs,
    ease: "Cubic.easeOut",
    onComplete: () => {
      cleanup?.release(streak);
      cleanup?.release(tween);
      streak.destroy();
    }
  });
  cleanup?.trackTween(tween);
}

export function electricArc(
  scene: Phaser.Scene,
  layer: Phaser.GameObjects.Container,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options: ElectricArcOptions,
  cleanup?: VfxCleanupRegistry
): void {
  assertScene("electricArc", scene);
  assertFinite("electricArc", "from.x", from.x);
  assertFinite("electricArc", "from.y", from.y);
  assertFinite("electricArc", "to.x", to.x);
  assertFinite("electricArc", "to.y", to.y);
  assertPositiveFinite("electricArc", "durationMs", options.durationMs);
  assertFinite("electricArc", "tint", options.tint);
  if (!options.seed) throw new Error("Invalid VFX electricArc seed: expected a non-empty string");
  if (!layer) return;
  const segments = options.segments ?? 6;
  const width = options.width ?? 2;
  assertPositiveFinite("electricArc", "segments", segments);
  assertPositiveFinite("electricArc", "width", width);
  const graphics = scene.add.graphics();
  const localFrom = { x: from.x - layer.x, y: from.y - layer.y };
  const localTo = { x: to.x - layer.x, y: to.y - layer.y };
  const random = seededRandom(options.seed);
  const dx = localTo.x - localFrom.x;
  const dy = localTo.y - localFrom.y;
  const length = Math.hypot(dx, dy);
  const perpendicular = length > 0 ? { x: -dy / length, y: dx / length } : { x: 0, y: 0 };
  graphics.lineStyle(width, options.tint, 0.92);
  graphics.beginPath();
  graphics.moveTo(localFrom.x, localFrom.y);
  for (let index = 1; index < segments; index += 1) {
    const progress = index / segments;
    const jitter = (random() - 0.5) * Math.min(20, length * 0.18);
    graphics.lineTo(localFrom.x + dx * progress + perpendicular.x * jitter, localFrom.y + dy * progress + perpendicular.y * jitter);
  }
  graphics.lineTo(localTo.x, localTo.y);
  graphics.strokePath();
  graphics.setBlendMode(Phaser.BlendModes.ADD);
  layer.add(graphics);
  cleanup?.trackObject(graphics);
  const tween = scene.tweens.add({
    targets: graphics,
    alpha: 0,
    duration: options.durationMs,
    ease: "Quad.easeOut",
    onComplete: () => {
      cleanup?.release(graphics);
      cleanup?.release(tween);
      graphics.destroy();
    }
  });
  cleanup?.trackTween(tween);
}

export function impactBurst(
  scene: Phaser.Scene,
  layer: Phaser.GameObjects.Container,
  x: number,
  y: number,
  options: ImpactBurstOptions,
  cleanup?: VfxCleanupRegistry
): void {
  assertScene("impactBurst", scene);
  assertFinite("impactBurst", "x", x);
  assertFinite("impactBurst", "y", y);
  assertPositiveFinite("impactBurst", "intensity", options.intensity);
  assertFinite("impactBurst", "tint", options.tint);
  if (!layer || options.reducedMotion) return;
  ensureVfxTextures(scene);
  const lifespanMs = options.lifespanMs ?? VFX_BUDGETS.longestParticleLifetimeMs;
  assertPositiveFinite("impactBurst", "lifespanMs", lifespanMs);
  const localX = x - layer.x;
  const localY = y - layer.y;
  const core = scene.add.image(localX, localY, vfxTextureKeys.hotCore);
  core.setTint(options.tint);
  core.setBlendMode(Phaser.BlendModes.ADD);
  core.setScale(0.45 + options.intensity * 0.45);
  layer.add(core);
  cleanup?.trackObject(core);
  const coreTween = scene.tweens.add({
    targets: core,
    alpha: 0,
    scaleX: core.scaleX * 1.8,
    scaleY: core.scaleY * 1.8,
    duration: Math.min(180, lifespanMs),
    ease: "Quad.easeOut",
    onComplete: () => {
      cleanup?.release(core);
      cleanup?.release(coreTween);
      core.destroy();
    }
  });
  cleanup?.trackTween(coreTween);
  const count = Math.max(4, Math.round(5 + options.intensity * 7));
  burst(scene, layer, x, y, {
    texture: vfxTextureKeys.spark,
    count,
    speed: 100 + options.intensity * 100,
    lifespanMs,
    tint: options.tint,
    scale: 0.25 + options.intensity * 0.15
  }, cleanup);
  burst(scene, layer, x, y, {
    texture: vfxTextureKeys.shard,
    count: Math.max(3, Math.round(count * 0.6)),
    speed: 75 + options.intensity * 80,
    lifespanMs: Math.min(lifespanMs, 280),
    tint: options.tint,
    scale: 0.22 + options.intensity * 0.12
  }, cleanup);
  burst(scene, layer, x, y, {
    texture: vfxTextureKeys.shardWide,
    count: Math.max(2, Math.round(count * 0.35)),
    speed: 65 + options.intensity * 70,
    lifespanMs: Math.min(lifespanMs, 240),
    tint: options.tint,
    scale: 0.2 + options.intensity * 0.1
  }, cleanup);
  burst(scene, layer, x, y, {
    texture: vfxTextureKeys.smoke,
    count: 2,
    speed: 30 + options.intensity * 40,
    lifespanMs: Math.min(lifespanMs, 320),
    tint: 0xffffff,
    scale: 0.3 + options.intensity * 0.2
  }, cleanup);
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

  generateSoftTexture(scene, vfxTextureKeys.glow, VFX_TEXTURE_CONFIG.glow, 0.12, 0.55);
  generateSoftTexture(scene, vfxTextureKeys.smoke, VFX_TEXTURE_CONFIG.smoke, 0.18, 0.32);
  generateSoftTexture(scene, vfxTextureKeys.hotCore, VFX_TEXTURE_CONFIG.hotCore, 0.72, 1);

  if (!scene.textures.exists(vfxTextureKeys.streak)) {
    const config = VFX_TEXTURE_CONFIG.streak;
    const streak = scene.add.graphics();
    streak.fillStyle(0xffffff, 1);
    streak.fillTriangle(config.x1, config.y1, config.x2, config.y2, config.x3, config.y3);
    streak.generateTexture(vfxTextureKeys.streak, config.textureWidth, config.textureHeight);
    streak.destroy();
  }

  if (!scene.textures.exists(vfxTextureKeys.shard)) {
    const config = VFX_TEXTURE_CONFIG.shard;
    const shard = scene.add.graphics();
    shard.fillStyle(0xffffff, 1);
    shard.fillTriangle(config.x1, config.y1, config.x2, config.y2, config.x3, config.y3);
    shard.generateTexture(vfxTextureKeys.shard, config.textureWidth, config.textureHeight);
    shard.destroy();
  }

  if (!scene.textures.exists(vfxTextureKeys.shardWide)) {
    const config = VFX_TEXTURE_CONFIG.shardWide;
    const shard = scene.add.graphics();
    shard.fillStyle(0xffffff, 1);
    shard.fillTriangle(config.x1, config.y1, config.x2, config.y2, config.x3, config.y3);
    shard.generateTexture(vfxTextureKeys.shardWide, config.textureWidth, config.textureHeight);
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
  options: BurstOptions,
  cleanup?: VfxCleanupRegistry
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
  cleanup?.trackObject(emitter);
  emitter.explode(options.count, 0, 0);
  const destroy = () => {
    cleanup?.release(emitter);
    emitter.destroy();
  };
  if (cleanup) cleanup.schedule(scene, vfxCleanupDelayMs(options.lifespanMs), destroy);
  else scene.time.delayedCall(vfxCleanupDelayMs(options.lifespanMs), destroy);
}

function generateSoftTexture(
  scene: Phaser.Scene,
  key: string,
  config: { centerX: number; centerY: number; radius: number; textureHeight: number; textureWidth: number },
  outerAlpha: number,
  innerAlpha: number
): void {
  if (scene.textures.exists(key)) return;
  const graphic = scene.add.graphics();
  graphic.fillStyle(0xffffff, outerAlpha);
  graphic.fillCircle(config.centerX, config.centerY, config.radius);
  graphic.fillStyle(0xffffff, innerAlpha);
  graphic.fillCircle(config.centerX, config.centerY, config.radius * 0.48);
  graphic.generateTexture(key, config.textureWidth, config.textureHeight);
  graphic.destroy();
}

export function shockwave(
  scene: Phaser.Scene,
  layer: Phaser.GameObjects.Container,
  x: number,
  y: number,
  options: ShockwaveOptions,
  cleanup?: VfxCleanupRegistry
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
  cleanup?.trackObject(ring);
  const tween = scene.tweens.add({
    targets: ring,
    alpha: 0,
    scaleX: 1,
    scaleY: 1,
    duration: options.durationMs,
    ease: "Quad.easeOut",
    onComplete: () => {
      cleanup?.release(ring);
      cleanup?.release(tween);
      ring.destroy();
    }
  });
  cleanup?.trackTween(tween);
}

export function shake(scene: Phaser.Scene, intensity: number, durationMs: number, reducedMotion = false): void {
  requestShake(scene, intensity, durationMs, reducedMotion);
}

const shakeState = new WeakMap<object, { intensity: number; untilMs: number }>();

export function requestShake(scene: Phaser.Scene, intensity: number, durationMs: number, reducedMotion = false): void {
  if (reducedMotion) return;
  const camera = scene.cameras?.main;
  if (!camera) return;
  assertPositiveFinite("requestShake", "intensity", intensity);
  assertPositiveFinite("requestShake", "durationMs", durationMs);
  const now = scene.time.now;
  const active = shakeState.get(camera);
  const combined = active && active.untilMs > now ? active.intensity + intensity * 0.5 : intensity;
  const capped = Math.min(0.013, combined);
  shakeState.set(camera, { intensity: capped, untilMs: now + durationMs });
  camera.shake(durationMs, capped);
}

function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
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
