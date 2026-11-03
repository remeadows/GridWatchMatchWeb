import type { CellDefinition, LevelDefinition, ObjectiveDefinition, TileType } from "../../engine";

const TILES: Record<string, TileType> = { p: "packet", f: "firewall", k: "key", t: "threat", z: "zeroDay" };

/**
 * Builds a level from a text board, one string per row, tokens separated by spaces.
 *   p f k t z   a piece (packet, firewall, key, threat, zeroDay)
 *   p#2         a piece under a 2-layer pane
 *   p!          a locked piece
 *   p~1         a piece on 1-layer malware
 *   H           a honeypot
 * The engine needs at least a 5 x 5 board.
 */
export function testLevel(
  rows: string[],
  options: { moveLimit?: number; objectives?: ObjectiveDefinition[] } = {}
): LevelDefinition {
  const cellMap = rows.map((row) => row.trim().split(/\s+/).map(parseToken));
  const weights: Partial<Record<TileType, number>> = { packet: 0.25, firewall: 0.25, key: 0.25, threat: 0.25 };
  return {
    id: 9001,
    name: "Test board",
    gridRows: rows.length,
    gridCols: cellMap[0].length,
    moveLimit: options.moveLimit ?? 30,
    objectives: options.objectives ?? [{ id: "clear", target: 999, displayName: "Clear", tileType: null }],
    cellMap,
    spawnWeights: weights,
    bossLevel: false,
    bonusLevel: false
  };
}

function parseToken(token: string): CellDefinition {
  if (token === "H") {
    return { tile: null, powerUp: null, overlay: null, underlay: null, generator: "honeypot", locked: true };
  }
  const match = token.match(/^([pfktz])(?:#([1-3])|(!)|~([1-2]))?$/);
  if (!match) throw new Error(`testLevel: bad token "${token}"`);
  return {
    tile: TILES[match[1]],
    powerUp: null,
    overlay: match[2] ? `encryptedVolume_${match[2]}` : null,
    underlay: match[4] ? `malware_${match[4]}` : null,
    generator: null,
    locked: match[3] === "!"
  };
}
