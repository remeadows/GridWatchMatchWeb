// Which piece images does a level load in each theme?
import { createRequire } from "node:module";
const [repo, base] = process.argv.slice(2);
const { chromium } = createRequire(repo + "/package.json")("@playwright/test");
const browser = await chromium.launch({ channel: "chrome" });
for (const q of ["", "&theme=classic"]) {
  const page = await browser.newPage();
  const got = [];
  page.on("response", (r) => { if (/\/assets\/images\/(match-v2|web-overrides)\/(tiles|powerups|boosters|cells)\//.test(r.url())) got.push(r.url().replace(/.*\/assets\/images\//, "")); });
  await page.goto(`${base}/?gwTestMode=1&level=100${q}`, { waitUntil: "networkidle" });
  const v2 = got.filter((u) => u.startsWith("match-v2")).length, classic = got.filter((u) => u.startsWith("web-overrides")).length;
  console.log(q || "(dark)", "match-v2:", v2, "classic:", classic);
  await page.close();
}
await browser.close();
