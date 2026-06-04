import { applyGravity } from "./gravity";
import { Grid2D } from "./grid";
import { detectMatches, sortedPositions, type MatchGroup } from "./matchDetector";
import {
  emptyPowerUpResolution,
  mergePowerUpResolution,
  triggerPowerUpCombo,
  triggerSinglePowerUp,
  type PowerUpResolution
} from "./powerUps";
import { SeededRNG } from "./rng";
import { SpawnRule } from "./spawn";
import {
  BoardEngineError,
  cloneCell,
  clonePowerUp,
  comparePositions,
  emptyCell,
  hasOccupant,
  parsePowerUp,
  positionKey,
  setBaseTile,
  setPowerUp,
  type BoardAction,
  type BoardDelta,
  type BoardSnapshot,
  type BoosterType,
  type CellDefinition,
  type CellState,
  type ClearEvent,
  type GridPosition,
  type LevelDefinition,
  type ObjectiveDefinition,
  type ObjectiveEvent,
  type PowerUpType,
  type SpawnEvent,
  type TileType
} from "./types";

interface ResolutionAccumulator {
  clears: ClearEvent[];
  moves: BoardDelta["moves"];
  spawns: SpawnEvent[];
  powerUpEvents: BoardDelta["powerUpEvents"];
  objectiveDeltas: Record<string, number>;
  chainDepth: number;
  scoreGained: number;
}

interface PowerUpCreation {
  position: GridPosition;
  powerUp: PowerUpType;
  tileType: TileType;
}

export class BoardEngine {
  private readonly level: LevelDefinition;
  private grid: Grid2D<CellState>;
  private moveCountValue = 0;
  private objectiveProgressValue: Record<string, number> = {};
  private readonly objectiveTargetsValue: Record<string, number> = {};
  private readonly spawnRule: SpawnRule;
  private rng: SeededRNG;
  private nextDebugTileId = 1;
  private chainDepthValue = 0;
  private actionHistory: BoardAction[] = [];
  private moveLimitBonus = 0;

  constructor(level: LevelDefinition, rngSeed: bigint | number | string) {
    validateLevel(level);
    this.level = level;
    this.spawnRule = new SpawnRule(level.spawnWeights);
    try {
      this.spawnRule.validate();
    } catch (error) {
      throw new BoardEngineError("levelLoadFailure", `Invalid spawn rule: ${String(error)}`);
    }
    if (level.id < 50 && this.spawnRule.weights.zeroDay > 0) {
      throw new BoardEngineError("levelLoadFailure", "zeroDay is forbidden for levels < 50");
    }

    try {
      this.rng = new SeededRNG(rngSeed);
    } catch {
      throw new BoardEngineError("rngInitFailure", "Failed to initialize deterministic RNG.");
    }

    this.grid = new Grid2D(level.gridRows, level.gridCols, () => emptyCell());
    for (let row = 0; row < level.gridRows; row += 1) {
      for (let col = 0; col < level.gridCols; col += 1) {
        this.grid.set({ row, col }, parseCell(level.cellMap[row][col], level.id));
      }
    }

    fillInitialTiles(this.grid, this.spawnRule, level.id, this.rng);
    repairInitialMatches(this.grid, this.spawnRule, level.id, this.rng);
    repairInitialDeadlock(this.grid, this.rng);
    this.assignDebugTileIds();

    for (const objective of level.objectives) {
      this.objectiveTargetsValue[objective.id] = (this.objectiveTargetsValue[objective.id] ?? 0) + objective.target;
      this.objectiveProgressValue[objective.id] = this.objectiveProgressValue[objective.id] ?? 0;
    }
  }

  get snapshot(): BoardSnapshot {
    return {
      grid: this.grid.clone(cloneCell),
      moveCount: this.moveCountValue,
      moveLimit: this.level.moveLimit + this.moveLimitBonus,
      objectiveProgress: { ...this.objectiveProgressValue },
      objectiveTargets: { ...this.objectiveTargetsValue },
      spawnWeights: { ...this.spawnRule.weights },
      rngSeed: this.rng.state.toString(),
      chainDepth: this.chainDepthValue
    };
  }

