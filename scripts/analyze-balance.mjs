import { registerHooks } from 'node:module';
import { existsSync, readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
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

const { BoardEngine } = await import('../src/engine/boardEngine.ts');
const { SeededRNG } = await import('../src/engine/rng.ts');
const { cloneCell, positionKey } = await import('../src/engine/types.ts');
const { detectMatches } = await import('../src/engine/matchDetector.ts');
const { triggerSinglePowerUp, triggerPowerUpCombo } = await import('../src/engine/powerUps.ts');
const { levelSeed } = await import('../src/state/progress.ts');
const { matchPacingPlan, cascadeFallDurationMs, presentationResourcePlan } = await import('../src/game/presentation.ts');
const { cascadePresentationPlan } = await import('../src/game/motion.ts');
const { groupResolutionPowerUps } = await import('../src/game/resolutionPlayback.ts');
const timing = await import('../src/data/presentationTiming.ts');

export const policies = ['random', 'visible-match', 'objective-aware'];
const cohortNames = ['production', 'sensitivity'];
const thinkingSeconds = [1, 3, 5, 8];
// These two costs are scene-local rather than exported; pin BoardScene's hash in every report.
const sceneCosts = { creationMs: 70 + 130 + 110, spawnPremiumMs: 40 };
const round = number => Math.round(number * 1000) / 1000;

export function validateObjectives(level) {
  const ids = new Set();
  for (const objective of level.objectives) {
    if (ids.has(objective.id)) throw new Error(`Duplicate objective ID in level ${level.id}: ${objective.id}`);
    if (typeof objective.id !== 'string' || !objective.id || !Number.isInteger(objective.target) || objective.target <= 0) {
      throw new Error(`Invalid objective in level ${level.id}`);
    }
    ids.add(objective.id);
  }
}

function visibleConsequences(action, snapshot, level) {
  const grid = snapshot.grid.clone(cloneCell);
  // This sampler is independent of both the engine and decision RNGs. It estimates
  // the visible power-up footprint, never a refill, cascade, or hidden RNG state.
  const sampler = new SeededRNG(0xbeef);
  let power = null;
  if (action.kind === 'tap') {
    const cell = grid.get(action.at);
    if (cell.powerUp) power = triggerSinglePowerUp(cell.powerUp, action.at, grid, level.objectives,
      snapshot.objectiveProgress, sampler, { kind: 'tap' });
  } else {
    grid.swap(action.from, action.to);
    const a = grid.get(action.from), b = grid.get(action.to);
    if (a.powerUp && b.powerUp) power = triggerPowerUpCombo(a.powerUp, b.powerUp, action.from, action.to,
      grid, level.objectives, snapshot.objectiveProgress, sampler);
    else if (a.powerUp || b.powerUp) power = triggerSinglePowerUp(a.powerUp ?? b.powerUp,
      a.powerUp ? action.from : action.to, grid, level.objectives, snapshot.objectiveProgress, sampler, { kind: 'swap' });
  }
  const matches = power ? [] : detectMatches(grid);
  const affected = power?.clears ?? new Set(matches.flatMap(group => [...group.positions]));
  return { grid, affected, power: Boolean(power), creationMerit: matches.filter(group => group.positions.size >= 4).length * 5 };
}

function merit(policy, action, snapshot, level) {
  const { grid, affected, power, creationMerit } = visibleConsequences(action, snapshot, level);
  let score = creationMerit;
  for (const key of affected) {
    const [row, col] = key.split(',').map(Number), cell = grid.get({ row, col });
    const damageOnly = cell.overlay && (power || cell.overlay.hp > 1);
    if (cell.baseTile || cell.powerUp) score += damageOnly ? 0.4 : 1;
    if (policy !== 'objective-aware') continue;
    if (cell.overlay) score += 2 / cell.overlay.hp;
    if (cell.debugDesignLocked) score += 1;
    if (cell.underlay) score += 1;
    for (const objective of level.objectives) {
      if ((snapshot.objectiveProgress[objective.id] ?? 0) >= objective.target) continue;
      if (damageOnly) continue;
      if ((objective.id === 'collect' || objective.id.startsWith('collect_')) && cell.baseTile === objective.tileType) score += 3;
      else if (objective.id === 'clear' || objective.id === 'multi') score += 1.5;
      else if (objective.id === 'guide' && row === grid.rows - 1) score += 3;
      else if (objective.id === 'spread' && cell.underlay) score += 3;
    }
  }
  return score;
}

function playerActions(validActions) {
  if (validActions.some(action => !['swap', 'tap'].includes(action.kind))) throw new Error('Only legal swap and tap actions are allowed; no boosters');
  const actions = new Map();
  // The engine enumerates undirected pairs, but creation prefers the drag destination.
  for (const action of validActions) {
    const directions = action.kind === 'swap'
      ? [action, { kind: 'swap', from: action.to, to: action.from }] : [action];
    for (const directed of directions) {
      const key = directed.kind === 'swap' ? `swap:${positionKey(directed.from)}:${positionKey(directed.to)}` : `tap:${positionKey(directed.at)}`;
      if (!actions.has(key)) actions.set(key, directed);
    }
  }
  return [...actions.values()];
}

export function pickAction(policy, snapshot, level, validActions, policyRng) {
  if (!policies.includes(policy)) throw new Error(`Unknown policy: ${policy}`);
  const actions = playerActions(validActions);
  if (actions.length === 0) throw new Error('No legal actions');
  let candidates = actions;
  if (policy !== 'random') {
    const scores = actions.map(action => merit(policy, action, snapshot, level));
    const best = Math.max(...scores);
    candidates = actions.filter((_, index) => scores[index] === best);
  }
  return structuredClone(candidates[policyRng.nextInt(candidates.length)]);
}

export function estimatePresentationMs(resolution, action) {
  let total = action.kind === 'swap' ? timing.SWAP_TRAVEL_MS + timing.SWAP_SETTLE_MS : 0;
  let groups = [];
  const presented = new Set();
  for (const step of resolution.steps) {
    if (step.kind === 'activation') groups = groupResolutionPowerUps(step.activations, presented);
    if (step.kind === 'clear') {
      const ordinary = matchPacingPlan(step.clears, step.cascadeDepth).gravityNotBeforeMs;
      const effects = groups.map(group => Math.max(...group.events.map(event =>
        presentationResourcePlan(group.key ?? event.powerUpType.kind, group.affectedPositions.length, 'desktop', false).totalDurationMs)));
      total += Math.max(ordinary, 0, ...effects);
      groups = [];
    } else if (step.kind === 'creation' && step.spawns.some(spawn => spawn.asPowerUp)) {
      total += sceneCosts.creationMs;
    } else if (step.kind === 'gravity' || step.kind === 'refill') {
      const plan = cascadePresentationPlan(step.before, step.after);
      const durations = [
        ...plan.moves.map(move => cascadeFallDurationMs(Math.abs(move.to.row - move.from.row))),
        ...plan.spawns.map(spawn => cascadeFallDurationMs(spawn.position.row + 1) + sceneCosts.spawnPremiumMs)
      ];
      if (durations.length) total += Math.max(...durations) + timing.CASCADE_LANDING_SQUASH_MS + timing.CASCADE_LANDING_SETTLE_MS;
    } else if (step.kind === 'shuffle' && step.moves.length) {
      total += timing.SWAP_TRAVEL_MS + timing.SWAP_SETTLE_MS;
    }
  }
  if (!Number.isFinite(total) || total < 0) throw new Error('Non-finite presentation estimate');
  return round(total);
}

export function runSimulation(level, { policy, engineSeed, policySeed, includeActions = false }) {
  validateObjectives(level);
  try {
    const engine = new BoardEngine(level, engineSeed), chooser = new SeededRNG(policySeed);
    const run = { levelId: level.id, policy, engineSeed: String(engineSeed), policySeed: String(policySeed), outcome: null,
      movesUsed: 0, unusedMoves: level.moveLimit, remainingObjectives: {}, initialLegalChoices: playerActions(engine.validMoves()).length,
      clears: 0, powerUpsCreated: 0, powerUpActivations: 0, reshuffles: 0, maxCascadeDepth: 0, presentationMs: 0 };
    const actions = [];
    for (let index = 0; index < level.moveLimit; index++) {
      const action = pickAction(policy, engine.snapshot, level, engine.validMoves(), chooser);
      const resolution = engine.applyWithResolution(action), delta = resolution.delta;
      actions.push(action);
      run.clears += delta.clears.length;
      run.powerUpsCreated += resolution.steps.flatMap(step => step.spawns).filter(spawn => spawn.asPowerUp).length;
      run.powerUpActivations += new Set(resolution.steps.flatMap(step => step.activations)
        .filter(activation => !activation.isRepeat).map(activation => activation.activationId)).size;
      run.reshuffles += Number(delta.shuffleAttempts > 0);
      run.maxCascadeDepth = Math.max(run.maxCascadeDepth, delta.chainDepth);
      run.presentationMs += estimatePresentationMs(resolution, action);
      if (delta.isWin || delta.isFail) { run.outcome = delta.isWin ? 'win' : 'fail'; break; }
    }
    if (!run.outcome) throw new Error('Run did not reach a terminal state within the authored move budget');
    const final = engine.snapshot;
    run.movesUsed = final.moveCount;
    run.unusedMoves = level.moveLimit - final.moveCount;
    run.unusedMoveFraction = run.unusedMoves / level.moveLimit;
    run.presentationMs = round(run.presentationMs);
    run.remainingObjectives = Object.fromEntries(level.objectives.map(objective =>
      [objective.id, Math.max(0, objective.target - (final.objectiveProgress[objective.id] ?? 0))]));
    if (includeActions) run.actions = actions;
    return run;
  } catch (error) {
    throw new Error(`Simulation failed for level ${level.id}, policy ${policy}, engine seed ${engineSeed}, policy seed ${policySeed}: ${error.message}`, { cause: error });
  }
}

export function wilsonInterval(wins, samples) {
  if (!Number.isInteger(samples) || samples < 1 || !Number.isInteger(wins) || wins < 0 || wins > samples) throw new Error('Invalid binomial sample');
  const z = 1.959963984540054, proportion = wins / samples;
  const divisor = 1 + z * z / samples;
  const center = (proportion + z * z / (2 * samples)) / divisor;
  const half = z * Math.sqrt(proportion * (1 - proportion) / samples + z * z / (4 * samples * samples)) / divisor;
  return [wins === 0 ? 0 : center - half, wins === samples ? 1 : center + half];
}

export function modelBossTiming(run, bossTimerSeconds, thinkSeconds) {
  const controllableSeconds = round(run.movesUsed * (thinkSeconds + 0.25));
  return { thinkingSeconds: thinkSeconds, gestureSecondsPerMove: 0.25, rawMoveWin: run.outcome === 'win',
    controllableSeconds, modeledWin: run.outcome === 'win' && controllableSeconds < bossTimerSeconds,
    estimatedWallSeconds: round(controllableSeconds + run.presentationMs / 1000 + (run.outcome === 'win' ? 2.5 : 0)) };
}

function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = fraction => {
    const point = (sorted.length - 1) * fraction, low = Math.floor(point), high = Math.ceil(point);
    return round(sorted[low] + (sorted[high] - sorted[low]) * (point - low));
  };
  return { min: sorted[0], p10: quantile(0.1), median: quantile(0.5), p90: quantile(0.9), max: sorted.at(-1),
    mean: round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length) };
}

