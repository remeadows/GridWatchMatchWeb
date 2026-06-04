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

export interface BoardSceneData {
  onAction: (action: BoardAction) => void;
}

export type BoardAnimationEvent =
  | { id: number; kind: "resolved"; action: BoardAction; delta: BoardDelta }
  | { id: number; kind: "invalid"; action: BoardAction };

type DragAxis = "horizontal" | "vertical";

interface DragPreview {
  axis: DragAxis | null;
  blockedMarker: Phaser.GameObjects.Graphics | null;
  currentOffset: { x: number; y: number };
  desiredOffset: { x: number; y: number };
  ghost: Phaser.GameObjects.Container;
  lastBlockedKey: string | null;
  start: GridPosition;
  startCenter: { x: number; y: number };
  startPointer: { x: number; y: number };
  targetGhost: Phaser.GameObjects.Container | null;
  targetKey: string | null;
  targetPosition: GridPosition | null;
  targetOffset: { x: number; y: number };
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
  cascadeMove: 340,
  clearFlash: 300,
  invalidSwap: 170,
  matchLock: 500,
  matchPop: 170,
  matchPopAnticipation: 70,
  powerUpEffect: 560,
  snapBack: 150,
  spawnFlash: 230,
  spawnMove: 390,
  swap: 300
} as const;

