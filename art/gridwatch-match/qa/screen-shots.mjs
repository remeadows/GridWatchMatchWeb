// usage: node screen-shots.mjs <repo> <base url> <out prefix> [extra query]
// Walks the menus by their own buttons and takes a viewport screenshot of each screen at desktop
// and iPhone 15 sizes: home, operations, a sector's levels, intel, account, store, settings.
import { createRequire } from "node:module";
const [repo, base, out, extra = ""] = process.argv.slice(2);
const { chromium, devices } = createRequire(repo + "/package.json")("@playwright/test");
const browser = await chromium.launch({ channel: "chrome" });
for (const [name, device] of [["desktop", { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }], ["mobile", devices["iPhone 15"]]]) {
  const context = await browser.newContext(device);
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
  await page.goto(`${base}/?gwTestMode=1${extra}`, { waitUntil: "networkidle" });
  const overflow = {};
  const shot = async (screen) => {
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}-${name}-${screen}.png` });
    overflow[screen] = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  };
  const nav = (label) => page.locator(".main-nav").getByRole("button", { name: label, exact: true }).click();
  await shot("home");
  await nav("Operations");
  await shot("operations");
  await page.getByRole("button", { name: "Open Levels" }).first().click();
  await shot("levels");
  for (const label of ["Intel", "Account", "Store", "Settings"]) {
    await nav(label);
    await shot(label.toLowerCase());
  }
  console.log(JSON.stringify({ name, errors, horizontalOverflowPx: overflow }));
  await context.close();
}
await browser.close();
