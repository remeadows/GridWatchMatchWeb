import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type { LevelDefinition } from "../../src/engine";

const specimens = JSON.parse(readFileSync("src/tests/fixtures/resolution/specimens.json", "utf8")) as {
  name: string; level: LevelDefinition;
}[];

test("a failing final power-up finishes before Play On covers the board", async ({ page }) => {
  const level = structuredClone(specimens.find(item => item.name === "combo-rocket_h-tnt")!.level);
  level.moveLimit = 1;
  await openFixture(page, level);
  await tapRocket(page);
  await page.waitForFunction(() => (window as Window & { __gwPresentationTrace?: { kind: string }[] })
    .__gwPresentationTrace?.some(entry => entry.kind === "rocket-head-launch"));
  await expect(page.getByText("Mission at risk")).not.toBeVisible();
  await page.waitForFunction(() => (window as Window & { __gwPresentationTrace?: { kind: string }[] })
    .__gwPresentationTrace?.some(entry => entry.kind === "resolution-complete"));
  await expect(page.getByText("Mission at risk")).toBeVisible();
});

test("boss expiry waits for the active power-up", async ({ page }) => {
  const level = structuredClone(specimens.find(item => item.name === "combo-rocket_h-tnt")!.level);
  level.bossLevel = true;
  level.bossTimerSeconds = 90;
  await openFixture(page, level);
  await tapRocket(page);
  await waitForTrace(page, "rocket-head-launch");
  await page.getByTestId("qa-boss-timeout").click();
  await expect(page.getByText("Grid compromised", { exact: true })).not.toBeVisible();
  await waitForTrace(page, "resolution-complete");
  await expect(page.getByText("Grid compromised", { exact: true })).toBeVisible();
});

test("queued actions start only after the preceding resolution completes", async ({ page }) => {
  await openFixture(page, specimens.find(item => item.name === "combo-rocket_h-tnt")!.level);
  await tapRocket(page);
  await waitForTrace(page, "action-received");
  await page.getByTestId("qa-swap").click();
  await page.waitForFunction(() => (window as Window & { __gwPresentationTrace?: { kind: string }[] })
    .__gwPresentationTrace?.filter(entry => entry.kind === "action-received").length === 2);
  const kinds = await page.evaluate(() => (window as Window & { __gwPresentationTrace?: { kind: string }[] })
    .__gwPresentationTrace!.map(entry => entry.kind));
  expect(kinds.indexOf("resolution-complete")).toBeGreaterThan(0);
  expect(kinds.indexOf("resolution-complete")).toBeLessThan(kinds.lastIndexOf("action-received"));
});

test("boss clock does not charge forced playback", async ({ page }) => {
  const level = structuredClone(specimens.find(item => item.name === "combo-rocket_h-tnt")!.level);
  level.bossLevel = true;
  level.bossTimerSeconds = 90;
  await openFixture(page, level);
  await tapRocket(page);
  await waitForTrace(page, "rocket-head-launch");
  const remaining = await page.locator(".timer strong").textContent();
  await waitForTrace(page, "resolution-complete");
  await expect(page.locator(".timer strong")).toHaveText(remaining!);
});

test("a hidden terminal sequence waits to resume before showing the result", async ({ page }) => {
  await page.goto("./?gwTestMode=1&level=1");
  await page.waitForFunction(() => (window as Window & { __gwBoardReady?: boolean }).__gwBoardReady);
  await page.getByTestId("qa-win-animated").click();
  await waitForTrace(page, "win-sequence-start");
  await setHidden(page, true);
  // This wall wait deliberately spans the old result fallback, not a gameplay retry.
  await page.waitForTimeout(3_000);
  await expect(page.getByText("Grid secured", { exact: true })).not.toBeVisible();
  await setHidden(page, false);
  await waitForTrace(page, "win-sequence-complete");
  await expect(page.getByText("Grid secured", { exact: true })).toBeVisible();
});

