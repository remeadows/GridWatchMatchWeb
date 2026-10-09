// usage: node board-shots.mjs <repo> <base url> <out prefix> [level] [extra query]
// Shots of the board (idle, a held tile, after one real swap) at desktop and iPhone 15 sizes.
import { createRequire } from "node:module";
const [repo, base, out, level = "1", extra = ""] = process.argv.slice(2);
const { chromium, devices } = createRequire(repo + "/package.json")("@playwright/test");
const browser = await chromium.launch({ channel: "chrome" });
const sizes = [["desktop", { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 }], ["mobile", devices["iPhone 15"]]];
for (const [name, device] of sizes) {
  const context = await browser.newContext(device);
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
  await page.goto(`${base}/?gwTestMode=1&level=${level}${extra}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__gwBoardReady === true, null, { timeout: 15000 });
  await page.waitForTimeout(600);
  const canvas = page.locator('[data-testid="board-canvas"] canvas');
  await canvas.screenshot({ path: `${out}-${name}-idle.png` });
  const canvasSize = await canvas.evaluate((c) => ({ w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight }));
  const point = (type, p, buttons) => page.evaluate(({ type, p, buttons }) => {
    const c = document.querySelector('[data-testid="board-canvas"] canvas');
    c.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: "mouse", isPrimary: true, clientX: p.x, clientY: p.y, button: 0, buttons, view: window }));
  }, { type, p, buttons });
  const cell = (row, col) => page.evaluate(({ row, col }) => window.__gwBoardCellClientPoint(row, col), { row, col });
  const from = await cell(0, 0), to = await cell(1, 0);
  await point("pointerdown", from, 1);
  await point("pointermove", { x: from.x, y: from.y + (to.y - from.y) * 0.25 }, 1);
  await page.waitForTimeout(250);
  await canvas.screenshot({ path: `${out}-${name}-held.png` });
  for (let i = 3; i <= 12; i++) await point("pointermove", { x: from.x, y: from.y + (to.y - from.y) * (i / 12) }, 1);
  await point("pointerup", to, 0);
  await page.waitForTimeout(2600);
  const moves = await page.locator("text=/\\d+\\/\\d+/").first().textContent().catch(() => null);
  await canvas.screenshot({ path: `${out}-${name}-after-swap.png` });
  await page.screenshot({ path: `${out}-${name}-page.png` });
  console.log(JSON.stringify({ name, canvasSize, moves, errors }));
  await context.close();
}
await browser.close();