  apply(action: BoardAction): BoardDelta {
    const accumulator = emptyAccumulator();
    let initialResolution = emptyPowerUpResolution();
    let preferredPowerUpCreationPositions: GridPosition[] = [];

    switch (action.kind) {
      case "swap":
        initialResolution = this.performSwap(action.from, action.to);
        preferredPowerUpCreationPositions = this.lastSwapPreferredPositions;
        break;
      case "tap":
        initialResolution = this.performTap(action.at);
        break;
      case "activateBooster":
        initialResolution = this.performBooster(action.booster, action.at);
        break;
    }

    if (action.kind !== "activateBooster") this.moveCountValue += 1;
    this.resolveBoard(initialResolution, preferredPowerUpCreationPositions, accumulator);

    let shuffleAttempts = 0;
    if (this.validMovesForGrid(this.grid).length === 0) {
      shuffleAttempts = this.shuffleUntilPlayable();
    }

    const isWin = Object.entries(this.objectiveTargetsValue).every(([key, target]) => (this.objectiveProgressValue[key] ?? 0) >= target);
    const isFail = !isWin && this.moveCountValue >= this.level.moveLimit + this.moveLimitBonus;
    const objectiveEvents: ObjectiveEvent[] = Object.entries(accumulator.objectiveDeltas)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([objectiveId, progressDelta]) => ({ objectiveId, progressDelta }));

