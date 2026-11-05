import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { normalizeLevel } from "../data/levels";
import { BoardEngine, BoardEngineError, SeededRNG, type BoardAction, type BoardDelta, type LevelDefinition } from "../engine";
import { levelSeed } from "../state/progress";
import { DEFAULT_BOT, chooseMove, playGame, playLevel, type GameResult } from "../../scripts/levels/bot";
import { measureLevel, summarizeLevel } from "../../scripts/levels/report";

// Wrap the real seed so a test can see which seed the bot asked for; behaviour is unchanged.
vi.mock("../state/progress", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../state/progress")>();
  return { ...actual, levelSeed: vi.fn(actual.levelSeed) };
});

const levelsDir = path.resolve(process.cwd(), "public/levels");

function readLevel(id: number): LevelDefinition {
  const file = `level_${String(id).padStart(3, "0")}.json`;
  return normalizeLevel(JSON.parse(readFileSync(path.join(levelsDir, file), "utf8")) as LevelDefinition);
}

function engineKey(engine: BoardEngine): string {
  return JSON.stringify({ snapshot: engine.snapshot, log: engine.actionLog(), moves: engine.validMoves() }, (_key, value) =>
    value instanceof Set ? [...value] : value
  );
}

/** Plays random valid moves on both engines in lockstep and checks they never drift apart. */
function playInLockstep(left: BoardEngine, right: BoardEngine, rng: SeededRNG, steps: number): number {
  let played = 0;
  for (let step = 0; step < steps; step += 1) {
    const moves = left.validMoves();
    if (moves.length === 0) break;
    const action: BoardAction = moves[Math.floor(rng.nextDouble() * moves.length)];
    let leftDelta: BoardDelta;
    try {
      leftDelta = left.apply(action);
    } catch (error) {
      expect(() => right.apply(action)).toThrow((error as Error).message);
      break;
    }
    expect(right.apply(action)).toEqual(leftDelta);
    expect(engineKey(right)).toBe(engineKey(left));
    played += 1;
    if (leftDelta.isWin || leftDelta.isFail) break;
  }
  return played;
}

