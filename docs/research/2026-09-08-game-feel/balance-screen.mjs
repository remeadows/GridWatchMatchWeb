import { registerHooks } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && context.parentURL) {
    const url = new URL(specifier, context.parentURL);
    if (!url.pathname.match(/\.[a-z]+$/i)) {
      for (const suffix of ['.ts', '/index.ts']) {
        if (existsSync(new URL(url.href + suffix))) return next(url.href + suffix, context);
      }
    }
  }
  return next(specifier, context);
} });
const { BoardEngine } = await import(pathToFileURL(`${root}/src/engine/boardEngine.ts`));
const { detectMatches } = await import(pathToFileURL(`${root}/src/engine/matchDetector.ts`));
const { cloneCell } = await import(pathToFileURL(`${root}/src/engine/types.ts`));
const { SeededRNG } = await import(pathToFileURL(`${root}/src/engine/rng.ts`));
const { levelSeed } = await import(pathToFileURL(`${root}/src/state/progress.ts`));
const productionSeeds = process.argv.includes('--production-seed');
const levels = readdirSync(`${root}/public/levels`).filter(f => /^level_\d+\.json$/.test(f))
  .map(f => JSON.parse(readFileSync(`${root}/public/levels/${f}`, 'utf8'))).sort((a,b) => a.id-b.id);
const seeds = Array.from({length:20}, (_,i) => i+1);
const result = { root, cohort: productionSeeds ? 'production-seed' : 'sensitivity', seeds, note:'Screening only; no boosters or Play On; boss time not simulated; heuristic never inspects refill RNG or future board results.', levels:[], totals:{actions:0, multiStage:0, repeatedClearPositions:0, mixedPowerUpActions:0, errors:[]}, examples:{} };
function merit(action, snapshot, level) {
  if(action.kind==='tap') return 9;
  const board=snapshot.grid.clone(cloneCell);
  const a=board.get(action.from), b=board.get(action.to);
  if(a.powerUp && b.powerUp) return 24;
  if(a.powerUp || b.powerUp) return 9;
  board.swap(action.from, action.to);
  return detectMatches(board).reduce((sum,g)=> {
    const needed=level.objectives.some(o => o.tileType===g.tileType && (snapshot.objectiveProgress[o.id]??0)<o.target);
    return sum+g.positions.size*(needed?3:1)+(g.positions.size>=4?6:0);
  },0);
}
for(const level of levels) {
  const cells=level.cellMap.flat();
  const row={ id:level.id, name:level.name, moves:level.moveLimit, boss:level.bossLevel, timer:level.bossTimerSeconds??null,
    objectives:level.objectives, weights:level.spawnWeights,
    locked:cells.filter(c=>c.locked).length, overlays:cells.filter(c=>c.overlay).length,
    underlays:cells.filter(c=>c.underlay).length, generators:cells.filter(c=>c.generator).length,
    initialPowerUps:cells.filter(c=>c.powerUp).length, initialLegalMoves:[], policies:{} };
  for(const policy of ['random','visible-match']) {
    const runs=[];
    for(const seed of seeds) {
      const engine=new BoardEngine(level,productionSeeds ? levelSeed(level.id) : seed);
      const chooser=new SeededRNG(100000+seed);
      let won=false, error=null, clears=0, shuffles=0, maxChain=0;
      const actions=[];
      for(let move=0; move<level.moveLimit; move++) {
        const before=engine.snapshot;
        const valid=engine.validMoves();
        if(move===0 && policy==='random') row.initialLegalMoves.push(valid.length);
        if(valid.length===0) {error='no-valid-actions';break;}
        let candidates=valid;
        if(policy==='visible-match') {
          const scores=valid.map(a=>merit(a,before,level));
          const best=Math.max(...scores);
          candidates=valid.filter((_,i)=>scores[i]===best);
        }
        const action=candidates[chooser.nextInt(candidates.length)];
        actions.push(action);
        let delta;
        try { delta=engine.apply(action); } catch(e) {error=String(e); break;}
        result.totals.actions++;
        clears+=delta.clears.length; shuffles+=delta.shuffleAttempts>0?1:0; maxChain=Math.max(maxChain,delta.chainDepth);
        const repeated=delta.clears.length-new Set(delta.clears.map(c=>`${c.position.row},${c.position.col}`)).size;
        if(repeated>0) result.totals.repeatedClearPositions++;
        if(delta.chainDepth>0) result.totals.multiStage++;
        const mixed=delta.powerUpEvents.some(e=>e.trigger.kind==='combo')&&delta.powerUpEvents.some(e=>e.trigger.kind!=='combo');
        if(mixed) result.totals.mixedPowerUpActions++;
        for(const [key,condition] of [['cascade',delta.chainDepth>=2],['mixed',mixed]]) {
          if(condition&&!result.examples[key]) result.examples[key]={level:level.id,seed,engineSeed:String(productionSeeds ? levelSeed(level.id) : seed),actions:[...actions],chainDepth:delta.chainDepth,clears:delta.clears.length,repeated,events:delta.powerUpEvents};
        }
        if(delta.isWin||delta.isFail) { won=delta.isWin;break; }
      }
      const snapshot=engine.snapshot;
      runs.push({seed,won,moves:snapshot.moveCount,remaining:level.moveLimit-snapshot.moveCount,clears,shuffles,maxChain,error,
        completion:level.objectives.map(o=>Math.min(1,(snapshot.objectiveProgress[o.id]??0)/o.target))});
      if(error) result.totals.errors.push({level:level.id,policy,seed,error});
    }
    row.policies[policy]={wins:runs.filter(r=>r.won).length,runs};
  }
  result.levels.push(row);
  if(level.id%10===0) console.log(`Screened ${level.id}/100 levels`);
}
const outputDirectory = mkdtempSync(join(tmpdir(), 'gridwatch-balance-'));
const outputPath = join(outputDirectory, productionSeeds ? 'production.json' : 'sensitivity.json');
writeFileSync(outputPath, JSON.stringify(result,null,2), { flag: 'wx', mode: 0o600 });
console.log(`Report: ${outputPath}`);
const deciles=Array.from({length:10},(_,i)=>{
  const rows=result.levels.slice(i*10,i*10+10);
  return {levels:`${i*10+1}-${i*10+10}`,random:rows.reduce((n,l)=>n+l.policies.random.wins,0),visible:rows.reduce((n,l)=>n+l.policies['visible-match'].wins,0),runsPerPolicy:200};
});
console.log(JSON.stringify({totals:result.totals,deciles,weakest:result.levels.filter(l=>l.policies['visible-match'].wins<10).map(l=>({id:l.id,moves:l.moves,objectives:l.objectives,wins:l.policies['visible-match'].wins})),examples:result.examples},null,2));
