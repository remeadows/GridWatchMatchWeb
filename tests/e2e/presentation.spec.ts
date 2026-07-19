import { expect, test, type Page } from "@playwright/test";
import type { CanonicalComboKey, PresentationTraceEntry } from "../../src/game/presentation";

const powerUpCombos: CanonicalComboKey[] = [
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
const presentationEffects = ["rocket", "propeller", "tnt", "lightBall", ...powerUpCombos] as const;

interface PresentationResourceSnapshot {
  current: {
    activeFxObjects: number;
    activeTimers: number;
    activeTweens: number;
    activeEmitters: number;
    liveParticles: number;
    simultaneousArcs: number;
    activeBoardAudio: number;
  };
  peak: PresentationResourceSnapshot["current"];
  profile: "desktop" | "mobile";
}

test.describe("piece rendering and board scale", () => {
  test("keeps the desktop board large while all rows and booster artwork remain reachable", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/?gwTestMode=1&level=1");

    const board = await page.getByTestId("board-canvas").boundingBox();
    const tray = page.locator(".booster-tray");
    const trayBox = await tray.boundingBox();
    const firstBooster = page.getByTestId("booster-rocket");
    const artwork = firstBooster.locator("img");

    expect(board).not.toBeNull();
    expect(trayBox).not.toBeNull();
    expect(board!.width).toBeGreaterThanOrEqual(450);
    expect(board!.height).toBeGreaterThanOrEqual(450);
    expect(trayBox!.y).toBeGreaterThanOrEqual(board!.y + board!.height);
    expect(await artwork.count()).toBe(1);
    await expect(artwork).toBeVisible();
    await expect(firstBooster).toHaveAccessibleName(/Rocket H.*3/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("keeps the iPhone board, seventh row, and booster tray reachable without overlap", async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto("/?gwTestMode=1&level=1");

    const board = page.getByTestId("board-canvas");
    const tray = page.locator(".booster-tray");
    await board.scrollIntoViewIfNeeded();
    const boardBox = await board.boundingBox();
    expect(boardBox).not.toBeNull();
    expect(boardBox!.width).toBeLessThanOrEqual(393);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await tray.scrollIntoViewIfNeeded();
    await expect(page.getByTestId("booster-lightBall")).toBeVisible();
  });
});

test.describe("locked cell readability", () => {
  test("marks Level 7 design locks with explicit containment hardware", async ({ page }) => {
    await page.goto("/?gwTestMode=1&level=7");
    await page.getByTestId("board-canvas").waitFor({ state: "visible" });
    await waitForBoardReady(page);

    const visuals = await page.evaluate(() => (
      (window as Window & {
        __gwLockedCellVisuals?: Array<{ row: number; col: number; kind: string }>;
      }).__gwLockedCellVisuals ?? []
    ));

    expect(visuals).toEqual([
      { row: 3, col: 3, kind: "containment-lock" },
      { row: 3, col: 4, kind: "containment-lock" }
    ]);
  });
});

test.describe("normal presentation timeline", () => {
  test("records a paced scene-clock swap, impact, cascade, and completion sequence", async ({ page }) => {
    await page.goto("/?gwTestMode=1&level=1");
    await page.getByTestId("board-canvas").waitFor({ state: "visible" });
    await waitForBoardReady(page);

    await dragBoardCells(page, { row: 0, col: 0 }, { row: 1, col: 0 });
    await page.waitForFunction(() => {
      const trace = (window as Window & { __gwPresentationTrace?: PresentationTraceEntry[] }).__gwPresentationTrace;
      return trace?.some((entry) => entry.kind === "resolution-complete") ?? false;
    });

    const trace = await presentationTrace(page);
    expect(trace[0]?.kind).toBe("action-received");
    const swapSettled = traceEntry(trace, "swap-settled");
    const impact = traceEntry(trace, "match-impact");
    const cascadeStart = traceEntry(trace, "cascade-start");
    const cascadeLand = traceEntry(trace, "cascade-land");
    const complete = traceEntry(trace, "resolution-complete");

    expect(swapSettled.atMs).toBeLessThan(impact.atMs);
    expect(impact.plannedAtMs - swapSettled.plannedAtMs).toBeGreaterThanOrEqual(230);
    expect(impact.plannedAtMs - swapSettled.plannedAtMs).toBeLessThanOrEqual(250);
    expect(cascadeStart.plannedAtMs - impact.plannedAtMs).toBeGreaterThanOrEqual(220);
    expect(cascadeStart.plannedAtMs - impact.plannedAtMs).toBeLessThanOrEqual(260);
    expect(cascadeLand.plannedAtMs - cascadeStart.plannedAtMs).toBeGreaterThanOrEqual(250);
    expect(cascadeLand.plannedAtMs).toBeLessThan(complete.plannedAtMs);
    expect(complete.plannedAtMs - trace[0].plannedAtMs).toBeGreaterThanOrEqual(1_080);
    expect(complete.plannedAtMs - trace[0].plannedAtMs).toBeLessThanOrEqual(1_300);
    expect(cascadeStart.detail).toBe("occupants-unique");
  });

  test("returns a live invalid swap to the unchanged board before completing", async ({ page }) => {
    await page.goto("/?gwTestMode=1&level=1");
    await page.getByTestId("board-canvas").waitFor({ state: "visible" });
    await waitForBoardReady(page);
    const stateBefore = await comboPreviewState(page);

    await dragBoardCells(page, { row: 0, col: 0 }, { row: 0, col: 1 });
    await page.waitForFunction(() => (
      (window as Window & { __gwPresentationTrace?: PresentationTraceEntry[] }).__gwPresentationTrace
        ?.some((entry) => entry.kind === "invalid-swap-return") ?? false
    ));

    const trace = await presentationTrace(page);
    const attempt = traceEntry(trace, "invalid-swap-attempt");
    const returned = traceEntry(trace, "invalid-swap-return");
    expect(attempt.atMs).toBeLessThan(returned.atMs);
    expect(trace.some((entry) => entry.kind === "match-impact")).toBe(false);
    expect(await comboPreviewState(page)).toEqual(stateBefore);
  });

  test("reduced motion completes without moving or popping presentation beats", async ({ page }) => {
    await page.goto("/?gwTestMode=1");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByLabel("Reduced Motion").check();
    await page.goto("/?gwTestMode=1&level=1");
    await page.getByTestId("board-canvas").waitFor({ state: "visible" });
    await waitForBoardReady(page);

    await page.getByTestId("qa-swap").click();
    await page.waitForFunction(() => {
      const trace = (window as Window & { __gwPresentationTrace?: PresentationTraceEntry[] }).__gwPresentationTrace;
      return trace?.some((entry) => entry.kind === "resolution-complete") ?? false;
    });

    const trace = await presentationTrace(page);
    const complete = traceEntry(trace, "resolution-complete");
    expect(trace.map((entry) => entry.kind)).toEqual(["action-received", "audio-cue", "resolution-complete"]);
    expect(traceEntry(trace, "audio-cue").detail).toBe("tileClusterBody");
    expect(complete.plannedAtMs - trace[0].plannedAtMs).toBeLessThanOrEqual(180);
  });
});

test.describe("standard match impact", () => {
  test("groups one clear wave and lets bounded debris overlap the cascade", async ({ page }) => {
    await page.goto("/?gwTestMode=1&level=1");
    await page.getByTestId("board-canvas").waitFor({ state: "visible" });
    await waitForBoardReady(page);

    await page.getByTestId("qa-swap").click();
    await page.waitForFunction(() => {
      const trace = (window as Window & { __gwPresentationTrace?: PresentationTraceEntry[] }).__gwPresentationTrace;
      return trace?.some((entry) => entry.kind === "debris-cleanup-complete") ?? false;
    });

    const trace = await presentationTrace(page);
    const groupStarts = trace.filter((entry) => entry.kind === "match-group-start");
    const groupImpacts = trace.filter((entry) => entry.kind === "match-impact");
    const particleCount = trace
      .filter((entry) => entry.kind === "vfx-particles")
      .reduce((total, entry) => total + Number(entry.detail ?? 0), 0);
    const cascadeStart = traceEntry(trace, "cascade-start");
    const cleanupPending = traceEntry(trace, "debris-cleanup-pending");
    const cleanupComplete = traceEntry(trace, "debris-cleanup-complete");

    expect(groupStarts).toHaveLength(1);
    expect(groupImpacts).toHaveLength(1);
    expect(particleCount).toBeGreaterThan(0);
    expect(particleCount).toBeLessThanOrEqual(27);
    expect(trace.some((entry) => entry.kind === "screen-flash")).toBe(false);
    expect(trace.some((entry) => entry.kind === "shake-request")).toBe(false);
    expect(cleanupPending.atMs).toBeLessThanOrEqual(cascadeStart.atMs);
    expect(cascadeStart.atMs).toBeLessThan(cleanupComplete.atMs);
  });
});

test.describe("power-up creation", () => {
  test("stages a created propeller before it becomes stable", async ({ page }) => {
    await page.goto("/?gwTestMode=1&level=1");
    await page.getByTestId("board-canvas").waitFor({ state: "visible" });
    await waitForBoardReady(page);

    await dragBoardCells(page, { row: 1, col: 0 }, { row: 1, col: 1 });
    await page.waitForFunction(() => {
      const trace = (window as Window & { __gwPresentationTrace?: PresentationTraceEntry[] }).__gwPresentationTrace;
      return trace?.some((entry) => entry.kind === "resolution-complete") ?? false;
    });

    const trace = await presentationTrace(page);
    const charge = traceEntry(trace, "powerup-create-charge");
    const impact = traceEntry(trace, "powerup-create-impact");
    const stable = traceEntry(trace, "powerup-create-stable");

    expect(charge.atMs).toBeLessThan(impact.atMs);
    expect(impact.atMs).toBeLessThan(stable.atMs);
    expect(trace.filter((entry) => entry.kind === "action-received")).toHaveLength(1);
    await expect(page.getByText("24/25")).toBeVisible();
  });
});

test.describe("single TNT", () => {
  test("arms, detonates, and drives radial tile impacts before cascade", async ({ page }) => {
    await page.goto("/?gwTestMode=1&level=1");
    await page.getByTestId("board-canvas").waitFor({ state: "visible" });
    await waitForBoardReady(page);

    await page.getByTestId("booster-tnt").click();
    await clickBoardPoint(page, await boardCellPoint(page, { row: 3, col: 3 }));
    await page.waitForFunction(() => {
      const trace = (window as Window & { __gwPresentationTrace?: PresentationTraceEntry[] }).__gwPresentationTrace;
      return trace?.some((entry) => entry.kind === "resolution-complete") ?? false;
    });

    const trace = await presentationTrace(page);
    const arm = traceEntry(trace, "tnt-arm");
    const charge = traceEntry(trace, "tnt-charge");
    const detonation = traceEntry(trace, "tnt-detonation");
    const impacts = trace.filter((entry) => entry.kind === "tnt-tile-impact");
    const cascadeStart = traceEntry(trace, "cascade-start");
    const audio = trace.filter((entry) => entry.kind === "audio-cue").map((entry) => entry.detail);

    expect(arm.atMs).toBeLessThan(charge.atMs);
    expect(charge.atMs).toBeLessThan(detonation.atMs);
    expect(impacts.length).toBeGreaterThan(1);
    expect(impacts.every((entry, index) => index === 0 || entry.atMs >= impacts[index - 1].atMs)).toBe(true);
    expect(detonation.atMs).toBeLessThan(cascadeStart.atMs);
    expect(audio).toContain("tntArm");
    expect(audio).toContain("tntBlast");
    expect(trace.filter((entry) => entry.kind === "screen-flash")).toHaveLength(1);
    expect(trace.filter((entry) => entry.kind === "shockwave")).toHaveLength(1);
    expect(trace.filter((entry) => entry.kind === "shake-request")).toHaveLength(1);
  });
});

test.describe("single rocket", () => {
  test("launches two heads and clears each lane tile at its projectile pass", async ({ page }) => {
    await page.goto("/?gwTestMode=1&level=1");
    await page.getByTestId("board-canvas").waitFor({ state: "visible" });
    await waitForBoardReady(page);

    await page.getByTestId("booster-rocket").click();
    await clickBoardPoint(page, await boardCellPoint(page, { row: 3, col: 3 }));
    await page.waitForFunction(() => {
      const trace = (window as Window & { __gwPresentationTrace?: PresentationTraceEntry[] }).__gwPresentationTrace;
      return trace?.some((entry) => entry.kind === "resolution-complete") ?? false;
    });

    const trace = await presentationTrace(page);
    const launches = trace.filter((entry) => entry.kind === "rocket-head-launch");
    const passes = trace.filter((entry) => entry.kind === "rocket-pass");
    const impacts = trace.filter((entry) => entry.kind === "rocket-tile-impact");
    const passByPosition = new Map(passes.map((entry) => [entry.detail, entry]));

    expect(launches).toHaveLength(2);
    expect(passes.length).toBeGreaterThanOrEqual(7);
    expect(impacts).toHaveLength(passes.length);
    for (const impact of impacts) {
      const pass = passByPosition.get(impact.detail);
      expect(pass).toBeDefined();
      expect(impact.atMs).toBeGreaterThanOrEqual(pass!.atMs);
      expect(impact.atMs - pass!.atMs).toBeLessThanOrEqual(17);
    }
  });
});

test.describe("single propeller", () => {
  test("lifts, marks its affected target, strikes it, then resolves secondary impacts", async ({ page }) => {
    await page.goto("/?gwTestMode=1&level=1");
    await page.getByTestId("board-canvas").waitFor({ state: "visible" });
    await waitForBoardReady(page);

    await page.getByTestId("booster-propeller").click();
    await clickBoardPoint(page, await boardCellPoint(page, { row: 3, col: 3 }));
    await page.waitForFunction(() => {
      const trace = (window as Window & { __gwPresentationTrace?: PresentationTraceEntry[] }).__gwPresentationTrace;
      return trace?.some((entry) => entry.kind === "resolution-complete") ?? false;
    });

    const trace = await presentationTrace(page);
    const lift = traceEntry(trace, "propeller-lift");
    const flight = traceEntry(trace, "propeller-flight");
    const reticle = traceEntry(trace, "propeller-reticle");
    const impact = traceEntry(trace, "propeller-impact");
    const secondary = trace.filter((entry) => entry.kind === "propeller-secondary-impact");

    expect(lift.atMs).toBeLessThan(flight.atMs);
    expect(flight.atMs).toBeLessThan(reticle.atMs);
    expect(reticle.atMs).toBeLessThan(impact.atMs);
    expect(secondary.every((entry) => entry.atMs >= impact.atMs)).toBe(true);
  });
});

test.describe("single light ball", () => {
  test("dims, batches target arcs, releases once, and restores before cascade", async ({ page }) => {
    await page.goto("/?gwTestMode=1&level=1");
    await page.getByTestId("board-canvas").waitFor({ state: "visible" });
    await waitForBoardReady(page);
    await page.getByTestId("booster-lightBall").click();
    await clickBoardPoint(page, await boardCellPoint(page, { row: 3, col: 3 }));
    await page.waitForFunction(() => (window as Window & { __gwPresentationTrace?: PresentationTraceEntry[] }).__gwPresentationTrace?.some((entry) => entry.kind === "resolution-complete") ?? false);

    const trace = await presentationTrace(page);
    const dim = traceEntry(trace, "lightBall-dim");
    const charge = traceEntry(trace, "lightBall-charge");
    const waves = trace.filter((entry) => entry.kind === "lightBall-arc-wave");
    const targetImpacts = trace.filter((entry) => entry.kind === "lightBall-target-impact");
    const release = traceEntry(trace, "lightBall-release");
    const undim = traceEntry(trace, "lightBall-undim");
    const cascade = traceEntry(trace, "cascade-start");
    const flashes = trace.filter((entry) => entry.kind === "screen-flash");
    const cascadePlans = trace
      .filter((entry) => entry.kind === "cascade-fall-plan")
      .map((entry) => parseCascadeFallPlan(entry.detail));
    const oneCellPlan = cascadePlans.find((plan) => plan.distanceCells === 1);
    const longPlan = cascadePlans.find((plan) => plan.distanceCells >= 5);
    expect(dim.atMs).toBeLessThan(charge.atMs);
    expect(waves.length).toBeGreaterThanOrEqual(3);
    expect(waves.length).toBeLessThanOrEqual(5);
    expect(charge.atMs).toBeLessThan(waves[0].atMs);
    expect(waves.at(-1)!.atMs).toBeLessThan(release.atMs);
    expect(targetImpacts.length).toBeGreaterThan(0);
    expect(waves.every((wave) => targetImpacts.filter((impact) => impact.atMs === wave.atMs).length <= 3)).toBe(true);
    expect(targetImpacts.every((impact) => waves.some((wave) => wave.atMs === impact.atMs))).toBe(true);
    expect(charge.atMs).toBeLessThan(release.atMs);
    expect(release.atMs).toBeLessThan(undim.atMs);
    expect(undim.atMs).toBeLessThan(cascade.atMs);
    expect(cascade.atMs - undim.atMs).toBeGreaterThanOrEqual(180);
    expect(cascade.plannedAtMs - dim.plannedAtMs).toBeLessThanOrEqual(1_050);
    expect(trace.some((entry) => entry.kind === "combo-charge")).toBe(false);
    expect(flashes).toHaveLength(1);
    expect(flashes[0].detail).toBe("alpha=0.22;durationMs=80");
    expect(oneCellPlan).toBeDefined();
    expect(longPlan).toBeDefined();
    expect(longPlan!.durationMs).toBeGreaterThan(oneCellPlan!.durationMs);
  });
});

test.describe("power-up combo choreography", () => {
  for (const combo of powerUpCombos) {
    test(`${combo} previews one authored charge and impact`, async ({ page }) => {
      await page.goto("/?gwTestMode=1&level=1");
      await page.getByTestId("board-canvas").waitFor({ state: "visible" });
      await waitForBoardReady(page);
      const stateBefore = await comboPreviewState(page);

      await page.evaluate((key) => {
        const preview = (window as Window & {
          __gwPreviewPowerUpCombo?: (combo: CanonicalComboKey) => void;
        }).__gwPreviewPowerUpCombo;
        if (!preview) throw new Error("Combo presentation preview hook unavailable");
        preview(key);
      }, combo);
      await page.waitForFunction(() => (
        (window as Window & { __gwPresentationTrace?: PresentationTraceEntry[] }).__gwPresentationTrace
          ?.some((entry) => entry.kind === "combo-preview-complete") ?? false
      ));

      const trace = await presentationTrace(page);
      const charge = trace.filter((entry) => entry.kind === "combo-charge");
      const impact = trace.filter((entry) => entry.kind === "combo-impact");
      const complete = traceEntry(trace, "combo-preview-complete");
      expect(charge).toHaveLength(1);
      expect(impact).toHaveLength(1);
      expect(charge[0].detail).toBe(combo);
      expect(impact[0].detail).toBe(combo);
      expect(charge[0].atMs).toBeLessThan(impact[0].atMs);
      expect(impact[0].atMs).toBeLessThanOrEqual(complete.atMs);
      expect(complete.plannedAtMs - charge[0].plannedAtMs).toBeLessThanOrEqual(1_600);
      expect(trace.some((entry) => entry.kind === "powerup-charge")).toBe(false);
      expect(trace.some((entry) => entry.kind === "combo-visual-batch")).toBe(true);
      expect(trace.filter((entry) => entry.kind === "screen-flash").length).toBeLessThanOrEqual(1);
      expect(await comboPreviewState(page)).toEqual(stateBefore);
    });
  }
});

test.describe("presentation budget and cleanup", () => {
  test("budget caps the heaviest board-wide effect on each viewport", async ({ page }, testInfo) => {
    await page.goto("/?gwTestMode=1&level=1");
    await page.getByTestId("board-canvas").waitFor({ state: "visible" });
    await waitForBoardReady(page);

    await previewPresentationEffect(page, "lightBall+lightBall");
    const resources = await presentationResourceCounts(page);
    const particleCap = testInfo.project.name === "mobile" ? 110 : 180;

    expect(resources.peak.activeEmitters).toBeLessThanOrEqual(12);
    expect(resources.peak.liveParticles).toBeLessThanOrEqual(particleCap);
    expect(resources.peak.simultaneousArcs).toBeLessThanOrEqual(12);
    expect(resources.peak.activeBoardAudio).toBeLessThanOrEqual(16);
  });

  test("cleanup empties the registry after every single and combo effect tail", async ({ page }) => {
    for (const effect of presentationEffects) {
      await page.goto("/?gwTestMode=1&level=1");
      await page.getByTestId("board-canvas").waitFor({ state: "visible" });
      await waitForBoardReady(page);
      await previewPresentationEffect(page, effect);
      await page.waitForFunction(() => {
        const resources = (window as Window & {
          __gwPresentationResourceCounts?: PresentationResourceSnapshot;
        }).__gwPresentationResourceCounts;
        return resources !== undefined && Object.values(resources.current).every((value) => value === 0);
      });
    }
  });

  test("cleanup prevents every effect callback from surviving scene shutdown", async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));

    for (const effect of presentationEffects) {
      await page.goto("/?gwTestMode=1&level=1");
      await page.getByTestId("board-canvas").waitFor({ state: "visible" });
      await waitForBoardReady(page);
      await startPresentationEffect(page, effect);
      await page.evaluate(() => {
        const stop = (window as Window & { __gwStopBoardScene?: () => void }).__gwStopBoardScene;
        if (!stop) throw new Error("Board shutdown test hook unavailable");
        stop();
      });
      await expect.poll(() => presentationResourceCounts(page)).toMatchObject({
        current: {
          activeFxObjects: 0,
          activeTimers: 0,
          activeTweens: 0,
          activeEmitters: 0,
          liveParticles: 0,
          simultaneousArcs: 0,
          activeBoardAudio: 0
        }
      });
    }

    expect(pageErrors).toEqual([]);
  });
});