describe("BoardEngine.fork", () => {
  it("fork plays on without touching the original", () => {
    const engine = new BoardEngine(readLevel(41), levelSeed(41));
    const before = engineKey(engine);
    const fork = engine.fork();
    fork.apply(fork.validMoves()[0]);
    expect(engineKey(engine)).toBe(before);
    expect(engineKey(fork)).not.toBe(before);
  });

  it("fork and original agree when given the same move", () => {
    const engine = new BoardEngine(readLevel(41), levelSeed(41));
    const fork = engine.fork();
    const action = engine.validMoves()[0];
    expect(fork.apply(action)).toEqual(engine.apply(action));
    expect(engineKey(fork)).toBe(engineKey(engine));
  });

  it("fork copies every field of the engine", () => {
    const engine = new BoardEngine(readLevel(55), levelSeed(55));
    engine.apply(engine.validMoves()[0]);
    engine.extendMoveLimit(5);
    const fork = engine.fork();
    expect(Object.keys(fork).sort()).toEqual(Object.keys(engine).sort());
    expect(Object.getPrototypeOf(fork)).toBe(BoardEngine.prototype);
  });

  // Levels chosen for their blockers: locks, panes, malware, generators, placed power-ups, multi-goal bosses.
  it.each([1, 7, 18, 35, 50, 60, 67, 80, 90, 100])("a fork of level %i plays exactly like the original over many moves", (id) => {
    forkAgreesOverManyMoves(readLevel(id));
  });

  it("a fork agrees on a level with malware, pane and lock goals", () => {
    const level: LevelDefinition = {
      ...readLevel(35),
      objectives: [
        { id: "malware", target: 1, displayName: "Clear the malware", tileType: null },
        { id: "panes", target: 3, displayName: "Break 3 panes", tileType: null },
        { id: "locks", target: 4, displayName: "Open 4 locks", tileType: null }
      ]
    };
    forkAgreesOverManyMoves(level);
  });

  function forkAgreesOverManyMoves(level: LevelDefinition): void {
    const id = level.id;
    const original = new BoardEngine(level, levelSeed(id));
    const rng = new SeededRNG(BigInt(id) * 7919n + 1n);
    // Fork mid-game, after Play On, so the move limit bonus and the per-move blocker state are live.
    playInLockstep(original, original.fork(), rng, 5);
    original.extendMoveLimit(5);
    const fork = original.fork();
    const played = playInLockstep(original, fork, rng, 200);
    expect(played).toBeGreaterThan(5);
  }

  it("fork() with no option still matches the original exactly", () => {
    const engine = new BoardEngine(readLevel(60), levelSeed(60));
    expect(engine.fork().snapshot.rngSeed).toBe(engine.snapshot.rngSeed);
    expect(engine.fork({}).snapshot.rngSeed).toBe(engine.snapshot.rngSeed);
    playInLockstep(engine, engine.fork(), new SeededRNG(11n), 60);
    playInLockstep(engine, engine.fork({}), new SeededRNG(12n), 60);
  });

  it("two lookahead forks with different seeds can produce different refills from the same move", () => {
    const engine = new BoardEngine(readLevel(41), levelSeed(41));
    const before = engineKey(engine);
    const move = engine.validMoves()[0];
    const refills = (rngSeed: bigint) => JSON.stringify(engine.fork({ rngSeed }).apply(move).spawns);
    expect(refills(1n)).not.toBe(refills(2n));
    // A seeded fork is repeatable, does not follow the real game, and leaves the original alone.
    expect(refills(1n)).toBe(refills(1n));
    expect(refills(1n)).not.toBe(JSON.stringify(engine.fork().apply(move).spawns));
    expect(engine.fork({ rngSeed: 0n }).snapshot.rngSeed).toBe("0");
    expect(engineKey(engine)).toBe(before);
  });

  it("a fork of a fork keeps agreeing", () => {
    const engine = new BoardEngine(readLevel(78), levelSeed(78));
    const rng = new SeededRNG(3n);
    playInLockstep(engine, engine.fork().fork(), rng, 40);
  });
});

describe("SeededRNG.fromState", () => {
  it("continues the same sequence", () => {
    const rng = new SeededRNG(12345n);
    rng.nextUInt64();
    const copy = SeededRNG.fromState(rng.state);
    for (let index = 0; index < 20; index += 1) expect(copy.nextUInt64()).toBe(rng.nextUInt64());
  });

  it("accepts a zero state, which the generator can reach", () => {
    expect(SeededRNG.fromState(0n).nextUInt64()).toBe(1442695040888963407n);
  });
});

