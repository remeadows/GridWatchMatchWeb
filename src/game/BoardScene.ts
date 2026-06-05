import Phaser from "phaser";
import { assetManifest, assetUrl } from "../data/assets";
import {
  cloneCell,
  detectMatches,
  powerUpKey,
  serializePowerUp,
  type BoardAction,
  type BoardDelta,
  type BoardSnapshot,
  type BoosterType,
  type CellState,
  type GridPosition,
  type PowerUpEvent,
  type PowerUpType,
  type TileType
} from "../engine";
import { buildPostClearSnapshot, computeCentroidStagger, seededAngleJitter } from "./motion";

export interface BoardSceneData {
  onAction: (action: BoardAction) => void;
}

export type BoardAnimationEvent =
  | { id: number; kind: "resolved"; action: BoardAction; delta: BoardDelta }
  | { id: number; kind: "invalid"; action: BoardAction };

type DragAxis = "horizontal" | "vertical";

interface DragNeighbor {
  position: GridPosition;
  sprite: Phaser.GameObjects.Container;
  home: { x: number; y: number };
}

// Single source of truth for an in-flight drag. The dragged object is the REAL
// occupant container (lifted to the top of the board layer), not a ghost. This
// guarantees exactly one animation path for a swap from gesture through resolve.
interface ActiveDrag {
  start: GridPosition;
  startCenter: { x: number; y: number };
  pointerStart: { x: number; y: number };
  sprite: Phaser.GameObjects.Container;
  axis: DragAxis | null;
  offset: { x: number; y: number };
  neighbor: DragNeighbor | null;
  blockedMarker: Phaser.GameObjects.Graphics | null;
  blockedKey: string | null;
  committed: boolean;
}

interface DragIntent {
  axis: DragAxis | null;
  blockedTarget: GridPosition | null;
  canCommit: boolean;
  commitTarget: GridPosition | null;
  offset: { x: number; y: number };
  previewTarget: GridPosition | null;
  targetOffset: { x: number; y: number };
  travel: number;
}

interface BoardPointer {
  x: number;
  y: number;
}

interface SwapAnimationObject {
  object: Phaser.GameObjects.Container;
  to: { x: number; y: number };
  home: { x: number; y: number };
}

interface DomPointerHandlers {
  cancel: (event: PointerEvent) => void;
  down: (event: PointerEvent) => void;
  move: (event: PointerEvent) => void;
  up: (event: PointerEvent) => void;
}

const tileImageKeys: Record<TileType, string> = {
  packet: "tile-packet",
  firewall: "tile-firewall",
  key: "tile-key",
  threat: "tile-threat",
  zeroDay: "tile-zeroDay"
};

const powerUpImageKeys = {
  rocket_horizontal: "powerup-rocketH",
  rocket_vertical: "powerup-rocketV",
  propeller: "powerup-propeller",
  tnt: "powerup-tnt",
  lightBall: "powerup-lightBall"
} as const;

const motionTiming = {
  blockedJiggle: 72,
  blockedFlash: 230,
  cascadeFall: 0.78,
  cascadeSettle: 0.22,
  cascadeMove: 340,
  clearFlash: 300,
  invalidStretch: 70,
  invalidSettle: 60,
  invalidSwap: 170,
  matchLock: 650,
  matchPop: 170,
  matchPopAnticipation: 70,
  powerUpEffect: 560,
  snapBack: 150,
  spawnFlash: 230,
  spawnMove: 390,
  swap: 210
} as const;

// Subtle spring overshoot on the swap settle. Lower than Phaser default 1.70158
// so a one-cell move reads as a crisp snap, not a bounce.
const swapEaseParams = [1.1];

export class BoardScene extends Phaser.Scene {
  private snapshot: BoardSnapshot | null = null;
  private onAction: ((action: BoardAction) => void) | null = null;
  private layer: Phaser.GameObjects.Container | null = null;
  private fxLayer: Phaser.GameObjects.Container | null = null;
  private occupantNodes = new Map<string, Phaser.GameObjects.Container>();
  private boardBounds = new Phaser.Geom.Rectangle(0, 0, 0, 0);
  private tileSize = 72;
  private activePointerId: number | null = null;
  private domPointerHandlers: DomPointerHandlers | null = null;
  private drag: ActiveDrag | null = null;
  private commitSettled = false;
  private pendingCommitCb: (() => void) | null = null;
  private selected: GridPosition | null = null;
  private activeAnimationId: number | null = null;
  private lastAnimationId = 0;
  private reducedMotion = false;
  private pendingBooster: BoosterType | null = null;

  constructor() {
    super("BoardScene");
  }

  init(data: BoardSceneData): void {
    this.onAction = data.onAction;
  }

  preload(): void {
    this.load.image(tileImageKeys.packet, assetUrl(assetManifest.images.tiles.packet));
    this.load.image(tileImageKeys.firewall, assetUrl(assetManifest.images.tiles.firewall));
    this.load.image(tileImageKeys.key, assetUrl(assetManifest.images.tiles.key));
    this.load.image(tileImageKeys.threat, assetUrl(assetManifest.images.tiles.threat));
    this.load.image(tileImageKeys.zeroDay, assetUrl(assetManifest.images.tiles.zeroDay));
    this.load.image(powerUpImageKeys.rocket_horizontal, assetUrl(assetManifest.images.powerUps.rocketH));
    this.load.image(powerUpImageKeys.rocket_vertical, assetUrl(assetManifest.images.powerUps.rocketV));
    this.load.image(powerUpImageKeys.propeller, assetUrl(assetManifest.images.powerUps.propeller));
    this.load.image(powerUpImageKeys.tnt, assetUrl(assetManifest.images.powerUps.tnt));
    this.load.image(powerUpImageKeys.lightBall, assetUrl(assetManifest.images.powerUps.lightBall));
  }

  create(): void {
    this.layer = this.add.container(0, 0);
    this.fxLayer = this.add.container(0, 0);
    this.installDomPointerHandlers();
    this.scale.on("resize", () => {
      this.hardClearDrag();
      this.renderSnapshot();
    });
    this.renderSnapshot();
  }

