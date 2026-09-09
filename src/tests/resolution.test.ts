import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { BoardEngine, positionKey, type BoardAction, type BoardDelta, type BoardSnapshot, type BoosterType, type LevelDefinition } from "../engine";

interface Specimen {
  name: string;
  level: LevelDefinition;
  seed: string;
  actions: BoardAction[];
  initial: unknown;
  before: unknown;
  expected: { delta: BoardDelta | null; error: { code: string | null; message: string } | null; snapshot: unknown; actionLog: BoardAction[] };
}
interface CorpusRun {
  level: number;
  seed: string;
  initialHash: string;
  actions: (number | string)[][];
  outcomes: string[];
}
const read = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8"));
const specimens = read<Specimen[]>("src/tests/fixtures/resolution/specimens.json");
const specimen = (name: string) => specimens.find(item => item.name === name)!;
const cascade = specimen("production-level-1-repeated-coordinate");
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
    : value;
const serialize = (value: unknown) => JSON.stringify(canonical(value));
const snapshotRecord = (snapshot: BoardSnapshot) => ({ ...snapshot, grid: {
  rows: snapshot.grid.rows, cols: snapshot.grid.cols,
  cells: snapshot.grid.allPositions.map(position => snapshot.grid.get(position))
} });
const digest = (value: unknown) => createHash("sha256").update(serialize(value)).digest("base64url");
const decode = (action: (number | string)[]): BoardAction => action[0] === 0
  ? { kind: "swap", from: { row: Number(action[1]), col: Number(action[2]) }, to: { row: Number(action[3]), col: Number(action[4]) } }
  : action[0] === 1 ? { kind: "tap", at: { row: Number(action[1]), col: Number(action[2]) } }
    : { kind: "activateBooster", booster: action[1] as BoosterType, at: { row: Number(action[2]), col: Number(action[3]) } };

