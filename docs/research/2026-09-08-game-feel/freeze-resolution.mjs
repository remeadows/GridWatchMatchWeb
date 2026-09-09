import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = `${root}src/tests/fixtures/resolution/`;
const baseline = '328a1a7';
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

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}
export function snapshotRecord(snapshot) {
  return { ...snapshot, grid: {
    rows: snapshot.grid.rows, cols: snapshot.grid.cols,
    cells: snapshot.grid.allPositions.map(position => snapshot.grid.get(position))
  } };
}
export function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('base64url');
}
export function encodeAction(action) {
  if (action.kind === 'swap') return [0, action.from.row, action.from.col, action.to.row, action.to.col];
  if (action.kind === 'tap') return [1, action.at.row, action.at.col];
  return [2, action.booster, action.at.row, action.at.col];
}

// Refuse to freeze expectations from modified rules, even on a later branch.
const paths = execFileSync('git', ['ls-tree', '-r', '--name-only', baseline, '--', 'src/engine', 'public/levels'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
const hashes = Object.fromEntries(paths.map(path => {
  const bytes = readFileSync(root + path);
  assert.deepEqual(bytes, execFileSync('git', ['show', `${baseline}:${path}`], { cwd: root }), `${path} is no longer the frozen engine/content`);
  return [path, createHash('sha256').update(bytes).digest('hex')];
}));
const { BoardEngine } = await import(new URL('../../../src/engine/boardEngine.ts', import.meta.url));
const { SeededRNG } = await import(new URL('../../../src/engine/rng.ts', import.meta.url));
const { levelSeed } = await import(new URL('../../../src/state/progress.ts', import.meta.url));
const levels = readdirSync(root + 'public/levels').filter(name => /^level_\d+\.json$/.test(name)).sort()
  .map(name => JSON.parse(readFileSync(root + 'public/levels/' + name, 'utf8')));
const specimens = [];

function result(engine, action) {
  let delta = null;
  let error = null;
  try { delta = engine.apply(action); }
  catch (caught) { error = { code: caught.code ?? null, message: caught.message }; }
  return { delta, error, snapshot: snapshotRecord(engine.snapshot), actionLog: engine.actionLog() };
}
function specimen(name, level, seed, actions) {
  const engine = new BoardEngine(level, seed);
  const initial = snapshotRecord(engine.snapshot);
  let before;
  let expected;
  for (const action of actions) {
    before = snapshotRecord(engine.snapshot);
    expected = result(engine, action);
  }
  assert.deepEqual(expected.actionLog, actions.filter((_, index) => index < actions.length - (expected.error ? 1 : 0)));
  specimens.push({ name, level, seed: String(seed), actions: structuredClone(actions), initial, before, expected });
}
function harness(left = null, right = null) {
  const tiles = ['packet', 'firewall', 'key', 'threat'];
  const level = {
    id: 900, name: 'Frozen resolution harness', gridRows: 7, gridCols: 7, moveLimit: 10,
    objectives: [{ id: 'clear', target: 999, displayName: 'Clear', tileType: null }],
    cellMap: Array.from({ length: 7 }, (_, row) => Array.from({ length: 7 }, (_, col) => ({
      tile: tiles[(row * 2 + col) % 4], powerUp: null, overlay: null, underlay: null, generator: null, locked: false
    }))),
    spawnWeights: { packet: 0.25, firewall: 0.25, key: 0.25, threat: 0.25, zeroDay: 0 },
    bossLevel: false, bonusLevel: false, bossTimerSeconds: null
  };
  if (left) Object.assign(level.cellMap[3][3], { tile: null, powerUp: left });
  if (right) Object.assign(level.cellMap[3][4], { tile: null, powerUp: right });
  Object.assign(level.cellMap[0][0], { tile: null, generator: 'honeypot', locked: true });
  level.cellMap[6][6].locked = true;
  level.cellMap[1][1].overlay = 'encryptedVolume_2';
  level.cellMap[5][5].underlay = 'malware_1';
  return level;
}
const swap = { kind: 'swap', from: { row: 3, col: 3 }, to: { row: 3, col: 4 } };
const types = ['rocket_h', 'propeller', 'tnt', 'lightBall'];
for (let a = 0; a < types.length; a++) {
  for (let b = a; b < types.length; b++) {
    specimen(`combo-${types[a]}-${types[b]}`, harness(types[a], a === 0 && b === 0 ? 'rocket_v' : types[b]), 99, [swap]);
  }
}
specimen('production-level-1-repeated-coordinate', levels[0], levelSeed(1), [{ kind: 'swap', from: { row: 4, col: 2 }, to: { row: 5, col: 2 } }]);
const shielded = harness();
for (const row of shielded.cellMap) for (const cell of row) if (!cell.generator) cell.overlay = 'encryptedVolume_3';
specimen('damage-only', shielded, 99, [{ kind: 'activateBooster', booster: 'tnt', at: { row: 3, col: 3 } }]);
assert.equal(specimens.at(-1).expected.delta.clears.length, 0);
assert.notDeepEqual(specimens.at(-1).before.grid.cells, specimens.at(-1).expected.snapshot.grid.cells);
specimen('generator-and-lock', harness(), 99, [{ kind: 'activateBooster', booster: 'tnt', at: { row: 5, col: 6 } }]);
assert.equal(specimens.at(-1).expected.snapshot.grid.cells[48].debugDesignLocked, false);
const invalid = [
  { kind: 'swap', from: { row: -1, col: 0 }, to: { row: 0, col: 0 } },
  { kind: 'swap', from: { row: 1, col: 0 }, to: { row: 4, col: 0 } },
  { kind: 'swap', from: { row: 0, col: 0 }, to: { row: 0, col: 1 } },
  { kind: 'tap', at: { row: 2, col: 2 } },
  { kind: 'activateBooster', booster: 'tnt', at: { row: 0, col: 0 } }
];
invalid.forEach((action, index) => specimen(`invalid-${index}`, harness(), 99, [action]));
for (const entry of specimens.filter(entry => entry.name.startsWith('invalid'))) assert.ok(entry.expected.error);

const runs = [];
let actionCount = 0;
let foundCreation = false;
let foundCreatedTap = false;
let foundShuffle = false;
for (const level of levels) {
  for (let seed = 1; seed <= 20; seed++) {
    const engine = new BoardEngine(level, seed);
    const chooser = new SeededRNG(100000 + seed);
    const actions = [];
    const outcomes = [];
    const initialHash = digest(snapshotRecord(engine.snapshot));
    for (let index = 0; index < level.moveLimit; index++) {
      const valid = engine.validMoves();
      assert.ok(valid.length, `No valid action in ${level.id}/${seed}`);
      const action = valid[chooser.nextInt(valid.length)];
      const before = engine.snapshot;
      actions.push(action);
      const outcome = result(engine, action);
      assert.equal(outcome.error, null, `Unexpected error in ${level.id}/${seed}`);
      outcomes.push(digest(outcome));
      actionCount++;
      const { delta } = outcome;
      if (!foundCreation && delta.spawns.some(spawn => spawn.asPowerUp && delta.powerUpEvents.some(event => (
        event.origin.row === spawn.position.row && event.origin.col === spawn.position.col &&
        event.powerUpType.kind === spawn.asPowerUp.kind
      )))) {
        specimen('creation-at-earlier-activation-coordinate', level, seed, actions);
        foundCreation = true;
      }
      if (!foundCreatedTap && delta.spawns.some(spawn => spawn.asPowerUp) && !delta.isWin && !delta.isFail) {
        const oldPowerIds = new Set(before.grid.allPositions.filter(position => before.grid.get(position).powerUp)
          .map(position => before.grid.get(position).debugTileId));
        const after = engine.snapshot;
        const at = after.grid.allPositions.find(position => {
          const cell = after.grid.get(position);
          return cell.powerUp && cell.isMovable && !oldPowerIds.has(cell.debugTileId);
        });
        if (at) {
          specimen('created-power-up-then-tapped', level, seed, [...actions, { kind: 'tap', at }]);
          foundCreatedTap = true;
        }
      }
      if (!foundShuffle && delta.shuffleAttempts > 0) {
        specimen('post-resolution-shuffle', level, seed, actions);
        foundShuffle = true;
      }
      if (delta.isWin || delta.isFail) break;
    }
    runs.push({ level: level.id, seed, initialHash, actions: actions.map(encodeAction), outcomes });
  }
  if (level.id % 10 === 0) console.log(`Frozen ${level.id}/100 levels; ${actionCount} actions`);
}
assert.ok(foundCreation, 'Corpus must include coordinate reuse across activation and creation');
assert.ok(foundCreatedTap, 'Corpus must include creation followed by a later tap action');
assert.ok(foundShuffle, 'Corpus must include post-resolution shuffle');
const files = {
  'manifest.json': { baseline, algorithm: 'sha256/base64url of sorted-key JSON; arrays retain order', snapshotLayout: 'grid cells row-major; all CellState and BoardSnapshot fields retained', actionEncoding: 'swap=[0,fromRow,fromCol,toRow,toCol]; tap=[1,row,col]; booster=[2,type,row,col]', node: process.version, sourceHashes: hashes, runs: runs.length, actions: actionCount },
  'specimens.json': specimens,
  'corpus.json': runs
};
const serialized = Object.entries(files).map(([name, value]) => [name, JSON.stringify(canonical(value)) + '\n']);
const bytes = serialized.reduce((sum, [, data]) => sum + Buffer.byteLength(data), 0);
assert.ok(bytes < 5 * 1024 * 1024, `Fixture bytes ${bytes} exceeds 5 MiB`);
mkdirSync(output, { recursive: true });
for (const [name, data] of serialized) {
  assert.ok(!existsSync(output + name), `Refusing to overwrite immutable fixture ${name}`);
  writeFileSync(output + name, data, { flag: 'wx' });
}
console.log(JSON.stringify({ runs: runs.length, actions: actionCount, specimens: specimens.length, bytes, coverage: specimens.map(entry => entry.name) }, null, 2));
