import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BoardEngine, type LevelDefinition } from "../engine";
import { levelSeed } from "../state/progress";
import { BAND_TOLERANCE, bandFor, bandFraction, targetFailRate } from "../../scripts/levels/bands";
import { MAX_COLLECT_PER_MOVE, blockersForLevel, buildLevel, withMoveLimit } from "../../scripts/levels/buildLevel";
import { levelName, newLevelNames } from "../../scripts/levels/levelNames";
import { recipeForLevel, sectorRecipes, type SectorRecipe } from "../../scripts/levels/recipes";
import { measureLevel } from "../../scripts/levels/report";
import { MOVE_FLOOR, STRETCH_STEPS, TIER_STEPS, acceptsCandidate, reportsByMoveLimit, starMovesFor, stretchRecipe, stretchTier, tuneLevel, type TuneResult } from "../../scripts/levels/tune";
import { levelFile, levelJson, runBuild, runLevelJob, type BuildSettings, type LevelJob, type LevelJobResult } from "../../scripts/levels/build";
import { DEFAULT_BOT } from "../../scripts/levels/bot";

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
  });

  it("the level after a boss is below the boss, or equal at a band boundary, at the bottom of its band", () => {
    for (let boss = 20; boss < 200; boss += 10) {
      const after = boss + 1;
      expect(targetFailRate(after), `after ${boss}`).toBeCloseTo(bandFor(after)[0], 10);
      const boundary = bandFor(after)[0] !== bandFor(boss)[0];
      if (boundary && Math.abs(targetFailRate(after) - targetFailRate(boss)) < 1e-12) continue;
      expect(targetFailRate(after), `after ${boss}`).toBeLessThan(targetFailRate(boss));
    }
    expect(targetFailRate(31)).toBeCloseTo(0.15, 10);
    expect(targetFailRate(51)).toBeCloseTo(0.3, 10);
    expect(targetFailRate(101)).toBeCloseTo(0.45, 10);
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
    expect(targetFailRate(11)).toBeCloseTo(0.05, 10);
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

  it("a level is accepted only inside its band, near its target, and with no dead board", () => {
    const accepted = (failRate: number, levelId: number) => acceptsCandidate({ failRate, deadBoards: 0 }, levelId);
    // Level 31: band 15-30%, target 15%. Within the tolerance but under the band is refused.
    expect(accepted(0.15, 31)).toBe(true);
    expect(accepted(0.149, 31)).toBe(false);
    expect(accepted(0.15 + BAND_TOLERANCE, 31)).toBe(true);
    expect(accepted(0.15 + BAND_TOLERANCE + 0.001, 31)).toBe(false);
    // Level 30, a boss: band 5-15%, target 15%. Within the tolerance but over the band is refused.
    expect(accepted(0.15, 30)).toBe(true);
    expect(accepted(0.151, 30)).toBe(false);
    expect(accepted(0.15 - BAND_TOLERANCE, 30)).toBe(true);
    expect(accepted(0.15 - BAND_TOLERANCE - 0.001, 30)).toBe(false);
    // Level 11: band 5-15%, target 5%.
    expect(accepted(0.05, 11)).toBe(true);
    expect(accepted(0.01, 11)).toBe(false);
    expect(accepted(0.17, 120)).toBe(false);
    expect(accepted(0.6, 200)).toBe(true);
    expect(accepted(0.61, 200)).toBe(false);
    expect(acceptsCandidate({ failRate: 0.15, deadBoards: 1 }, 31)).toBe(false);
  });

  it("a collect goal asks for at most 1.5 pieces a move", () => {
    for (let id = 11; id <= 200; id += 1) {
      for (const step of [0, STRETCH_STEPS]) {
        const recipe = stretchRecipe(recipeForLevel(id), step);
        for (const pressure of [0, 0.5, 1]) {
          const level = buildLevel(recipe, id, "Test", 1n, { pressure });
          for (const goal of level.objectives.filter((objective) => objective.id === "collect")) {
            // Sized from the fewest moves, so it holds at any limit the tuner picks.
            expect(goal.target, `level ${id} step ${step} pressure ${pressure}`).toBeLessThanOrEqual(MAX_COLLECT_PER_MOVE * recipe.moves[0]);
          }
        }
      }
    }
    expect(MAX_COLLECT_PER_MOVE).toBe(1.5);
  });

  it("stretch tier 1 has up to 6 fewer moves and up to 50% more blocked cells", () => {
    for (const recipe of sectorRecipes) {
      expect(stretchRecipe(recipe, 0)).toEqual(recipe);
      expect(stretchTier(0)).toBe(0);
      const stretched = stretchRecipe(recipe, TIER_STEPS);
      expect(stretched.moves).toEqual([recipe.moves[0] - 6, recipe.moves[1] - 6]);
      const cap = recipe.pattern === "dividerRow" ? 25 : 29;
      expect(stretched.blockedCells).toEqual([Math.min(cap, Math.round(recipe.blockedCells[0] * 1.5)), Math.min(cap, Math.round(recipe.blockedCells[1] * 1.5))]);
      for (let step = 1; step <= TIER_STEPS; step += 1) {
        const at = stretchRecipe(recipe, step);
        expect(stretchTier(step)).toBe(1);
        expect(at.moves[0]).toBe(recipe.moves[0] - 2 * step);
        expect(at.blockedCells[1]).toBeGreaterThanOrEqual(stretchRecipe(recipe, step - 1).blockedCells[1]);
        expect(at.paneLayers).toEqual(recipe.paneLayers);
        expect(at.blockers).toEqual(recipe.blockers);
        expect(at.pattern).toBe(recipe.pattern);
      }
    }
  });

  it("stretch tier 2 goes no lower than 12 moves, no more than twice the cells, and one more pane layer up to 3", () => {
    expect(STRETCH_STEPS).toBe(2 * TIER_STEPS);
    expect(MOVE_FLOOR).toBe(12);
    for (const recipe of sectorRecipes) {
      const cap = recipe.pattern === "dividerRow" ? 25 : 29;
      for (let step = TIER_STEPS + 1; step <= STRETCH_STEPS; step += 1) {
        const at = stretchRecipe(recipe, step);
        const before = stretchRecipe(recipe, step - 1);
        expect(stretchTier(step)).toBe(2);
        expect(at.moves[0]).toBeGreaterThanOrEqual(MOVE_FLOOR);
        expect(at.moves[0]).toBeLessThanOrEqual(at.moves[1]);
        expect(at.moves[0]).toBeLessThanOrEqual(before.moves[0]);
        expect(at.moves[1] - at.moves[0]).toBe(recipe.moves[1] - recipe.moves[0]);
        for (const index of [0, 1]) {
          expect(at.blockedCells[index]).toBeLessThanOrEqual(2 * recipe.blockedCells[index]);
          expect(at.blockedCells[index]).toBeGreaterThanOrEqual(before.blockedCells[index]);
          expect(at.paneLayers[index]).toBe(Math.min(3, recipe.paneLayers[index] + 1));
        }
        expect(at.blockers).toEqual(recipe.blockers);
      }
      const last = stretchRecipe(recipe, STRETCH_STEPS);
      expect(last.moves[0]).toBe(MOVE_FLOOR);
      expect(last.blockedCells).toEqual([Math.min(cap, recipe.blockedCells[0] * 2), Math.min(cap, recipe.blockedCells[1] * 2)]);
    }
  });

  it("the tuner stretches a recipe that cannot get hard enough", () => {
    // Level 17 has three small blocker goals and no collect goal: the bot never fails it as written.
    const recipe = recipeForLevel(17);
    const result = tuneLevel(recipe, 17, "Test", { searchGames: 2, games: 2, candidates: 4 });
    const { stretch } = result.details;
    expect(stretch.step).toBeGreaterThan(0);
    expect(stretch.step).toBeLessThanOrEqual(STRETCH_STEPS);
    expect(stretch.tier).toBe(stretchTier(stretch.step));
    const stretched = stretchRecipe(recipe, stretch.step);
    expect(stretch.moves).toEqual(stretched.moves);
    expect(stretch.blockedCells).toEqual(stretched.blockedCells);
    expect(stretch.paneLayers).toEqual(stretched.paneLayers);
    expect(result.level.moveLimit).toBeGreaterThanOrEqual(stretch.moves[0]);
    expect(result.level.moveLimit).toBeLessThanOrEqual(stretch.moves[1]);
  }, 60_000);

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
    expect(result.level.moveLimit).toBeGreaterThanOrEqual(recipe.moves[0] - 6);
    expect(result.level.moveLimit).toBeGreaterThanOrEqual(result.details.stretch.moves[0]);
    expect(result.level.moveLimit).toBeLessThanOrEqual(recipe.moves[1]);
    expect(result.report).toEqual(measureLevel(result.level, 4));
    expect(result.inBand).toBe(result.details.deadBoards === 0 && acceptsCandidate(result.report, 23));
    for (const goal of result.level.objectives) if (goal.id === "collect") expect(goal.target).toBeLessThanOrEqual(1.5 * result.level.moveLimit);
    const stars = result.level.starMoves;
    if (stars) expect(0 < stars.two && stars.two < stars.three && stars.three < result.level.moveLimit).toBe(true);
    expect(tuneLevel(recipe, 23, "Test", { searchGames: 2, games: 4, candidates: 2 })).toEqual(result);
  }, 60_000);
});

