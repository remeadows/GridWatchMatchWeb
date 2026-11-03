import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BoardEngine, type LevelDefinition } from "../engine";
import { levelSeed } from "../state/progress";
import { BAND_TOLERANCE, bandFor, bandFraction, targetFailRate } from "../../scripts/levels/bands";
import { blockersForLevel, buildLevel, withMoveLimit } from "../../scripts/levels/buildLevel";
import { levelName, newLevelNames } from "../../scripts/levels/levelNames";
import { recipeForLevel, sectorRecipes, type SectorRecipe } from "../../scripts/levels/recipes";
import { measureLevel } from "../../scripts/levels/report";
import { acceptsCandidate, reportsByMoveLimit, starMovesFor, tuneLevel } from "../../scripts/levels/tune";

const levelsDir = path.resolve(process.cwd(), "public/levels");
const seeds = [1n, 2n, 3n];

function fileLevel(id: number): LevelDefinition {
  return JSON.parse(readFileSync(path.join(levelsDir, `level_${String(id).padStart(3, "0")}.json`), "utf8")) as LevelDefinition;
}

function firstLevelOf(recipe: SectorRecipe): number {
  return (recipe.sectorId - 1) * 10 + 1;
}

/** A few levels of each sector: the first, the eighth (every blocker in by then) and the boss. */
function sampleLevels(recipe: SectorRecipe): number[] {
  const first = firstLevelOf(recipe);
  return [first, first + 7, first + 9];
}

function counts(level: LevelDefinition) {
  const cells = level.cellMap.flat();
  return {
    panes: cells.filter((cell) => cell.overlay !== null).length,
    locks: cells.filter((cell) => cell.locked && cell.generator === null).length,
    malware: cells.filter((cell) => cell.underlay !== null).length
  };
}

const blockerGoalIds = ["panes", "locks", "malware"];

describe("difficulty bands", () => {
  it("no more than three levels in a row sit at the top of their band", () => {
    let run = 0;
    for (let id = 11; id <= 200; id += 1) {
      run = bandFraction(id) >= 0.85 ? run + 1 : 0;
      expect(run, `level ${id}`).toBeLessThanOrEqual(3);
    }
    // The level after a boss gives relief within its band. In absolute fail rate 31 and 51 still sit above 30 and
    // 50, because the bands themselves step up there.
    for (let boss = 20; boss < 200; boss += 10) expect(bandFraction(boss + 1), `after ${boss}`).toBeLessThan(bandFraction(boss));
  });

  it("every band value is in its band", () => {
    expect(bandFor(11)).toEqual([0.05, 0.15]);
    expect(bandFor(31)).toEqual([0.15, 0.3]);
    expect(bandFor(51)).toEqual([0.3, 0.5]);
    expect(bandFor(101)).toEqual([0.45, 0.6]);
    expect(BAND_TOLERANCE).toBe(0.07);
    for (let id = 11; id <= 200; id += 1) {
      const [min, max] = bandFor(id);
      expect(targetFailRate(id)).toBeGreaterThanOrEqual(min - 1e-12);
      expect(targetFailRate(id)).toBeLessThanOrEqual(max + 1e-12);
    }
    expect(targetFailRate(11)).toBeCloseTo(0.065, 10);
    expect(targetFailRate(19)).toBeCloseTo(0.145, 10);
    expect(targetFailRate(200)).toBeCloseTo(0.6, 10);
  });
});

describe("recipes", () => {
  it("recipes are sorted and sectors 2 to 20 have one each", () => {
    expect(sectorRecipes.map((recipe) => recipe.sectorId)).toEqual(Array.from({ length: 19 }, (_, index) => index + 2));
    for (let id = 11; id <= 200; id += 1) expect(recipeForLevel(id).sectorId).toBe(Math.ceil(id / 10));
    for (const recipe of sectorRecipes) {
      for (const range of [recipe.blockedCells, recipe.paneLayers, recipe.moves]) expect(range[0]).toBeLessThanOrEqual(range[1]);
      expect(recipe.blockers.length).toBeGreaterThan(0);
      expect(new Set(recipe.blockers).size).toBe(recipe.blockers.length);
    }
  });

  it("a median moves step between sectors is at most 6", () => {
    const medians = sectorRecipes.map((recipe) => (recipe.moves[0] + recipe.moves[1]) / 2);
    for (let index = 1; index < medians.length; index += 1) {
      expect(Math.abs(medians[index] - medians[index - 1]), `sector ${index + 2}`).toBeLessThanOrEqual(6);
    }
  });
});

