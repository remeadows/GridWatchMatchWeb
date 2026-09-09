import { expect, test } from "@playwright/test";

test("a winning power-up waits for its actual audio tail before Grid Secure starts", async ({ page }) => {
  await page.addInitScript(() => {
    const sources: Array<{ ended: boolean; onended: (() => void) | null; stop: () => void }> = [];
    const target = window as unknown as {
      AudioContext: unknown; __gwReleaseTestAudio: () => void; __gwPendingTestAudio: () => number;
    };
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
    target.AudioContext = new Proxy(NativeAudioContext, {
      construct(constructor, args) {
        return contexts++ === 0 ? new ControlledBoardContext() : Reflect.construct(constructor, args);
      }
    });
    target.__gwReleaseTestAudio = () => [...sources].forEach(source => source.stop());
    target.__gwPendingTestAudio = () => sources.filter(source => !source.ended).length;
  });
  await page.goto("/?gwTestMode=1&level=5");
  await page.waitForFunction(() => (window as unknown as { __gwBoardReady: boolean }).__gwBoardReady);
  await page.getByTestId("qa-setup-winning-rocket-combo").click();
  await page.getByTestId("qa-trigger-winning-rocket-combo").click();
  await page.waitForFunction(() => (window as unknown as { __gwResolutionFrames: { kind: string }[] })
    .__gwResolutionFrames?.some(frame => frame.kind === "settled"));
  const boundary = await page.evaluate(() => {
    const target = window as unknown as {
      __gwPendingTestAudio: () => number; __gwPresentationTrace: { kind: string }[];
    };
    return { active: target.__gwPendingTestAudio(), kinds: target.__gwPresentationTrace.map(entry => entry.kind) };
  });
  expect(boundary.active).toBeGreaterThan(0);
  expect(boundary.kinds).not.toContain("resolution-complete");
  expect(boundary.kinds).not.toContain("win-sequence-start");
  await page.evaluate(() => (window as unknown as { __gwReleaseTestAudio: () => void }).__gwReleaseTestAudio());
  await page.waitForFunction(() => (window as unknown as { __gwPresentationTrace: { kind: string }[] })
    .__gwPresentationTrace.some(entry => entry.kind === "win-sequence-start"));
  await expect(page.getByText("Grid secured")).toBeVisible({ timeout: 8_000 });
});