async function setHidden(page: Page, hidden: boolean) {
  await page.evaluate(hidden => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => hidden ? "hidden" : "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

test("score waits for visible clears instead of jumping to the final total", async ({ page }) => {
  await page.goto("./?gwTestMode=1&level=1");
  await page.waitForFunction(() => (window as Window & { __gwBoardReady?: boolean }).__gwBoardReady);
  const score = page.locator(".game-hud > div").filter({ has: page.locator("span", { hasText: /^Score$/ }) }).locator("strong");
  await page.getByTestId("qa-swap").click();
  await waitForTrace(page, "action-received");
  await expect(score).toHaveText("0");
  await waitForTrace(page, "resolution-complete");
  await expect(score).not.toHaveText("0");
});

test("hidden power-up playback and its queued action resume without missing stages", async ({ page }) => {
  await openFixture(page, specimens.find(item => item.name === "combo-rocket_h-tnt")!.level);
  await tapRocket(page);
  await waitForTrace(page, "rocket-head-launch");
  await page.getByTestId("qa-swap").click();
  await setHidden(page, true);
  const before = await traceKinds(page);
  await page.waitForTimeout(1_200);
  expect(await traceKinds(page)).toEqual(before);
  await setHidden(page, false);
  await page.waitForFunction(() => (window as Window & { __gwPresentationTrace?: { kind: string }[] })
    .__gwPresentationTrace?.filter(entry => entry.kind === "resolution-complete").length === 2);
  const kinds = await traceKinds(page);
  expect(kinds).toContain("tnt-detonation");
  expect(kinds).not.toContain("resolution-recovery");
  expect(kinds.indexOf("resolution-complete")).toBeLessThan(kinds.lastIndexOf("action-received"));
  await expect(page.locator(".queue-meter")).toHaveText("Queue 0/3");
});

test("hidden idle boss time is preserved and visible idle time expires", async ({ page }) => {
  const level = structuredClone(specimens.find(item => item.name === "combo-rocket_h-tnt")!.level);
  level.bossLevel = true;
  level.bossTimerSeconds = 2;
  await openFixture(page, level);
  await setHidden(page, true);
  const remaining = await page.locator(".timer strong").textContent();
  await page.waitForTimeout(2_200);
  await expect(page.locator(".timer strong")).toHaveText(remaining!);
  await expect(page.getByText("Grid compromised", { exact: true })).not.toBeVisible();
  await setHidden(page, false);
  await expect(page.getByText("Grid compromised", { exact: true })).toBeVisible();
  await expect(page.locator(".timer strong")).toHaveText("0s");
});

test("leaving during playback cancels the old result and queued actions", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const level = structuredClone(specimens.find(item => item.name === "combo-rocket_h-tnt")!.level);
  level.moveLimit = 1;
  await openFixture(page, level);
  await tapRocket(page);
  await waitForTrace(page, "rocket-head-launch");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByTestId("board-canvas")).toHaveCount(0);
  await page.waitForTimeout(6_000);
  await expect(page.getByText("Mission at risk", { exact: true })).not.toBeVisible();
  await expect(page.getByText("Grid secured", { exact: true })).not.toBeVisible();
  expect(errors).toEqual([]);
});

async function traceKinds(page: Page) {
  return page.evaluate(() => (window as Window & { __gwPresentationTrace?: { kind: string }[] })
    .__gwPresentationTrace!.map(entry => entry.kind));
}

test("a new scene waits for current level data instead of replaying the previous action", async ({ page }) => {
  await page.goto("./?gwTestMode=1&level=1");
  await page.waitForFunction(() => (window as Window & { __gwBoardReady?: boolean }).__gwBoardReady);
  await page.getByTestId("qa-setup-winning-rocket-combo").click();
  await page.getByTestId("qa-trigger-winning-rocket-combo").click();
  await page.getByText("Grid secured", { exact: true }).waitFor();
  const oldCanvas = await page.locator("[data-testid=board-canvas] canvas").elementHandle();
  const oldTrace = await page.evaluateHandle(() => (window as Window & { __gwPresentationTrace?: unknown[] }).__gwPresentationTrace);
  let release = () => {};
  let requested = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const request = new Promise<void>(resolve => { requested = resolve; });
  await page.route("**/levels/level_002.json", async route => {
    requested();
    await gate;
    await route.fulfill({ path: "public/levels/level_002.json", contentType: "application/json" });
  });
  try {
    await page.getByRole("button", { name: "Next Level", exact: true }).click();
    await request;
    await page.waitForFunction(old => !old.isConnected, oldCanvas!);
    // React detaches the old canvas before Phaser's deferred teardown clears its trace.
    const newTrace = await page.waitForFunction(old => {
      const trace = (window as Window & { __gwPresentationTrace?: { kind: string }[] }).__gwPresentationTrace;
      return Array.isArray(trace) && trace !== old ? trace.map(entry => entry.kind) : false;
    }, oldTrace);
    expect(await newTrace.jsonValue()).not.toContain("action-received");
  } finally { release(); }
  await page.waitForFunction(() => (window as Window & { __gwBoardReady?: boolean }).__gwBoardReady);
  await page.getByTestId("qa-swap").click();
  await waitForTrace(page, "resolution-complete");
  expect((await traceKinds(page)).filter(kind => kind === "action-received")).toHaveLength(1);
  await expect(page.getByText("Level 2", { exact: true })).toBeVisible();
});

async function waitForTrace(page: Page, kind: string) {
  await page.waitForFunction(kind => (window as Window & { __gwPresentationTrace?: { kind: string }[] })
    .__gwPresentationTrace?.some(entry => entry.kind === kind), kind);
}

async function openFixture(page: Page, level: LevelDefinition) {
  await page.route("**/levels/level_001.json", route => route.fulfill({ json: level }));
  await page.goto("./?gwTestMode=1&level=1");
  await page.waitForFunction(() => (window as Window & { __gwBoardReady?: boolean }).__gwBoardReady);
}

async function tapRocket(page: Page) {
  await page.evaluate(() => {
    const target = window as unknown as Window & { __gwBoardCellClientPoint: (row: number, col: number) => { x: number; y: number } };
    const canvas = document.querySelector("[data-testid=board-canvas] canvas")!;
    const point = target.__gwBoardCellClientPoint(3, 3);
    for (const type of ["pointerdown", "pointerup"]) canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, button: 0, buttons: type === "pointerdown" ? 1 : 0,
      clientX: point.x, clientY: point.y, isPrimary: true, pointerId: 1, pointerType: "mouse", view: window
    }));
  });
}
