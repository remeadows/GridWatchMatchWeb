// usage: node game-shots.mjs <repo> <base url> <out prefix> [level] [extra query]
// The game screen as a player sees it (viewport, not the board alone), then the result dialog
// after test mode's "QA Win". Desktop and iPhone 15 sizes.
import { createRequire } from "node:module";
const [repo, base, out, level = "34", extra = ""] = process.argv.slice(2);
const { chromium, devices } = createRequire(repo + "/package.json")("@playwright/test");
const browser = await chromium.launch({ channel: "chrome" });
for (const [name, device] of [["desktop", { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }], ["mobile", devices["iPhone 15"]]]) {
  const context = await browser.newContext(device);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}/?gwTestMode=1&level=${level}${extra}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__gwBoardReady === true, null, { timeout: 15000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}-${name}-game.png` });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await page.locator('[data-testid="booster-tnt"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}-${name}-dock.png` });
  await page.locator('[data-testid="qa-win"]').click();
  await page.getByRole("heading", { name: "Grid secured" }).waitFor({ timeout: 10000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}-${name}-result.png` });
  console.log(JSON.stringify({ name, errors, horizontalOverflowPx: overflow }));
  await context.close();
}
await browser.close();