  sync(snapshot: BoardSnapshot, animation?: BoardAnimationEvent | null, reducedMotion = false, pendingBooster: BoosterType | null = null): void {
    this.reducedMotion = reducedMotion;
    this.pendingBooster = pendingBooster;
    this.game.canvas.classList.toggle("booster-targeting", pendingBooster !== null);
    if (animation && animation.id === this.activeAnimationId) return;
    if (!animation && this.activeAnimationId !== null) return;
    if (animation && animation.id > this.lastAnimationId) {
      this.lastAnimationId = animation.id;
      this.activeAnimationId = animation.id;
      if (animation.kind === "invalid") {
        this.playInvalidAnimation(animation.action);
        return;
      }
      this.playResolvedAnimation(snapshot, animation);
      return;
    }
    this.hardClearDrag();
    this.snapshot = snapshot;
    this.renderSnapshot();
  }

  private finishAnimation(): void {
    this.activeAnimationId = null;
  }

  private renderSnapshot(hiddenPositions = new Set<string>(), clearFx = true): void {
    if (!this.layer || !this.snapshot) return;
    this.layer.removeAll(true);
    this.occupantNodes.clear();
    if (clearFx) this.fxLayer?.removeAll(true);
    this.updateGeometry();

    const boardWidth = this.tileSize * this.snapshot.grid.cols;
    const boardHeight = this.tileSize * this.snapshot.grid.rows;
    const background = this.add.graphics();
    background.fillStyle(0x071420, 0.92);
    background.fillRoundedRect(this.boardBounds.x - 8, this.boardBounds.y - 8, boardWidth + 16, boardHeight + 16, 10);
    background.lineStyle(2, 0x28d6ff, 0.28);
    background.strokeRoundedRect(this.boardBounds.x - 8, this.boardBounds.y - 8, boardWidth + 16, boardHeight + 16, 10);
    this.layer.add(background);

    for (const position of this.snapshot.grid.allPositions) {
      this.renderCell(position, hiddenPositions);
    }
  }

  private renderCell(position: GridPosition, hiddenPositions: Set<string>): void {
    if (!this.layer || !this.snapshot) return;
    const cell = this.snapshot.grid.get(position);
    const topLeft = this.cellTopLeft(position);
    const radius = Math.max(6, this.tileSize * 0.1);

    const graphics = this.add.graphics();
    graphics.fillStyle(cell.generator ? 0x41233a : cell.isMovable ? 0x10283b : 0x111820, 0.9);
    graphics.fillRoundedRect(topLeft.x + 2, topLeft.y + 2, this.tileSize - 4, this.tileSize - 4, radius);
    graphics.lineStyle(1, cell.isMovable ? 0x315774 : 0x42505c, 0.65);
    graphics.strokeRoundedRect(topLeft.x + 2, topLeft.y + 2, this.tileSize - 4, this.tileSize - 4, radius);
    if (cell.underlay) {
      graphics.fillStyle(0xb4164a, 0.38);
      graphics.fillRoundedRect(topLeft.x + 5, topLeft.y + 5, this.tileSize - 10, this.tileSize - 10, radius);
    }
    if (this.selected?.row === position.row && this.selected.col === position.col) {
      graphics.lineStyle(3, 0xf7d154, 0.95);
      graphics.strokeRoundedRect(topLeft.x + 5, topLeft.y + 5, this.tileSize - 10, this.tileSize - 10, radius);
    }
    this.layer.add(graphics);

    if (!hiddenPositions.has(positionKey(position))) {
      const occupant = this.addOccupant(position, cell, this.layer, 1);
      if (occupant) this.occupantNodes.set(positionKey(position), occupant);
    }

    if (cell.overlay) {
      const overlay = this.add.graphics();
      overlay.fillStyle(0x6ce7ff, 0.24);
      overlay.fillRoundedRect(topLeft.x + 8, topLeft.y + 8, this.tileSize - 16, this.tileSize - 16, radius);
      overlay.lineStyle(2, 0x9ff3ff, 0.75);
      overlay.strokeRoundedRect(topLeft.x + 8, topLeft.y + 8, this.tileSize - 16, this.tileSize - 16, radius);
      this.layer.add(overlay);
      this.addLabel(String(cell.overlay.hp), topLeft.x + this.tileSize - 16, topLeft.y + 16, "#dffbff", Math.floor(this.tileSize * 0.22), this.layer);
    }

    if (cell.underlay) {
      this.addLabel(String(cell.underlay.hp), topLeft.x + 16, topLeft.y + this.tileSize - 16, "#ff9ab4", Math.floor(this.tileSize * 0.2), this.layer);
    }
  }

  activateBoosterAtClientPoint(booster: BoosterType, clientX: number, clientY: number): boolean {
    const pointer = this.pointerFromClientPoint(clientX, clientY);
    return this.activateBoosterAtPointer(booster, pointer);
  }

  private playResolvedAnimation(nextSnapshot: BoardSnapshot, animation: Extract<BoardAnimationEvent, { kind: "resolved" }>): void {
    const previousSnapshot = this.snapshot;

    if (this.reducedMotion) {
      this.hardClearDrag();
      this.snapshot = nextSnapshot;
      this.renderSnapshot();
      this.finishAnimation();
      return;
    }

    if (animation.action.kind === "swap" && previousSnapshot) {
      const action = animation.action;
      const postSwapSnapshot = visualSnapshotAfterSwap(previousSnapshot, action);

      // Primary path: the committed live drag IS the swap animation. Wait for
      // its settle tween, then hand off to match resolution. No second swap leg,
      // no ghosts, no race timer.
      if (this.drag && this.drag.committed && this.dragMatchesSwap(this.drag, action)) {
        const run = () => {
          this.drag = null;
          this.pendingCommitCb = null;
          this.playPostSwapMatchResolution(postSwapSnapshot, nextSnapshot, animation.delta);
        };
        if (this.commitSettled) run();
        else this.pendingCommitCb = run;
        return;
      }

      // Fallback: programmatic swap with no live drag. Single ghost tween.
      this.hardClearDrag();
      this.renderSnapshot(hiddenPositionsFor(action));
      const ghosts = this.createSwapGhosts(action, previousSnapshot);
      if (ghosts.length > 0) {
        let remaining = ghosts.length;
        for (const ghost of ghosts) {
          this.tweens.add({
            targets: ghost.object,
            x: ghost.to.x,
            y: ghost.to.y,
            duration: motionTiming.swap,
            ease: "Back.easeOut",
            easeParams: swapEaseParams,
            onComplete: () => {
              ghost.object.destroy();
              remaining -= 1;
              if (remaining === 0) this.playPostSwapMatchResolution(postSwapSnapshot, nextSnapshot, animation.delta);
            }
          });
        }
        return;
      }
      this.playPostSwapMatchResolution(postSwapSnapshot, nextSnapshot, animation.delta);
      return;
    }

    this.hardClearDrag();
    const delta = animation.delta;
    if (delta.moves.length === 0 && delta.spawns.length === 0) {
      this.snapshot = nextSnapshot;
      this.renderSnapshot();
      this.playDeltaEffects(delta);
      this.finishAnimation();
      return;
    }
    // Use the current snapshot as the "post-clear" baseline. For tap/booster paths
    // there were no clears in this delta tick, so post-clear equals current.
    const baseline = this.snapshot ?? nextSnapshot;
    const postClear = buildPostClearSnapshot(baseline, new Set());
    this.playCascadeAndSpawn(postClear, nextSnapshot, delta, () => {
      this.playDeltaEffects(delta);
      this.finishAnimation();
    });
  }

