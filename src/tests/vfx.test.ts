import { describe, expect, it, vi } from "vitest";

vi.mock("phaser", () => ({
  default: {
    BlendModes: {
      ADD: "ADD"
    }
  }
}));

import {
  burst,
  PresentationVfxBudget,
  reducedMotionVfxPlan,
  screenFlash,
  shockwave,
  vfxCleanupDelayMs,
  vfxIntensity,
  VfxCleanupRegistry,
  vfxTextureKeys
} from "../game/vfx";
import { PRESENTATION_RESOURCE_LIMITS } from "../game/presentation";
import { VFX_BUDGETS, VFX_SCREEN_FLASH, VFX_TEXTURE_CONFIG } from "../game/vfxTiming";

const burstOptions = {
  texture: vfxTextureKeys.spark,
  count: 4,
  speed: 120,
  lifespanMs: 90,
  tint: 0xffffff,
  scale: 0.5
};

const shockwaveOptions = {
  radiusPx: 40,
  durationMs: 120,
  tint: 0xffffff
};

function fakeLayer(): Parameters<typeof burst>[1] {
  return {
    x: 10,
    y: 20,
    add: vi.fn()
  } as unknown as Parameters<typeof burst>[1];
}

function fakeScene(): Parameters<typeof burst>[0] {
  const particleEmitter = {
    explode: vi.fn(),
    destroy: vi.fn()
  };
  const graphics = {
    setPosition: vi.fn(),
    setScale: vi.fn(),
    lineStyle: vi.fn(),
    strokeCircle: vi.fn(),
    destroy: vi.fn()
  };

  return {
    textures: {
      exists: vi.fn(() => true)
    },
    add: {
      particles: vi.fn(() => particleEmitter),
      graphics: vi.fn(() => graphics)
    },
    time: {
      delayedCall: vi.fn()
    },
    tweens: {
      add: vi.fn()
    }
  } as unknown as Parameters<typeof burst>[0];
}

describe("vfx guards", () => {
  it("fails fast when burst receives invalid required inputs", () => {
    expect(() => burst(null as unknown as Parameters<typeof burst>[0], fakeLayer(), 0, 0, burstOptions))
      .toThrow("Invalid VFX burst scene");
    expect(() => burst(fakeScene(), fakeLayer(), Number.NaN, 0, burstOptions))
      .toThrow("Invalid VFX burst x");
    expect(() => burst(fakeScene(), fakeLayer(), 0, Number.POSITIVE_INFINITY, burstOptions))
      .toThrow("Invalid VFX burst y");
    expect(() => burst(fakeScene(), fakeLayer(), 0, 0, { ...burstOptions, count: 0 }))
      .toThrow("Invalid VFX burst count");
    expect(() => burst(fakeScene(), fakeLayer(), 0, 0, { ...burstOptions, scale: Number.NaN }))
      .toThrow("Invalid VFX burst scale");
  });

  it("fails fast when shockwave receives invalid required inputs", () => {
    expect(() => shockwave(null as unknown as Parameters<typeof shockwave>[0], fakeLayer(), 0, 0, shockwaveOptions))
      .toThrow("Invalid VFX shockwave scene");
    expect(() => shockwave(fakeScene(), fakeLayer(), Number.NEGATIVE_INFINITY, 0, shockwaveOptions))
      .toThrow("Invalid VFX shockwave x");
    expect(() => shockwave(fakeScene(), fakeLayer(), 0, Number.NaN, shockwaveOptions))
      .toThrow("Invalid VFX shockwave y");
  });

  it("fails fast when screen flash exceeds its accessibility bounds", () => {
    expect(() => screenFlash(fakeScene(), fakeLayer(), { alpha: VFX_SCREEN_FLASH.alpha + 0.01 }))
      .toThrow("Invalid VFX screenFlash alpha");
    expect(() => screenFlash(fakeScene(), fakeLayer(), { durationMs: 0 }))
      .toThrow("Invalid VFX screenFlash durationMs");
  });
});

