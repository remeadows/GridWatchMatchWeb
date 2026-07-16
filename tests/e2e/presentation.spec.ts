import { expect, test } from "@playwright/test";

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