describe("ordered engine resolution", () => {
  it("captures all three clear/gravity/refill boundaries in the recorded Level 1 cascade", () => {
    const engine = new BoardEngine(cascade.level, cascade.seed);
    const { delta, steps } = engine.applyWithResolution(cascade.actions[0]);
    expect(delta.chainDepth).toBe(2);
    expect(steps.filter(step => step.kind === "clear")).toHaveLength(3);
    expect(steps.filter(step => step.kind === "gravity")).toHaveLength(3);
    expect(steps.filter(step => step.kind === "refill")).toHaveLength(3);
    expect(steps[0].kind).toBe("action");
    expect(steps.at(-1)!.kind).toBe("settled");
    steps.forEach((step, index) => {
      expect(step.ordinal).toBe(index);
      if (index > 0) expect(snapshotRecord(step.before)).toEqual(snapshotRecord(steps[index - 1].after));
      if (step.kind === "gravity") {
        expect(step.spawns).toHaveLength(0);
        expect(step.after.rngSeed).toBe(step.before.rngSeed);
        expect(step.after.grid.allPositions.some(p => step.after.grid.get(p).debugTileId === null)).toBe(true);
        expect(steps[index + 1].kind).toBe("refill");
      }
    });
    expect(snapshotRecord(steps.at(-1)!.after)).toEqual(snapshotRecord(engine.snapshot));
  });

  it("distinguishes different occupants cleared at the same coordinate in later waves", () => {
    const { steps } = new BoardEngine(cascade.level, cascade.seed).applyWithResolution(cascade.actions[0]);
    const idsByCell = new Map<string, Set<number | null>>();
    for (const step of steps) for (const clear of step.clears) {
      const key = positionKey(clear.position);
      const ids = idsByCell.get(key) ?? new Set();
      ids.add(clear.occupantId);
      idsByCell.set(key, ids);
      expect(step.before.grid.get(clear.position).debugTileId).toBe(clear.occupantId);
    }
    expect([...idsByCell.values()].filter(ids => ids.size > 1)).toHaveLength(2);
  });

  it("detaches frames and metadata from later actions, returned deltas, and adjacent frames", () => {
    const engine = new BoardEngine(cascade.level, cascade.seed);
    const { steps, delta } = engine.applyWithResolution(cascade.actions[0]);
    const first = serialize(snapshotRecord(steps[0].after));
    const clear = steps.find(step => step.clears.length > 0)!.clears[0];
    const savedClear = serialize(clear);
    delta.clears[0].position.row = -1;
    expect(serialize(clear)).toBe(savedClear);
    steps[1].before.grid.get({ row: 0, col: 0 }).baseTile = null;
    engine.applyWithResolution(engine.validMoves()[0]);
    expect(serialize(snapshotRecord(steps[0].after))).toBe(first);
  });

  it("does not allocate optional snapshot frames through legacy apply", () => {
    const engine = new BoardEngine(cascade.level, cascade.seed);
    const snapshot = vi.spyOn(engine, "snapshot", "get");
    engine.apply(cascade.actions[0]);
    expect(snapshot).not.toHaveBeenCalled();
  });

  it("records damage without inventing cleared occupants", () => {
    const fixture = specimen("damage-only");
    const { steps } = new BoardEngine(fixture.level, fixture.seed).applyWithResolution(fixture.actions[0]);
    const clear = steps.find(step => step.kind === "clear")!;
    expect(clear.clears).toHaveLength(0);
    expect(clear.hits.length).toBeGreaterThan(0);
    expect(clear.hits.every(hit => hit.disposition === "damage")).toBe(true);
    for (const hit of clear.hits) {
      expect(clear.after.grid.get(hit.position).debugTileId).toBe(hit.occupantId);
      expect(clear.after.grid.get(hit.position).overlay?.hp).toBeLessThan(clear.before.grid.get(hit.position).overlay!.hp);
      expect(hit.activationId).not.toBeNull();
    }
  });

  it("distinguishes deliberate combo participants, a third power-up, and repeated consumed origins", () => {
    const fixture = specimen("combo-rocket_h-tnt");
    const level = structuredClone(fixture.level);
    Object.assign(level.cellMap[3][5], { tile: null, powerUp: "lightBall" });
    const engine = new BoardEngine(level, fixture.seed);
    const thirdId = engine.snapshot.grid.get({ row: 3, col: 5 }).debugTileId;
    const { delta, steps } = engine.applyWithResolution(fixture.actions[0]);
    const activations = steps.flatMap(step => step.activations);
    expect(activations.map(activation => activation.event)).toEqual(delta.powerUpEvents);
    const combo = activations.find(activation => activation.kind === "combo")!;
    expect(combo.sources).toHaveLength(2);
    expect(combo.parentActivationId).toBeNull();
    expect(combo.initiatingAction).toEqual(fixture.actions[0]);
    const third = activations.find(activation => activation.kind === "secondary" && activation.originOccupantId === thirdId)!;
    expect(third.isRepeat).toBe(false);
    expect(third.parentActivationId).toBe(combo.activationId);
    expect(third.event.trigger.kind).toBe("combo");
    expect(activations.some(activation => activation.isRepeat && activation.activationId === combo.activationId)).toBe(true);
    expect(new Set(activations.map(activation => activation.eventId)).size).toBe(activations.length);
  });

  it("retains a created power-up identity through a subsequent tap action", () => {
    const fixture = specimen("created-power-up-then-tapped");
    const engine = new BoardEngine(fixture.level, fixture.seed);
    const created = engine.applyWithResolution(fixture.actions[0]).steps
      .filter(step => step.kind === "creation").flatMap(step => step.spawns);
    expect(created.length).toBeGreaterThan(0);
    const second = engine.applyWithResolution(fixture.actions[1]);
    const activation = second.steps.flatMap(step => step.activations).find(event => event.kind === "single")!;
    expect(created.map(spawn => spawn.occupantId)).toContain(activation.originOccupantId);
  });

  it("records reshuffle separately from gravity", () => {
    const fixture = specimen("post-resolution-shuffle");
    const engine = new BoardEngine(fixture.level, fixture.seed);
    for (const action of fixture.actions.slice(0, -1)) engine.apply(action);
    const { delta, steps } = engine.applyWithResolution(fixture.actions.at(-1)!);
    expect(delta.shuffleAttempts).toBeGreaterThan(0);
    const shuffle = steps.find(step => step.kind === "shuffle")!;
    expect(shuffle.moves.length).toBeGreaterThan(0);
    expect(shuffle.spawns).toHaveLength(0);
    const ids = (snapshot: BoardSnapshot) => snapshot.grid.allPositions.map(p => snapshot.grid.get(p).debugTileId).sort();
    expect(ids(shuffle.after)).toEqual(ids(shuffle.before));
  });

  it("preserves generator and lock boundaries and records objective changes", () => {
    const fixture = specimen("generator-and-lock");
    const { delta, steps } = new BoardEngine(fixture.level, fixture.seed).applyWithResolution(fixture.actions[0]);
    for (const step of steps) {
      for (const position of step.before.grid.allPositions) {
        const before = step.before.grid.get(position);
        if (before.generator) expect(step.after.grid.get(position).generator).toBe(before.generator);
      }
      for (const move of step.moves) {
        expect(step.before.grid.get(move.from).debugTileId).toBe(move.occupantId);
        expect(step.after.grid.get(move.to).debugTileId).toBe(move.occupantId);
        expect(step.before.grid.get(move.from).isMovable).toBe(true);
      }
      for (const spawn of step.spawns) expect(spawn.occupantId).toBeGreaterThan(0);
    }
    const objectiveTotals: Record<string, number> = {};
    for (const step of steps) for (const event of step.objectiveEvents) {
      objectiveTotals[event.objectiveId] = (objectiveTotals[event.objectiveId] ?? 0) + event.progressDelta;
    }
    expect(objectiveTotals).toEqual(Object.fromEntries(delta.objectiveEvents.map(event => [event.objectiveId, event.progressDelta])));
  });

  it("records propagation when malware survives outside the TNT blast", () => {
    const fixture = specimen("generator-and-lock");
    const level = structuredClone(fixture.level);
    level.cellMap[1][1].underlay = "malware_1";
    const { steps } = new BoardEngine(level, fixture.seed).applyWithResolution(fixture.actions[0]);
    expect(steps.some(step => step.kind === "malware" && step.cellChanges.length > 0)).toBe(true);
    expect(fixture.level.cellMap[1][1].underlay).toBeNull();
  });
});