describe("VFX presentation contract", () => {
  it("defines the complete generated texture vocabulary", () => {
    expect(Object.keys(VFX_TEXTURE_CONFIG).sort()).toEqual([
      "glow",
      "hotCore",
      "ring",
      "shard",
      "shardWide",
      "smoke",
      "spark",
      "streak"
    ]);
    expect(Object.values(VFX_TEXTURE_CONFIG).every((config) => config.textureWidth > 0 && config.textureHeight > 0)).toBe(true);
  });

  it("keeps VFX budgets finite, positive, and cleanup beyond the longest particle lifetime", () => {
    expect(Object.values(VFX_BUDGETS).every((value) => Number.isFinite(value) && value > 0)).toBe(true);
    expect(vfxCleanupDelayMs(VFX_BUDGETS.longestParticleLifetimeMs)).toBeGreaterThan(VFX_BUDGETS.longestParticleLifetimeMs);
  });

  it("caps desktop and mobile effect intensity and respects flash accessibility limits", () => {
    expect(vfxIntensity(999, false, "desktop")).toBeLessThanOrEqual(VFX_BUDGETS.desktopIntensityCap);
    expect(vfxIntensity(999, true, "mobile")).toBeLessThanOrEqual(VFX_BUDGETS.mobileIntensityCap);
    expect(vfxIntensity(2, false, "desktop")).toBeLessThanOrEqual(vfxIntensity(9, true, "desktop"));
    expect(VFX_SCREEN_FLASH.alpha).toBeLessThanOrEqual(0.38);
    expect(VFX_SCREEN_FLASH.durationMs).toBeLessThanOrEqual(80);
  });

  it("rejects invalid visual parameters and makes reduced motion a no-op", () => {
    expect(() => vfxIntensity(Number.NaN, false, "desktop")).toThrow("affectedCount");
    expect(() => vfxCleanupDelayMs(Number.POSITIVE_INFINITY)).toThrow("lifespanMs");
    expect(reducedMotionVfxPlan(true)).toEqual({ flash: false, particles: false, shake: false, travel: false });
    expect(reducedMotionVfxPlan(false)).toEqual({ flash: true, particles: true, shake: true, travel: true });
  });

  it("enforces desktop and mobile emitter, particle, arc, and audio allocations", () => {
    const budget = new PresentationVfxBudget("desktop");

    expect(budget.allocateEmitter(100)).toBe(100);
    expect(budget.allocateEmitter(100)).toBe(80);
    for (let index = 0; index < 20; index += 1) budget.allocateEmitter(1);
    for (let index = 0; index < 20; index += 1) budget.allocateArc();
    for (let index = 0; index < 20; index += 1) budget.allocateAudio();

    expect(budget.snapshot().activeEmitters).toBeLessThanOrEqual(PRESENTATION_RESOURCE_LIMITS.concurrentEmitters);
    expect(budget.snapshot().liveParticles).toBeLessThanOrEqual(PRESENTATION_RESOURCE_LIMITS.liveParticles.desktop);
    expect(budget.snapshot().simultaneousArcs).toBeLessThanOrEqual(PRESENTATION_RESOURCE_LIMITS.simultaneousArcs);
    expect(budget.snapshot().activeBoardAudio).toBeLessThanOrEqual(PRESENTATION_RESOURCE_LIMITS.activeBoardAudio);

    budget.reset("mobile");
    expect(budget.allocateEmitter(999)).toBe(PRESENTATION_RESOURCE_LIMITS.liveParticles.mobile);
    expect(budget.snapshot().liveParticles).toBe(PRESENTATION_RESOURCE_LIMITS.liveParticles.mobile);
  });

  it("suppresses scheduled callbacks after disposal and reports an empty registry", () => {
    let scheduledCallback: (() => void) | undefined;
    const timer = { remove: vi.fn(), destroy: vi.fn() };
    const scene = {
      add: {},
      time: {
        delayedCall: vi.fn((_delay: number, callback: () => void) => {
          scheduledCallback = callback;
          return timer;
        })
      }
    } as unknown as Parameters<VfxCleanupRegistry["schedule"]>[0];
    const callback = vi.fn();
    const registry = new VfxCleanupRegistry("desktop");

    registry.schedule(scene, 100, callback);
    expect(registry.resourceCounts().activeTimers).toBe(1);
    registry.dispose();
    scheduledCallback?.();

    expect(callback).not.toHaveBeenCalled();
    expect(Object.values(registry.resourceCounts().current).every((value) => value === 0)).toBe(true);
  });

  it("releases board audio slots on the short cue window instead of the particle tail", () => {
    const scene = {
      add: {},
      time: {
        delayedCall: vi.fn((_delay: number, _callback: () => void) => ({ remove: vi.fn(), destroy: vi.fn() }))
      }
    } as unknown as Parameters<VfxCleanupRegistry["allocateAudio"]>[0];
    const registry = new VfxCleanupRegistry("desktop");

    expect(registry.allocateAudio(scene)).toBe(true);
    expect(scene.time.delayedCall).toHaveBeenCalledWith(PRESENTATION_RESOURCE_LIMITS.boardAudioSlotMs, expect.any(Function));
    expect(PRESENTATION_RESOURCE_LIMITS.boardAudioSlotMs).toBeLessThan(VFX_BUDGETS.longestParticleLifetimeMs);
  });

  it("cleans effect resources no later than the longest tail plus 250 ms", () => {
    expect(vfxCleanupDelayMs(VFX_BUDGETS.longestParticleLifetimeMs))
      .toBeLessThanOrEqual(VFX_BUDGETS.longestParticleLifetimeMs + PRESENTATION_RESOURCE_LIMITS.cleanupTailBufferMs);
  });
});
