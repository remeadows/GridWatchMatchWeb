import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BoardEngine, type BoardAction, type BoardResolutionStep, type LevelDefinition } from "../engine";
import { advancePlayClock, PlaybackLifecycle, playbackHudAtStep, playbackRecoveryBudgetMs, TerminalPlayback } from "../game/playbackLifecycle";

const specimens = JSON.parse(readFileSync("src/tests/fixtures/resolution/specimens.json", "utf8")) as {
  name: string; level: LevelDefinition; seed: string; actions: BoardAction[];
}[];
const specimen = specimens.find(item => item.name === "combo-rocket_h-tnt")!;
const resolution = new BoardEngine(specimen.level, specimen.seed).applyWithResolution(specimen.actions[0]);

describe("terminal elapsed-time playback", () => {
  const options = { rows: 7, leadMs: 150, staggerMs: 300, popMs: 250, holdMs: 300 };

  it("uses elapsed time for every row and the full 2500 ms ending", () => {
    const timeline = new TerminalPlayback(1_000, options);
    expect(timeline.update(1_149).rowIndex).toBeNull();
    for (let row = 0; row < 7; row++) {
      expect(timeline.update(1_150 + row * 300)).toEqual({ rowIndex: row, complete: false });
    }
    expect(timeline.update(3_499).complete).toBe(false);
    expect(timeline.update(3_500).complete).toBe(true);
    expect(timeline.update(4_000).complete).toBe(false);
  });

  it("excludes hidden time without allowing a stale sample to double charge", () => {
    const timeline = new TerminalPlayback(0, options);
    expect(timeline.update(150).rowIndex).toBe(0);
    timeline.setPaused(true, 200);
    expect(timeline.update(10_000).rowIndex).toBeNull();
    timeline.setPaused(false, 10_200);
    expect(timeline.update(10_199).rowIndex).toBeNull();
    expect(timeline.update(10_450).rowIndex).toBe(1);
  });

  it("never bunches overdue rows or completes before the last row opens and holds", () => {
    const timeline = new TerminalPlayback(0, options);
    for (let row = 0; row < 7; row++) {
      const now = 3_000 + row * 250;
      expect(timeline.update(now)).toEqual({ rowIndex: row, complete: false });
      expect(timeline.update(now + 1)).toEqual({ rowIndex: null, complete: false });
    }
    expect(timeline.update(5_049).complete).toBe(false);
    expect(timeline.update(5_050).complete).toBe(true);
  });

  it("cancels every remaining row and completion on teardown", () => {
    const timeline = new TerminalPlayback(0, options);
    timeline.update(150);
    timeline.cancel();
    expect(timeline.update(10_000)).toEqual({ rowIndex: null, complete: false });
  });
});

describe("playback lifecycle", () => {
  it("keeps three waiting actions and never drains while an animation is active", () => {
    const gate = new PlaybackLifecycle<string>();
    expect(gate.begin(1)).toBe(true);
    for (const action of ["a", "b", "c"]) expect(gate.enqueue(action)).toBe(true);
    expect(gate.enqueue("overflow")).toBe(false);
    expect(gate.queueDepth).toBe(3);
    expect(gate.next()).toBeUndefined();
    expect(gate.complete(99)).toBe(false);
    expect(gate.next()).toBeUndefined();
    expect(gate.complete(1)).toBe(true);
    expect(gate.next()).toBe("a");
    expect(gate.begin(2)).toBe(true);
    expect(gate.next()).toBeUndefined();
  });

  it("ignores duplicate and stale completions after navigation or a new run", () => {
    const gate = new PlaybackLifecycle<string>();
    gate.begin(4);
    gate.enqueue("old action");
    gate.reset();
    expect(gate.begin(4)).toBe(false);
    expect(gate.begin(5)).toBe(true);
    expect(gate.complete(4)).toBe(false);
    expect(gate.activeId).toBe(5);
    expect(gate.queueDepth).toBe(0);
    expect(gate.complete(5)).toBe(true);
    expect(gate.complete(5)).toBe(false);
  });

  it("discards queued actions on a terminal outcome but still awaits the active effect", () => {
    const gate = new PlaybackLifecycle<string>();
    gate.begin(1);
    gate.enqueue("later");
    gate.stop();
    expect(gate.activeId).toBe(1);
    expect(gate.queueDepth).toBe(0);
    expect(gate.enqueue("late")).toBe(false);
    expect(gate.next()).toBeUndefined();
    expect(gate.complete(1)).toBe(true);
    expect(gate.begin(2)).toBe(false);
    gate.reset();
    expect(gate.begin(2)).toBe(true);
  });

  it("does not drain while the page is suspended", () => {
    const gate = new PlaybackLifecycle<string>();
    gate.enqueue("next");
    gate.suspend(true);
    expect(gate.next()).toBeUndefined();
    gate.suspend(false);
    expect(gate.next()).toBe("next");
  });
});