    const delta: BoardDelta = {
      clears: accumulator.clears,
      moves: accumulator.moves,
      spawns: accumulator.spawns,
      powerUpEvents: accumulator.powerUpEvents,
      objectiveEvents,
      chainDepth: accumulator.chainDepth,
      scoreGained: accumulator.scoreGained,
      isWin,
      isFail,
      shuffleAttempts
    };
    this.actionHistory.push(cloneAction(action));
    this.chainDepthValue = 0;
    return delta;
  }

  extendMoveLimit(count: number): void {
    this.moveLimitBonus += Math.max(0, Math.trunc(count));
  }

  validMoves(): BoardAction[] {
    return this.validMovesForGrid(this.grid);
  }

  hasDeadlock(): boolean {
    return this.validMoves().length === 0;
  }

  actionLog(): BoardAction[] {
    return this.actionHistory.map(cloneAction);
  }

  private lastSwapPreferredPositions: GridPosition[] = [];

  private performSwap(from: GridPosition, to: GridPosition): PowerUpResolution {
    this.lastSwapPreferredPositions = [];
    if (!this.grid.isValid(from) || !this.grid.isValid(to)) {
      throw new BoardEngineError("invalidSwap", "Swap positions out of bounds");
    }
    if (Math.abs(from.row - to.row) + Math.abs(from.col - to.col) !== 1) {
      throw new BoardEngineError("invalidSwap", "Swap positions must be adjacent");
    }
    const fromCell = this.grid.get(from);
    const toCell = this.grid.get(to);
    if (!fromCell.isMovable || !toCell.isMovable || fromCell.generator !== null || toCell.generator !== null) {
      throw new BoardEngineError("invalidSwap", "One or both cells are immovable");
    }

    this.grid.swap(from, to);
    const swappedFromCell = this.grid.get(from);
    const swappedToCell = this.grid.get(to);

    if (swappedFromCell.powerUp && swappedToCell.powerUp) {
      return triggerPowerUpCombo(
        swappedFromCell.powerUp,
        swappedToCell.powerUp,
        from,
        to,
        this.grid,
        this.level.objectives,
        this.objectiveProgressValue,
        this.rng
      );
    }
    if (swappedFromCell.powerUp) {
      return triggerSinglePowerUp(swappedFromCell.powerUp, from, this.grid, this.level.objectives, this.objectiveProgressValue, this.rng, { kind: "swap" });
    }
    if (swappedToCell.powerUp) {
      return triggerSinglePowerUp(swappedToCell.powerUp, to, this.grid, this.level.objectives, this.objectiveProgressValue, this.rng, { kind: "swap" });
    }

    const matches = detectMatches(this.grid);
    if (matches.length === 0) {
      this.grid.swap(from, to);
      throw new BoardEngineError("invalidSwap", "Swap does not create a match");
    }
    this.lastSwapPreferredPositions = [to, from];
    return emptyPowerUpResolution();
  }

  private performTap(position: GridPosition): PowerUpResolution {
    if (!this.grid.isValid(position)) {
      throw new BoardEngineError("invalidTap", "Tap position out of bounds");
    }
    const powerUp = this.grid.get(position).powerUp;
    if (!powerUp) {
      throw new BoardEngineError("invalidTap", "No power-up at tapped position");
    }
    return triggerSinglePowerUp(powerUp, position, this.grid, this.level.objectives, this.objectiveProgressValue, this.rng, { kind: "tap" });
  }

  private performBooster(booster: BoosterType, origin: GridPosition): PowerUpResolution {
    if (!this.grid.isValid(origin)) {
      throw new BoardEngineError("invalidTap", "Booster target out of bounds");
    }
    const powerUp = mapBoosterToPowerUp(booster);
    const cell = this.grid.get(origin);
    if (!cell.isMovable || cell.generator !== null || !hasOccupant(cell)) {
      throw new BoardEngineError("invalidTap", "Booster target is blocked");
    }
    setPowerUp(cell, powerUp);
    if (cell.debugTileId === null) {
      cell.debugTileId = this.nextDebugTileId;
      this.nextDebugTileId += 1;
    }
    cell.debugDesignLocked = false;
    this.grid.set(origin, cell);
    return triggerSinglePowerUp(powerUp, origin, this.grid, this.level.objectives, this.objectiveProgressValue, this.rng, { kind: "tap" });
  }

  private resolveBoard(
    initialResolution: PowerUpResolution,
    preferredPowerUpCreationPositions: GridPosition[],
    accumulator: ResolutionAccumulator
  ): void {
    let pendingClear = new Set(initialResolution.clears);
    let clearSources = new Map(initialResolution.clearSources);
    accumulator.powerUpEvents.push(...initialResolution.powerUpEvents);
    let cascadeDepth = 0;

    while (true) {
      let creations: PowerUpCreation[] = [];
      if (pendingClear.size === 0) {
        const matches = detectMatches(this.grid);
        if (matches.length === 0) break;
        creations = powerUpCreations(matches, preferredPowerUpCreationPositions);
        const clearSet = new Set<string>();
        for (const group of matches) {
          for (const key of group.positions) clearSet.add(key);
        }
        for (const creation of creations) clearSet.delete(positionKey(creation.position));
        pendingClear = clearSet;
      }

      if (pendingClear.size === 0 && creations.length === 0) break;
      this.chainDepthValue = cascadeDepth;
      accumulator.chainDepth = Math.max(accumulator.chainDepth, cascadeDepth);

      for (const creation of creations) {
        const cell = this.grid.get(creation.position);
        setPowerUp(cell, creation.powerUp);
        if (cell.debugTileId === null) {
          cell.debugTileId = this.nextDebugTileId;
          this.nextDebugTileId += 1;
        }
        this.grid.set(creation.position, cell);
        accumulator.spawns.push({ position: creation.position, tileType: creation.tileType, asPowerUp: clonePowerUp(creation.powerUp) });
      }

      const clearPositions = sortedPositions(pendingClear);
      const chainedPowerUps: { origin: GridPosition; powerUp: PowerUpType; source: PowerUpType }[] = [];
      const recentlyCleared: GridPosition[] = [];

      for (const position of clearPositions) {
        if (!this.grid.isValid(position)) continue;
        const cell = this.grid.get(position);
        const sourcePowerUp = clearSources.get(positionKey(position)) ?? null;
        const clearedByPowerUp = sourcePowerUp !== null;

        if (cell.overlay) {
          if (clearedByPowerUp) {
            cell.overlay = cell.overlay.hp <= 1 ? null : { kind: "encryptedVolume", hp: cell.overlay.hp - 1 };
            this.grid.set(position, cell);
            continue;
          }
          if (cell.overlay.hp > 1) {
            cell.overlay = { kind: "encryptedVolume", hp: cell.overlay.hp - 1 };
            this.grid.set(position, cell);
            continue;
          }
          cell.overlay = null;
          this.grid.set(position, cell);
        }

        const underlayDestroyedAtCell = decrementUnderlayIfPresent(cell);

        if (cell.powerUp && sourcePowerUp) {
          chainedPowerUps.push({ origin: position, powerUp: clonePowerUp(cell.powerUp)!, source: sourcePowerUp });
        }

        const hadOccupant = hasOccupant(cell);
        const eventTileType = fallbackTileType(cell, this.grid, position);
        if (hadOccupant) {
          const contributions = objectiveContributions(
            eventTileType,
            position,
            underlayDestroyedAtCell,
            this.level.objectives,
            this.objectiveProgressValue,
            this.grid.rows - 1
          );
          for (const objectiveId of contributions) {
            this.objectiveProgressValue[objectiveId] = (this.objectiveProgressValue[objectiveId] ?? 0) + 1;
            accumulator.objectiveDeltas[objectiveId] = (accumulator.objectiveDeltas[objectiveId] ?? 0) + 1;
          }
          accumulator.clears.push({
            position,
            tileType: eventTileType,
            clearedByPowerUp,
            contributedToObjective: contributions.length > 0,
            objectiveId: contributions[0] ?? null
          });
          recentlyCleared.push(position);
        }

        setBaseTile(cell, null);
        setPowerUp(cell, null);
        cell.debugTileId = null;
        cell.debugDesignLocked = false;
        if (cell.generator === null) cell.isMovable = true;
        this.grid.set(position, cell);
      }

      this.applyAdjacentUnderlayDamage(recentlyCleared, accumulator);
      pendingClear = new Set<string>();
      clearSources = new Map<string, PowerUpType>();

      const chainResolution = emptyPowerUpResolution();
      for (const trigger of chainedPowerUps) {
        mergePowerUpResolution(
          chainResolution,
          triggerSinglePowerUp(
            trigger.powerUp,
            trigger.origin,
            this.grid,
            this.level.objectives,
            this.objectiveProgressValue,
            this.rng,
            { kind: "combo", with: clonePowerUp(trigger.source)! }
          )
        );
      }
      accumulator.powerUpEvents.push(...chainResolution.powerUpEvents);
      if (chainResolution.clears.size > 0) {
        pendingClear = new Set(chainResolution.clears);
        clearSources = new Map(chainResolution.clearSources);
        continue;
      }

      const nextDebugTileIdRef = { value: this.nextDebugTileId };
      const gravity = applyGravity(this.grid, this.spawnRule, this.rng, nextDebugTileIdRef);
      this.nextDebugTileId = nextDebugTileIdRef.value;
      accumulator.moves.push(...gravity.moves);
      accumulator.spawns.push(...gravity.spawns);
      this.spreadMalwareOneStep();
      cascadeDepth += 1;
    }

    accumulator.scoreGained = score(accumulator.clears.length, accumulator.powerUpEvents.length, accumulator.chainDepth);

  }

  private applyAdjacentUnderlayDamage(clearedPositions: GridPosition[], accumulator: ResolutionAccumulator): void {
    const offsets = [
      { row: -1, col: 0 },
      { row: 1, col: 0 },
      { row: 0, col: -1 },
      { row: 0, col: 1 }
    ];
    for (const position of clearedPositions) {
      for (const offset of offsets) {
        const neighbor = { row: position.row + offset.row, col: position.col + offset.col };
        if (!this.grid.isValid(neighbor)) continue;
        const cell = this.grid.get(neighbor);
        if (!cell.underlay) continue;
        if (cell.underlay.hp <= 1) {
          cell.underlay = null;
          if (this.objectiveTargetsValue.spread !== undefined) {
            this.objectiveProgressValue.spread = (this.objectiveProgressValue.spread ?? 0) + 1;
            accumulator.objectiveDeltas.spread = (accumulator.objectiveDeltas.spread ?? 0) + 1;
          }
        } else {
          cell.underlay = { kind: "malwarePropagation", hp: cell.underlay.hp - 1 };
        }
        this.grid.set(neighbor, cell);
      }
    }
  }

  private spreadMalwareOneStep(): void {
    const offsets = [
      { row: -1, col: 0 },
      { row: 1, col: 0 },
      { row: 0, col: -1 },
      { row: 0, col: 1 }
    ];
    const placements: GridPosition[] = [];
    for (const source of this.grid.allPositions) {
      const cell = this.grid.get(source);
      if (!cell.underlay || cell.underlay.hp <= 0) continue;
      const neighbors: GridPosition[] = [];
      for (const offset of offsets) {
        const candidate = { row: source.row + offset.row, col: source.col + offset.col };
        if (!this.grid.isValid(candidate)) continue;
        const candidateCell = this.grid.get(candidate);
        if (candidateCell.underlay === null && candidateCell.generator === null) neighbors.push(candidate);
      }
      if (neighbors.length > 0) placements.push(neighbors[this.rng.nextInt(neighbors.length)]);
    }
    for (const position of placements) {
      const cell = this.grid.get(position);
      if (cell.underlay === null) {
        cell.underlay = { kind: "malwarePropagation", hp: 1 };
        this.grid.set(position, cell);
      }
    }
  }

  private validMovesForGrid(board: Grid2D<CellState>): BoardAction[] {
    return validMovesForGrid(board);
  }

  private shuffleUntilPlayable(): number {
    const movablePositions = this.grid.allPositions.filter((position) => {
      const cell = this.grid.get(position);
      return cell.isMovable && cell.generator === null;
    });
    if (movablePositions.length <= 1) return 0;
    const occupants = movablePositions.map((position) => {
      const cell = this.grid.get(position);
      return {
        baseTile: cell.baseTile,
        powerUp: clonePowerUp(cell.powerUp),
        debugTileId: cell.debugTileId,
        debugDesignLocked: cell.debugDesignLocked
      };
    });
    for (let attempt = 1; attempt <= 256; attempt += 1) {
      this.rng.shuffle(occupants);
      movablePositions.forEach((position, index) => {
        const cell = this.grid.get(position);
        setBaseTile(cell, occupants[index].baseTile);
        if (occupants[index].powerUp) setPowerUp(cell, occupants[index].powerUp);
        cell.debugTileId = occupants[index].debugTileId;
        cell.debugDesignLocked = occupants[index].debugDesignLocked;
        this.grid.set(position, cell);
      });
      if (detectMatches(this.grid).length === 0 && this.validMovesForGrid(this.grid).length > 0) return attempt;
    }
    throw new BoardEngineError("noMovesAvailable", "No valid moves available.");
  }

  private assignDebugTileIds(): void {
    for (const position of this.grid.allPositions) {
      const cell = this.grid.get(position);
      if (hasOccupant(cell)) {
        if (cell.debugTileId === null) {
          cell.debugTileId = this.nextDebugTileId;
          this.nextDebugTileId += 1;
        }
      } else {
        cell.debugTileId = null;
        cell.debugDesignLocked = false;
      }
      this.grid.set(position, cell);
    }
  }
}

