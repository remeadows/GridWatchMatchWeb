import { Grid2D } from "./grid";
import type { SeededRNG } from "./rng";
import {
  clonePowerUp,
  comparePositions,
  hasOccupant,
  positionKey,
  powerUpKey,
  type CellState,
  type GridPosition,
  type ObjectiveDefinition,
  type Orientation,
  type PowerUpEvent,
  type PowerUpTrigger,
  type PowerUpType,
  type TileType
} from "./types";

export interface PowerUpResolution {
  clears: Set<string>;
  powerUpEvents: PowerUpEvent[];
  clearSources: Map<string, PowerUpType>;
}

type PowerUpKind = "rocket" | "propeller" | "tnt" | "lightBall";

const kindOrder: Record<PowerUpKind, number> = {
  rocket: 0,
  propeller: 1,
  tnt: 2,
  lightBall: 3
};

export function emptyPowerUpResolution(): PowerUpResolution {
  return {
    clears: new Set<string>(),
    powerUpEvents: [],
    clearSources: new Map<string, PowerUpType>()
  };
}

export function mergePowerUpResolution(target: PowerUpResolution, source: PowerUpResolution): void {
  for (const key of source.clears) target.clears.add(key);
  target.powerUpEvents.push(...source.powerUpEvents);
  for (const [key, powerUp] of source.clearSources) {
    if (!target.clearSources.has(key)) target.clearSources.set(key, clonePowerUp(powerUp)!);
  }
}

export function triggerSinglePowerUp(
  powerUp: PowerUpType,
  origin: GridPosition,
  grid: Grid2D<CellState>,
  objectives: ObjectiveDefinition[],
  objectiveProgress: Record<string, number>,
  rng: SeededRNG,
  trigger: PowerUpTrigger
): PowerUpResolution {
  const resolution = emptyPowerUpResolution();
  const source = clonePowerUp(powerUp)!;

  switch (powerUp.kind) {
    case "rocket": {
      const affected = rocketPath(origin, powerUp.orientation, grid);
      addAffectedPositions(resolution, affected, source);
      resolution.powerUpEvents.push({
        powerUpType: source,
        origin,
        affectedPositions: sortedUnique(affected),
        trigger
      });
      break;
    }
    case "propeller": {
      const affected = choosePropellerTargets(1, origin, grid, objectives, objectiveProgress, rng);
      addAffectedPositions(resolution, affected, source);
      resolution.powerUpEvents.push({
        powerUpType: source,
        origin,
        affectedPositions: sortedUnique(affected),
        trigger
      });
      break;
    }
    case "tnt": {
      const affected = blastArea(origin, 1, grid);
      addAffectedPositions(resolution, affected, source);
      resolution.powerUpEvents.push({
        powerUpType: source,
        origin,
        affectedPositions: sortedUnique(affected),
        trigger
      });
      break;
    }
    case "lightBall": {
      const color = mostCommonTileType(grid);
      const affected = positionsOf(color, grid);
      addAffectedPositions(resolution, affected, source);
      resolution.powerUpEvents.push({
        powerUpType: source,
        origin,
        affectedPositions: sortedUnique(affected),
        trigger
      });
      break;
    }
  }

  const originKey = positionKey(origin);
  resolution.clears.add(originKey);
  if (!resolution.clearSources.has(originKey)) resolution.clearSources.set(originKey, source);
  return resolution;
}

