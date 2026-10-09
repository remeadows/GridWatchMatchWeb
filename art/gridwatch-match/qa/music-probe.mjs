// Does the music start, change track by crossfade, and loop without a gap?
// Usage: [GW_BROWSER=webkit] node music-probe.mjs <repo> <base-url>
// It records every <audio> element and gain node the page makes, so it reads what the player
// really did: which file each copy plays, whether it is running, and the level it is held at.
import { createRequire } from "node:module";
const [repo, base] = process.argv.slice(2);
const { chromium, webkit } = createRequire(repo + "/package.json")("@playwright/test");
// GW_BROWSER=webkit runs the bundled WebKit (the engine behind Safari) instead of installed Chrome.
const browser = process.env.GW_BROWSER === "webkit"
  ? await webkit.launch()
  : await chromium.launch({ channel: "chrome", args: ["--autoplay-policy=document-user-activation-required"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.addInitScript(() => {
  const NativeAudio = window.Audio;
  window.__voices = [];
  window.Audio = function (src) {
    const element = new NativeAudio(src);
    window.__voices.push({ element, gain: null });
    return element;
  };
  window.Audio.prototype = NativeAudio.prototype;
  const Context = window.AudioContext ?? window.webkitAudioContext;
  const createSource = Context.prototype.createMediaElementSource;
  Context.prototype.createMediaElementSource = function (element) {
    const source = createSource.call(this, element);
    const connect = source.connect.bind(source);
    source.connect = (node) => {
      const voice = window.__voices.find((entry) => entry.element === element);
      if (voice && "gain" in node) voice.gain = node;
      window.__context = this;
      return connect(node);
    };
    return source;
  };
});

const voices = () =>
  page.evaluate(() =>
    window.__voices
      .filter((v) => /bgm_|music_/.test(v.element.src))
      .map((v) => ({
        file: v.element.src.split("/").pop(),
        playing: !v.element.paused && !v.element.ended,
        at: Math.round(v.element.currentTime * 10) / 10,
        length: Math.round(v.element.duration * 10) / 10,
        level: v.gain ? Math.round(v.gain.gain.value * 1000) / 1000 : Math.round(v.element.volume * 1000) / 1000,
        viaGainNode: Boolean(v.gain)
      }))
  );
const report = async (label) => {
  const list = await voices();
  const context = await page.evaluate(() => window.__context?.state ?? "none");
  console.log(JSON.stringify({ label, context, voices: list }));
  return list;
};
const live = (list) => list.filter((v) => v.playing);

await page.goto(`${base}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await report("loaded, no gesture yet");

await page.mouse.click(640, 780); // an empty spot: any gesture should be enough
await page.waitForTimeout(400);
await report("just after the first gesture");
await page.waitForTimeout(2200);
const menu = await report("menu, fade-in over");

// Wait for the menu track's real loop point. (Seeking there is not reliable: a server without
// Range support, such as `wrangler dev`, sends the element back to the start.)
const waitForLive = async (count, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (live(await voices()).length === count) return true;
    await page.waitForTimeout(100);
  }
  return false;
};
const lengthMs = (menu[0]?.length ?? 30) * 1000;
await waitForLive(2, lengthMs + 10_000);
await page.waitForTimeout(2000);
const mid = await report("2 s into the loop crossfade");
await waitForLive(1, 10_000);
await page.waitForTimeout(300);
const looped = await report("after the loop crossfade");

await page.getByRole("button", { name: /Quick Deploy/ }).click();
await page.waitForTimeout(700);
const switching = await report("0.7 s after starting a level");
await page.waitForTimeout(2500);
const inGame = await report("in the level");

const checks = {
  menuPlaysOneCopy: live(menu).length === 1,
  loopOverlapsTwoCopiesOfTheSameFile: live(mid).length === 2 && new Set(live(mid).map((v) => v.file)).size === 1,
  loopNeverSilent: live(mid).reduce((sum, v) => sum + v.level ** 2, 0) > 0.01,
  loopEndsWithOneCopy: live(looped).length === 1 && live(looped)[0].at < 10,
  trackChangeOverlaps: live(switching).length === 2 && new Set(live(switching).map((v) => v.file)).size === 2,
  trackChangeEndsWithOneCopy: live(inGame).length === 1 && live(inGame)[0].file !== live(menu)[0]?.file,
  noPageErrors: errors.length === 0
};
console.log(JSON.stringify({ checks, errors }));
await browser.close();
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
