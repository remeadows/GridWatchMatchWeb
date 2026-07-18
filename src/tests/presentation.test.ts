import { describe, expect, it } from "vitest";
import type { PowerUpEvent, PowerUpType, SpawnEvent } from "../engine";
import {
  canonicalComboKey,
  cascadeFallDurationMs,
  chainPlaybackRate,
  comboChoreographyPlan,
  comboOverlayPositions,
  createdPowerUpSpawns,
  eventIntensity,
  groupPowerUpEvents,
  lightBallWavePlan,
  matchTimeline,
  PRESENTATION_RESOURCE_LIMITS,
  presentationResourcePlan,
  pieceDisplayProfile,
  propellerFlightPlan,
  rocketLanePlan,
  tntDetonationPlan,
  tilePopVariation,
  type CanonicalComboKey,
  type PresentationEffectKey
} from "../game/presentation";

const rocketHorizontal: PowerUpType = { kind: "rocket", orientation: "horizontal" };
const rocketVertical: PowerUpType = { kind: "rocket", orientation: "vertical" };
const propeller: PowerUpType = { kind: "propeller" };
const tnt: PowerUpType = { kind: "tnt" };
const lightBall: PowerUpType = { kind: "lightBall" };
const presentationEffects: PresentationEffectKey[] = [
  "rocket",
  "propeller",
  "tnt",
  "lightBall",
  "rocket+rocket",
  "propeller+rocket",
  "rocket+tnt",
  "lightBall+rocket",
  "propeller+propeller",
  "propeller+tnt",
  "lightBall+propeller",
  "tnt+tnt",
  "lightBall+tnt",
  "lightBall+lightBall"
];

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

  it("recognizes the engine's distant endpoint TNT footprint as rocket plus TNT", () => {
    const endpointBlast: PowerUpEvent = {
      powerUpType: tnt,
      origin: { row: 3, col: 3 },
      affectedPositions: [
        { row: 2, col: 0 }, { row: 3, col: 0 }, { row: 4, col: 0 },
        { row: 2, col: 6 }, { row: 3, col: 6 }, { row: 4, col: 6 }
      ],
      trigger: { kind: "combo", with: tnt }
    };

    expect(groupPowerUpEvents([endpointBlast])[0].key).toBe("rocket+tnt");
  });
});