test.describe("reduced motion presentation budget", () => {
  test("all singles and combos reach stable final state within 180 ms without moving VFX or disabled SFX cues", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("gridwatch-match-web.save.v1", JSON.stringify({
        version: 1,
        settings: {
          musicEnabled: true,
          sfxEnabled: false,
          voiceEnabled: true,
          reducedMotion: true
        }
      }));
    });

    for (const effect of presentationEffects) {
      await page.goto("/?gwTestMode=1&level=1");
      await page.getByTestId("board-canvas").waitFor({ state: "visible" });
      await waitForBoardReady(page);
      await previewPresentationEffect(page, effect);

      const trace = await presentationTrace(page);
      const start = traceEntry(trace, "effect-preview-start");
      const complete = traceEntry(trace, "effect-preview-complete");
      const forbiddenKinds = new Set([
        "combo-charge",
        "combo-visual-batch",
        "lightBall-arc-wave",
        "powerup-charge",
        "propeller-flight",
        "rocket-head-launch",
        "screen-flash",
        "shake-request",
        "vfx-particles"
      ]);

      expect(complete.plannedAtMs - start.plannedAtMs, effect).toBeLessThanOrEqual(180);
      expect(trace.some((entry) => forbiddenKinds.has(entry.kind)), effect).toBe(false);
      expect(trace.some((entry) => entry.kind === "audio-cue"), effect).toBe(false);
      const resources = await presentationResourceCounts(page);
      expect(resources.peak.liveParticles, effect).toBe(0);
      expect(resources.peak.simultaneousArcs, effect).toBe(0);
    }
  });
});