function summarize(runs, level) {
  const wins = runs.filter(run => run.outcome === 'win').length;
  const keys = ['movesUsed', 'unusedMoves', 'unusedMoveFraction', 'initialLegalChoices', 'clears', 'powerUpsCreated',
    'powerUpActivations', 'reshuffles', 'maxCascadeDepth', 'presentationMs'];
  return { samples: runs.length, wins, winRate: wins / runs.length, wilson95: wilsonInterval(wins, runs.length), errors: 0, rejections: 0,
    engineSeeds: [...new Set(runs.map(run => run.engineSeed))], policySeeds: runs.map(run => run.policySeed),
    metrics: Object.fromEntries(keys.map(key => [key, distribution(runs.map(run => run[key]))])),
    remainingObjectives: Object.fromEntries(level.objectives.map(objective =>
      [objective.id, distribution(runs.map(run => run.remainingObjectives[objective.id]))])),
    ...(level.bossLevel ? { bossModels: thinkingSeconds.map(think => {
      const models = runs.map(run => modelBossTiming(run, level.bossTimerSeconds, think));
      const modeledWins = models.filter(model => model.modeledWin).length;
      return { thinkingSeconds: think, wins: modeledWins, winRate: modeledWins / runs.length,
        wilson95: wilsonInterval(modeledWins, runs.length), controllableSeconds: distribution(models.map(model => model.controllableSeconds)),
        estimatedWallSeconds: distribution(models.map(model => model.estimatedWallSeconds)) };
    }) } : {}) };
}

