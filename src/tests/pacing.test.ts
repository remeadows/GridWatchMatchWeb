import { describe, expect, it } from "vitest";
import { matchPacingPlan } from "../game/presentation";

describe("connected match pacing", () => {
  const first = [0, 1, 2].map(col => ({ position: { row: 0, col }, tileType: "packet" as const }));
  const remote = [4, 5, 6].map(col => ({ position: { row: 6, col }, tileType: "packet" as const }));

  it("keeps each connected group's timing independent of a distant match", () => {
    const alone = matchPacingPlan(first, 0);
    const together = matchPacingPlan([...first, ...remote], 0);
    expect(together.groups).toHaveLength(2);
    expect(together.impacts.filter(hit => hit.position.row === 0)).toEqual(alone.impacts);
    const middle = together.impacts.find(hit => hit.position.row === 0 && hit.position.col === 1)!;
    const edge = together.impacts.find(hit => hit.position.row === 0 && hit.position.col === 0)!;
    expect(middle.atMs).toBeLessThan(edge.atMs);
  });

  it("separates touching tile families and is stable under input order and duplicates", () => {
    const touching = first.map(cell => ({ position: { ...cell.position, row: 1 }, tileType: "firewall" as const }));
    const cells = [...first, ...touching];
    const before = JSON.stringify(cells);
    const plan = matchPacingPlan(cells, 0);
    expect(plan.groups).toHaveLength(2);
    expect(matchPacingPlan([...cells].reverse().concat(first), 0)).toEqual(plan);
    expect(JSON.stringify(cells)).toBe(before);
  });

  it("places gravity after the last required impact and a distinct open-cell hold", () => {
    const wide = Array.from({ length: 7 }, (_, col) => ({ position: { row: 3, col }, tileType: "packet" as const }));
    const plan = matchPacingPlan(wide, 0);
    expect(new Set(plan.impacts.map(hit => hit.atMs)).size).toBeGreaterThan(1);
    for (const hit of plan.impacts) {
      expect(hit.atMs - hit.compressionStartAtMs).toBe(plan.compressionMs);
      expect(plan.gravityNotBeforeMs - hit.atMs).toBeGreaterThanOrEqual(plan.openHoldMs);
    }
    expect(plan.lastImpactAtMs).toBe(Math.max(...plan.impacts.map(hit => hit.atMs)));
    expect(plan.gravityNotBeforeMs).toBe(plan.lastImpactAtMs + plan.openHoldMs);
    expect(plan.openHoldMs).toBeGreaterThan(0);
  });

  it("uses a shorter but visible recognition beat for later settled waves", () => {
    const initial = matchPacingPlan(first, 0);
    const cascade = matchPacingPlan(first, 1);
    expect(cascade.recognitionHoldMs).toBeGreaterThan(0);
    expect(cascade.recognitionHoldMs).toBeLessThan(initial.recognitionHoldMs);
    expect(cascade.compressionMs).toBe(initial.compressionMs);
    expect(cascade.impacts.every(hit => hit.compressionStartAtMs >= cascade.recognitionHoldMs)).toBe(true);
    expect(matchPacingPlan([], 1).impacts).toEqual([]);
  });
});