  private playPostSwapMatchResolution(postSwapSnapshot: BoardSnapshot, nextSnapshot: BoardSnapshot, delta: BoardDelta): void {
    this.snapshot = postSwapSnapshot;
    this.renderSnapshot();
    const popKeys = initialMatchKeys(postSwapSnapshot);
    this.time.delayedCall(motionTiming.matchLock, () => {
      this.playTilePops(postSwapSnapshot, popKeys, () => {
        const postClear = buildPostClearSnapshot(postSwapSnapshot, popKeys);
        this.playCascadeAndSpawn(postClear, nextSnapshot, delta, () => {
          this.playDeltaEffects(delta, popKeys);
          this.finishAnimation();
        });
      });
    });
  }

  private playInvalidAnimation(action: BoardAction): void {
    if (action.kind !== "swap" || !this.snapshot || !this.fxLayer) {
      this.hardClearDrag();
      this.renderSnapshot();
      this.finishAnimation();
      return;
    }

    const drag = this.drag;
    // Primary: snap the committed live sprites back to their homes -- the tile
    // visibly tries the swap then rejects.
    if (drag && drag.committed && this.dragMatchesSwap(drag, action)) {
      this.tweens.killTweensOf(drag.sprite);
      if (drag.neighbor) this.tweens.killTweensOf(drag.neighbor.sprite);
      this.flashCell(action.from, 0xff4968, 190);
      this.flashCell(action.to, 0xff4968, 190);
      const neighbor = drag.neighbor;
      this.drag = null;
      this.commitSettled = false;
      this.pendingCommitCb = null;
      drag.blockedMarker?.destroy();

      if (this.reducedMotion) {
        this.renderSnapshot();
        this.finishAnimation();
        return;
      }

      let remaining = neighbor ? 2 : 1;
      const done = () => {
        remaining -= 1;
        if (remaining === 0) {
          this.renderSnapshot();
          this.finishAnimation();
        }
      };
      const startBounce = (
        sprite: Phaser.GameObjects.Container,
        home: { x: number; y: number },
        travelX: number,
        travelY: number
      ) => {
        const overshoot = this.tileSize * 0.025;
        const axisX = travelX !== 0 ? Math.sign(travelX) : 0;
        const axisY = travelY !== 0 ? Math.sign(travelY) : 0;
        const overshootX = home.x - axisX * overshoot;
        const overshootY = home.y - axisY * overshoot;
        this.tweens.add({
          targets: sprite,
          x: overshootX,
          y: overshootY,
          scaleX: axisX !== 0 ? 0.94 : 1,
          scaleY: axisY !== 0 ? 0.94 : 1,
          duration: motionTiming.invalidStretch,
          ease: "Sine.easeOut",
          onComplete: () => {
            this.tweens.add({
              targets: sprite,
              x: home.x,
              y: home.y,
              scaleX: 1,
              scaleY: 1,
              duration: motionTiming.invalidSettle,
              ease: "Sine.easeInOut",
              onComplete: done
            });
          }
        });
      };

      const dragTravelX = drag.sprite.x - drag.startCenter.x;
      const dragTravelY = drag.sprite.y - drag.startCenter.y;
      startBounce(drag.sprite, drag.startCenter, dragTravelX, dragTravelY);
      if (neighbor) {
        const nbTravelX = neighbor.sprite.x - neighbor.home.x;
        const nbTravelY = neighbor.sprite.y - neighbor.home.y;
        startBounce(neighbor.sprite, neighbor.home, nbTravelX, nbTravelY);
      }
      return;
    }

    // Fallback: no live drag -- ghost nudge.
    this.hardClearDrag();
    if (this.reducedMotion) {
      this.renderSnapshot();
      this.flashCell(action.from, 0xff4968, 160);
      this.flashCell(action.to, 0xff4968, 160);
      this.finishAnimation();
      return;
    }
    this.renderSnapshot(hiddenPositionsFor(action));
    const ghosts = this.createSwapGhosts(action, this.snapshot);
    let remaining = ghosts.length;
    for (const ghost of ghosts) {
      const start = { x: ghost.object.x, y: ghost.object.y };
      this.tweens.add({
        targets: ghost.object,
        x: Phaser.Math.Linear(start.x, ghost.to.x, 0.42),
        y: Phaser.Math.Linear(start.y, ghost.to.y, 0.42),
        duration: motionTiming.invalidSwap,
        yoyo: true,
        ease: "Sine.easeOut",
        onComplete: () => {
          ghost.object.destroy();
          remaining -= 1;
          if (remaining === 0) {
            this.renderSnapshot();
            this.finishAnimation();
          }
        }
      });
    }
    if (ghosts.length === 0) {
      this.renderSnapshot();
      this.finishAnimation();
    }
    for (const position of [action.from, action.to]) {
      this.flashCell(position, 0xff4968, 190);
    }
  }

  private dragMatchesSwap(drag: ActiveDrag, action: Extract<BoardAction, { kind: "swap" }>): boolean {
    if (!positionsEqual(drag.start, action.from)) return false;
    return Boolean(drag.neighbor && positionsEqual(drag.neighbor.position, action.to));
  }

