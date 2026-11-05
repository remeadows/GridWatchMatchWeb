import { describe, expect, it } from "vitest";
import { HAPTICS, HAPTIC_MIN_GAP_MS, Haptics, type HapticEnvironment } from "../services/haptics";
import { defaultSaveState, normalizeSave } from "../state/save";

// Russ, 2026-11-05: "phone haptics so when pieces move, explode, fall, etc the player feels it".

function rig(kind: "android" | "none") {
  let clock = 1_000;
  const vibrations: number[][] = [];
  const env: HapticEnvironment = {
    now: () => clock,
    vibrate: kind === "android" ? (pattern) => { vibrations.push(pattern); } : null
  };
  return { haptics: new Haptics(env), vibrations, advance: (ms: number) => { clock += ms; } };
}

describe("haptics", () => {
  it("vibrates an Android phone with the moment's pattern", () => {
    const { haptics, vibrations } = rig("android");
    haptics.pulse("swap");
    expect(vibrations).toEqual([HAPTICS.swap.pattern]);
  });

  it("does nothing on a device that cannot vibrate, an iPhone among them, and says so to Settings", () => {
    const { haptics, vibrations } = rig("none");
    expect(haptics.supported).toBe(false);
    expect(() => haptics.pulse("blast")).not.toThrow();
    expect(vibrations).toEqual([]);
    expect(rig("android").haptics.supported).toBe(true);
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

  it("is on by default, and an old save without the setting gets it on", () => {
    expect(defaultSaveState().settings.hapticsEnabled).toBe(true);
    const old = normalizeSave({ settings: { musicEnabled: false, sfxEnabled: true, voiceEnabled: true, reducedMotion: false } } as never);
    expect(old.settings.hapticsEnabled).toBe(true);
    expect(old.settings.musicEnabled).toBe(false);
  });
});
