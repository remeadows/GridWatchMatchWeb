// Tunes one level into its difficulty band. Candidates are built from seeds derived from the level id, so a run is
// repeatable. Each candidate is played at the longest move limit of its recipe: a game cut at a shorter limit is
// the same game up to that move, because the engine reads the move limit only to call a loss. So one batch of
// games reports every move limit in the range. A cheap batch sorts out candidates that cannot reach the band at any
// limit; the full batch then picks the move limit and decides. When the recipe cannot get hard enough, the tuner
// stretches it in steps. Tier 1: up to 6 fewer moves and 50% more blocked cells. Tier 2, only when tier 1 cannot
// reach the band: moves down to a floor of 12, up to twice the blocked cells, and one more pane layer (at most 3).
import { BoardEngine, SeededRNG, type LevelDefinition } from "../../src/engine";
import type { StarMoves } from "../../src/data/stars";
import { levelSeed } from "../../src/state/progress";
import { BAND_TOLERANCE, bandFor, failRateAccepted, targetFailRate } from "./bands";
import { DEFAULT_BOT, gameSeed, playGame, type BotOptions, type GameResult } from "./bot";
import { GRID_SIZE, buildLevel, withMoveLimit } from "./buildLevel";
import type { SectorRecipe } from "./recipes";
import { summarizeLevel, type LevelReport } from "./report";

export interface TuneOptions {
  /** Games that decide a candidate. */
  games?: number;
  /** Games of the cheap first look at a candidate. */
  searchGames?: number;
  /** Candidates to try at each stretch step before giving up on it. */
  candidates?: number;
  bot?: BotOptions;
}

/** How far a recipe was stretched: step 0 (tier 0) is the recipe as written. */
export interface Stretch {
  tier: 0 | 1 | 2;
  step: number;
  moves: [number, number];
  blockedCells: [number, number];
  paneLayers: [number, number];
}

export interface TuneResult {
  level: LevelDefinition;
  report: LevelReport;
  inBand: boolean;
  /** deadBoards counts games up to the recipe's most moves, past the chosen limit, since Play On goes there. */
  details: { target: number; candidate: number; pressure: number; deadBoards: number; candidatesTried: number; stretch: Stretch };
}

const defaults = { games: 200, searchGames: 40, candidates: 12 };

/** Steps in each stretch tier. Steps 1-3 are tier 1, steps 4-6 tier 2. */
export const TIER_STEPS = 3;
export const STRETCH_STEPS = 2 * TIER_STEPS;
/** Tier 2 never takes a move limit below this. */
export const MOVE_FLOOR = 12;
/** Pressure this close to the top that is still too easy means the recipe cannot get there: stretch it. */
const topPressure = 0.93;
const bottomPressure = 0.07;

interface PlayedGame {
  result: GameResult;
  movesUsed: number;
}

export function stretchTier(step: number): 0 | 1 | 2 {
  return step === 0 ? 0 : step <= TIER_STEPS ? 1 : 2;
}

/**
 * The recipe at stretch `step`. Tier 1 (steps 1-3) takes 2 moves off a step and adds a sixth to the blocked cells,
 * reaching 6 moves and x1.5. Tier 2 (steps 4-6) adds a layer to every pane and walks on to a fewest-moves limit of
 * 12 and x2 the blocked cells. No limit goes under 12; blocked cells are capped to leave room to play.
 */
export function stretchRecipe(recipe: SectorRecipe, step: number): SectorRecipe {
  if (step === 0) return recipe;
  const freeCells = GRID_SIZE * GRID_SIZE - (recipe.pattern === "dividerRow" ? GRID_SIZE : 0);
  const cap = Math.floor(freeCells * 0.6);
  const tierOne = Math.min(step, TIER_STEPS);
  const tierTwo = Math.max(0, step - TIER_STEPS);
  const afterTierOne = recipe.moves[0] - 2 * TIER_STEPS;
  const cut = 2 * tierOne + Math.round((Math.max(0, afterTierOne - MOVE_FLOOR) * tierTwo) / TIER_STEPS);
  const scale = 1 + tierOne / 6 + tierTwo / 6;
  const extraLayer = tierTwo > 0 ? 1 : 0;
  return {
    ...recipe,
    moves: [Math.max(MOVE_FLOOR, recipe.moves[0] - cut), Math.max(MOVE_FLOOR, recipe.moves[1] - cut)],
    blockedCells: [Math.min(cap, Math.round(recipe.blockedCells[0] * scale)), Math.min(cap, Math.round(recipe.blockedCells[1] * scale))],
    paneLayers: [Math.min(3, recipe.paneLayers[0] + extraLayer), Math.min(3, recipe.paneLayers[1] + extraLayer)]
  };
}