  private createSwapGhosts(action: Extract<BoardAction, { kind: "swap" }>, sourceSnapshot: BoardSnapshot): SwapAnimationObject[] {
    if (!this.fxLayer) return [];
    const ghosts: SwapAnimationObject[] = [];
    const pairs = [
      { from: action.from, to: action.to },
      { from: action.to, to: action.from }
    ];
    for (const pair of pairs) {
      if (!sourceSnapshot.grid.isValid(pair.from) || !sourceSnapshot.grid.isValid(pair.to)) continue;
      const cell = sourceSnapshot.grid.get(pair.from);
      const ghost = this.addOccupant(pair.from, cell, this.fxLayer, 1);
      if (!ghost) continue;
      ghosts.push({ object: ghost, to: this.cellCenter(pair.to), home: this.cellCenter(pair.from) });
    }
    return ghosts;
  }

  private playDeltaEffects(delta: BoardDelta, skipClearKeys = new Set<string>()): void {
    if (this.reducedMotion) return;
    for (const event of delta.powerUpEvents) this.playPowerUpEffect(event);
    for (const clear of delta.clears) {
      if (!skipClearKeys.has(positionKey(clear.position))) this.flashCell(clear.position, clear.clearedByPowerUp ? 0x9bfff2 : 0xf7d154, motionTiming.clearFlash);
    }
  }

  private playTilePops(sourceSnapshot: BoardSnapshot, popKeys: Set<string>, onComplete: () => void): void {
    if (!this.fxLayer || popKeys.size === 0) {
      onComplete();
      return;
    }

    this.snapshot = sourceSnapshot;
    this.renderSnapshot(popKeys);
    const positions: GridPosition[] = [];
    for (const position of sourceSnapshot.grid.allPositions) {
      if (popKeys.has(positionKey(position))) positions.push(position);
    }

    const stagger = computeCentroidStagger(positions, { perUnitMs: 28, maxMs: 110 });
    const popObjects: { object: Phaser.GameObjects.Container; delay: number; position: GridPosition }[] = [];
    for (const position of positions) {
      const object = this.addOccupant(position, sourceSnapshot.grid.get(position), this.fxLayer, 1);
      if (!object) continue;
      const delay = stagger.get(positionKey(position)) ?? 0;
      popObjects.push({ object, delay, position });
      this.flashCell(position, 0xf7d154, motionTiming.matchPop + motionTiming.matchPopAnticipation);
    }

    if (popObjects.length === 0) {
      onComplete();
      return;
    }

    let remaining = popObjects.length;
    const seed = this.snapshot?.rngSeed ?? "0";
    for (const entry of popObjects) {
      const angle = entry.object.angle + seededAngleJitter(entry.position, seed, 10);
      const startPop = () => {
        this.tweens.add({
          targets: entry.object,
          scaleX: 1.18,
          scaleY: 1.18,
          duration: motionTiming.matchPopAnticipation,
          ease: "Back.easeOut",
          onComplete: () => {
            this.tweens.add({
              targets: entry.object,
              alpha: 0,
              scaleX: 0.12,
              scaleY: 0.12,
              angle,
              duration: motionTiming.matchPop,
              ease: "Back.easeIn",
              onComplete: () => {
                entry.object.destroy();
                remaining -= 1;
                if (remaining === 0) onComplete();
              }
            });
          }
        });
      };
      if (entry.delay > 0) this.time.delayedCall(entry.delay, startPop);
      else startPop();
    }
  }

  private playCascadeAndSpawn(
    postClearSnapshot: BoardSnapshot,
    nextSnapshot: BoardSnapshot,
    delta: BoardDelta,
    onComplete: () => void
  ): void {
    if (this.reducedMotion) {
      this.snapshot = nextSnapshot;
      this.renderSnapshot();
      onComplete();
      return;
    }

    this.snapshot = postClearSnapshot;
    // Hide the destination cells of all moves/spawns so renderSnapshot leaves them
    // empty - the real (for moves) or freshly-created (for spawns) sprites will
    // settle into them at the end of their tweens.
    const destinationKeys = new Set<string>();
    for (const move of delta.moves) destinationKeys.add(positionKey(move.to));
    for (const spawn of delta.spawns) destinationKeys.add(positionKey(spawn.position));
    this.renderSnapshot(destinationKeys, false);

    const moveTweens: { sprite: Phaser.GameObjects.Container; to: { x: number; y: number } }[] = [];
    for (const move of delta.moves) {
      const sprite = this.occupantNodes.get(positionKey(move.from));
      if (!sprite) continue;
      this.layer?.bringToTop(sprite);
      moveTweens.push({ sprite, to: this.cellCenter(move.to) });
      // Reattach under the destination key so subsequent renders find it.
      this.occupantNodes.delete(positionKey(move.from));
      this.occupantNodes.set(positionKey(move.to), sprite);
    }

    const spawnTweens: { sprite: Phaser.GameObjects.Container; to: { x: number; y: number } }[] = [];
    for (const spawn of delta.spawns) {
      if (!this.layer) continue;
      const targetCell = nextSnapshot.grid.get(spawn.position);
      const startX = this.cellCenter(spawn.position).x;
      const startY = this.boardBounds.y - this.tileSize * 0.5;
      const sprite = this.addOccupantAt(startX, startY, targetCell, this.layer, 0);
      if (!sprite) continue;
      this.tweens.add({ targets: sprite, alpha: 1, duration: Math.min(110, motionTiming.spawnMove * 0.3) });
      spawnTweens.push({ sprite, to: this.cellCenter(spawn.position) });
      this.occupantNodes.set(positionKey(spawn.position), sprite);
    }

    const allTweens = [
      ...moveTweens.map((t) => ({ ...t, total: motionTiming.cascadeMove })),
      ...spawnTweens.map((t) => ({ ...t, total: motionTiming.spawnMove }))
    ];

    if (allTweens.length === 0) {
      this.snapshot = nextSnapshot;
      this.renderSnapshot();
      onComplete();
      return;
    }

    let remaining = allTweens.length;
    const done = () => {
      remaining -= 1;
      if (remaining === 0) {
        this.snapshot = nextSnapshot;
        this.renderSnapshot();
        onComplete();
      }
    };

    for (const entry of allTweens) {
      const start = { x: entry.sprite.x, y: entry.sprite.y };
      const fallDuration = Math.max(40, Math.round(entry.total * motionTiming.cascadeFall));
      const settleDuration = Math.max(20, Math.round(entry.total * motionTiming.cascadeSettle));
      const bounceFromY = entry.to.y + Math.min(14, Math.abs(entry.to.y - start.y) * 0.08);
      this.tweens.add({
        targets: entry.sprite,
        x: entry.to.x,
        y: bounceFromY,
        scaleX: 0.96,
        scaleY: 1.05,
        duration: fallDuration,
        ease: "Sine.easeIn",
        onComplete: () => {
          this.tweens.add({
            targets: entry.sprite,
            x: entry.to.x,
            y: entry.to.y,
            scaleX: 1,
            scaleY: 1,
            duration: settleDuration,
            ease: "Sine.easeOut",
            onComplete: done
          });
        }
      });
    }
  }

