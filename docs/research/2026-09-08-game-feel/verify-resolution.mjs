import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && context.parentURL) {
    const url = new URL(specifier, context.parentURL);
    if (!/\.[a-z]+$/i.test(url.pathname)) {
      for (const suffix of ['.ts', '/index.ts']) {
        if (existsSync(new URL(url.href + suffix))) return next(url.href + suffix, context);
      }
    }
  }
  return next(specifier, context);
} });
const { BoardEngine } = await import(new URL('../../../src/engine/boardEngine.ts', import.meta.url));
const read = path => JSON.parse(readFileSync(new URL('../../../' + path, import.meta.url), 'utf8'));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const snapshotRecord = snapshot => ({ ...snapshot, grid: {
  rows: snapshot.grid.rows, cols: snapshot.grid.cols,
  cells: snapshot.grid.allPositions.map(position => snapshot.grid.get(position))
} });
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('base64url');
const decode = action => action[0] === 0
  ? { kind: 'swap', from: { row: action[1], col: action[2] }, to: { row: action[3], col: action[4] } }
  : action[0] === 1 ? { kind: 'tap', at: { row: action[1], col: action[2] } }
    : { kind: 'activateBooster', booster: action[1], at: { row: action[2], col: action[3] } };
function outcome(engine, action) {
  let delta = null;
  let error = null;
  try { delta = engine.apply(action); }
  catch (caught) { error = { code: caught.code ?? null, message: caught.message }; }
  return { delta, error, snapshot: snapshotRecord(engine.snapshot), actionLog: engine.actionLog() };
}
const specimens = read('src/tests/fixtures/resolution/specimens.json');
for (const specimen of specimens) {
  const engine = new BoardEngine(specimen.level, specimen.seed);
  assert.deepEqual(canonical(snapshotRecord(engine.snapshot)), specimen.initial, specimen.name);
  for (const action of specimen.actions.slice(0, -1)) engine.apply(action);
  assert.deepEqual(canonical(snapshotRecord(engine.snapshot)), specimen.before, specimen.name);
  assert.deepEqual(canonical(outcome(engine, specimen.actions.at(-1))), specimen.expected, specimen.name);
}
let actions = 0;
const corpus = read('src/tests/fixtures/resolution/corpus.json');
for (const run of corpus) {
  const level = read(`public/levels/level_${String(run.level).padStart(3, '0')}.json`);
  const engine = new BoardEngine(level, run.seed);
  assert.equal(digest(snapshotRecord(engine.snapshot)), run.initialHash);
  assert.equal(run.actions.length, run.outcomes.length);
  run.actions.forEach((action, index) => {
    assert.equal(digest(outcome(engine, decode(action))), run.outcomes[index], `${run.level}/${run.seed} action ${index}`);
    actions++;
  });
}
console.log(`Verified ${specimens.length} full specimens and ${actions} actions in ${corpus.length} runs; no fixture writes`);
