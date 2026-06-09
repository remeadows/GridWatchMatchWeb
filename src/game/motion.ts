import { cloneCell, type BoardSnapshot, type GridPosition, type MoveEvent, type SpawnEvent } from "../engine";

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
 * Mirrors iOS BoardNode.swift animateRowDestruction rotation jitter.
 * iOS: BoardNode.swift — animateRowDestruction()
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

/**
 * Returns a snapshot equal to `source` but with every position in `poppedKeys`
 * stripped of its baseTile and powerUp (clears do not remove the cell's
 * generator/overlay/underlay/isMovable, matching engine semantics).
 *
 * Caller uses this as the visual "after clears, before cascade" state so that
 * real occupant containers can animate from their original cells down into the
 * post-cascade arrangement instead of materializing as ghosts.
 * Mirrors iOS BoardNode.swift apply(delta:to:completion:) phase boundary.
 * iOS: BoardNode.swift — apply(delta:to:completion:)
 */
/**
 * Returns `moves` ordered so the renderer can safely remap occupant sprites in
 * place — deleting the `from` key and setting the `to` key one move at a time.
 *
 * The remap reads `occupantNodes[from]` then writes `occupantNodes[to]`. When a
 * column collapses, one move's source cell is another move's destination cell
 * (e.g. 2->3 and 1->2 share cell 2). The read of a shared cell must happen
 * before the write that clobbers it, or the renderer picks up the wrong sprite
 * and tiles visibly leak/duplicate during cascades.
 *
 * Sorting by descending `to.row` guarantees that ordering: gravity only moves
 * tiles downward, so whenever cell C is move A's source and move B's
 * destination, A's tile lands strictly below C (A.to.row > C.row == B.to.row).
 * The source-read move therefore always sorts ahead of the destination-write
 * move. The engine already emits bottom-first today, but this keeps the
 * renderer correct regardless of engine emission order. Returns a new array;
 * the input is not mutated.
 */
export function orderCascadeMoves(moves: ReadonlyArray<MoveEvent>): MoveEvent[] {
  return [...moves].sort((a, b) => b.to.row - a.to.row);
}

/**
 * Cells to hide (`${row},${col}`) when rendering the post-clear snapshot before
 * a cascade animates. A cell is hidden so the animating sprite can settle into
 * an empty cell instead of overlapping a statically-drawn occupant.
 *
 * Exception: a landing cell that is ALSO a move source must NOT be hidden. This
 * happens two ways in a collapsing column:
 *   - move-on-move: 0->1, 1->2, 2->3 — the middle cells are both a landing spot
 *     and the source of the move below them.
 *   - spawn-on-source: a tile falls out of a top cell (0->3) and gravity refills
 *     that now-empty cell with a fresh spawn — the spawn target equals the move
 *     source.
 * Hiding such a cell drops the occupant sprite the move needs, so the tile pops
 * into place after the final render instead of animating. The cell is vacated by
 * its own move anyway, so leaving it visible is correct.
 */
export function cascadeHiddenDestinations(
  moves: ReadonlyArray<MoveEvent>,
  spawns: ReadonlyArray<SpawnEvent>
): Set<string> {
  const sources = new Set(moves.map((move) => `${move.from.row},${move.from.col}`));
  const hidden = new Set<string>();
  const hideIfNotSource = (key: string) => {
    if (!sources.has(key)) hidden.add(key);
  };
  for (const move of moves) hideIfNotSource(`${move.to.row},${move.to.col}`);
  for (const spawn of spawns) hideIfNotSource(`${spawn.position.row},${spawn.position.col}`);
  return hidden;
}

export function buildPostClearSnapshot(
  source: BoardSnapshot,
  poppedKeys: ReadonlySet<string>
): BoardSnapshot {
  const grid = source.grid.clone(cloneCell);
  for (const key of poppedKeys) {
    const [rowStr, colStr] = key.split(",");
    const position = { row: Number(rowStr), col: Number(colStr) };
    if (!grid.isValid(position)) continue;
    const cell = grid.get(position);
    grid.set(position, { ...cell, baseTile: null, powerUp: null });
  }
  return { ...source, grid };
}
