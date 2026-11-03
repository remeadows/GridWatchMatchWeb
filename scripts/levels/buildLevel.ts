// Builds one candidate level from a sector recipe and a candidate seed. The cell map carries only blockers; every
// piece is left for the engine to deal from levelSeed(levelId), as in real play, so candidates differ by layout.
import { SeededRNG, type CellDefinition, type LevelDefinition, type ObjectiveDefinition, type TileType } from "../../src/engine";
import type { Blocker, BoardPattern, SectorRecipe } from "./recipes";

export const GRID_SIZE = 7;
const maxGoals = 3;
const dividerRow = 3;

export interface BuildOptions {
  /**
   * 0 to 1: how hard the candidate leans within its recipe. With room for a collect goal it sets the goal's size,
   * and the seed lays out the blockers anywhere in the recipe's ranges. With three blocker goals and no collect goal
   * it sets the number of blocked cells and their layers instead. Left out, the candidate seed picks it.
   */
  pressure?: number;
}

/** The recipe blockers in play at a level: a sector with `introducedAt` brings them in one at a time. */
export function blockersForLevel(recipe: SectorRecipe, levelId: number): Blocker[] {
  return recipe.blockers.filter((blocker) => (recipe.introducedAt?.[blocker] ?? 0) <= levelId);
}

export function buildLevel(recipe: SectorRecipe, levelId: number, name: string, candidateSeed: bigint, options: BuildOptions = {}): LevelDefinition {
  const rng = new SeededRNG(candidateSeed === 0n ? 1n : candidateSeed);
  const random = () => rng.nextDouble();
  const pressure = clamp01(options.pressure ?? random());
  const blockers = blockersForLevel(recipe, levelId);
  const collectRoom = blockers.length < maxGoals;
  const blockerPressure = collectRoom ? random() : pressure;

  const cellMap: CellDefinition[][] = Array.from({ length: GRID_SIZE }, () => Array.from({ length: GRID_SIZE }, plainCell));
  const taken = new Set<string>();
  if (recipe.pattern === "dividerRow") {
    for (let col = 0; col < GRID_SIZE; col += 1) {
      cellMap[dividerRow][col] = honeypotCell();
      taken.add(key(dividerRow, col));
    }
  }

  const total = recipe.blockedCells[0] + Math.round(blockerPressure * (recipe.blockedCells[1] - recipe.blockedCells[0]));
  const shares = shareCells(total, blockers.length);
  blockers.forEach((blocker, index) => {
    const pattern = cellPattern(recipe.pattern, blocker, index);
    const order = orderCells(pattern, random).filter((position) => !taken.has(key(position.row, position.col)));
    for (const position of order.slice(0, shares[index])) {
      taken.add(key(position.row, position.col));
      cellMap[position.row][position.col] = blockerCell(blocker, recipe, blockerPressure, random);
    }
  });

  const objectives = blockerGoals(cellMap, blockers);
  if (collectRoom) objectives.push(collectGoal(levelId, recipe, pressure, random));

  const level: LevelDefinition = {
    id: levelId,
    name,
    gridRows: GRID_SIZE,
    gridCols: GRID_SIZE,
    moveLimit: recipe.moves[1],
    objectives,
    cellMap,
    spawnWeights: spawnWeightsFor(levelId),
    bossLevel: levelId % 10 === 0,
    bonusLevel: false
  };
  return withMoveLimit(level, recipe.moves[1]);
}

/** The level with another move limit. A boss timer follows it: 4 seconds a move, at least 60. */
export function withMoveLimit(level: LevelDefinition, moveLimit: number): LevelDefinition {
  const next: LevelDefinition = { ...level, moveLimit };
  if (next.bossLevel) next.bossTimerSeconds = Math.max(60, moveLimit * 4);
  else delete next.bossTimerSeconds;
  return next;
}

/** Four pieces evenly below level 50; from 50 zeroDay joins as a fifth. */
export function spawnWeightsFor(levelId: number): Partial<Record<TileType, number>> {
  if (levelId < 50) return { packet: 0.25, firewall: 0.25, key: 0.25, threat: 0.25 };
  return { packet: 0.2, firewall: 0.2, key: 0.2, threat: 0.2, zeroDay: 0.2 };
}

function blockerGoals(cellMap: CellDefinition[][], blockers: Blocker[]): ObjectiveDefinition[] {
  const cells = cellMap.flat();
  const goals: ObjectiveDefinition[] = [];
  for (const blocker of blockers) {
    if (blocker === "pane") {
      const count = cells.filter((cell) => cell.overlay !== null).length;
      if (count > 0) goals.push({ id: "panes", target: count, displayName: `Clear ${count} encrypted ${count === 1 ? "pane" : "panes"}`, tileType: null });
    } else if (blocker === "lock") {
      const count = cells.filter((cell) => cell.locked && cell.generator === null).length;
      if (count > 0) goals.push({ id: "locks", target: count, displayName: `Free ${count} locked ${count === 1 ? "cell" : "cells"}`, tileType: null });
    } else if (cells.some((cell) => cell.underlay !== null)) {
      goals.push({ id: "malware", target: 1, displayName: "Remove all malware", tileType: null });
    }
  }
  return goals;
}

