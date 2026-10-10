// When does the music start? Real Chrome with its autoplay rule enforced, three ways in:
//   direct   - the address typed or bookmarked: no touch has happened anywhere
//   menu     - arriving by clicking a link on a page of the same site, as from the Nexus menu
//   tap      - a direct visit on a phone-sized touch screen, then one tap on empty space
// Usage: node autoplay-probe.mjs <repo> <base url>
import { createRequire } from "node:module";
const [repo, base] = process.argv.slice(2);
const { chromium, devices } = createRequire(repo + "/package.json")("@playwright/test");

const watch = () => {
  const NativeAudio = window.Audio;
  window.__voices = [];
  window.Audio = function (src) {
    const element = new NativeAudio(src);
    window.__voices.push(element);
    return element;
  };
  window.Audio.prototype = NativeAudio.prototype;
};
const music = (page) =>
  page.evaluate(() =>
    (window.__voices ?? [])
      .filter((element) => /\/audio\/music\//.test(element.src))
      .map((element) => ({ file: element.src.split("/").pop(), playing: !element.paused, at: Math.round(element.currentTime * 10) / 10 }))
  );
const state = async (page, label) => {
  const list = await music(page);
  const playing = list.filter((voice) => voice.playing && voice.at > 0);
  console.log(`${label}: ${playing.length ? "PLAYING " + JSON.stringify(playing) : "silent " + JSON.stringify(list)}`);
  return playing.length > 0;
};

const browser = await chromium.launch({ channel: "chrome", args: ["--autoplay-policy=document-user-activation-required"] });
const open = async (options = {}) => {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await page.addInitScript(watch);
  return page;
};

try {
  {
    const page = await open({ viewport: { width: 1280, height: 800 } });
    await page.goto(base, { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);
    await state(page, "direct, 3 s after load, no touch");
    await page.mouse.click(640, 790);
    await page.waitForTimeout(1500);
    await state(page, "direct, after one mouse click on empty space");
    await page.context().close();
  }
  {
    const page = await open({ viewport: { width: 1280, height: 800 } });
    const launcher = new URL("launcher.html", base).toString();
    await page.route(launcher, (route) =>
      route.fulfill({ contentType: "text/html", body: `<!doctype html><title>menu</title><a id="go" href="${new URL(base).pathname}">Match</a>` })
    );
    await page.goto(launcher);
    await page.click("#go");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);
    await state(page, "menu link on the same site, 3 s after load, no touch on the game");
    await page.context().close();
  }
  {
    const page = await open({ ...devices["Pixel 7"] });
    await page.goto(base, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    await state(page, "phone, direct, before any tap");
    await page.touchscreen.tap(200, 20);
    await page.waitForTimeout(1500);
    await state(page, "phone, after the first tap");
    await page.touchscreen.tap(200, 20);
    await page.waitForTimeout(1500);
    await state(page, "phone, after the second tap");
    await page.context().close();
  }
} finally {
  await browser.close();
}
