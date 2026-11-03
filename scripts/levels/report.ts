// Difficulty report for one level: the test bot plays it many times and this sums up how it went.
import { readFileSync } from "node:fs";
import path from "node:path";
import { normalizeLevel } from "../../src/data/levels";
import { starsForMovesLeft } from "../../src/data/stars";
import { coinsPerLeftoverMove } from "../../src/data/store";
import type { LevelDefinition } from "../../src/engine";
import { DEFAULT_BOT, gameSeed, playLevel, type BotOptions, type GameResult } from "./bot";

export interface LevelReport {
  id: number;
  games: number;
  /** Share of games lost, dead boards included. */
  failRate: number;
  /** Moves left at the end, averaged over every game: a loss counts as 0. */
  avgMovesLeft: number;
  /** Number of wins with one, two and three stars. */
  starSpread: [number, number, number];
  /** Coins a first win pays (10 per star plus coins per leftover move), averaged over the wins. 0 with no win. */
  firstWinCoins: number;
  deadBoards: number;
  /** Moves left in each won game, in game order. */
  winMovesLeft: number[];
}

export function measureLevel(level: LevelDefinition, games: number, options: BotOptions = DEFAULT_BOT): LevelReport {
  return summarizeLevel(level, playGames(level, 0, games, options));
}

/** Plays games `start` to `start + count - 1` of a level's report. Game i always uses the same bot seed. */
export function playGames(level: LevelDefinition, start: number, count: number, options: BotOptions = DEFAULT_BOT): GameResult[] {
  const results: GameResult[] = [];
  for (let index = start; index < start + count; index += 1) results.push(playLevel(level, gameSeed(level.id, index), options));
  return results;
}

export function summarizeLevel(level: LevelDefinition, results: GameResult[]): LevelReport {
  const wins = results.filter((result) => result.won);
  const starSpread: [number, number, number] = [0, 0, 0];
  let coins = 0;
  for (const win of wins) {
    const stars = starsForMovesLeft(win.movesLeft, level.moveLimit, level.starMoves);
    starSpread[stars - 1] += 1;
    coins += stars * 10 + win.movesLeft * coinsPerLeftoverMove;
  }
  const games = results.length;
  return {
    id: level.id,
    games,
    failRate: round(games === 0 ? 0 : (games - wins.length) / games),
    avgMovesLeft: round(games === 0 ? 0 : wins.reduce((total, win) => total + win.movesLeft, 0) / games),
    starSpread,
    firstWinCoins: round(wins.length === 0 ? 0 : coins / wins.length),
    deadBoards: results.filter((result) => result.deadBoard).length,
    winMovesLeft: wins.map((win) => win.movesLeft)
  };
}

export function readLevelFile(levelId: number, levelsDir = path.resolve(process.cwd(), "public/levels")): LevelDefinition {
  const file = path.join(levelsDir, `level_${String(levelId).padStart(3, "0")}.json`);
  return normalizeLevel(JSON.parse(readFileSync(file, "utf8")) as LevelDefinition);
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
