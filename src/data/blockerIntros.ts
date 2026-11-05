import type { BlockerKind } from "../engine/types";

/** What a player is told, once, the first time a mission asks them to deal with a blocker. */
export const blockerIntros: Record<BlockerKind, { title: string; body: string }> = {
  pane: {
    title: "Encrypted pane",
    body: "The piece underneath is frozen. Make matches next to the pane, or hit it with a power-up, to break it. Each move removes one layer."
  },
  lock: {
    title: "Locked cell",
    body: "This piece can't move. Match it, or hit it with a power-up, to free the cell."
  },
  malware: {
    title: "Malware",
    body: "Clear pieces on or next to malware to remove it. If your move removes none, it spreads."
  }
};

/** The blocker a goal asks for, by its objective id. */
export function blockerOfObjective(objectiveId: string): BlockerKind | null {
  return objectiveId === "panes" ? "pane" : objectiveId === "locks" ? "lock" : objectiveId === "malware" ? "malware" : null;
}