describe("comboChoreographyPlan", () => {
  const combos: Array<{ key: CanonicalComboKey; left: PowerUpType; right: PowerUpType }> = [
    { key: "rocket+rocket", left: rocketHorizontal, right: rocketVertical },
    { key: "propeller+rocket", left: propeller, right: rocketHorizontal },
    { key: "rocket+tnt", left: rocketHorizontal, right: tnt },
    { key: "lightBall+rocket", left: lightBall, right: rocketHorizontal },
    { key: "propeller+propeller", left: propeller, right: propeller },
    { key: "propeller+tnt", left: propeller, right: tnt },
    { key: "lightBall+propeller", left: lightBall, right: propeller },
    { key: "tnt+tnt", left: tnt, right: tnt },
    { key: "lightBall+tnt", left: lightBall, right: tnt },
    { key: "lightBall+lightBall", left: lightBall, right: lightBall }
  ];

  it.each(combos)("authors one bounded $key event hierarchy", ({ key, left, right }) => {
    const events = [
      powerUpEvent(left, { kind: "combo", with: right }, 2, 2),
      powerUpEvent(right, { kind: "combo", with: left }, 4, 3)
    ];
    const [group] = groupPowerUpEvents(events);
    const plan = comboChoreographyPlan(group, "combo-seed", false);

    expect(groupPowerUpEvents(events)).toHaveLength(1);
    expect(group.key).toBe(key);
    expect(plan.key).toBe(key);
    expect(plan.cues.filter((cue) => cue.kind === "combo-charge")).toHaveLength(1);
    expect(plan.cues.filter((cue) => cue.kind === "combo-impact")).toHaveLength(1);
    expect(plan.cues.map((cue) => cue.kind as string)).not.toContain("powerup-charge");
    expect(plan.events.map((event) => event.eventIndex)).toEqual([0, 1]);
    expect(plan.events.flatMap((event) => event.affectedPositions)).toEqual(expect.arrayContaining(
      events.flatMap((event) => event.affectedPositions)
    ));
    expect(plan.projectileCount).toBeLessThanOrEqual(12);
    expect(plan.arcCount).toBeLessThanOrEqual(PRESENTATION_RESOURCE_LIMITS.simultaneousArcs);
    expect(plan.particleCount).toBeLessThanOrEqual(120);
    expect(plan.screenFlashCount).toBeLessThanOrEqual(1);
    expect(plan.chargeAtMs).toBeGreaterThanOrEqual(180);
    expect(plan.chargeAtMs).toBeLessThanOrEqual(300);
    expect(plan.cascadeAtMs).toBeGreaterThanOrEqual(850);
    expect(plan.cascadeAtMs).toBeLessThanOrEqual(1_450);
    expect(plan.batches.every((batch, index) => index === 0 || batch.atMs >= plan.batches[index - 1].atMs)).toBe(true);
  });

  it.each(combos)("reduces $key to one low-gain impact and final state", ({ left, right }) => {
    const [group] = groupPowerUpEvents([
      powerUpEvent(left, { kind: "combo", with: right }, 2, 2),
      powerUpEvent(right, { kind: "combo", with: left }, 4, 3)
    ]);
    const plan = comboChoreographyPlan(group, "combo-seed", true);

    expect(plan.cues).toEqual([{ kind: "combo-impact", atMs: 0, gain: 0.28 }]);
    expect(plan.batches).toEqual([]);
    expect(plan.projectileCount).toBe(0);
    expect(plan.arcCount).toBe(0);
    expect(plan.particleCount).toBe(0);
    expect(plan.finalStatePositions).toEqual(expect.arrayContaining([...group.affectedPositions]));
    expect(plan.cascadeAtMs).toBe(0);
  });

  it("caps dense light ball overlays at the authored arc budget", () => {
    const affectedPositions = Array.from({ length: 7 }, (_, row) => (
      Array.from({ length: 7 }, (_unused, col) => ({ row, col }))
    )).flat();
    const events: PowerUpEvent[] = [
      {
        powerUpType: lightBall,
        origin: { row: 3, col: 2 },
        affectedPositions,
        trigger: { kind: "combo", with: lightBall }
      },
      {
        powerUpType: lightBall,
        origin: { row: 3, col: 4 },
        affectedPositions,
        trigger: { kind: "combo", with: lightBall }
      }
    ];
    const [group] = groupPowerUpEvents(events);
    const plan = comboChoreographyPlan(group, "dense-overlay-seed", false);
    const overlays = comboOverlayPositions(plan);

    expect(plan.finalStatePositions).toHaveLength(49);
    expect(overlays).toHaveLength(plan.arcCount);
    expect(overlays).toHaveLength(12);
    expect(new Set(overlays.map(({ row, col }) => `${row},${col}`)).size).toBe(overlays.length);
    expect(overlays.every((position) => plan.finalStatePositions.some(
      (candidate) => candidate.row === position.row && candidate.col === position.col
    ))).toBe(true);
    expect(overlays.map((position) => position.row)).toEqual(expect.arrayContaining([0, 6]));
    expect(overlays.map((position) => position.col)).toEqual(expect.arrayContaining([0, 6]));
  });
});

describe("presentation resource plans", () => {
  it.each(["desktop", "mobile"] as const)("keeps every normal effect finite and within the %s budget", (viewport) => {
    for (const effect of presentationEffects) {
      const plan = presentationResourcePlan(effect, 49, viewport, false);
      const values = [
        plan.totalDurationMs,
        plan.concurrentEmitters,
        plan.liveParticles,
        plan.simultaneousArcs,
        plan.activeBoardAudio,
        plan.screenFlashes
      ];

      expect(values.every((value) => Number.isFinite(value) && value >= 0), effect).toBe(true);
      expect(plan.concurrentEmitters, effect).toBeLessThanOrEqual(PRESENTATION_RESOURCE_LIMITS.concurrentEmitters);
      expect(plan.liveParticles, effect).toBeLessThanOrEqual(PRESENTATION_RESOURCE_LIMITS.liveParticles[viewport]);
      expect(plan.simultaneousArcs, effect).toBeLessThanOrEqual(PRESENTATION_RESOURCE_LIMITS.simultaneousArcs);
      expect(plan.activeBoardAudio, effect).toBeLessThanOrEqual(PRESENTATION_RESOURCE_LIMITS.activeBoardAudio);
    }
  });

  it("reduces every effect to a stable sub-180 ms final-state plan without moving VFX", () => {
    for (const effect of presentationEffects) {
      const plan = presentationResourcePlan(effect, 49, "mobile", true);

      expect(plan.totalDurationMs, effect).toBeLessThanOrEqual(PRESENTATION_RESOURCE_LIMITS.reducedMotionStableMs);
      expect(plan.concurrentEmitters, effect).toBe(0);
      expect(plan.liveParticles, effect).toBe(0);
      expect(plan.simultaneousArcs, effect).toBe(0);
      expect(plan.screenFlashes, effect).toBe(0);
      expect(plan.travel, effect).toBe(false);
      expect(plan.shake, effect).toBe(false);
    }
  });
});