for (const method of ["apply", "applyWithResolution"] as const) {
  const apply = (engine: BoardEngine, action: BoardAction) => method === "apply" ? engine.apply(action) : engine.applyWithResolution(action).delta;
  const outcome = (engine: BoardEngine, action: BoardAction) => {
    let delta = null;
    let error = null;
    try { delta = apply(engine, action); }
    catch (caught) {
      const failure = caught as Error & { code?: string };
      error = { code: failure.code ?? null, message: failure.message };
    }
    return { delta, error, snapshot: snapshotRecord(engine.snapshot), actionLog: engine.actionLog() };
  };
  describe(`${method} frozen outcome compatibility`, () => {
    it.each(specimens)("preserves $name", fixture => {
      const engine = new BoardEngine(fixture.level, fixture.seed);
      expect(canonical(snapshotRecord(engine.snapshot))).toEqual(fixture.initial);
      for (const action of fixture.actions.slice(0, -1)) apply(engine, action);
      expect(canonical(snapshotRecord(engine.snapshot))).toEqual(fixture.before);
      expect(canonical(outcome(engine, fixture.actions.at(-1)!))).toEqual(fixture.expected);
    });

    it("matches all 34,054 frozen actions over 100 levels and 20 sensitivity seeds", () => {
      const runs = read<CorpusRun[]>("src/tests/fixtures/resolution/corpus.json");
      const levels = new Map<number, LevelDefinition>();
      let actions = 0;
      for (const run of runs) {
        if (!levels.has(run.level)) levels.set(run.level, read(`public/levels/level_${String(run.level).padStart(3, "0")}.json`));
        const engine = new BoardEngine(levels.get(run.level)!, run.seed);
        expect(digest(snapshotRecord(engine.snapshot))).toBe(run.initialHash);
        run.actions.forEach((action, index) => {
          expect(digest(outcome(engine, decode(action))), `${run.level}/${run.seed} action ${index}`).toBe(run.outcomes[index]);
          actions++;
        });
      }
      expect(actions).toBe(34054);
      expect(runs).toHaveLength(2000);
    }, 120000);
  });
}
