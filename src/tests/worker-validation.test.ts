import { describe, expect, it } from "vitest";
import {
  LEVEL_SCORE_CAP,
  dailyCategory,
  deriveScore,
  levelCategory,
  moveLimitFor,
  starsFor,
  validateSubmission,
  weeklyCategory,
} from "../../worker/validation";

const okBody = (over: Record<string, unknown> = {}, tOver: Record<string, unknown> = {}) => ({
  levelId: 1,
  telemetry: {
    tilesCleared: 60,
    powerUpEvents: 2,
    chainSum: 4,
    moveCount: 15,
    stars: starsFor(15, moveLimitFor(1)!),
    playOnUsed: false,
    ...tOver,
  },
  actionLog: [{ kind: "swap" }],
  ...over,
});

describe("level limits artifact", () => {
  it("covers all 100 levels with plausible limits", () => {
    for (let id = 1; id <= 100; id++) {
      const limit = moveLimitFor(id);
      expect(limit, `level ${id}`).not.toBeNull();
      expect(limit!).toBeGreaterThanOrEqual(17);
      expect(limit!).toBeLessThanOrEqual(48);
    }
    expect(moveLimitFor(0)).toBeNull();
    expect(moveLimitFor(101)).toBeNull();
  });
});

describe("validateSubmission", () => {
  it("accepts a plausible run", () => {
    expect(validateSubmission(okBody()).ok).toBe(true);
  });
  it("rejects unknown levels, bad counts, star mismatch, missing log", () => {
    expect(validateSubmission(okBody({ levelId: 101 })).ok).toBe(false);
    expect(validateSubmission(okBody({}, { moveCount: 999 })).ok).toBe(false);
    expect(validateSubmission(okBody({}, { tilesCleared: 15 * 49 + 1 })).ok).toBe(false);
    expect(validateSubmission(okBody({}, { stars: 1 })).ok).toBe(false); // 15/25 used → not 1 star
    expect(validateSubmission(okBody({ actionLog: undefined })).ok).toBe(false);
    expect(validateSubmission(okBody({}, { playOnUsed: "yes" })).ok).toBe(false);
  });
});

describe("deriveScore", () => {
  it("mirrors the engine formula and caps", () => {
    expect(deriveScore({ tilesCleared: 60, powerUpEvents: 2, chainSum: 4, moveCount: 15, stars: 3, playOnUsed: false })).toBe(60 * 10 + 2 * 25 + 4 * 50);
    expect(deriveScore({ tilesCleared: 49000, powerUpEvents: 0, chainSum: 0, moveCount: 48, stars: 1, playOnUsed: false })).toBe(LEVEL_SCORE_CAP);
  });
});

describe("categories", () => {
  it("pads level categories", () => expect(levelCategory(7)).toBe("level-007"));
  it("stamps ISO periods (spot checks match hub/Drift)", () => {
    expect(dailyCategory(new Date("2026-07-14T12:00:00Z"))).toBe("daily-2026-07-14");
    expect(weeklyCategory(new Date("2026-07-14T12:00:00Z"))).toBe("weekly-2026-W29");
    expect(weeklyCategory(new Date("2021-01-01T12:00:00Z"))).toBe("weekly-2020-W53");
  });
});
