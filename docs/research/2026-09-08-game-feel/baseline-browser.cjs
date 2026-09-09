const { chromium, webkit, devices } = require('@playwright/test');
const { mkdirSync, writeFileSync } = require('node:fs');
const out = process.env.GW_CAPTURE_DIR || '/tmp/gridwatch-resolution-baseline-20260908';
mkdirSync(out, { recursive: true });

async function gesture(page, from, to = from) {
  await page.evaluate(({ from, to }) => {
    const canvas = document.querySelector('[data-testid="board-canvas"] canvas');
    const start = window.__gwBoardCellClientPoint(from.row, from.col);
    const end = window.__gwBoardCellClientPoint(to.row, to.col);
    const props = { bubbles: true, cancelable: true, composed: true, button: 0, isPrimary: true, pointerId: 1, pointerType: 'mouse', view: window };
    canvas.dispatchEvent(new PointerEvent('pointerdown', { ...props, clientX: start.x, clientY: start.y, buttons: 1 }));
    canvas.dispatchEvent(new PointerEvent('pointermove', { ...props, clientX: end.x, clientY: end.y, buttons: 1 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { ...props, clientX: end.x, clientY: end.y, buttons: 0 }));
  }, { from, to });
}

(async () => {
  const results = [];
  for (const [name, engine, options] of [
    ['desktop', chromium, { viewport: { width: 1280, height: 720 } }],
    ['mobile', webkit, devices['iPhone 15']]
  ]) {
    const browser = await engine.launch({ headless: true });
    try {
      for (const effect of ['normal', 'cascade', 'rocket', 'tnt', 'propeller', 'lightBall', 'rocket+rocket', 'lightBall+lightBall']) {
        const context = await browser.newContext({ ...options, recordVideo: { dir: out } });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('http://127.0.0.1:4174/?gwTestMode=1&level=1');
        await page.waitForFunction(() => window.__gwBoardReady);
        const canvas = page.locator('[data-testid="board-canvas"] canvas');
        await canvas.scrollIntoViewIfNeeded();
        await canvas.screenshot({ path: `${out}/${name}-${effect}-before.png` });
        if (effect === 'normal') await page.getByTestId('qa-swap').click();
        else if (effect === 'cascade') await gesture(page, { row: 4, col: 2 }, { row: 5, col: 2 });
        else if (effect.includes('+')) await page.evaluate(key => window.__gwPreviewPowerUpCombo(key), effect);
        else {
          await page.getByTestId(`booster-${effect}`).click();
          await gesture(page, { row: 3, col: 3 });
        }
        await page.waitForFunction(() => window.__gwPresentationTrace?.some(entry => (
          entry.kind === 'tile-impact' || entry.kind === 'combo-impact'
        )));
        await canvas.screenshot({ path: `${out}/${name}-${effect}-impact.png` });
        await page.waitForFunction(() => window.__gwPresentationTrace?.some(entry => (
          entry.kind === 'resolution-complete' || entry.kind === 'combo-preview-complete'
        )), null, { timeout: 15000 });
        await canvas.screenshot({ path: `${out}/${name}-${effect}-settled.png` });
        const trace = await page.evaluate(() => window.__gwPresentationTrace);
        const arrivalKind = { rocket: 'rocket-tile-impact', tnt: 'tnt-tile-impact', propeller: 'propeller-impact', lightBall: 'lightBall-target-impact' }[effect];
        const offsets = trace.filter(entry => entry.kind === arrivalKind).flatMap(arrival => {
          const tile = trace.find(entry => entry.kind === 'tile-impact' && entry.detail === arrival.detail);
          return tile ? [{ cell: arrival.detail, arrivalMs: arrival.atMs, breakMs: tile.atMs, differenceMs: tile.atMs - arrival.atMs }] : [];
        });
        const result = { name, effect, browser: engine.name(), viewport: page.viewportSize(), title: await page.title(), errors,
          overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          video: await page.video().path(), offsets, trace };
        results.push(result);
        console.log(JSON.stringify({ name, effect, errors, offsets }));
        await context.close();
      }
    } finally { await browser.close(); }
  }
  writeFileSync(`${out}/traces.json`, JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
