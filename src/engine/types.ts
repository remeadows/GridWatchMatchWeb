export interface GridPosition {
  row: number;
  col: number;
}

export type Orientation = "horizontal" | "vertical";
export type TileType = "packet" | "firewall" | "key" | "threat" | "zeroDay";

export type PowerUpType =
  | { kind: "rocket"; orientation: Orientation }
  | { kind: "propeller" }
  | { kind: "tnt" }
  | { kind: "lightBall" };

export type OverlayType = { kind: "encryptedVolume"; hp: number };
export type UnderlayType = { kind: "malwarePropagation"; hp: number };
export type GeneratorType = "honeypot";
export type BoosterType = "rocket" | "rocketVertical" | "tnt" | "propeller" | "lightBall";

export interface CellState {
  baseTile: TileType | null;
  powerUp: PowerUpType | null;
  overlay: OverlayType | null;
  underlay: UnderlayType | null;
  generator: GeneratorType | null;
  isMovable: boolean;
  debugTileId: number | null;
  debugDesignLocked: boolean;
}

export interface ObjectiveDefinition {
  id: string;
  target: number;
  displayName: string;
  tileType: TileType | null;
}

export interface CellDefinition {
  tile: TileType | null;
  powerUp: string | null;
  overlay: string | null;
  underlay: string | null;
  generator: GeneratorType | null;
  locked: boolean;
}

export interface LevelDefinition {
  id: number;
  name: string;
  gridRows: number;
  gridCols: number;
  moveLimit: number;
  objectives: ObjectiveDefinition[];
  cellMap: CellDefinition[][];
  spawnWeights: Partial<Record<TileType, number>>;
  bossLevel: boolean;
  bonusLevel: boolean;
  bossTimerSeconds?: number | null;
}

export type BoardAction =
  | { kind: "swap"; from: GridPosition; to: GridPosition }
  | { kind: "tap"; at: GridPosition }
  | { kind: "activateBooster"; booster: BoosterType; at: GridPosition };

export interface ClearEvent {
  position: GridPosition;
  tileType: TileType;
  clearedByPowerUp: boolean;
  contributedToObjective: boolean;
  objectiveId: string | null;
}

export interface MoveEvent {
  from: GridPosition;
  to: GridPosition;
  tileType: TileType;
}

export interface SpawnEvent {
  position: GridPosition;
  tileType: TileType;
  asPowerUp: PowerUpType | null;
}

export type PowerUpTrigger =
  | { kind: "tap" }
  | { kind: "swap" }
  | { kind: "combo"; with: PowerUpType };

export interface PowerUpEvent {
  powerUpType: PowerUpType;
  origin: GridPosition;
  affectedPositions: GridPosition[];
  trigger: PowerUpTrigger;
}

export interface ObjectiveEvent {
  objectiveId: string;
  progressDelta: number;
}

export interface BoardDelta {
  clears: ClearEvent[];
  moves: MoveEvent[];
  spawns: SpawnEvent[];
  powerUpEvents: PowerUpEvent[];
  objectiveEvents: ObjectiveEvent[];
  chainDepth: number;
  scoreGained: number;
  isWin: boolean;
  isFail: boolean;
  shuffleAttempts: number;
}

export interface BoardSnapshot {
  grid: import("./grid").Grid2D<CellState>;
  moveCount: number;
  moveLimit: number;
  objectiveProgress: Record<string, number>;
  objectiveTargets: Record<string, number>;
  spawnWeights: Record<TileType, number>;
  rngSeed: string;
  chainDepth: number;
}

export class BoardEngineError extends Error {
  readonly code:
    | "invalidSwap"
    | "invalidTap"
    | "noMovesAvailable"
    | "levelLoadFailure"
    | "rngInitFailure";

  constructor(code: BoardEngineError["code"], message: string) {
    super(message);
    this.name = "BoardEngineError";
    this.code = code;
  }
}

export function positionKey(position: GridPosition): string {
  return `${position.row},${position.col}`;
}

export function comparePositions(left: GridPosition, right: GridPosition): number {
  if (left.row !== right.row) return left.row - right.row;
  return left.col - right.col;
}

export function samePosition(left: GridPosition, right: GridPosition): boolean {
  return left.row === right.row && left.col === right.col;
}

export function emptyCell(): CellState {
  return {
    baseTile: null,
    powerUp: null,
    overlay: null,
    underlay: null,
    generator: null,
    isMovable: true,
    debugTileId: null,
    debugDesignLocked: false
  };
}

export function clonePowerUp(powerUp: PowerUpType | null): PowerUpType | null {
  if (!powerUp) return null;
  if (powerUp.kind === "rocket") return { kind: "rocket", orientation: powerUp.orientation };
  return { kind: powerUp.kind } as PowerUpType;
}

export function cloneCell(cell: CellState): CellState {
  return {
    baseTile: cell.baseTile,
    powerUp: clonePowerUp(cell.powerUp),
    overlay: cell.overlay ? { ...cell.overlay } : null,
    underlay: cell.underlay ? { ...cell.underlay } : null,
    generator: cell.generator,
    isMovable: cell.isMovable,
    debugTileId: cell.debugTileId,
    debugDesignLocked: cell.debugDesignLocked
  };
}

export function hasOccupant(cell: CellState): boolean {
  return cell.baseTile !== null || cell.powerUp !== null;
}

export function setBaseTile(cell: CellState, tile: TileType | null): void {
  cell.baseTile = tile;
  if (tile !== null) {
    cell.powerUp = null;
  } else if (cell.powerUp === null) {
    cell.debugTileId = null;
    cell.debugDesignLocked = false;
  }
}

export function setPowerUp(cell: CellState, powerUp: PowerUpType | null): void {
  cell.powerUp = clonePowerUp(powerUp);
  if (powerUp !== null) {
    cell.baseTile = null;
  } else if (cell.baseTile === null) {
    cell.debugTileId = null;
    cell.debugDesignLocked = false;
  }
}

export function powerUpKey(powerUp: PowerUpType): string {
  if (powerUp.kind === "rocket") return `rocket_${powerUp.orientation}`;
  return powerUp.kind;
}

export function parsePowerUp(raw: string | null | undefined): PowerUpType | null {
  switch (raw) {
    case null:
    case undefined:
      return null;
    case "rocket_h":
      return { kind: "rocket", orientation: "horizontal" };
    case "rocket_v":
      return { kind: "rocket", orientation: "vertical" };
    case "propeller":
      return { kind: "propeller" };
    case "tnt":
      return { kind: "tnt" };
    case "lightBall":
      return { kind: "lightBall" };
    default:
      throw new BoardEngineError("levelLoadFailure", `Unknown powerUp descriptor: ${raw}`);
  }
}

export function serializePowerUp(powerUp: PowerUpType | null): string | null {
  if (!powerUp) return null;
  if (powerUp.kind === "rocket") return powerUp.orientation === "horizontal" ? "rocket_h" : "rocket_v";
  return powerUp.kind;
}