function mechanicInventory(level) {
  const cells = level.cellMap.flat();
  return { locked: cells.filter(cell => cell.locked).length, overlays: cells.filter(cell => cell.overlay).length,
    underlays: cells.filter(cell => cell.underlay).length, generators: cells.filter(cell => cell.generator).length,
    initialPowerUps: cells.filter(cell => cell.powerUp).length, colors: Object.values(level.spawnWeights).filter(weight => weight > 0).length };
}

function contentFlags(level) {
  return level.objectives.flatMap(objective => {
    const collect = objective.id === 'collect' || objective.id.startsWith('collect_');
    if (!collect && !['clear', 'multi', 'spread', 'guide'].includes(objective.id)) return [`unrecognized-objective:${objective.id}`];
    if (collect && (!objective.tileType || (!(level.spawnWeights[objective.tileType] > 0)
      && !level.cellMap.flat().some(cell => cell.tile === objective.tileType)))) return [`unreachable-collect-type:${objective.id}`];
    return [];
  });
}

export function analyzeCampaign(levels, options) {
  const { seeds, policies: selectedPolicies = policies, cohorts = cohortNames, onLevel } = options;
  if (!seeds.length || new Set(seeds).size !== seeds.length || seeds.some(seed => !Number.isSafeInteger(seed) || seed < 1)) throw new Error('Use distinct positive integer seeds');
  if (selectedPolicies.some(policy => !policies.includes(policy)) || !selectedPolicies.length) throw new Error('Unknown policy cohort');
  if (cohorts.some(cohort => !cohortNames.includes(cohort)) || !cohorts.length) throw new Error('Unknown seed cohort');
  const report = { schemaVersion: 1, seeds, policies: selectedPolicies, cohorts,
    model: { actionSpace: 'Both directions of each legal swap, deduplicated by ordered endpoints; each legal power-up tap once.',
      foresight: 'No future refill, cascade, or engine RNG inspection. Power-up target uncertainty uses a fixed independent footprint sampler.',
      thinkingSeconds, gestureSecondsPerMove: 0.25, bossClock: 'Task 5 candidate: visible controllable time only; forced presentation and hidden time excluded.',
      presentation: 'Nominal ordered phase model using current pure timing helpers and power-up budgets, not measured per-run browser time.', sceneCosts,
      sampling: 'Production cohorts hold the app retry seed fixed while policy choices vary. Sensitivity cohorts vary both seeds. Wilson intervals are conditional bot-screening summaries, not human win rates.' },
    levels: [], totals: { runs: 0, actions: 0, errors: 0, rejections: 0 }, mechanicUsage: {} };
  for (const level of [...levels].sort((a, b) => a.id - b.id)) {
    validateObjectives(level);
    if (level.bossLevel && !(level.bossTimerSeconds > 0)) throw new Error(`Missing boss timer for level ${level.id}`);
    const row = { id: level.id, name: level.name, moveLimit: level.moveLimit, boss: level.bossLevel,
      bossTimerSeconds: level.bossTimerSeconds ?? null, objectives: level.objectives, mechanics: mechanicInventory(level),
      cohorts: {}, flags: contentFlags(level) };
    for (const cohort of cohorts) {
      row.cohorts[cohort] = {};
      for (const policy of selectedPolicies) {
        const runs = seeds.map(seed => runSimulation(level, { policy,
          engineSeed: cohort === 'production' ? levelSeed(level.id) : seed, policySeed: 100000 + seed }));
        row.cohorts[cohort][policy] = summarize(runs, level);
        report.totals.runs += runs.length;
        report.totals.actions += runs.reduce((sum, run) => sum + run.movesUsed, 0);
      }
    }
    const random = row.cohorts.production?.random;
    if (level.id > 3 && random?.winRate >= 0.95) row.flags.push('post-tutorial-random-win-rate-at-least-95-percent');
    if (random?.metrics.unusedMoveFraction.median > 0.4) row.flags.push('median-unused-moves-above-40-percent');
    const previous = report.levels.at(-1);
    if (previous?.id === row.id - 1 && random && previous.cohorts.production?.random) {
      const before = previous.cohorts.production.random;
      if (Math.abs(random.winRate - before.winRate) >= 0.25) row.flags.push(`neighbor-win-rate-jump:${previous.id}`);
      if (Math.abs(random.metrics.unusedMoveFraction.median - before.metrics.unusedMoveFraction.median) >= 0.25) row.flags.push(`neighbor-unused-move-jump:${previous.id}`);
    }
    for (const [mechanic, count] of Object.entries(row.mechanics)) {
      if (mechanic !== 'colors' && count > 0) report.mechanicUsage[mechanic] = (report.mechanicUsage[mechanic] ?? 0) + 1;
    }
    report.levels.push(row);
    onLevel?.(row, report.totals);
  }
  report.overusedMechanics = Object.entries(report.mechanicUsage).filter(([, count]) => count / levels.length > 0.65)
    .map(([mechanic, count]) => ({ mechanic, levels: count, fraction: count / levels.length }));
  return report;
}

