// MUST mirror worker/validation.ts starsFor — change together (parity test: src/tests/stars.test.ts).
export interface StarMoves {
  two: number;
  three: number;
}

/** Stars for a win with `movesLeft` moves unused. Without thresholds: 50% left is 3 stars, 20% is 2. */
export function starsForMovesLeft(movesLeft: number, moveLimit: number, starMoves?: StarMoves): number {
  if (starMoves) {
    if (movesLeft >= starMoves.three) return 3;
    if (movesLeft >= starMoves.two) return 2;
    return 1;
  }
  const ratio = movesLeft / Math.max(1, moveLimit);
  if (ratio >= 0.5) return 3;
  if (ratio >= 0.2) return 2;
  return 1;
}
