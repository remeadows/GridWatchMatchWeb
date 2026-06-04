import { expect, test, type Page } from "@playwright/test";

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