const collectNames: Record<TileType, string> = { packet: "Packets", firewall: "Firewalls", key: "Keys", threat: "Threats", zeroDay: "Zero-Days" };

/**
 * A collect goal sized from the recipe's moves: 1 to 10 pieces of one kind a move with four kinds of piece, or 0.5
 * to 4 with five, rising with pressure. The test bot collects one kind fast with four kinds; a fifth slows it a lot.
 */
function collectGoal(levelId: number, recipe: SectorRecipe, pressure: number, random: () => number): ObjectiveDefinition {
  const tiles = Object.keys(spawnWeightsFor(levelId)) as TileType[];
  const tileType = tiles[Math.min(tiles.length - 1, Math.floor(random() * tiles.length))];
  const moves = (recipe.moves[0] + recipe.moves[1]) / 2;
  const perMove = tiles.length > 4 ? 0.5 + pressure * 3.5 : 1 + pressure * 9;
  const target = Math.max(10, Math.round(moves * perMove));
  return { id: "collect", target, displayName: `Collect ${target} ${collectNames[tileType]}`, tileType };
}

function blockerCell(blocker: Blocker, recipe: SectorRecipe, pressure: number, random: () => number): CellDefinition {
  const cell = plainCell();
  if (blocker === "pane") cell.overlay = `encryptedVolume_${layersFor(recipe.paneLayers, pressure, random)}`;
  else if (blocker === "lock") cell.locked = true;
  else cell.underlay = `malware_${layersFor([1, 2], pressure * 0.5, random)}`;
  return cell;
}

/** Layers between min and max that average min + pressure x (max - min). */
function layersFor([min, max]: [number, number], pressure: number, random: () => number): number {
  const mean = min + pressure * (max - min);
  const low = Math.floor(mean);
  return Math.min(max, random() < mean - low ? low + 1 : low);
}

/** Cells for each blocker: the main one takes all, 60% of two, or half of three; the rest share what is left. */
function shareCells(total: number, kinds: number): number[] {
  if (kinds <= 1) return [total];
  const main = Math.max(1, Math.round(total * (kinds === 2 ? 0.6 : 0.5)));
  const shares = [main];
  let left = Math.max(kinds - 1, total - main);
  for (let index = 1; index < kinds; index += 1) {
    const share = Math.max(1, Math.round(left / (kinds - index)));
    shares.push(share);
    left -= share;
  }
  return shares;
}

/** The layout a blocker follows: the main blocker takes the recipe pattern, the others scatter. Mixed gives each its own. */
function cellPattern(pattern: BoardPattern, blocker: Blocker, index: number): BoardPattern {
  if (pattern === "mixed") return blocker === "pane" ? "lowerRows" : blocker === "lock" ? "columns" : "centre";
  return index === 0 ? pattern : "scattered";
}

interface Position {
  row: number;
  col: number;
}

/** All cells in the order a pattern fills them. Cells with the same rank come in seeded random order. */
function orderCells(pattern: BoardPattern, random: () => number): Position[] {
  const rank = rankFor(pattern, random);
  const cells: { position: Position; rank: number[]; tie: number }[] = [];
  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let col = 0; col < GRID_SIZE; col += 1) cells.push({ position: { row, col }, rank: rank(row, col), tie: random() });
  }
  cells.sort((left, right) => compareRanks(left.rank, right.rank) || left.tie - right.tie);
  return cells.map((cell) => cell.position);
}

function rankFor(pattern: BoardPattern, random: () => number): (row: number, col: number) => number[] {
  const last = GRID_SIZE - 1;
  const centre = last / 2;
  switch (pattern) {
    case "scattered":
    case "mixed":
      return () => [0];
    case "lowerRows":
      return (row) => [last - row];
    case "columns": {
      const pairs = [[1, 5], [2, 4], [0, 6], [1, 4], [2, 5]];
      const pair = pairs[Math.min(pairs.length - 1, Math.floor(random() * pairs.length))];
      // The pair grows from the bottom together, then the columns nearest the middle.
      return (row, col) => [pair.includes(col) ? 0 : 1, pair.includes(col) ? 0 : Math.abs(col - centre), last - row];
    }
    case "corners":
      return (row, col) => [Math.min(row, last - row) + Math.min(col, last - col)];
    case "ring":
      // The ring one in from the edge, then the edge.
      return (row, col) => {
        const depth = Math.min(row, col, last - row, last - col);
        return [depth === 1 ? 0 : depth === 0 ? 1 : 2];
      };
    case "centre":
      return (row, col) => [Math.abs(row - centre) + Math.abs(col - centre)];
    case "dividerRow":
      return (row) => [Math.abs(row - dividerRow)];
    case "diagonals":
      return (row, col) => [Math.min(Math.abs(row - col), Math.abs(row + col - last), 2)];
  }
}

function compareRanks(left: number[], right: number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function plainCell(): CellDefinition {
  return { tile: null, powerUp: null, overlay: null, underlay: null, generator: null, locked: false };
}

function honeypotCell(): CellDefinition {
  return { tile: null, powerUp: null, overlay: null, underlay: null, generator: "honeypot", locked: true };
}

function key(row: number, col: number): string {
  return `${row},${col}`;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