export function triggerPowerUpCombo(
  left: PowerUpType,
  right: PowerUpType,
  leftOrigin: GridPosition,
  rightOrigin: GridPosition,
  grid: Grid2D<CellState>,
  objectives: ObjectiveDefinition[],
  objectiveProgress: Record<string, number>,
  rng: SeededRNG
): PowerUpResolution {
  const resolution = emptyPowerUpResolution();
  const ordered = [
    { powerUp: left, origin: leftOrigin },
    { powerUp: right, origin: rightOrigin }
  ].sort((lhs, rhs) => {
    const kindCompare = kindOrder[lhs.powerUp.kind] - kindOrder[rhs.powerUp.kind];
    if (kindCompare !== 0) return kindCompare;
    return comparePositions(lhs.origin, rhs.origin);
  });

  const aType = ordered[0].powerUp;
  const aOrigin = ordered[0].origin;
  const bType = ordered[1].powerUp;
  const bOrigin = ordered[1].origin;

  if (aType.kind === "rocket" && bType.kind === "rocket") {
    const rowClear = rocketPath(aOrigin, "horizontal", grid);
    const colClear = rocketPath(aOrigin, "vertical", grid);
    addAffectedPositions(resolution, [...rowClear, ...colClear], { kind: "rocket", orientation: "horizontal" });
    resolution.powerUpEvents.push({
      powerUpType: { kind: "rocket", orientation: "horizontal" },
      origin: aOrigin,
      affectedPositions: sortedUnique(rowClear),
      trigger: { kind: "combo", with: clonePowerUp(bType)! }
    });
    resolution.powerUpEvents.push({
      powerUpType: { kind: "rocket", orientation: "vertical" },
      origin: aOrigin,
      affectedPositions: sortedUnique(colClear),
      trigger: { kind: "combo", with: clonePowerUp(aType)! }
    });
  } else if (aType.kind === "rocket" && bType.kind === "propeller") {
    const orientation = aType.orientation;
    const targets = choosePropellerTargets(3, bOrigin, grid, objectives, objectiveProgress, rng);
    const affected: GridPosition[] = [];
    for (const target of targets) {
      const path = rocketPath(target, orientation, grid);
      affected.push(...path);
      resolution.powerUpEvents.push({
        powerUpType: { kind: "rocket", orientation },
        origin: target,
        affectedPositions: sortedUnique(path),
        trigger: { kind: "combo", with: clonePowerUp(bType)! }
      });
    }
    addAffectedPositions(resolution, affected, { kind: "rocket", orientation });
    resolution.powerUpEvents.unshift({
      powerUpType: { kind: "propeller" },
      origin: bOrigin,
      affectedPositions: sortedUnique(targets),
      trigger: { kind: "combo", with: clonePowerUp(aType)! }
    });
  } else if (aType.kind === "rocket" && bType.kind === "tnt") {
    const endpoints = rocketEndpoints(aOrigin, aType.orientation, grid);
    const affected = endpoints.flatMap((endpoint) => blastArea(endpoint, 1, grid));
    addAffectedPositions(resolution, affected, { kind: "tnt" });
    resolution.powerUpEvents.push({
      powerUpType: { kind: "tnt" },
      origin: aOrigin,
      affectedPositions: sortedUnique(affected),
      trigger: { kind: "combo", with: clonePowerUp(bType)! }
    });
  } else if (aType.kind === "rocket" && bType.kind === "lightBall") {
    const color = mostCommonTileType(grid);
    const colorPositions = positionsOf(color, grid);
    const affected: GridPosition[] = [];
    for (const position of colorPositions) {
      const path = rocketPath(position, aType.orientation, grid);
      affected.push(...path);
      resolution.powerUpEvents.push({
        powerUpType: { kind: "rocket", orientation: aType.orientation },
        origin: position,
        affectedPositions: sortedUnique(path),
        trigger: { kind: "combo", with: clonePowerUp(bType)! }
      });
    }
    addAffectedPositions(resolution, affected, { kind: "rocket", orientation: aType.orientation });
  } else if (aType.kind === "propeller" && bType.kind === "propeller") {
    const targets = choosePropellerTargets(2, aOrigin, grid, objectives, objectiveProgress, rng);
    addAffectedPositions(resolution, targets, { kind: "propeller" });
    resolution.powerUpEvents.push({
      powerUpType: { kind: "propeller" },
      origin: aOrigin,
      affectedPositions: sortedUnique(targets),
      trigger: { kind: "combo", with: clonePowerUp(bType)! }
    });
  } else if (aType.kind === "propeller" && bType.kind === "tnt") {
    const targets = choosePropellerTargets(3, aOrigin, grid, objectives, objectiveProgress, rng);
    const affected = targets.flatMap((target) => blastArea(target, 1, grid));
    addAffectedPositions(resolution, affected, { kind: "tnt" });
    resolution.powerUpEvents.push({
      powerUpType: { kind: "tnt" },
      origin: bOrigin,
      affectedPositions: sortedUnique(affected),
      trigger: { kind: "combo", with: clonePowerUp(aType)! }
    });
  } else if (aType.kind === "propeller" && bType.kind === "lightBall") {
    const color = mostCommonTileType(grid);
    const affected: GridPosition[] = [];
    for (const position of positionsOf(color, grid)) {
      const target = choosePropellerTargets(1, position, grid, objectives, objectiveProgress, rng);
      affected.push(...target);
      resolution.powerUpEvents.push({
        powerUpType: { kind: "propeller" },
        origin: position,
        affectedPositions: sortedUnique(target),
        trigger: { kind: "combo", with: clonePowerUp(bType)! }
      });
    }
    addAffectedPositions(resolution, affected, { kind: "propeller" });
  } else if (aType.kind === "tnt" && bType.kind === "tnt") {
    const center = {
      row: Math.trunc((aOrigin.row + bOrigin.row) / 2),
      col: Math.trunc((aOrigin.col + bOrigin.col) / 2)
    };
    const affected = blastArea(center, 2, grid);
    addAffectedPositions(resolution, affected, { kind: "tnt" });
    resolution.powerUpEvents.push({
      powerUpType: { kind: "tnt" },
      origin: center,
      affectedPositions: sortedUnique(affected),
      trigger: { kind: "combo", with: clonePowerUp(bType)! }
    });
  } else if (aType.kind === "tnt" && bType.kind === "lightBall") {
    const color = mostCommonTileType(grid);
    const affected: GridPosition[] = [];
    for (const position of positionsOf(color, grid)) {
      const blast = blastArea(position, 1, grid);
      affected.push(...blast);
      resolution.powerUpEvents.push({
        powerUpType: { kind: "tnt" },
        origin: position,
        affectedPositions: sortedUnique(blast),
        trigger: { kind: "combo", with: clonePowerUp(bType)! }
      });
    }
    addAffectedPositions(resolution, affected, { kind: "tnt" });
  } else if (aType.kind === "lightBall" && bType.kind === "lightBall") {
    const affected = grid.allPositions.filter((position) => {
      const cell = grid.get(position);
      return cell.generator === null && (hasOccupant(cell) || cell.overlay !== null || cell.underlay !== null);
    });
    addAffectedPositions(resolution, affected, { kind: "lightBall" });
    resolution.powerUpEvents.push({
      powerUpType: { kind: "lightBall" },
      origin: aOrigin,
      affectedPositions: sortedUnique(affected),
      trigger: { kind: "combo", with: clonePowerUp(bType)! }
    });
  }

  const leftKey = positionKey(leftOrigin);
  const rightKey = positionKey(rightOrigin);
  resolution.clears.add(leftKey);
  resolution.clears.add(rightKey);
  resolution.clearSources.set(leftKey, clonePowerUp(left)!);
  resolution.clearSources.set(rightKey, clonePowerUp(right)!);
  return resolution;
}