describe("level bot", () => {
  it("the bot uses the real level seed", () => {
    const level = readLevel(41);
    const seedSpy = vi.mocked(levelSeed);
    seedSpy.mockClear();
    for (const botSeed of [1n, 2n, 3n]) {
      const result = playLevel(level, botSeed);
      const expected = playGame(new BoardEngine(level, levelSeed(level.id)), new SeededRNG(botSeed), DEFAULT_BOT);
      expect(result).toEqual(expected);
    }
    expect(seedSpy).toHaveBeenCalledWith(41);
    // playLevel asked for the seed once per game, and the check above once per game.
    expect(seedSpy.mock.calls.filter(([id]) => id === 41)).toHaveLength(6);
  });

  it("the bot beats random play", () => {
    const level = readLevel(7);
    const games = 30;
    const bot = measureLevel(level, games, DEFAULT_BOT);
    const random = measureLevel(level, games, { mistakeRate: 1 });
    expect(bot.failRate).toBeLessThanOrEqual(random.failRate);
    // A margin, so a bot no better than random cannot pass on fail rate alone.
    expect(bot.avgMovesLeft).toBeGreaterThanOrEqual(random.avgMovesLeft + 3);
  }, 30_000); // 60 simulated games: about 3 s here, past the 5 s default on GitHub's runners

  it("a game's real refills are unaffected by the lookahead seeds", () => {
    for (const id of [41, 90]) {
      const level = readLevel(id);
      const played = new BoardEngine(level, levelSeed(id));
      const result = playGame(played, new SeededRNG(7n), DEFAULT_BOT);
      // Replaying the bot's moves on a fresh game from levelSeed, with no lookahead at all, lands on the same board:
      // every real refill came from the game's own generator.
      const replay = new BoardEngine(level, levelSeed(id));
      for (const action of played.actionLog()) replay.apply(action);
      expect(engineKey(replay)).toBe(engineKey(played));
      expect(playLevel(level, 7n)).toEqual(result);
    }
  });

  it("the lookahead never sees the game's own refills", () => {
    const engine = new BoardEngine(readLevel(41), levelSeed(41));
    const forkSpy = vi.spyOn(BoardEngine.prototype, "fork");
    try {
      chooseMove(engine, new SeededRNG(4n), { mistakeRate: 0 });
      expect(forkSpy).toHaveBeenCalledTimes(engine.validMoves().length);
      const seeds = forkSpy.mock.calls.map(([options]) => options?.rngSeed);
      expect(seeds.every((seed) => typeof seed === "bigint")).toBe(true);
      // One guess per turn, shared by every candidate.
      expect(new Set(seeds).size).toBe(1);
    } finally {
      forkSpy.mockRestore();
    }
  });

  it("playing a level is repeatable", () => {
    const level = readLevel(67);
    expect(playLevel(level, 99n)).toEqual(playLevel(level, 99n));
    expect(playLevel(level, 99n, { mistakeRate: 0.5 })).toEqual(playLevel(level, 99n, { mistakeRate: 0.5 }));
  });

  it("chooseMove always returns a valid move and leaves the engine alone", () => {
    const engine = new BoardEngine(readLevel(33), levelSeed(33));
    const rng = new SeededRNG(5n);
    for (let step = 0; step < 10; step += 1) {
      const before = engineKey(engine);
      const move = chooseMove(engine, rng, DEFAULT_BOT);
      expect(engineKey(engine)).toBe(before);
      expect(engine.validMoves()).toContainEqual(move);
      const delta = engine.apply(move);
      if (delta.isWin || delta.isFail) break;
    }
  });

  it("a dead board counts as a loss", () => {
    const level = readLevel(41);
    const engine = new BoardEngine(level, levelSeed(41));
    const stuck = Object.assign(engine, {
      apply: () => {
        throw new BoardEngineError("noMovesAvailable", "No valid moves available.");
      }
    });
    const result: GameResult = playGame(stuck, new SeededRNG(1n), DEFAULT_BOT);
    expect(result).toEqual({ won: false, movesLeft: 0, deadBoard: true });
  });

  it("the report counts wins, stars and first-win coins", () => {
    const level = { ...readLevel(41), moveLimit: 20, starMoves: undefined };
    const results: GameResult[] = [
      { won: true, movesLeft: 10, deadBoard: false },
      { won: true, movesLeft: 4, deadBoard: false },
      { won: true, movesLeft: 1, deadBoard: false },
      { won: false, movesLeft: 0, deadBoard: false },
      { won: false, movesLeft: 0, deadBoard: true }
    ];
    const report = summarizeLevel(level, results);
    expect(report).toEqual({
      id: 41,
      games: 5,
      failRate: 0.4,
      avgMovesLeft: 3,
      starSpread: [1, 1, 1],
      // Wins pay 10 per star plus 5 per leftover move: 80, 40, 15.
      firstWinCoins: 45,
      deadBoards: 1,
      winMovesLeft: [10, 4, 1]
    });
  });
});
