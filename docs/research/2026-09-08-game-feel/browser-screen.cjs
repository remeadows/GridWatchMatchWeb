const { createRequire } = require('node:module');
const { mkdirSync, writeFileSync } = require('node:fs');
const root = require('node:path').resolve(__dirname, '../../..');
const { chromium } = createRequire(`${root}/package.json`)('@playwright/test');
const out='/tmp/gridwatch-feel-audit-20260908';
mkdirSync(out,{recursive:true});
(async()=>{
  const browser=await chromium.launch({headless:true});
  const results=[];
  try {
    for(const [name,viewport] of [['desktop',{width:1280,height:900}],['mobile',{width:393,height:852}]]) {
      const context=await browser.newContext({viewport,deviceScaleFactor:1});
      for(const effect of ['normal','tnt','rocket','propeller','lightBall']) {
        const page=await context.newPage();
        const errors=[];
        page.on('pageerror',e=>errors.push(e.message));
        await page.goto('http://127.0.0.1:4174/?gwTestMode=1&level=1');
        await page.waitForFunction(()=>window.__gwBoardReady===true);
        if(effect==='normal') {
          await page.locator('[data-testid="board-canvas"] canvas').screenshot({path:`${out}/${name}-board.png`});
          await page.screenshot({path:`${out}/${name}-page.png`,fullPage:true});
          await page.getByTestId('qa-swap').click();
        } else {
          await page.getByTestId(`booster-${effect}`).click();
          await page.evaluate(()=>{
            const p=window.__gwBoardCellClientPoint(3,3);
            const canvas=document.querySelector('[data-testid="board-canvas"] canvas');
            const props={bubbles:true,cancelable:true,composed:true,button:0,clientX:p.x,clientY:p.y,isPrimary:true,pointerId:1,pointerType:'mouse',view:window};
            canvas.dispatchEvent(new PointerEvent('pointerdown',{...props,buttons:1}));
            canvas.dispatchEvent(new PointerEvent('pointerup',{...props,buttons:0}));
          });
        }
        await page.waitForFunction(()=>window.__gwPresentationTrace?.some(e=>e.kind==='resolution-complete'),{},{timeout:15000});
        const trace=await page.evaluate(()=>window.__gwPresentationTrace);
        const first=trace[0].atMs;
        const impacts=trace.filter(e=>e.kind==='tile-impact');
        const impactKinds={tnt:'tnt-tile-impact',rocket:'rocket-tile-impact',propeller:'propeller-impact',lightBall:'lightBall-target-impact'};
        const arrivals=trace.filter(e=>e.kind===impactKinds[effect]);
        const offsets=arrivals.flatMap(a=>{
          const tile=impacts.find(t=>t.detail===a.detail);
          return tile?[{cell:a.detail,arrival:Math.round(a.atMs-first),tileBreak:Math.round(tile.atMs-first),difference:Math.round(tile.atMs-a.atMs)}]:[];
        });
        results.push({viewport:name,effect,title:await page.title(),errors,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),offsets,trace});
        console.log(JSON.stringify({viewport:name,effect,errors,offsets,groups:trace.filter(e=>e.kind==='match-group-start').length,cascades:trace.filter(e=>e.kind==='cascade-start').length,duration:Math.round(trace.at(-1).atMs-first)}));
        await page.close();
      }
      await context.close();
    }
    writeFileSync(`${out}/traces.json`,JSON.stringify(results,null,2));
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
