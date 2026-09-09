import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { BoardEngine, type BoardAction, type LevelDefinition, type BoardResolutionStep } from "../engine";
import { groupResolutionPowerUps, playEffectsTogether, ResolutionPlayback } from "../game/resolutionPlayback";
import { canonicalComboKey, comboChoreographyPlan, comboPowerUpImpacts } from "../game/presentation";

const fixtures = JSON.parse(readFileSync("src/tests/fixtures/resolution/specimens.json", "utf8")) as {
  name: string; level: LevelDefinition; seed: string; actions: BoardAction[];
}[];
const fixture = fixtures.find(item => item.name === "production-level-1-repeated-coordinate")!;
const steps = () => new BoardEngine(fixture.level, fixture.seed).applyWithResolution(fixture.actions[0]).steps;

describe("resolution playback", () => {
  it("awaits each recorded boundary and passes its exact identities without flattening", () => {
    const sequence = steps();
    const seen: BoardResolutionStep[] = [];
    let completeStep = () => {};
    const finished = vi.fn();
    const playback = new ResolutionPlayback(sequence, (step, done) => { seen.push(step); completeStep = done; }, finished);
    playback.start();
    expect(seen).toEqual([sequence[0]]);
    for (let index = 0; index < sequence.length; index++) {
      expect(seen.at(-1)).toBe(sequence[index]);
      expect(finished).not.toHaveBeenCalled();
      completeStep();
    }
    expect(seen).toEqual(sequence);
    expect(finished).toHaveBeenCalledTimes(1);
    expect(seen.filter(step => step.kind === "clear")).toHaveLength(3);
  });

  it("ignores duplicate callbacks and completion after cancellation", () => {
    const callbacks: (() => void)[] = [];
    const finished = vi.fn();
    const playback = new ResolutionPlayback(steps(), (_step, done) => callbacks.push(done), finished);
    playback.start();
    callbacks[0]();
    callbacks[0]();
    expect(callbacks).toHaveLength(2);
    playback.cancel();
    callbacks[1]();
    playback.start();
    expect(callbacks).toHaveLength(2);
    expect(finished).not.toHaveBeenCalled();
  });

  it("handles synchronous boundaries without stack growth or duplicate completion", () => {
    const step = steps()[0];
    const finished = vi.fn();
    const playback = new ResolutionPlayback(Array.from({ length: 10000 }, () => step), (_step, done) => done(), finished);
    playback.start();
    playback.start();
    expect(finished).toHaveBeenCalledTimes(1);
  });

  it("keeps a created rocket visible at creation and while it falls before a later tap", () => {
    const engine = new BoardEngine(fixture.level, fixture.seed);
    const sequence = engine.applyWithResolution({ kind: "swap", from: { row: 2, col: 3 }, to: { row: 3, col: 3 } }).steps;
    const seen: BoardResolutionStep[] = [];
    new ResolutionPlayback(sequence, (step, done) => { seen.push(step); done(); }, () => {}).start();
    const creation = seen.find(step => step.kind === "creation" && step.spawns.some(spawn => spawn.occupantId === 12))!;
    const fall = seen.find(step => step.kind === "gravity" && step.moves.some(move => move.occupantId === 12 && move.powerUp))!;
    expect(creation.ordinal).toBeLessThan(fall.ordinal);
    expect(creation.after.grid.get({ row: 2, col: 4 }).powerUp?.kind).toBe("rocket");
    expect(fall.after.grid.get({ row: 3, col: 4 }).debugTileId).toBe(12);
    const tapped = engine.applyWithResolution({ kind: "tap", at: { row: 3, col: 4 } });
    expect(tapped.steps.flatMap(step => step.activations).find(activation => activation.kind === "single")!.originOccupantId).toBe(12);
  });
});