  private playPowerUpEffect(event: PowerUpEvent): void {
    if (!this.fxLayer) return;
    const origin = this.cellCenter(event.origin);
    const graphics = this.add.graphics();
    this.fxLayer.add(graphics);

    if (event.powerUpType.kind === "rocket") {
      graphics.lineStyle(Math.max(5, this.tileSize * 0.08), 0x38d9ff, 0.72);
      if (event.powerUpType.orientation === "horizontal") {
        graphics.lineBetween(this.boardBounds.x, origin.y, this.boardBounds.right, origin.y);
      } else {
        graphics.lineBetween(origin.x, this.boardBounds.y, origin.x, this.boardBounds.bottom);
      }
    } else if (event.powerUpType.kind === "tnt") {
      graphics.lineStyle(3, 0xff8a3d, 0.9);
      graphics.fillStyle(0xff8a3d, 0.14);
      graphics.fillCircle(origin.x, origin.y, this.tileSize * 1.55);
      graphics.strokeCircle(origin.x, origin.y, this.tileSize * 1.55);
    } else if (event.powerUpType.kind === "propeller") {
      graphics.lineStyle(3, 0xf7d154, 0.88);
      for (const target of event.affectedPositions.slice(0, 8)) {
        const center = this.cellCenter(target);
        graphics.lineBetween(origin.x, origin.y, center.x, center.y);
        graphics.strokeCircle(center.x, center.y, this.tileSize * 0.28);
      }
    } else {
      graphics.lineStyle(4, 0xf15bd7, 0.88);
      graphics.strokeCircle(origin.x, origin.y, this.tileSize * 0.65);
      graphics.strokeRoundedRect(this.boardBounds.x + 5, this.boardBounds.y + 5, this.boardBounds.width - 10, this.boardBounds.height - 10, 12);
    }

    this.tweens.add({
      targets: graphics,
      alpha: 0,
      duration: motionTiming.powerUpEffect,
      ease: "Sine.easeOut",
      onComplete: () => graphics.destroy()
    });
  }

  private flashCell(position: GridPosition, color: number, duration: number): void {
    if (!this.fxLayer || !this.snapshot?.grid.isValid(position)) return;
    const topLeft = this.cellTopLeft(position);
    const pulse = this.add.graphics();
    pulse.lineStyle(3, color, 0.95);
    pulse.strokeRoundedRect(topLeft.x + 7, topLeft.y + 7, this.tileSize - 14, this.tileSize - 14, Math.max(6, this.tileSize * 0.1));
    this.fxLayer.add(pulse);
    this.tweens.add({
      targets: pulse,
      alpha: 0,
      scaleX: 1.14,
      scaleY: 1.14,
      duration,
      ease: "Sine.easeOut",
      onComplete: () => pulse.destroy()
    });
  }

  private addOccupant(position: GridPosition, cell: CellState, targetLayer: Phaser.GameObjects.Container, alpha: number): Phaser.GameObjects.Container | null {
    const center = this.cellCenter(position);
    return this.addOccupantAt(center.x, center.y, cell, targetLayer, alpha);
  }

  private installDomPointerHandlers(): void {
    const canvas = this.game.canvas;
    const down = (event: PointerEvent) => {
      if (this.activePointerId !== null || !event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
      const pointer = this.pointerFromDomEvent(event);
      if (this.pendingBooster) {
        const didTarget = this.activateBoosterAtPointer(this.pendingBooster, pointer);
        if (didTarget) event.preventDefault();
        return;
      }
      const didStart = this.handlePointerDown(pointer);
      if (!didStart) return;
      this.activePointerId = event.pointerId;
      event.preventDefault();
      this.setDomPointerCapture(canvas, event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (this.activePointerId !== event.pointerId) return;
      event.preventDefault();
      this.handlePointerMove(this.pointerFromDomEvent(event));
    };
    const up = (event: PointerEvent) => {
      if (this.activePointerId !== event.pointerId) return;
      this.activePointerId = null;
      event.preventDefault();
      this.releaseDomPointerCapture(canvas, event.pointerId);
      this.handlePointerUp(this.pointerFromDomEvent(event));
    };
    const cancel = (event: PointerEvent) => {
      if (this.activePointerId !== event.pointerId) return;
      this.activePointerId = null;
      this.releaseDomPointerCapture(canvas, event.pointerId);
      if (this.drag && !this.drag.committed) this.snapBackDrag(this.drag);
    };

    this.domPointerHandlers = { cancel, down, move, up };
    canvas.addEventListener("pointerdown", down, { passive: false });
    canvas.addEventListener("pointermove", move, { passive: false });
    canvas.addEventListener("pointerup", up, { passive: false });
    canvas.addEventListener("pointercancel", cancel, { passive: false });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.removeDomPointerHandlers());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.removeDomPointerHandlers());
  }

  private setDomPointerCapture(canvas: HTMLCanvasElement, pointerId: number): void {
    try {
      canvas.setPointerCapture?.(pointerId);
    } catch {
      // Synthetic test events do not always create an active browser pointer.
    }
  }

  private releaseDomPointerCapture(canvas: HTMLCanvasElement, pointerId: number): void {
    try {
      canvas.releasePointerCapture?.(pointerId);
    } catch {
      // Pointer capture may already be gone after cancellation or synthetic input.
    }
  }

  private removeDomPointerHandlers(): void {
    if (!this.domPointerHandlers) return;
    const canvas = this.game.canvas;
    canvas.removeEventListener("pointerdown", this.domPointerHandlers.down);
    canvas.removeEventListener("pointermove", this.domPointerHandlers.move);
    canvas.removeEventListener("pointerup", this.domPointerHandlers.up);
    canvas.removeEventListener("pointercancel", this.domPointerHandlers.cancel);
    this.domPointerHandlers = null;
    this.activePointerId = null;
  }

  private pointerFromDomEvent(event: PointerEvent): BoardPointer {
    return this.pointerFromClientPoint(event.clientX, event.clientY);
  }

