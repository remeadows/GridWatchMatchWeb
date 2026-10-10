// Release check: load a production build as a player would (no test mode), on a desktop Chromium
// and an iPhone-15 WebKit, optionally press buttons, and report the theme the page opened in,
// console errors, failed requests and the music and voice files fetched. Exits 1 on a console
// error, a DEV badge, or a requested button that is not there. Run it on a local build before a
// deploy and on the live URL after one. The title screen ("tap to enter") is entered first, as a
// player would, so GW_STEPS names what comes after it.
//   GW_STEPS='["Quick Deploy","Skip"]' node release-check.mjs <repo> <base url> <out dir>
// The live Nexus page always logs Cloudflare's injected scripts being blocked by its security
// policy; csp-server.mjs serves a local build under that policy without them. A screenshot makes
// WebKit log "Refused to apply a stylesheet": that is Playwright's own caret-hiding style meeting
// the policy, not the game, so it is not counted (found 2026-10-10; it had been read as the game's).
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import path from "node:path";

const [repo, base, outDir] = process.argv.slice(2);
const require = createRequire(path.join(repo, "package.json"));
const { chromium, webkit, devices } = require("@playwright/test");
mkdirSync(outDir, { recursive: true });

const targets = [
  { name: "desktop", browser: chromium, context: { viewport: { width: 1440, height: 900 } } },
  { name: "mobile", browser: webkit, context: { ...devices["iPhone 15"] } },
];

let failed = false;
for (const target of targets) {
  const browser = await target.browser.launch();
  const context = await browser.newContext(target.context);
  const page = await context.newPage();
  const errors = [];
  const badRequests = [];
  const audio = new Set();
  let shooting = false;
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (shooting && /Refused to apply a stylesheet/.test(message.text())) return;
    errors.push(message.text());
  });
  const shot = async (name) => {
    shooting = true;
    await page.screenshot({ path: path.join(outDir, `${target.name}-${name}.png`) });
    await page.waitForTimeout(150);
    shooting = false;
  };
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("response", (response) => {
    const url = new URL(response.url());
    const local = url.origin === new URL(base).origin;
    if (local && response.status() >= 400) badRequests.push(`${response.status()} ${url.pathname}`);
    if (local && /\/audio\/(music|voice)\//.test(url.pathname)) {
      const type = response.headers()["content-type"] ?? "";
      audio.add(`${path.basename(url.pathname)} ${response.status()} ${type}`);
    }
  });

  await page.goto(base, { waitUntil: "networkidle" });
  await shot("1-open");
  const theme = await page.evaluate(() => document.documentElement.dataset.boardTheme ?? "");
  console.log(`[${target.name}] theme on open: ${theme}`);
  const buttons = await page.getByRole("button").allInnerTexts();
  console.log(`[${target.name}] buttons on open: ${JSON.stringify(buttons.map((text) => text.replace(/\s+/g, " ").trim()).slice(0, 14))}`);

  const title = page.getByTestId("title-enter");
  if (await title.count()) {
    await title.click();
    await page.waitForTimeout(800);
    await shot("1b-menu");
    console.log(`[${target.name}] entered through the title screen`);
  }
  for (const step of process.env.GW_STEPS ? JSON.parse(process.env.GW_STEPS) : []) {
    const button = page.getByRole("button", { name: new RegExp(step, "i") }).first();
    if (await button.isVisible()) {
      await button.click();
      await page.waitForTimeout(1500);
      console.log(`[${target.name}] clicked "${step}"`);
    } else {
      // A step that cannot be taken means the check did not see what it was asked to see.
      console.log(`[${target.name}] MISSING button "${step}"`);
      failed = true;
    }
  }
  await page.waitForTimeout(2500);
  await shot("2-after");
  const canvas = await page.locator("canvas").count();
  const badge = await page.getByText(/DEV ·/).count();
  console.log(`[${target.name}] canvas: ${canvas}, dev badge: ${badge}`);
  console.log(`[${target.name}] audio: ${JSON.stringify([...audio])}`);
  console.log(`[${target.name}] console errors: ${JSON.stringify(errors)}`);
  console.log(`[${target.name}] failed requests: ${JSON.stringify(badRequests)}`);
  if (errors.length || badge) failed = true;
  await browser.close();
}
process.exit(failed ? 1 : 0);