describe("buildLevel", () => {
  it("a built level passes the engine and has a reachable goal", () => {
    for (const recipe of sectorRecipes) {
      for (const id of sampleLevels(recipe)) {
        for (const seed of seeds) {
          const level = buildLevel(recipe, id, `Test ${id}`, seed);
          expect(() => new BoardEngine(level, levelSeed(id)), `level ${id} seed ${seed}`).not.toThrow();
          const onBoard = counts(level);
          for (const goal of level.objectives) {
            if (goal.id === "panes") expect(goal.target).toBe(onBoard.panes);
            if (goal.id === "locks") expect(goal.target).toBe(onBoard.locks);
          }
          const engine = new BoardEngine(level, levelSeed(id));
          expect(engine.validMoves().length, `level ${id} seed ${seed} starts with a move`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("goals only ask for blockers on the board", () => {
    for (const recipe of sectorRecipes) {
      for (const id of sampleLevels(recipe)) {
        for (const seed of seeds) {
          const level = buildLevel(recipe, id, `Test ${id}`, seed);
          const onBoard = counts(level);
          const ids = level.objectives.map((goal) => goal.id);
          // One blocker goal for each blocker type on the board, and none for a blocker that is not.
          expect(ids.includes("panes")).toBe(onBoard.panes > 0);
          expect(ids.includes("locks")).toBe(onBoard.locks > 0);
          expect(ids.includes("malware")).toBe(onBoard.malware > 0);
          for (const goal of level.objectives) {
            expect(goal.target).toBeGreaterThan(0);
            if (goal.id === "malware") expect(goal).toEqual({ id: "malware", target: 1, displayName: "Remove all malware", tileType: null });
            if (goal.id === "collect") expect(goal.tileType).not.toBeNull();
          }
          // Each recipe blocker in play at this level is on the board.
          const inPlay = blockersForLevel(recipe, id);
          expect(onBoard.panes > 0).toBe(inPlay.includes("pane"));
          expect(onBoard.locks > 0).toBe(inPlay.includes("lock"));
          expect(onBoard.malware > 0).toBe(inPlay.includes("malware"));
        }
      }
    }
  });

  it("a level carries at most three goals, and the collect goal is dropped first", () => {
    for (const recipe of sectorRecipes) {
      for (const id of sampleLevels(recipe)) {
        const level = buildLevel(recipe, id, "Test", 1n);
        const blockerGoals = level.objectives.filter((goal) => blockerGoalIds.includes(goal.id));
        const collect = level.objectives.filter((goal) => goal.id === "collect");
        expect(level.objectives.length).toBeLessThanOrEqual(3);
        expect(collect.length).toBe(blockerGoals.length < 3 ? 1 : 0);
      }
    }
    // Sector 10 has all three blockers: no room for a collect goal.
    expect(buildLevel(recipeForLevel(95), 95, "Test", 1n).objectives.map((goal) => goal.id).sort()).toEqual(["locks", "malware", "panes"]);
    // Sector 3 has panes only: a pane goal and a collect goal.
    expect(buildLevel(recipeForLevel(25), 25, "Test", 1n).objectives.map((goal) => goal.id).sort()).toEqual(["collect", "panes"]);
  });

  it("levels below 50 have no zeroDay", () => {
    for (const id of [11, 25, 41, 49, 50, 51, 120, 200]) {
      const level = buildLevel(recipeForLevel(id), id, "Test", 1n);
      const weights = level.spawnWeights;
      const sum = Object.values(weights).reduce((total, value) => total + (value ?? 0), 0);
      expect(sum).toBeCloseTo(1, 9);
      if (id < 50) {
        expect(Object.keys(weights).sort()).toEqual(["firewall", "key", "packet", "threat"]);
      } else {
        expect(Object.keys(weights).sort()).toEqual(["firewall", "key", "packet", "threat", "zeroDay"]);
        expect(weights.zeroDay).toBeGreaterThan(0);
      }
    }
  });

  it("a boss gets a timer of 4 seconds per move, at least 60", () => {
    for (let id = 11; id <= 200; id += 1) {
      const built = buildLevel(recipeForLevel(id), id, "Test", 1n);
      const recipe = recipeForLevel(id);
      for (const level of [built, withMoveLimit(built, recipe.moves[0]), withMoveLimit(built, 12)]) {
        expect(level.bossLevel).toBe(id % 10 === 0);
        if (id % 10 === 0) expect(level.bossTimerSeconds).toBe(Math.max(60, level.moveLimit * 4));
        else expect(level.bossTimerSeconds ?? null).toBeNull();
      }
    }
  });

  it("sector 2 brings in one blocker goal at a time", () => {
    const recipe = recipeForLevel(11);
    const goals = (id: number) =>
      buildLevel(recipe, id, "Test", 1n)
        .objectives.map((goal) => goal.id)
        .filter((goalId) => blockerGoalIds.includes(goalId))
        .sort();
    for (const id of [11, 12, 13]) expect(goals(id)).toEqual(["panes"]);
    for (const id of [14, 15, 16]) expect(goals(id)).toEqual(["locks", "panes"]);
    for (const id of [17, 18, 19, 20]) expect(goals(id)).toEqual(["locks", "malware", "panes"]);
  });

  it("the same seed builds the same level and another seed a different board", () => {
    const recipe = recipeForLevel(45);
    expect(buildLevel(recipe, 45, "Test", 7n)).toEqual(buildLevel(recipe, 45, "Test", 7n));
    expect(buildLevel(recipe, 45, "Test", 8n).cellMap).not.toEqual(buildLevel(recipe, 45, "Test", 7n).cellMap);
  });

  it("panes sit on free cells and honeypots on a divider row", () => {
    for (const recipe of sectorRecipes) {
      for (const seed of seeds) {
        const id = firstLevelOf(recipe) + 8;
        const level = buildLevel(recipe, id, "Test", seed);
        for (const cell of level.cellMap.flat()) {
          expect(cell.tile).toBeNull();
          expect(cell.powerUp).toBeNull();
          if (cell.overlay !== null) expect(cell.locked).toBe(false);
          if (cell.generator !== null) expect(cell).toEqual({ tile: null, powerUp: null, overlay: null, underlay: null, generator: "honeypot", locked: true });
        }
        const honeypotRows = level.cellMap.map((row) => row.filter((cell) => cell.generator !== null).length);
        if (recipe.pattern === "dividerRow") expect(honeypotRows.filter((count) => count === level.gridCols)).toHaveLength(1);
        else expect(honeypotRows.every((count) => count === 0)).toBe(true);
      }
    }
  });
});

describe("tuner", () => {
  it("star thresholds come from the bot's wins: three at the 75th percentile, two at the median", () => {
    expect(starMovesFor([1, 2, 3, 4, 5, 6, 7, 8], 20)).toEqual({ two: 4, three: 6 });
    expect(starMovesFor([8, 1, 7, 2, 6, 3, 5, 4], 20)).toEqual({ two: 4, three: 6 });
    expect(starMovesFor([3, 3, 3, 3], 20)).toBeUndefined();
    expect(starMovesFor([0, 0, 0, 1], 20)).toBeUndefined();
    expect(starMovesFor([], 20)).toBeUndefined();
    expect(starMovesFor([10, 19, 20, 20], 20)).toBeUndefined();
  });

  it("a candidate is accepted only inside the tolerance and with no dead board", () => {
    const report = { failRate: 0.3, deadBoards: 0 };
    expect(acceptsCandidate(report, 0.3)).toBe(true);
    expect(acceptsCandidate(report, 0.3 + BAND_TOLERANCE - 0.001)).toBe(true);
    expect(acceptsCandidate(report, 0.3 + BAND_TOLERANCE + 0.001)).toBe(false);
    expect(acceptsCandidate({ failRate: 0.3, deadBoards: 1 }, 0.3)).toBe(false);
  });

  it("games played at the longest move limit report every shorter limit exactly", () => {
    const recipe = recipeForLevel(35);
    const level = buildLevel(recipe, 35, "Test", 1n);
    const byLimit = reportsByMoveLimit(level, recipe.moves[0], recipe.moves[1], 6);
    for (const moves of [recipe.moves[0], recipe.moves[1]]) {
      expect(byLimit.get(moves)).toEqual(measureLevel(withMoveLimit(level, moves), 6));
    }
  });

  it("tuneLevel returns a level inside its recipe that matches its report", () => {
    const recipe = recipeForLevel(23);
    const result = tuneLevel(recipe, 23, "Test", { searchGames: 2, games: 4, candidates: 2 });
    expect(result.level.moveLimit).toBeGreaterThanOrEqual(recipe.moves[0]);
    expect(result.level.moveLimit).toBeLessThanOrEqual(recipe.moves[1]);
    expect(result.report).toEqual(measureLevel(result.level, 4));
    expect(result.inBand).toBe(result.details.deadBoards === 0 && acceptsCandidate(result.report, targetFailRate(23)));
    const stars = result.level.starMoves;
    if (stars) expect(0 < stars.two && stars.two < stars.three && stars.three < result.level.moveLimit).toBe(true);
    expect(tuneLevel(recipe, 23, "Test", { searchGames: 2, games: 4, candidates: 2 })).toEqual(result);
  }, 60_000);
});

describe("level names", () => {
  it("100 new level names, none repeated or reused", () => {
    const oldNames = Array.from({ length: 100 }, (_, index) => fileLevel(index + 1).name);
    expect(newLevelNames).toHaveLength(100);
    expect(new Set(newLevelNames).size).toBe(100);
    const old = new Set(oldNames.map((name) => name.toLowerCase()));
    for (const name of newLevelNames) {
      expect(old.has(name.toLowerCase()), name).toBe(false);
      expect(name.trim()).toBe(name);
      expect(name.length).toBeGreaterThan(2);
      expect(name.length).toBeLessThanOrEqual(24);
    }
    for (let id = 101; id <= 200; id += 1) expect(levelName(id)).toBe(newLevelNames[id - 101]);
  });

  it("levels 11 to 100 keep their names", () => {
    for (let id = 11; id <= 100; id += 1) expect(levelName(id)).toBe(fileLevel(id).name);
  });
});

describe("validate:levels", () => {
  it("fails a malware goal whose target is not 1", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "levels-"));
    try {
      const level = buildLevel(recipeForLevel(45), 45, "Test", 1n);
      expect(level.objectives.some((goal) => goal.id === "malware")).toBe(true);
      level.objectives = level.objectives.map((goal) => (goal.id === "malware" ? { ...goal, target: 2 } : goal));
      writeFileSync(path.join(dir, "level_045.json"), JSON.stringify(level));
      const bad = spawnSync(process.execPath, ["scripts/validate-levels.mjs", dir], { encoding: "utf8" });
      expect(bad.status).toBe(1);
      expect(bad.stdout).toContain("MALWARE_TARGET_INVALID");

      writeFileSync(path.join(dir, "level_045.json"), JSON.stringify(buildLevel(recipeForLevel(45), 45, "Test", 1n)));
      const good = spawnSync(process.execPath, ["scripts/validate-levels.mjs", dir], { encoding: "utf8" });
      expect(good.stdout).toContain("PASS level_045.json");
      expect(good.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
