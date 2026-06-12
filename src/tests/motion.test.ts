import { describe, expect, it } from "vitest";
import type { BoardDelta, BoardSnapshot, CellState, MoveEvent, SpawnEvent } from "../engine";
import { Grid2D } from "../engine/grid";
import { buildPostClearSnapshot } from "../game/motion";
import { cascadeHiddenDestinations } from "../game/motion";
import { clearedKeysFromDelta } from "../game/motion";
import { computeCentroidStagger } from "../game/motion";
import { orderCascadeMoves } from "../game/motion";
import { quadraticFlightPath } from "../game/motion";
import { radialStagger } from "../game/motion";
import { resolvedPopKeys } from "../game/motion";
import { rowDestructionOrder } from "../game/motion";
import { seededAngleJitter } from "../game/motion";
import { sweepStagger } from "../game/motion";

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

function emptyDelta(): BoardDelta {
  return {
    clears: [],
    moves: [],
    spawns: [],
    powerUpEvents: [],
    objectiveEvents: [],
    chainDepth: 0,
    scoreGained: 0,
    isWin: false,
    isFail: false,
    shuffleAttempts: 0
  };
}

describe("clearedKeysFromDelta", () => {
  it("returns an empty set for a delta with no clears", () => {
    expect(clearedKeysFromDelta(emptyDelta())).toEqual(new Set());
  });

  it("maps clear positions to row,col keys", () => {
    const delta = emptyDelta();
    delta.clears = [
      { position: { row: 1, col: 2 }, tileType: "packet", clearedByPowerUp: true, contributedToObjective: true, objectiveId: "packets" },
      { position: { row: 3, col: 4 }, tileType: "firewall", clearedByPowerUp: true, contributedToObjective: false, objectiveId: null }
    ];

    expect(clearedKeysFromDelta(delta)).toEqual(new Set(["1,2", "3,4"]));
  });

  it("dedupes duplicate clear positions", () => {
    const delta = emptyDelta();
    delta.clears = [
      { position: { row: 2, col: 5 }, tileType: "key", clearedByPowerUp: true, contributedToObjective: false, objectiveId: null },
      { position: { row: 2, col: 5 }, tileType: "key", clearedByPowerUp: true, contributedToObjective: false, objectiveId: null }
    ];

    expect(clearedKeysFromDelta(delta)).toEqual(new Set(["2,5"]));
  });
});

describe("resolvedPopKeys", () => {
  it("combines match keys with only positions that actually cleared", () => {
    const delta = emptyDelta();
    delta.clears = [
      { position: { row: 0, col: 0 }, tileType: "packet", clearedByPowerUp: true, contributedToObjective: false, objectiveId: null }
    ];
    delta.powerUpEvents = [
      {
        powerUpType: { kind: "tnt" },
        origin: { row: 0, col: 0 },
        affectedPositions: [{ row: 0, col: 0 }, { row: 1, col: 1 }],
        trigger: { kind: "tap" }
      }
    ];

    expect(resolvedPopKeys(new Set(["2,2"]), delta)).toEqual(new Set(["0,0", "2,2"]));
  });
});

describe("radialStagger", () => {
  it("returns an empty map for no positions", () => {
    expect(radialStagger({ row: 0, col: 0 }, [], 25, 60).size).toBe(0);
  });

  it("delays positions by distance from an origin and clamps to maxMs", () => {
    const result = radialStagger(
      { row: 2, col: 2 },
      [{ row: 2, col: 2 }, { row: 2, col: 3 }, { row: 2, col: 5 }],
      25,
      60
    );

    expect(result.get("2,2")).toBe(0);
    expect(result.get("2,3")).toBe(25);
    expect(result.get("2,5")).toBe(60);
  });
});

describe("sweepStagger", () => {
  it("returns an empty map for no positions", () => {
    expect(sweepStagger({ row: 0, col: 0 }, [], "horizontal", 32).size).toBe(0);
  });

  it("uses column distance for a horizontal sweep", () => {
    const result = sweepStagger(
      { row: 3, col: 3 },
      [{ row: 3, col: 1 }, { row: 3, col: 3 }, { row: 3, col: 6 }],
      "horizontal",
      32
    );

    expect(result.get("3,3")).toBe(0);
    expect(result.get("3,1")).toBe(64);
    expect(result.get("3,6")).toBe(96);
  });

  it("uses row distance for a vertical sweep", () => {
    const result = sweepStagger(
      { row: 4, col: 2 },
      [{ row: 1, col: 2 }, { row: 4, col: 2 }, { row: 6, col: 2 }],
      "vertical",
      40
    );

    expect(result.get("4,2")).toBe(0);
    expect(result.get("1,2")).toBe(120);
    expect(result.get("6,2")).toBe(80);
  });
});

describe("rowDestructionOrder", () => {
  it("returns rows bottom-to-top", () => {
    expect(rowDestructionOrder(5)).toEqual([4, 3, 2, 1, 0]);
  });

  it("returns an empty order for no rows", () => {
    expect(rowDestructionOrder(0)).toEqual([]);
  });

  it("returns an empty order for non-finite rows", () => {
    expect(rowDestructionOrder(Number.POSITIVE_INFINITY)).toEqual([]);
    expect(rowDestructionOrder(Number.NaN)).toEqual([]);
  });
});

