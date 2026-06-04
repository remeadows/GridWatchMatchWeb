import type { assetManifest } from "./assetManifest.generated";

export interface HeroInfo {
  id: keyof typeof assetManifest.images.heroes;
  displayName: string;
  description: string;
  unlockAreaId: number | null;
}

export const heroes: HeroInfo[] = [
  { id: "rusty", displayName: "Rusty", description: "Veteran security director. Calm under pressure.", unlockAreaId: null },
  { id: "tee", displayName: "Tee", description: "Protocol specialist. Rewrites the rules.", unlockAreaId: 4 },
  { id: "tish", displayName: "Tish", description: "Deep net operative. Hunts threats in the dark.", unlockAreaId: 7 },
  { id: "helix", displayName: "Helix", description: "Grid war veteran. Ended the final breach.", unlockAreaId: 10 }
];

export const defaultHeroId = "rusty";