test.describe("test-mode presentation hooks", () => {
  test("rejects non-exact test mode and exposes no preview globals in production mode", async ({ page }) => {
    await page.goto("/?gwTestMode=1&level=1");
    await page.getByTestId("board-canvas").waitFor({ state: "visible" });
    await waitForBoardReady(page);

    const staleHookResult = await page.evaluate(() => {
      const preview = (window as Window & {
        __gwPreviewPresentationEffect?: (effect: "rocket") => void;
      }).__gwPreviewPresentationEffect;
      if (!preview) throw new Error("Presentation effect preview hook unavailable");
      history.replaceState({}, "", "/?gwTestMode=true&level=1");
      try {
        preview("rocket");
        return { message: "", threw: false };
      } catch (error) {
        return { message: error instanceof Error ? error.message : String(error), threw: true };
      }
    });
    expect(staleHookResult.threw).toBe(true);
    expect(staleHookResult.message).toContain("exact gwTestMode=1");

    await page.goto("/");
    await page.getByRole("button", { name: "Operations", exact: true }).click();
    await page.getByRole("button", { name: "Open Levels" }).first().click();
    await page.getByRole("button", { name: "Level 1 Ready" }).click();
    await page.getByTestId("board-canvas").waitFor({ state: "visible" });
    expect(await page.evaluate(() => {
      const target = window as Window & {
        __gwBoardReady?: unknown;
        __gwBoardCellClientPoint?: unknown;
        __gwPresentationResourceCounts?: unknown;
        __gwPresentationTrace?: unknown;
        __gwPreviewPowerUpCombo?: unknown;
        __gwPreviewPresentationEffect?: unknown;
        __gwStopBoardScene?: unknown;
      };
      return [
        target.__gwBoardReady,
        target.__gwBoardCellClientPoint,
        target.__gwPresentationResourceCounts,
        target.__gwPresentationTrace,
        target.__gwPreviewPowerUpCombo,
        target.__gwPreviewPresentationEffect,
        target.__gwStopBoardScene
      ].every((value) => value === undefined);
    })).toBe(true);
  });
});

