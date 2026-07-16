import { expect, test, type Page } from "@playwright/test";
import type { PresentationTraceEntry } from "../../src/game/presentation";

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

test.describe("normal presentation timeline", () => {
  test("records a fast scene-clock swap, impact, cascade, and completion sequence", async ({ page }) => {
    await page.goto("/?gwTestMode=1&level=1");
    await page.getByTestId("board-canvas").waitFor({ state: "visible" });
    await waitForBoardReady(page);

    await page.getByTestId("qa-swap").click();
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
    expect(impact.plannedAtMs - swapSettled.plannedAtMs).toBeGreaterThanOrEqual(80);
    expect(impact.plannedAtMs - swapSettled.plannedAtMs).toBeLessThanOrEqual(130);
    expect(cascadeStart.plannedAtMs - impact.plannedAtMs).toBeGreaterThanOrEqual(80);
    expect(cascadeStart.plannedAtMs - impact.plannedAtMs).toBeLessThanOrEqual(170);
    expect(cascadeLand.plannedAtMs).toBeLessThan(complete.plannedAtMs);
    expect(complete.plannedAtMs - trace[0].plannedAtMs).toBeLessThanOrEqual(900);
    expect(cascadeStart.detail).toBe("occupants-unique");
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
    expect(trace.map((entry) => entry.kind)).toEqual(["action-received", "resolution-complete"]);
    expect(complete.plannedAtMs - trace[0].plannedAtMs).toBeLessThanOrEqual(180);
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

async function presentationTrace(page: Page): Promise<PresentationTraceEntry[]> {
  return page.evaluate(() => (
    (window as Window & { __gwPresentationTrace?: PresentationTraceEntry[] }).__gwPresentationTrace ?? []
  ));
}

function traceEntry(trace: PresentationTraceEntry[], kind: string): PresentationTraceEntry {
  const entry = trace.find((candidate) => candidate.kind === kind);
  if (!entry) throw new Error(`Missing presentation trace entry: ${kind}`);
  return entry;
}
