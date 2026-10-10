import { expect, test, type Page } from "@playwright/test";

// The title screen (src/state/titleGate.ts): the game opens on "tap to enter" so the player's
// first tap can start the menu music. Only the dark menu has one; the archived classic menu,
// which a GW_THEME=classic build of this suite runs on, opens straight on its actions.
async function openOnTitle(page: Page, url = "./"): Promise<void> {
  await page.goto(url);
  const theme = await page.evaluate(() => document.documentElement.dataset.boardTheme);
  test.skip(theme !== "darkRealism", "the archived classic menu has no title screen");
  await page.getByTestId("home-command-deck").waitFor({ state: "visible" });
}

const enter = (page: Page) => page.getByTestId("title-enter");
const resume = (page: Page) => page.getByRole("button", { name: /Resume Operations/ });
const quickDeploy = (page: Page) => page.getByRole("button", { name: /Quick Deploy/ });

test("opens on the title, and one tap puts the menu's actions where the prompt was", async ({ page }) => {
  await openOnTitle(page);
  await expect(enter(page)).toBeVisible();
  await expect(enter(page)).toContainText("Sound on");
  await expect(resume(page)).toBeHidden();
  await expect(quickDeploy(page)).toBeHidden();

  const panel = page.locator(".dr-home-panel");
  const before = await panel.boundingBox();
  await enter(page).click();
  await expect(enter(page)).toHaveCount(0);
  await expect(resume(page)).toBeVisible();
  await expect(quickDeploy(page)).toBeVisible();
  // Nothing moves when they arrive: the panel keeps the box it had under the prompt.
  expect(await panel.boundingBox()).toEqual(before);
});

test("the first key enters, but not the keys that only walk focus or modify", async ({ page }) => {
  await openOnTitle(page);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift");
  await expect(enter(page)).toBeVisible();
  await page.keyboard.press("a");
  await expect(enter(page)).toHaveCount(0);
  await expect(resume(page)).toBeVisible();
});

test("a first click elsewhere enters too, the button still does its job, and the title is shown once", async ({ page }) => {
  await openOnTitle(page);
  await page.getByRole("button", { name: "Operations", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open Levels" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Home" }).click();
  await expect(resume(page)).toBeVisible();
  await expect(enter(page)).toHaveCount(0);
});

test("goes straight to the menu when the music is switched off", async ({ page }) => {
  await openOnTitle(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator("label.setting-row", { hasText: "Music" }).locator("input").uncheck();
  await page.reload();
  await page.getByTestId("home-command-deck").waitFor({ state: "visible" });
  await expect(resume(page)).toBeVisible();
  await expect(enter(page)).toHaveCount(0);
});

test("a page that opened without the title never shows it later, even once the music is switched on", async ({ page }) => {
  await openOnTitle(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const music = page.locator("label.setting-row", { hasText: "Music" }).locator("input");
  await music.uncheck();
  await page.reload();
  await page.getByTestId("home-command-deck").waitFor({ state: "visible" });
  await expect(enter(page)).toHaveCount(0);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await music.check();
  await page.getByRole("button", { name: "Home" }).click();
  await expect(resume(page)).toBeVisible();
  await expect(enter(page)).toHaveCount(0);
});

test("test mode goes straight to the menu", async ({ page }) => {
  await openOnTitle(page, "./?gwTestMode=1");
  await expect(resume(page)).toBeVisible();
  await expect(enter(page)).toHaveCount(0);
});