function emptyAccumulator(): ResolutionAccumulator {
  return {
    clears: [],
    moves: [],
    spawns: [],
    powerUpEvents: [],
    objectiveDeltas: {},
    chainDepth: 0,
    scoreGained: 0
  };
}

function validateLevel(level: LevelDefinition): void {
  if (level.gridRows < 5 || level.gridRows > 12 || level.gridCols < 5 || level.gridCols > 9) {
    throw new BoardEngineError("levelLoadFailure", "Grid size out of supported bounds");
  }
  if (level.moveLimit <= 0) throw new BoardEngineError("levelLoadFailure", "moveLimit must be > 0");
  if (level.objectives.length === 0) throw new BoardEngineError("levelLoadFailure", "Level must have at least one objective");
  if (level.cellMap.length !== level.gridRows || level.cellMap.some((row) => row.length !== level.gridCols)) {
    throw new BoardEngineError("levelLoadFailure", "cellMap dimensions do not match gridRows/gridCols");
  }
  if (level.bossLevel && level.bonusLevel) throw new BoardEngineError("levelLoadFailure", "bossLevel and bonusLevel cannot both be true");
}

function parseCell(definition: CellDefinition, levelId: number): CellState {
  const cell = emptyCell();
  if (definition.tile && definition.powerUp) {
    throw new BoardEngineError("levelLoadFailure", `Level ${levelId}: Cell cannot contain both tile and powerUp`);
  }
  if (definition.generator && definition.tile) {
    throw new BoardEngineError("levelLoadFailure", `Level ${levelId}: Generator cells cannot contain a tile`);
  }
  cell.baseTile = definition.tile;
  cell.powerUp = parsePowerUp(definition.powerUp);
  cell.overlay = parseOverlay(definition.overlay, levelId);
  cell.underlay = parseUnderlay(definition.underlay, levelId);
  cell.generator = definition.generator;
  cell.isMovable = definition.generator === null ? !definition.locked : false;
  cell.debugDesignLocked = definition.locked;
  return cell;
}

