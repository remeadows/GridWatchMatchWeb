import { describe, expect, it } from "vitest";
import { BoardEngine, findHint, positionKey, type GridPosition } from "../engine";
import { testLevel } from "./helpers/testBoard";

// Russ, 2026-11-03: "When a user is looking at the board for more than 6 seconds looking for a match,
// give an animated hint". The engine chooses the move and the pieces to outline.

const LETTER: Record<string, string> = { packet: "p", firewall: "f", key: "k", threat: "t", zeroDay: "z" };

function boardOf(rows: string[]) {
  const grid = new BoardEngine(testLevel(rows), 7).snapshot.grid;
  const kept = rows.map((row, r) => row.split(" ").map((_, c) => LETTER[grid.get({ row: r, col: c }).baseTile ?? ""] ?? "?").join(" "));
  expect(kept, "the engine kept the board as written").toEqual(rows.map((row) => row.replace(/[#!~]\d?/g, "")));
  return grid;
}

const keys = (cells: GridPosition[]) => cells.map(positionKey);
const at = (row: number, col: number) => ({ row, col });

// Several swaps make a 3-match; only swapping (3,2) down into (4,2) makes a 4 (row 4).
const TWO_MOVES = [
  "p p k p f",
  "f k f k t",
  "k f p f p",
  "z k t k f",
  "t t f t k"
];

describe("the hint", () => {
  it("points at the swap that makes the biggest match, outlining the pieces where they sit now", () => {
    const hint = findHint(boardOf(TWO_MOVES));
    expect(hint?.action).toEqual({ kind: "swap", from: at(3, 2), to: at(4, 2) });
    expect(keys(hint!.cells)).toEqual(keys([at(3, 2), at(4, 0), at(4, 1), at(4, 2), at(4, 3)]));
  });

  it("puts two power-ups swapped together ahead of any match", () => {
    const grid = boardOf(TWO_MOVES);
    grid.get(at(2, 0)).powerUp = { kind: "tnt" };
    grid.get(at(2, 1)).powerUp = { kind: "rocket", orientation: "horizontal" };
    const hint = findHint(grid);
    expect(hint?.action).toEqual({ kind: "swap", from: at(2, 0), to: at(2, 1) });
    expect(keys(hint!.cells)).toEqual(keys([at(2, 0), at(2, 1)]));
  });

  it("never asks the player to move a frozen piece", () => {
    const rows = [...TWO_MOVES];
    rows[3] = "z k t#1 k f";
    const hint = findHint(boardOf(rows));
    expect(hint).not.toBeNull();
    expect(keys(hint!.cells)).not.toContain(positionKey(at(3, 2)));
    expect(hint!.cells.length).toBeGreaterThanOrEqual(3);
  });

  it("taps a lone power-up when no swap makes a match", () => {
    const grid = boardOf(TWO_MOVES);
    for (const position of grid.allPositions) grid.get(position).isMovable = false;
    grid.get(at(1, 1)).isMovable = true;
    grid.get(at(1, 1)).powerUp = { kind: "tnt" };
    expect(findHint(grid)).toEqual({ action: { kind: "tap", at: at(1, 1) }, cells: [at(1, 1)] });
  });
});
