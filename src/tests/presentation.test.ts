import { describe, expect, it } from "vitest";
import type { PowerUpEvent, PowerUpType } from "../engine";
import {
  canonicalComboKey,
  cascadeFallDurationMs,
  chainPlaybackRate,
  eventIntensity,
  groupPowerUpEvents,
  matchTimeline,
  pieceDisplayProfile,
  tilePopVariation
} from "../game/presentation";

const rocketHorizontal: PowerUpType = { kind: "rocket", orientation: "horizontal" };
const rocketVertical: PowerUpType = { kind: "rocket", orientation: "vertical" };
const propeller: PowerUpType = { kind: "propeller" };
const tnt: PowerUpType = { kind: "tnt" };
const lightBall: PowerUpType = { kind: "lightBall" };

function powerUpEvent(
  powerUpType: PowerUpType,
  trigger: PowerUpEvent["trigger"],
  row: number,
  col: number
): PowerUpEvent {
  return {
    powerUpType,
    origin: { row, col },
    affectedPositions: [{ row, col }, { row, col: col + 1 }],
    trigger
  };
}

describe("canonicalComboKey", () => {
  it("returns the ten canonical unordered combo keys", () => {
    expect(canonicalComboKey(rocketHorizontal, rocketVertical)).toBe("rocket+rocket");
    expect(canonicalComboKey(propeller, rocketHorizontal)).toBe("propeller+rocket");
    expect(canonicalComboKey(rocketHorizontal, tnt)).toBe("rocket+tnt");
    expect(canonicalComboKey(lightBall, rocketHorizontal)).toBe("lightBall+rocket");
    expect(canonicalComboKey(propeller, propeller)).toBe("propeller+propeller");
    expect(canonicalComboKey(propeller, tnt)).toBe("propeller+tnt");
    expect(canonicalComboKey(lightBall, propeller)).toBe("lightBall+propeller");
    expect(canonicalComboKey(tnt, tnt)).toBe("tnt+tnt");
    expect(canonicalComboKey(lightBall, tnt)).toBe("lightBall+tnt");
    expect(canonicalComboKey(lightBall, lightBall)).toBe("lightBall+lightBall");
  });

  it("ignores rocket orientation and input order", () => {
    expect(canonicalComboKey(rocketHorizontal, propeller)).toBe("propeller+rocket");
    expect(canonicalComboKey(rocketVertical, propeller)).toBe("propeller+rocket");
  });
});

describe("groupPowerUpEvents", () => {
  it("keeps singles separate and groups only adjacent matching combo events", () => {
    const tap = powerUpEvent(tnt, { kind: "tap" }, 0, 0);
    const comboA = powerUpEvent(rocketHorizontal, { kind: "combo", with: propeller }, 1, 0);
    const comboB = powerUpEvent(propeller, { kind: "combo", with: rocketVertical }, 1, 2);
    const swap = powerUpEvent(lightBall, { kind: "swap" }, 2, 0);
    const comboC = powerUpEvent(tnt, { kind: "combo", with: rocketHorizontal }, 3, 0);

    const groups = groupPowerUpEvents([tap, comboA, comboB, swap, comboC]);

    expect(groups).toHaveLength(4);
    expect(groups[0].events).toEqual([tap]);
    expect(groups[1].key).toBe("propeller+rocket");
    expect(groups[1].events).toEqual([comboA, comboB]);
    expect(groups[1].affectedPositions).toEqual([
      ...comboA.affectedPositions,
      ...comboB.affectedPositions
    ]);
    expect(groups[2].events).toEqual([swap]);
    expect(groups[3].key).toBe("rocket+tnt");
    expect(groups[3].events).toEqual([comboC]);
  });
});

