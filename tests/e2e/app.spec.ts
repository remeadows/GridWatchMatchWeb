import { expect, test, type Page } from "@playwright/test";
import { GAMEPLAY_POLL_TIMEOUT_MS } from "../../src/data/gameplayTiming";

test.beforeEach(async ({ page }) => {
  await clearStorage(page);
});

test("boots from a GitHub Pages style base path", async ({ page }) => {
  await page.goto("/GridWatchMatchWeb/?gwTestMode=1");
  await expect(page.getByRole("heading", { name: "GridWatch Match" })).toBeVisible();
});

test("navigates Home to Operations to Level 1 and applies a deterministic swap", async ({ page }) => {
  await page.goto("/?gwTestMode=1");
  await page.getByRole("button", { name: "Operations", exact: true }).click();
  await page.getByRole("button", { name: "Open Levels" }).first().click();
  await page.getByRole("button", { name: "Level 1 Ready" }).click();
  await expect(page.getByTestId("board-canvas")).toBeVisible();
  await page.getByTestId("qa-swap").click();
  await expect(page.getByText(/Last clear:/)).toBeVisible();
});

test("dragging a board tile into a deterministic match applies a swap", async ({ page }) => {
  await page.goto("/?gwTestMode=1&level=1");
  await expect(page.getByTestId("board-canvas")).toBeVisible();

  await dragBoardCells(page, { row: 0, col: 0 }, { row: 1, col: 0 });

  await expect(page.getByText("24/25")).toBeVisible();
  await expect(page.getByText(/Last clear:/)).toBeVisible();
  await expect(page.getByText("Collect 20 Packets: 3/20")).toBeVisible();
});

test("match pops burst with particles", async ({ page }) => {
  await page.goto("/?gwTestMode=1&level=1");
  await expect(page.getByTestId("board-canvas")).toBeVisible();
  await waitForBoardReady(page);
  const burstCountBefore = await matchBurstCount(page);

  await dragBoardCells(page, { row: 0, col: 0 }, { row: 1, col: 0 });

  await expect(page.getByText(/Last clear:/)).toBeVisible();
  await expect.poll(() => matchBurstCount(page), { timeout: GAMEPLAY_POLL_TIMEOUT_MS }).toBeGreaterThan(burstCountBefore);
});

test("handles fail, Play On decline path, forced win, and next level unlock", async ({ page }) => {
  await page.goto("/?gwTestMode=1&level=1");
  await expect(page.getByTestId("board-canvas")).toBeVisible();
  await page.getByTestId("qa-fail").click();
  await expect(page.getByText("Mission at risk")).toBeVisible();
  await page.getByRole("button", { name: "End Mission" }).click();
  await expect(page.getByText("Grid compromised")).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await page.getByTestId("qa-win").click();
  await expect(page.getByText("Grid secured")).toBeVisible();
  await page.getByRole("button", { name: "Next Level" }).click();
  await expect(page.getByText("Level 2")).toBeVisible();
});

test("boss timer fail is surfaced", async ({ page }) => {
  await page.goto("/?gwTestMode=1&level=10");
  await expect(page.getByText("Breach")).toBeVisible();
  await page.getByTestId("qa-boss-timeout").click();
  await expect(page.getByText("Grid compromised")).toBeVisible();
  await expect(page.locator(".modal").getByText("Boss timer expired.")).toBeVisible();
});

test("booster tray requires a deliberate board target", async ({ page }) => {
  await page.goto("/?gwTestMode=1&level=1");
  await expect(page.getByTestId("board-canvas")).toBeVisible();
  const booster = page.getByTestId("booster-tnt");
  await expect(booster.locator("strong")).toHaveText("3");
  await booster.click();
  await expect(page.getByText("Choose a grid tile.")).toBeVisible();
  await expect(booster.locator("strong")).toHaveText("3");
  await expect(page.getByText(/Last clear:/)).not.toBeVisible();

  const board = await page.getByTestId("board-canvas").boundingBox();
  expect(board).not.toBeNull();
  await page.mouse.click(board!.x + board!.width / 2, board!.y + board!.height / 2);
  await expect(page.getByText(/Last clear:/)).toBeVisible();
  await expect(booster.locator("strong")).toHaveText("2");
});

