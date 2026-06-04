import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeLevel } from "../data/levels";
import {
  BoardEngine,
  type BoardSnapshot,
  detectMatches,
  SeededRNG,
  type BoardAction,
  type CellDefinition,
  type LevelDefinition,
  type TileType
} from "../engine";
import { levelSeed } from "../state/progress";

const levelsDir = path.resolve(process.cwd(), "public/levels");

describe("SeededRNG", () => {
  it("uses the Swift LCG constants deterministically", () => {
    const rng = new SeededRNG(1n);
    expect(rng.nextUInt64().toString()).toBe("7806831264735756412");
    expect(new SeededRNG(42n).nextDouble()).toBe(new SeededRNG(42n).nextDouble());
  });
});

describe("production levels", () => {
  const files = readdirSync(levelsDir).filter((name) => /^level_\d{3}\.json$/.test(name)).sort();

  it("contains the current 100 synced iOS levels", () => {
    expect(files).toHaveLength(100);
  });

  it.each(files)("initializes %s without invariants breaking", (file) => {
    const level = readLevel(file);
    const engine = new BoardEngine(level, levelSeed(level.id));
    const snapshot = engine.snapshot;
    expect(snapshot.grid.rows).toBe(level.gridRows);
    expect(snapshot.grid.cols).toBe(level.gridCols);
    expect(engine.validMoves().length).toBeGreaterThan(0);
  });
});

describe("BoardEngine actions", () => {
  it("replays the same action log deterministically", () => {
    const level = readLevel("level_001.json");
    const left = new BoardEngine(level, 1001n);
    const right = new BoardEngine(level, 1001n);
    const first = firstSwap(left);
    const second = firstSwapAfter(left, first);
    const actions = [first, second].filter(Boolean) as BoardAction[];

    for (const action of actions) right.apply(action);
    expect(snapshotKey(right.snapshot)).toBe(snapshotKey(left.snapshot));
    expect(right.actionLog()).toEqual(left.actionLog());
  });

  it("treats boosters as free actions and Play On as a move-limit extension", () => {
    const engine = new BoardEngine(readLevel("level_001.json"), 77n);
    const before = engine.snapshot.moveCount;
    engine.apply({ kind: "activateBooster", booster: "tnt" });
    expect(engine.snapshot.moveCount).toBe(before);
    const limit = engine.snapshot.moveLimit;
    engine.extendMoveLimit(5);
    expect(engine.snapshot.moveLimit).toBe(limit + 5);
  });

  it.each(comboCases())("resolves combo %s", (_name, left, right) => {
    const engine = new BoardEngine(comboLevel(left, right), 99n);
    const delta = engine.apply({ kind: "swap", from: { row: 3, col: 3 }, to: { row: 3, col: 4 } });
    expect(delta.powerUpEvents.length).toBeGreaterThan(0);
    expect(delta.clears.length).toBeGreaterThan(0);
  });
});

function readLevel(file: string): LevelDefinition {
  return normalizeLevel(JSON.parse(readFileSync(path.join(levelsDir, file), "utf8")) as LevelDefinition);
}

function firstSwap(engine: BoardEngine): BoardAction {
  const action = engine.validMoves().find((candidate) => candidate.kind === "swap");
  if (!action) throw new Error("No swap available");
  engine.apply(action);
  return action;
}

function firstSwapAfter(engine: BoardEngine, _previous: BoardAction): BoardAction | null {
  const action = engine.validMoves().find((candidate) => candidate.kind === "swap");
  if (!action) return null;
  engine.apply(action);
  return action;
}

function snapshotKey(snapshot: BoardSnapshot): string {
  return JSON.stringify({
    moveCount: snapshot.moveCount,
    moveLimit: snapshot.moveLimit,
    rngSeed: snapshot.rngSeed,
    objectiveProgress: snapshot.objectiveProgress,
    cells: snapshot.grid.allPositions.map((position) => {
      const cell = snapshot.grid.get(position);
      return [cell.baseTile, cell.powerUp, cell.overlay, cell.underlay, cell.generator, cell.isMovable];
    })
  });
}

function comboCases(): [string, string, string][] {
  return [
    ["rocket+rocket", "rocket_h", "rocket_v"],
    ["rocket+propeller", "rocket_h", "propeller"],
    ["rocket+tnt", "rocket_h", "tnt"],
    ["rocket+lightBall", "rocket_h", "lightBall"],
    ["propeller+propeller", "propeller", "propeller"],
    ["propeller+tnt", "propeller", "tnt"],
    ["propeller+lightBall", "propeller", "lightBall"],
    ["tnt+tnt", "tnt", "tnt"],
    ["tnt+lightBall", "tnt", "lightBall"],
    ["lightBall+lightBall", "lightBall", "lightBall"]
  ];
}

function comboLevel(leftPowerUp: string, rightPowerUp: string): LevelDefinition {
  const tiles: TileType[] = ["packet", "firewall", "key", "threat"];
  const cellMap: CellDefinition[][] = Array.from({ length: 7 }, (_, row) =>
    Array.from({ length: 7 }, (_, col) => ({
      tile: tiles[(row * 2 + col) % tiles.length],
      powerUp: null,
      overlay: null,
      underlay: null,
      generator: null,
      locked: false
    }))
  );
  cellMap[3][3] = { ...cellMap[3][3], tile: null, powerUp: leftPowerUp };
  cellMap[3][4] = { ...cellMap[3][4], tile: null, powerUp: rightPowerUp };
  cellMap[1][1] = { ...cellMap[1][1], overlay: "encryptedVolume_2" };
  cellMap[5][5] = { ...cellMap[5][5], underlay: "malware_1" };
  cellMap[0][0] = { tile: null, powerUp: null, overlay: null, underlay: null, generator: "honeypot", locked: true };
  cellMap[6][6] = { ...cellMap[6][6], locked: true };
  return {
    id: 900,
    name: "Combo Harness",
    gridRows: 7,
    gridCols: 7,
    moveLimit: 10,
    objectives: [{ id: "clear", target: 1, displayName: "Clear 1", tileType: null }],
    cellMap,
    spawnWeights: { packet: 0.25, firewall: 0.25, key: 0.25, threat: 0.25, zeroDay: 0 },
    bossLevel: false,
    bonusLevel: false,
    bossTimerSeconds: null
  };
}
