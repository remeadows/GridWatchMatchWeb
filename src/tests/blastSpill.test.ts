import { describe, expect, it } from "vitest";
import { spillShardPlan } from "../game/blastSpill";

const base = { radiusPx: 100, shards: 12, tint: 0xff9a43, seed: "tnt:3,3" };

describe("blast spill", () => {
  it("plans the same shards for the same blast", () => {
    expect(spillShardPlan(base)).toEqual(spillShardPlan(base));
    expect(spillShardPlan(base)).not.toEqual(spillShardPlan({ ...base, seed: "tnt:3,4" }));
  });

  it("throws every shard well clear of its centre, and fades it out", () => {
    for (const shard of spillShardPlan(base)) {
      const first = shard.frames[0];
      const last = shard.frames.at(-1)!;
      expect(Math.hypot(first.x, first.y)).toBe(0);
      expect(first.opacity).toBe(1);
      expect(last.opacity).toBe(0);
      // Half, not all: a shard thrown straight up comes part of the way back down.
      expect(Math.max(...shard.frames.map(frame => Math.hypot(frame.x, frame.y)))).toBeGreaterThanOrEqual(base.radiusPx * 0.5);
    }
  });

  it("goes all round by default, and within its cone when given a heading", () => {
    const sides = spillShardPlan(base).map(shard => Math.sign(shard.frames[1].x));
    expect(new Set(sides).size).toBe(2);
    const rightward = spillShardPlan({ ...base, headingDeg: 0, spreadDeg: 70 });
    for (const shard of rightward) expect(shard.frames[1].x).toBeGreaterThan(0);
  });

  it("pulls every shard down as it flies", () => {
    const up = spillShardPlan({ ...base, headingDeg: -90, spreadDeg: 0 })[0];
    expect(up.frames.at(-1)!.y).toBeGreaterThan(up.frames[2].y);
  });
});
