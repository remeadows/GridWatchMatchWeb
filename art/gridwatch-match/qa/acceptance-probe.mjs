// usage: node acceptance-probe.mjs <repo> <base url> <out prefix>
// Checks from the brief's acceptance list that the e2e suite does not make, on the dark board at
// iPhone 15 size. Prints one JSON line per check.
//   missing-assets  every dark sprite request is refused: the board must still load on the classic
//                   pictures, take a real swap, and raise no page error
//   one-missing     only the frame, the lock clamps and one tile are refused: the rest stay dark
//   re-entry        a level is entered and left ten times: canvases, WebGL contexts in the page and
//                   the JS heap after a forced collection must not climb
//   background      the page is hidden and shown again mid-level, then a real swap must still work
//   full-loop       menu -> quick deploy -> win -> next level -> back -> home -> reload -> the menu
//                   shows the saved progress
//   grayscale       a screenshot of level 100 with colour removed, to judge shapes by eye
//   recording       a short video of one swap and its cascade on level 1
import { createRequire } from "node:module";
const [repo, base, out] = process.argv.slice(2);
const { chromium, devices } = createRequire(repo + "/package.json")("@playwright/test");
const browser = await chromium.launch({ channel: "chrome", args: ["--enable-precise-memory-info"] });
const phone = devices["iPhone 15"];
const ready = (page) => page.waitForFunction(() => window.__gwBoardReady === true, null, { timeout: 20000 });
const movesText = (page) => page.locator(".game-hud strong").nth(1).textContent();
const swap = async (page, from, to) => {
  const cell = (r, c) => page.evaluate(({ r, c }) => window.__gwBoardCellClientPoint(r, c), { r, c });
  const a = await cell(...from), b = await cell(...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(2600);
};
const open = async (query, routes) => {
  const context = await browser.newContext(phone);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  if (routes) await routes(page);
  await page.goto(`${base}/?gwTestMode=1${query}`, { waitUntil: "networkidle" });
  return { context, page, errors };
};
const textures = (page) => page.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /\/assets\/images\//.test(n)).map((n) => n.split("/assets/images/")[1]));

// --- missing assets -------------------------------------------------------------------------
for (const [name, pattern] of [["missing-assets", /\/match-v2\/(tiles|powerups|cells|board)\//], ["one-missing", /\/match-v2\/(board\/board_frame|cells\/cell_lock|tiles\/tile_threat)\.png/]]) {
  const refused = [];
  const { context, page, errors } = await open("&level=34", (p) => p.route(pattern, (route) => { refused.push(route.request().url().split("/").pop()); return route.abort(); }));
  await ready(page);
  await page.waitForTimeout(500);
  await page.locator('[data-testid="board-canvas"] canvas').screenshot({ path: `${out}-${name}.png` });
  // level 34 shows the lock, overlay and underlay fallbacks; level 1 has a known good first swap
  await page.goto(`${base}/?gwTestMode=1&level=1`, { waitUntil: "networkidle" });
  await ready(page);
  const before = await movesText(page);
  await swap(page, [0, 0], [1, 0]);
  const loaded = await textures(page);
  console.log(JSON.stringify({ check: name, refused: [...new Set(refused)].length, classicPicturesLoaded: loaded.filter((n) => !n.startsWith("match-v2/")).length, movesBefore: before, movesAfter: await movesText(page), pageErrors: errors }));
  await context.close();
}

// --- re-entry and background ----------------------------------------------------------------
{
  const { context, page, errors } = await open("");
  const client = await context.newCDPSession(page);
  const heap = async () => { await client.send("HeapProfiler.collectGarbage"); return page.evaluate(() => +(performance.memory.usedJSHeapSize / 1048576).toFixed(1)); };
  const enter = async () => { await page.getByRole("button", { name: "Quick Deploy" }).click(); await ready(page); await page.waitForTimeout(400); };
  const leave = async () => { await page.locator(".brand").click(); await page.getByTestId("home-command-deck").waitFor(); };
  const samples = [];
  for (let i = 0; i < 10; i += 1) {
    await enter();
    if (i === 0 || i === 9) samples.push({ entry: i + 1, heapMB: await heap(), canvases: await page.evaluate(() => document.querySelectorAll("canvas").length) });
    await leave();
  }
  console.log(JSON.stringify({ check: "re-entry", samples, canvasesOnMenuAfter: await page.evaluate(() => document.querySelectorAll("canvas").length), pageErrors: errors }));

  await enter();
  const before = await movesText(page);
  const hide = (hidden) => page.evaluate((hidden) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
  await hide(true);
  await page.waitForTimeout(1500);
  await hide(false);
  await page.waitForTimeout(500);
  await swap(page, [0, 0], [1, 0]);
  console.log(JSON.stringify({ check: "background", movesBefore: before, movesAfterResumeAndSwap: await movesText(page), pageErrors: errors }));
  await context.close();
}

// --- full loop ------------------------------------------------------------------------------
{
  const { context, page, errors } = await open("");
  const campaign = () => page.locator(".dr-home-campaign strong").textContent();
  const start = await campaign();
  await page.getByRole("button", { name: "Quick Deploy" }).click();
  await ready(page);
  const level = await page.locator(".game-hud span").first().textContent();
  await swap(page, [0, 0], [1, 0]);
  const afterPlay = await movesText(page);
  await page.getByTestId("qa-win").click();
  await page.getByRole("heading", { name: "Grid secured" }).waitFor();
  const result = await page.locator(".modal p").first().textContent();
  await page.getByRole("button", { name: "Next Level" }).click();
  await ready(page);
  const next = await page.locator(".game-hud span").first().textContent();
  await page.getByTestId("qa-fail").click();
  await page.getByRole("button", { name: "End Mission" }).click();
  await page.getByRole("button", { name: "Retry" }).click();
  await ready(page);
  const retried = await movesText(page);
  await page.locator(".game-hud > button").first().click();
  const levelTiles = await page.locator(".level-tile strong").allTextContents();
  await page.locator(".brand").click();
  const afterWin = await campaign();
  await page.reload({ waitUntil: "networkidle" });
  const afterReload = await campaign();
  await page.getByRole("button", { name: "Resume Operations" }).click();
  const resumedOn = await page.locator(".page-header h1").textContent();
  console.log(JSON.stringify({ check: "full-loop", start, level, afterPlay, result, next, retried, levelTiles: levelTiles.slice(0, 3), afterWin, afterReload, resumedOn, pageErrors: errors }));
  await context.close();
}

// --- grayscale and recording ----------------------------------------------------------------
{
  const { context, page } = await open("&level=100");
  await ready(page);
  await page.addStyleTag({ content: "html { filter: grayscale(1); }" });
  await page.waitForTimeout(500);
  await page.locator(".game-board-panel").screenshot({ path: `${out}-grayscale.png` });
  console.log(JSON.stringify({ check: "grayscale", file: `${out}-grayscale.png` }));
  await context.close();
}
{
  const context = await browser.newContext({ ...phone, recordVideo: { dir: `${out}-video`, size: { width: 393, height: 659 } } });
  const page = await context.newPage();
  await page.goto(`${base}/?gwTestMode=1&level=1`, { waitUntil: "networkidle" });
  await ready(page);
  await page.waitForTimeout(800);
  await swap(page, [0, 0], [1, 0]);
  await page.waitForTimeout(600);
  const video = page.video();
  await context.close();
  console.log(JSON.stringify({ check: "recording", file: await video.path() }));
}
await browser.close();