  private pointerFromClientPoint(clientX: number, clientY: number): BoardPointer {
    const rect = this.game.canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / Math.max(1, rect.width)) * this.scale.width,
      y: ((clientY - rect.top) / Math.max(1, rect.height)) * this.scale.height
    };
  }

  private addOccupantAt(x: number, y: number, cell: CellState, targetLayer: Phaser.GameObjects.Container, alpha: number): Phaser.GameObjects.Container | null {
    const inset = Math.max(4, this.tileSize * 0.07);
    const container = this.add.container(x, y);
    container.setAlpha(alpha);

    if (cell.baseTile) {
      const object = this.makeSpriteOrLabel(tileImageKeys[cell.baseTile], this.tileSize - inset * 2, tileLabel(cell.baseTile));
      container.add(object);
    } else if (cell.powerUp) {
      const key = imageKeyForPowerUp(cell.powerUp);
      const object = this.makeSpriteOrLabel(key, this.tileSize - inset * 1.5, powerUpLabel(cell.powerUp));
      container.add(object);
    } else if (cell.generator) {
      const label = this.makeLabel("H", "#ff8bd6", Math.floor(this.tileSize * 0.5));
      container.add(label);
    } else {
      container.destroy();
      return null;
    }

    targetLayer.add(container);
    return container;
  }

  private makeSpriteOrLabel(textureKey: string, size: number, fallback: string): Phaser.GameObjects.Image | Phaser.GameObjects.Text {
    if (this.textures.exists(textureKey)) {
      const image = this.add.image(0, 0, textureKey);
      const scale = Math.min(size / Math.max(1, image.width), size / Math.max(1, image.height));
      image.setScale(scale);
      return image;
    }
    return this.makeLabel(fallback, "#f0fbff", Math.floor(size * 0.42));
  }

  private makeLabel(text: string, color: string, size: number): Phaser.GameObjects.Text {
    const label = this.add.text(0, 0, text, {
      color,
      fontFamily: "Inter, system-ui, sans-serif",
      fontStyle: "700",
      fontSize: `${size}px`
    });
    label.setOrigin(0.5);
    return label;
  }

  private addLabel(text: string, x: number, y: number, color: string, size: number, targetLayer: Phaser.GameObjects.Container): void {
    const label = this.makeLabel(text, color, size);
    label.setPosition(x, y);
    targetLayer.add(label);
  }

  // --- Drag lifecycle (single source of truth) ------------------------------

  private handlePointerDown(pointer: BoardPointer): boolean {
    if (!this.snapshot || !this.layer) return false;
    // Ignore new gestures while a committed swap is still settling/resolving.
    if (this.drag) return false;
    const position = this.positionForPointer(pointer.x, pointer.y);
    if (!position) return false;
    const cell = this.snapshot.grid.get(position);
    if (!canDragCell(cell)) {
      this.playBlockedCellFeedback(position, cell);
      return false;
    }
    const sprite = this.occupantNodes.get(positionKey(position));
    if (!sprite) return false;

    this.layer.bringToTop(sprite);
    sprite.setScale(1.06);
    this.drag = {
      start: position,
      startCenter: this.cellCenter(position),
      pointerStart: { x: pointer.x, y: pointer.y },
      sprite,
      axis: null,
      offset: { x: 0, y: 0 },
      neighbor: null,
      blockedMarker: null,
      blockedKey: null,
      committed: false
    };
    return true;
  }

  private handlePointerMove(pointer: BoardPointer): void {
    const drag = this.drag;
    if (!drag || drag.committed || !this.snapshot) return;
    const intent = this.dragIntentForActive(pointer, drag);
    drag.offset = intent.offset;

    const wantKey = intent.previewTarget ? positionKey(intent.previewTarget) : null;
    const haveKey = drag.neighbor ? positionKey(drag.neighbor.position) : null;
    if (wantKey !== haveKey) {
      if (drag.neighbor) {
        drag.neighbor.sprite.setPosition(drag.neighbor.home.x, drag.neighbor.home.y);
        drag.neighbor = null;
      }
      if (intent.previewTarget && wantKey) {
        const sprite = this.occupantNodes.get(wantKey);
        if (sprite) {
          drag.neighbor = { position: intent.previewTarget, sprite, home: this.cellCenter(intent.previewTarget) };
          this.layer?.bringToTop(sprite);
          this.layer?.bringToTop(drag.sprite);
        }
      }
    }

    this.updateBlockedMarker(intent.blockedTarget);
    this.positionDragSprites();
  }

  private handlePointerUp(pointer: BoardPointer): void {
    const drag = this.drag;
    if (!drag || drag.committed || !this.onAction) return;
    const intent = this.dragIntentForActive(pointer, drag);

    if (intent.canCommit && intent.commitTarget) {
      this.commitSwap(drag, intent.commitTarget);
      this.onAction({ kind: "swap", from: drag.start, to: intent.commitTarget });
      return;
    }

    const cell = this.snapshot?.grid.get(drag.start);
    const movedDistance = Phaser.Math.Distance.Between(pointer.x, pointer.y, drag.pointerStart.x, drag.pointerStart.y);
    if (cell?.powerUp && movedDistance < this.tileSize * 0.16) {
      this.releaseDrag(drag);
      this.onAction({ kind: "tap", at: drag.start });
      return;
    }

    if (intent.blockedTarget) this.playBlockedCellFeedback(intent.blockedTarget, this.snapshot!.grid.get(intent.blockedTarget));
    this.snapBackDrag(drag);
  }

  // Commit optimistically: the lifted sprite and its partner tween to the
  // swapped centers. The engine round-trip then confirms (match -> continue from
  // these exact positions) or rejects (invalid -> snap back). No fixed-delay
  // fallback; the resolve event drives the handoff.
  private commitSwap(drag: ActiveDrag, target: GridPosition): void {
    drag.committed = true;
    drag.blockedMarker?.destroy();
    drag.blockedMarker = null;
    this.commitSettled = false;
    this.selected = null;

    if (!drag.neighbor || !positionsEqual(drag.neighbor.position, target)) {
      const sprite = this.occupantNodes.get(positionKey(target));
      drag.neighbor = sprite ? { position: target, sprite, home: this.cellCenter(target) } : null;
    }
    if (drag.neighbor) {
      this.layer?.bringToTop(drag.neighbor.sprite);
      this.layer?.bringToTop(drag.sprite);
    }

    const spriteTo = this.cellCenter(target);
    const neighborTo = this.cellCenter(drag.start);
    const neighbor = drag.neighbor;

    const onSettle = () => {
      this.commitSettled = true;
      drag.sprite.setScale(1);
      const cb = this.pendingCommitCb;
      this.pendingCommitCb = null;
      if (cb) cb();
    };

    if (this.reducedMotion) {
      drag.sprite.setPosition(spriteTo.x, spriteTo.y);
      drag.sprite.setScale(1);
      if (neighbor) neighbor.sprite.setPosition(neighborTo.x, neighborTo.y);
      onSettle();
      return;
    }

    let remaining = neighbor ? 2 : 1;
    const done = () => {
      remaining -= 1;
      if (remaining === 0) onSettle();
    };
    this.tweens.add({
      targets: drag.sprite,
      x: spriteTo.x,
      y: spriteTo.y,
      scaleX: 1,
      scaleY: 1,
      duration: motionTiming.swap,
      ease: "Back.easeOut",
      easeParams: swapEaseParams,
      onComplete: done
    });
    if (neighbor) {
      this.tweens.add({
        targets: neighbor.sprite,
        x: neighborTo.x,
        y: neighborTo.y,
        duration: motionTiming.swap,
        ease: "Back.easeOut",
        easeParams: swapEaseParams,
        onComplete: done
      });
    }
  }

  // Drag the real occupant sprite 1:1 with the finger (no lerp -> zero
  // rubber-banding, frame-rate independent). The partner mirrors the offset.
  private positionDragSprites(): void {
    const drag = this.drag;
    if (!drag) return;
    drag.sprite.setPosition(drag.startCenter.x + drag.offset.x, drag.startCenter.y + drag.offset.y);
    if (drag.neighbor) {
      drag.neighbor.sprite.setPosition(drag.neighbor.home.x - drag.offset.x, drag.neighbor.home.y - drag.offset.y);
    }
  }

  private dragIntentForActive(pointer: BoardPointer, drag: ActiveDrag): DragIntent {
    const dx = pointer.x - drag.pointerStart.x;
    const dy = pointer.y - drag.pointerStart.y;
    if (!drag.axis && Math.max(Math.abs(dx), Math.abs(dy)) >= 4) {
      drag.axis = Math.abs(dx) >= Math.abs(dy) ? "horizontal" : "vertical";
    }
    return this.intentFromDelta(dx, dy, drag.start, drag.axis);
  }

  private intentFromDelta(dx: number, dy: number, start: GridPosition, lockedAxis: DragAxis | null): DragIntent {
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const freeDistance = Math.max(absX, absY);
    const axis = lockedAxis ?? (freeDistance >= 3 ? (absX >= absY ? "horizontal" : "vertical") : null);
    if (!axis) {
      const maxFreeOffset = this.tileSize * 0.15;
      const scale = freeDistance > maxFreeOffset ? maxFreeOffset / freeDistance : 1;
      return {
        axis,
        blockedTarget: null,
        canCommit: false,
        commitTarget: null,
        offset: { x: dx * scale, y: dy * scale },
        previewTarget: null,
        targetOffset: { x: 0, y: 0 },
        travel: 0
      };
    }

    const rawTravel = axis === "horizontal" ? dx : dy;
    const sign = rawTravel > 0 ? 1 : rawTravel < 0 ? -1 : 0;
    const target = sign === 0
      ? null
      : axis === "horizontal"
        ? { row: start.row, col: start.col + sign }
        : { row: start.row + sign, col: start.col };
    const commitTarget = target && this.snapshot?.grid.isValid(target) ? target : null;
    const previewTarget = commitTarget && canPreviewTarget(this.snapshot!.grid.get(commitTarget)) ? commitTarget : null;
    const blockedTarget = commitTarget && !previewTarget ? commitTarget : null;
    const travel = previewTarget
      ? Phaser.Math.Clamp(rawTravel, -this.tileSize, this.tileSize)
      : Math.sign(rawTravel) * Math.min(Math.abs(rawTravel) * 0.38, this.tileSize * 0.24);
    const threshold = this.tileSize * 0.32;
    const offset = axis === "horizontal" ? { x: travel, y: 0 } : { x: 0, y: travel };

    return {
      axis,
      blockedTarget,
      canCommit: Boolean(previewTarget && Math.abs(rawTravel) >= threshold),
      commitTarget: previewTarget,
      offset,
      previewTarget,
      targetOffset: previewTarget ? { x: -offset.x, y: -offset.y } : { x: 0, y: 0 },
      travel
    };
  }

  private updateBlockedMarker(position: GridPosition | null): void {
    const drag = this.drag;
    if (!drag || !this.fxLayer) return;
    const nextKey = position ? positionKey(position) : null;
    if (drag.blockedKey === nextKey) return;
    drag.blockedMarker?.destroy();
    drag.blockedMarker = null;
    drag.blockedKey = nextKey;
    if (!position) return;

    const topLeft = this.cellTopLeft(position);
    const marker = this.add.graphics();
    marker.lineStyle(3, 0xff4968, 0.92);
    marker.strokeRoundedRect(topLeft.x + 7, topLeft.y + 7, this.tileSize - 14, this.tileSize - 14, Math.max(6, this.tileSize * 0.1));
    marker.fillStyle(0xff4968, 0.12);
    marker.fillRoundedRect(topLeft.x + 7, topLeft.y + 7, this.tileSize - 14, this.tileSize - 14, Math.max(6, this.tileSize * 0.1));
    this.fxLayer.add(marker);
    drag.blockedMarker = marker;
  }

  private snapBackDrag(drag: ActiveDrag): void {
    drag.blockedMarker?.destroy();
    drag.blockedMarker = null;
    const neighbor = drag.neighbor;
    this.drag = null;
    this.selected = null;
    this.commitSettled = false;
    this.pendingCommitCb = null;

    const finish = () => this.renderSnapshot();
    if (this.reducedMotion) {
      finish();
      return;
    }
    let remaining = neighbor ? 2 : 1;
    const done = () => {
      remaining -= 1;
      if (remaining === 0) finish();
    };
    this.tweens.add({
      targets: drag.sprite,
      x: drag.startCenter.x,
      y: drag.startCenter.y,
      scaleX: 1,
      scaleY: 1,
      duration: motionTiming.snapBack,
      ease: "Sine.easeOut",
      onComplete: done
    });
    if (neighbor) {
      this.tweens.add({
        targets: neighbor.sprite,
        x: neighbor.home.x,
        y: neighbor.home.y,
        duration: motionTiming.snapBack,
        ease: "Sine.easeOut",
        onComplete: done
      });
    }
  }

  private releaseDrag(drag: ActiveDrag): void {
    this.tweens.killTweensOf(drag.sprite);
    if (drag.neighbor) this.tweens.killTweensOf(drag.neighbor.sprite);
    drag.blockedMarker?.destroy();
    this.drag = null;
    this.selected = null;
    this.commitSettled = false;
    this.pendingCommitCb = null;
    this.renderSnapshot();
  }

  private hardClearDrag(): void {
    const drag = this.drag;
    if (drag) {
      this.tweens.killTweensOf(drag.sprite);
      if (drag.neighbor) this.tweens.killTweensOf(drag.neighbor.sprite);
      drag.blockedMarker?.destroy();
    }
    this.drag = null;
    this.selected = null;
    this.commitSettled = false;
    this.pendingCommitCb = null;
  }

  private activateBoosterAtPointer(booster: BoosterType, pointer: BoardPointer): boolean {
    if (!this.snapshot || !this.onAction) return false;
    const position = this.positionForPointer(pointer.x, pointer.y);
    if (!position) return false;
    const cell = this.snapshot.grid.get(position);
    if (!canTargetBooster(cell)) {
      this.playBlockedCellFeedback(position, cell);
      return false;
    }
    if (this.drag) this.releaseDrag(this.drag);
    this.flashCell(position, 0xf7d154, 180);
    this.onAction({ kind: "activateBooster", booster, at: position });
    return true;
  }

  private playBlockedCellFeedback(position: GridPosition, cell: CellState): void {
    if (!this.fxLayer || !this.snapshot?.grid.isValid(position)) return;
    this.flashCell(position, 0xff4968, motionTiming.blockedFlash);
    const ghost = this.addOccupant(position, cell, this.fxLayer, 0.82);
    if (!ghost) return;
    const center = this.cellCenter(position);
    this.tweens.add({
      targets: ghost,
      alpha: 0.15,
      x: center.x + this.tileSize * 0.055,
      duration: motionTiming.blockedJiggle,
      ease: "Sine.easeOut",
      repeat: 1,
      yoyo: true,
      onComplete: () => ghost.destroy()
    });
  }

  private updateGeometry(): void {
    if (!this.snapshot) return;
    const cols = this.snapshot.grid.cols;
    const rows = this.snapshot.grid.rows;
    const width = this.scale.width;
    const height = this.scale.height;
    const maxBoard = Math.min(width - 24, height - 24);
    this.tileSize = Math.max(32, Math.floor(maxBoard / Math.max(rows, cols)));
    this.boardBounds.setTo(
      (width - this.tileSize * cols) / 2,
      (height - this.tileSize * rows) / 2,
      this.tileSize * cols,
      this.tileSize * rows
    );
  }

  private cellTopLeft(position: GridPosition): { x: number; y: number } {
    return {
      x: this.boardBounds.x + position.col * this.tileSize,
      y: this.boardBounds.y + position.row * this.tileSize
    };
  }

  private cellCenter(position: GridPosition): { x: number; y: number } {
    const topLeft = this.cellTopLeft(position);
    return {
      x: topLeft.x + this.tileSize / 2,
      y: topLeft.y + this.tileSize / 2
    };
  }

  private positionForPointer(x: number, y: number): GridPosition | null {
    if (!this.snapshot || !this.boardBounds.contains(x, y)) return null;
    const col = Math.floor((x - this.boardBounds.x) / this.tileSize);
    const row = Math.floor((y - this.boardBounds.y) / this.tileSize);
    const position = { row, col };
    return this.snapshot.grid.isValid(position) ? position : null;
  }
}

