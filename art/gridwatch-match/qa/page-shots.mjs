// usage: node page-shots.mjs <repo> <url> <out prefix> [full]   -> desktop + iPhone 15 page screenshots
import { createRequire } from "node:module";
const [repo, url, out, full] = process.argv.slice(2);
const { chromium, devices } = createRequire(repo + "/package.json")("@playwright/test");
const browser = await chromium.launch({ channel: "chrome" });
for (const [name, device] of [["desktop", { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }], ["mobile", devices["iPhone 15"]]]) {
  const context = await browser.newContext(device);
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}-${name}.png`, fullPage: full === "full" });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(JSON.stringify({ name, errors, horizontalOverflowPx: overflow }));
  await context.close();
}
await browser.close();
