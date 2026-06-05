import { describe, expect, it } from "vitest";
import { computeCentroidStagger } from "../game/motion";
import { seededAngleJitter } from "../game/motion";

describe("computeCentroidStagger", () => {
  it("returns an empty map for no positions", () => {
    const result = computeCentroidStagger([], { perUnitMs: 20, maxMs: 100 });
    expect(result.size).toBe(0);
  });

  it("gives a single position zero delay", () => {
    const result = computeCentroidStagger(
      [{ row: 3, col: 3 }],
      { perUnitMs: 20, maxMs: 100 }
    );
    expect(result.get("3,3")).toBe(0);
  });

  it("orders three collinear positions by distance from centroid", () => {
    const result = computeCentroidStagger(
      [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }],
      { perUnitMs: 30, maxMs: 200 }
    );
    // centroid is (0,1); distances are 1, 0, 1
    expect(result.get("0,1")).toBe(0);
    expect(result.get("0,0")).toBe(30);
    expect(result.get("0,2")).toBe(30);
  });

  it("clamps to maxMs", () => {
    const result = computeCentroidStagger(
      [{ row: 0, col: 0 }, { row: 0, col: 10 }],
      { perUnitMs: 100, maxMs: 75 }
    );
    expect(result.get("0,0")).toBe(75);
    expect(result.get("0,10")).toBe(75);
  });
});

describe("seededAngleJitter", () => {
  it("returns the same value for the same (position, seed)", () => {
    const a = seededAngleJitter({ row: 2, col: 5 }, "abc", 12);
    const b = seededAngleJitter({ row: 2, col: 5 }, "abc", 12);
    expect(a).toBe(b);
  });

  it("differs across positions for a fixed seed", () => {
    const a = seededAngleJitter({ row: 0, col: 0 }, "seed", 20);
    const b = seededAngleJitter({ row: 0, col: 1 }, "seed", 20);
    expect(a).not.toBe(b);
  });

  it("stays within [-amplitude, +amplitude]", () => {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const v = seededAngleJitter({ row: r, col: c }, "x", 15);
        expect(v).toBeGreaterThanOrEqual(-15);
        expect(v).toBeLessThanOrEqual(15);
      }
    }
  });
});
