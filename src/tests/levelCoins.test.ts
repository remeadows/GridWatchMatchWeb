import { describe, expect, it } from "vitest";
import { coinsPerLeftoverMove, powerUpPrices } from "../data/store";
import { awardLevelCompletion, buyPowerUp, levelCoinReward } from "../state/progress";
import { defaultSaveState } from "../state/save";

describe("coins for a won level", () => {
  it("pays for the stars and for every move left over", () => {
    const reward = levelCoinReward(defaultSaveState(), 3, 2, 12, false);
    expect(reward).toEqual({ starCoins: 20, leftoverMoves: 12, moveCoins: 12 * coinsPerLeftoverMove, total: 20 + 12 * coinsPerLeftoverMove });
  });

  it("adds that reward to the save", () => {
    const next = awardLevelCompletion(defaultSaveState(), 3, 2, 900, false, 12);
    expect(next.coins).toBe(20 + 12 * coinsPerLeftoverMove);
  });

  it("pays only the stars when the last move won the level", () => {
    expect(levelCoinReward(defaultSaveState(), 3, 3, 0, false)).toMatchObject({ moveCoins: 0, total: 30 });
  });

  it("pays nothing when the level is replayed, so an easy level cannot be farmed", () => {
    const won = awardLevelCompletion(defaultSaveState(), 3, 2, 900, false, 12);
    expect(levelCoinReward(won, 3, 3, 20, false).total).toBe(0);
    expect(awardLevelCompletion(won, 3, 3, 1200, false, 20).coins).toBe(won.coins);
  });

  it("pays nothing after Play On: those moves were bought", () => {
    expect(levelCoinReward(defaultSaveState(), 3, 3, 4, true).total).toBe(0);
    expect(awardLevelCompletion(defaultSaveState(), 3, 3, 900, true, 4).coins).toBe(0);
  });
});

describe("buying power-ups with coins", () => {
  it("prices every power-up", () => {
    for (const booster of ["rocket", "rocketVertical", "tnt", "propeller", "lightBall"] as const) {
      expect(powerUpPrices[booster]).toBeGreaterThan(0);
    }
  });

  it("takes the price and adds one", () => {
    const save = { ...defaultSaveState(), coins: powerUpPrices.tnt + 7 };
    const next = buyPowerUp(save, "tnt");
    expect(next?.coins).toBe(7);
    expect(next?.boosters.tnt).toBe(save.boosters.tnt + 1);
    expect(save.boosters.tnt).toBe(3);
  });

  it("sells the last one for exactly the coins left", () => {
    const save = { ...defaultSaveState(), coins: powerUpPrices.rocket };
    expect(buyPowerUp(save, "rocket")?.coins).toBe(0);
  });

  it("refuses when the coins fall short", () => {
    const save = { ...defaultSaveState(), coins: powerUpPrices.lightBall - 1 };
    expect(buyPowerUp(save, "lightBall")).toBeNull();
  });
});
