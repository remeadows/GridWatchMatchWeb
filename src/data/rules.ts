import type { BlockerKind } from "../engine/types";
import { blockerIntros } from "./blockerIntros";

/** The order the rules list the blockers in. */
const blockerKinds: BlockerKind[] = ["pane", "lock", "malware"];

export const rulesSections = [
  {
    title: "Match Tiles",
    rows: [
      "Swap adjacent tiles to line up three or more matching symbols.",
      "Clears can cascade, refill the grid, and trigger more clears."
    ]
  },
  {
    title: "Objectives",
    rows: [
      "Complete every target shown under the mission HUD.",
      "Finish before moves or breach time run out."
    ]
  },
  {
    title: "Power-Ups",
    rows: [
      "Four in a line creates a Rocket that clears a row or column.",
      "L and T patterns create TNT blasts; 2x2 matches create Propellers; five in a line creates a Light Ball.",
      "Swap two power-ups together for amplified effects."
    ]
  },
  {
    title: "Threats",
    rows: [
      ...blockerKinds.map((kind) => `${blockerIntros[kind].title}: ${blockerIntros[kind].body}`),
      "Honeypots generate mission targets below them."
    ]
  },
  {
    title: "Boosters",
    rows: [
      "Use owned boosters from the tray below the board.",
      "Boosters do not spend a move when activated from inventory."
    ]
  }
];

export const tutorialSteps = [
  { title: "Track the mission", message: "Targets live under the HUD. Clear every target before the mission ends.", waitsForMove: false },
  { title: "Make a swap", message: "Swap two adjacent tiles to create a line of three matching symbols.", waitsForMove: true },
  { title: "Build power", message: "Four or more matches create power-ups. Swap two power-ups together for bigger clears.", waitsForMove: false },
  { title: "Break threats", message: "Locked and encrypted cells need focused clears or power-up damage.", waitsForMove: false },
  { title: "Ready", message: "Queue your next move while cascades resolve to keep pressure on the grid.", waitsForMove: false }
];
