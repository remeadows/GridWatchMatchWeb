import type { GridPosition, PowerUpEvent, PowerUpType, SpawnEvent } from "../engine";
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
  COMBO_ARC_CAP,
  COMBO_BATCH_PARTICLE_CAP,
  COMBO_CHOREOGRAPHY_TIMING,
  COMBO_PROJECTILE_CAP,
  MATCH_IMPACT_MS,
  MATCH_POP_COMPRESSION_MS,
  MATCH_RECOGNITION_HOLD_MS,
  MATCH_WAVE_MAX_MS,
  LIGHTBALL_CHARGE_MS,
  LIGHTBALL_RELEASE_DELAY_MS,
  LIGHTBALL_WAVE_CONCURRENCY_CAP,
  LIGHTBALL_WAVE_COUNT,
  LIGHTBALL_WAVE_STAGGER_MS,
  PROPELLER_FLIGHT_MS,
  PROPELLER_LIFT_MS,
  PROPELLER_RETICLE_DELAY_MS,
  PROPELLER_SECONDARY_STAGGER_MS,
  PROPELLER_SEQUENCE_BUDGET_MS,
  ROCKET_IGNITION_MS,
  ROCKET_LANE_FLIGHT_MS,
  SWAP_SETTLE_MS,
  SWAP_TRAVEL_MS,
  TNT_ARM_AT_MS,
  TNT_CASCADE_AFTER_DETONATION_MS,
  TNT_CHARGE_AT_MS,
  TNT_DETONATION_AT_MS,
  TNT_RADIAL_IMPACT_MAX_MS,
  TNT_RADIAL_IMPACT_STAGGER_MS,
  TNT_SEQUENCE_BUDGET_MS,
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

export type SinglePowerUpEffectKey = "rocket" | "propeller" | "tnt" | "lightBall";
export type PresentationEffectKey = SinglePowerUpEffectKey | CanonicalComboKey;
export type PresentationViewportProfile = "desktop" | "mobile";

export const PRESENTATION_RESOURCE_LIMITS = {
  concurrentEmitters: 12,
  liveParticles: {
    desktop: 180,
    mobile: 110
  },
  simultaneousArcs: 12,
  activeBoardAudio: 16,
  boardAudioSlotMs: 120,
  cleanupTailBufferMs: 250,
  reducedMotionStableMs: 180
} as const;

export interface PresentationResourcePlan {
  totalDurationMs: number;
  concurrentEmitters: number;
  liveParticles: number;
  simultaneousArcs: number;
  activeBoardAudio: number;
  screenFlashes: number;
  travel: boolean;
  shake: boolean;
}

export interface PowerUpPresentationGroup {
  kind: "single" | "combo";
  key: CanonicalComboKey | null;
  events: readonly PowerUpEvent[];
  affectedPositions: readonly GridPosition[];
}

export type ComboVisualKind = "lane-pass" | "drone-strike" | "blast" | "conversion" | "dissolve";

export interface ComboVisualBatch {
  atMs: number;
  kind: ComboVisualKind;
  affectedPositions: GridPosition[];
}

export interface ComboEventPlan {
  eventIndex: number;
  origin: GridPosition;
  affectedPositions: GridPosition[];
}

export interface ComboCuePlan {
  kind: "combo-charge" | "combo-impact";
  atMs: number;
  gain: number;
}

export interface ComboChoreographyPlan {
  key: CanonicalComboKey;
  center: GridPosition;
  chargeAtMs: number;
  impactAtMs: number;
  cascadeAtMs: number;
  batches: ComboVisualBatch[];
  cues: ComboCuePlan[];
  events: ComboEventPlan[];
  finalStatePositions: GridPosition[];
  projectileCount: number;
  arcCount: number;
  particleCount: number;
  screenFlashCount: number;
}

