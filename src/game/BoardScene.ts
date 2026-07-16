import Phaser from "phaser";
import { assetManifest, assetUrl } from "../data/assets";
import type { PresentationAudioKey } from "../data/presentationAssets";
import { WIN_ROW_DESTRUCTION_POP_MS, WIN_ROW_DESTRUCTION_STAGGER_MS } from "../data/gameplayTiming";
import {
  CASCADE_FALL_MAX_MS,
  CASCADE_LANDING_SETTLE_MS,
  CASCADE_LANDING_SQUASH_MS,
  CASCADE_START_AFTER_IMPACT_MS,
  DRAG_LIFT_MS,
  MATCH_AFTERIMAGE_MS,
  MATCH_COLORED_DEBRIS_COUNT,
  MATCH_DEBRIS_CLEANUP_MS,
  MATCH_DEBRIS_LIFESPAN_MS,
  MATCH_IMPACT_MS,
  MATCH_POP_COMPRESSION_MS,
  MATCH_RECOGNITION_HOLD_MS,
  MATCH_SHAKE_DURATION_MS,
  MATCH_SHAKE_STRONG_INTENSITY,
  MATCH_SHAKE_STRONG_THRESHOLD_TILES,
  MATCH_SHAKE_WEAK_INTENSITY,
  MATCH_SHAKE_WEAK_THRESHOLD_TILES,
  MATCH_SMOKE_PUFF_COUNT,
  MATCH_WAVE_MAX_MS,
  MATCH_WAVE_PER_GRID_MS,
  SWAP_SETTLE_MS,
  SWAP_TRAVEL_MS,
  TNT_CASCADE_AFTER_DETONATION_MS
} from "../data/presentationTiming";
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
import { buildPostClearSnapshot, cascadeHiddenDestinations, clearedKeysFromDelta, computeCentroidStagger, orderCascadeMoves, quadraticFlightPath, radialStagger, resolvedPopKeys, rowDestructionOrder, seededAngleJitter, sweepStagger, winSequenceDurationMs } from "./motion";
import { cascadeFallDurationMs, createdPowerUpSpawns, groupPowerUpEvents, pieceDisplayProfile, tilePopVariation, tntDetonationPlan, type CreatedPowerUpSpawn, type PresentationTraceEntry } from "./presentation";
import { audioService, type BoardAudioPlayback } from "../services/audio";
import { boardDimmer, burst, ensureVfxTextures, impactBurst, laneBlast, screenFlash, shake, shockwave, VfxCleanupRegistry, vfxTextureKeys } from "./vfx";
import { VFX_TIMING } from "./vfxTiming";

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

const tileVfxTints: Record<TileType, number> = {
  packet: 0x37d9ff,
  firewall: 0xffa02e,
  key: 0xa7ff6b,
  threat: 0xff3f6e,
  zeroDay: 0xded2ff
};

const boardChrome = {
  fill: 0x030b13,
  fillAlpha: 0.95,
  stroke: 0x28d6ff,
  strokeAlpha: 0.32,
  movableCell: 0x173a52,
  movableCellAlpha: 0.78,
  blockedCell: 0x172331,
  blockedCellAlpha: 0.92,
  generatorCell: 0x4a2643,
  generatorCellAlpha: 0.9,
  movableStroke: 0x5aa3c8,
  movableStrokeAlpha: 0.4,
  blockedStroke: 0x556877,
  blockedStrokeAlpha: 0.65
} as const;

const powerUpImageKeys = {
  rocket_horizontal: "powerup-rocketH",
  rocket_vertical: "powerup-rocketV",
  propeller: "powerup-propeller",
  tnt: "powerup-tnt",
  lightBall: "powerup-lightBall"
} as const;

const CASCADE_BOUNCE_MAX_PX = 14;
const CASCADE_BOUNCE_FACTOR = 0.08;
const CASCADE_SQUASH_SCALE_X = 0.96;
const CASCADE_SQUASH_SCALE_Y = 1.05;
const POWERUP_CREATION_CHARGE_MS = 70;
const POWERUP_CREATION_OVERSHOOT_MS = 130;
const POWERUP_CREATION_SETTLE_MS = 110;
const POWERUP_CREATION_INITIAL_SCALE = 0.55;
const POWERUP_CREATION_OVERSHOOT_SCALE = 1.12;

// Matched tiles burst OUTWARD (explode) rather than shrinking away. The destroy
// tween scales up past the cell while fading to alpha 0.
const MATCH_BURST_SCALE = 1.7;
const MATCH_BURST_PARTICLE_COUNT = 10;
const MATCH_BURST_SPEED_TILE_FACTOR = 2.4;
const MATCH_BURST_LIFESPAN_MS = 260;
const MATCH_BURST_MIN_PARTICLE_SCALE = 0.35;
const MATCH_BURST_PARTICLE_SCALE_TILE_DIVISOR = 140;
const WIN_ROW_SHAKE_INTENSITY = 0.004;
const WIN_FINAL_SHAKE_INTENSITY = 0.007;
const WIN_ROW_SHAKE_DURATION_MS = 130;
const WIN_FINAL_BURST_PARTICLE_COUNT = 30;
const WIN_TILE_BURST_PARTICLE_COUNT = 9;

// Mirrors iOS BoardNode.swift springyReturnAction stretch phase.
const INVALID_SWAP_OVERSHOOT_FACTOR = 0.025;
// iOS source: BoardNode.swift springyReturnAction squash scale.
const INVALID_SWAP_SQUASH_SCALE = 0.94;

// Animation durations and easing must match ../GridWatchMatch/ iOS source
// unless explicitly marked Web-only tuning below.
// Web-only tuning: Phaser TNT fuse anticipation.
const TNT_FUSE_MS = 120;
// Web-only tuning: Phaser TNT radial pop wave.
const TNT_RADIAL_STAGGER_MS = 22;
// Web-only tuning: Phaser TNT radial delay cap.
const TNT_RADIAL_STAGGER_MAX_MS = 120;
// Web-only tuning: Phaser TNT shockwave duration.
const TNT_SHOCKWAVE_MS = 320;
// Web-only tuning: visual radius matches TNT clear footprint.
const TNT_BLAST_RADIUS_CELLS = 2;
// Web-only tuning: Phaser TNT spark burst lifespan.
const TNT_SPARK_BURST_LIFESPAN_MS = 340;
// Web-only tuning: Phaser TNT shard burst lifespan.
const TNT_SHARD_BURST_LIFESPAN_MS = 420;
// Web-only tuning: Phaser TNT choreography budget, including particle cleanup tails.
const TNT_FX_BUDGET_MS = TNT_FUSE_MS + Math.max(
  TNT_SHOCKWAVE_MS,
  TNT_SPARK_BURST_LIFESPAN_MS + VFX_TIMING.EMITTER_CLEANUP_BUFFER_MS,
  TNT_SHARD_BURST_LIFESPAN_MS + VFX_TIMING.EMITTER_CLEANUP_BUFFER_MS
);
// Web-only tuning: Phaser camera shake intensity.
const TNT_SHAKE_INTENSITY = 0.008;
// Web-only tuning: Phaser camera shake duration.
const TNT_SHAKE_DURATION_MS = 220;
// Web-only tuning: Phaser rocket pass timing.
const ROCKET_SWEEP_MS_PER_CELL = 58;
// Web-only tuning: maximum expected board edge distance for rocket travel.
const ROCKET_MAX_FLIGHT_CELLS = 7;
// Web-only tuning: Phaser minimum projectile travel.
const ROCKET_MIN_FLIGHT_MS = 120;
// Web-only tuning: Phaser rocket sprite scale.
const ROCKET_HEAD_SCALE = 0.58;
// Web-only tuning: Phaser rocket trail particle lifespan.
const ROCKET_TRAIL_LIFESPAN_MS = 240;
// Web-only tuning: Phaser rocket trail cleanup buffer.
const ROCKET_TRAIL_CLEANUP_MS = 90;
// Web-only tuning: Phaser rocket edge burst lifespan.
const ROCKET_EDGE_BURST_LIFESPAN_MS = 220;
// Web-only tuning: Phaser rocket choreography budget, including edge burst cleanup tails.
const ROCKET_FX_BUDGET_MS =
  ROCKET_MAX_FLIGHT_CELLS * ROCKET_SWEEP_MS_PER_CELL +
  ROCKET_EDGE_BURST_LIFESPAN_MS +
  VFX_TIMING.EMITTER_CLEANUP_BUFFER_MS;
// Web-only tuning: Phaser camera shake intensity.
const ROCKET_SHAKE_INTENSITY = 0.0045;
// Web-only tuning: Phaser camera shake duration.
const ROCKET_SHAKE_DURATION_MS = 120;
// Web-only tuning: Phaser drone lift anticipation.
const PROPELLER_LIFT_MS = 120;
// Web-only tuning: Phaser drone arc flight.
const PROPELLER_FLIGHT_MS = 450;
// Web-only tuning: Phaser drone rotor loop.
const PROPELLER_SPIN_MS = 150;
// Web-only tuning: Phaser propeller sprite scale.
const PROPELLER_DRONE_SCALE = 0.74;
// Web-only tuning: Phaser quadratic arc height.
const PROPELLER_ARC_LIFT_CELLS = 2.1;
// Web-only tuning: Phaser arc sampling resolution.
const PROPELLER_ARC_SAMPLES = 12;
// Web-only tuning: Phaser secondary pop wave.
const PROPELLER_SECONDARY_STAGGER_MS = 30;
// Web-only tuning: Phaser secondary delay cap.
const PROPELLER_SECONDARY_STAGGER_MAX_MS = 120;
// Web-only tuning: Phaser impact shockwave duration.
const PROPELLER_IMPACT_SHOCKWAVE_MS = 220;
// Web-only tuning: Phaser impact spark burst lifespan.
const PROPELLER_IMPACT_BURST_LIFESPAN_MS = 260;
// Web-only tuning: Phaser propeller choreography budget, including impact particle cleanup tail.
const PROPELLER_FX_BUDGET_MS = PROPELLER_LIFT_MS + PROPELLER_FLIGHT_MS + Math.max(
  PROPELLER_IMPACT_SHOCKWAVE_MS,
  PROPELLER_IMPACT_BURST_LIFESPAN_MS + VFX_TIMING.EMITTER_CLEANUP_BUFFER_MS
);
// Web-only tuning: Phaser lightBall charge anticipation.
const LIGHTBALL_CHARGE_MS = 140;
// Web-only tuning: Phaser zap target cadence.
const LIGHTBALL_ZAP_STAGGER_MS = 26;
// Web-only tuning: Phaser lightning segment lifespan.
const LIGHTBALL_ZAP_LIFESPAN_MS = 170;
// Web-only tuning: Phaser deterministic lightning jitter.
const LIGHTBALL_ZAP_JITTER_PX = 12;
// Web-only tuning: Phaser final board shockwave.
const LIGHTBALL_FULL_SHOCKWAVE_MS = 340;
// Web-only tuning: Phaser zap delay cap.
const LIGHTBALL_TARGET_STAGGER_MAX_MS = 180;
// Web-only tuning: Phaser zap impact burst lifespan.
const LIGHTBALL_ZAP_BURST_LIFESPAN_MS = 220;
// Web-only tuning: Phaser lightBall choreography budget, including shockwave and particle tails.
const LIGHTBALL_FX_BUDGET_MS = LIGHTBALL_CHARGE_MS + LIGHTBALL_TARGET_STAGGER_MAX_MS + LIGHTBALL_ZAP_LIFESPAN_MS + Math.max(
  LIGHTBALL_FULL_SHOCKWAVE_MS,
  LIGHTBALL_ZAP_BURST_LIFESPAN_MS + VFX_TIMING.EMITTER_CLEANUP_BUFFER_MS
);
const POWERUP_EFFECT_MS = Math.max(TNT_FX_BUDGET_MS, ROCKET_FX_BUDGET_MS, PROPELLER_FX_BUDGET_MS, LIGHTBALL_FX_BUDGET_MS);
const motionTiming = {
  blockedJiggle: 72,
  blockedFlash: 230,
  clearFlash: 300,
  // Mirrors iOS TileNode.swift update(animated:) quick 0.08s feedback cadence.
  dragLift: DRAG_LIFT_MS,
  // Mirrors iOS BoardNode.swift springyReturnAction stretch/settle durations.
  invalidStretch: 70,
  invalidSettle: 60,
  invalidSwap: 170,
  powerUpEffect: POWERUP_EFFECT_MS,
  snapBack: 150,
  spawnFlash: 110
} as const;