export function choosePropellerTargets(
  count: number,
  origin: GridPosition,
  grid: Grid2D<CellState>,
  objectives: ObjectiveDefinition[],
  objectiveProgress: Record<string, number>,
  rng: SeededRNG
): GridPosition[] {
  const candidates: { position: GridPosition; score: number }[] = [];
  for (const position of grid.allPositions) {
    const cell = grid.get(position);
    if (!hasOccupant(cell) && cell.overlay === null && cell.underlay === null) continue;
    const objectiveWeight = weightForObjectivePriority(position, cell, objectives, objectiveProgress, grid.rows - 1);
    const tileWeight = cell.powerUp ? 1.2 : cell.baseTile ? 1.0 : 0.8;
    const distance = Math.abs(origin.row - position.row) + Math.abs(origin.col - position.col);
    candidates.push({ position, score: objectiveWeight * tileWeight - distance * 0.01 });
  }

  const results: GridPosition[] = [];
  const mutable = [...candidates];
  for (let index = 0; index < count; index += 1) {
    if (mutable.length === 0) break;
    mutable.sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      return comparePositions(left.position, right.position);
    });
    const pick = mutable.length > 1 && rng.nextDouble() < 0.15 ? 1 : 0;
    const [selected] = mutable.splice(pick, 1);
    results.push(selected.position);
  }
  return results;
}