describe("createdPowerUpSpawns", () => {
  it("returns only spawns that create a power-up", () => {
    const ordinary: SpawnEvent = { position: { row: 0, col: 0 }, tileType: "packet", asPowerUp: null };
    const creation: SpawnEvent = { position: { row: 2, col: 3 }, tileType: "packet", asPowerUp: propeller };

    expect(createdPowerUpSpawns([ordinary, creation])).toEqual([
      { position: creation.position, powerUp: propeller }
    ]);
  });
});

describe("tntDetonationPlan", () => {
  it("orders the TNT arm, charge, detonation, radial impacts, and cascade within budget", () => {
    const plan = tntDetonationPlan({ row: 3, col: 3 }, [
      { row: 3, col: 3 },
      { row: 2, col: 3 },
      { row: 1, col: 3 }
    ]);

    expect(plan.armAtMs).toBe(0);
    expect(plan.chargeAtMs).toBeGreaterThanOrEqual(70);
    expect(plan.chargeAtMs).toBeLessThanOrEqual(110);
    expect(plan.detonationAtMs).toBeGreaterThanOrEqual(120);
    expect(plan.detonationAtMs).toBeLessThanOrEqual(160);
    expect(plan.impactAtMs).toEqual([plan.detonationAtMs, plan.detonationAtMs + 24, plan.detonationAtMs + 48]);
    expect(plan.cascadeStartAtMs - plan.detonationAtMs).toBeGreaterThanOrEqual(140);
    expect(plan.cascadeStartAtMs - plan.detonationAtMs).toBeLessThanOrEqual(220);
    expect(plan.sequenceBudgetMs).toBeLessThanOrEqual(850);
  });
});

describe("rocketLanePlan", () => {
  it("launches two opposing heads through every lane cell before one edge impact each", () => {
    const plan = rocketLanePlan({ row: 3, col: 3 }, "horizontal", 7, 7);

    expect(plan.ignitionMs).toBeGreaterThanOrEqual(60);
    expect(plan.ignitionMs).toBeLessThanOrEqual(90);
    expect(plan.heads).toHaveLength(2);
    expect(plan.heads.map((head) => head.destination)).toEqual([
      { row: 3, col: 0 },
      { row: 3, col: 6 }
    ]);
    expect(plan.heads.map((head) => head.passTimes.map((pass) => pass.position))).toEqual([
      [{ row: 3, col: 3 }, { row: 3, col: 2 }, { row: 3, col: 1 }, { row: 3, col: 0 }],
      [{ row: 3, col: 3 }, { row: 3, col: 4 }, { row: 3, col: 5 }, { row: 3, col: 6 }]
    ]);
    expect(plan.heads.every((head) => head.impactAtMs === head.passTimes.at(-1)?.atMs)).toBe(true);
    expect(plan.heads.every((head) => head.flightMs >= 320 && head.flightMs <= 430)).toBe(true);
    expect(plan.heads.every((head) => head.passTimes.every((pass, index, passes) => (
      index === 0 || pass.atMs >= passes[index - 1].atMs
    )))).toBe(true);
  });

  it("mirrors the same two-head route vertically", () => {
    const plan = rocketLanePlan({ row: 3, col: 3 }, "vertical", 7, 7);

    expect(plan.heads.map((head) => head.destination)).toEqual([
      { row: 0, col: 3 },
      { row: 6, col: 3 }
    ]);
    expect(plan.heads.map((head) => head.passTimes.map((pass) => pass.position))).toEqual([
      [{ row: 3, col: 3 }, { row: 2, col: 3 }, { row: 1, col: 3 }, { row: 0, col: 3 }],
      [{ row: 3, col: 3 }, { row: 4, col: 3 }, { row: 5, col: 3 }, { row: 6, col: 3 }]
    ]);
  });
});

