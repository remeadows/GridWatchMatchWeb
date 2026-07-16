import type { GridPosition, PowerUpEvent, PowerUpType } from "../engine";
import {
  CASCADE_FALL_BASE_MS,
  CASCADE_FALL_MAX_MS,
  CASCADE_FALL_MIN_MS,
  CASCADE_FALL_PER_CELL_MS,
  CASCADE_LANDING_SQUASH_MS,
  CASCADE_LANDING_SETTLE_MS,
  CASCADE_START_AFTER_IMPACT_MS,
  CHAIN_PLAYBACK_RATE_MAX_DEPTH,
  CHAIN_PLAYBACK_RATE_STEP,
  MATCH_IMPACT_MS,
  MATCH_POP_COMPRESSION_MS,
  MATCH_RECOGNITION_HOLD_MS,
  SWAP_SETTLE_MS,
  SWAP_TRAVEL_MS,
  TILE_POP_PLAYBACK_RATE_MAX,
  TILE_POP_PLAYBACK_RATE_MIN
} from "../data/presentationTiming";

export type CanonicalComboKey =
  | "rocket+rocket"
  | "propeller+rocket"
  | "rocket+tnt"
  | "lightBall+rocket"
  | "propeller+propeller"
  | "propeller+tnt"
  | "lightBall+propeller"
  | "tnt+tnt"
  | "lightBall+tnt"
  | "lightBall+lightBall";

export interface PowerUpPresentationGroup {
  kind: "single" | "combo";
  key: CanonicalComboKey | null;
  events: readonly PowerUpEvent[];
  affectedPositions: readonly GridPosition[];
}

export interface MatchTimeline {
  swapTravelMs: number;
  swapSettleMs: number;
  recognitionHoldMs: number;
  popCompressionMs: number;
  impactMs: number;
  maxStaggerMs: number;
  cascadeStartAfterImpactMs: number;
  totalMs: number;
}

export interface TilePopVariation {
  sample: "tile_pop_a" | "tile_pop_b";
  playbackRate: number;
}

export interface PresentationTraceEntry {
  sequenceId: number;
  atMs: number;
  plannedAtMs: number;
  kind: string;
  detail?: string;
}

export interface PieceDisplayProfile {
  pieceSizePx: number;
  powerUpSizePx: number;
  shadowWidthPx: number;
  shadowHeightPx: number;
}

export function canonicalComboKey(left: PowerUpType, right: PowerUpType): CanonicalComboKey {
  return [left.kind, right.kind].sort().join("+") as CanonicalComboKey;
}

export function groupPowerUpEvents(events: ReadonlyArray<PowerUpEvent>): PowerUpPresentationGroup[] {
  const groups: PowerUpPresentationGroup[] = [];

  for (const event of events) {
    const key = event.trigger.kind === "combo"
      ? canonicalComboKey(event.powerUpType, event.trigger.with)
      : null;
    const previous = groups.at(-1);
    if (key && previous?.kind === "combo" && previous.key === key) {
      groups[groups.length - 1] = {
        ...previous,
        events: [...previous.events, event],
        affectedPositions: [...previous.affectedPositions, ...event.affectedPositions]
      };
      continue;
    }

    groups.push({
      kind: key ? "combo" : "single",
      key,
      events: [event],
      affectedPositions: event.affectedPositions
    });
  }

  return groups;
}

export function matchTimeline(maxStaggerMs: number): MatchTimeline {
  const stagger = clampFinite(maxStaggerMs, 0, 64);
  const cascadeCompletionMs = CASCADE_START_AFTER_IMPACT_MS + CASCADE_FALL_MAX_MS + CASCADE_LANDING_SQUASH_MS + CASCADE_LANDING_SETTLE_MS;
  const impactCompletionMs = MATCH_IMPACT_MS + stagger;

  return {
    swapTravelMs: SWAP_TRAVEL_MS,
    swapSettleMs: SWAP_SETTLE_MS,
    recognitionHoldMs: MATCH_RECOGNITION_HOLD_MS,
    popCompressionMs: MATCH_POP_COMPRESSION_MS,
    impactMs: MATCH_IMPACT_MS,
    maxStaggerMs: stagger,
    cascadeStartAfterImpactMs: CASCADE_START_AFTER_IMPACT_MS,
    totalMs: SWAP_TRAVEL_MS + SWAP_SETTLE_MS + MATCH_RECOGNITION_HOLD_MS + MATCH_POP_COMPRESSION_MS + Math.max(impactCompletionMs, cascadeCompletionMs)
  };
}

export function cascadeFallDurationMs(distanceCells: number): number {
  const distance = Math.max(0, Number.isFinite(distanceCells) ? distanceCells : 0);
  return Math.min(CASCADE_FALL_MAX_MS, Math.max(CASCADE_FALL_MIN_MS, CASCADE_FALL_BASE_MS + distance * CASCADE_FALL_PER_CELL_MS));
}

export function eventIntensity(affectedCount: number, isCombo: boolean): number {
  const count = Math.max(0, Number.isFinite(affectedCount) ? affectedCount : 0);
  return Math.min(1, (isCombo ? 0.55 : 0.2) + count * 0.09);
}

export function tilePopVariation(position: GridPosition, seed: string): TilePopVariation {
  const hash = stableHash(`${seed}|${position.row},${position.col}`);
  const sample = hash % 2 === 0 ? "tile_pop_a" : "tile_pop_b";
  const rateSteps = 1200;
  const playbackRate = TILE_POP_PLAYBACK_RATE_MIN + ((hash >>> 1) % (rateSteps + 1)) * (TILE_POP_PLAYBACK_RATE_MAX - TILE_POP_PLAYBACK_RATE_MIN) / rateSteps;
  return { sample, playbackRate };
}

export function chainPlaybackRate(depth: number): number {
  const normalizedDepth = Math.min(CHAIN_PLAYBACK_RATE_MAX_DEPTH, Math.max(1, Math.floor(Number.isFinite(depth) ? depth : 1)));
  return 1 + (normalizedDepth - 1) * CHAIN_PLAYBACK_RATE_STEP;
}

export function pieceDisplayProfile(tileSize: number): PieceDisplayProfile {
  const size = Math.max(32, Number.isFinite(tileSize) ? tileSize : 32);
  const pieceSizePx = size * 0.85;
  return {
    pieceSizePx,
    powerUpSizePx: pieceSizePx * 1.08,
    shadowWidthPx: pieceSizePx * 0.72,
    shadowHeightPx: pieceSizePx * 0.16
  };
}

function clampFinite(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function stableHash(input: string): number {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}