describe("build", () => {
  const tiny = { games: 2, searchGames: 2, candidates: 4 };

  function settingsIn(dir: string, levelIds: number[]): BuildSettings {
    return { levelIds, ...tiny, bot: DEFAULT_BOT, levelsDir: path.join(dir, "levels"), out: path.join(dir, "report.json") };
  }

  /** Runs jobs in this thread, optionally changing a result as if the tuner had returned it. */
  function inline(change: (result: TuneResult) => TuneResult = (result) => result) {
    return async (jobs: LevelJob[], onResult: (result: LevelJobResult, finished: number) => void) => {
      const results: LevelJobResult[] = [];
      for (const job of jobs) {
        let done = runLevelJob(job, DEFAULT_BOT);
        if (done.kind === "tune") done = { ...done, result: change(done.result) };
        results.push(done);
        onResult(done, results.length);
      }
      return results;
    };
  }

  it("a level that misses its band is written as its closest candidate, marked, and does not fail the build", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "levels-build-"));
    try {
      const outcome = await runBuild(settingsIn(dir, [17]), inline(), () => {});
      const expected = tuneLevel(recipeForLevel(17), 17, levelName(17), tiny);
      expect(expected.inBand).toBe(false);
      expect(readFileSync(levelFile(path.join(dir, "levels"), 17), "utf8")).toBe(levelJson(expected.level));
      const row = outcome.rows[0];
      expect(row).toMatchObject({ id: 17, inBand: false, outOfBand: true, target: 0.12, failRate: expected.report.failRate, tier: expected.details.stretch.tier });
      expect(outcome.outOfBand).toEqual([17]);
      expect(outcome.deadBoards).toEqual([]);
      expect(outcome.invalid).toEqual([]);
      expect(outcome.failed).toBe(false);
      const report = JSON.parse(readFileSync(path.join(dir, "report.json"), "utf8")) as { summary: string };
      expect(report.summary).toContain("0/1 levels in band, 1 out of band");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("a dead board or an invalid level still fails the build", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "levels-build-"));
    try {
      const dead = await runBuild(settingsIn(dir, [17]), inline((result) => ({ ...result, details: { ...result.details, deadBoards: 3 } })), () => {});
      expect(dead.deadBoards).toEqual([17]);
      expect(dead.failed).toBe(true);

      const broken = (result: TuneResult): TuneResult => ({
        ...result,
        level: { ...result.level, objectives: result.level.objectives.map((goal) => (goal.id === "malware" ? { ...goal, target: 2 } : goal)) }
      });
      const invalid = await runBuild(settingsIn(path.join(dir, "second"), [17]), inline(broken), () => {});
      expect(invalid.invalid.join(" ")).toContain("MALWARE_TARGET_INVALID");
      expect(invalid.failed).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
