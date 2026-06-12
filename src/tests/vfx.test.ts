import { describe, expect, it, vi } from "vitest";

vi.mock("phaser", () => ({
  default: {
    BlendModes: {
      ADD: "ADD"
    }
  }
}));

import { burst, shockwave, vfxTextureKeys } from "../game/vfx";

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
  });

  it("fails fast when shockwave receives invalid required inputs", () => {
    expect(() => shockwave(null as unknown as Parameters<typeof shockwave>[0], fakeLayer(), 0, 0, shockwaveOptions))
      .toThrow("Invalid VFX shockwave scene");
    expect(() => shockwave(fakeScene(), fakeLayer(), Number.NEGATIVE_INFINITY, 0, shockwaveOptions))
      .toThrow("Invalid VFX shockwave x");
    expect(() => shockwave(fakeScene(), fakeLayer(), 0, Number.NaN, shockwaveOptions))
      .toThrow("Invalid VFX shockwave y");
  });
});
