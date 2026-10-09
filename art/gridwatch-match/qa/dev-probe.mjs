// usage: node dev-probe.mjs <repo> <base url> <out prefix>
import { createRequire } from "node:module";
const [repo, base, out] = process.argv.slice(2);
const { chromium, devices } = createRequire(repo + "/package.json")("@playwright/test");
const browser = await chromium.launch({ channel: "chrome" });
for (const [name, device] of [["desktop", { viewport: { width: 1280, height: 800 } }], ["mobile", devices["iPhone 15"]]]) {
  const context = await browser.newContext(device);
  const page = await context.newPage();
  const errors = [], posts = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("request", (r) => r.method() !== "GET" && posts.push(`${r.method()} ${r.url()}`));
  page.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
  await page.goto(base + "/", { waitUntil: "networkidle" });
  const badge = await page.locator(".dev-build-badge").textContent().catch(() => null);
  await page.screenshot({ path: `${out}-${name}-home.png` });
  await page.goto(base + "/?gwTestMode=1&level=7", { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__gwBoardReady === true, null, { timeout: 15000 }).catch(() => errors.push("board never ready"));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}-${name}-level7.png` });
  console.log(JSON.stringify({ name, badge, errors, nonGet: posts }));
  await context.close();
}
await browser.close();