function parseOverlay(raw: string | null, levelId: number) {
  if (raw === null) return null;
  const match = raw.match(/^encryptedVolume_([1-3])$/);
  if (!match) throw new BoardEngineError("levelLoadFailure", `Level ${levelId}: Unknown overlay descriptor: ${raw}`);
  return { kind: "encryptedVolume" as const, hp: Number(match[1]) };
}

function parseUnderlay(raw: string | null, levelId: number) {
  if (raw === null) return null;
  const match = raw.match(/^malware_([1-2])$/);
  if (!match) throw new BoardEngineError("levelLoadFailure", `Level ${levelId}: Unknown underlay descriptor: ${raw}`);
  return { kind: "malwarePropagation" as const, hp: Number(match[1]) };
}

function fillInitialTiles(grid: Grid2D<CellState>, spawnRule: SpawnRule, levelId: number, rng: SeededRNG): void {
  for (const position of grid.allPositions) {
    const cell = grid.get(position);
    if (cell.generator !== null || cell.powerUp !== null || cell.baseTile !== null) continue;
    setBaseTile(cell, drawNonMatchingTile(position, grid, spawnRule, levelId, rng));
    grid.set(position, cell);
  }
}

function repairInitialMatches(grid: Grid2D<CellState>, spawnRule: SpawnRule, levelId: number, rng: SeededRNG): void {
  for (let attempt = 0; attempt < 128; attempt += 1) {
    const matches = detectMatches(grid);
    if (matches.length === 0) return;
    for (const group of matches) {
      for (const position of sortedPositions(group.positions)) {
        const cell = grid.get(position);
        if (cell.generator !== null || !cell.isMovable || cell.powerUp !== null) continue;
        setBaseTile(cell, drawNonMatchingTile(position, grid, spawnRule, levelId, rng));
        grid.set(position, cell);
      }
    }
  }
}

