import type { AllyId } from "./portraits";

export interface HeroInfo {
  id: AllyId;
  displayName: string;
  description: string;
}

// Every ally is open from the start (Russ, 2026-11-03). Descriptions follow his roster.
export const heroes: HeroInfo[] = [
  { id: "rusty", displayName: "Rusty", description: "Veteran security director. Calm under pressure." },
  { id: "tee", displayName: "Tee", description: "Protocol specialist. Rewrites the rules." },
  { id: "tish", displayName: "Tish", description: "Deep net operative. Hunts threats in the dark." },
  { id: "helix", displayName: "Helix", description: "The Light. Grid war veteran." },
  { id: "neonRonin", displayName: "Neon Ronin", description: "Lead operative." },
  { id: "fl3x", displayName: "F.L.3.X", description: "Close-quarters combat operative." },
  { id: "codex", displayName: "Codex", description: "Keeper and analyst." },
  { id: "mack", displayName: "MACK", description: "Field operative." },
  { id: "core", displayName: "CORE", description: "Bionic operative." },
  { id: "june", displayName: "June", description: "GridWatch operative." },
  { id: "aurora6", displayName: "AURORA-6", description: "GridWatch operative." }
];

export const defaultHeroId = "rusty";