function hiddenPositionsFor(action: BoardAction): Set<string> {
  if (action.kind !== "swap") return new Set();
  return new Set([positionKey(action.from), positionKey(action.to)]);
}

function visualSnapshotAfterSwap(snapshot: BoardSnapshot, action: Extract<BoardAction, { kind: "swap" }>): BoardSnapshot {
  const grid = snapshot.grid.clone(cloneCell);
  if (grid.isValid(action.from) && grid.isValid(action.to)) grid.swap(action.from, action.to);
  return {
    ...snapshot,
    grid
  };
}

function initialMatchKeys(snapshot: BoardSnapshot): Set<string> {
  const keys = new Set<string>();
  for (const group of detectMatches(snapshot.grid)) {
    for (const key of group.positions) keys.add(key);
  }
  return keys;
}

function emptyVisualCell(tileType: TileType): CellState {
  return {
    baseTile: tileType,
    powerUp: null,
    overlay: null,
    underlay: null,
    generator: null,
    isMovable: true,
    debugTileId: null,
    debugDesignLocked: false
  };
}

function canDragCell(cell: CellState): boolean {
  return cell.isMovable && !cell.generator && Boolean(cell.baseTile || cell.powerUp);
}

function canPreviewTarget(cell: CellState): boolean {
  return cell.isMovable && !cell.generator && Boolean(cell.baseTile || cell.powerUp);
}

function canTargetBooster(cell: CellState): boolean {
  return cell.isMovable && !cell.generator && Boolean(cell.baseTile || cell.powerUp);
}

function positionKey(position: GridPosition): string {
  return `${position.row},${position.col}`;
}

function positionsEqual(a: GridPosition, b: GridPosition): boolean {
  return a.row === b.row && a.col === b.col;
}

function imageKeyForPowerUp(powerUp: PowerUpType): string {
  const serialized = serializePowerUp(powerUp);
  if (serialized === "rocket_h") return powerUpImageKeys.rocket_horizontal;
  if (serialized === "rocket_v") return powerUpImageKeys.rocket_vertical;
  return powerUpImageKeys[powerUpKey(powerUp) as keyof typeof powerUpImageKeys];
}

function tileLabel(tile: TileType): string {
  return {
    packet: "P",
    firewall: "F",
    key: "K",
    threat: "T",
    zeroDay: "Z"
  }[tile];
}

function powerUpLabel(powerUp: PowerUpType): string {
  if (powerUp.kind === "rocket") return powerUp.orientation === "horizontal" ? "R>" : "R^";
  if (powerUp.kind === "propeller") return "*";
  if (powerUp.kind === "tnt") return "TNT";
  return "LB";
}
