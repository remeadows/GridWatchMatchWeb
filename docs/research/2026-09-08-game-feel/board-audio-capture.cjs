const { chromium } = require('@playwright/test');
const { readFileSync, writeFileSync, mkdtempSync, chmodSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const root = resolve(__dirname, '../../..');
const [port = '4176', label = 'candidate', mode] = process.argv.slice(2);
assert.ok(/^\d+$/.test(port) && Number(port) >= 1 && Number(port) <= 65535, 'port must be 1-65535');
assert.ok(/^[A-Za-z0-9_-]{1,80}$/.test(label), 'label must contain only letters, digits, underscores or hyphens');
assert.ok((mode === undefined || mode === 'muted') && process.argv.length <= 5, 'optional third argument must be muted');
const muted = mode === 'muted';
const out = mkdtempSync(join(process.env.GW_CAPTURE_DIR || tmpdir(), `gridwatch-board-audio-${label}-`));
chmodSync(out, 0o700);
const specimens = JSON.parse(readFileSync(join(root, 'src/tests/fixtures/resolution/specimens.json'), 'utf8'));
const scenarios = [
  { name: 'ordinary', qa: true },
  { name: 'three-stage', action: { kind: 'swap', from: { row: 4, col: 2 }, to: { row: 5, col: 2 } } },
  ...['rocket', 'tnt', 'propeller', 'lightBall'].map(booster => ({ name: booster, booster })),
  ...specimens.filter(item => item.name.startsWith('combo-')).map(item => ({ name: item.name, level: item.level, action: item.actions[0] })),
  { name: 'winning-combo', win: true }
];
console.log(`Evidence: ${out}`);
(async () => {
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  const version = spawnSync(ffmpeg, ['-version'], { encoding: 'utf8' });
  assert.equal(version.status, 0, 'Install ffmpeg on PATH or set FFMPEG_PATH before recording');
  const browser = await chromium.launch({ headless: false });
  const results = [];
  try {
    for (const scenario of scenarios.filter(item => !muted || ['ordinary', 'three-stage', 'winning-combo'].includes(item.name))) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      const page = await context.newPage();
      if (muted) await page.addInitScript(() => localStorage.setItem('gridwatch-match-web.save.v1', JSON.stringify({ settings: { sfxEnabled: false } })));
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/score', route => route.abort());
      await page.addInitScript(() => {
        const Native = window.AudioContext;
        let count = 0;
        window.AudioContext = new Proxy(Native, {
          construct(constructor, args) {
            const context = Reflect.construct(constructor, args);
            if (count++ !== 0) return context;
            const destination = context.createMediaStreamDestination();
            const recorder = new MediaRecorder(destination.stream, { mimeType: 'audio/webm;codecs=opus' });
            const chunks = [], events = [], active = new Set();
            const state = { decoded: 0, peak: 0, events, active, start: () => recorder.start(), stop: () => new Promise(resolve => {
              recorder.onstop = async () => resolve(Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer())));
              recorder.stop();
            }) };
            recorder.ondataavailable = event => chunks.push(event.data);
            const decode = context.decodeAudioData.bind(context);
            context.decodeAudioData = async (...args) => { const result = await decode(...args); state.decoded++; return result; };
            const createGain = context.createGain.bind(context);
            context.createGain = () => {
              const gain = createGain(), connect = gain.connect.bind(gain);
              gain.connect = (...args) => {
                if (args[0] === context.destination) connect(destination);
                return connect(...args);
              };
              return gain;
            };
            const createCompressor = context.createDynamicsCompressor.bind(context);
            context.createDynamicsCompressor = () => {
              const node = createCompressor(), connect = node.connect.bind(node);
              node.connect = (...args) => {
                if (args[0] === context.destination) connect(destination);
                return connect(...args);
              };
              return node;
            };
            const createSource = context.createBufferSource.bind(context);
            context.createBufferSource = () => {
              const source = createSource(), start = source.start.bind(source), stop = source.stop.bind(source);
              const id = events.length;
              source.start = (...args) => {
                active.add(id); state.peak = Math.max(state.peak, active.size);
                events.push({ id, kind: 'start', atMs: performance.now(), duration: source.buffer?.duration, rate: source.playbackRate.value });
                return start(...args);
              };
              source.stop = (...args) => { active.delete(id); events.push({ id, kind: 'stop', atMs: performance.now() }); return stop(...args); };
              source.addEventListener('ended', () => { active.delete(id); events.push({ id, kind: 'ended', atMs: performance.now() }); });
              return source;
            };
            window.__audioCapture = state;
            return context;
          }
        });
      });
      if (scenario.level) await page.route('**/levels/level_001.json', route => route.fulfill({ json: scenario.level }));
      await page.goto(`http://127.0.0.1:${port}/?gwTestMode=1&level=1`);
      await page.waitForFunction(() => window.__gwBoardReady && window.__audioCapture?.decoded === 20);
      await page.locator('[data-testid=board-canvas] canvas').click({ position: { x: 3, y: 3 } });
      if (scenario.win) await page.getByTestId('qa-setup-winning-rocket-combo').evaluate(button => button.click());
      writeFileSync(join(out, `${scenario.name}-before.png`), await page.screenshot(), { flag: 'wx', mode: 0o600 });
      await page.evaluate(() => { window.__gwPresentationTrace = []; window.__audioCapture.start(); });
      if (scenario.qa) await page.getByTestId('qa-swap').evaluate(button => button.click());
      else if (scenario.win) await page.getByTestId('qa-trigger-winning-rocket-combo').evaluate(button => button.click());
      else {
        if (scenario.booster) await page.getByTestId(`booster-${scenario.booster}`).evaluate(button => button.click());
        await page.evaluate(action => {
          const from = action.kind === 'swap' ? action.from : action.at;
          const to = action.kind === 'swap' ? action.to : from;
          const start = window.__gwBoardCellClientPoint(from.row, from.col), end = window.__gwBoardCellClientPoint(to.row, to.col);
          const canvas = document.querySelector('[data-testid=board-canvas] canvas');
          const dispatch = (type, x, y, buttons) => canvas.dispatchEvent(new PointerEvent(type, {
            bubbles: true, cancelable: true, composed: true, button: 0, buttons, clientX: x, clientY: y,
            isPrimary: true, pointerId: 1, pointerType: 'mouse', view: window
          }));
          dispatch('pointerdown', start.x, start.y, 1);
          if (action.kind === 'swap') for (let i = 1; i <= 12; i++) dispatch('pointermove', start.x + (end.x - start.x) * i / 12, start.y + (end.y - start.y) * i / 12, 1);
          dispatch('pointerup', end.x, end.y, 0);
        }, scenario.action ?? { kind: 'tap', at: { row: 3, col: 3 } });
      }
      await page.waitForFunction(() => window.__gwPresentationTrace?.some(entry => entry.kind === 'resolution-complete'), null, { timeout: 45000 });
      if (scenario.win) await page.getByRole('heading', { name: 'Grid secured', exact: true }).waitFor();
      await page.waitForFunction(() => window.__audioCapture.active.size === 0
        && Object.values(window.__gwPresentationResourceCounts.current).every(value => value === 0));
      const bytes = await page.evaluate(() => window.__audioCapture.stop());
      const audioPath = join(out, `${scenario.name}.webm`);
      writeFileSync(audioPath, Buffer.from(bytes), { flag: 'wx', mode: 0o600 });
      const data = await page.evaluate(() => ({ trace: window.__gwPresentationTrace, frames: window.__gwResolutionFrames,
        sources: { peak: window.__audioCapture.peak, active: window.__audioCapture.active.size, events: window.__audioCapture.events },
        resources: window.__gwPresentationResourceCounts, overflow: document.documentElement.scrollWidth > innerWidth }));
      assert.deepEqual(errors, []);
      assert.equal(data.overflow, false);
      assert.equal(data.sources.active, 0);
      assert.ok(data.sources.peak <= 16);
      if (muted) {
        assert.equal(data.sources.peak, 0);
        assert.equal(data.trace.filter(entry => entry.kind === 'audio-cue').length, 0);
      }
      for (const frame of data.frames) assert.deepEqual(frame.rendered.map(({ position, occupantId }) => ({ position, occupantId })), frame.expected);
      assert.equal(data.trace.filter(entry => entry.kind === 'resolution-complete').length, 1);
      writeFileSync(join(out, `${scenario.name}-after.png`), await page.screenshot(), { flag: 'wx', mode: 0o600 });
      const result = { scenario: scenario.name, audioPath, errors, ...data };
      writeFileSync(join(out, `${scenario.name}.json`), JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
      results.push({ scenario: scenario.name, stages: data.frames.length, sourcePeak: data.sources.peak, audioPath });
      await context.close();
      console.log(`${scenario.name}: ${data.frames.length} exact stages, ${data.sources.peak} peak sources`);
    }
  } finally { await browser.close(); }
  for (const result of results) {
    const info = spawnSync(ffmpeg, ['-hide_banner', '-i', result.audioPath, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
    assert.equal(info.status, 0, info.stderr);
    result.maxVolumeDb = Number(/max_volume: ([-\d.]+) dB/.exec(info.stderr)[1]);
  }
  writeFileSync(join(out, 'results.json'), JSON.stringify({ label, muted, browser: 'headed Chromium', viewport: '1280x720',
    scope: 'real board WebAudio bus, excludes music/voice/HTML fallback; QA scene timer, not production rAF performance', results }, null, 2), { flag: 'wx', mode: 0o600 });
})().catch(error => { console.error(error); process.exitCode = 1; });