test.describe("audio cue ordering", () => {
  test("cues normal-match audio from the same scene beats as impact and landing", async ({ page }) => {
    await page.goto("/?gwTestMode=1&level=1");
    await page.getByTestId("board-canvas").waitFor({ state: "visible" });
    await waitForBoardReady(page);

    await page.getByTestId("qa-swap").click();
    await page.waitForFunction(() => {
      const trace = (window as Window & { __gwPresentationTrace?: PresentationTraceEntry[] }).__gwPresentationTrace;
      return trace?.some((entry) => entry.kind === "resolution-complete") ?? false;
    });

    const trace = await presentationTrace(page);
    const tileImpactTimes = new Set(trace.filter((entry) => entry.kind === "tile-impact").map((entry) => entry.atMs));
    const landing = traceEntry(trace, "cascade-land");
    const tileImpactCues = trace.filter((entry) => entry.kind === "audio-cue" && (
      entry.detail === "tileClusterBody" || entry.detail === "tilePopA" || entry.detail === "tilePopB"
    ));
    const landingCue = trace.find((entry) => entry.kind === "audio-cue" && entry.detail === "cascadeLand");

    expect(tileImpactCues.length).toBeGreaterThan(1);
    expect(tileImpactCues.every((entry) => tileImpactTimes.has(entry.atMs))).toBe(true);
    expect(landingCue?.atMs).toBe(landing.atMs);
  });

  test("cues cascade chain escalation when the next cascade starts", async ({ page }) => {
    await page.goto("/?gwTestMode=1&level=6");
    await page.getByTestId("board-canvas").waitFor({ state: "visible" });
    await waitForBoardReady(page);

    await dragBoardCells(page, { row: 0, col: 5 }, { row: 0, col: 6 });
    await page.waitForFunction(() => (
      (window as Window & { __gwPresentationTrace?: PresentationTraceEntry[] }).__gwPresentationTrace
        ?.some((entry) => entry.kind === "resolution-complete") ?? false
    ));
    const firstSequenceId = (await presentationTrace(page)).at(-1)?.sequenceId;

    await dragBoardCells(page, { row: 3, col: 5 }, { row: 3, col: 6 });
    await page.waitForFunction((previousSequenceId) => (
      (window as Window & { __gwPresentationTrace?: PresentationTraceEntry[] }).__gwPresentationTrace
        ?.some((entry) => entry.kind === "resolution-complete" && entry.sequenceId !== previousSequenceId) ?? false
    ), firstSequenceId);

    const trace = await presentationTrace(page);
    const sequenceId = trace.at(-1)?.sequenceId;
    const cascadeTrace = trace.filter((entry) => entry.sequenceId === sequenceId);
    const cascadeStart = traceEntry(cascadeTrace, "cascade-start");
    const chainCue = cascadeTrace.find((entry) => entry.kind === "audio-cue" && entry.detail === "chainRise");

    expect(chainCue).toBeDefined();
    expect(chainCue?.atMs).toBe(cascadeStart.atMs);
  });
});

