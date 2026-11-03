// Tunes one level into its difficulty band. Candidates are built from seeds derived from the level id, so a run is
// repeatable. Each candidate is played at the longest move limit of its recipe: a game cut at a shorter limit is
// the same game up to that move, because the engine reads the move limit only to call a loss. So one batch of
// games reports every move limit in the range. A cheap batch sorts out candidates that cannot reach the band at any
// limit; the full batch then picks the move limit and decides.
import { BoardEngine, SeededRNG, type LevelDefinition } from "../../src/engine";
import type { StarMoves } from "../../src/data/stars";
import { levelSeed } from "../../src/state/progress";
import { BAND_TOLERANCE, targetFailRate } from "./bands";
import { DEFAULT_BOT, gameSeed, playGame, type BotOptions, type GameResult } from "./bot";
import { buildLevel, withMoveLimit } from "./buildLevel";
import type { SectorRecipe } from "./recipes";
import { summarizeLevel, type LevelReport } from "./report";

export interface TuneOptions {
  /** Games that decide a candidate. */
  games?: number;
  /** Games of the cheap first look at a candidate. */
  searchGames?: number;
  /** Candidates to try before giving up. */
  candidates?: number;
  bot?: BotOptions;
}

export interface TuneResult {
  level: LevelDefinition;
  report: LevelReport;
  inBand: boolean;
  /** deadBoards counts games up to the recipe's most moves, past the chosen limit, since Play On goes there. */
  details: { target: number; candidate: number; pressure: number; deadBoards: number; candidatesTried: number };
}

const defaults = { games: 200, searchGames: 40, candidates: 12 };

interface PlayedGame {
  result: GameResult;
  movesUsed: number;
}

export function tuneLevel(recipe: SectorRecipe, levelId: number, name: string, options: TuneOptions = {}): TuneResult {
  const games = options.games ?? defaults.games;
  const searchGames = Math.min(games, options.searchGames ?? defaults.searchGames);
  const candidates = options.candidates ?? defaults.candidates;
  const bot = options.bot ?? DEFAULT_BOT;
  const target = targetFailRate(levelId);
  const [fewest, most] = recipe.moves;

  // Pressure is searched by halving: too easy at the fewest moves pushes it up; too hard at the most moves, or a
  // dead board, pushes it down.
  let low = 0;
  let high = 1;
  let best: TuneResult | null = null;
  let bestDistance = Infinity;
  // The candidate whose first look came closest, for when no candidate earns a full measurement.
  let nearest: { candidate: number; pressure: number; level: LevelDefinition; distance: number } | null = null;
  let tried = 0;
  for (let candidate = 0; candidate < candidates; candidate += 1) {
    tried += 1;
    const pressure = (low + high) / 2;
    const level = buildLevel(recipe, levelId, name, candidateSeed(levelId, candidate), { pressure });
    let first: PlayedGame[];
    try {
      first = playLongest(level, most, searchGames, bot);
    } catch {
      continue; // The engine refused the board: not a candidate.
    }
    const search = summarizeLimits(level, fewest, most, first);
    const hardest = search.get(fewest)!.failRate;
    const easiest = search.get(most)!.failRate;
    const gap = (hardest < target ? target - hardest : easiest > target ? easiest - target : 0) + (deadBoards(first) > 0 ? 1 : 0);
    if (!nearest || gap < nearest.distance - 1e-12) nearest = { candidate, pressure, level, distance: gap };
    if (deadBoards(first) > 0) {
      high = pressure;
      continue;
    }
    if (hardest < target - BAND_TOLERANCE) {
      low = pressure;
      continue;
    }
    if (easiest > target + BAND_TOLERANCE) {
      high = pressure;
      continue;
    }

    const result = finish(level, fewest, most, playLongest(level, most, games, bot), target, candidate, pressure);
    if (result.inBand) return withTried(result, tried);
    const distance = Math.abs(result.report.failRate - target) + (result.details.deadBoards > 0 ? 1 : 0);
    if (distance < bestDistance - 1e-12) {
      best = result;
      bestDistance = distance;
    }
    if (result.details.deadBoards > 0 || result.report.failRate > target) high = pressure;
    else low = pressure;
  }

  // Nothing landed in band. Report the closest full measurement, or failing that the closest first look.
  if (best) return withTried(best, tried);
  if (!nearest) throw new Error(`Level ${levelId}: no candidate board passed the engine.`);
  const { level, candidate, pressure } = nearest;
  return withTried(finish(level, fewest, most, playLongest(level, most, games, bot), target, candidate, pressure), tried);
}

/**
 * Picks the move limit closest to the target, sets star thresholds and reports. In band also needs no dead board
 * in any game up to the most moves.
 */