test("booster tap clears use the tile pop animation path", async ({ page }) => {
  await page.goto("/?gwTestMode=1&level=1");
  await expect(page.getByTestId("board-canvas")).toBeVisible();
  await waitForBoardReady(page);
  const popCountBefore = await tilePopCount(page);

  const booster = page.getByTestId("booster-tnt");
  await booster.click();
  const target = await boardCellPoint(page, { row: 3, col: 3 });
  await page.mouse.click(target.x, target.y);

  await expect(page.getByText(/Last clear:/)).toBeVisible();
  await expect.poll(() => tilePopCount(page), { timeout: GAMEPLAY_POLL_TIMEOUT_MS }).toBeGreaterThan(popCountBefore);
});

test("clicking a booster starts power-up fx before cascade", async ({ page }) => {
  await page.goto("/?gwTestMode=1&level=1");
  await expect(page.getByTestId("board-canvas")).toBeVisible();
  await waitForBoardReady(page);
  const popCountBefore = await tilePopCount(page);
  const fxCountBefore = await powerUpFxCount(page);

  const booster = page.getByTestId("booster-tnt");
  await booster.click();
  const target = await boardCellPoint(page, { row: 3, col: 3 });
  await page.mouse.click(target.x, target.y);

  await expect(page.getByText(/Last clear:/)).toBeVisible();
  await expect.poll(() => tilePopCount(page), { timeout: GAMEPLAY_POLL_TIMEOUT_MS }).toBeGreaterThan(popCountBefore);
  await expect.poll(() => powerUpFxCount(page), { timeout: GAMEPLAY_POLL_TIMEOUT_MS }).toBeGreaterThan(fxCountBefore);
});

test("TNT booster detonates with shockwave effects", async ({ page }) => {
  await page.goto("/?gwTestMode=1&level=1");
  await expect(page.getByTestId("board-canvas")).toBeVisible();
  await waitForBoardReady(page);
  const detonationCountBefore = await tntDetonationCount(page);

  await page.getByTestId("booster-tnt").click();
  const target = await boardCellPoint(page, { row: 3, col: 3 });
  await page.mouse.click(target.x, target.y);

  await expect(page.getByText(/Last clear:/)).toBeVisible();
  await expect.poll(() => tntDetonationCount(page), { timeout: GAMEPLAY_POLL_TIMEOUT_MS }).toBeGreaterThan(detonationCountBefore);
});

test("rocket booster launches projectile heads", async ({ page }) => {
  await page.goto("/?gwTestMode=1&level=1");
  await expect(page.getByTestId("board-canvas")).toBeVisible();
  await waitForBoardReady(page);
  const launchCountBefore = await rocketLaunchCount(page);

  await page.getByTestId("booster-rocket").click();
  const target = await boardCellPoint(page, { row: 3, col: 3 });
  await page.mouse.click(target.x, target.y);

  await expect(page.getByText(/Last clear:/)).toBeVisible();
  await expect.poll(() => rocketLaunchCount(page), { timeout: GAMEPLAY_POLL_TIMEOUT_MS }).toBeGreaterThanOrEqual(launchCountBefore + 2);
});

