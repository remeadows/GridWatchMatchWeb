import { describe, expect, it } from "vitest";
import { BoardEngine, SeededRNG, positionKey, type GridPosition, type ObjectiveDefinition } from "../engine";
import { choosePropellerTargets } from "../engine/powerUps";
import { testLevel } from "./helpers/testBoard";

// Russ, 2026-11-03: "drone - priority targets caged or iced or locked tiles". In this game those are
// pieces under a pane (frozen) and locked pieces. They come before every other cell, whatever the goal.

const ORIGIN: GridPosition = { row: 0, col: 0 };
const COLLECT_PACKETS: ObjectiveDefinition[] = [{ id: "collect", target: 20, displayName: "Packets", tileType: "packet" }];

const LETTER: Record<string, string> = { packet: "p", firewall: "f", key: "k", threat: "t", zeroDay: "z" };

function targets(rows: string[], count: number, seed: bigint, objectives: ObjectiveDefinition[] = COLLECT_PACKETS): string[] {
  const grid = new BoardEngine(testLevel(rows, { objectives }), 7).snapshot.grid;
  // Each board has one legal swap, so the engine keeps it exactly as written.
  const kept = rows.map((row, r) => row.split(" ").map((token, c) => (token === "H" ? "H" : LETTER[grid.get({ row: r, col: c }).baseTile ?? ""] ?? "?")).join(" "));
  expect(kept).toEqual(rows.map((row) => row.replace(/[#!~]\d?/g, "")));
  return choosePropellerTargets(count, ORIGIN, grid, objectives, {}, new SeededRNG(seed)).map(positionKey);
}

// One locked key in the far corner; packets the goal wants sit right next to the drone.
const FAR_LOCK = [
  "p p k p t",
  "k f t k f",
  "f t f t k",
  "t k t f t",
  "k f k t k!"
];

// A pane and a lock, nothing the goal wants.
const PANE_AND_LOCK = [
  "p p k p f",
  "f t f k t",
  "t k f#1 t k",
  "k f t f f",
  "f t k! f t"
];

const SEEDS = Array.from({ length: 200 }, (_, index) => BigInt(index + 1));

describe("the drone goes for blocked pieces first", () => {
  it("picks a locked piece across the board over goal pieces beside it, on every seed", () => {
    for (const seed of SEEDS) expect(targets(FAR_LOCK, 1, seed), `seed ${seed}`).toEqual([positionKey({ row: 4, col: 4 })]);
  });

  it("takes every pane and lock before any plain piece", () => {
    const blocked = [positionKey({ row: 2, col: 2 }), positionKey({ row: 4, col: 2 })].sort();
    for (const seed of SEEDS) {
      const picked = targets(PANE_AND_LOCK, 3, seed);
      expect(picked.slice(0, 2).sort(), `seed ${seed}`).toEqual(blocked);
      expect(blocked).not.toContain(picked[2]);
    }
  });

  it("never treats a honeypot as a blocked piece", () => {
    const rows = [
      "p p k p f",
      "f t f k t",
      "t k H t k",
      "k f t f f",
      "f t k f t"
    ];
    for (const seed of SEEDS) expect(targets(rows, 1, seed)).not.toContain(positionKey({ row: 2, col: 2 }));
  });

  it("still follows the goal when nothing is blocked", () => {
    const rows = [
      "k k f k t",
      "f t t f k",
      "t f k t f",
      "k t f k t",
      "f k t f p"
    ];
    const hits = SEEDS.filter((seed) => targets(rows, 1, seed)[0] === positionKey({ row: 4, col: 4 }));
    expect(hits.length).toBeGreaterThan(SEEDS.length / 2);
  });
});