describe("propellerFlightPlan", () => {
  it("uses a finite lift, arc, approach, and impact path toward the first affected target", () => {
    const plan = propellerFlightPlan(
      { row: 3, col: 3 },
      [{ row: 1, col: 5 }, { row: 2, col: 4 }, { row: 4, col: 4 }]
    );

    expect(plan.target).toEqual({ row: 1, col: 5 });
    expect(plan.liftAtMs).toBeGreaterThanOrEqual(90);
    expect(plan.liftAtMs).toBeLessThanOrEqual(120);
    expect(plan.flightAtMs).toBeGreaterThan(plan.liftAtMs);
    expect(plan.reticleAtMs).toBeGreaterThanOrEqual(plan.flightAtMs);
    expect(plan.impactAtMs).toBeGreaterThan(plan.reticleAtMs);
    expect(plan.points.map((point) => point.phase)).toEqual(["lift", "arc", "approach", "impact"]);
    expect(plan.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
    expect(plan.secondaryImpactAtMs).toHaveLength(2);
    expect(plan.sequenceBudgetMs).toBeLessThanOrEqual(800);
  });

  it("never derives the target from the origin when affected positions are provided", () => {
    const plan = propellerFlightPlan(
      { row: 6, col: 6 },
      [{ row: 0, col: 1 }]
    );

    expect(plan.target).toEqual({ row: 0, col: 1 });
  });
});

describe("lightBallWavePlan", () => {
  it("uses only affected targets in deterministic capped waves", () => {
    const targets = [
      { row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 0 },
      { row: 2, col: 2 }, { row: 3, col: 3 }, { row: 4, col: 4 },
      { row: 5, col: 5 }, { row: 6, col: 6 }
    ];
    const plan = lightBallWavePlan({ row: 3, col: 3 }, targets, "seed-1");

    expect(plan.waves).toHaveLength(3);
    expect(plan.waves.flatMap((wave) => wave.targets)).toEqual(expect.arrayContaining(targets));
    expect(plan.waves.every((wave) => wave.targets.length <= plan.concurrencyCap)).toBe(true);
    expect(plan.waves.every((wave) => wave.targets.every((target) => targets.some((candidate) => (
      candidate.row === target.row && candidate.col === target.col
    ))))).toBe(true);
    expect(plan.releaseAtMs).toBeGreaterThan(plan.waves.at(-1)!.atMs);
  });

  it("retains every affected target when five waves require a larger cap", () => {
    const targets = Array.from({ length: 21 }, (_, index) => ({
      row: Math.floor(index / 7),
      col: index % 7
    }));
    const plan = lightBallWavePlan({ row: 3, col: 3 }, targets, "dense-seed");

    expect(plan.waves.length).toBeGreaterThanOrEqual(3);
    expect(plan.waves.length).toBeLessThanOrEqual(5);
    expect(plan.waves.flatMap((wave) => wave.targets)).toHaveLength(targets.length);
    expect(plan.waves.every((wave) => wave.targets.length <= plan.concurrencyCap)).toBe(true);
    expect(lightBallWavePlan({ row: 3, col: 3 }, targets, "dense-seed")).toEqual(plan);
  });
});

describe("matchTimeline", () => {
  it("uses named phases and gives an ordinary match readable impact and settle time", () => {
    const timeline = matchTimeline(64);

    expect(timeline.swapTravelMs).toBeGreaterThanOrEqual(150);
    expect(timeline.swapTravelMs).toBeLessThanOrEqual(175);
    expect(timeline.swapSettleMs).toBeGreaterThanOrEqual(45);
    expect(timeline.swapSettleMs).toBeLessThanOrEqual(60);
    expect(timeline.recognitionHoldMs).toBeGreaterThanOrEqual(55);
    expect(timeline.recognitionHoldMs).toBeLessThanOrEqual(70);
    expect(timeline.popCompressionMs).toBeGreaterThanOrEqual(50);
    expect(timeline.popCompressionMs).toBeLessThanOrEqual(65);
    expect(timeline.impactMs).toBeGreaterThanOrEqual(115);
    expect(timeline.impactMs).toBeLessThanOrEqual(140);
    expect(timeline.maxStaggerMs).toBe(64);
    expect(timeline.cascadeStartAfterImpactMs).toBeGreaterThanOrEqual(115);
    expect(timeline.cascadeStartAfterImpactMs).toBeLessThanOrEqual(145);
    expect(timeline.totalMs).toBeGreaterThanOrEqual(950);
    expect(timeline.totalMs).toBeLessThanOrEqual(1_050);
  });
});

describe("cascadeFallDurationMs", () => {
  it("uses distance-based falls with the specified minimum and cap", () => {
    expect(cascadeFallDurationMs(1)).toBe(195);
    expect(cascadeFallDurationMs(2)).toBeGreaterThan(cascadeFallDurationMs(1));
    expect(cascadeFallDurationMs(7)).toBe(380);
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