describe("quadraticFlightPath", () => {
  it("samples an upward quadratic arc including endpoints", () => {
    const path = quadraticFlightPath({ x: 0, y: 0 }, { x: 10, y: 0 }, 5, 3);

    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: -5 },
      { x: 10, y: 0 }
    ]);
  });

  it("returns endpoints when samples is below the minimum arc count", () => {
    expect(quadraticFlightPath({ x: 2, y: 3 }, { x: 8, y: 9 }, 12, 1)).toEqual([
      { x: 2, y: 3 },
      { x: 8, y: 9 }
    ]);
  });

  it("returns an empty path for non-finite sample counts", () => {
    expect(quadraticFlightPath({ x: 2, y: 3 }, { x: 8, y: 9 }, 12, Number.NEGATIVE_INFINITY)).toEqual([]);
    expect(quadraticFlightPath({ x: 2, y: 3 }, { x: 8, y: 9 }, 12, Number.NaN)).toEqual([]);
  });
});

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

function move(from: [number, number], to: [number, number]): MoveEvent {
  return {
    from: { row: from[0], col: from[1] },
    to: { row: to[0], col: to[1] },
    tileType: "packet"
  };
}

function spawn(position: [number, number]): SpawnEvent {
  return { position: { row: position[0], col: position[1] }, tileType: "packet", asPowerUp: null };
}

/**
 * Replays the in-place occupant remap that BoardScene.playCascadeAndSpawn runs.
 * Each "sprite" is identified by the key of the cell it starts in, so a correct
 * remap leaves the sprite that started at `from` living under the `to` key.
 */
function simulateRemap(moves: ReadonlyArray<MoveEvent>): Map<string, string> {
  const occupants = new Map<string, string>();
  for (const m of moves) {
    const fromKey = `${m.from.row},${m.from.col}`;
    occupants.set(fromKey, fromKey);
  }
  for (const m of moves) {
    const fromKey = `${m.from.row},${m.from.col}`;
    const sprite = occupants.get(fromKey);
    if (sprite === undefined) continue;
    occupants.delete(fromKey);
    occupants.set(`${m.to.row},${m.to.col}`, sprite);
  }
  return occupants;
}

describe("orderCascadeMoves", () => {
  it("keeps a remap correct even when moves arrive destination-top-first", () => {
    // A collapsing column: each tile falls one row into the cell vacated below
    // it. Source and destination cells overlap between moves, so processing
    // order matters. Feed them top-first (the hostile order).
    const topFirst = [move([0, 0], [1, 0]), move([1, 0], [2, 0]), move([2, 0], [3, 0])];

    const occupants = simulateRemap(orderCascadeMoves(topFirst));

    // Every destination must hold the sprite that started at the matching source.
    for (const m of topFirst) {
      expect(occupants.get(`${m.to.row},${m.to.col}`)).toBe(`${m.from.row},${m.from.col}`);
    }
  });

  it("orders a collapsing column destination-bottom-first", () => {
    const topFirst = [move([0, 0], [1, 0]), move([1, 0], [2, 0]), move([2, 0], [3, 0])];
    const ordered = orderCascadeMoves(topFirst);
    expect(ordered.map((m) => m.to.row)).toEqual([3, 2, 1]);
  });

  it("does not mutate the input array", () => {
    const moves = [move([0, 0], [1, 0]), move([2, 0], [3, 0])];
    const before = [...moves];
    orderCascadeMoves(moves);
    expect(moves).toEqual(before);
  });
});

describe("cascadeHiddenDestinations", () => {
  it("hides a pure landing cell", () => {
    const hidden = cascadeHiddenDestinations([move([0, 0], [3, 0])], []);
    expect(hidden).toEqual(new Set(["3,0"]));
  });

  it("does not hide a destination that is also a move source (collapsing column)", () => {
    // 0->1, 1->2, 2->3: cells 1 and 2 are both a landing spot and a source, so
    // hiding them would drop the occupant sprites the lower moves need.
    const moves = [move([0, 0], [1, 0]), move([1, 0], [2, 0]), move([2, 0], [3, 0])];
    const hidden = cascadeHiddenDestinations(moves, []);
    expect(hidden.has("1,0")).toBe(false);
    expect(hidden.has("2,0")).toBe(false);
    // Only the bottom, pure-destination cell is hidden.
    expect(hidden).toEqual(new Set(["3,0"]));
  });

  it("hides spawn target cells", () => {
    const hidden = cascadeHiddenDestinations([], [spawn([0, 0]), spawn([1, 0])]);
    expect(hidden).toEqual(new Set(["0,0", "1,0"]));
  });

  it("does not hide a spawn target that is also a move source (column refill)", () => {
    // Tile at row 0 falls to row 3, and a fresh tile spawns into the vacated
    // row 0. Row 0 must stay visible so the falling tile keeps its real sprite.
    const hidden = cascadeHiddenDestinations([move([0, 0], [3, 0])], [spawn([0, 0])]);
    expect(hidden.has("0,0")).toBe(false);
    expect(hidden).toEqual(new Set(["3,0"]));
  });
});