describe("matchTimeline", () => {
  it("uses named phases and completes an ordinary match within the feel budget", () => {
    const timeline = matchTimeline(64);

    expect(timeline.swapTravelMs).toBeGreaterThanOrEqual(150);
    expect(timeline.swapTravelMs).toBeLessThanOrEqual(175);
    expect(timeline.swapSettleMs).toBeGreaterThanOrEqual(45);
    expect(timeline.swapSettleMs).toBeLessThanOrEqual(60);
    expect(timeline.recognitionHoldMs).toBeGreaterThanOrEqual(45);
    expect(timeline.recognitionHoldMs).toBeLessThanOrEqual(65);
    expect(timeline.popCompressionMs).toBeGreaterThanOrEqual(35);
    expect(timeline.popCompressionMs).toBeLessThanOrEqual(50);
    expect(timeline.impactMs).toBeGreaterThanOrEqual(100);
    expect(timeline.impactMs).toBeLessThanOrEqual(140);
    expect(timeline.maxStaggerMs).toBe(64);
    expect(timeline.cascadeStartAfterImpactMs).toBeGreaterThanOrEqual(80);
    expect(timeline.cascadeStartAfterImpactMs).toBeLessThanOrEqual(150);
    expect(timeline.totalMs).toBeLessThanOrEqual(900);
  });
});

describe("cascadeFallDurationMs", () => {
  it("uses distance-based falls with the specified minimum and cap", () => {
    expect(cascadeFallDurationMs(1)).toBe(165);
    expect(cascadeFallDurationMs(2)).toBeGreaterThan(cascadeFallDurationMs(1));
    expect(cascadeFallDurationMs(7)).toBe(320);
  });
});

describe("eventIntensity", () => {
  it("is monotonic and capped for singles and combos", () => {
    expect(eventIntensity(3, false)).toBeLessThan(eventIntensity(5, false));
    expect(eventIntensity(5, false)).toBeLessThanOrEqual(1);
    expect(eventIntensity(6, true)).toBeGreaterThan(eventIntensity(6, false));
    expect(eventIntensity(999, true)).toBe(1);
  });
});

describe("tilePopVariation", () => {
  it("is deterministic and only returns approved samples and playback rates", () => {
    const a = tilePopVariation({ row: 3, col: 4 }, "seed-1");
    const b = tilePopVariation({ row: 3, col: 4 }, "seed-1");

    expect(a).toEqual(b);
    expect(["tile_pop_a", "tile_pop_b"]).toContain(a.sample);
    expect(a.playbackRate).toBeGreaterThanOrEqual(0.94);
    expect(a.playbackRate).toBeLessThanOrEqual(1.06);
  });
});

describe("chainPlaybackRate", () => {
  it("starts at one and rises in capped steps through depth five", () => {
    expect(chainPlaybackRate(1)).toBe(1);
    expect(chainPlaybackRate(2)).toBeGreaterThan(chainPlaybackRate(1));
    expect(chainPlaybackRate(5)).toBeGreaterThan(chainPlaybackRate(2));
    expect(chainPlaybackRate(99)).toBe(chainPlaybackRate(5));
  });
});

describe("pieceDisplayProfile", () => {
  it("keeps pieces, shadows, and power-ups proportioned at every supported cell size", () => {
    for (const tileSize of [32, 48, 72]) {
      const profile = pieceDisplayProfile(tileSize);

      expect(profile.pieceSizePx).toBeGreaterThanOrEqual(tileSize * 0.82);
      expect(profile.pieceSizePx).toBeLessThanOrEqual(tileSize * 0.88);
      expect(profile.shadowWidthPx).toBeLessThan(profile.pieceSizePx);
      expect(profile.shadowHeightPx).toBeLessThan(profile.pieceSizePx);
      expect(profile.powerUpSizePx).toBeGreaterThanOrEqual(profile.pieceSizePx * 1.06);
      expect(profile.powerUpSizePx).toBeLessThanOrEqual(profile.pieceSizePx * 1.1);
      expect(Object.values(profile).every(Number.isFinite)).toBe(true);
    }
  });
});
