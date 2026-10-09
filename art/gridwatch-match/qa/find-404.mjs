import { createRequire } from "node:module";
const [repo, url] = process.argv.slice(2);
const { chromium } = createRequire(repo + "/package.json")("@playwright/test");
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
page.on("response", (r) => { if (r.status() >= 400) console.log(r.status(), r.url()); });
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await browser.close();
