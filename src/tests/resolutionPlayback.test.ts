import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { BoardEngine, type BoardAction, type LevelDefinition, type BoardResolutionStep } from "../engine";
import { ResolutionPlayback } from "../game/resolutionPlayback";

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
