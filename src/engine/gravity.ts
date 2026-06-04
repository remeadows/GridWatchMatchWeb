import { Grid2D } from "./grid";
import type { SeededRNG } from "./rng";
import type { SpawnRule } from "./spawn";
import {
  clonePowerUp,
  hasOccupant,
  setBaseTile,
  setPowerUp,
  type CellState,
  type GridPosition,
  type MoveEvent,
  type PowerUpType,
  type SpawnEvent,
  type TileType
} from "./types";

interface FallingOccupant {
  source: GridPosition;
  baseTile: TileType | null;
  powerUp: PowerUpType | null;
  debugTileId: number | null;
  debugDesignLocked: boolean;
}

export interface GravityResult {
  moves: MoveEvent[];
  spawns: SpawnEvent[];
  afterGravityGrid: Grid2D<CellState>;
}

export function applyGravity(
  grid: Grid2D<CellState>,
  spawnRule: SpawnRule,
  rng: SeededRNG,
  nextDebugTileId: { value: number }
): GravityResult {
  const moves: MoveEvent[] = [];
  const spawns: SpawnEvent[] = [];
  const spawnTargets: GridPosition[] = [];

  for (let col = 0; col < grid.cols; col += 1) {
    let row = grid.rows - 1;
    while (row >= 0) {
      while (row >= 0 && !isGravityCell(grid.get({ row, col }))) row -= 1;
      if (row < 0) break;
      const segmentEnd = row;
      while (row >= 0 && isGravityCell(grid.get({ row, col }))) row -= 1;
      const segmentStart = row + 1;
      const segment = resolveSegment(grid, col, segmentStart, segmentEnd);
      moves.push(...segment.moves);
      spawnTargets.push(...segment.spawnTargets);
    }
  }

  const afterGravityGrid = grid.clone((cell) => ({ ...cell, powerUp: clonePowerUp(cell.powerUp), overlay: cell.overlay ? { ...cell.overlay } : null, underlay: cell.underlay ? { ...cell.underlay } : null }));

  for (const position of spawnTargets) {
    const cell = grid.get(position);
    const tile = spawnRule.draw(rng);
    setBaseTile(cell, tile);
    cell.debugTileId = nextDebugTileId.value;
    nextDebugTileId.value += 1;
    cell.debugDesignLocked = false;
    grid.set(position, cell);
    spawns.push({ position, tileType: tile, asPowerUp: null });
  }

  for (const position of grid.allPositions) {
    const cell = grid.get(position);
    if (cell.generator !== "honeypot") continue;
    const target = { row: position.row + 1, col: position.col };
    if (!grid.isValid(target)) continue;
    const targetCell = grid.get(target);
    if (targetCell.generator === null && targetCell.isMovable && !hasOccupant(targetCell)) {
      const tile = spawnRule.draw(rng);
      setBaseTile(targetCell, tile);
      targetCell.debugTileId = nextDebugTileId.value;
      nextDebugTileId.value += 1;
      targetCell.debugDesignLocked = false;
      grid.set(target, targetCell);
      spawns.push({ position: target, tileType: tile, asPowerUp: null });
    }
  }

  return { moves, spawns, afterGravityGrid };
}

function resolveSegment(
  grid: Grid2D<CellState>,
  col: number,
  startRow: number,
  endRow: number
): { moves: MoveEvent[]; spawnTargets: GridPosition[] } {
  const moves: MoveEvent[] = [];
  const occupants: FallingOccupant[] = [];
  for (let row = endRow; row >= startRow; row -= 1) {
    const source = { row, col };
    const cell = grid.get(source);
    if (hasOccupant(cell)) {
      occupants.push({
        source,
        baseTile: cell.baseTile,
        powerUp: clonePowerUp(cell.powerUp),
        debugTileId: cell.debugTileId,
        debugDesignLocked: cell.debugDesignLocked
      });
    }
  }

  const segmentLength = endRow - startRow + 1;
  const emptyCount = segmentLength - occupants.length;
  const spawnTargets: GridPosition[] = [];

  for (let offset = 0; offset < segmentLength; offset += 1) {
    const target = { row: endRow - offset, col };
    const targetCell = grid.get(target);
    if (offset < occupants.length) {
      const occupant = occupants[offset];
      setBaseTile(targetCell, occupant.baseTile);
      if (occupant.powerUp) setPowerUp(targetCell, occupant.powerUp);
      targetCell.debugTileId = occupant.debugTileId;
      targetCell.debugDesignLocked = occupant.debugDesignLocked;
      grid.set(target, targetCell);
      if ((occupant.source.row !== target.row || occupant.source.col !== target.col) && occupant.baseTile) {
        moves.push({ from: occupant.source, to: target, tileType: occupant.baseTile });
      }
    } else {
      setBaseTile(targetCell, null);
      setPowerUp(targetCell, null);
      targetCell.debugTileId = null;
      targetCell.debugDesignLocked = false;
      grid.set(target, targetCell);
    }
  }

  if (emptyCount > 0) {
    for (let row = startRow; row < startRow + emptyCount; row += 1) {
      spawnTargets.push({ row, col });
    }
  }
  return { moves, spawnTargets };
}

function isGravityCell(cell: CellState): boolean {
  return cell.isMovable && cell.generator === null;
}