async function waitForBoardReady(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const testWindow = window as Window & {
      __gwBoardReady?: boolean;
      __gwBoardCellClientPoint?: (row: number, col: number) => { x: number; y: number } | null;
    };
    return testWindow.__gwBoardReady === true && typeof testWindow.__gwBoardCellClientPoint === "function";
  });
}

async function dragBoardCells(page: Page, from: { row: number; col: number }, to: { row: number; col: number }): Promise<void> {
  await page.locator('[data-testid="board-canvas"] canvas').waitFor({ state: "visible" });
  await page.evaluate(({ from, to }) => {
    const testWindow = window as Window & {
      __gwBoardCellClientPoint?: (row: number, col: number) => { x: number; y: number } | null;
    };
    const start = testWindow.__gwBoardCellClientPoint?.(from.row, from.col);
    const end = testWindow.__gwBoardCellClientPoint?.(to.row, to.col);
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="board-canvas"] canvas');
    if (!start || !end || !canvas) throw new Error("Board cell client points unavailable");

    const dispatch = (type: "pointerdown" | "pointermove" | "pointerup", point: { x: number; y: number }, buttons: number) => {
      canvas.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        button: 0,
        buttons,
        cancelable: true,
        clientX: point.x,
        clientY: point.y,
        composed: true,
        isPrimary: true,
        pointerId: 1,
        pointerType: "mouse",
        view: window
      }));
    };

    dispatch("pointerdown", start, 1);
    for (let step = 1; step <= 12; step += 1) {
      const progress = step / 12;
      dispatch("pointermove", {
        x: start.x + (end.x - start.x) * progress,
        y: start.y + (end.y - start.y) * progress
      }, 1);
    }
    dispatch("pointerup", end, 0);
  }, { from, to });
}

