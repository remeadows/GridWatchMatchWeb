import { describe, expect, it } from "vitest";
import { BoardEngine, BoardEngineError, detectMatches, type BoardAction, type GridPosition } from "../engine";
import { testLevel } from "./helpers/testBoard";

const LETTER = { packet: "p", firewall: "f", key: "k", threat: "t", zeroDay: "z" } as const;

function layout(engine: BoardEngine): string[] {
  const { grid } = engine.snapshot;
  const rows: string[] = [];
  for (let row = 0; row < grid.rows; row += 1) {
    const cells: string[] = [];
    for (let col = 0; col < grid.cols; col += 1) {
      const cell = grid.get({ row, col });
      cells.push(cell.baseTile ? LETTER[cell.baseTile] : ".");
    }
    rows.push(cells.join(" "));
  }
  return rows;
}

function plainRows(rows: string[]): string[] {
  return rows.map((row) => row.replace(/[#!~]\d?/g, ""));
}

/** Builds the engine and proves the constructor kept the board exactly as written. */
function engineFor(rows: string[], seed = 7): BoardEngine {
  const engine = new BoardEngine(testLevel(rows), seed);
  expect(layout(engine)).toEqual(plainRows(rows));
  return engine;
}

function swap(from: GridPosition, to: GridPosition): BoardAction {
  return { kind: "swap", from, to };
}

function touches(action: BoardAction, position: GridPosition): boolean {
  const same = (other: GridPosition) => other.row === position.row && other.col === position.col;
  if (action.kind === "swap") return same(action.from) || same(action.to);
  return same(action.at);
}

function invalidSwapCode(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof BoardEngineError ? error.code : String(error);
  }
  return undefined;
}

// A 5 x 5 board with no match anywhere, then one ready match in row 0 (swap (0,2)-(0,3)).
const SWAP_BOARD = [
  "p p k p z",
  "k t z p f",
  "z p f#2 k t",
  "f k t z p",
  "t z p f k"
];

// Row 4 becomes p p p after swapping (4,2)-(4,3). The pane sits directly above (4,2).
const ROW_MATCH_BOARD = [
  "z t k z f",
  "k f z p t",
  "p k t z f",
  "z t k#3 f z",
  "p p k p f"
];

describe("panes really block", () => {
  it("a piece under a pane cannot swap", () => {
    const engine = engineFor(SWAP_BOARD);
    const pane = { row: 2, col: 2 };
    expect(engine.snapshot.grid.get(pane).isMovable).toBe(false);
    expect(invalidSwapCode(() => engine.apply(swap(pane, { row: 2, col: 3 })))).toBe("invalidSwap");
    expect(invalidSwapCode(() => engine.apply(swap({ row: 2, col: 1 }, pane)))).toBe("invalidSwap");
    const moves = engine.validMoves();
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.some((move) => touches(move, pane))).toBe(false);
  });

  it("a piece under a pane cannot match", () => {
    const rows = [
      "z t k z f",
      "k f z p t",
      "p p p#3 z f",
      "z t k f z",
      "z z k z t"
    ];
    const engine = engineFor(rows);
    expect(detectMatches(engine.snapshot.grid)).toHaveLength(0);
    const paneId = engine.snapshot.grid.get({ row: 2, col: 2 }).debugTileId;

    // A neighbouring swap elsewhere on the board: z z z along the bottom row.
    const delta = engine.apply(swap({ row: 4, col: 2 }, { row: 4, col: 3 }));
    expect(delta.clears.length).toBeGreaterThanOrEqual(3);
    const pane = engine.snapshot.grid.get({ row: 2, col: 2 });
    expect(pane.baseTile).toBe("packet");
    expect(pane.debugTileId).toBe(paneId);
    expect(pane.overlay).not.toBeNull();
    const clearedKeys = delta.clears.map((clear) => `${clear.position.row},${clear.position.col}`);
    expect(clearedKeys).not.toContain("2,2");
  });

  it("a piece under a pane does not fall", () => {
    const engine = engineFor(ROW_MATCH_BOARD);
    const pane = { row: 3, col: 2 };
    const before = engine.snapshot.grid.get(pane);
    const delta = engine.apply(swap({ row: 4, col: 2 }, { row: 4, col: 3 }));
    expect(delta.clears.map((clear) => `${clear.position.row},${clear.position.col}`)).toContain("4,2");
    const after = engine.snapshot.grid.get(pane);
    expect(after.debugTileId).toBe(before.debugTileId);
    expect(after.baseTile).toBe("key");
    expect(delta.moves.some((move) => move.from.row === 3 && move.from.col === 2)).toBe(false);
  });

  it("a refill below a pane stays below the pane", () => {
    // Swap (3,3)-(4,3): row 3 becomes p p p and row 4 becomes f f f, so both cells under the pane clear.
    const rows = [
      "z t k z f",
      "k f z p t",
      "p k t#3 z f",
      "k p p f z",
      "t f f p k"
    ];
    // Random refills can cascade; judge the seeds where they do not, so the clear is the whole move.
    let checked = 0;
    for (let seed = 1; seed <= 30; seed += 1) {
      const engine = engineFor(rows, seed);
      const above = [0, 1].map((row) => engine.snapshot.grid.get({ row, col: 2 }));
      const pane = engine.snapshot.grid.get({ row: 2, col: 2 });
      const delta = engine.apply(swap({ row: 3, col: 3 }, { row: 4, col: 3 }));
      const cleared = delta.clears.map((clear) => `${clear.position.row},${clear.position.col}`);
      expect(cleared).toContain("3,2");
      expect(cleared).toContain("4,2");
      const grid = engine.snapshot.grid;
      for (const position of grid.allPositions) {
        expect(grid.get(position).baseTile, `seed ${seed} cell ${position.row},${position.col}`).not.toBeNull();
      }
      if (delta.chainDepth > 0) continue;
      checked += 1;
      // The cells under the pane refilled from their own segment: spawns at rows 3 and 4 of column 2 only.
      const spawnRows = delta.spawns.filter((spawn) => spawn.position.col === 2).map((spawn) => spawn.position.row).sort();
      expect(spawnRows).toEqual([3, 4]);
      expect(delta.moves.some((move) => move.from.col === 2 || move.to.col === 2)).toBe(false);
      expect(grid.get({ row: 2, col: 2 }).debugTileId).toBe(pane.debugTileId);
      [0, 1].forEach((row, index) => {
        expect(grid.get({ row, col: 2 }).debugTileId).toBe(above[index].debugTileId);
        expect(grid.get({ row, col: 2 }).baseTile).toBe(above[index].baseTile);
      });
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("a match next to a pane removes one layer", () => {
    const engine = engineFor(ROW_MATCH_BOARD);
    expect(engine.snapshot.grid.get({ row: 3, col: 2 }).overlay?.hp).toBe(3);
    engine.apply(swap({ row: 4, col: 2 }, { row: 4, col: 3 }));
    expect(engine.snapshot.grid.get({ row: 3, col: 2 }).overlay?.hp).toBe(2);
  });

  it("a power-up hit removes one layer and leaves the piece", () => {
    const rows = [
      "z t k z f",
      "k f z p t",
      "p k f#2 z f",
      "z t k f z",
      "t z p k f"
    ];
    const engine = engineFor(rows);
    const pane = { row: 2, col: 2 };
    const id = engine.snapshot.grid.get(pane).debugTileId;
    engine.apply({ kind: "activateBooster", booster: "rocket", at: { row: 2, col: 0 } });
    const after = engine.snapshot.grid.get(pane);
    expect(after.overlay?.hp).toBe(1);
    expect(after.baseTile).toBe("firewall");
    expect(after.debugTileId).toBe(id);
    expect(after.isMovable).toBe(false);
  });

  it("a power-up clearing a neighbouring cell does not chip a pane", () => {
    const rows = [
      "z t k z f",
      "k f z p t",
      "p k f#2 z f",
      "z t k f z",
      "t z p k f"
    ];
    const engine = engineFor(rows);
    // The rocket sweeps row 1, which holds the cell above the pane but not the pane itself.
    engine.apply({ kind: "activateBooster", booster: "rocket", at: { row: 1, col: 0 } });
    const after = engine.snapshot.grid.get({ row: 2, col: 2 });
    expect(after.overlay?.hp).toBe(2);
  });

  it("one move removes at most one layer per pane", () => {
    // Swap (2,0)-(2,1) clears column 1 rows 2-4, beside the pane. The pieces that fall then match
    // again in row 4 (f f f) over the cell under the pane: a second match beside the same pane.
    const rows = [
      "z t k z p",
      "p f z p k",
      "p k t z f",
      "z p k#3 t z",
      "f p f k t"
    ];
    const engine = engineFor(rows);
    const delta = engine.apply(swap({ row: 2, col: 0 }, { row: 2, col: 1 }));
    expect(delta.chainDepth).toBeGreaterThanOrEqual(1);
    const cleared = delta.clears.map((clear) => `${clear.position.row},${clear.position.col}`);
    expect(cleared).toContain("3,1");
    expect(cleared).toContain("4,2");
    expect(engine.snapshot.grid.get({ row: 3, col: 2 }).overlay?.hp).toBe(2);
  });

  it("a broken pane frees its piece", () => {
    const rows = [
      "z t k z f",
      "k f z p t",
      "f k f#1 t p",
      "z p t p z",
      "t z p f k"
    ];
    const engine = engineFor(rows);
    const pane = { row: 2, col: 2 };
    const id = engine.snapshot.grid.get(pane).debugTileId;
    // Column 3 rows 1-3 match beside the pane and the last layer goes.
    engine.apply(swap({ row: 2, col: 3 }, { row: 2, col: 4 }));
    const freed = engine.snapshot.grid.get(pane);
    expect(freed.overlay).toBeNull();
    expect(freed.isMovable).toBe(true);
    expect(freed.baseTile).toBe("firewall");
    expect(freed.debugTileId).toBe(id);

    // Next move: row 2 becomes f f f through the freed piece.
    const delta = engine.apply(swap({ row: 2, col: 1 }, { row: 1, col: 1 }));
    expect(delta.clears.map((clear) => `${clear.position.row},${clear.position.col}`)).toContain("2,2");
  });

  it("a board with no legal move opens a pane instead of throwing", () => {
    // Every cell is a 3-layer pane except row 4, cols 0-3. Matching there leaves three fresh cells
    // and one firewall, which often cannot move; the engine must open a pane, never throw.
    const rows = [
      "p#3 f#3 k#3 t#3 z#3",
      "k#3 t#3 z#3 p#3 f#3",
      "z#3 p#3 f#3 k#3 t#3",
      "f#3 k#3 t#3 z#3 p#3",
      "p p f p t#3"
    ];
    let opened = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const engine = engineFor(rows, seed);
      const delta = engine.apply(swap({ row: 4, col: 2 }, { row: 4, col: 3 }));
      expect(delta).toBeDefined();
      expect(engine.validMoves().length).toBeGreaterThan(0);
      let panes = 0;
      const { grid } = engine.snapshot;
      for (const position of grid.allPositions) if (grid.get(position).overlay) panes += 1;
      if (panes < 20) opened += 1;
    }
    expect(opened).toBeGreaterThan(0);
  });

  it("a match that makes a power-up next to a pane removes one layer", () => {
    // Swap (3,2)-(4,2): row 3 becomes p p p p, a rocket forms at (3,2) and the pane above it is the only neighbour.
    const rows = [
      "z t k z f",
      "k f z t t",
      "z k t#3 f z",
      "p p k p z",
      "t f p z k"
    ];
    const engine = engineFor(rows);
    const delta = engine.apply(swap({ row: 3, col: 2 }, { row: 4, col: 2 }));
    expect(delta.spawns.some((spawn) => spawn.asPowerUp !== null)).toBe(true);
    expect(engine.snapshot.grid.get({ row: 2, col: 2 }).overlay?.hp).toBe(2);
  });

  it("a dense board with no legal move at the start opens a pane", () => {
    const rows = [
      "p#3 f#3 k#3 t#3 z#3",
      "k#3 t#3 z#3 p#3 f#3",
      "z#3 p#3 f#3 k#3 t#3",
      "f#3 k#3 t#3 z#3 p#3",
      "p f p f t#3"
    ];
    const engine = new BoardEngine(testLevel(rows), 5);
    expect(engine.validMoves().length).toBeGreaterThan(0);
  });

  it("a booster on a pane fires and removes one layer, and the piece stays", () => {
    const rows = [
      "z t k z f",
      "k f z p t",
      "p k f#2 z f",
      "z t k f z",
      "t z p k f"
    ];
    const engine = engineFor(rows);
    const pane = { row: 2, col: 2 };
    const id = engine.snapshot.grid.get(pane).debugTileId;
    const delta = engine.apply({ kind: "activateBooster", booster: "rocket", at: pane });
    expect(delta.powerUpEvents.length).toBeGreaterThan(0);
    const after = engine.snapshot.grid.get(pane);
    expect(after.overlay?.hp).toBe(1);
    expect(after.baseTile).toBe("firewall");
    expect(after.debugTileId).toBe(id);
    expect(after.powerUp).toBeNull();
  });
});

// Swapping (4,2)-(4,3) makes z z z along the bottom row, which touches (3,0), (3,1), (3,2) and (4,3).
function malwareBoard(top: string, row3 = "z t k f z"): string[] {
  return [top, "k f z p t", "p p t z f", row3, "z z k z t"];
}
const MALWARE_SWAP = swap({ row: 4, col: 2 }, { row: 4, col: 3 });
const MALWARE_GOAL = [{ id: "malware", target: 1, displayName: "Remove all malware", tileType: null }];

function malwareCount(engine: BoardEngine): number {
  const { grid } = engine.snapshot;
  return grid.allPositions.filter((position) => grid.get(position).underlay !== null).length;
}

describe("remove all malware", () => {
  it("malware spreads by one cell after a move that removes none", () => {
    for (const top of ["z~1 t k z f", "z~1 t k z f~1"]) {
      const engine = engineFor(malwareBoard(top));
      const before = malwareCount(engine);
      const delta = engine.apply(MALWARE_SWAP);
      expect(delta.clears.length).toBeGreaterThanOrEqual(3);
      expect(malwareCount(engine)).toBe(before + 1);
    }
  });

  it("a move that removes malware stops the spread", () => {
    const engine = engineFor(malwareBoard("z t k z f~1", "z~1 t k f z"));
    expect(malwareCount(engine)).toBe(2);
    engine.apply(MALWARE_SWAP);
    expect(engine.snapshot.grid.get({ row: 3, col: 0 }).underlay).toBeNull();
    expect(malwareCount(engine)).toBe(1);
  });

  it("a move that only damages 2-layer malware still spreads", () => {
    const engine = engineFor(malwareBoard("z t k z f", "z~2 t k f z"));
    engine.apply(MALWARE_SWAP);
    expect(engine.snapshot.grid.get({ row: 3, col: 0 }).underlay?.hp).toBe(1);
    expect(malwareCount(engine)).toBe(2);
  });

  it("a booster does not trigger a spread", () => {
    const engine = engineFor(malwareBoard("z~1 t k z f"));
    const delta = engine.apply({ kind: "activateBooster", booster: "rocket", at: { row: 4, col: 4 } });
    expect(delta.powerUpEvents.length).toBeGreaterThan(0);
    expect(malwareCount(engine)).toBe(1);
  });

  it("a board with no malware draws no random number for spreading", () => {
    const engine = engineFor(malwareBoard("z t k z f"));
    const { steps } = engine.applyWithResolution(MALWARE_SWAP);
    const step = steps.find((candidate) => candidate.kind === "malware");
    expect(step).toBeDefined();
    expect(step!.after.rngSeed).toBe(step!.before.rngSeed);
  });

  it("removing the last malware wins a malware goal", () => {
    const engine = new BoardEngine(testLevel(malwareBoard("z t k z f", "z~1 t k f z"), { objectives: MALWARE_GOAL }), 7);
    expect(malwareCount(engine)).toBe(1);
    const delta = engine.apply(MALWARE_SWAP);
    expect(delta.isWin).toBe(true);
    expect(engine.snapshot.malwareLeft).toBe(0);
  });

  it("a malware goal cannot be finished while any remains", () => {
    const engine = new BoardEngine(testLevel(malwareBoard("z t k z f~1", "z~1 t k f z"), { objectives: MALWARE_GOAL }), 7);
    expect(engine.snapshot.malwareLeft).toBe(2);
    const delta = engine.apply(MALWARE_SWAP);
    expect(delta.isWin).toBe(false);
    expect(engine.snapshot.malwareLeft).toBe(1);
  });

  it("the malware goal wins on the last move instead of failing", () => {
    const level = testLevel(malwareBoard("z t k z f", "z~1 t k f z"), { objectives: MALWARE_GOAL, moveLimit: 1 });
    const engine = new BoardEngine(level, 7);
    const delta = engine.apply(MALWARE_SWAP);
    expect(engine.snapshot.moveCount).toBe(engine.snapshot.moveLimit);
    expect(delta.isWin).toBe(true);
    expect(delta.isFail).toBe(false);
  });
});
