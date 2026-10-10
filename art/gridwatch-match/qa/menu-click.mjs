import { createRequire } from "node:module";
const [repo, base] = process.argv.slice(2);
const { chromium, devices } = createRequire(repo + "/package.json")("@playwright/test");
const browser = await chromium.launch({ channel: "chrome" });
const page = await (await browser.newContext(devices["iPhone 15"])).newPage();
// The game opens on its title ("tap to enter"); the menu's two buttons are behind that first tap.
const open = async () => {
  await page.goto(base + "/", { waitUntil: "networkidle" });
  const title = page.getByTestId("title-enter");
  if (await title.count()) await title.click();
};
await open();
await page.getByRole("button", { name: "Quick Deploy" }).click();
await page.waitForFunction(() => document.querySelector('[data-testid="board-canvas"] canvas'), null, { timeout: 15000 });
console.log("quick deploy ->", await page.locator("text=/Level \\d+/i").first().textContent());
await open();
await page.getByRole("button", { name: "Resume Operations" }).click();
console.log("resume ->", await page.getByRole("button", { name: "Open Levels" }).first().isVisible());
await browser.close();