async function boardCellPoint(page: Page, position: { row: number; col: number }): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(({ position }) => {
    const testWindow = window as Window & {
      __gwBoardCellClientPoint?: (row: number, col: number) => { x: number; y: number } | null;
    };
    return testWindow.__gwBoardCellClientPoint?.(position.row, position.col) ?? null;
  }, { position });
  if (!point) throw new Error(`Board cell point unavailable for ${position.row},${position.col}`);
  return point;
}

async function clickBoardPoint(page: Page, point: { x: number; y: number }): Promise<void> {
  await page.evaluate(({ point }) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="board-canvas"] canvas');
    if (!canvas) throw new Error("Board canvas not found");
    const base = {
      bubbles: true,
      button: 0,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
      composed: true,
      isPrimary: true,
      pointerId: 1,
      pointerType: "mouse",
      view: window
    };
    canvas.dispatchEvent(new PointerEvent("pointerdown", { ...base, buttons: 1 }));
    canvas.dispatchEvent(new PointerEvent("pointerup", { ...base, buttons: 0 }));
  }, { point });
}

async function presentationTrace(page: Page): Promise<PresentationTraceEntry[]> {
  return page.evaluate(() => (
    (window as Window & { __gwPresentationTrace?: PresentationTraceEntry[] }).__gwPresentationTrace ?? []
  ));
}