test("dragging a booster onto the board consumes inventory and activates at drop", async ({ page }) => {
  await page.goto("/?gwTestMode=1&level=1");
  await expect(page.getByTestId("board-canvas")).toBeVisible();
  const booster = page.getByTestId("booster-rocket");
  await booster.scrollIntoViewIfNeeded();
  const boosterBox = await booster.boundingBox();
  const board = await page.getByTestId("board-canvas").boundingBox();
  expect(boosterBox).not.toBeNull();
  expect(board).not.toBeNull();

  await page.mouse.move(boosterBox!.x + boosterBox!.width / 2, boosterBox!.y + boosterBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(board!.x + board!.width / 2, board!.y + board!.height / 2, { steps: 8 });
  await page.mouse.up();

  await expect(page.getByText(/Last clear:/)).toBeVisible();
  await expect(booster.locator("strong")).toHaveText("2");
});

test("store stub never grants coins", async ({ page }) => {
  await page.goto("/?gwTestMode=1");
  await expect(page.getByLabel("0 coins")).toBeVisible();
  await page.getByRole("button", { name: "Store" }).click();
  await page.getByRole("button", { name: "$1.99" }).click();
  await expect(page.getByText(/disabled until a secure backend exists/)).toBeVisible();
  await expect(page.getByLabel("0 coins")).toBeVisible();
});

test("settings and intel review state persist", async ({ page }) => {
  await page.goto("/?gwTestMode=1");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Reduced Motion").check();
  await expect(page.getByLabel("Reduced Motion")).toBeChecked();
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Reduced Motion")).toBeChecked();

  await page.getByRole("button", { name: "Intel" }).click();
  await page.getByRole("button", { name: "Mark Reviewed" }).first().click();
  await page.reload();
  await page.getByRole("button", { name: "Intel" }).click();
  await expect(page.getByRole("button", { name: "Reviewed" }).first()).toBeVisible();
});

test("board and HUD do not overlap at active viewport", async ({ page }) => {
  await page.goto("/?gwTestMode=1&level=1");
  const hud = await page.locator(".game-hud").boundingBox();
  const objectives = await page.locator(".objective-row").boundingBox();
  const board = await page.getByTestId("board-canvas").boundingBox();
  expect(hud).not.toBeNull();
  expect(objectives).not.toBeNull();
  expect(board).not.toBeNull();
  expect(board!.y).toBeGreaterThanOrEqual(objectives!.y + objectives!.height);
  expect(objectives!.y).toBeGreaterThanOrEqual(hud!.y + hud!.height);
});

async function clearStorage(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase("gridwatch-match-web");
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });
}

async function dragBoardCells(page: Page, from: { row: number; col: number }, to: { row: number; col: number }): Promise<void> {
  await page.locator('[data-testid="board-canvas"] canvas').waitFor({ state: "visible" });
  await waitForBoardReady(page);

  await page.evaluate(({ from, to }) => {
    const w = window as Window & {
      __gwBoardCellClientPoint?: (row: number, col: number) => { x: number; y: number } | null;
    };
    const start = w.__gwBoardCellClientPoint?.(from.row, from.col);
    const end = w.__gwBoardCellClientPoint?.(to.row, to.col);
    if (!start || !end) throw new Error("Board cell client points unavailable");

    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="board-canvas"] canvas');
    if (!canvas) throw new Error("Board canvas not found");

    const dispatch = (type: "pointerdown" | "pointermove" | "pointerup", point: { x: number; y: number }, buttons: number) => {
      canvas.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        clientX: point.x,
        clientY: point.y,
        button: 0,
        buttons,
        view: window
      }));
    };

    dispatch("pointerdown", start, 1);
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      dispatch("pointermove", {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t
      }, 1);
    }
    dispatch("pointerup", end, 0);
  }, { from, to });
}

async function waitForBoardReady(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const w = window as Window & {
      __gwBoardReady?: boolean;
      __gwBoardCellClientPoint?: (row: number, col: number) => { x: number; y: number } | null;
    };
    return w.__gwBoardReady === true && typeof w.__gwBoardCellClientPoint === "function";
  });
}

async function boardCellPoint(page: Page, position: { row: number; col: number }): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(({ position }) => {
    const w = window as Window & {
      __gwBoardCellClientPoint?: (row: number, col: number) => { x: number; y: number } | null;
    };
    return w.__gwBoardCellClientPoint?.(position.row, position.col) ?? null;
  }, { position });
  if (!point) throw new Error(`Board cell point unavailable for ${position.row},${position.col}`);
  return point;
}

async function tilePopCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as Window & { __gwTilePopAnimationCount?: number };
    return w.__gwTilePopAnimationCount ?? 0;
  });
}

async function powerUpFxCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as Window & { __gwPowerUpFxStartCount?: number };
    return w.__gwPowerUpFxStartCount ?? 0;
  });
}

async function matchBurstCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as Window & { __gwMatchBurstCount?: number };
    return w.__gwMatchBurstCount ?? 0;
  });
}

async function tntDetonationCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as Window & { __gwTntDetonationCount?: number };
    return w.__gwTntDetonationCount ?? 0;
  });
}

async function rocketLaunchCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as Window & { __gwRocketLaunchCount?: number };
    return w.__gwRocketLaunchCount ?? 0;
  });
}
