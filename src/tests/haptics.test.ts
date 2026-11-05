import { describe, expect, it } from "vitest";
import { HAPTICS, HAPTIC_MIN_GAP_MS, HAPTIC_TICK_SPACING_MS, Haptics, isAppleTouchDevice, type HapticEnvironment } from "../services/haptics";
import { defaultSaveState, normalizeSave } from "../state/save";

// Russ, 2026-11-05: "phone haptics so when pieces move, explode, fall, etc the player feels it".

function rig(kind: "android" | "iphone" | "none") {
  let clock = 1_000;
  const vibrations: number[][] = [];
  const ticks: number[] = [];
  const pending: Array<{ at: number; run: () => void }> = [];
  const env: HapticEnvironment = {
    now: () => clock,
    vibrate: kind === "android" ? (pattern) => { vibrations.push(pattern); } : null,
    tick: kind === "iphone" ? () => { ticks.push(clock); } : null,
    later: (run, ms) => { pending.push({ at: clock + ms, run }); }
  };
  const advance = (ms: number) => {
    const until = clock + ms;
    for (const job of pending.filter((entry) => entry.at <= until).sort((a, b) => a.at - b.at)) {
      pending.splice(pending.indexOf(job), 1);
      clock = job.at;
      job.run();
    }
    clock = until;
  };
  return { haptics: new Haptics(env), vibrations, ticks, advance };
}

describe("haptics", () => {
  it("vibrates an Android phone with the moment's pattern", () => {
    const { haptics, vibrations } = rig("android");
    haptics.pulse("swap");
    expect(vibrations).toEqual([HAPTICS.swap.pattern]);
  });

  it("ticks an iPhone once for a light moment and several times, spaced, for a heavy one", () => {
    const { haptics, ticks, advance } = rig("iphone");
    haptics.pulse("swap");
    expect(ticks).toEqual([1_000]);
    advance(500);
    haptics.pulse("bigCombo");
    advance(HAPTIC_TICK_SPACING_MS * 3);
    expect(ticks).toEqual([1_000, 1_500, 1_500 + HAPTIC_TICK_SPACING_MS, 1_500 + 2 * HAPTIC_TICK_SPACING_MS]);
  });

  it("does nothing where the device has neither", () => {
    const { haptics, vibrations, ticks } = rig("none");
    expect(() => haptics.pulse("blast")).not.toThrow();
    expect(vibrations).toEqual([]);
    expect(ticks).toEqual([]);
  });

  it("stays still when the player switches Haptics off", () => {
    const { haptics, vibrations } = rig("android");
    haptics.configure({ hapticsEnabled: false });
    haptics.pulse("blast");
    expect(vibrations).toEqual([]);
    haptics.configure({ hapticsEnabled: true });
    haptics.pulse("blast");
    expect(vibrations).toHaveLength(1);
  });

  it("never lets a landing cut off a blast that is still playing", () => {
    const { haptics, vibrations, advance } = rig("android");
    haptics.pulse("blast");
    advance(HAPTIC_MIN_GAP_MS + 10);
    haptics.pulse("land");
    expect(vibrations).toEqual([HAPTICS.blast.pattern]);
    advance(200);
    haptics.pulse("land");
    expect(vibrations).toEqual([HAPTICS.blast.pattern, HAPTICS.land.pattern]);
  });

  it("lets a heavier moment through at once, and drops pulses that would blur into one buzz", () => {
    const { haptics, vibrations, advance } = rig("android");
    haptics.pulse("land");
    haptics.pulse("blast");
    expect(vibrations).toEqual([HAPTICS.land.pattern, HAPTICS.blast.pattern]);
    advance(200);
    haptics.pulse("match");
    advance(HAPTIC_MIN_GAP_MS - 5);
    haptics.pulse("match");
    expect(vibrations).toHaveLength(3);
  });

  it("knows an iPhone, and an iPad that calls itself a Mac, from a desktop", () => {
    expect(isAppleTouchDevice({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X)", maxTouchPoints: 5 })).toBe(true);
    expect(isAppleTouchDevice({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 5, platform: "MacIntel" })).toBe(true);
    expect(isAppleTouchDevice({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 0, platform: "MacIntel" })).toBe(false);
  });

  it("is on by default, and an old save without the setting gets it on", () => {
    expect(defaultSaveState().settings.hapticsEnabled).toBe(true);
    const old = normalizeSave({ settings: { musicEnabled: false, sfxEnabled: true, voiceEnabled: true, reducedMotion: false } } as never);
    expect(old.settings.hapticsEnabled).toBe(true);
    expect(old.settings.musicEnabled).toBe(false);
  });
});
