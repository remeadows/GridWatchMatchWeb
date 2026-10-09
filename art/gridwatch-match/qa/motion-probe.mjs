// What does a swap and its cascade look like, frame by frame?
// Usage: node motion-probe.mjs <repo> <base-url> <out-dir> [level] [fromRow,fromCol] [toRow,toCol] [booster]
// Makes one swap (level 1, 0,0 -> 1,0 unless told otherwise), or with a booster name (rocket,
// rocketVertical, tnt, propeller, lightBall) uses that booster on the first cell, and saves frames
// from the browser's screencast, each named by milliseconds since the swap was released, plus
// the scene's own presentation trace (fall plans, landing, jolt). Read the frames by eye: this
// measures nothing about how the motion feels.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
const [repo, base, out, level = "1", from = "0,0", to = "1,0", booster = ""] = process.argv.slice(2);
const { chromium } = createRequire(repo + "/package.json")("@playwright/test");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`${base}/?gwTestMode=1&level=${level}`, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__gwBoardReady === true, null, { timeout: 20000 });
await page.waitForTimeout(600);

const cell = (r, c) => page.evaluate(({ r, c }) => window.__gwBoardCellClientPoint(r, c), { r, c });
const [fr, fc] = from.split(",").map(Number);
const [tr, tc] = to.split(",").map(Number);
const a = await cell(fr, fc);
const b = await cell(tr, tc);
const box = await page.getByTestId("board-canvas").boundingBox();
const clip = { x: Math.floor(box.x), y: Math.floor(box.y), width: Math.ceil(box.width), height: Math.ceil(box.height) };

await page.screenshot({ path: `${out}/before.png`, clip });
// Screenshots take over 100 ms each, far too slow for a 190 ms landing, so the frames come from
// the browser's own screencast: every frame it composites, stamped with its time.
const cdp = await page.context().newCDPSession(page);
const frames = [];
let released = null;
cdp.on("Page.screencastFrame", (frame) => {
  void cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => undefined);
  if (released === null) return;
  const at = Math.round(frame.metadata.timestamp * 1000 - released);
  if (at < 0 || at > 2600) return;
  writeFileSync(`${out}/t${String(at).padStart(4, "0")}.jpg`, Buffer.from(frame.data, "base64"));
  frames.push(at);
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });
if (booster) {
  await page.getByTestId(`booster-${booster}`).click();
  await page.mouse.click(a.x, a.y);
} else {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
}
released = Date.now();
await page.waitForTimeout(2800);
await cdp.send("Page.stopScreencast");
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/after.png`, clip });
const trace = await page.evaluate(() => (window.__gwPresentationTrace ?? []).map((e) => ({ kind: e.kind, atMs: Math.round(e.atMs), plannedAtMs: e.plannedAtMs, detail: e.detail })));
writeFileSync(`${out}/trace.json`, JSON.stringify(trace, null, 1));
const start = trace[0]?.atMs ?? 0;
const pick = (kind) => trace.filter((e) => e.kind === kind).map((e) => ({ at: e.atMs - start, detail: e.detail }));
console.log(JSON.stringify({
  frames: frames.length,
  clip,
  frameTimes: frames,
  fallPlans: pick("cascade-fall-plan").map((e) => e.detail),
  land: pick("cascade-land"),
  jolt: pick("cascade-jolt"),
  knocks: pick("powerup-knock"),
  marks: pick("target-mark"),
  creation: ["powerup-create-charge", "powerup-create-impact", "powerup-create-stable"].map((kind) => pick(kind)[0]?.at),
  complete: pick("resolution-complete"),
  errors
}));
await browser.close();
