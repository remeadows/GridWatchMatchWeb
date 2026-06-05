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