export function sourceHashes() {
  const files = ['scripts/analyze-balance.mjs', 'src/state/progress.ts', 'src/game/BoardScene.ts', 'src/game/presentation.ts', 'src/game/motion.ts',
    'src/game/resolutionPlayback.ts', 'src/game/playbackLifecycle.ts', 'src/data/presentationTiming.ts'];
  for (const directory of ['src/engine', 'public/levels', 'worker']) {
    const walk = path => {
      for (const entry of readdirSync(join(root, path), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') walk(`${path}/${entry.name}`);
        else if (entry.isFile() && /\.(ts|json)$/.test(entry.name)) files.push(`${path}/${entry.name}`);
      }
    };
    walk(directory);
  }
  return Object.fromEntries(files.sort().map(path => [path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')]));
}

function main() {
  const { values } = parseArgs({ options: { samples: { type: 'string', default: '100' }, levels: { type: 'string' },
    policies: { type: 'string', default: policies.join(',') }, cohorts: { type: 'string', default: cohortNames.join(',') },
    output: { type: 'string' } } });
  const samples = Number(values.samples);
  if (!Number.isSafeInteger(samples) || samples < 1 || samples > 10000) throw new Error('--samples must be an integer from 1 to 10000');
  const selectedIds = values.levels?.split(',').map(Number);
  if (selectedIds?.some(id => !Number.isInteger(id) || id < 1 || id > 100)) throw new Error('Invalid --levels list');
  const levels = readdirSync(join(root, 'public/levels')).filter(file => /^level_\d{3}\.json$/.test(file))
    .map(file => JSON.parse(readFileSync(join(root, 'public/levels', file), 'utf8'))).filter(level => !selectedIds || selectedIds.includes(level.id));
  const before = sourceHashes();
  const report = analyzeCampaign(levels, { seeds: Array.from({ length: samples }, (_, i) => i + 1),
    policies: values.policies.split(','), cohorts: values.cohorts.split(','),
    onLevel: (row, totals) => console.log(`Level ${row.id}: ${totals.runs} runs, ${totals.actions} actions, ${row.flags.length} flags`) });
  const after = sourceHashes();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Source changed during analysis; report rejected');
  report.sources = before;
  const output = values.output ? resolve(values.output) : join(mkdtempSync(join(tmpdir(), 'gridwatch-balance-regression-')), 'report.json');
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(`Report: ${output}`);
  console.log(JSON.stringify(report.totals));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { main(); } catch (error) { console.error(error); process.exitCode = 1; }
}