function repairInitialDeadlock(grid: Grid2D<CellState>, rng: SeededRNG): void {
  if (validMovesStatic(grid).length > 0) return;
  const movablePositions = grid.allPositions.filter((position) => {
    const cell = grid.get(position);
    return cell.isMovable && cell.generator === null;
  });
  if (movablePositions.length <= 1) return;
  const occupants = movablePositions.map((position) => {
    const cell = grid.get(position);
    return { baseTile: cell.baseTile, powerUp: clonePowerUp(cell.powerUp) };
  });
  for (let attempt = 0; attempt < 128; attempt += 1) {
    rng.shuffle(occupants);
    movablePositions.forEach((position, index) => {
      const cell = grid.get(position);
      setBaseTile(cell, occupants[index].baseTile);
      if (occupants[index].powerUp) setPowerUp(cell, occupants[index].powerUp);
      grid.set(position, cell);
    });
    if (detectMatches(grid).length === 0 && validMovesStatic(grid).length > 0) return;
  }
}

function drawNonMatchingTile(position: GridPosition, grid: Grid2D<CellState>, spawnRule: SpawnRule, levelId: number, rng: SeededRNG): TileType {
  let fallback = spawnRule.draw(rng);
  if (levelId < 50 && fallback === "zeroDay") fallback = "packet";
  for (let attempt = 0; attempt < 128; attempt += 1) {
    const candidate = spawnRule.draw(rng);
    if (levelId < 50 && candidate === "zeroDay") continue;
    if (!createsImmediateMatch(candidate, position, grid)) return candidate;
  }
  return fallback;
}

