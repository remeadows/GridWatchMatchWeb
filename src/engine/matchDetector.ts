import { Grid2D } from "./grid";
import {
  comparePositions,
  type CellState,
  type GridPosition,
  type Orientation,
  type TileType
} from "./types";

export interface LineRun {
  tileType: TileType;
  orientation: Orientation;
  positions: GridPosition[];
}

export type MatchShape =
  | { kind: "regular" }
  | { kind: "line"; length: number; orientation: Orientation }
  | { kind: "square2x2" }
  | { kind: "lOrT" };

export interface MatchGroup {
  tileType: TileType;
  positions: Set<string>;
  runs: LineRun[];
  hasSquare: boolean;
  shape: MatchShape;
}

interface MutableMatchGroup {
  tileType: TileType;
  positions: Set<string>;
  runs: LineRun[];
  hasSquare: boolean;
}

export function detectMatches(grid: Grid2D<CellState>): MatchGroup[] {
  const runs = detectLineRuns(grid);
  const squares = detectSquares(grid);
  const rawGroups: MutableMatchGroup[] = [];

  for (const run of runs) {
    rawGroups.push({
      tileType: run.tileType,
      positions: new Set(run.positions.map(positionKeyLocal)),
      runs: [run],
      hasSquare: false
    });
  }

  for (const square of squares) {
    rawGroups.push({
      tileType: square.tileType,
      positions: new Set(square.positions.map(positionKeyLocal)),
      runs: [],
      hasSquare: true
    });
  }

  const merged: MutableMatchGroup[] = [];
  for (const raw of rawGroups) {
    const overlapping: number[] = [];
    for (let index = 0; index < merged.length; index += 1) {
      const sameTile = merged[index].tileType === raw.tileType;
      const overlaps = [...raw.positions].some((position) => merged[index].positions.has(position));
      if (sameTile && overlaps) overlapping.push(index);
    }
    if (overlapping.length === 0) {
      merged.push(raw);
      continue;
    }
    const first = overlapping[0];
    mergeInto(merged[first], raw);
    for (const index of overlapping.slice(1).sort((a, b) => b - a)) {
      const removed = merged.splice(index, 1)[0];
      mergeInto(merged[first], removed);
    }
  }

  return merged
    .filter((group) => group.positions.size >= 3)
    .map((group) => ({ ...group, shape: shapeFor(group) }))
    .sort((left, right) => {
      const lp = sortedPositions(left.positions)[0] ?? { row: 0, col: 0 };
      const rp = sortedPositions(right.positions)[0] ?? { row: 0, col: 0 };
      const positionCompare = comparePositions(lp, rp);
      if (positionCompare !== 0) return positionCompare;
      return left.tileType.localeCompare(right.tileType);
    });
}

export function matchedPositions(grid: Grid2D<CellState>): Set<string> {
  const result = new Set<string>();
  for (const group of detectMatches(grid)) {
    for (const position of group.positions) result.add(position);
  }
  return result;
}

export function sortedPositions(keys: Iterable<string>): GridPosition[] {
  return [...keys].map(parsePositionKey).sort(comparePositions);
}

function detectLineRuns(grid: Grid2D<CellState>): LineRun[] {
  const runs: LineRun[] = [];
  for (let row = 0; row < grid.rows; row += 1) {
    let col = 0;
    while (col < grid.cols) {
      const tile = matchableTile({ row, col }, grid);
      if (!tile) {
        col += 1;
        continue;
      }
      let end = col + 1;
      while (end < grid.cols && matchableTile({ row, col: end }, grid) === tile) end += 1;
      if (end - col >= 3) {
        runs.push({
          tileType: tile,
          orientation: "horizontal",
          positions: range(col, end).map((value) => ({ row, col: value }))
        });
      }
      col = end;
    }
  }

  for (let col = 0; col < grid.cols; col += 1) {
    let row = 0;
    while (row < grid.rows) {
      const tile = matchableTile({ row, col }, grid);
      if (!tile) {
        row += 1;
        continue;
      }
      let end = row + 1;
      while (end < grid.rows && matchableTile({ row: end, col }, grid) === tile) end += 1;
      if (end - row >= 3) {
        runs.push({
          tileType: tile,
          orientation: "vertical",
          positions: range(row, end).map((value) => ({ row: value, col }))
        });
      }
      row = end;
    }
  }
  return runs;
}

function detectSquares(grid: Grid2D<CellState>): { tileType: TileType; positions: GridPosition[] }[] {
  const squares: { tileType: TileType; positions: GridPosition[] }[] = [];
  for (let row = 0; row < grid.rows - 1; row += 1) {
    for (let col = 0; col < grid.cols - 1; col += 1) {
      const positions = [
        { row, col },
        { row, col: col + 1 },
        { row: row + 1, col },
        { row: row + 1, col: col + 1 }
      ];
      const tile = matchableTile(positions[0], grid);
      if (tile && positions.every((position) => matchableTile(position, grid) === tile)) {
        squares.push({ tileType: tile, positions });
      }
    }
  }
  return squares;
}

function matchableTile(position: GridPosition, grid: Grid2D<CellState>): TileType | null {
  return grid.get(position).baseTile;
}

function shapeFor(group: MutableMatchGroup): MatchShape {
  const fiveRun = [...group.runs].filter((run) => run.positions.length >= 5).sort((a, b) => b.positions.length - a.positions.length)[0];
  if (fiveRun) return { kind: "line", length: fiveRun.positions.length, orientation: fiveRun.orientation };
  if (isLOrT(group)) return { kind: "lOrT" };
  if (group.hasSquare) return { kind: "square2x2" };
  const fourRun = group.runs.find((run) => run.positions.length === 4);
  if (fourRun) return { kind: "line", length: 4, orientation: fourRun.orientation };
  return { kind: "regular" };
}

function isLOrT(group: MutableMatchGroup): boolean {
  const horizontal = group.runs.filter((run) => run.orientation === "horizontal" && run.positions.length >= 3);
  const vertical = group.runs.filter((run) => run.orientation === "vertical" && run.positions.length >= 3);
  if (horizontal.length === 0 || vertical.length === 0 || group.positions.size < 5) return false;
  for (const h of horizontal) {
    const hSet = new Set(h.positions.map(positionKeyLocal));
    for (const v of vertical) {
      if (v.positions.some((position) => hSet.has(positionKeyLocal(position)))) return true;
    }
  }
  return false;
}

function mergeInto(target: MutableMatchGroup, source: MutableMatchGroup): void {
  for (const position of source.positions) target.positions.add(position);
  target.runs.push(...source.runs);
  target.hasSquare = target.hasSquare || source.hasSquare;
}

function positionKeyLocal(position: GridPosition): string {
  return `${position.row},${position.col}`;
}

function parsePositionKey(key: string): GridPosition {
  const [row, col] = key.split(",").map(Number);
  return { row, col };
}

function range(start: number, endExclusive: number): number[] {
  return Array.from({ length: endExclusive - start }, (_, index) => start + index);
}

