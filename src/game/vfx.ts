import Phaser from "phaser";
import { PRESENTATION_RESOURCE_LIMITS, type PresentationViewportProfile } from "./presentation";
import { VFX_BUDGETS, VFX_SCREEN_FLASH, VFX_TEXTURE_CONFIG, VFX_TIMING } from "./vfxTiming";

export const vfxTextureKeys = {
  bloom: "vfx-bloom",
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

export interface BlastCoreOptions {
  radiusPx: number;
  durationMs: number;
  tint: number;
  reducedMotion?: boolean;
}

export interface HeavyDebrisOptions {
  count: number;
  reachPx: number;
  sizePx: number;
  durationMs: number;
  seed: string;
  tint: number;
  reducedMotion?: boolean;
}

export interface LaneBeamOptions {
  widthPx: number;
  travelMs: number;
  fadeMs: number;
  tint: number;
  reducedMotion?: boolean;
}

export interface ImpactBurstOptions {
  intensity: number;
  lifespanMs?: number;
  reducedMotion?: boolean;
  tint: number;
}

type VfxDisposable = {
  destroy?: () => void;
  remove?: (...args: never[]) => unknown;
  stop?: () => void;
  once?: (event: string, callback: () => void) => unknown;
};

export interface PresentationResourceCounts {
  activeFxObjects: number;
  activeTimers: number;
  activeTweens: number;
  activeEmitters: number;
  liveParticles: number;
  simultaneousArcs: number;
  activeBoardAudio: number;
}

export interface PresentationResourceSnapshot extends PresentationResourceCounts {
  current: PresentationResourceCounts;
  peak: PresentationResourceCounts;
  profile: PresentationViewportProfile;
}

type BudgetCounts = Pick<PresentationResourceCounts, "activeEmitters" | "liveParticles" | "simultaneousArcs" | "activeBoardAudio">;

const emptyBudgetCounts = (): BudgetCounts => ({
  activeEmitters: 0,
  liveParticles: 0,
  simultaneousArcs: 0,
  activeBoardAudio: 0
});

const emptyResourceCounts = (): PresentationResourceCounts => ({
  activeFxObjects: 0,
  activeTimers: 0,
  activeTweens: 0,
  ...emptyBudgetCounts()
});

export class PresentationVfxBudget {
  private current = emptyBudgetCounts();
  private peak = emptyBudgetCounts();

  constructor(private profile: PresentationViewportProfile) {}

  allocateEmitter(requestedParticles: number): number {
    if (!Number.isFinite(requestedParticles) || requestedParticles <= 0) return 0;
    if (this.current.activeEmitters >= PRESENTATION_RESOURCE_LIMITS.concurrentEmitters) return 0;
    const remainingParticles = PRESENTATION_RESOURCE_LIMITS.liveParticles[this.profile] - this.current.liveParticles;
    const grantedParticles = Math.min(Math.floor(requestedParticles), Math.max(0, remainingParticles));
    if (grantedParticles === 0) return 0;
    this.current.activeEmitters += 1;
    this.current.liveParticles += grantedParticles;
    this.capturePeak();
    return grantedParticles;
  }

  releaseEmitter(particleCount: number): void {
    this.current.activeEmitters = Math.max(0, this.current.activeEmitters - 1);
    this.current.liveParticles = Math.max(0, this.current.liveParticles - Math.max(0, particleCount));
  }

  allocateArc(): boolean {
    if (this.current.simultaneousArcs >= PRESENTATION_RESOURCE_LIMITS.simultaneousArcs) return false;
    this.current.simultaneousArcs += 1;
    this.capturePeak();
    return true;
  }

  releaseArc(): void {
    this.current.simultaneousArcs = Math.max(0, this.current.simultaneousArcs - 1);
  }

  allocateAudio(): boolean {
    if (this.current.activeBoardAudio >= PRESENTATION_RESOURCE_LIMITS.activeBoardAudio) return false;
    this.current.activeBoardAudio += 1;
    this.capturePeak();
    return true;
  }

  releaseAudio(): void {
    this.current.activeBoardAudio = Math.max(0, this.current.activeBoardAudio - 1);
  }

  reset(profile: PresentationViewportProfile): void {
    this.profile = profile;
    this.current = emptyBudgetCounts();
    this.peak = emptyBudgetCounts();
  }

  clearCurrent(): void {
    this.current = emptyBudgetCounts();
  }

  snapshot(): { current: BudgetCounts; peak: BudgetCounts; profile: PresentationViewportProfile } & BudgetCounts {
    return {
      ...this.current,
      current: { ...this.current },
      peak: { ...this.peak },
      profile: this.profile
    };
  }

  private capturePeak(): void {
    for (const key of Object.keys(this.current) as Array<keyof BudgetCounts>) {
      this.peak[key] = Math.max(this.peak[key], this.current[key]);
    }
  }
}

/** Owns transient Phaser resources so a scene shutdown cannot leave orphaned FX alive. */
export class VfxCleanupRegistry {
  private readonly objects = new Map<VfxDisposable, { arc: boolean; emitterParticles: number }>();
  private readonly timers = new Set<VfxDisposable>();
  private readonly tweens = new Set<VfxDisposable>();
  private readonly budget: PresentationVfxBudget;
  private generation = 0;
  private disposed = false;
  private peak = emptyResourceCounts();

  constructor(
    profile: PresentationViewportProfile = "desktop",
    private readonly onCountsChanged?: (snapshot: PresentationResourceSnapshot) => void
  ) {
    this.budget = new PresentationVfxBudget(profile);
    this.publishCounts();
  }

  trackObject<T extends VfxDisposable>(object: T): T {
    if (this.disposed) {
      object.destroy?.();
      return object;
    }
    this.objects.set(object, { arc: false, emitterParticles: 0 });
    object.once?.("destroy", () => this.release(object));
    this.publishCounts();
    return object;
  }

  trackEmitter<T extends VfxDisposable>(emitter: T, requestedParticles: number): number {
    if (this.disposed) {
      emitter.destroy?.();
      return 0;
    }
    const particleCount = this.budget.allocateEmitter(requestedParticles);
    if (particleCount === 0) {
      emitter.destroy?.();
      return 0;
    }
    this.objects.set(emitter, { arc: false, emitterParticles: particleCount });
    emitter.once?.("destroy", () => this.release(emitter));
    this.publishCounts();
    return particleCount;
  }

  trackArc<T extends VfxDisposable>(arc: T): T | null {
    if (this.disposed || !this.budget.allocateArc()) {
      arc.destroy?.();
      return null;
    }
    this.objects.set(arc, { arc: true, emitterParticles: 0 });
    arc.once?.("destroy", () => this.release(arc));
    this.publishCounts();
    return arc;
  }

  trackTimer<T extends VfxDisposable>(timer: T): T {
    this.timers.add(timer);
    this.publishCounts();
    return timer;
  }

  trackTween<T extends VfxDisposable>(tween: T): T {
    this.tweens.add(tween);
    tween.once?.("complete", () => this.release(tween));
    tween.once?.("stop", () => this.release(tween));
    this.publishCounts();
    return tween;
  }

  release(resource: VfxDisposable): void {
    const metadata = this.objects.get(resource);
    if (metadata) {
      if (metadata.emitterParticles > 0) this.budget.releaseEmitter(metadata.emitterParticles);
      if (metadata.arc) this.budget.releaseArc();
      this.objects.delete(resource);
    }
    this.timers.delete(resource);
    this.tweens.delete(resource);
    this.publishCounts();
  }

  allocateAudio(scene: Phaser.Scene, lifespanMs = PRESENTATION_RESOURCE_LIMITS.boardAudioSlotMs): boolean {
    if (this.disposed || !this.budget.allocateAudio()) return false;
    this.publishCounts();
    this.schedule(scene, lifespanMs, () => {
      this.budget.releaseAudio();
      this.publishCounts();
    });
    return true;
  }

  schedule(scene: Phaser.Scene, delayMs: number, callback: () => void): Phaser.Time.TimerEvent {
    assertScene("cleanup", scene);
    assertPositiveFinite("cleanup", "delayMs", delayMs);
    const generation = this.generation;
    let timer: Phaser.Time.TimerEvent;
    timer = scene.time.delayedCall(delayMs, () => {
      this.release(timer);
      if (this.disposed || generation !== this.generation) return;
      callback();
    });
    return this.trackTimer(timer);
  }

  reset(profile: PresentationViewportProfile): void {
    this.dispose();
    this.disposed = false;
    this.budget.reset(profile);
    this.peak = emptyResourceCounts();
    this.publishCounts();
  }

  resourceCounts(): PresentationResourceSnapshot {
    const budget = this.budget.snapshot();
    const current: PresentationResourceCounts = {
      activeFxObjects: this.objects.size,
      activeTimers: this.timers.size,
      activeTweens: this.tweens.size,
      ...budget.current
    };
    return {
      ...current,
      current,
      peak: { ...this.peak },
      profile: budget.profile
    };
  }

  dispose(): void {
    this.generation += 1;
    this.disposed = true;
    for (const tween of [...this.tweens]) {
      tween.stop?.();
      tween.remove?.();
      tween.destroy?.();
    }
    for (const timer of [...this.timers]) {
      timer.remove?.();
      timer.destroy?.();
    }
    for (const object of [...this.objects.keys()]) object.destroy?.();
    this.objects.clear();
    this.timers.clear();
    this.tweens.clear();
    this.budget.clearCurrent();
    this.publishCounts();
  }

  private publishCounts(): void {
    const budget = this.budget.snapshot();
    const current: PresentationResourceCounts = {
      activeFxObjects: this.objects.size,
      activeTimers: this.timers.size,
      activeTweens: this.tweens.size,
      ...budget.current
    };
    for (const key of Object.keys(current) as Array<keyof PresentationResourceCounts>) {
      this.peak[key] = Math.max(this.peak[key], current[key]);
    }
    this.onCountsChanged?.({
      ...current,
      current,
      peak: { ...this.peak },
      profile: budget.profile
    });
  }
}

// Sizes in this file were set for a 72 px tile on a 1x canvas. The dark board's canvas draws device
// pixels, so its tile is two or three times that, and a fixed pixel size came out a third as big
// on a phone. The scene states its tile size here and the primitives scale with it.
const VFX_DESIGN_TILE_PX = 72;
const vfxUnits = new WeakMap<object, number>();

export function setVfxTileSize(scene: Phaser.Scene, tileSize: number): void {
  vfxUnits.set(scene, Math.max(1, tileSize / VFX_DESIGN_TILE_PX));
}

export function vfxUnit(scene: Phaser.Scene): number {
  return vfxUnits.get(scene) ?? 1;
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
  const unit = vfxUnit(scene);
  const width = (options.width ?? 2) * unit;
  assertPositiveFinite("electricArc", "segments", segments);
  assertPositiveFinite("electricArc", "width", width);
  const graphics = scene.add.graphics();
  if (cleanup && !cleanup.trackArc(graphics)) return;
  const localFrom = { x: from.x - layer.x, y: from.y - layer.y };
  const localTo = { x: to.x - layer.x, y: to.y - layer.y };
  const random = seededRandom(options.seed);
  const dx = localTo.x - localFrom.x;
  const dy = localTo.y - localFrom.y;
  const length = Math.hypot(dx, dy);
  const perpendicular = length > 0 ? { x: -dy / length, y: dx / length } : { x: 0, y: 0 };
  const points = [localFrom];
  for (let index = 1; index < segments; index += 1) {
    const progress = index / segments;
    const jitter = (random() - 0.5) * Math.min(20 * unit, length * 0.18);
    points.push({ x: localFrom.x + dx * progress + perpendicular.x * jitter, y: localFrom.y + dy * progress + perpendicular.y * jitter });
  }
  points.push(localTo);
  // A wide dim pass under the bright one is the bolt's glow.
  for (const [lineWidth, alpha] of [[width * 3, 0.28], [width, 0.92]]) {
    graphics.lineStyle(lineWidth, options.tint, alpha);
    graphics.beginPath();
    graphics.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) graphics.lineTo(point.x, point.y);
    graphics.strokePath();
  }
  graphics.setBlendMode(Phaser.BlendModes.ADD);
  layer.add(graphics);
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
  const unit = vfxUnit(scene);
  const core = scene.add.image(localX, localY, vfxTextureKeys.hotCore);
  core.setTint(options.tint);
  core.setBlendMode(Phaser.BlendModes.ADD);
  core.setScale((0.45 + options.intensity * 0.45) * unit);
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
    speed: (100 + options.intensity * 100) * unit,
    lifespanMs,
    tint: options.tint,
    scale: (0.25 + options.intensity * 0.15) * unit
  }, cleanup);
  burst(scene, layer, x, y, {
    texture: vfxTextureKeys.shard,
    count: Math.max(3, Math.round(count * 0.6)),
    speed: (75 + options.intensity * 80) * unit,
    lifespanMs: Math.min(lifespanMs, 280),
    tint: options.tint,
    scale: (0.22 + options.intensity * 0.12) * unit
  }, cleanup);
  burst(scene, layer, x, y, {
    texture: vfxTextureKeys.shardWide,
    count: Math.max(2, Math.round(count * 0.35)),
    speed: (65 + options.intensity * 70) * unit,
    lifespanMs: Math.min(lifespanMs, 240),
    tint: options.tint,
    scale: (0.2 + options.intensity * 0.1) * unit
  }, cleanup);
  burst(scene, layer, x, y, {
    texture: vfxTextureKeys.smoke,
    count: 2,
    speed: (30 + options.intensity * 40) * unit,
    lifespanMs: Math.min(lifespanMs, 320),
    tint: 0xffffff,
    scale: (0.3 + options.intensity * 0.2) * unit
  }, cleanup);
}