async function startPresentationEffect(page: Page, effect: typeof presentationEffects[number]): Promise<void> {
  await page.evaluate((key) => {
    const preview = (window as Window & {
      __gwPreviewPresentationEffect?: (effect: typeof key) => void;
    }).__gwPreviewPresentationEffect;
    if (!preview) throw new Error("Presentation effect preview hook unavailable");
    preview(key);
  }, effect);
}

async function previewPresentationEffect(page: Page, effect: typeof presentationEffects[number]): Promise<void> {
  await startPresentationEffect(page, effect);
  await page.waitForFunction(() => (
    (window as Window & { __gwPresentationTrace?: PresentationTraceEntry[] }).__gwPresentationTrace
      ?.some((entry) => entry.kind === "effect-preview-complete") ?? false
  ));
}

async function presentationResourceCounts(page: Page): Promise<PresentationResourceSnapshot> {
  return page.evaluate(() => {
    const resources = (window as Window & {
      __gwPresentationResourceCounts?: PresentationResourceSnapshot;
    }).__gwPresentationResourceCounts;
    if (!resources) throw new Error("Presentation resource counts unavailable");
    return resources;
  });
}

function traceEntry(trace: PresentationTraceEntry[], kind: string): PresentationTraceEntry {
  const entry = trace.find((candidate) => candidate.kind === kind);
  if (!entry) throw new Error(`Missing presentation trace entry: ${kind}`);
  return entry;
}

function parseCascadeFallPlan(detail: string | undefined): { distanceCells: number; durationMs: number } {
  const match = detail?.match(/^distanceCells=([\d.]+);durationMs=(\d+)$/);
  if (!match) throw new Error(`Invalid cascade fall plan: ${detail ?? "missing"}`);
  return { distanceCells: Number(match[1]), durationMs: Number(match[2]) };
}

async function comboPreviewState(page: Page): Promise<{
  moves: string;
  objective: string;
  score: string;
  boosters: string[];
  storage: Record<string, string>;
}> {
  return page.evaluate(() => {
    const storage = Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index)!;
      return [key, localStorage.getItem(key) ?? ""];
    }).sort(([left], [right]) => left.localeCompare(right)));
    const text = document.body.innerText;
    const boosters = Array.from(document.querySelectorAll<HTMLButtonElement>(".booster-tray button"))
      .map((button) => button.innerText);
    return {
      moves: text.match(/MOVES\s+(\d+\/\d+)/)?.[1] ?? "",
      objective: text.match(/Collect 20 Packets: \d+\/20/)?.[0] ?? "",
      score: text.match(/SCORE\s+(\d+)/)?.[1] ?? "",
      boosters,
      storage
    };
  });
}