function addAffectedPositions(resolution: PowerUpResolution, positions: GridPosition[], source: PowerUpType): void {
  for (const position of positions) {
    const key = positionKey(position);
    resolution.clears.add(key);
    if (!resolution.clearSources.has(key)) resolution.clearSources.set(key, clonePowerUp(source)!);
  }
}

function rocketPath(origin: GridPosition, orientation: Orientation, grid: Grid2D<CellState>): GridPosition[] {
  if (orientation === "horizontal") {
    return Array.from({ length: grid.cols }, (_, col) => ({ row: origin.row, col })).filter((position) => grid.get(position).generator === null);
  }
  return Array.from({ length: grid.rows }, (_, row) => ({ row, col: origin.col })).filter((position) => grid.get(position).generator === null);
}

function rocketEndpoints(origin: GridPosition, orientation: Orientation, grid: Grid2D<CellState>): GridPosition[] {
  return orientation === "horizontal"
    ? [
        { row: origin.row, col: 0 },
        { row: origin.row, col: grid.cols - 1 }
      ]
    : [
        { row: 0, col: origin.col },
        { row: grid.rows - 1, col: origin.col }
      ];
}

function blastArea(center: GridPosition, radius: number, grid: Grid2D<CellState>): GridPosition[] {
  const affected: GridPosition[] = [];
  for (let row = center.row - radius; row <= center.row + radius; row += 1) {
    for (let col = center.col - radius; col <= center.col + radius; col += 1) {
      const position = { row, col };
      if (grid.isValid(position) && grid.get(position).generator === null) affected.push(position);
    }
  }
  return affected;
}

function positionsOf(tileType: TileType, grid: Grid2D<CellState>): GridPosition[] {
  return grid.positionsWhere((cell) => cell.baseTile === tileType);
}

function mostCommonTileType(grid: Grid2D<CellState>): TileType {
  const counts: Partial<Record<TileType, number>> = {};
  for (const position of grid.allPositions) {
    const tile = grid.get(position).baseTile;
    if (tile) counts[tile] = (counts[tile] ?? 0) + 1;
  }
  const sorted = Object.entries(counts).sort(([leftTile, leftCount], [rightTile, rightCount]) => {
    if (leftCount !== rightCount) return Number(rightCount) - Number(leftCount);
    return leftTile.localeCompare(rightTile);
  });
  return (sorted[0]?.[0] as TileType | undefined) ?? "packet";
}

function weightForObjectivePriority(
  position: GridPosition,
  cell: CellState,
  objectives: ObjectiveDefinition[],
  objectiveProgress: Record<string, number>,
  bottomRow: number
): number {
  let weight = 1.0;
  for (const objective of objectives) {
    if ((objectiveProgress[objective.id] ?? 0) >= objective.target) continue;
    if ((objective.id === "collect" || objective.id.startsWith("collect_")) && objective.tileType && cell.baseTile === objective.tileType) {
      weight += 3.0;
    } else if (objective.id === "clear") {
      weight += 1.5;
    } else if (objective.id === "spread" && cell.underlay !== null) {
      weight += 2.5;
    } else if (objective.id === "guide" && position.row === bottomRow) {
      weight += 2.0;
    } else if (objective.id === "multi") {
      weight += 1.0;
    } else {
      weight += 0.5;
    }
  }
  if (cell.overlay) weight += 1.0;
  if (cell.underlay) weight += 1.0;
  return weight;
}

function sortedUnique(positions: GridPosition[]): GridPosition[] {
  const unique = new Map<string, GridPosition>();
  for (const position of positions) unique.set(positionKey(position), position);
  return [...unique.values()].sort(comparePositions);
}

export function powerUpSortKey(powerUp: PowerUpType): number {
  return kindOrder[powerUp.kind];
}

export function debugPowerUpName(powerUp: PowerUpType): string {
  return powerUpKey(powerUp);
}