function createsImmediateMatch(tile: TileType, position: GridPosition, grid: Grid2D<CellState>): boolean {
  const center = grid.get(position);
  if (center.overlay !== null) return false;
  if (position.col >= 2) {
    const leftOne = grid.get({ row: position.row, col: position.col - 1 });
    const leftTwo = grid.get({ row: position.row, col: position.col - 2 });
    if (leftOne.overlay === null && leftTwo.overlay === null && leftOne.baseTile === tile && leftTwo.baseTile === tile) return true;
  }
  if (position.row >= 2) {
    const upOne = grid.get({ row: position.row - 1, col: position.col });
    const upTwo = grid.get({ row: position.row - 2, col: position.col });
    if (upOne.overlay === null && upTwo.overlay === null && upOne.baseTile === tile && upTwo.baseTile === tile) return true;
  }
  return false;
}

function powerUpCreations(groups: MatchGroup[], preferredPositions: GridPosition[]): PowerUpCreation[] {
  const creations: PowerUpCreation[] = [];
  const occupied = new Set<string>();
  for (const group of groups) {
    const powerUp = powerUpForShape(group.shape);
    if (!powerUp) continue;
    const position = anchorPosition(group, preferredPositions);
    const key = positionKey(position);
    if (occupied.has(key)) continue;
    occupied.add(key);
    creations.push({ position, powerUp, tileType: group.tileType });
  }
  return creations;
}

function powerUpForShape(shape: MatchGroup["shape"]): PowerUpType | null {
  if (shape.kind === "line" && shape.length >= 5) return { kind: "lightBall" };
  if (shape.kind === "line" && shape.length === 4) return { kind: "rocket", orientation: shape.orientation };
  if (shape.kind === "square2x2") return { kind: "propeller" };
  if (shape.kind === "lOrT") return { kind: "tnt" };
  return null;
}

function anchorPosition(group: MatchGroup, preferredPositions: GridPosition[]): GridPosition {
  for (const preferred of preferredPositions) {
    if (group.positions.has(positionKey(preferred))) return preferred;
  }
  const sorted = sortedPositions(group.positions);
  return sorted[Math.trunc(sorted.length / 2)] ?? { row: 0, col: 0 };
}

function decrementUnderlayIfPresent(cell: CellState): boolean {
  if (!cell.underlay) return false;
  if (cell.underlay.hp <= 1) {
    cell.underlay = null;
    return true;
  }
  cell.underlay = { kind: "malwarePropagation", hp: cell.underlay.hp - 1 };
  return false;
}

function fallbackTileType(cell: CellState, grid: Grid2D<CellState>, position: GridPosition): TileType {
  if (cell.baseTile) return cell.baseTile;
  for (const neighbor of [
    { row: position.row - 1, col: position.col },
    { row: position.row + 1, col: position.col },
    { row: position.row, col: position.col - 1 },
    { row: position.row, col: position.col + 1 }
  ]) {
    if (grid.isValid(neighbor)) {
      const tile = grid.get(neighbor).baseTile;
      if (tile) return tile;
    }
  }
  return "packet";
}

