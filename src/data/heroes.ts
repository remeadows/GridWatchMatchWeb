import type { AllyId } from "./portraits";

export interface HeroInfo {
  id: AllyId;
  displayName: string;
  description: string;
}

// Every ally is open from the start (Russ, 2026-11-03). Roles follow the character cards and roster in
// Drive, GridWatchArt / 0 - Gridwatch-Assets (GridWatch-Character-Roster-v6.md).
export const heroes: HeroInfo[] = [
  { id: "rusty", displayName: "Rusty", description: "Engineer and communications. The team's eye in the sky." },
  { id: "tee", displayName: "Tee", description: "Street intel and hacker. Never forgets a rumor." },
  { id: "tish", displayName: "Tish", description: "Sniper and overwatch. Watches from above." },
  { id: "helix", displayName: "Helix", description: "The Light. Unaware of her own power." },
  { id: "neonRonin", displayName: "Neon Ronin", description: "Team leader. Built for stealth and agile combat." },
  { id: "fl3x", displayName: "F.L.3.X", description: "Close-quarters combat." },
  { id: "codex", displayName: "Codex", description: "Keeper and analyst." },
  { id: "mack", displayName: "MACK", description: "Field operative in prototype armor." },
  { id: "core", displayName: "CORE", description: "Bionic GridWatch operative." },
  { id: "june", displayName: "June", description: "Field engineer. Autonomous robotic warfare." },
  { id: "aurora6", displayName: "AURORA-6", description: "AI guardian." }
];

export const defaultHeroId = "rusty";