// Mirrors the iOS BoardNode.swift animatePowerUpEvents/animateSinglePowerUpEvent
// wall-clock budget, rounded up so queued actions do not clear FX early.
export const POWERUP_FX_BUDGET_MS = POWERUP_EFFECT_MS;

const CLEAR_AND_CASCADE_BUDGET_MS =
  MATCH_POP_COMPRESSION_MS +
  Math.max(
    MATCH_WAVE_MAX_MS + MATCH_IMPACT_MS,
    CASCADE_START_AFTER_IMPACT_MS + CASCADE_FALL_MAX_MS + CASCADE_LANDING_SQUASH_MS + CASCADE_LANDING_SETTLE_MS
  );
const POWERUP_POP_STAGGER_BUDGET_MS = Math.max(
  TNT_FUSE_MS + TNT_RADIAL_STAGGER_MAX_MS,
  PROPELLER_LIFT_MS + PROPELLER_FLIGHT_MS + PROPELLER_SECONDARY_STAGGER_MAX_MS,
  LIGHTBALL_CHARGE_MS + LIGHTBALL_TARGET_STAGGER_MAX_MS
);
const POWERUP_RESOLVE_BUDGET_MS =
  POWERUP_POP_STAGGER_BUDGET_MS +
  MATCH_POP_COMPRESSION_MS +
  MATCH_IMPACT_MS +
  CASCADE_FALL_MAX_MS +
  CASCADE_LANDING_SQUASH_MS +
  CASCADE_LANDING_SETTLE_MS;

// Worst-case wall-clock for one resolved swap's animation chain: swap settle →
// match lock → the slowest clear/cascade, power-up FX, or power-up staggered pop
// path. The action queue must pace SLOWER than this so a queued action never
// starts while the previous BoardScene tweens are still running (which would
// render over in-flight pops/cascades/FX). Derived from named timing constants so
// it stays correct when those timings change.
export const RESOLVE_ANIMATION_BUDGET_MS =
  SWAP_TRAVEL_MS +
  SWAP_SETTLE_MS +
  MATCH_RECOGNITION_HOLD_MS +
  Math.max(CLEAR_AND_CASCADE_BUDGET_MS, POWERUP_FX_BUDGET_MS, POWERUP_RESOLVE_BUDGET_MS) +
  120; // safety margin for scheduling / render jitter

// Input-freeze watchdog for a committed swap whose commit-settle handoff
// never completes -- the settle tween itself never resolving (a broken or
// killed tween), leaving this.drag set forever. NOT a guard against a
// mid-cascade failure: the watchdog is cleared as soon as the settle handoff
// runs (see the `run` closure in playResolvedAnimation, which clears it
// before any cascade/pop work starts), and input is gated on this.drag alone
// -- which is already cleared by then -- so a cascade-phase exception cannot
// re-freeze input. Comfortably above RESOLVE_ANIMATION_BUDGET_MS -- the
// worst-case wall-clock for a NORMAL resolved swap -- so only a genuinely
// wedged commit-settle ever fires it. Armed as a Phaser clock timer (not
// window.setTimeout) so a backgrounded tab, where tweens legitimately pause
// and resume later, never trips it.
const DRAG_COMMIT_WATCHDOG_MS = RESOLVE_ANIMATION_BUDGET_MS + 500;

// Fraction of a tile a drag must travel past the cell midpoint to commit a swap
// (rather than snap back). Raised to match the iOS commit weight.
const SWAP_COMMIT_THRESHOLD_FACTOR = 0.45;

