// usage: node perf-probe.mjs <repo> <base url> [level] [runs]
// Compares the classic and dark boards on one build, at a desktop size and at iPhone 15 size
// (device pixel ratio 3), each also with the CPU slowed four times. Prints one JSON line per case.
//
// What it measures, and how:
//   loadMs      navigation start -> the board reporting ready, cache disabled, median of `runs`
//               (uses ?gwTestMode=1, whose only effect on loading is exposing the ready flag)
//   imageKB     bytes of image responses from navigation until 4 s after the board is ready
//               (encoded, as sent), and how many there were
//   idle/play   requestAnimationFrame intervals over 3 s with the board at rest, then over 3 s
//               that start with one real swap and its cascade. This run uses ?gwTestMode=0: the
//               level jump works, but the game keeps its normal rAF loop (=1 swaps it for timers)
//   heapMB      Chrome's JS heap after the play window (performance.memory)
// It runs in the installed Chrome on this Mac. A slowed CPU is not a phone's GPU: treat the phone
// rows as a relative comparison between the two themes, not as a phone's frame rate.
import { createRequire } from "node:module";
const [repo, base, level = "1", runsArg = "3"] = process.argv.slice(2);
const runs = Number(runsArg);
const { chromium, devices } = createRequire(repo + "/package.json")("@playwright/test");
const browser = await chromium.launch({ channel: "chrome", args: ["--enable-precise-memory-info"] });
const sizes = [["desktop", { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 }], ["phone", devices["iPhone 15"]]];
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const stats = (deltas) => {
  const sorted = [...deltas].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  return { frames: deltas.length, medianMs: +at(0.5).toFixed(1), p95Ms: +at(0.95).toFixed(1), maxMs: +at(1).toFixed(1), over25Ms: deltas.filter((d) => d > 25).length };
};
const frameWindow = (page, ms) => page.evaluate((ms) => new Promise((resolve) => {
  const deltas = []; let last = performance.now(); const end = last + ms;
  const tick = (now) => { deltas.push(now - last); last = now; if (now < end) requestAnimationFrame(tick); else resolve(deltas.slice(1)); };
  requestAnimationFrame(tick);
}), ms);

for (const theme of ["classic", "dark"]) {
  for (const [sizeName, device] of sizes) {
    for (const cpu of [1, 4]) {
      const loads = [], imageBytes = [], imageCounts = [];
      for (let run = 0; run < runs; run += 1) {
        const context = await browser.newContext(device);
        const page = await context.newPage();
        const client = await context.newCDPSession(page);
        await client.send("Network.enable");
        await client.send("Network.setCacheDisabled", { cacheDisabled: true });
        if (cpu > 1) await client.send("Emulation.setCPUThrottlingRate", { rate: cpu });
        let bytes = 0, count = 0;
        const types = new Map();
        client.on("Network.responseReceived", (e) => types.set(e.requestId, e.type));
        client.on("Network.loadingFinished", (e) => { if (types.get(e.requestId) === "Image") { bytes += e.encodedDataLength; count += 1; } });
        await page.goto(`${base}/?gwTestMode=1&level=${level}&theme=${theme}`, { waitUntil: "commit" });
        await page.waitForFunction(() => window.__gwBoardReady === true, null, { timeout: 60000 });
        loads.push(Math.round(await page.evaluate(() => performance.now())));
        // a fixed wait, so pictures that arrive after the board is ready are counted the same way every time
        await page.waitForTimeout(4000);
        imageBytes.push(bytes);
        imageCounts.push(count);
        await context.close();
      }

      const context = await browser.newContext(device);
      const page = await context.newPage();
      const client = await context.newCDPSession(page);
      if (cpu > 1) await client.send("Emulation.setCPUThrottlingRate", { rate: cpu });
      await page.goto(`${base}/?gwTestMode=0&level=${level}&theme=${theme}`, { waitUntil: "networkidle" });
      const canvas = page.locator('[data-testid="board-canvas"] canvas');
      await canvas.waitFor();
      await page.waitForTimeout(2500);
      const idle = stats(await frameWindow(page, 3000));
      // The swap (0,0)->(1,0), from the board's own geometry: 7 columns centred in the canvas, with
      // the dark board's frame taking 0.1875 of a cell on each side.
      const box = await canvas.boundingBox();
      const cell = theme === "dark" ? Math.floor((Math.min(box.width, box.height) - 8) / 7.375) : Math.floor((Math.min(box.width, box.height) - 24) / 7);
      const at = (row, col) => ({ x: box.x + box.width / 2 + (col - 3) * cell, y: box.y + box.height / 2 + (row - 3) * cell });
      const from = at(0, 0), to = at(1, 0);
      const before = await page.locator("text=/\\d+\\/\\d+/").first().textContent();
      const play = frameWindow(page, 3000);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 8 });
      await page.mouse.up();
      const playStats = stats(await play);
      const after = await page.locator("text=/\\d+\\/\\d+/").first().textContent();
      const heapMB = await page.evaluate(() => (performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null));
      const canvasPx = await canvas.evaluate((c) => `${c.width}x${c.height}`);
      console.log(JSON.stringify({ theme, size: sizeName, cpuSlowdown: cpu, loadMs: median(loads), loadRunsMs: loads, imageKB: Math.round(median(imageBytes) / 1024), images: median(imageCounts), canvasPx, idle, play: playStats, moved: before !== after, heapMB }));
      await context.close();
    }
  }
}
await browser.close();