describe("controllable play clock", () => {
  it("charges monotonic visible play time, including fractional seconds", () => {
    let clock = { remainingMs: 10_000, lastAtMs: 100, running: true };
    clock = advancePlayClock(clock, 435, true);
    clock = advancePlayClock(clock, 1_310, true);
    expect(clock.remainingMs).toBe(8_790);
  });

  it("does not charge forced playback, a hidden page, or a result transition", () => {
    let clock = { remainingMs: 10_000, lastAtMs: 100, running: true };
    clock = advancePlayClock(clock, 500, false);
    clock = advancePlayClock(clock, 65_000, false);
    clock = advancePlayClock(clock, 70_000, true);
    expect(clock.remainingMs).toBe(9_600);
    clock = advancePlayClock(clock, 70_500, false);
    expect(clock.remainingMs).toBe(9_100);
  });

  it("cannot double charge elapsed time after a backward or repeated sample", () => {
    let clock = { remainingMs: 10_000, lastAtMs: 100, running: true };
    clock = advancePlayClock(clock, 600, true);
    clock = advancePlayClock(clock, 200, true);
    clock = advancePlayClock(clock, 600, true);
    clock = advancePlayClock(clock, 800, true);
    expect(clock.remainingMs).toBe(9_300);
  });

  it("reaches zero once without producing negative time or reviving the clock", () => {
    let clock = { remainingMs: 200, lastAtMs: 100, running: true };
    clock = advancePlayClock(clock, 500, true);
    expect(clock).toMatchObject({ remainingMs: 0, running: false });
    expect(advancePlayClock(clock, 10_000, true).remainingMs).toBe(0);
  });
});

describe("stage HUD and recovery budget", () => {
  it("shows partial score and objective progress at clear boundaries, then the exact final values", () => {
    const clears = resolution.steps.filter(step => step.kind === "clear" && step.clears.length > 0);
    expect(clears.length).toBeGreaterThan(1);
    const first = playbackHudAtStep(resolution.steps, clears[0].ordinal, 100, 100 + resolution.delta.scoreGained)!;
    expect(first.score).toBeGreaterThan(100);
    expect(first.score).toBeLessThan(100 + resolution.delta.scoreGained);
    expect(first.objectiveProgress).toEqual(clears[0].after.objectiveProgress);
    const final = playbackHudAtStep(resolution.steps, resolution.steps.at(-1)!.ordinal, 100, 100 + resolution.delta.scoreGained)!;
    expect(final.score).toBe(100 + resolution.delta.scoreGained);
    expect(final.objectiveProgress).toEqual(resolution.steps.at(-1)!.after.objectiveProgress);
  });

  it("keeps every displayed score bounded and monotonic without changing authoritative data", () => {
    const before = JSON.stringify(resolution);
    const scores = resolution.steps.map(step => playbackHudAtStep(resolution.steps, step.ordinal, 137, 137 + resolution.delta.scoreGained)!.score);
    expect(scores[0]).toBe(137);
    expect(scores.every((score, index) => score >= 137 && score <= 137 + resolution.delta.scoreGained && (index === 0 || score >= scores[index - 1]))).toBe(true);
    expect(JSON.stringify(resolution)).toBe(before);
    expect(playbackHudAtStep(resolution.steps, -1, 0, 100)).toBeNull();
  });

  it("publishes damage-only objective changes even when no occupant is removed", () => {
    const damage = { ...resolution.steps[0], ordinal: 0, kind: "clear" as const, clears: [],
      after: { ...resolution.steps[0].after, objectiveProgress: { damage: 1 } } };
    const final = { ...damage, ordinal: 1, kind: "settled" as const };
    expect(playbackHudAtStep([damage, final], 0, 0, 0)).toMatchObject({ score: 0, objectiveProgress: { damage: 1 } });
  });

  it("derives recovery headroom from every pending animated stage, without a global chain cap", () => {
    const costs: Record<BoardResolutionStep["kind"], number> = {
      action: 235, activation: 0, clear: 1_500, creation: 310, gravity: 730, refill: 730, malware: 0, shuffle: 235, settled: 0
    };
    const short = playbackRecoveryBudgetMs(resolution.steps.slice(0, 3), costs);
    const full = playbackRecoveryBudgetMs(resolution.steps, costs);
    expect(full).toBeGreaterThan(short);
    const nominal = resolution.steps.reduce((sum, step) => sum + costs[step.kind], 0);
    expect(full).toBeGreaterThan(nominal);
    expect(playbackRecoveryBudgetMs([...resolution.steps, ...resolution.steps], costs)).toBeGreaterThan(full);
  });
});