function objectiveContributions(
  tileType: TileType,
  position: GridPosition,
  underlayDestroyed: boolean,
  objectives: ObjectiveDefinition[],
  progress: Record<string, number>,
  bottomRow: number
): string[] {
  const contributions: string[] = [];
  for (const objective of objectives) {
    if ((progress[objective.id] ?? 0) >= objective.target) continue;
    if ((objective.id === "collect" || objective.id.startsWith("collect_")) && objective.tileType === tileType) {
      contributions.push(objective.id);
    } else if (objective.id === "clear") {
      contributions.push(objective.id);
    } else if (objective.id === "spread" && underlayDestroyed) {
      contributions.push(objective.id);
    } else if (objective.id === "guide" && position.row === bottomRow) {
      contributions.push(objective.id);
    } else if (objective.id === "multi") {
      contributions.push(objective.id);
    }
  }
  return contributions;
}

function score(clearedTiles: number, powerUpEvents: number, chainDepth: number): number {
  return clearedTiles * 10 + powerUpEvents * 25 + Math.max(0, chainDepth) * 50;
}

function mapBoosterToPowerUp(booster: BoosterType): PowerUpType {
  switch (booster) {
    case "rocket":
      return { kind: "rocket", orientation: "horizontal" };
    case "rocketVertical":
      return { kind: "rocket", orientation: "vertical" };
    case "tnt":
      return { kind: "tnt" };
    case "propeller":
      return { kind: "propeller" };
    case "lightBall":
      return { kind: "lightBall" };
  }
}

function validMovesStatic(board: Grid2D<CellState>): BoardAction[] {
  return validMovesForGrid(board);
}

function validMovesForGrid(board: Grid2D<CellState>): BoardAction[] {
  const actions: BoardAction[] = [];
  for (let row = 0; row < board.rows; row += 1) {
    for (let col = 0; col < board.cols; col += 1) {
      const from = { row, col };
      const fromCell = board.get(from);
      if (!fromCell.isMovable || fromCell.generator !== null) continue;
      for (const offset of [
        { row: 0, col: 1 },
        { row: 1, col: 0 }
      ]) {
        const to = { row: row + offset.row, col: col + offset.col };
        if (!board.isValid(to)) continue;
        const toCell = board.get(to);
        if (!toCell.isMovable || toCell.generator !== null) continue;
        const candidate = board.clone(cloneCell);
        candidate.swap(from, to);
        const allowsPowerSwap = candidate.get(from).powerUp !== null || candidate.get(to).powerUp !== null;
        const createsMatch = detectMatches(candidate).length > 0;
        if (allowsPowerSwap || createsMatch) actions.push({ kind: "swap", from, to });
      }
    }
  }
  for (const position of board.allPositions) {
    const cell = board.get(position);
    if (cell.isMovable && cell.powerUp !== null) actions.push({ kind: "tap", at: position });
  }
  return actions.sort(compareActions);
}

function compareActions(lhs: BoardAction, rhs: BoardAction): number {
  const key = (action: BoardAction): [number, number, number, number, number] => {
    if (action.kind === "swap") return [0, action.from.row, action.from.col, action.to.row, action.to.col];
    if (action.kind === "tap") return [1, action.at.row, action.at.col, 0, 0];
    return [2, action.at.row, action.at.col, 0, 0];
  };
  const left = key(lhs);
  const right = key(rhs);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function cloneAction(action: BoardAction): BoardAction {
  if (action.kind === "swap") return { kind: "swap", from: { ...action.from }, to: { ...action.to } };
  if (action.kind === "tap") return { kind: "tap", at: { ...action.at } };
  return { kind: "activateBooster", booster: action.booster, at: { ...action.at } };
}
