import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../worker/level-stars.json", () => ({ default: { "1": { two: 2, three: 4 } } }));

import { starsForMovesLeft } from "../data/stars";
import { moveLimitFor, starsFor, validateSubmission } from "../../worker/validation";

function oldRule(movesLeft: number, moveLimit: number): number {
  const ratio = movesLeft / Math.max(1, moveLimit);
  if (ratio >= 0.5) return 3;
  if (ratio >= 0.2) return 2;
  return 1;
}

describe("starsForMovesLeft", () => {
  it("keeps the old rule without thresholds", () => {
    expect(starsForMovesLeft(13, 25)).toBe(3);
    expect(starsForMovesLeft(5, 25)).toBe(2);
    expect(starsForMovesLeft(4, 25)).toBe(1);
  });

  it("matches the old ratio code at every moves-left value", () => {
    for (let limit = 10; limit <= 60; limit += 1) {
      for (let left = 0; left <= limit; left += 1) {
        expect(starsForMovesLeft(left, limit), `${left}/${limit}`).toBe(oldRule(left, limit));
      }
    }
  });

  it("uses a level's own thresholds", () => {
    expect(starsForMovesLeft(4, 30, { two: 2, three: 4 })).toBe(3);
    expect(starsForMovesLeft(2, 30, { two: 2, three: 4 })).toBe(2);
    expect(starsForMovesLeft(1, 30, { two: 2, three: 4 })).toBe(1);
  });
});

describe("worker starsFor", () => {
  it("matches the client for every public level and moves-left value, with and without thresholds", () => {
    const dir = path.resolve(__dirname, "../../public/levels");
    const files = readdirSync(dir).filter((f) => /^level_\d{3}\.json$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const level = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as { id: number; moveLimit: number; starMoves?: { two: number; three: number } };
      for (let left = 0; left <= level.moveLimit; left += 1) {
        const moveCount = level.moveLimit - left;
        // level 1 is mocked with thresholds in this file; the others use the artifact (none yet)
        const expected = level.id === 1
          ? starsForMovesLeft(left, level.moveLimit, { two: 2, three: 4 })
          : starsForMovesLeft(left, level.moveLimit, level.starMoves);
        expect(starsFor(moveCount, level.moveLimit, level.id), `${f} left ${left}`).toBe(expected);
      }
    }
  });

  it("keeps the old rule when called without a level id", () => {
    for (let limit = 10; limit <= 60; limit += 1) {
      for (let left = 0; left <= limit; left += 1) expect(starsFor(limit - left, limit)).toBe(oldRule(left, limit));
    }
  });
});

describe("validateSubmission with custom stars", () => {
  const body = (moveCount: number, stars: number) => ({
    levelId: 1,
    telemetry: { tilesCleared: 60, powerUpEvents: 2, chainSum: 4, moveCount, stars, playOnUsed: false },
    actionLog: [{ kind: "swap" }],
  });

  it("the server accepts a win with custom stars", () => {
    const limit = moveLimitFor(1)!;
    expect(validateSubmission(body(limit - 4, 3)).ok).toBe(true);
    expect(validateSubmission(body(limit - 2, 2)).ok).toBe(true);
    expect(validateSubmission(body(limit - 1, 1)).ok).toBe(true);
  });

  it("rejects stars that disagree with the level's thresholds", () => {
    const limit = moveLimitFor(1)!;
    expect(validateSubmission(body(limit - 2, 3)).ok).toBe(false);
  });
});