function finish(level: LevelDefinition, fewest: number, most: number, played: PlayedGame[], target: number, candidate: number, pressure: number): TuneResult {
  const moves = closestLimit(summarizeLimits(level, fewest, most, played), target);
  const tuned = withMoveLimit(level, moves);
  const cut = cutAt(played, moves);
  const starMoves = starMovesFor(
    cut.filter((game) => game.won).map((game) => game.movesLeft),
    moves
  );
  if (starMoves) tuned.starMoves = starMoves;
  else delete tuned.starMoves;
  const report = summarizeLevel(tuned, cut);
  const dead = deadBoards(played);
  return { level: tuned, report, inBand: dead === 0 && acceptsCandidate(report, target), details: { target, candidate, pressure, deadBoards: dead, candidatesTried: 0 } };
}

function withTried(result: TuneResult, tried: number): TuneResult {
  return { ...result, details: { ...result.details, candidatesTried: tried } };
}

function closestLimit(reports: Map<number, LevelReport>, target: number): number {
  let chosen = 0;
  let chosenDistance = Infinity;
  // From the most moves down, so a tie keeps the kinder limit.
  for (const moves of [...reports.keys()].sort((left, right) => right - left)) {
    const distance = Math.abs(reports.get(moves)!.failRate - target);
    if (distance < chosenDistance - 1e-12) {
      chosen = moves;
      chosenDistance = distance;
    }
  }
  return chosen;
}

function deadBoards(played: PlayedGame[]): number {
  return played.filter((game) => game.result.deadBoard).length;
}

/** In band: within the tolerance of the target, with no dead board. */
export function acceptsCandidate(report: Pick<LevelReport, "failRate" | "deadBoards">, target: number): boolean {
  return report.deadBoards === 0 && Math.abs(report.failRate - target) <= BAND_TOLERANCE + 1e-9;
}

/**
 * Star thresholds from the moves left in the bot's wins: three stars from the 75th percentile, two from the median
 * (nearest rank). Undefined when they cannot satisfy 0 < two < three < moveLimit; the default rule then applies.
 */
export function starMovesFor(winMovesLeft: number[], moveLimit: number): StarMoves | undefined {
  if (winMovesLeft.length === 0) return undefined;
  const sorted = [...winMovesLeft].sort((left, right) => left - right);
  const rank = (share: number) => sorted[Math.max(0, Math.ceil(share * sorted.length) - 1)];
  const two = rank(0.5);
  const three = rank(0.75);
  return 0 < two && two < three && three < moveLimit ? { two, three } : undefined;
}

/**
 * Plays `games` games at `maxMoves` and reports each move limit from `minMoves` to `maxMoves` as if it had been
 * played at that limit. Game i uses bot seed gameSeed(level.id, i), as measureLevel does.
 */
export function reportsByMoveLimit(level: LevelDefinition, minMoves: number, maxMoves: number, games: number, options: BotOptions = DEFAULT_BOT): Map<number, LevelReport> {
  return summarizeLimits(level, minMoves, maxMoves, playLongest(level, maxMoves, games, options));
}

function playLongest(level: LevelDefinition, maxMoves: number, games: number, options: BotOptions): PlayedGame[] {
  const longest = withMoveLimit(level, maxMoves);
  const played: PlayedGame[] = [];
  for (let index = 0; index < games; index += 1) {
    const engine = new BoardEngine(longest, levelSeed(level.id));
    const result = playGame(engine, new SeededRNG(gameSeed(level.id, index)), options);
    played.push({ result, movesUsed: engine.snapshot.moveCount });
  }
  return played;
}

function summarizeLimits(level: LevelDefinition, minMoves: number, maxMoves: number, played: PlayedGame[]): Map<number, LevelReport> {
  const reports = new Map<number, LevelReport>();
  for (let moves = minMoves; moves <= maxMoves; moves += 1) reports.set(moves, summarizeLevel(withMoveLimit(level, moves), cutAt(played, moves)));
  return reports;
}

/** The games as they would have ended with `moves` moves: a dead board counts only if it came within them. */
function cutAt(played: PlayedGame[], moves: number): GameResult[] {
  return played.map(({ result, movesUsed }) => {
    if (movesUsed > moves) return { won: false, movesLeft: 0, deadBoard: false };
    if (result.won) return { won: true, movesLeft: moves - movesUsed, deadBoard: false };
    return { won: false, movesLeft: 0, deadBoard: result.deadBoard };
  });
}

/** Seed of candidate `index` for a level: apart from every game seed, which use indexes below a million. */
export function candidateSeed(levelId: number, index: number): bigint {
  return gameSeed(levelId, 1_000_000 + index);
}