export class BoardScene extends Phaser.Scene {
  private snapshot: BoardSnapshot | null = null;
  private onAction: ((action: BoardAction) => void) | null = null;
  private layer: Phaser.GameObjects.Container | null = null;
  private fxLayer: Phaser.GameObjects.Container | null = null;
  private boardBounds = new Phaser.Geom.Rectangle(0, 0, 0, 0);
  private tileSize = 72;
  private activePointerId: number | null = null;
  private domPointerHandlers: DomPointerHandlers | null = null;
  private pointerStart: { position: GridPosition; x: number; y: number } | null = null;
  private dragPreview: DragPreview | null = null;
  private selected: GridPosition | null = null;
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
      this.clearDragPreview(false);
      this.renderSnapshot();
    });
    this.renderSnapshot();
  }

  sync(snapshot: BoardSnapshot, animation?: BoardAnimationEvent | null, reducedMotion = false, pendingBooster: BoosterType | null = null): void {
    this.reducedMotion = reducedMotion;
    this.pendingBooster = pendingBooster;
    this.game.canvas.classList.toggle("booster-targeting", pendingBooster !== null);
    this.clearDragPreview(false);
    if (animation && animation.id > this.lastAnimationId) {
      this.lastAnimationId = animation.id;
      if (animation.kind === "invalid") {
        this.playInvalidAnimation(animation.action);
        return;
      }
      this.playResolvedAnimation(snapshot, animation);
      return;
    }
    this.snapshot = snapshot;
    this.renderSnapshot();
  }

  update(): void {
    if (!this.dragPreview) return;
    this.applyDragPreviewPositions(0.46);
  }

  activateBoosterAtClientPoint(booster: BoosterType, clientX: number, clientY: number): boolean {
    const pointer = this.pointerFromClientPoint(clientX, clientY);
    return this.activateBoosterAtPointer(booster, pointer);
  }

  private renderSnapshot(hiddenPositions = new Set<string>(), clearFx = true): void {
    if (!this.layer || !this.snapshot) return;
    this.layer.removeAll(true);
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
    const center = this.cellCenter(position);
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
      this.addOccupant(position, cell, this.layer, 1);
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

  private playResolvedAnimation(nextSnapshot: BoardSnapshot, animation: Extract<BoardAnimationEvent, { kind: "resolved" }>): void {
    const previousSnapshot = this.snapshot;
    const hidden = hiddenPositionsFor(animation.action);

    if (this.reducedMotion) {
      this.snapshot = nextSnapshot;
      this.renderSnapshot();
      return;
    }

    if (animation.action.kind === "swap" && previousSnapshot) {
      const postSwapSnapshot = visualSnapshotAfterSwap(previousSnapshot, animation.action);
      this.snapshot = previousSnapshot;
      this.renderSnapshot(hidden);
      const ghosts = this.createSwapGhosts(animation.action, previousSnapshot);
      if (ghosts.length > 0) {
        let remaining = ghosts.length;
        const finishSwap = () => {
          this.playPostSwapMatchResolution(postSwapSnapshot, nextSnapshot, animation.delta);
        };
        for (const ghost of ghosts) {
          this.tweens.add({
            targets: ghost.object,
            x: ghost.to.x,
            y: ghost.to.y,
            duration: motionTiming.swap,
            ease: "Sine.easeInOut",
            onComplete: () => {
              ghost.object.destroy();
              remaining -= 1;
              if (remaining === 0) {
                finishSwap();
              }
            }
          });
        }
        return;
      }
      this.playPostSwapMatchResolution(postSwapSnapshot, nextSnapshot, animation.delta);
      return;
    }

    this.snapshot = nextSnapshot;
    this.renderSnapshot();
    this.playDeltaEffects(animation.delta);
  }

  private playPostSwapMatchResolution(postSwapSnapshot: BoardSnapshot, nextSnapshot: BoardSnapshot, delta: BoardDelta): void {
    this.snapshot = postSwapSnapshot;
    this.renderSnapshot();
    const popKeys = initialMatchKeys(postSwapSnapshot);
    this.time.delayedCall(motionTiming.matchLock, () => {
      this.playTilePops(postSwapSnapshot, popKeys, () => {
        this.snapshot = nextSnapshot;
        this.renderSnapshot();
        this.playDeltaEffects(delta, popKeys);
      });
    });
  }

  private playInvalidAnimation(action: BoardAction): void {
    if (action.kind !== "swap" || !this.snapshot || !this.fxLayer) return;
    if (this.reducedMotion) {
      for (const position of [action.from, action.to]) this.flashCell(position, 0xff4968, 160);
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
          if (remaining === 0) this.renderSnapshot();
        }
      });
    }
    if (ghosts.length === 0) this.renderSnapshot();
    for (const position of [action.from, action.to]) {
      this.flashCell(position, 0xff4968, 190);
    }
  }

  private createSwapGhosts(action: Extract<BoardAction, { kind: "swap" }>, sourceSnapshot: BoardSnapshot): { object: Phaser.GameObjects.Container; to: { x: number; y: number } }[] {
    if (!this.fxLayer) return [];
    const ghosts: { object: Phaser.GameObjects.Container; to: { x: number; y: number } }[] = [];
    const pairs = [
      { from: action.from, to: action.to },
      { from: action.to, to: action.from }
    ];
    for (const pair of pairs) {
      if (!sourceSnapshot.grid.isValid(pair.from) || !sourceSnapshot.grid.isValid(pair.to)) continue;
      const cell = sourceSnapshot.grid.get(pair.from);
      const ghost = this.addOccupant(pair.from, cell, this.fxLayer, 1);
      if (!ghost) continue;
      ghosts.push({ object: ghost, to: this.cellCenter(pair.to) });
    }
    return ghosts;
  }

  private playDeltaEffects(delta: BoardDelta, skipClearKeys = new Set<string>()): void {
    if (this.reducedMotion) return;
    for (const event of delta.powerUpEvents) this.playPowerUpEffect(event);
    for (const clear of delta.clears) {
      if (!skipClearKeys.has(positionKey(clear.position))) this.flashCell(clear.position, clear.clearedByPowerUp ? 0x9bfff2 : 0xf7d154, motionTiming.clearFlash);
    }
    for (const move of delta.moves.slice(0, 24)) this.playMoveGhost(move.from, move.to, move.tileType, motionTiming.cascadeMove, 0.82);
    for (const spawn of delta.spawns.slice(0, 24)) {
      const from = { row: -1, col: spawn.position.col };
      this.playMoveGhost(from, spawn.position, spawn.tileType, motionTiming.spawnMove, 0.74);
      this.flashCell(spawn.position, 0x38d9ff, motionTiming.spawnFlash);
    }
  }

  private playTilePops(sourceSnapshot: BoardSnapshot, popKeys: Set<string>, onComplete: () => void): void {
    if (!this.fxLayer || popKeys.size === 0) {
      onComplete();
      return;
    }
    this.snapshot = sourceSnapshot;
    this.renderSnapshot(popKeys);

    const popObjects: Phaser.GameObjects.Container[] = [];
    for (const position of sourceSnapshot.grid.allPositions) {
      if (!popKeys.has(positionKey(position))) continue;
      const ghost = this.addOccupant(position, sourceSnapshot.grid.get(position), this.fxLayer, 1);
      if (!ghost) continue;
      popObjects.push(ghost);
      this.flashCell(position, 0xf7d154, motionTiming.matchPop + motionTiming.matchPopAnticipation);
    }

    if (popObjects.length === 0) {
      onComplete();
      return;
    }

    let remaining = popObjects.length;
    for (const object of popObjects) {
      this.tweens.add({
        targets: object,
        scaleX: 1.18,
        scaleY: 1.18,
        duration: motionTiming.matchPopAnticipation,
        ease: "Back.easeOut",
        onComplete: () => {
          this.tweens.add({
            targets: object,
            alpha: 0,
            scaleX: 0.12,
            scaleY: 0.12,
            angle: object.angle + Phaser.Math.Between(-10, 10),
            duration: motionTiming.matchPop,
            ease: "Back.easeIn",
            onComplete: () => {
              object.destroy();
              remaining -= 1;
              if (remaining === 0) onComplete();
            }
          });
        }
      });
    }
  }

  private playMoveGhost(from: GridPosition, to: GridPosition, tileType: TileType, duration: number, alpha: number): void {
    if (!this.fxLayer) return;
    const start = from.row < 0
      ? { x: this.cellCenter(to).x, y: this.boardBounds.y - this.tileSize * 0.45 }
      : this.cellCenter(from);
    const end = this.cellCenter(to);
    const ghostCell = emptyVisualCell(tileType);
    const ghost = this.addOccupantAt(start.x, start.y, ghostCell, this.fxLayer, alpha);
    if (!ghost) return;
    this.tweens.add({
      targets: ghost,
      x: end.x,
      y: end.y,
      alpha: 0,
      duration,
      ease: "Cubic.easeOut",
      onComplete: () => ghost.destroy()
    });
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
      this.snapBackDragPreview();
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

  private handlePointerDown(pointer: BoardPointer): boolean {
    if (!this.snapshot || !this.fxLayer) return false;
    const position = this.positionForPointer(pointer.x, pointer.y);
    if (!position) return false;
    const cell = this.snapshot.grid.get(position);
    if (!canDragCell(cell)) {
      this.playBlockedCellFeedback(position, cell);
      return false;
    }

    this.clearDragPreview(false);
    this.pointerStart = { position, x: pointer.x, y: pointer.y };
    this.selected = position;
    this.fxLayer.removeAll(true);

    const hidden = new Set([positionKey(position)]);
    this.renderSnapshot(hidden, false);
    const ghost = this.addOccupant(position, cell, this.fxLayer, 1);
    if (!ghost) {
      this.pointerStart = null;
      this.selected = null;
      this.renderSnapshot();
      return false;
    }

    ghost.setScale(1.04);
    this.dragPreview = {
      axis: null,
      blockedMarker: null,
      currentOffset: { x: 0, y: 0 },
      desiredOffset: { x: 0, y: 0 },
      ghost,
      lastBlockedKey: null,
      start: position,
      startCenter: this.cellCenter(position),
      startPointer: { x: pointer.x, y: pointer.y },
      targetGhost: null,
      targetKey: null,
      targetPosition: null,
      targetOffset: { x: 0, y: 0 }
    };
    this.requestImmediateRender();
    return true;
  }

  private handlePointerMove(pointer: BoardPointer): void {
    if (!this.dragPreview || !this.snapshot) return;
    const intent = this.dragIntentFor(pointer, this.dragPreview);
    this.dragPreview.desiredOffset = intent.offset;
    this.dragPreview.targetOffset = intent.targetOffset;
    this.updateTargetPreview(intent);
    this.applyDragPreviewPositions(0.84);
    this.requestImmediateRender();
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
    this.clearDragPreview(false);
    this.flashCell(position, 0xf7d154, 180);
    this.onAction({ kind: "activateBooster", booster, at: position });
    return true;
  }

  private handlePointerUp(pointer: BoardPointer): void {
    if (!this.pointerStart || !this.onAction) return;
    const start = this.pointerStart;
    const intent = this.dragPreview
      ? this.dragIntentFor(pointer, this.dragPreview)
      : this.intentFromDelta(pointer.x - start.x, pointer.y - start.y, start.position, null);
    if (intent.canCommit && intent.commitTarget) {
      this.clearDragPreview(true);
      this.selected = null;
      this.pointerStart = null;
      this.onAction({ kind: "swap", from: start.position, to: intent.commitTarget });
    } else {
      const cell = this.snapshot?.grid.get(start.position);
      const movedDistance = Phaser.Math.Distance.Between(pointer.x, pointer.y, start.x, start.y);
      if (cell?.powerUp && movedDistance < this.tileSize * 0.16) {
        this.clearDragPreview(true);
        this.selected = null;
        this.pointerStart = null;
        this.onAction({ kind: "tap", at: start.position });
      } else {
        if (intent.blockedTarget) this.playBlockedCellFeedback(intent.blockedTarget, this.snapshot!.grid.get(intent.blockedTarget));
        this.snapBackDragPreview();
      }
    }
  }

  private dragIntentFor(pointer: BoardPointer, preview: DragPreview): DragIntent {
    const dx = pointer.x - preview.startPointer.x;
    const dy = pointer.y - preview.startPointer.y;
    if (!preview.axis && Math.max(Math.abs(dx), Math.abs(dy)) >= 4) {
      preview.axis = Math.abs(dx) >= Math.abs(dy) ? "horizontal" : "vertical";
    }
    return this.intentFromDelta(dx, dy, preview.start, preview.axis);
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
      targetOffset: previewTarget ? { x: -offset.x * 0.42, y: -offset.y * 0.42 } : { x: 0, y: 0 },
      travel
    };
  }

  private updateTargetPreview(intent: DragIntent): void {
    if (!this.dragPreview || !this.snapshot || !this.fxLayer) return;
    const previewKey = intent.previewTarget ? positionKey(intent.previewTarget) : null;
    if (previewKey !== this.dragPreview.targetKey) {
      this.dragPreview.targetGhost?.destroy();
      this.dragPreview.targetGhost = null;
      this.dragPreview.targetKey = previewKey;
      this.dragPreview.targetPosition = intent.previewTarget;

      const hidden = new Set([positionKey(this.dragPreview.start)]);
      if (intent.previewTarget) hidden.add(positionKey(intent.previewTarget));
      this.renderSnapshot(hidden, false);

      if (intent.previewTarget) {
        const targetCell = this.snapshot.grid.get(intent.previewTarget);
        this.dragPreview.targetGhost = this.addOccupant(intent.previewTarget, targetCell, this.fxLayer, 0.92);
      }
    }

    this.updateBlockedMarker(intent.blockedTarget);
  }

  private applyDragPreviewPositions(smoothing: number): void {
    const preview = this.dragPreview;
    if (!preview) return;
    preview.currentOffset = {
      x: Phaser.Math.Linear(preview.currentOffset.x, preview.desiredOffset.x, smoothing),
      y: Phaser.Math.Linear(preview.currentOffset.y, preview.desiredOffset.y, smoothing)
    };
    if (Math.abs(preview.currentOffset.x - preview.desiredOffset.x) < 0.18) preview.currentOffset.x = preview.desiredOffset.x;
    if (Math.abs(preview.currentOffset.y - preview.desiredOffset.y) < 0.18) preview.currentOffset.y = preview.desiredOffset.y;
    preview.ghost.setPosition(
      preview.startCenter.x + preview.currentOffset.x,
      preview.startCenter.y + preview.currentOffset.y
    );

    if (preview.targetGhost && preview.targetPosition) {
      const targetCenter = this.cellCenter(preview.targetPosition);
      preview.targetGhost.setPosition(
        targetCenter.x - preview.currentOffset.x * 0.42,
        targetCenter.y - preview.currentOffset.y * 0.42
      );
    }
  }

  private updateBlockedMarker(position: GridPosition | null): void {
    const preview = this.dragPreview;
    if (!preview || !this.fxLayer) return;
    const nextKey = position ? positionKey(position) : null;
    if (preview.lastBlockedKey === nextKey) return;
    preview.blockedMarker?.destroy();
    preview.blockedMarker = null;
    preview.lastBlockedKey = nextKey;
    if (!position) return;

    const topLeft = this.cellTopLeft(position);
    const marker = this.add.graphics();
    marker.lineStyle(3, 0xff4968, 0.92);
    marker.strokeRoundedRect(topLeft.x + 7, topLeft.y + 7, this.tileSize - 14, this.tileSize - 14, Math.max(6, this.tileSize * 0.1));
    marker.fillStyle(0xff4968, 0.12);
    marker.fillRoundedRect(topLeft.x + 7, topLeft.y + 7, this.tileSize - 14, this.tileSize - 14, Math.max(6, this.tileSize * 0.1));
    this.fxLayer.add(marker);
    preview.blockedMarker = marker;
  }

  private clearDragPreview(render = false): void {
    if (!this.dragPreview) {
      this.pointerStart = null;
      this.activePointerId = null;
      this.selected = null;
      if (render) {
        this.renderSnapshot();
        this.requestImmediateRender();
      }
      return;
    }
    this.tweens.killTweensOf(this.dragPreview.ghost);
    if (this.dragPreview.targetGhost) this.tweens.killTweensOf(this.dragPreview.targetGhost);
    if (this.dragPreview.blockedMarker) this.tweens.killTweensOf(this.dragPreview.blockedMarker);
    this.dragPreview.ghost.destroy();
    this.dragPreview.targetGhost?.destroy();
    this.dragPreview.blockedMarker?.destroy();
    this.dragPreview = null;
    this.pointerStart = null;
    this.activePointerId = null;
    this.selected = null;
    if (render) this.renderSnapshot();
    if (render) this.requestImmediateRender();
  }

  private snapBackDragPreview(): void {
    const preview = this.dragPreview;
    if (!preview) {
      this.pointerStart = null;
      this.selected = null;
      this.renderSnapshot();
      this.requestImmediateRender();
      return;
    }

    this.dragPreview = null;
    this.pointerStart = null;
    this.activePointerId = null;
    preview.targetGhost?.destroy();
    preview.blockedMarker?.destroy();
    this.tweens.killTweensOf(preview.ghost);

    if (this.reducedMotion) {
      preview.ghost.destroy();
      this.selected = null;
      this.renderSnapshot();
      this.requestImmediateRender();
      return;
    }

    this.tweens.add({
      targets: preview.ghost,
      x: preview.startCenter.x,
      y: preview.startCenter.y,
      duration: motionTiming.snapBack,
      ease: "Sine.easeOut",
      onComplete: () => {
        preview.ghost.destroy();
        this.selected = null;
        this.renderSnapshot();
        this.requestImmediateRender();
      }
    });
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

  private requestImmediateRender(): void {
    if (!this.game.loop.running) this.game.loop.wake();
    this.game.loop.tick();
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