export function ensureVfxTextures(scene: Phaser.Scene): void {
  generateBloomTexture(scene);
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
  const particleCount = cleanup ? cleanup.trackEmitter(emitter, options.count) : options.count;
  if (particleCount === 0) return;
  layer.add(emitter);
  emitter.explode(particleCount, 0, 0);
  const destroy = () => {
    cleanup?.release(emitter);
    emitter.destroy();
  };
  if (cleanup) cleanup.schedule(scene, vfxCleanupDelayMs(options.lifespanMs), destroy);
  else scene.time.delayedCall(vfxCleanupDelayMs(options.lifespanMs), destroy);
}

/** Many faint circles, largest first: their overlap fades smoothly from a bright centre to nothing. */
function generateBloomTexture(scene: Phaser.Scene): void {
  const { centerX, centerY, radius, steps, stepAlpha, textureHeight, textureWidth } = VFX_TEXTURE_CONFIG.bloom;
  if (scene.textures.exists(vfxTextureKeys.bloom)) return;
  const graphic = scene.add.graphics();
  for (let step = steps; step > 0; step -= 1) {
    graphic.fillStyle(0xffffff, stepAlpha);
    graphic.fillCircle(centerX, centerY, (radius * step) / steps);
  }
  graphic.generateTexture(vfxTextureKeys.bloom, textureWidth, textureHeight);
  graphic.destroy();
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
  // The ring is scaled up from a fifth of its size, so its line is drawn for the size it ends at.
  const lineWidth = VFX_TIMING.SHOCKWAVE_LINE_WIDTH * vfxUnit(scene);
  ring.lineStyle(lineWidth * 3, options.tint, VFX_TIMING.SHOCKWAVE_INITIAL_ALPHA * 0.3);
  ring.strokeCircle(0, 0, options.radiusPx);
  ring.lineStyle(lineWidth, options.tint, VFX_TIMING.SHOCKWAVE_INITIAL_ALPHA);
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

/** The white-hot bloom at the heart of a blast: a large soft light that swells and dies fast. */
export function blastCore(
  scene: Phaser.Scene,
  layer: Phaser.GameObjects.Container,
  x: number,
  y: number,
  options: BlastCoreOptions,
  cleanup?: VfxCleanupRegistry
): void {
  assertScene("blastCore", scene);
  assertFinite("blastCore", "x", x);
  assertFinite("blastCore", "y", y);
  assertPositiveFinite("blastCore", "radiusPx", options.radiusPx);
  assertPositiveFinite("blastCore", "durationMs", options.durationMs);
  assertFinite("blastCore", "tint", options.tint);
  if (!layer || options.reducedMotion) return;
  ensureVfxTextures(scene);
  const textureRadius = VFX_TEXTURE_CONFIG.bloom.radius;
  for (const { tint, share, alpha } of [
    { tint: options.tint, share: 1, alpha: 0.85 },
    { tint: 0xffffff, share: 0.62, alpha: 1 }
  ]) {
    const light = scene.add.image(x - layer.x, y - layer.y, vfxTextureKeys.bloom);
    const scale = (options.radiusPx * share) / textureRadius;
    light.setTint(tint);
    light.setBlendMode(Phaser.BlendModes.ADD);
    light.setAlpha(alpha);
    light.setScale(scale * 0.4);
    layer.add(light);
    cleanup?.trackObject(light);
    const tween = scene.tweens.add({
      targets: light,
      // It swells at once and holds its brightness, then goes out: a flash, not a fade.
      alpha: { value: 0, ease: "Cubic.easeIn" },
      scaleX: { value: scale, ease: "Cubic.easeOut" },
      scaleY: { value: scale, ease: "Cubic.easeOut" },
      duration: options.durationMs,
      onComplete: () => {
        cleanup?.release(light);
        cleanup?.release(tween);
        light.destroy();
      }
    });
    cleanup?.trackTween(tween);
  }
}

/** Heavy chunks of metal thrown clear of a blast: they tumble up and out, then drop. */
export function heavyDebris(
  scene: Phaser.Scene,
  layer: Phaser.GameObjects.Container,
  x: number,
  y: number,
  options: HeavyDebrisOptions,
  cleanup?: VfxCleanupRegistry
): void {
  assertScene("heavyDebris", scene);
  assertFinite("heavyDebris", "x", x);
  assertFinite("heavyDebris", "y", y);
  assertPositiveFinite("heavyDebris", "count", options.count);
  assertPositiveFinite("heavyDebris", "reachPx", options.reachPx);
  assertPositiveFinite("heavyDebris", "sizePx", options.sizePx);
  assertPositiveFinite("heavyDebris", "durationMs", options.durationMs);
  assertFinite("heavyDebris", "tint", options.tint);
  if (!options.seed) throw new Error("Invalid VFX heavyDebris seed: expected a non-empty string");
  if (!layer || options.reducedMotion) return;
  ensureVfxTextures(scene);
  const random = seededRandom(options.seed);
  const localX = x - layer.x;
  const localY = y - layer.y;
  for (let index = 0; index < options.count; index += 1) {
    const angle = (Math.PI * 2 * (index + random() * 0.8)) / options.count;
    const reach = options.reachPx * (0.55 + random() * 0.45);
    const chunk = scene.add.image(localX, localY, index % 2 === 0 ? vfxTextureKeys.shard : vfxTextureKeys.shardWide);
    chunk.setTint(options.tint);
    chunk.setRotation(angle);
    chunk.setScale((options.sizePx * (0.7 + random() * 0.6)) / VFX_TEXTURE_CONFIG.shardWide.textureWidth);
    layer.add(chunk);
    cleanup?.trackObject(chunk);
    const tween = scene.tweens.add({
      targets: chunk,
      x: { value: localX + Math.cos(angle) * reach, ease: "Quad.easeOut" },
      // Up and out first, then pulled down past where it would have stopped.
      y: { value: localY + Math.sin(angle) * reach * 0.6 + reach * 0.75, ease: "Back.easeIn" },
      angle: { value: chunk.angle + (index % 2 === 0 ? 1 : -1) * (260 + random() * 260), ease: "Linear" },
      alpha: { value: 0, ease: "Cubic.easeIn" },
      duration: options.durationMs,
      onComplete: () => {
        cleanup?.release(chunk);
        cleanup?.release(tween);
        chunk.destroy();
      }
    });
    cleanup?.trackTween(tween);
  }
}

/** The light a rocket leaves along its lane: it runs out with the rocket, then narrows and goes. */
export function laneBeam(
  scene: Phaser.Scene,
  layer: Phaser.GameObjects.Container,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options: LaneBeamOptions,
  cleanup?: VfxCleanupRegistry
): void {
  assertScene("laneBeam", scene);
  assertFinite("laneBeam", "from.x", from.x);
  assertFinite("laneBeam", "from.y", from.y);
  assertFinite("laneBeam", "to.x", to.x);
  assertFinite("laneBeam", "to.y", to.y);
  assertPositiveFinite("laneBeam", "widthPx", options.widthPx);
  assertPositiveFinite("laneBeam", "travelMs", options.travelMs);
  assertPositiveFinite("laneBeam", "fadeMs", options.fadeMs);
  assertFinite("laneBeam", "tint", options.tint);
  if (!layer || options.reducedMotion) return;
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length === 0) return;
  const beam = scene.add.graphics({ x: from.x - layer.x, y: from.y - layer.y });
  beam.setBlendMode(Phaser.BlendModes.ADD);
  beam.setRotation(Math.atan2(to.y - from.y, to.x - from.x));
  beam.fillStyle(options.tint, 0.32);
  beam.fillRect(0, -options.widthPx / 2, length, options.widthPx);
  beam.fillStyle(0xffffff, 0.75);
  beam.fillRect(0, -options.widthPx / 8, length, options.widthPx / 4);
  beam.setScale(0, 1);
  layer.add(beam);
  cleanup?.trackObject(beam);
  const run = scene.tweens.add({
    targets: beam,
    scaleX: 1,
    duration: options.travelMs,
    // The same ease as the rocket's flight, so the light stays with the head.
    ease: "Quad.easeIn",
    onComplete: () => {
      cleanup?.release(run);
      const fade = scene.tweens.add({
        targets: beam,
        alpha: 0,
        scaleY: 0.15,
        duration: options.fadeMs,
        ease: "Quad.easeOut",
        onComplete: () => {
          cleanup?.release(beam);
          cleanup?.release(fade);
          beam.destroy();
        }
      });
      cleanup?.trackTween(fade);
    }
  });
  cleanup?.trackTween(run);
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