describe("causal power-up playback", () => {
  const combo = fixtures.find(item => item.name === "combo-rocket_h-tnt")!;
  const groupsFor = (sequence: BoardResolutionStep[]) => {
    const presented = new Set<string>();
    return sequence.flatMap(step => groupResolutionPowerUps(step.activations, presented));
  };

  it("presents a tapped rocket and its secondary TNT as distinct singles before gravity", () => {
    const sequence = new BoardEngine(combo.level, combo.seed)
      .applyWithResolution({ kind: "tap", at: { row: 3, col: 3 } }).steps;
    const firstGravity = sequence.findIndex(step => step.kind === "gravity");
    const groups = groupsFor(sequence.slice(0, firstGravity));
    expect(groups.map(group => group.events[0].powerUpType.kind)).toEqual(["rocket", "tnt"]);
    expect(groups.map(group => group.kind)).toEqual(["single", "single"]);
    expect(groups[1].parentActivationId).toBe(groups[0].activationId);
    expect(groups[1].events[0].trigger.kind).toBe("combo");
  });

  it("keeps a deliberate combo plus a third power-up and deduplicates consumed activation IDs only", () => {
    const level = structuredClone(combo.level);
    Object.assign(level.cellMap[3][5], { tile: null, powerUp: "lightBall" });
    const sequence = new BoardEngine(level, combo.seed).applyWithResolution(combo.actions[0]).steps;
    const records = sequence.flatMap(step => step.activations);
    expect(records.some(record => record.isRepeat)).toBe(true);
    const groups = groupsFor(sequence);
    expect(groups.map(group => group.key ?? group.events[0].powerUpType.kind)).toEqual(["rocket+tnt", "lightBall"]);
    expect(groups[1].kind).toBe("single");
    expect(groups[1].parentActivationId).toBe(groups[0].activationId);
    expect(groups[0].events).toEqual(records.filter(record => record.kind === "combo").map(record => record.event));
    expect(groupsFor(sequence)).toEqual(groups);
  });

  for (const specimen of fixtures.filter(item => item.name.startsWith("combo-"))) {
    it(`retains authored identity and every semantic contact for ${specimen.name}`, () => {
      const sequence = new BoardEngine(specimen.level, specimen.seed).applyWithResolution(specimen.actions[0]).steps;
      const activation = sequence.find(step => step.kind === "activation")!;
      const clear = sequence.find(step => step.kind === "clear")!;
      const group = groupResolutionPowerUps(activation.activations, new Set())[0];
      const sources = activation.activations[0].sources;
      expect(group.key).toBe(canonicalComboKey(sources[0].powerUp, sources[1].powerUp));
      const keys = new Set(clear.clears.map(hit => `${hit.position.row},${hit.position.col}`));
      const plan = comboChoreographyPlan(group, clear.before.rngSeed, false);
      const impacts = comboPowerUpImpacts(group, clear.before, keys, group.activationId);
      expect(new Set(impacts.map(hit => `${hit.position.row},${hit.position.col}`)).size).toBe(impacts.length);
      for (const hit of clear.clears) {
        const contact = impacts.find(item => item.position.row === hit.position.row && item.position.col === hit.position.col)!;
        expect(contact).toBeDefined();
        expect(contact.disposition).toBe("clear");
        const batch = plan.batches.find(item => item.affectedPositions.some(position => position.row === hit.position.row && position.col === hit.position.col));
        expect(contact.atMs).toBe(batch?.atMs ?? plan.impactAtMs);
        expect(contact.compressionStartAtMs + contact.compressionMs).toBe(contact.atMs);
      }
      expect(plan.arcCount).toBeLessThanOrEqual(12);
    });
  }

  it("awaits every distinct effect rather than advancing when the first completes", () => {
    const finished = vi.fn();
    const callbacks: (() => void)[] = [];
    playEffectsTogether(["short rocket", "long light ball"], (_effect, done) => callbacks.push(done), finished);
    expect(callbacks).toHaveLength(2);
    callbacks[0]();
    callbacks[0]();
    expect(finished).not.toHaveBeenCalled();
    callbacks[1]();
    callbacks[1]();
    expect(finished).toHaveBeenCalledTimes(1);
  });

  it("completes empty and synchronously finished effect groups exactly once", () => {
    const emptyFinished = vi.fn();
    playEffectsTogether([], () => { throw new Error("No effects expected"); }, emptyFinished);
    expect(emptyFinished).toHaveBeenCalledTimes(1);
    const finished = vi.fn();
    playEffectsTogether([1, 2], (_effect, done) => { done(); done(); }, finished);
    expect(finished).toHaveBeenCalledTimes(1);
  });
});
