// Sector recipes for the level tool: what each sector of levels 11-200 is built from. A recipe names its blockers
// (the first is the main one), the board pattern the main blocker is laid out in, and ranges for how many cells are
// blocked, how many layers a pane has and how many moves the level allows. The tuner picks within the ranges.
// Change a recipe here and rebuild: `npm run levels -- build --levels 11-200 --games 200 --out <report>`.

export type BoardPattern = "scattered" | "lowerRows" | "columns" | "corners" | "ring" | "centre" | "dividerRow" | "diagonals" | "mixed";
export type Blocker = "pane" | "lock" | "malware";

export interface SectorRecipe {
  sectorId: number;
  blockers: Blocker[]; // the first is the main blocker
  pattern: BoardPattern;
  /** Cells holding a pane, lock or malware. A divider row's honeypots come on top of these. */
  blockedCells: [number, number];
  paneLayers: [number, number];
  moves: [number, number];
  /** First level each later blocker appears on, for a sector that brings them in one at a time. */
  introducedAt?: Partial<Record<Blocker, number>>;
}

const firstTour: SectorRecipe[] = [
  { sectorId: 2, blockers: ["pane", "lock", "malware"], pattern: "scattered", blockedCells: [4, 8], paneLayers: [1, 1], moves: [24, 28], introducedAt: { lock: 14, malware: 17 } },
  { sectorId: 3, blockers: ["pane"], pattern: "lowerRows", blockedCells: [8, 12], paneLayers: [1, 1], moves: [24, 28] },
  { sectorId: 4, blockers: ["lock"], pattern: "columns", blockedCells: [8, 12], paneLayers: [1, 2], moves: [23, 27] },
  { sectorId: 5, blockers: ["malware", "pane"], pattern: "corners", blockedCells: [6, 10], paneLayers: [1, 2], moves: [23, 27] },
  { sectorId: 6, blockers: ["pane"], pattern: "ring", blockedCells: [12, 16], paneLayers: [1, 2], moves: [24, 28] },
  { sectorId: 7, blockers: ["malware", "lock"], pattern: "centre", blockedCells: [8, 12], paneLayers: [1, 2], moves: [24, 28] },
  { sectorId: 8, blockers: ["lock", "pane"], pattern: "dividerRow", blockedCells: [12, 16], paneLayers: [1, 3], moves: [25, 29] },
  { sectorId: 9, blockers: ["pane", "malware"], pattern: "diagonals", blockedCells: [14, 18], paneLayers: [1, 3], moves: [25, 29] },
  { sectorId: 10, blockers: ["pane", "lock", "malware"], pattern: "mixed", blockedCells: [16, 20], paneLayers: [1, 3], moves: [26, 30] }
];

/**
 * Sector 1 (levels 1-10) is hand-made and has no recipe. Its only blocker is a pair of scattered locks (levels 6
 * and 7), so sector 11 repeats that with sector 2's cell range as the base.
 */
const sectorOneStandIn: SectorRecipe = { sectorId: 1, blockers: ["lock"], pattern: "scattered", blockedCells: [4, 8], paneLayers: [1, 1], moves: [26, 30] };

/**
 * Sectors 11-20 repeat sector n-10 with the same blockers and pattern, 1.4 times the blocked cells, panes of 1-3
 * layers, and sector 10's move range shifted up by 0 at sector 11 rising to 4 at sector 20.
 */
function secondTour(base: SectorRecipe): SectorRecipe {
  const sectorId = base.sectorId + 10;
  const shift = Math.round(((sectorId - 11) * 4) / 9);
  const sectorTen = firstTour[firstTour.length - 1];
  return {
    sectorId,
    blockers: [...base.blockers],
    pattern: base.pattern,
    blockedCells: [Math.round(base.blockedCells[0] * 1.4), Math.round(base.blockedCells[1] * 1.4)],
    paneLayers: [1, 3],
    moves: [sectorTen.moves[0] + shift, sectorTen.moves[1] + shift]
  };
}

export const sectorRecipes: SectorRecipe[] = [...firstTour, ...[sectorOneStandIn, ...firstTour].map(secondTour)];

export function recipeForLevel(levelId: number): SectorRecipe {
  const sectorId = Math.ceil(levelId / 10);
  const recipe = sectorRecipes.find((entry) => entry.sectorId === sectorId);
  if (!recipe) throw new Error(`No recipe for level ${levelId}: the level tool builds 11 to 200.`);
  return recipe;
}
