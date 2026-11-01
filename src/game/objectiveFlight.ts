// Pieces that count for an objective fly to it (Russ, 2026-11-01, of the Royal Match recordings:
// "copy this feel - start with the flying pieces"). WEB-ONLY, like the timings in
// src/data/presentationTiming.ts. This file is the arithmetic: where a flight goes, and what the
// objective shows while pieces are in the air. src/game/pieceFlights.ts draws them.

export const OBJECTIVE_FLIGHT_MS = 480;
/** A big clear sends this many at most at a time; the rest count without flying. */
export const OBJECTIVE_FLIGHT_CAP = 14;
/** Pieces of one move leave in a stream, not all at once. */
export const OBJECTIVE_FLIGHT_STAGGER_MS = 35;

/** What one objective is showing while pieces are flying to it. */
export interface ObjectiveFlightCount {
  inAir: number;
  shown: number;
}

export type ObjectiveFlightCounts = Readonly<Record<string, ObjectiveFlightCount>>;

/** The count stops moving at the first takeoff, so that each landing is what moves it. */
export function launchPiece(counts: ObjectiveFlightCounts, objectiveId: string, progress: number): ObjectiveFlightCounts {
  const current = counts[objectiveId];
  return { ...counts, [objectiveId]: { inAir: (current?.inAir ?? 0) + 1, shown: current?.shown ?? progress } };
}

export function landPiece(counts: ObjectiveFlightCounts, objectiveId: string): ObjectiveFlightCounts {
  const current = counts[objectiveId];
  if (!current) return counts;
  if (current.inAir <= 1) {
    const { [objectiveId]: _landed, ...rest } = counts;
    return rest;
  }
  return { ...counts, [objectiveId]: { inAir: current.inAir - 1, shown: current.shown + 1 } };
}

/** A piece over the cap counts at once. */
export function skipPiece(counts: ObjectiveFlightCounts, objectiveId: string): ObjectiveFlightCounts {
  const current = counts[objectiveId];
  return current ? { ...counts, [objectiveId]: { ...current, shown: current.shown + 1 } } : counts;
}

export function objectiveCountShown(counts: ObjectiveFlightCounts, objectiveId: string, progress: number): number {
  const current = counts[objectiveId];
  return current ? Math.min(progress, current.shown) : progress;
}

export interface FlightKeyframe {
  offset: number;
  x: number;
  y: number;
  scale: number;
  opacity: number;
}

const KEYFRAME_COUNT = 9;
const LIFT_SCALE = 1.28;
/** How far the path bows away from the straight line, as a share of its length. */
const BOW = 0.22;

/** The path from a cell to the objective, relative to the cell. `size` and `targetSize` are CSS pixels. */
export function flightKeyframes(
  from: { x: number; y: number },
  to: { x: number; y: number },
  size: number,
  targetSize: number
): FlightKeyframe[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  // Bows toward the middle of the screen's width, so a piece at either edge swings inward.
  const side = dx >= 0 ? 1 : -1;
  const bowX = length === 0 ? 0 : (dy / length) * length * BOW * side;
  const bowY = length === 0 ? 0 : (-dx / length) * length * BOW * side;
  const controlX = dx / 2 + bowX;
  const controlY = dy / 2 + bowY;
  const endScale = size > 0 ? targetSize / size : 1;
  return Array.from({ length: KEYFRAME_COUNT }, (_, index) => {
    const offset = index / (KEYFRAME_COUNT - 1);
    const travel = offset * offset * (1.6 - 0.6 * offset);
    const lift = Math.sin(Math.min(1, offset / 0.5) * Math.PI);
    const scale = index === KEYFRAME_COUNT - 1
      ? endScale
      : 1 + (endScale - 1) * travel + (LIFT_SCALE - 1) * lift;
    const left = 2 * (1 - travel) * travel;
    const right = travel * travel;
    return { offset, x: left * controlX + right * dx, y: left * controlY + right * dy, scale, opacity: 1 };
  });
}
