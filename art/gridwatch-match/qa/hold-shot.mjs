// usage: node hold-shot.mjs <repo> <base url> <out prefix> <level> <row> <col> [extra query]
// Presses the tile at (row, col), drags a quarter of the way toward the cell below, screenshots
// (the held state), lets go where it started (no move), and screenshots again. iPhone 15 size.
import { createRequire } from "node:module";
const [repo, base, out, level, row, col, extra = ""] = process.argv.slice(2);
const { chromium, devices } = createRequire(repo + "/package.json")("@playwright/test");
const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext(devices["iPhone 15"]);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`${base}/?gwTestMode=1&level=${level}${extra}`, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__gwBoardReady === true, null, { timeout: 15000 });
await page.waitForTimeout(600);
const canvas = page.locator('[data-testid="board-canvas"] canvas');
const point = (type, p, buttons) => page.evaluate(({ type, p, buttons }) => {
  const c = document.querySelector('[data-testid="board-canvas"] canvas');
  c.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: "mouse", isPrimary: true, clientX: p.x, clientY: p.y, button: 0, buttons, view: window }));
}, { type, p, buttons });
const cell = (r, c) => page.evaluate(({ r, c }) => window.__gwBoardCellClientPoint(r, c), { r, c });
const from = await cell(Number(row), Number(col)), to = await cell(Number(row) + 1, Number(col));
await point("pointerdown", from, 1);
await point("pointermove", { x: from.x, y: from.y + (to.y - from.y) * 0.25 }, 1);
await page.waitForTimeout(250);
await canvas.screenshot({ path: `${out}-held.png` });
await point("pointermove", from, 1);
await point("pointerup", from, 0);
await page.waitForTimeout(700);
await canvas.screenshot({ path: `${out}-released.png` });
const moves = await page.locator("text=/\\d+\\/\\d+/").first().textContent().catch(() => null);
console.log(JSON.stringify({ moves, errors }));
await browser.close();