export function tuneLevel(recipe: SectorRecipe, levelId: number, name: string, options: TuneOptions = {}): TuneResult {
  const games = options.games ?? defaults.games;
  const searchGames = Math.min(games, options.searchGames ?? defaults.searchGames);
  const candidates = options.candidates ?? defaults.candidates;
  const bot = options.bot ?? DEFAULT_BOT;
  const target = targetFailRate(levelId);
  const [bandMin, bandMax] = bandFor(levelId);
  const lowest = Math.max(bandMin, target - BAND_TOLERANCE);
  const highest = Math.min(bandMax, target + BAND_TOLERANCE);

  let best: TuneResult | null = null;
  let bestDistance = Infinity;
  // The candidate whose first look came closest, for when no candidate earns a full measurement.
  let nearest: { candidate: number; pressure: number; level: LevelDefinition; stretch: Stretch; distance: number } | null = null;
  let tried = 0;
  let candidate = 0;
  for (let step = 0; step <= STRETCH_STEPS; step += 1) {
    const stretched = stretchRecipe(recipe, step);
    const [fewest, most] = stretched.moves;
    const stretch: Stretch = { tier: stretchTier(step), step, moves: [fewest, most], blockedCells: [...stretched.blockedCells], paneLayers: [...stretched.paneLayers] };
    // Pressure is searched by halving: too easy at the fewest moves pushes it up; too hard at the most moves, or a
    // dead board, pushes it down.
    let low = 0;
    let high = 1;
    let tooEasyAtTop = false;
    let tooHardAtBottom = false;
    // Layouts differ, so one board can be too hard at a pressure where another was too easy. Then the halving has
    // pinned itself on noise: start it again with fresh layouts instead of giving up.
    let sawTooEasy = false;
    for (let attempt = 0; attempt < candidates && !tooEasyAtTop && !tooHardAtBottom; attempt += 1, candidate += 1) {
      tried += 1;
      const pressure = (low + high) / 2;
      const level = buildLevel(stretched, levelId, name, candidateSeed(levelId, candidate), { pressure });
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
      // A tie goes to the later candidate: the search moves towards the target, and stretching only goes on harder.
      if (!nearest || gap <= nearest.distance + 1e-12) nearest = { candidate, pressure, level, stretch, distance: gap };
      if (deadBoards(first) > 0) {
        high = pressure;
        continue;
      }
      if (hardest < lowest) {
        low = pressure;
        sawTooEasy = true;
        tooEasyAtTop = pressure >= topPressure;
        continue;
      }
      if (easiest > highest) {
        high = pressure;
        if (pressure <= bottomPressure) {
          if (!sawTooEasy) tooHardAtBottom = true;
          else [low, high] = [0, 1];
        }
        continue;
      }

      const result = finish(level, fewest, most, playLongest(level, most, games, bot), levelId, candidate, pressure, stretch);
      if (result.inBand) return withTried(result, tried);
      const distance = Math.abs(result.report.failRate - target) + (result.details.deadBoards > 0 ? 1 : 0);
      if (distance < bestDistance - 1e-12) {
        best = result;
        bestDistance = distance;
      }
      if (result.details.deadBoards > 0 || result.report.failRate > target) high = pressure;
      else {
        low = pressure;
        sawTooEasy = true;
        tooEasyAtTop = pressure >= topPressure;
      }
    }
    // Stretching only makes a level harder, so it helps only when the recipe ran out of difficulty.
    if (!tooEasyAtTop) break;
  }

  // Nothing landed in band. Report the closest full measurement, or failing that the closest first look.
  if (best) return withTried(best, tried);
  if (!nearest) throw new Error(`Level ${levelId}: no candidate board passed the engine.`);
  const { level, pressure, stretch } = nearest;
  return withTried(finish(level, stretch.moves[0], stretch.moves[1], playLongest(level, stretch.moves[1], games, bot), levelId, nearest.candidate, pressure, stretch), tried);
}

/**
 * Picks the move limit closest to the target, preferring one that is accepted, sets star thresholds and reports.
 * In band also needs no dead board in any game up to the most moves.
 */
function finish(level: LevelDefinition, fewest: number, most: number, played: PlayedGame[], levelId: number, candidate: number, pressure: number, stretch: Stretch): TuneResult {
  const target = targetFailRate(levelId);
  const moves = closestLimit(summarizeLimits(level, fewest, most, played), levelId);
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
  return { level: tuned, report, inBand: dead === 0 && acceptsCandidate(report, levelId), details: { target, candidate, pressure, deadBoards: dead, candidatesTried: 0, stretch } };
}

function withTried(result: TuneResult, tried: number): TuneResult {
  return { ...result, details: { ...result.details, candidatesTried: tried } };
}

function closestLimit(reports: Map<number, LevelReport>, levelId: number): number {
  const target = targetFailRate(levelId);
  let chosen = 0;
  let chosenScore = Infinity;
  // From the most moves down, so a tie keeps the kinder limit. An accepted limit beats any that is not.
  for (const moves of [...reports.keys()].sort((left, right) => right - left)) {
    const report = reports.get(moves)!;
    const score = Math.abs(report.failRate - target) + (acceptsCandidate(report, levelId) ? 0 : 10);
    if (score < chosenScore - 1e-12) {
      chosen = moves;
      chosenScore = score;
    }
  }
  return chosen;
}

function deadBoards(played: PlayedGame[]): number {
  return played.filter((game) => game.result.deadBoard).length;
}

/** Accepted: no dead board, and a fail rate inside the level's band and within the tolerance of its target. */
export function acceptsCandidate(report: Pick<LevelReport, "failRate" | "deadBoards">, levelId: number): boolean {
  return report.deadBoards === 0 && failRateAccepted(report.failRate, levelId);
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
