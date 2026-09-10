import { expect, test, type Page } from "@playwright/test";
import type { PresentationTraceEntry } from "../../src/game/presentation";
import type { ResolutionFrameAudit } from "../../src/game/resolutionPlayback";

declare global {
  interface Window {
    __gwReleaseTestAudio?: () => void;
    __gwPendingTestAudio?: () => number;
    __gwAllocatedTestAudio?: () => number;
    __gwBoardReady?: boolean;
    __gwResolutionFrames?: ResolutionFrameAudit[];
    __gwPresentationTrace?: PresentationTraceEntry[];
    __gwBoardCellClientPoint?: ((row: number, col: number) => { x: number; y: number } | null) | null;
  }
}

async function holdBoardAudio(page: Page, backend: "web" | "html" = "web") {
  await page.addInitScript(backend => {
    const sources: Array<{ ended: boolean; onended: (() => void) | null; stop: () => void }> = [];
    const NativeAudioContext = window.AudioContext;
    class ControlledBoardContext {
      state = "running";
      destination = {};
      async resume() {}
      async decodeAudioData() { return { duration: 0.5 }; }
      createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
      createDynamicsCompressor() {
        return { threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 },
          attack: { value: 0 }, release: { value: 0 }, connect() {} };
      }
      createBufferSource() {
        const source = {
          buffer: null, playbackRate: { value: 1 }, onended: null as (() => void) | null, ended: false,
          connect() {}, disconnect() {}, start() { sources.push(source); },
          stop() { if (!source.ended) { source.ended = true; source.onended?.(); } }
        };
        return source;
      }
    }
    let contexts = 0;
    let htmlPlayers = 0;
    if (backend === "html") {
      // Exercise the genuine no-Web-Audio path in both the service and Phaser.
      Object.defineProperty(window, "AudioContext", { configurable: true, value: undefined });
      Object.defineProperty(window, "webkitAudioContext", { configurable: true, value: undefined });
      window.Audio = new Proxy(window.Audio, {
        construct(constructor, args) {
          const element: HTMLAudioElement = Reflect.construct(constructor, args);
          if (!String(args[0]).includes("/audio/web-overrides/")) return element;
          htmlPlayers++;
          let current: (typeof sources)[number] | undefined;
          // Reproduce play() succeeding with neither ended nor error ever arriving.
          element.play = async () => {
            const source = { ended: false, onended: null, stop() {
              if (source.ended) return;
              source.ended = true;
              element.dispatchEvent(new Event("ended"));
            } };
            current = source;
            sources.push(source);
          };
          element.pause = () => { if (current) current.ended = true; };
          return element;
        }
      });
    } else {
      window.AudioContext = new Proxy(NativeAudioContext, {
        construct(constructor, args) {
          return contexts++ === 0 ? new ControlledBoardContext() : Reflect.construct(constructor, args);
        }
      });
    }
    window.__gwReleaseTestAudio = () => [...sources].forEach(source => source.stop());
    window.__gwPendingTestAudio = () => sources.filter(source => !source.ended).length;
    window.__gwAllocatedTestAudio = () => htmlPlayers;
  }, backend);
}

async function openWinningBoard(page: Page) {
  await page.goto("/?gwTestMode=1&level=5");
  await page.waitForFunction(() => window.__gwBoardReady);
  await page.getByTestId("qa-setup-winning-rocket-combo").click();
}

async function triggerAndWaitForTail(page: Page, action = "qa-trigger-winning-rocket-combo") {
  await page.getByTestId(action).click();
  await page.waitForFunction(() => window.__gwResolutionFrames?.some(frame => frame.kind === "settled"));
  const boundary = await page.evaluate(() => ({
    active: window.__gwPendingTestAudio!(), kinds: window.__gwPresentationTrace!.map(entry => entry.kind)
  }));
  expect(boundary.active).toBeGreaterThan(0);
  expect(boundary.kinds).not.toContain("resolution-complete");
  expect(boundary.kinds).not.toContain("win-sequence-start");
}

test("a winning power-up waits for its actual audio tail before Grid Secure starts", async ({ page }) => {
  await holdBoardAudio(page);
  await openWinningBoard(page);
  await triggerAndWaitForTail(page);
  await page.evaluate(() => window.__gwReleaseTestAudio!());
  await page.waitForFunction(() => window.__gwPresentationTrace?.some(entry => entry.kind === "win-sequence-start"));
  await expect(page.getByText("Grid secured")).toBeVisible({ timeout: 8_000 });
});

