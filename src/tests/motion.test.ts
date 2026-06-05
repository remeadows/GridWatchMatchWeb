import { describe, expect, it } from "vitest";
import type { BoardSnapshot, CellState } from "../engine";
import { Grid2D } from "../engine/grid";
import { buildPostClearSnapshot } from "../game/motion";
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

function emptyCell(): CellState {
  return {
    baseTile: null,
    powerUp: null,
    overlay: null,
    underlay: null,
    generator: null,
    isMovable: true,
    debugTileId: null,
    debugDesignLocked: false
  };
}

function tileCell(baseTile: CellState["baseTile"]): CellState {
  return { ...emptyCell(), baseTile };
}

function snapshotOf(grid: Grid2D<CellState>): BoardSnapshot {
  return {
    grid,
    moveCount: 0,
    moveLimit: 30,
    objectiveProgress: {},
    objectiveTargets: {},
    spawnWeights: { packet: 1, firewall: 1, key: 1, threat: 1, zeroDay: 1 },
    rngSeed: "1",
    chainDepth: 0
  };
}

describe("buildPostClearSnapshot", () => {
  it("empties only the popped positions and preserves the rest", () => {
    const grid = new Grid2D<CellState>(3, 3, () => tileCell("packet"));
    grid.set({ row: 1, col: 1 }, tileCell("firewall"));
    const snap = snapshotOf(grid);

    const popped = new Set<string>(["0,0", "0,1", "0,2"]);
    const result = buildPostClearSnapshot(snap, popped);

    expect(result.grid.get({ row: 0, col: 0 }).baseTile).toBeNull();
    expect(result.grid.get({ row: 0, col: 1 }).baseTile).toBeNull();
    expect(result.grid.get({ row: 0, col: 2 }).baseTile).toBeNull();
    expect(result.grid.get({ row: 1, col: 1 }).baseTile).toBe("firewall");
    expect(result.grid.get({ row: 2, col: 2 }).baseTile).toBe("packet");
  });

  it("preserves generator, overlay, underlay, and isMovable on popped cells", () => {
    const grid = new Grid2D<CellState>(2, 2, () => tileCell("packet"));
    grid.set({ row: 0, col: 0 }, {
      ...tileCell("packet"),
      generator: "honeypot",
      overlay: { kind: "encryptedVolume", hp: 2 },
      underlay: { kind: "malwarePropagation", hp: 1 },
      isMovable: false
    });
    const snap = snapshotOf(grid);

    const result = buildPostClearSnapshot(snap, new Set(["0,0"]));
    const cell = result.grid.get({ row: 0, col: 0 });
    expect(cell.baseTile).toBeNull();
    expect(cell.powerUp).toBeNull();
    expect(cell.generator).toBe("honeypot");
    expect(cell.overlay).toEqual({ kind: "encryptedVolume", hp: 2 });
    expect(cell.underlay).toEqual({ kind: "malwarePropagation", hp: 1 });
    expect(cell.isMovable).toBe(false);
  });

  it("does not mutate the input grid", () => {
    const grid = new Grid2D<CellState>(2, 2, () => tileCell("packet"));
    const snap = snapshotOf(grid);
    buildPostClearSnapshot(snap, new Set(["0,0"]));
    expect(snap.grid.get({ row: 0, col: 0 }).baseTile).toBe("packet");
  });
});
