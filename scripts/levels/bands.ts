// Difficulty bands: the share of first attempts the test bot should fail, by level. Within a sector the target
// rises and falls so no stretch is a wall: the ninth level and the boss are hardest, and the level after a boss
// gives relief.

/** How far a measured fail rate may sit from its target and still count as in band. */
export const BAND_TOLERANCE = 0.07;

const bands: { first: number; last: number; min: number; max: number }[] = [
  { first: 11, last: 30, min: 0.05, max: 0.15 },
  { first: 31, last: 50, min: 0.15, max: 0.3 },
  { first: 51, last: 100, min: 0.3, max: 0.5 },
  { first: 101, last: 200, min: 0.45, max: 0.6 }
];

/** Where in its band a level sits, by its position 1 to 10 in the sector. */
const sectorFractions = [0.15, 0.35, 0.5, 0.35, 0.6, 0.5, 0.7, 0.6, 0.95, 1.0];

/** The [min, max] fail rate band of a level from 11 to 200. */
export function bandFor(levelId: number): [number, number] {
  const band = bands.find((entry) => levelId >= entry.first && levelId <= entry.last);
  if (!band) throw new Error(`Level ${levelId} has no difficulty band: the level tool builds 11 to 200.`);
  return [band.min, band.max];
}

/** 0 at the bottom of the band, 1 at the top. */
export function bandFraction(levelId: number): number {
  return sectorFractions[(levelId - 1) % 10];
}

export function targetFailRate(levelId: number): number {
  const [min, max] = bandFor(levelId);
  return min + bandFraction(levelId) * (max - min);
}