export interface CreatedPowerUpSpawn {
  position: GridPosition;
  powerUp: PowerUpType;
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

export interface TntDetonationPlan {
  armAtMs: number;
  chargeAtMs: number;
  detonationAtMs: number;
  impactAtMs: number[];
  cascadeStartAtMs: number;
  sequenceBudgetMs: number;
}

export interface RocketPassPlan {
  position: GridPosition;
  atMs: number;
}

export interface RocketLaneHeadPlan {
  destination: GridPosition;
  direction: -1 | 1;
  flightMs: number;
  impactAtMs: number;
  passTimes: RocketPassPlan[];
}

export interface RocketLanePlan {
  ignitionMs: number;
  heads: RocketLaneHeadPlan[];
}

export interface PropellerFlightPoint {
  atMs: number;
  phase: "lift" | "arc" | "approach" | "impact";
  x: number;
  y: number;
}

export interface PropellerFlightPlan {
  flightAtMs: number;
  impactAtMs: number;
  liftAtMs: number;
  points: PropellerFlightPoint[];
  reticleAtMs: number;
  secondaryImpactAtMs: number[];
  sequenceBudgetMs: number;
  target: GridPosition;
}

export interface LightBallWavePlan {
  concurrencyCap: number;
  releaseAtMs: number;
  waves: Array<{ atMs: number; targets: GridPosition[] }>;
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

export function presentationResourcePlan(
  effect: PresentationEffectKey,
  affectedCount: number,
  viewport: PresentationViewportProfile,
  reducedMotion: boolean
): PresentationResourcePlan {
  const count = Math.max(0, Math.floor(Number.isFinite(affectedCount) ? affectedCount : 0));
  if (reducedMotion) {
    return {
      totalDurationMs: Math.min(120, PRESENTATION_RESOURCE_LIMITS.reducedMotionStableMs),
      concurrentEmitters: 0,
      liveParticles: 0,
      simultaneousArcs: 0,
      activeBoardAudio: 1,
      screenFlashes: 0,
      travel: false,
      shake: false
    };
  }

  const combo = isPresentationComboKey(effect);
  const totalDurationMs = combo
    ? COMBO_CHOREOGRAPHY_TIMING[effect].cascadeMs
    : singleEffectDurationMs(effect);
  const requestedEmitters = combo ? 4 + Math.ceil(count / 5) : 3 + Math.ceil(count / 4);
  const requestedParticles = combo ? 48 + count * 5 : 24 + count * 4;
  const requestedArcs = effect.includes("lightBall")
    ? count
    : effect.includes("propeller") || effect.includes("rocket")
      ? Math.ceil(count / 2)
      : 0;

  return {
    totalDurationMs,
    concurrentEmitters: Math.min(PRESENTATION_RESOURCE_LIMITS.concurrentEmitters, requestedEmitters),
    liveParticles: Math.min(PRESENTATION_RESOURCE_LIMITS.liveParticles[viewport], requestedParticles),
    simultaneousArcs: Math.min(PRESENTATION_RESOURCE_LIMITS.simultaneousArcs, requestedArcs),
    activeBoardAudio: Math.min(PRESENTATION_RESOURCE_LIMITS.activeBoardAudio, combo ? 4 : 3),
    screenFlashes: effect.includes("tnt") || effect.includes("lightBall") ? 1 : 0,
    travel: effect !== "tnt",
    shake: effect === "tnt" || combo
  };
}

export function groupPowerUpEvents(events: ReadonlyArray<PowerUpEvent>): PowerUpPresentationGroup[] {
  const groups: PowerUpPresentationGroup[] = [];

  for (const event of events) {
    const key = event.trigger.kind === "combo"
      ? comboKeyForEvent(event)
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

function comboKeyForEvent(event: PowerUpEvent): CanonicalComboKey {
  const key = event.trigger.kind === "combo"
    ? canonicalComboKey(event.powerUpType, event.trigger.with)
    : null;
  if (key !== "tnt+tnt") return key!;
  const hasDistantEndpoint = event.affectedPositions.some((position) => (
    Math.max(Math.abs(position.row - event.origin.row), Math.abs(position.col - event.origin.col)) > 2
  ));
  return hasDistantEndpoint ? "rocket+tnt" : "tnt+tnt";
}

export function comboChoreographyPlan(
  group: PowerUpPresentationGroup,
  seed: string,
  reducedMotion: boolean
): ComboChoreographyPlan {
  if (group.kind !== "combo" || !group.key) throw new Error("Combo choreography requires one canonical combo group");
  const key = group.key;
  const timing = COMBO_CHOREOGRAPHY_TIMING[key];
  const events = group.events.map((event, eventIndex) => ({
    eventIndex,
    origin: { ...event.origin },
    affectedPositions: event.affectedPositions.map((position) => ({ ...position }))
  }));
  const finalStatePositions = uniquePositions(group.affectedPositions);
  const center = centroidPosition(group.events.map((event) => event.origin));

  if (reducedMotion) {
    return {
      key,
      center,
      chargeAtMs: 0,
      impactAtMs: 0,
      cascadeAtMs: 0,
      batches: [],
      cues: [{ kind: "combo-impact", atMs: 0, gain: 0.28 }],
      events,
      finalStatePositions,
      projectileCount: 0,
      arcCount: 0,
      particleCount: 0,
      screenFlashCount: 0
    };
  }

  const batches = spatialComboBatches(
    finalStatePositions,
    center,
    timing.batchCount,
    timing.impactMs,
    timing.cascadeMs,
    comboVisualKind(key),
    seed
  );
  const counts = comboPrimitiveCounts(key, group.events.length, batches.length);
  return {
    key,
    center,
    chargeAtMs: timing.chargeMs,
    impactAtMs: timing.impactMs,
    cascadeAtMs: timing.cascadeMs,
    batches,
    cues: [
      { kind: "combo-charge", atMs: 0, gain: 0.62 },
      { kind: "combo-impact", atMs: timing.impactMs, gain: 0.76 }
    ],
    events,
    finalStatePositions,
    projectileCount: Math.min(COMBO_PROJECTILE_CAP, counts.projectiles),
    arcCount: Math.min(PRESENTATION_RESOURCE_LIMITS.simultaneousArcs, COMBO_ARC_CAP, counts.arcs),
    particleCount: Math.min(COMBO_BATCH_PARTICLE_CAP, counts.particles),
    screenFlashCount: 1
  };
}

export function comboOverlayPositions(plan: ComboChoreographyPlan): GridPosition[] {
  const count = Math.min(plan.arcCount, plan.finalStatePositions.length);
  if (count === 0) return [];
  return Array.from({ length: count }, (_, index) => (
    plan.finalStatePositions[Math.floor(index * plan.finalStatePositions.length / count)]
  ));
}

export function createdPowerUpSpawns(spawns: ReadonlyArray<SpawnEvent>): CreatedPowerUpSpawn[] {
  return spawns.flatMap((spawn) => (
    spawn.asPowerUp ? [{ position: spawn.position, powerUp: spawn.asPowerUp }] : []
  ));
}

export function tntDetonationPlan(origin: GridPosition, affectedPositions: ReadonlyArray<GridPosition>): TntDetonationPlan {
  const impactAtMs = [...affectedPositions]
    .sort((left, right) => manhattanDistance(origin, left) - manhattanDistance(origin, right))
    .map((position) => TNT_DETONATION_AT_MS + Math.min(
      TNT_RADIAL_IMPACT_MAX_MS,
      manhattanDistance(origin, position) * TNT_RADIAL_IMPACT_STAGGER_MS
    ));
  return {
    armAtMs: TNT_ARM_AT_MS,
    chargeAtMs: TNT_CHARGE_AT_MS,
    detonationAtMs: TNT_DETONATION_AT_MS,
    impactAtMs,
    cascadeStartAtMs: TNT_DETONATION_AT_MS + TNT_CASCADE_AFTER_DETONATION_MS,
    sequenceBudgetMs: TNT_SEQUENCE_BUDGET_MS
  };
}

export function rocketLanePlan(
  origin: GridPosition,
  orientation: "horizontal" | "vertical",
  rows: number,
  cols: number
): RocketLanePlan {
  const laneLength = orientation === "horizontal" ? Math.max(1, Math.floor(cols)) : Math.max(1, Math.floor(rows));
  const originIndex = orientation === "horizontal" ? origin.col : origin.row;
  const clampedOriginIndex = Math.min(laneLength - 1, Math.max(0, originIndex));

  return {
    ignitionMs: ROCKET_IGNITION_MS,
    heads: ([-1, 1] as const).map((direction) => {
      const destinationIndex = direction === -1 ? 0 : laneLength - 1;
      const distance = Math.abs(destinationIndex - clampedOriginIndex);
      const passTimes = Array.from({ length: distance + 1 }, (_, step) => {
        const index = clampedOriginIndex + direction * step;
        const position = orientation === "horizontal"
          ? { row: origin.row, col: index }
          : { row: index, col: origin.col };
        return {
          position,
          atMs: ROCKET_IGNITION_MS + Math.round(ROCKET_LANE_FLIGHT_MS * step / Math.max(1, distance))
        };
      });
      const destination = passTimes.at(-1)!.position;

      return {
        destination,
        direction,
        flightMs: ROCKET_LANE_FLIGHT_MS,
        impactAtMs: passTimes.at(-1)!.atMs,
        passTimes
      };
    })
  };
}

export function propellerFlightPlan(
  origin: GridPosition,
  affectedPositions: ReadonlyArray<GridPosition>
): PropellerFlightPlan {
  const target = affectedPositions[0] ?? origin;
  const flightAtMs = PROPELLER_LIFT_MS + 1;
  const reticleAtMs = flightAtMs + PROPELLER_RETICLE_DELAY_MS;
  const impactAtMs = PROPELLER_LIFT_MS + PROPELLER_FLIGHT_MS;
  const lift = { x: origin.col, y: origin.row - 0.35 };
  const arc = {
    x: (lift.x + target.col) / 2,
    y: Math.min(lift.y, target.row) - Math.max(0.8, Math.abs(target.col - origin.col) * 0.28)
  };
  const approach = {
    x: target.col + (arc.x - target.col) * 0.14,
    y: target.row + (arc.y - target.row) * 0.14
  };

  return {
    target,
    liftAtMs: PROPELLER_LIFT_MS,
    flightAtMs,
    reticleAtMs,
    impactAtMs,
    points: [
      { phase: "lift", atMs: PROPELLER_LIFT_MS, ...lift },
      { phase: "arc", atMs: flightAtMs + Math.round(PROPELLER_FLIGHT_MS * 0.42), ...arc },
      { phase: "approach", atMs: impactAtMs - Math.round(PROPELLER_FLIGHT_MS * 0.16), ...approach },
      { phase: "impact", atMs: impactAtMs, x: target.col, y: target.row }
    ],
    secondaryImpactAtMs: affectedPositions.slice(1).map((_, index) => (
      impactAtMs + (index + 1) * PROPELLER_SECONDARY_STAGGER_MS
    )),
    sequenceBudgetMs: PROPELLER_SEQUENCE_BUDGET_MS
  };
}

export function lightBallWavePlan(
  origin: GridPosition,
  affectedPositions: ReadonlyArray<GridPosition>,
  seed: string
): LightBallWavePlan {
  const targets = [...affectedPositions].sort((left, right) => (
    stableHash(`${seed}|${origin.row},${origin.col}|${left.row},${left.col}`) -
    stableHash(`${seed}|${origin.row},${origin.col}|${right.row},${right.col}`)
  ));
  const concurrencyCap = Math.max(LIGHTBALL_WAVE_CONCURRENCY_CAP, Math.ceil(targets.length / 5));
  const waveCount = Math.min(5, Math.max(LIGHTBALL_WAVE_COUNT, Math.ceil(targets.length / concurrencyCap)));
  const waves = Array.from({ length: waveCount }, (_, index) => ({
    atMs: LIGHTBALL_CHARGE_MS + index * LIGHTBALL_WAVE_STAGGER_MS,
    targets: targets.filter((_, targetIndex) => targetIndex % waveCount === index)
  })).filter((wave) => wave.targets.length > 0);
  return {
    concurrencyCap,
    waves,
    releaseAtMs: (waves.at(-1)?.atMs ?? LIGHTBALL_CHARGE_MS) + LIGHTBALL_RELEASE_DELAY_MS
  };
}

export function matchTimeline(maxStaggerMs: number): MatchTimeline {
  const stagger = clampFinite(maxStaggerMs, 0, MATCH_WAVE_MAX_MS);
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

function isPresentationComboKey(effect: PresentationEffectKey): effect is CanonicalComboKey {
  return effect.includes("+");
}

function singleEffectDurationMs(effect: SinglePowerUpEffectKey): number {
  if (effect === "tnt") return TNT_SEQUENCE_BUDGET_MS;
  if (effect === "rocket") return ROCKET_IGNITION_MS + ROCKET_LANE_FLIGHT_MS + 280;
  if (effect === "propeller") return PROPELLER_SEQUENCE_BUDGET_MS;
  return LIGHTBALL_CHARGE_MS + LIGHTBALL_WAVE_STAGGER_MS * 4 + LIGHTBALL_RELEASE_DELAY_MS * 2;
}

function comboVisualKind(key: CanonicalComboKey): ComboVisualKind {
  if (key === "rocket+rocket") return "lane-pass";
  if (key === "propeller+rocket" || key === "propeller+propeller" || key === "lightBall+propeller") return "drone-strike";
  if (key === "lightBall+rocket") return "conversion";
  if (key === "lightBall+lightBall") return "dissolve";
  return "blast";
}

function comboPrimitiveCounts(
  key: CanonicalComboKey,
  eventCount: number,
  batchCount: number
): { projectiles: number; arcs: number; particles: number } {
  const projectiles: Record<CanonicalComboKey, number> = {
    "rocket+rocket": 4,
    "propeller+rocket": 3,
    "rocket+tnt": 2,
    "lightBall+rocket": Math.max(4, eventCount * 2),
    "propeller+propeller": 2,
    "propeller+tnt": 3,
    "lightBall+propeller": Math.max(4, eventCount),
    "tnt+tnt": 0,
    "lightBall+tnt": 0,
    "lightBall+lightBall": 0
  };
  const arcs: Record<CanonicalComboKey, number> = {
    "rocket+rocket": 4,
    "propeller+rocket": 6,
    "rocket+tnt": 2,
    "lightBall+rocket": 8,
    "propeller+propeller": 4,
    "propeller+tnt": 6,
    "lightBall+propeller": 12,
    "tnt+tnt": 2,
    "lightBall+tnt": 10,
    "lightBall+lightBall": 12
  };
  return {
    projectiles: projectiles[key],
    arcs: arcs[key],
    particles: 24 + batchCount * 14
  };
}

function spatialComboBatches(
  positions: ReadonlyArray<GridPosition>,
  center: GridPosition,
  desiredCount: number,
  impactAtMs: number,
  cascadeAtMs: number,
  kind: ComboVisualKind,
  seed: string
): ComboVisualBatch[] {
  if (positions.length === 0) return [];
  const count = Math.min(desiredCount, positions.length);
  const sorted = [...positions].sort((left, right) => {
    const distance = euclideanDistanceSquared(center, left) - euclideanDistanceSquared(center, right);
    if (distance !== 0) return distance;
    return stableHash(`${seed}|${left.row},${left.col}`) - stableHash(`${seed}|${right.row},${right.col}`);
  });
  const batches = Array.from({ length: count }, (_, index) => ({
    atMs: impactAtMs + Math.round((cascadeAtMs - impactAtMs - 150) * index / Math.max(1, count - 1)),
    kind,
    affectedPositions: [] as GridPosition[]
  }));
  sorted.forEach((position, index) => batches[index % count].affectedPositions.push(position));
  return batches;
}

function centroidPosition(positions: ReadonlyArray<GridPosition>): GridPosition {
  if (positions.length === 0) return { row: 0, col: 0 };
  return {
    row: Math.round(positions.reduce((sum, position) => sum + position.row, 0) / positions.length),
    col: Math.round(positions.reduce((sum, position) => sum + position.col, 0) / positions.length)
  };
}

function uniquePositions(positions: ReadonlyArray<GridPosition>): GridPosition[] {
  const unique = new Map<string, GridPosition>();
  for (const position of positions) unique.set(`${position.row},${position.col}`, { ...position });
  return [...unique.values()];
}

function euclideanDistanceSquared(left: GridPosition, right: GridPosition): number {
  const row = left.row - right.row;
  const col = left.col - right.col;
  return row * row + col * col;
}

function stableHash(input: string): number {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

function manhattanDistance(left: GridPosition, right: GridPosition): number {
  return Math.abs(left.row - right.row) + Math.abs(left.col - right.col);
}