for (const input of ["tile", "booster"] as const) {
  test(`held audio tails reject ${input} pointer gestures until resolution completes`, async ({ page }) => {
    await holdBoardAudio(page);
    if (input === "booster") {
      await page.goto("/?gwTestMode=1&level=1");
      await page.waitForFunction(() => window.__gwBoardReady);
      await triggerAndWaitForTail(page, "qa-swap");
      await page.getByTestId("booster-tnt").click();
      await expect(page.locator("canvas")).toHaveClass(/booster-targeting/);
    } else {
      await openWinningBoard(page);
      await triggerAndWaitForTail(page);
    }
    const gesture = () => page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>("[data-testid=board-canvas] canvas")!;
      const point = window.__gwBoardCellClientPoint!(0, 0)!;
      const accepted: boolean[] = [];
      for (const type of ["pointerdown", "pointermove", "pointerup"]) {
        const event = new PointerEvent(type, { bubbles: true, cancelable: true, composed: true,
          button: 0, buttons: type === "pointerup" ? 0 : 1, clientX: point.x, clientY: point.y,
          isPrimary: true, pointerId: 1, pointerType: "mouse", view: window });
        canvas.dispatchEvent(event);
        accepted.push(event.defaultPrevented);
      }
      return accepted;
    });
    expect(await gesture()).toEqual([false, false, false]);
    await page.evaluate(() => window.__gwReleaseTestAudio!());
    await page.waitForFunction(() => window.__gwPresentationTrace?.some(entry => entry.kind === "resolution-complete"));
    if (input === "tile") await expect(page.getByText("Grid secured")).toBeVisible({ timeout: 8_000 });
    else expect((await gesture())[0]).toBe(true);
  });
}

test("a stalled HTML audio tail completes normally within its one-second scene-clock deadline", async ({ page }) => {
  await holdBoardAudio(page, "html");
  await openWinningBoard(page);
  await triggerAndWaitForTail(page);
  expect(await page.evaluate(() => window.__gwAllocatedTestAudio!())).toBeLessThanOrEqual(16);
  await page.waitForFunction(() => window.__gwPresentationTrace?.some(entry => entry.kind === "resolution-complete"),
    undefined, { timeout: 3_000 });
  const result = await page.evaluate(() => ({
    trace: window.__gwPresentationTrace!, settledAt: window.__gwResolutionFrames!.at(-1)!.atMs
  }));
  const completions = result.trace.filter(entry => entry.kind === "resolution-complete");
  const waits = result.trace.filter(entry => entry.kind === "audio-tail-wait");
  const deadlines = result.trace.filter(entry => entry.kind === "audio-tail-deadline");
  expect(completions).toHaveLength(1);
  expect(waits).toHaveLength(1);
  expect(waits[0].detail).toBe("1000");
  expect(deadlines).toHaveLength(1);
  expect(waits[0].atMs).toBe(result.settledAt);
  expect(completions[0].atMs - result.settledAt).toBeGreaterThanOrEqual(1_000);
  expect(completions[0].atMs).toBe(deadlines[0].atMs);
  expect(result.trace.some(entry => entry.kind === "resolution-recovery")).toBe(false);
  await expect(page.getByText("Grid secured")).toBeVisible({ timeout: 8_000 });
});

test("the audio-tail deadline pauses with the hidden scene and completes after resuming", async ({ page }) => {
  await holdBoardAudio(page);
  await page.goto("/?gwTestMode=1&level=1");
  await page.waitForFunction(() => window.__gwBoardReady);
  await triggerAndWaitForTail(page, "qa-swap");
  await setHidden(page, true);
  const before = await page.evaluate(() => window.__gwPresentationTrace);
  // Span the entire deadline in wall time while the Phaser clock is paused.
  await page.waitForTimeout(1_200);
  expect(await page.evaluate(() => window.__gwPresentationTrace)).toEqual(before);
  expect(await page.evaluate(() => window.__gwPendingTestAudio!())).toBeGreaterThan(0);
  await setHidden(page, false);
  await page.waitForFunction(() => window.__gwPresentationTrace?.some(entry => entry.kind === "resolution-complete"),
    undefined, { timeout: 3_000 });
  expect(await page.evaluate(() => window.__gwPendingTestAudio!())).toBe(0);
  expect(await page.evaluate(() => window.__gwPresentationTrace?.filter(entry => entry.kind === "resolution-complete"))).toHaveLength(1);
});

test("leaving during a held audio tail cancels its deadline, sounds, and result callback", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await holdBoardAudio(page);
  await openWinningBoard(page);
  await triggerAndWaitForTail(page);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByTestId("board-canvas")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__gwPendingTestAudio!())).toBe(0);
  await page.waitForTimeout(1_200);
  expect(await page.evaluate(() => window.__gwPresentationTrace)).toBeUndefined();
  await expect(page.getByText("Grid secured", { exact: true })).not.toBeVisible();
  expect(errors).toEqual([]);
});

async function setHidden(page: Page, hidden: boolean) {
  await page.evaluate(hidden => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => hidden ? "hidden" : "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}