export class BoardScene extends Phaser.Scene {
  private snapshot: BoardSnapshot | null = null;
  private onAction: ((action: BoardAction) => void) | null = null;
  private layer: Phaser.GameObjects.Container | null = null;
  private fxUnderlay: Phaser.GameObjects.Container | null = null;
  private fxLayer: Phaser.GameObjects.Container | null = null;
  private fxScreen: Phaser.GameObjects.Container | null = null;
  private vfxCleanup = new VfxCleanupRegistry();
  private occupantNodes = new Map<string, Phaser.GameObjects.Container>();
  private boardBounds = new Phaser.Geom.Rectangle(0, 0, 0, 0);
  private tileSize = 72;
  private activePointerId: number | null = null;
  private domPointerHandlers: DomPointerHandlers | null = null;
  private drag: ActiveDrag | null = null;
  private commitSettled = false;
  private pendingCommitCb: (() => void) | null = null;
  // The authoritative post-cascade snapshot captured alongside pendingCommitCb
  // whenever the resolve handoff for a committed swap is deferred (waiting on
  // the settle tween). Lets the watchdog resync to the true engine state if
  // that settle tween never completes, instead of re-rendering the stale
  // pre-swap this.snapshot. See recoverFromWedgedDrag.
  private pendingResolvedSnapshot: BoardSnapshot | null = null;
  private dragWatchdog: Phaser.Time.TimerEvent | null = null;
  private selected: GridPosition | null = null;
  private activeAnimationId: number | null = null;
  private lastAnimationId = 0;
  private reducedMotion = false;
  private pendingBooster: BoosterType | null = null;
  private presentationSequenceId = 0;
  private activePresentationSequenceId = 0;
  private presentationPlannedAtMs = 0;
  private hasPlannedMatchImpact = false;

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
    this.fxUnderlay = this.add.container(0, 0);
    this.layer = this.add.container(0, 0);
    this.fxLayer = this.add.container(0, 0);
    this.fxScreen = this.add.container(0, 0);
    this.vfxCleanup = new VfxCleanupRegistry();
    this.events.once("shutdown", this.disposeVfx, this);
    ensureVfxTextures(this);
    this.resetPresentationTrace();
    this.installDomPointerHandlers();
    this.scale.on("resize", () => {
      // A resize can land while a committed swap's resolve handoff is parked
      // on the settle tween (pendingCommitCb). hardClearDrag alone would kill
      // that tween and drop the handoff, wedging the active animation forever
      // (no pops, activeAnimationId never cleared). Run the handoff instead:
      // its resolution chain re-renders from scratch, picking up the new
      // geometry on the way.
      const pendingHandoff = this.pendingCommitCb;
      this.pendingCommitCb = null;
      this.hardClearDrag();
      if (pendingHandoff) {
        pendingHandoff();
        return;
      }
      this.renderSnapshot();
    });
    this.renderSnapshot();
  }

  private disposeVfx(): void {
    this.vfxCleanup.dispose();
    this.fxUnderlay = null;
    this.fxLayer = null;
    this.fxScreen = null;
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
      this.beginPresentationSequence(animation.action);
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
    this.signalBoardReady();
  }

  private finishAnimation(): void {
    this.recordPresentation("resolution-complete", undefined, this.reducedMotion ? 0 : CASCADE_LANDING_SETTLE_MS);
    this.activeAnimationId = null;
  }

  private isPresentationTestMode(): boolean {
    return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("gwTestMode") === "1";
  }

  private resetPresentationTrace(): void {
    if (!this.isPresentationTestMode()) return;
    const target = window as Window & { __gwPresentationTrace?: PresentationTraceEntry[] };
    target.__gwPresentationTrace = [];
  }

  private clearPresentationTrace(): void {
    if (!this.isPresentationTestMode()) return;
    const target = window as Window & { __gwPresentationTrace?: PresentationTraceEntry[] };
    delete target.__gwPresentationTrace;
  }

  private beginPresentationSequence(action: BoardAction): void {
    this.presentationSequenceId += 1;
    this.activePresentationSequenceId = this.presentationSequenceId;
    this.presentationPlannedAtMs = this.time.now;
    this.hasPlannedMatchImpact = false;
    this.recordPresentation("action-received", action.kind);
  }

  private recordPresentation(kind: string, detail?: string, plannedElapsedMs = 0): void {
    if (!this.isPresentationTestMode()) return;
    this.presentationPlannedAtMs += plannedElapsedMs;
    const target = window as Window & { __gwPresentationTrace?: PresentationTraceEntry[] };
    const trace = target.__gwPresentationTrace ?? [];
    trace.push({
      sequenceId: this.activePresentationSequenceId,
      atMs: this.time.now,
      plannedAtMs: this.presentationPlannedAtMs,
      kind,
      ...(detail ? { detail } : {})
    });
    target.__gwPresentationTrace = trace;
  }

  private cueBoardAudio(key: PresentationAudioKey, playback?: Partial<BoardAudioPlayback>): void {
    audioService.playBoardCue(key, playback);
    this.recordPresentation("audio-cue", key);
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
    background.fillStyle(boardChrome.fill, boardChrome.fillAlpha);
    background.fillRoundedRect(this.boardBounds.x - 8, this.boardBounds.y - 8, boardWidth + 16, boardHeight + 16, 10);
    background.lineStyle(2, boardChrome.stroke, boardChrome.strokeAlpha);
    background.strokeRoundedRect(this.boardBounds.x - 8, this.boardBounds.y - 8, boardWidth + 16, boardHeight + 16, 10);
    this.layer.add(background);

    for (const position of this.snapshot.grid.allPositions) {
      this.renderCell(position, hiddenPositions);
    }
  }

  private renderCell(position: GridPosition, hiddenPositions: Set<string>): void {
    if (!this.layer || !this.snapshot) return;
    const cell = this.snapshot.grid.get(position);
    const positionId = positionKey(position);
    const topLeft = this.cellTopLeft(position);
    const radius = Math.max(6, this.tileSize * 0.1);
    const cellFill = cell.generator ? boardChrome.generatorCell : cell.isMovable ? boardChrome.movableCell : boardChrome.blockedCell;
    const cellAlpha = cell.generator
      ? boardChrome.generatorCellAlpha
      : cell.isMovable
        ? boardChrome.movableCellAlpha
        : boardChrome.blockedCellAlpha;
    const cellStroke = cell.isMovable ? boardChrome.movableStroke : boardChrome.blockedStroke;
    const cellStrokeAlpha = cell.isMovable ? boardChrome.movableStrokeAlpha : boardChrome.blockedStrokeAlpha;

    const graphics = this.add.graphics();
    graphics.fillStyle(cellFill, cellAlpha);
    graphics.fillRoundedRect(topLeft.x + 2, topLeft.y + 2, this.tileSize - 4, this.tileSize - 4, radius);
    graphics.lineStyle(1, cellStroke, cellStrokeAlpha);
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

    if (!hiddenPositions.has(positionId)) {
      const occupant = this.addOccupant(position, cell, this.layer, 1);
      if (occupant) this.occupantNodes.set(positionId, occupant);
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
    audioService.unlockBoardSounds();
    const pointer = this.pointerFromClientPoint(clientX, clientY);
    return this.activateBoosterAtPointer(booster, pointer);
  }

  playWinSequence(onComplete: () => void): boolean {
    if (!this.snapshot || !this.layer || !this.fxLayer) return false;
    const sourceSnapshot = this.snapshot;
    const poppedKeys = occupiedKeys(sourceSnapshot);
    this.hardClearDrag();

    const finish = () => {
      if (this.sys.isActive()) {
        this.snapshot = buildPostClearSnapshot(sourceSnapshot, poppedKeys);
        this.renderSnapshot();
      }
      onComplete();
    };

    if (this.reducedMotion || poppedKeys.size === 0) {
      finish();
      return true;
    }

    const hiddenKeys = new Set<string>();
    const rows = rowDestructionOrder(sourceSnapshot.grid.rows);
    const seed = sourceSnapshot.rngSeed;
    rows.forEach((row, index) => {
      this.time.delayedCall(index * WIN_ROW_DESTRUCTION_STAGGER_MS, () => {
        if (!this.sys.isActive() || !this.fxLayer) return;
        const rowPositions = sourceSnapshot.grid.allPositions.filter((position) => {
          const key = positionKey(position);
          return position.row === row && poppedKeys.has(key);
        });
        for (const position of rowPositions) hiddenKeys.add(positionKey(position));
        this.snapshot = sourceSnapshot;
        this.renderSnapshot(new Set(hiddenKeys), false);
        for (const position of rowPositions) {
          this.playWinTilePop(sourceSnapshot, position, seed);
        }
        if (rowPositions.length > 0) {
          shake(
            this,
            row === 0 ? WIN_FINAL_SHAKE_INTENSITY : WIN_ROW_SHAKE_INTENSITY,
            WIN_ROW_SHAKE_DURATION_MS,
            this.reducedMotion
          );
        }
        if (row === 0) this.playWinFinalBurst();
      });
    });

    this.time.delayedCall(
      winSequenceDurationMs(sourceSnapshot.grid.rows, WIN_ROW_DESTRUCTION_STAGGER_MS, WIN_ROW_DESTRUCTION_POP_MS),
      finish
    );
    return true;
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
          this.clearDragWatchdog();
          this.drag = null;
          this.pendingCommitCb = null;
          this.pendingResolvedSnapshot = null;
          this.playPostSwapMatchResolution(postSwapSnapshot, nextSnapshot, animation.delta);
        };
        if (this.commitSettled) run();
        else {
          // Deferred: the settle tween hasn't finished yet. Stash the true
          // (post-cascade) snapshot so the watchdog can jump straight to it
          // if the settle tween never completes -- see recoverFromWedgedDrag.
          this.pendingResolvedSnapshot = nextSnapshot;
          this.pendingCommitCb = run;
        }
        return;
      }

      // Fallback: programmatic swap with no live drag. Single ghost tween.
      this.hardClearDrag();
      this.renderSnapshot(hiddenPositionsFor(action));
      const ghosts = this.createSwapGhosts(action, previousSnapshot);
      if (ghosts.length > 0) {
        let remaining = ghosts.length;
        for (const ghost of ghosts) {
          this.tweenCommittedSwap(ghost.object, ghost.to, () => {
            ghost.object.destroy();
            remaining -= 1;
            if (remaining === 0) {
              this.recordPresentation("swap-settled", undefined, SWAP_TRAVEL_MS + SWAP_SETTLE_MS);
              this.playPostSwapMatchResolution(postSwapSnapshot, nextSnapshot, animation.delta);
            }
          });
        }
        return;
      }
      this.playPostSwapMatchResolution(postSwapSnapshot, nextSnapshot, animation.delta);
      return;
    }

    this.playResolvedNonSwapAnimation(nextSnapshot, animation.delta);
  }

  private playResolvedNonSwapAnimation(nextSnapshot: BoardSnapshot, delta: BoardDelta): void {
    this.hardClearDrag();
    const baseline = this.snapshot ?? nextSnapshot;
    const clearedKeys = clearedKeysFromDelta(delta);
    const flashColors = clearFlashColors(delta);
    const popStagger = powerUpPopStagger(delta, baseline, clearedKeys);
    const runCascade = () => {
      const postClear = buildPostClearSnapshot(baseline, clearedKeys);
      this.playCascadeAndSpawn(postClear, nextSnapshot, delta, () => {
        this.playDeltaEffects(delta, clearedKeys);
        this.finishAnimation();
      });
    };
    const startPowerUpEffectsAfterPopRender = () => {
      if (delta.powerUpEvents.length === 0) return;
      this.playPowerUpEffects(delta, runCascade);
      this.recordPowerUpFxAfterPopRender();
    };
    if (delta.moves.length === 0 && delta.spawns.length === 0) {
      const finish = () => {
        this.snapshot = nextSnapshot;
        this.renderSnapshot();
        this.playDeltaEffects(delta, clearedKeys);
        this.finishAnimation();
      };
      if (clearedKeys.size > 0) this.playTilePops(baseline, clearedKeys, finish, flashColors, popStagger, startPowerUpEffectsAfterPopRender);
      else {
        if (delta.powerUpEvents.length > 0) this.playPowerUpEffects(delta);
        finish();
      }
      return;
    }
    if (clearedKeys.size > 0) {
      this.playTilePops(
        baseline,
        clearedKeys,
        () => undefined,
        flashColors,
        popStagger,
        startPowerUpEffectsAfterPopRender,
        hasSingleTnt(delta) ? undefined : runCascade,
        delta.powerUpEvents.length === 0
      );
    }
    else {
      if (delta.powerUpEvents.length > 0) this.playPowerUpEffects(delta);
      runCascade();
    }
  }

  private recordTilePopAnimation(count: number): void {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("gwTestMode") !== "1") return;
    const target = window as Window & { __gwTilePopAnimationCount?: number };
    target.__gwTilePopAnimationCount = (target.__gwTilePopAnimationCount ?? 0) + count;
  }

  private playPostSwapMatchResolution(postSwapSnapshot: BoardSnapshot, nextSnapshot: BoardSnapshot, delta: BoardDelta): void {
    this.snapshot = postSwapSnapshot;
    this.renderSnapshot();
    const popKeys = resolvedPopKeys(initialMatchKeys(postSwapSnapshot), delta);
    const flashColors = clearFlashColors(delta);
    const popStagger = powerUpPopStagger(delta, postSwapSnapshot, popKeys);
    const runCascade = () => {
      const postClear = buildPostClearSnapshot(postSwapSnapshot, popKeys);
      this.playCascadeAndSpawn(postClear, nextSnapshot, delta, () => {
        this.playDeltaEffects(delta, popKeys);
        this.finishAnimation();
      });
    };
    this.time.delayedCall(MATCH_RECOGNITION_HOLD_MS, () => {
      this.playTilePops(postSwapSnapshot, popKeys, () => {
        // Tile debris is allowed to finish independently after the empty cells
        // open. Cascade owns the board-state handoff from this point forward.
      }, flashColors, popStagger, () => {
        if (delta.powerUpEvents.length === 0) return;
        this.playPowerUpEffects(delta, runCascade);
        this.recordPowerUpFxAfterPopRender();
      }, hasSingleTnt(delta) ? undefined : runCascade, delta.powerUpEvents.length === 0);
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
      this.clearDragWatchdog();
      this.tweens.killTweensOf(drag.sprite);
      if (drag.neighbor) this.tweens.killTweensOf(drag.neighbor.sprite);
      this.flashCell(action.from, 0xff4968, 190);
      this.flashCell(action.to, 0xff4968, 190);
      const neighbor = drag.neighbor;
      this.drag = null;
      this.commitSettled = false;
      this.pendingCommitCb = null;
      this.pendingResolvedSnapshot = null;
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
        const overshoot = this.tileSize * INVALID_SWAP_OVERSHOOT_FACTOR;
        const axisX = travelX !== 0 ? Math.sign(travelX) : 0;
        const axisY = travelY !== 0 ? Math.sign(travelY) : 0;
        const overshootX = home.x - axisX * overshoot;
        const overshootY = home.y - axisY * overshoot;
        this.tweens.add({
          targets: sprite,
          x: overshootX,
          y: overshootY,
          scaleX: axisX !== 0 ? INVALID_SWAP_SQUASH_SCALE : 1,
          scaleY: axisY !== 0 ? INVALID_SWAP_SQUASH_SCALE : 1,
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

  private tweenCommittedSwap(
    sprite: Phaser.GameObjects.Container,
    destination: { x: number; y: number },
    onComplete: () => void
  ): void {
    const horizontal = Math.abs(destination.x - sprite.x) >= Math.abs(destination.y - sprite.y);
    this.tweens.add({
      targets: sprite,
      x: destination.x,
      y: destination.y,
      scaleX: horizontal ? 1.055 : 0.955,
      scaleY: horizontal ? 0.955 : 1.055,
      duration: SWAP_TRAVEL_MS,
      ease: "Sine.easeInOut",
      onComplete: () => {
        this.tweens.add({
          targets: sprite,
          scaleX: 1,
          scaleY: 1,
          duration: SWAP_SETTLE_MS,
          ease: "Sine.easeOut",
          onComplete
        });
      }
    });
  }

  private playDeltaEffects(delta: BoardDelta, skipClearKeys = new Set<string>()): void {
    if (this.reducedMotion) return;
    for (const clear of delta.clears) {
      if (!skipClearKeys.has(positionKey(clear.position))) this.flashCell(clear.position, clear.clearedByPowerUp ? 0x9bfff2 : 0xf7d154, motionTiming.clearFlash);
    }
  }

  private playPowerUpEffects(delta: BoardDelta, onSingleTntCascade?: () => void): void {
    if (this.reducedMotion) {
      const event = delta.powerUpEvents[0];
      if (event) this.cueBoardAudio(reducedMotionPowerUpCue(event), { gain: 0.28 });
      return;
    }

    for (const group of groupPowerUpEvents(delta.powerUpEvents)) {
      // TNT+TNT has dedicated combo choreography in Task 15. The booster
      // resolver also emits its single TNT event, which owns this task's
      // presentation path and all affected positions.
      if (group.kind === "combo" && group.key === "tnt+tnt") continue;
      if (group.kind !== "combo") {
        for (const event of group.events) {
          this.playPowerUpEffect(
            event,
            event.powerUpType.kind === "tnt" && event.trigger.kind !== "combo" ? onSingleTntCascade : undefined
          );
        }
        continue;
      }

      this.recordPresentation("combo-charge", group.key ?? undefined);
      this.cueBoardAudio("comboCharge");
      let hasImpactCue = false;
      for (const event of group.events) {
        this.playPowerUpEffect(event, () => {
          if (hasImpactCue) return;
          hasImpactCue = true;
          this.recordPresentation("combo-impact", group.key ?? undefined);
          this.cueBoardAudio("comboImpact");
          audioService.vibrate([18, 35, 28]);
        });
      }
    }
  }

  private playTilePops(
    sourceSnapshot: BoardSnapshot,
    popKeys: Set<string>,
    onComplete: () => void,
    flashColors = new Map<string, number>(),
    delayOverrides = new Map<string, number>(),
    afterRender?: () => void,
    onCascadeStart?: () => void,
    allowMatchShake = true
  ): void {
    if (!this.fxLayer || popKeys.size === 0) {
      onCascadeStart?.();
      onComplete();
      return;
    }

    this.snapshot = sourceSnapshot;
    this.renderSnapshot(popKeys);
    afterRender?.();
    this.recordTilePopAnimation(popKeys.size);
    const positions: GridPosition[] = [];
    for (const position of sourceSnapshot.grid.allPositions) {
      if (popKeys.has(positionKey(position))) positions.push(position);
    }

    const stagger = computeCentroidStagger(positions, {
      perUnitMs: MATCH_WAVE_PER_GRID_MS,
      maxMs: MATCH_WAVE_MAX_MS
    });
    const popObjects: { object: Phaser.GameObjects.Container; delay: number; position: GridPosition; tint: number }[] = [];
    for (const position of positions) {
      const cell = sourceSnapshot.grid.get(position);
      const object = this.addOccupant(position, cell, this.fxLayer, 1);
      if (!object) continue;
      const key = positionKey(position);
      const delay = delayOverrides.get(key) ?? stagger.get(key) ?? 0;
      popObjects.push({ object, delay, position, tint: cell.baseTile ? tileVfxTints[cell.baseTile] : 0x9bfff2 });
      this.flashCell(position, flashColors.get(key) ?? 0xf7d154, MATCH_POP_COMPRESSION_MS + MATCH_IMPACT_MS, delay);
    }

    if (popObjects.length === 0) {
      onCascadeStart?.();
      onComplete();
      return;
    }

    this.recordPresentation("match-group-start", String(popObjects.length));
    let remaining = popObjects.length;
    let cascadeScheduled = false;
    let playedClusterBody = false;
    let cleanupScheduled = false;
    const seed = this.snapshot?.rngSeed ?? "0";
    if (allowMatchShake && popObjects.length >= MATCH_SHAKE_WEAK_THRESHOLD_TILES) {
      const intensity = popObjects.length >= MATCH_SHAKE_STRONG_THRESHOLD_TILES
        ? MATCH_SHAKE_STRONG_INTENSITY
        : MATCH_SHAKE_WEAK_INTENSITY;
      this.recordPresentation("shake-request", String(intensity));
      shake(
        this,
        intensity,
        MATCH_SHAKE_DURATION_MS,
        this.reducedMotion
      );
    }
    for (const entry of popObjects) {
      const startPop = () => {
        const piece = entry.object.getByName("piece") as Phaser.GameObjects.Image | Phaser.GameObjects.Text | null;
        const popTarget = piece ?? entry.object;
        const baseScaleX = piece?.scaleX ?? entry.object.scaleX;
        const baseScaleY = piece?.scaleY ?? entry.object.scaleY;
        this.tweens.add({
          targets: popTarget,
          scaleX: baseScaleX * 1.05,
          scaleY: baseScaleY * 0.91,
          duration: MATCH_POP_COMPRESSION_MS,
          ease: "Sine.easeOut",
          onComplete: () => {
            if (!this.hasPlannedMatchImpact) {
              this.hasPlannedMatchImpact = true;
              this.recordPresentation("match-impact", String(popObjects.length), MATCH_RECOGNITION_HOLD_MS + MATCH_POP_COMPRESSION_MS);
            }
            this.recordPresentation("tile-impact", positionKey(entry.position));
            if (!playedClusterBody) {
              playedClusterBody = true;
              this.cueBoardAudio("tileClusterBody", { gain: 0.62 });
            }
            const variation = tilePopVariation(entry.position, seed);
            this.cueBoardAudio(variation.sample === "tile_pop_a" ? "tilePopA" : "tilePopB", {
              gain: 0.42,
              playbackRate: variation.playbackRate
            });
            this.playMatchBurst(entry.object, entry.tint);
            if (!cleanupScheduled) {
              cleanupScheduled = true;
              this.recordPresentation("debris-cleanup-pending");
              this.time.delayedCall(MATCH_DEBRIS_CLEANUP_MS, () => {
                if (this.sys.isActive()) this.recordPresentation("debris-cleanup-complete");
              });
            }
            piece?.setVisible(false);
            this.tweens.add({
              targets: entry.object,
              alpha: 0,
              duration: MATCH_AFTERIMAGE_MS,
              ease: "Quad.easeOut",
              onComplete: () => {
                entry.object.destroy();
                if (!cascadeScheduled && onCascadeStart) {
                  cascadeScheduled = true;
                  this.time.delayedCall(Math.max(0, CASCADE_START_AFTER_IMPACT_MS - MATCH_AFTERIMAGE_MS), onCascadeStart);
                }
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

  private playMatchBurst(object: Phaser.GameObjects.Container, tint: number): void {
    if (!this.fxLayer) return;
    this.recordMatchBurst();
    this.recordPresentation("vfx-particles", String(MATCH_COLORED_DEBRIS_COUNT + MATCH_SMOKE_PUFF_COUNT));
    const core = this.add.image(object.x, object.y, vfxTextureKeys.hotCore);
    core.setTint(tint);
    core.setBlendMode(Phaser.BlendModes.ADD);
    core.setScale(Math.max(0.7, this.tileSize / 34));
    this.fxLayer.add(core);
    this.vfxCleanup.trackObject(core);
    const coreTween = this.tweens.add({
      targets: core,
      alpha: 0,
      scaleX: core.scaleX * 1.5,
      scaleY: core.scaleY * 1.5,
      duration: MATCH_AFTERIMAGE_MS,
      ease: "Quad.easeOut",
      onComplete: () => {
        this.vfxCleanup.release(core);
        this.vfxCleanup.release(coreTween);
        core.destroy();
      }
    });
    this.vfxCleanup.trackTween(coreTween);
    burst(this, this.fxLayer, object.x, object.y, {
      texture: vfxTextureKeys.spark,
      count: 3,
      speed: this.tileSize * 1.9,
      lifespanMs: MATCH_DEBRIS_LIFESPAN_MS,
      tint,
      scale: Math.max(0.22, this.tileSize / 190)
    }, this.vfxCleanup);
    burst(this, this.fxLayer, object.x, object.y, {
      texture: vfxTextureKeys.shard,
      count: 3,
      speed: this.tileSize * 1.45,
      lifespanMs: MATCH_DEBRIS_LIFESPAN_MS,
      tint,
      scale: Math.max(0.22, this.tileSize / 220)
    }, this.vfxCleanup);
    burst(this, this.fxLayer, object.x, object.y, {
      texture: vfxTextureKeys.shardWide,
      count: 1,
      speed: this.tileSize * 1.3,
      lifespanMs: MATCH_DEBRIS_LIFESPAN_MS,
      tint,
      scale: Math.max(0.2, this.tileSize / 235)
    }, this.vfxCleanup);
    burst(this, this.fxLayer, object.x, object.y, {
      texture: vfxTextureKeys.smoke,
      count: MATCH_SMOKE_PUFF_COUNT,
      speed: this.tileSize * 0.45,
      lifespanMs: MATCH_DEBRIS_LIFESPAN_MS,
      tint: 0xffffff,
      scale: Math.max(0.24, this.tileSize / 200)
    }, this.vfxCleanup);
    const afterimage = this.add.image(object.x, object.y, vfxTextureKeys.glow);
    afterimage.setTint(tint);
    afterimage.setBlendMode(Phaser.BlendModes.ADD);
    afterimage.setScale(Math.max(0.7, this.tileSize / 28));
    this.fxLayer.add(afterimage);
    this.vfxCleanup.trackObject(afterimage);
    const afterimageTween = this.tweens.add({
      targets: afterimage,
      alpha: 0,
      scaleX: afterimage.scaleX * 1.18,
      scaleY: afterimage.scaleY * 1.18,
      duration: MATCH_AFTERIMAGE_MS,
      ease: "Sine.easeOut",
      onComplete: () => {
        this.vfxCleanup.release(afterimage);
        this.vfxCleanup.release(afterimageTween);
        afterimage.destroy();
      }
    });
    this.vfxCleanup.trackTween(afterimageTween);
  }

  private playWinTilePop(sourceSnapshot: BoardSnapshot, position: GridPosition, seed: string): void {
    if (!this.fxLayer) return;
    const cell = sourceSnapshot.grid.get(position);
    const object = this.addOccupant(position, cell, this.fxLayer, 1);
    if (!object) return;
    const tint = cell.baseTile ? tileVfxTints[cell.baseTile] : 0x9bfff2;
    burst(this, this.fxLayer, object.x, object.y, {
      texture: vfxTextureKeys.spark,
      count: WIN_TILE_BURST_PARTICLE_COUNT,
      speed: this.tileSize * MATCH_BURST_SPEED_TILE_FACTOR,
      lifespanMs: MATCH_BURST_LIFESPAN_MS,
      tint,
      scale: Math.max(MATCH_BURST_MIN_PARTICLE_SCALE, this.tileSize / MATCH_BURST_PARTICLE_SCALE_TILE_DIVISOR)
    });
    this.tweens.add({
      targets: object,
      alpha: 0,
      scaleX: MATCH_BURST_SCALE,
      scaleY: MATCH_BURST_SCALE,
      angle: object.angle + seededAngleJitter(position, seed, 18),
      duration: WIN_ROW_DESTRUCTION_POP_MS,
      ease: "Quad.easeOut",
      onComplete: () => object.destroy()
    });
  }

  private playWinFinalBurst(): void {
    if (!this.fxLayer) return;
    const x = this.boardBounds.centerX;
    const y = this.boardBounds.centerY;
    shockwave(this, this.fxLayer, x, y, {
      radiusPx: Math.max(this.boardBounds.width, this.boardBounds.height) * 0.72,
      durationMs: WIN_ROW_DESTRUCTION_POP_MS,
      tint: 0x9bfff2
    });
    burst(this, this.fxLayer, x, y, {
      texture: vfxTextureKeys.shard,
      count: WIN_FINAL_BURST_PARTICLE_COUNT,
      speed: this.tileSize * 3,
      lifespanMs: MATCH_BURST_LIFESPAN_MS,
      tint: 0xded2ff,
      scale: Math.max(0.34, this.tileSize / 150)
    });
  }

  private recordMatchBurst(): void {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("gwTestMode") !== "1") return;
    const target = window as Window & { __gwMatchBurstCount?: number };
    target.__gwMatchBurstCount = (target.__gwMatchBurstCount ?? 0) + 1;
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

    this.recordPresentation("cascade-start", "occupants-unique", MATCH_IMPACT_MS);
    const creations = createdPowerUpSpawns(delta.spawns);

    this.snapshot = postClearSnapshot;
    // Hide the landing cells of moves/spawns so renderSnapshot leaves them empty
    // - the real (for moves) or freshly-created (for spawns) sprites settle into
    // them at the end of their tweens. A destination that is also a move source
    // (collapsing column) is NOT hidden, so its occupant sprite still exists to
    // animate the lower move. See cascadeHiddenDestinations.
    const destinationKeys = cascadeHiddenDestinations(delta.moves, delta.spawns);
    this.renderSnapshot(destinationKeys, false);

    const moveTweens: { sprite: Phaser.GameObjects.Container; to: { x: number; y: number }; distanceCells: number; spawnPremiumMs: number }[] = [];
    // Remap occupant sprites in place: read the source key, then reattach under
    // the destination key. In a collapsing column one move's source cell is
    // another move's destination cell, so this read-then-write must run
    // destination-bottom-first or it picks up the wrong sprite and tiles leak.
    // orderCascadeMoves enforces that ordering regardless of engine emission order.
    for (const move of orderCascadeMoves(delta.moves)) {
      const sprite = this.occupantNodes.get(positionKey(move.from));
      if (!sprite) continue;
      this.layer?.bringToTop(sprite);
      moveTweens.push({
        sprite,
        to: this.cellCenter(move.to),
        distanceCells: Math.abs(move.to.row - move.from.row),
        spawnPremiumMs: 0
      });
      // Reattach under the destination key so subsequent renders find it.
      this.occupantNodes.delete(positionKey(move.from));
      this.occupantNodes.set(positionKey(move.to), sprite);
    }

    const spawnTweens: { sprite: Phaser.GameObjects.Container; to: { x: number; y: number }; distanceCells: number; spawnPremiumMs: number }[] = [];
    for (const spawn of delta.spawns) {
      if (spawn.asPowerUp) continue;
      if (!this.layer) continue;
      const targetCell = nextSnapshot.grid.get(spawn.position);
      const startX = this.cellCenter(spawn.position).x;
      const startY = this.boardBounds.y - this.tileSize * 0.5;
      const sprite = this.addOccupantAt(startX, startY, targetCell, this.layer, 0);
      if (!sprite) continue;
      this.tweens.add({ targets: sprite, alpha: 1, duration: motionTiming.spawnFlash });
      const destination = this.cellCenter(spawn.position);
      spawnTweens.push({
        sprite,
        to: destination,
        distanceCells: Math.abs(destination.y - startY) / Math.max(1, this.tileSize),
        spawnPremiumMs: 40
      });
      this.occupantNodes.set(positionKey(spawn.position), sprite);
    }

    const allTweens = [...moveTweens, ...spawnTweens];

    const settleCascade = () => {
      this.snapshot = nextSnapshot;
      if (creations.length === 0) {
        this.renderSnapshot();
        onComplete();
        return;
      }
      this.renderSnapshot(new Set(creations.map((creation) => positionKey(creation.position))), false);
      this.revealCreatedPowerUps(nextSnapshot, creations, () => {
        this.renderSnapshot();
        onComplete();
      });
    };

    if (allTweens.length === 0) {
      settleCascade();
      return;
    }

    let remaining = allTweens.length;
    let firstLandingRecorded = false;
    const firstLandingPlanMs = Math.min(...allTweens.map((entry) => (
      Math.min(CASCADE_FALL_MAX_MS + entry.spawnPremiumMs, cascadeFallDurationMs(entry.distanceCells) + entry.spawnPremiumMs)
    )));
    const done = () => {
      remaining -= 1;
      if (remaining === 0) {
        this.time.delayedCall(0, () => {
          settleCascade();
        });
      }
    };

    for (const entry of allTweens) {
      const start = { x: entry.sprite.x, y: entry.sprite.y };
      const fallDuration = Math.min(CASCADE_FALL_MAX_MS + entry.spawnPremiumMs, cascadeFallDurationMs(entry.distanceCells) + entry.spawnPremiumMs);
      const bounceFromY = entry.to.y + Math.min(CASCADE_BOUNCE_MAX_PX, Math.abs(entry.to.y - start.y) * CASCADE_BOUNCE_FACTOR);
      this.tweens.add({
        targets: entry.sprite,
        x: entry.to.x,
        y: bounceFromY,
        scaleX: CASCADE_SQUASH_SCALE_X,
        scaleY: CASCADE_SQUASH_SCALE_Y,
        duration: fallDuration,
        ease: "Sine.easeIn",
        onComplete: () => {
          if (!firstLandingRecorded) {
            firstLandingRecorded = true;
            this.recordPresentation("cascade-land", undefined, firstLandingPlanMs);
            this.cueBoardAudio("cascadeLand", { gain: 0.34 });
          }
          this.tweens.add({
            targets: entry.sprite,
            scaleX: 1,
            scaleY: 1,
            duration: CASCADE_LANDING_SQUASH_MS,
            ease: "Sine.easeOut",
            onComplete: () => {
              this.tweens.add({
                targets: entry.sprite,
                x: entry.to.x,
                y: entry.to.y,
                scaleX: 1,
                scaleY: 1,
                duration: CASCADE_LANDING_SETTLE_MS,
                ease: "Sine.easeOut",
                onComplete: done
              });
            }
          });
        }
      });
    }
  }

  private revealCreatedPowerUps(
    nextSnapshot: BoardSnapshot,
    creations: ReadonlyArray<CreatedPowerUpSpawn>,
    onComplete: () => void
  ): void {
    if (!this.layer || !this.fxLayer || creations.length === 0) {
      onComplete();
      return;
    }

    let remaining = creations.length;
    const done = () => {
      remaining -= 1;
      if (remaining === 0) onComplete();
    };

    for (const creation of creations) {
      const destination = this.cellCenter(creation.position);
      const cell = nextSnapshot.grid.get(creation.position);
      const reveal = this.addOccupantAt(destination.x, destination.y, cell, this.layer, 0);
      if (!reveal) {
        done();
        continue;
      }
      this.occupantNodes.set(positionKey(creation.position), reveal);
      const tint = powerUpCreationTint(creation.powerUp);
      reveal.setScale(POWERUP_CREATION_INITIAL_SCALE);
      reveal.setAngle(-6);
      this.recordPresentation("powerup-create-charge", creation.powerUp.kind);

      for (const offset of [
        { x: -this.tileSize * 0.9, y: this.tileSize * 0.25 },
        { x: this.tileSize * 0.75, y: -this.tileSize * 0.5 },
        { x: this.tileSize * 0.15, y: this.tileSize * 0.9 }
      ]) {
        laneBlast(this, this.fxLayer, {
          x: destination.x + offset.x,
          y: destination.y + offset.y
        }, destination, {
          durationMs: POWERUP_CREATION_CHARGE_MS,
          scale: Math.max(0.55, this.tileSize / 72),
          tint
        }, this.vfxCleanup);
      }

      this.time.delayedCall(POWERUP_CREATION_CHARGE_MS, () => {
        if (!this.sys.isActive()) return;
        this.recordPresentation("powerup-create-impact", creation.powerUp.kind);
        this.cueBoardAudio("powerUpCreate", { gain: 0.58 });
        shockwave(this, this.fxLayer!, destination.x, destination.y, {
          durationMs: POWERUP_CREATION_OVERSHOOT_MS + POWERUP_CREATION_SETTLE_MS,
          radiusPx: this.tileSize * 0.58,
          tint
        }, this.vfxCleanup);
        if (creation.powerUp.kind === "lightBall") shake(this, 0.003, 90, this.reducedMotion);
        this.tweens.add({
          targets: reveal,
          alpha: 1,
          scaleX: POWERUP_CREATION_OVERSHOOT_SCALE,
          scaleY: POWERUP_CREATION_OVERSHOOT_SCALE,
          angle: 6,
          duration: POWERUP_CREATION_OVERSHOOT_MS,
          ease: "Back.easeOut",
          onComplete: () => {
            this.tweens.add({
              targets: reveal,
              scaleX: 1,
              scaleY: 1,
              angle: 0,
              duration: POWERUP_CREATION_SETTLE_MS,
              ease: "Sine.easeOut",
              onComplete: () => {
                this.recordPresentation("powerup-create-stable", creation.powerUp.kind);
                done();
              }
            });
          }
        });
      });
    }
  }

  private playPowerUpEffect(event: PowerUpEvent, onImpact?: () => void): void {
    if (!this.fxLayer) return;
    this.recordPowerUpFxStart();
    const origin = this.cellCenter(event.origin);
    if (event.powerUpType.kind === "tnt") {
      this.playTntPowerUpEffect(event, origin, onImpact);
      return;
    }
    if (event.powerUpType.kind === "rocket") {
      this.playRocketPowerUpEffect(event, origin, onImpact);
      return;
    }
    if (event.powerUpType.kind === "propeller") {
      this.playPropellerPowerUpEffect(event, origin, onImpact);
      return;
    }
    if (event.powerUpType.kind === "lightBall") {
      this.playLightBallPowerUpEffect(event, origin, onImpact);
      return;
    }

    const graphics = this.add.graphics();
    this.fxLayer.add(graphics);

    graphics.lineStyle(4, 0xf15bd7, 0.88);
    graphics.strokeCircle(origin.x, origin.y, this.tileSize * 0.65);
    graphics.strokeRoundedRect(this.boardBounds.x + 5, this.boardBounds.y + 5, this.boardBounds.width - 10, this.boardBounds.height - 10, 12);

    this.tweens.add({
      targets: graphics,
      alpha: 0,
      duration: POWERUP_FX_BUDGET_MS,
      ease: "Sine.easeOut",
      onComplete: () => graphics.destroy()
    });
  }

  private playTntPowerUpEffect(event: PowerUpEvent, origin: { x: number; y: number }, onImpact?: () => void): void {
    if (!this.fxLayer) return;
    const plan = tntDetonationPlan(event.origin, event.affectedPositions);
    this.recordPresentation("tnt-arm");
    this.recordPresentation("powerup-charge", "tnt");
    this.cueBoardAudio("tntArm");
    const fxLayer = this.fxLayer;
    const fuse = this.add.container(origin.x, origin.y);
    const icon = this.add.image(0, 0, powerUpImageKeys.tnt);
    icon.setDisplaySize(this.tileSize * 0.82, this.tileSize * 0.82);
    const flash = this.add.graphics();
    flash.fillStyle(0xffffff, 0.85);
    flash.fillCircle(0, 0, this.tileSize * 0.44);
    flash.setAlpha(0);
    flash.setBlendMode(Phaser.BlendModes.ADD);
    fuse.add([flash, icon]);
    fxLayer.add(fuse);

    this.tweens.add({
      targets: icon,
      scaleX: 1.15,
      scaleY: 1.15,
      duration: plan.chargeAtMs,
      ease: "Sine.easeInOut"
    });
    this.tweens.add({
      targets: flash,
      alpha: 0.95,
      duration: plan.chargeAtMs / 2,
      yoyo: true,
      ease: "Sine.easeInOut"
    });

    this.time.delayedCall(plan.chargeAtMs, () => {
      if (this.sys.isActive()) this.recordPresentation("tnt-charge");
    });

    this.time.delayedCall(plan.detonationAtMs, () => {
      if (!this.sys.isActive() || !this.fxLayer || !this.fxLayer.active || !fxLayer.active) return;
      const activeFxLayer = this.fxLayer;
      if (fuse.active) fuse.destroy();
      this.recordPresentation("tnt-detonation");
      this.recordPresentation("powerup-impact", "tnt");
      this.cueBoardAudio("tntBlast");
      audioService.vibrate([18, 35, 28]);
      if (onImpact) {
        this.time.delayedCall(TNT_CASCADE_AFTER_DETONATION_MS, () => {
          onImpact();
        });
      }
      this.recordTntDetonation();
      if (this.fxScreen) {
        this.recordPresentation("screen-flash");
        boardDimmer(this, this.fxScreen, { alpha: 0.16, durationMs: 120 }, this.vfxCleanup);
        screenFlash(this, this.fxScreen, { alpha: 0.3, durationMs: 70, tint: 0xffe4c0 }, this.vfxCleanup);
      }
      this.recordPresentation("shockwave");
      shockwave(this, activeFxLayer, origin.x, origin.y, {
        radiusPx: this.tileSize * (TNT_BLAST_RADIUS_CELLS + 0.45),
        durationMs: TNT_SHOCKWAVE_MS,
        tint: 0xff8a3d
      }, this.vfxCleanup);
      for (const offset of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) {
        laneBlast(this, activeFxLayer, origin, {
          x: origin.x + offset.x * this.tileSize * 1.5,
          y: origin.y + offset.y * this.tileSize * 1.5
        }, { durationMs: 100, scale: Math.max(0.6, this.tileSize / 72), tint: 0xff9a43 }, this.vfxCleanup);
      }
      burst(this, activeFxLayer, origin.x, origin.y, {
        texture: vfxTextureKeys.spark,
        count: 18,
        speed: this.tileSize * 3.4,
        lifespanMs: TNT_SPARK_BURST_LIFESPAN_MS,
        tint: 0xfff1b8,
        scale: Math.max(0.42, this.tileSize / 120)
      });
      burst(this, activeFxLayer, origin.x, origin.y, {
        texture: vfxTextureKeys.shard,
        count: 12,
        speed: this.tileSize * 2.5,
        lifespanMs: TNT_SHARD_BURST_LIFESPAN_MS,
        tint: 0xff8a3d,
        scale: Math.max(0.34, this.tileSize / 150)
      });
      this.recordPresentation("shake-request", String(TNT_SHAKE_INTENSITY));
      shake(this, TNT_SHAKE_INTENSITY, TNT_SHAKE_DURATION_MS, this.reducedMotion);
      event.affectedPositions.forEach((position, index) => {
        const atMs = plan.impactAtMs[index] ?? plan.detonationAtMs;
        this.time.delayedCall(Math.max(0, atMs - plan.detonationAtMs), () => {
          if (!this.sys.isActive() || !this.fxLayer) return;
          const target = this.cellCenter(position);
          this.recordPresentation("tnt-tile-impact", positionKey(position));
          impactBurst(this, this.fxLayer, target.x, target.y, {
            intensity: 0.78,
            lifespanMs: 260,
            tint: 0xff9a43
          }, this.vfxCleanup);
        });
      });
    });
    this.time.delayedCall(POWERUP_FX_BUDGET_MS, () => {
      if (!this.sys.isActive() || !this.fxLayer?.active) return;
      if (fuse.active) fuse.destroy();
    });
  }

  private playRocketPowerUpEffect(event: PowerUpEvent, origin: { x: number; y: number }, onImpact?: () => void): void {
    if (!this.fxLayer || !this.snapshot || event.powerUpType.kind !== "rocket") return;
    const layer = this.fxLayer;
    const texture = event.powerUpType.orientation === "horizontal"
      ? powerUpImageKeys.rocket_horizontal
      : powerUpImageKeys.rocket_vertical;
    const heads = this.rocketHeadPlans(event);
    this.recordPresentation("powerup-charge", "rocket");
    this.cueBoardAudio("rocketLaunch");
    this.recordRocketLaunch(heads.length);
    if (this.reducedMotion) return;

    shake(this, ROCKET_SHAKE_INTENSITY, ROCKET_SHAKE_DURATION_MS, this.reducedMotion);
    for (const head of heads) {
      const sprite = this.add.image(origin.x, origin.y, texture);
      sprite.setDisplaySize(this.tileSize * ROCKET_HEAD_SCALE, this.tileSize * ROCKET_HEAD_SCALE);
      sprite.setAngle(head.angleDeg);
      sprite.setBlendMode(Phaser.BlendModes.ADD);
      layer.add(sprite);

      const trail = this.add.particles(origin.x, origin.y, vfxTextureKeys.spark, {
        alpha: { start: 0.82, end: 0 },
        blendMode: Phaser.BlendModes.ADD,
        emitting: true,
        frequency: 18,
        lifespan: ROCKET_TRAIL_LIFESPAN_MS,
        scale: { start: Math.max(0.2, this.tileSize / 170), end: 0 },
        speed: { min: this.tileSize * 0.18, max: this.tileSize * 0.72 },
        tint: 0x9bfff2
      });
      trail.startFollow(sprite, 0, 0, true);
      layer.add(trail);

      this.tweens.add({
        targets: sprite,
        x: head.end.x,
        y: head.end.y,
        duration: head.durationMs,
        ease: "Quad.easeOut",
        onComplete: () => {
          this.recordPresentation("powerup-impact", "rocket");
          this.cueBoardAudio("rocketImpact");
          onImpact?.();
          trail.stop();
          burst(this, layer, head.end.x, head.end.y, {
            texture: vfxTextureKeys.spark,
            count: 8,
            speed: this.tileSize * 1.8,
            lifespanMs: ROCKET_EDGE_BURST_LIFESPAN_MS,
            tint: 0x9bfff2,
            scale: Math.max(0.24, this.tileSize / 180)
          });
          sprite.destroy();
          this.time.delayedCall(ROCKET_TRAIL_LIFESPAN_MS + ROCKET_TRAIL_CLEANUP_MS, () => {
            if (trail.active) trail.destroy();
          });
        }
      });
    }
  }

  private rocketHeadPlans(event: PowerUpEvent): Array<{ end: { x: number; y: number }; angleDeg: number; durationMs: number }> {
    if (!this.snapshot || event.powerUpType.kind !== "rocket") return [];
    const { row, col } = event.origin;
    const endpoints = event.powerUpType.orientation === "horizontal"
      ? [
          { position: { row, col: 0 }, angleDeg: 180 },
          { position: { row, col: this.snapshot.grid.cols - 1 }, angleDeg: 0 }
        ]
      : [
          { position: { row: 0, col }, angleDeg: 0 },
          { position: { row: this.snapshot.grid.rows - 1, col }, angleDeg: 180 }
        ];
    return endpoints.map(({ position, angleDeg }) => {
      const distanceCells = event.powerUpType.kind === "rocket" && event.powerUpType.orientation === "horizontal"
        ? Math.abs(position.col - col)
        : Math.abs(position.row - row);
      return {
        end: this.cellCenter(position),
        angleDeg,
        durationMs: Math.max(ROCKET_MIN_FLIGHT_MS, distanceCells * ROCKET_SWEEP_MS_PER_CELL)
      };
    });
  }

  private playPropellerPowerUpEffect(event: PowerUpEvent, origin: { x: number; y: number }, onImpact?: () => void): void {
    if (!this.fxLayer || !this.snapshot) return;
    const layer = this.fxLayer;
    const targets = event.affectedPositions.filter((position) => this.snapshot?.grid.isValid(position));
    const primary = targets[0];
    if (!primary) return;
    if (this.reducedMotion) {
      this.recordPropellerStrike(targets.length);
      return;
    }

    const primaryCenter = this.cellCenter(primary);
    this.recordPresentation("powerup-charge", "propeller");
    this.cueBoardAudio("propellerLift");
    const drone = this.add.container(origin.x, origin.y);
    const icon = this.add.image(0, 0, powerUpImageKeys.propeller);
    icon.setDisplaySize(this.tileSize * PROPELLER_DRONE_SCALE, this.tileSize * PROPELLER_DRONE_SCALE);
    icon.setBlendMode(Phaser.BlendModes.ADD);
    drone.add(icon);
    layer.add(drone);

    const spin = this.tweens.add({
      targets: icon,
      angle: 360,
      duration: PROPELLER_SPIN_MS,
      repeat: -1,
      ease: "Linear"
    });

    this.tweens.add({
      targets: drone,
      scaleX: 1.16,
      scaleY: 1.16,
      y: origin.y - this.tileSize * 0.25,
      duration: PROPELLER_LIFT_MS,
      ease: "Sine.easeOut",
      onComplete: () => {
        this.cueBoardAudio("propellerFly");
        const path = quadraticFlightPath(
          { x: drone.x, y: drone.y },
          primaryCenter,
          this.tileSize * PROPELLER_ARC_LIFT_CELLS,
          PROPELLER_ARC_SAMPLES
        );
        this.tweens.addCounter({
          from: 0,
          to: 1,
          duration: PROPELLER_FLIGHT_MS,
          ease: "Sine.easeInOut",
          onUpdate: (tween) => {
            const point = interpolatePath(path, tween.getValue() ?? 0);
            drone.setPosition(point.x, point.y);
          },
          onComplete: () => {
            this.recordPresentation("powerup-impact", "propeller");
            this.cueBoardAudio("propellerImpact");
            audioService.vibrate(18);
            onImpact?.();
            spin.stop();
            drone.destroy();
            this.recordPropellerStrike(targets.length);
            shockwave(this, layer, primaryCenter.x, primaryCenter.y, {
              radiusPx: this.tileSize * 0.9,
              durationMs: PROPELLER_IMPACT_SHOCKWAVE_MS,
              tint: 0xf7d154
            });
            burst(this, layer, primaryCenter.x, primaryCenter.y, {
              texture: vfxTextureKeys.spark,
              count: 10,
              speed: this.tileSize * 1.8,
              lifespanMs: PROPELLER_IMPACT_BURST_LIFESPAN_MS,
              tint: 0xf7d154,
              scale: Math.max(0.3, this.tileSize / 160)
            });
          }
        });
      }
    });

    this.time.delayedCall(PROPELLER_FX_BUDGET_MS, () => {
      if (!this.sys.isActive()) return;
      spin.stop();
      if (drone.active) drone.destroy();
    });
  }

  private playLightBallPowerUpEffect(event: PowerUpEvent, origin: { x: number; y: number }, onImpact?: () => void): void {
    if (!this.fxLayer || !this.snapshot) return;
    const layer = this.fxLayer;
    const targets = event.affectedPositions.filter((position) => this.snapshot?.grid.isValid(position));
    if (targets.length === 0) return;
    if (this.reducedMotion) {
      this.recordLightBallZap(targets.length);
      return;
    }

    const charge = this.add.graphics();
    this.recordPresentation("powerup-charge", "lightBall");
    this.cueBoardAudio("lightBallCharge");
    charge.lineStyle(3, 0xf15bd7, 0.95);
    charge.strokeCircle(origin.x, origin.y, this.tileSize * 0.48);
    charge.setBlendMode(Phaser.BlendModes.ADD);
    layer.add(charge);
    this.tweens.add({
      targets: charge,
      alpha: 0.1,
      scaleX: 1.45,
      scaleY: 1.45,
      duration: LIGHTBALL_CHARGE_MS,
      ease: "Sine.easeOut",
      onComplete: () => charge.destroy()
    });

    const seed = this.snapshot.rngSeed;
    const targetDelays = radialStagger(event.origin, targets, LIGHTBALL_ZAP_STAGGER_MS, LIGHTBALL_TARGET_STAGGER_MAX_MS);
    let latestTargetDelay = 0;
    targets.forEach((target, index) => {
      const targetDelay = targetDelays.get(positionKey(target)) ?? 0;
      latestTargetDelay = Math.max(latestTargetDelay, targetDelay);
      const delay = LIGHTBALL_CHARGE_MS + targetDelay;
      this.time.delayedCall(delay, () => {
        if (!this.sys.isActive() || !this.fxLayer || !this.fxLayer.active) return;
        const center = this.cellCenter(target);
        this.cueBoardAudio(index % 2 === 0 ? "lightBallZapA" : "lightBallZapB");
        this.drawLightBallZap(origin, center, target, seed, index);
        this.recordLightBallZap(1);
        burst(this, this.fxLayer, center.x, center.y, {
          texture: vfxTextureKeys.spark,
          count: 7,
          speed: this.tileSize * 1.5,
          lifespanMs: LIGHTBALL_ZAP_BURST_LIFESPAN_MS,
          tint: 0xf15bd7,
          scale: Math.max(0.24, this.tileSize / 180)
        });
      });
    });

    const finalDelay = LIGHTBALL_CHARGE_MS + latestTargetDelay + LIGHTBALL_ZAP_LIFESPAN_MS;
    this.time.delayedCall(finalDelay, () => {
      if (!this.sys.isActive() || !this.fxLayer || !this.fxLayer.active) return;
      this.recordPresentation("powerup-impact", "lightBall");
      this.cueBoardAudio("lightBallRelease");
      audioService.vibrate(18);
      onImpact?.();
      shockwave(this, this.fxLayer, origin.x, origin.y, {
        radiusPx: Math.max(this.boardBounds.width, this.boardBounds.height) * 0.72,
        durationMs: LIGHTBALL_FULL_SHOCKWAVE_MS,
        tint: 0xf15bd7
      });
    });
  }

  private drawLightBallZap(
    origin: { x: number; y: number },
    target: { x: number; y: number },
    position: GridPosition,
    seed: string,
    index: number
  ): void {
    if (!this.fxLayer) return;
    const graphics = this.add.graphics();
    graphics.lineStyle(2, 0xf15bd7, 0.95);
    graphics.setBlendMode(Phaser.BlendModes.ADD);
    const jitterA = seededAngleJitter(position, `${seed}|lightBall-a|${index}`, LIGHTBALL_ZAP_JITTER_PX);
    const jitterB = seededAngleJitter(position, `${seed}|lightBall-b|${index}`, LIGHTBALL_ZAP_JITTER_PX);
    const mid1 = {
      x: origin.x + (target.x - origin.x) * 0.33 + jitterA,
      y: origin.y + (target.y - origin.y) * 0.33 - jitterB
    };
    const mid2 = {
      x: origin.x + (target.x - origin.x) * 0.66 - jitterB,
      y: origin.y + (target.y - origin.y) * 0.66 + jitterA
    };
    graphics.beginPath();
    graphics.moveTo(origin.x, origin.y);
    graphics.lineTo(mid1.x, mid1.y);
    graphics.lineTo(mid2.x, mid2.y);
    graphics.lineTo(target.x, target.y);
    graphics.strokePath();
    this.fxLayer.add(graphics);
    this.tweens.add({
      targets: graphics,
      alpha: 0,
      duration: LIGHTBALL_ZAP_LIFESPAN_MS,
      ease: "Sine.easeOut",
      onComplete: () => graphics.destroy()
    });
  }

  private recordPowerUpFxStart(): void {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("gwTestMode") !== "1") return;
    const target = window as Window & { __gwPowerUpFxStartCount?: number };
    target.__gwPowerUpFxStartCount = (target.__gwPowerUpFxStartCount ?? 0) + 1;
  }

  private recordPowerUpFxAfterPopRender(): void {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("gwTestMode") !== "1") return;
    const target = window as Window & { __gwPowerUpFxAfterPopRenderCount?: number };
    target.__gwPowerUpFxAfterPopRenderCount = (target.__gwPowerUpFxAfterPopRenderCount ?? 0) + 1;
  }

  private recordTntDetonation(): void {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("gwTestMode") !== "1") return;
    const target = window as Window & { __gwTntDetonationCount?: number };
    target.__gwTntDetonationCount = (target.__gwTntDetonationCount ?? 0) + 1;
  }

  private recordRocketLaunch(count: number): void {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("gwTestMode") !== "1") return;
    const target = window as Window & { __gwRocketLaunchCount?: number };
    target.__gwRocketLaunchCount = (target.__gwRocketLaunchCount ?? 0) + count;
  }

  private recordPropellerStrike(count: number): void {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("gwTestMode") !== "1") return;
    const target = window as Window & { __gwPropellerStrikeCount?: number };
    target.__gwPropellerStrikeCount = (target.__gwPropellerStrikeCount ?? 0) + count;
  }

  private recordLightBallZap(count: number): void {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("gwTestMode") !== "1") return;
    const target = window as Window & { __gwLightBallZapCount?: number };
    target.__gwLightBallZapCount = (target.__gwLightBallZapCount ?? 0) + count;
  }

  private flashCell(position: GridPosition, color: number, duration: number, delay = 0): void {
    const run = () => {
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
    };
    if (delay > 0) this.time.delayedCall(delay, run);
    else run();
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
    const shutdown = () => {
      this.removeDomPointerHandlers();
      this.setBoardReadyFlag(false);
      this.clearDragWatchdog();
      this.clearPresentationTrace();
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, shutdown);
    this.events.once(Phaser.Scenes.Events.DESTROY, shutdown);
    this.signalBoardReady();
  }

  private signalBoardReady(): void {
    if (!this.domPointerHandlers || !this.snapshot) return;
    this.setBoardReadyFlag(true);
  }

  private setBoardReadyFlag(ready: boolean): void {
    if (typeof window === "undefined") return;
    // Test-only hooks. Gated on the exact `?gwTestMode=1` query (matching the
    // documented contract) so production ship builds never leak these globals.
    if (new URLSearchParams(window.location.search).get("gwTestMode") !== "1") return;
    const target = window as Window & {
      __gwBoardReady?: boolean;
      __gwBoardCellClientPoint?: ((row: number, col: number) => { x: number; y: number } | null) | null;
    };
    target.__gwBoardReady = ready;
    target.__gwBoardCellClientPoint = ready ? (row, col) => this.cellClientPoint(row, col) : null;
  }

  private cellClientPoint(row: number, col: number): { x: number; y: number } | null {
    if (!this.snapshot) return null;
    if (row < 0 || row >= this.snapshot.grid.rows || col < 0 || col >= this.snapshot.grid.cols) return null;
    const center = this.cellCenter({ row, col });
    const rect = this.game.canvas.getBoundingClientRect();
    const sceneWidth = Math.max(1, this.scale.width);
    const sceneHeight = Math.max(1, this.scale.height);
    return {
      x: rect.left + (center.x / sceneWidth) * rect.width,
      y: rect.top + (center.y / sceneHeight) * rect.height
    };
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
    const container = this.add.container(x, y);
    container.setAlpha(alpha);
    const profile = pieceDisplayProfile(this.tileSize);

    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.32);
    shadow.fillEllipse(0, this.tileSize * 0.24, profile.shadowWidthPx, profile.shadowHeightPx);
    shadow.setName("shadow");
    container.add(shadow);

    if (cell.baseTile) {
      const object = this.makeSpriteOrLabel(tileImageKeys[cell.baseTile], profile.pieceSizePx, tileLabel(cell.baseTile));
      object.setName("piece");
      container.add(object);
    } else if (cell.powerUp) {
      const key = imageKeyForPowerUp(cell.powerUp);
      const object = this.makeSpriteOrLabel(key, profile.powerUpSizePx, powerUpLabel(cell.powerUp));
      object.setName("piece");
      container.add(object);
    } else if (cell.generator) {
      const label = this.makeLabel("H", "#ff8bd6", Math.floor(this.tileSize * 0.5));
      label.setName("piece");
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
    audioService.unlockBoardSounds();
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
    sprite.setScale(1);
    if (this.reducedMotion) {
      sprite.setScale(1.06);
    } else {
      this.tweens.add({
        targets: sprite,
        scaleX: 1.06,
        scaleY: 1.06,
        duration: motionTiming.dragLift,
        ease: "Sine.easeOut"
      });
    }
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
  // fallback; the resolve event drives the handoff. A watchdog is armed below
  // purely as a safety net in case that handoff never arrives.
  private commitSwap(drag: ActiveDrag, target: GridPosition): void {
    drag.committed = true;
    drag.blockedMarker?.destroy();
    drag.blockedMarker = null;
    this.commitSettled = false;
    this.selected = null;
    this.armDragWatchdog(drag);

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
      this.recordPresentation("swap-settled", undefined, SWAP_TRAVEL_MS + SWAP_SETTLE_MS);
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
    this.tweenCommittedSwap(drag.sprite, spriteTo, done);
    if (neighbor) {
      this.tweenCommittedSwap(neighbor.sprite, neighborTo, done);
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
    const threshold = this.tileSize * SWAP_COMMIT_THRESHOLD_FACTOR;
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
    this.clearDragWatchdog();
    drag.blockedMarker?.destroy();
    drag.blockedMarker = null;
    const neighbor = drag.neighbor;
    this.drag = null;
    this.selected = null;
    this.commitSettled = false;
    this.pendingCommitCb = null;
    this.pendingResolvedSnapshot = null;

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
    this.clearDragWatchdog();
    this.tweens.killTweensOf(drag.sprite);
    if (drag.neighbor) this.tweens.killTweensOf(drag.neighbor.sprite);
    drag.blockedMarker?.destroy();
    this.drag = null;
    this.selected = null;
    this.commitSettled = false;
    this.pendingCommitCb = null;
    this.pendingResolvedSnapshot = null;
    this.renderSnapshot();
  }

  // Arms a Phaser clock timer (pauses/resumes with the game loop, unlike
  // window.setTimeout) that recovers input if this exact drag is still the
  // committed one once DRAG_COMMIT_WATCHDOG_MS elapses without a resolve
  // handoff. A backgrounded tab pauses this timer along with tweens, so it
  // only ever fires against a genuinely wedged resolve.
  private armDragWatchdog(drag: ActiveDrag): void {
    this.clearDragWatchdog();
    this.dragWatchdog = this.time.delayedCall(DRAG_COMMIT_WATCHDOG_MS, () => {
      this.dragWatchdog = null;
      // The normal resolve handoff already completed and started a new drag
      // (or cleared it); nothing to recover.
      if (this.drag !== drag) return;
      console.warn(
        "[BoardScene] committed swap watchdog fired without a resolve handoff -- recovering board input.",
        { from: drag.start, to: drag.neighbor?.position ?? null }
      );
      this.tweens.killTweensOf(drag.sprite);
      if (drag.neighbor) this.tweens.killTweensOf(drag.neighbor.sprite);
      this.recoverFromWedgedDrag(drag);
    });
  }

  private clearDragWatchdog(): void {
    if (!this.dragWatchdog) return;
    this.time.removeEvent(this.dragWatchdog);
    this.dragWatchdog = null;
  }

  // Recovery for a committed swap whose settle-tween handoff never arrived
  // (armDragWatchdog fired). By this point the TRUE engine model has already
  // advanced past this swap -- App.applyAction updates the model and
  // dispatches the resolved animation event synchronously, well before this
  // scene's settle tween would normally complete -- so re-rendering the
  // scene's own (still pre-swap) this.snapshot via snapBackDrag would leave
  // the board out of sync with the engine for a turn.
  //
  // If that resolved animation already reached playResolvedAnimation and got
  // deferred (pendingCommitCb/pendingResolvedSnapshot set, because
  // commitSettled was still false), we have the exact authoritative
  // post-cascade snapshot on hand: release the wedged animation id and jump
  // straight to it. If the resolved animation hasn't reached the scene at
  // all yet, there is no authoritative snapshot retrievable from scene state
  // -- the scene only ever receives snapshots via the push-based sync() path,
  // there is no pull-based query into the engine -- so fall back to the
  // ordinary snap-back, which is at least consistent with the this.snapshot
  // the scene is currently holding; the next sync() call (carrying a fresh,
  // higher-id animation) will bring it fully current. Defensively release
  // activeAnimationId here too: this branch means sync() never ran for this
  // swap so nothing should be pinned, but clearing it costs nothing and
  // removes any dependence on that invariant holding.
  private recoverFromWedgedDrag(drag: ActiveDrag): void {
    if (this.pendingResolvedSnapshot) {
      const resolvedSnapshot = this.pendingResolvedSnapshot;
      this.finishAnimation();
      this.hardClearDrag();
      this.snapshot = resolvedSnapshot;
      this.renderSnapshot();
      return;
    }
    this.finishAnimation();
    this.snapBackDrag(drag);
  }

  private hardClearDrag(): void {
    this.clearDragWatchdog();
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
    this.pendingResolvedSnapshot = null;
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

function occupiedKeys(snapshot: BoardSnapshot): Set<string> {
  const keys = new Set<string>();
  for (const position of snapshot.grid.allPositions) {
    const cell = snapshot.grid.get(position);
    if (cell.baseTile || cell.powerUp) keys.add(positionKey(position));
  }
  return keys;
}

function clearFlashColors(delta: BoardDelta): Map<string, number> {
  const colors = new Map<string, number>();
  for (const clear of delta.clears) {
    colors.set(positionKey(clear.position), clear.clearedByPowerUp ? 0x9bfff2 : 0xf7d154);
  }
  return colors;
}

function powerUpPopStagger(delta: BoardDelta, snapshot: BoardSnapshot, popKeys: ReadonlySet<string>): Map<string, number> {
  const delays = new Map<string, number>();
  for (const event of delta.powerUpEvents) {
    const positions = [event.origin, ...event.affectedPositions].filter((position) => {
      const key = positionKey(position);
      return popKeys.has(key) && snapshot.grid.isValid(position);
    });
    if (event.powerUpType.kind === "tnt") {
      const radial = radialStagger(event.origin, positions, TNT_RADIAL_STAGGER_MS, TNT_RADIAL_STAGGER_MAX_MS);
      for (const [key, delay] of radial) setEarliestDelay(delays, key, TNT_FUSE_MS + delay);
    } else if (event.powerUpType.kind === "rocket") {
      const sweep = sweepStagger(event.origin, positions, event.powerUpType.orientation, ROCKET_SWEEP_MS_PER_CELL);
      for (const [key, delay] of sweep) setEarliestDelay(delays, key, delay);
    } else if (event.powerUpType.kind === "propeller") {
      const primary = event.affectedPositions[0] ?? event.origin;
      const radial = radialStagger(primary, positions, PROPELLER_SECONDARY_STAGGER_MS, PROPELLER_SECONDARY_STAGGER_MAX_MS);
      for (const position of positions) {
        const key = positionKey(position);
        const delay = key === positionKey(event.origin)
          ? 0
          : PROPELLER_LIFT_MS + PROPELLER_FLIGHT_MS + (radial.get(key) ?? 0);
        setEarliestDelay(delays, key, delay);
      }
    } else if (event.powerUpType.kind === "lightBall") {
      setEarliestDelay(delays, positionKey(event.origin), LIGHTBALL_CHARGE_MS);
      const radial = radialStagger(event.origin, event.affectedPositions, LIGHTBALL_ZAP_STAGGER_MS, LIGHTBALL_TARGET_STAGGER_MAX_MS);
      event.affectedPositions.forEach((position) => {
        const key = positionKey(position);
        if (popKeys.has(key) && snapshot.grid.isValid(position)) {
          setEarliestDelay(delays, key, LIGHTBALL_CHARGE_MS + (radial.get(key) ?? 0));
        }
      });
    }
  }
  return delays;
}

function hasSingleTnt(delta: BoardDelta): boolean {
  return delta.powerUpEvents.some((event) => event.powerUpType.kind === "tnt" && event.trigger.kind !== "combo");
}

function interpolatePath(path: ReadonlyArray<{ x: number; y: number }>, t: number): { x: number; y: number } {
  if (path.length === 0) return { x: 0, y: 0 };
  if (path.length === 1) return path[0];
  const clamped = Phaser.Math.Clamp(t, 0, 1);
  const scaled = clamped * (path.length - 1);
  const index = Math.min(path.length - 2, Math.floor(scaled));
  const local = scaled - index;
  const from = path[index];
  const to = path[index + 1];
  return {
    x: Phaser.Math.Linear(from.x, to.x, local),
    y: Phaser.Math.Linear(from.y, to.y, local)
  };
}

function setEarliestDelay(delays: Map<string, number>, key: string, delay: number): void {
  const current = delays.get(key);
  if (current === undefined || delay < current) delays.set(key, delay);
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

function reducedMotionPowerUpCue(event: PowerUpEvent): PresentationAudioKey {
  if (event.powerUpType.kind === "tnt") return "tntBlast";
  if (event.powerUpType.kind === "rocket") return "rocketImpact";
  if (event.powerUpType.kind === "propeller") return "propellerImpact";
  return "lightBallRelease";
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

function powerUpCreationTint(powerUp: PowerUpType): number {
  if (powerUp.kind === "rocket") return 0x47ddff;
  if (powerUp.kind === "propeller") return 0x70f2ea;
  if (powerUp.kind === "tnt") return 0xff8c42;
  return 0xded2ff;
}
