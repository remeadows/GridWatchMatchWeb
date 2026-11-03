// A test bot for tuning level difficulty. It plays the real engine from the real starting seed, buys nothing and
// never takes Play On. Each turn it looks one move ahead: it plays every legal move on a fork of the game and keeps
// the best, except that with chance `mistakeRate` it plays a random legal move instead, like a person not looking.
import { BoardEngine, BoardEngineError, SeededRNG, type BoardAction, type BoardDelta, type LevelDefinition, type PowerUpType } from "../../src/engine";
import { levelSeed } from "../../src/state/progress";

export interface BotOptions {
  mistakeRate: number;
}

export const DEFAULT_BOT: BotOptions = { mistakeRate: 0.2 };

export interface GameResult {
  won: boolean;
  movesLeft: number;
  deadBoard: boolean;
}

// Score weights. Goal progress is measured as the share of each goal's target done by the move, so 100 means one
// whole goal. A power-up made is worth a little goal progress; cleared pieces only break ties between equal moves.
const winScore = 1_000_000;
const goalWeight = 100;
const powerUpWeight = 1.5;
const clearWeight = 0.05;
const powerUpValue: Record<PowerUpType["kind"], number> = { rocket: 1, propeller: 1, tnt: 1.5, lightBall: 3 };
const tieEpsilon = 1e-9;

interface GoalState {
  progress: Record<string, number>;
  targets: Record<string, number>;
  malwareLeft: number;
}

export function chooseMove(engine: BoardEngine, rng: SeededRNG, options: BotOptions): BoardAction {
  const moves = engine.validMoves();
  if (moves.length === 0) throw new BoardEngineError("noMovesAvailable", "No valid moves available.");
  // nextDouble reads the generator's high bits; nextInt's modulo would read its weak low bits.
  if (rng.nextDouble() < options.mistakeRate) return moves[pick(rng, moves.length)];

  const snapshot = engine.snapshot;
  const goals: GoalState = { progress: snapshot.objectiveProgress, targets: snapshot.objectiveTargets, malwareLeft: snapshot.malwareLeft };
  let best: BoardAction[] = [];
  let bestScore = -Infinity;
  for (const move of moves) {
    const score = scoreMove(engine, move, goals);
    if (score > bestScore + tieEpsilon) {
      bestScore = score;
      best = [move];
    } else if (score >= bestScore - tieEpsilon) {
      best.push(move);
    }
  }
  return best[pick(rng, best.length)];
}

export function playLevel(level: LevelDefinition, botSeed: bigint, options: BotOptions = DEFAULT_BOT): GameResult {
  return playGame(new BoardEngine(level, levelSeed(level.id)), new SeededRNG(botSeed), options);
}

/** Plays `engine` to the end. A board with no move left, which the engine could not shuffle, is a loss. */
export function playGame(engine: BoardEngine, rng: SeededRNG, options: BotOptions): GameResult {
  try {
    while (true) {
      const delta = engine.apply(chooseMove(engine, rng, options));
      if (delta.isWin) {
        const snapshot = engine.snapshot;
        return { won: true, movesLeft: snapshot.moveLimit - snapshot.moveCount, deadBoard: false };
      }
      if (delta.isFail) return { won: false, movesLeft: 0, deadBoard: false };
    }
  } catch (error) {
    if (error instanceof BoardEngineError && error.code === "noMovesAvailable") return { won: false, movesLeft: 0, deadBoard: true };
    throw error;
  }
}

/** Seed for game `index` of a level's report. Mixed so neighbouring games do not share a shifted random stream. */
export function gameSeed(levelId: number, index: number): bigint {
  const seed = splitMix64((BigInt(levelId) << 32n) + BigInt(index));
  return seed === 0n ? 1n : seed;
}

function scoreMove(engine: BoardEngine, move: BoardAction, goals: GoalState): number {
  let delta: BoardDelta;
  try {
    delta = engine.fork().apply(move);
  } catch (error) {
    // The engine could not shuffle the board after this move: a dead board, the worst outcome.
    if (error instanceof BoardEngineError && error.code === "noMovesAvailable") return -winScore;
    throw error;
  }
  if (delta.isWin) return winScore;

  let goal = 0;
  for (const event of delta.objectiveEvents) {
    const target = goals.targets[event.objectiveId] ?? 0;
    if (target <= 0) continue;
    const remaining = Math.max(0, target - (goals.progress[event.objectiveId] ?? 0));
    goal += Math.min(event.progressDelta, remaining) / target;
  }
  // The malware goal moves from 0 to 1 only when the last cell goes, so count the cells removed instead.
  if (goals.targets.malware !== undefined && goals.malwareLeft > 0) {
    const removed = delta.blockerClears.filter((clear) => clear.kind === "malware").length;
    goal += Math.min(removed, goals.malwareLeft) / goals.malwareLeft;
  }

  let powerUps = 0;
  for (const spawn of delta.spawns) if (spawn.asPowerUp) powerUps += powerUpValue[spawn.asPowerUp.kind];

  return goalWeight * goal + powerUpWeight * powerUps + clearWeight * delta.clears.length;
}

function pick(rng: SeededRNG, count: number): number {
  return Math.min(count - 1, Math.floor(rng.nextDouble() * count));
}

const mask64 = (1n << 64n) - 1n;

function splitMix64(value: bigint): bigint {
  let z = (value + 0x9e3779b97f4a7c15n) & mask64;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & mask64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & mask64;
  return z ^ (z >> 31n);
}
