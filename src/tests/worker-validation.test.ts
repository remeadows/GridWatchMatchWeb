import { describe, expect, it } from "vitest";
import {
  LEVEL_SCORE_CAP,
  MAX_PLAY_ONS,
  PLAY_ON_EXTRA_MOVES,
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

describe("Play-On handling", () => {
  const levelId = 1;
  const moveLimit = moveLimitFor(levelId)!;

  it("accepts a legit Play-On win that would fail strict validation", () => {
    const moveCount = moveLimit + PLAY_ON_EXTRA_MOVES; // one Play-On used
    const telemetry = {
      tilesCleared: Math.min(moveCount * 15, 60),
      powerUpEvents: 2,
      chainSum: 4,
      moveCount,
      // Deliberately NOT equal to starsFor(moveCount, moveLimit) (which would be 1,
      // since moveCount > moveLimit) — proves the equality check is relaxed.
      stars: 3,
      playOnUsed: true,
    };
    expect(starsFor(moveCount, moveLimit)).not.toBe(telemetry.stars);
    expect(validateSubmission(okBody({ levelId }, telemetry)).ok).toBe(true);
  });

  it("rejects the same telemetry when playOnUsed is false", () => {
    const moveCount = moveLimit + PLAY_ON_EXTRA_MOVES;
    const telemetry = {
      tilesCleared: Math.min(moveCount * 15, 60),
      powerUpEvents: 2,
      chainSum: 4,
      moveCount,
      stars: 3,
      playOnUsed: false,
    };
    expect(validateSubmission(okBody({ levelId }, telemetry)).ok).toBe(false);
  });

  it("rejects a playOnUsed run with an absurd move count beyond MAX_PLAY_ONS", () => {
    const moveCount = moveLimit + PLAY_ON_EXTRA_MOVES * MAX_PLAY_ONS + 1;
    const telemetry = {
      tilesCleared: 1,
      powerUpEvents: 0,
      chainSum: 0,
      moveCount,
      stars: 3,
      playOnUsed: true,
    };
    expect(validateSubmission(okBody({ levelId }, telemetry)).ok).toBe(false);
  });

  it("rejects out-of-range star counts regardless of playOnUsed", () => {
    const moveCount = moveLimit + PLAY_ON_EXTRA_MOVES;
    const baseTelemetry = {
      tilesCleared: Math.min(moveCount * 15, 60),
      powerUpEvents: 2,
      chainSum: 4,
      moveCount,
    };
    expect(
      validateSubmission(okBody({ levelId }, { ...baseTelemetry, stars: 0, playOnUsed: true })).ok,
    ).toBe(false);
    expect(
      validateSubmission(okBody({ levelId }, { ...baseTelemetry, stars: 4, playOnUsed: true })).ok,
    ).toBe(false);
    expect(
      validateSubmission(okBody({ levelId: 1 }, { ...okBody().telemetry, stars: 0, playOnUsed: false })).ok,
    ).toBe(false);
    expect(
      validateSubmission(okBody({ levelId: 1 }, { ...okBody().telemetry, stars: 4, playOnUsed: false })).ok,
    ).toBe(false);
  });
});

describe("deriveScore", () => {
  it("mirrors the engine formula and caps", () => {
    expect(deriveScore({ tilesCleared: 60, powerUpEvents: 2, chainSum: 4, moveCount: 15, stars: 3, playOnUsed: false })).toBe(60 * 10 + 2 * 25 + 4 * 50);
    expect(deriveScore({ tilesCleared: 49000, powerUpEvents: 0, chainSum: 0, moveCount: 48, stars: 1, playOnUsed: false })).toBe(LEVEL_SCORE_CAP);
  });
});

describe("deriveScore anti-inflation", () => {
  it("caps max-plausible telemetry well under LEVEL_SCORE_CAP on the tightest level", () => {
    // Tightest level: moveLimit 17 (min across all 100 levels — see level-limits.json).
    const tightestLevelId = 34;
    const moveLimit = moveLimitFor(tightestLevelId)!;
    expect(moveLimit).toBe(17);

    const moveCount = moveLimit;
    const maxTelemetry = {
      tilesCleared: moveCount * 15,
      powerUpEvents: moveCount * 4,
      chainSum: moveCount * 5,
      moveCount,
      stars: starsFor(moveCount, moveLimit),
      playOnUsed: false,
    };

    const result = validateSubmission(
      okBody({ levelId: tightestLevelId }, maxTelemetry),
    );
    expect(result.ok).toBe(true);
    expect(deriveScore(maxTelemetry)).toBe(moveCount * 500);
    expect(deriveScore(maxTelemetry)).toBeLessThan(LEVEL_SCORE_CAP);
  });

  it("rejects the old attack telemetry that used to hit the cap (chainSum = moveCount*20)", () => {
    const levelId = 34;
    const moveLimit = moveLimitFor(levelId)!;
    const moveCount = moveLimit;
    const attackTelemetry = {
      tilesCleared: 1,
      powerUpEvents: 0,
      chainSum: moveCount * 20,
      moveCount,
      stars: starsFor(moveCount, moveLimit),
      playOnUsed: false,
    };

    expect(validateSubmission(okBody({ levelId }, attackTelemetry)).ok).toBe(false);
  });

  it("keeps LEVEL_SCORE_CAP an unreachable backstop on the largest level (moveLimit 48)", () => {
    const largestLevelId = 61;
    const moveLimit = moveLimitFor(largestLevelId)!;
    expect(moveLimit).toBe(48);

    const moveCount = moveLimit;
    const maxTelemetry = {
      tilesCleared: moveCount * 15,
      powerUpEvents: moveCount * 4,
      chainSum: moveCount * 5,
      moveCount,
      stars: starsFor(moveCount, moveLimit),
      playOnUsed: false,
    };

    expect(deriveScore(maxTelemetry)).toBe(24000);
    expect(deriveScore(maxTelemetry)).toBeLessThan(LEVEL_SCORE_CAP);
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
