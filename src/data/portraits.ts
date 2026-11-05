// Character portraits belong to the web game, not the iOS asset sync. Russ makes them in ChatGPT;
// the sources and the roster (GridWatch-Match-Allied-Villain-Roster-v1.md) are in Google Drive,
// GridWatchArt / 4 - GridWatch Match. Each file here is that 1024 px PNG resized to a 768 px JPEG.

export const allyPortraits = {
  rusty: "assets/images/characters/allies/rusty.jpg",
  tee: "assets/images/characters/allies/tee.jpg",
  tish: "assets/images/characters/allies/tish.jpg",
  helix: "assets/images/characters/allies/helix.jpg",
  neonRonin: "assets/images/characters/allies/neon-ronin.jpg",
  fl3x: "assets/images/characters/allies/fl3x.jpg",
  codex: "assets/images/characters/allies/codex.jpg",
  mack: "assets/images/characters/allies/mack.jpg",
  core: "assets/images/characters/allies/core.jpg",
  june: "assets/images/characters/allies/june.jpg",
  aurora6: "assets/images/characters/allies/aurora-6.jpg"
} as const;

export const villainPortraits = {
  vexis: "assets/images/characters/villains/vexis.jpg",
  kron: "assets/images/characters/villains/kron.jpg",
  zero: "assets/images/characters/villains/zero.jpg",
  ax10m: "assets/images/characters/villains/ax-10m.jpg",
  ax10m2: "assets/images/characters/villains/ax-10m2.jpg",
  dread: "assets/images/characters/villains/dread.jpg",
  vyrus: "assets/images/characters/villains/vyrus.jpg",
  shard: "assets/images/characters/villains/shard.jpg",
  lotus: "assets/images/characters/villains/lotus.jpg",
  malus: "assets/images/characters/villains/malus.jpg",
  architect: "assets/images/characters/villains/the-architect.jpg"
} as const;

export type AllyId = keyof typeof allyPortraits;
export type VillainKey = keyof typeof villainPortraits;
