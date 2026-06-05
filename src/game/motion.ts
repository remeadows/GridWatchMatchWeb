import type { GridPosition } from "../engine";

export interface CentroidStaggerOptions {
  perUnitMs: number;
  maxMs: number;
}

/**
 * Per-position pop delay keyed by `${row},${col}`. Positions near the group's
 * centroid get smaller delays so the pop reads as a wave radiating outward.
 * Mirrors iOS BoardNode.swift `animateClears` centroid-distance delay.
 */
export function computeCentroidStagger(
  positions: ReadonlyArray<GridPosition>,
  options: CentroidStaggerOptions
): Map<string, number> {
  const result = new Map<string, number>();
  if (positions.length === 0) return result;
  let sumRow = 0;
  let sumCol = 0;
  for (const p of positions) {
    sumRow += p.row;
    sumCol += p.col;
  }
  const centroidRow = sumRow / positions.length;
  const centroidCol = sumCol / positions.length;
  for (const p of positions) {
    const distance = Math.hypot(p.row - centroidRow, p.col - centroidCol);
    const delay = Math.min(options.maxMs, Math.round(distance * options.perUnitMs));
    result.set(`${p.row},${p.col}`, delay);
  }
  return result;
}

/**
 * Deterministic angle (degrees) in [-amplitude, +amplitude] derived from a
 * position + seed. Used in place of Phaser.Math.Between so Playwright snapshots
 * of pop animations stay reproducible.
 */
export function seededAngleJitter(
  position: GridPosition,
  seed: string,
  amplitudeDeg: number
): number {
  let hash = 2166136261 >>> 0; // FNV-1a basis
  const input = `${seed}|${position.row},${position.col}`;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const normalized = (hash / 0xffffffff) * 2 - 1; // [-1, 1]
  return normalized * amplitudeDeg;
}
