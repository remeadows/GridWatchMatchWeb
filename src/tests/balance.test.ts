import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { BoardAction } from "../engine";

interface SimulationResult {
  outcome: string;
  movesUsed: number;
  unusedMoves: number;
  initialLegalChoices: number;
  actions: BoardAction[];
  remainingObjectives: Record<string, number>;
}
interface Cohort {
  engineSeeds: string[];
  metrics: Record<string, { median: number }>;
}
interface TimingModel {
  rawMoveWin: boolean;
  modeledWin: boolean;
  controllableSeconds: number;
  estimatedWallSeconds: number;
}

const root = new URL("../../", import.meta.url);
const script = new URL("scripts/analyze-balance.mjs", root).href;

// Exercise the same native TypeScript loader and public exports as the offline CLI.
function probe<T>(body: string): T {
  const code = `
    const api = await import(${JSON.stringify(script)});
    const { BoardEngine } = await import(${JSON.stringify(new URL("src/engine/boardEngine.ts", root).href)});
    const { SeededRNG } = await import(${JSON.stringify(new URL("src/engine/rng.ts", root).href)});
    const { levelSeed } = await import(${JSON.stringify(new URL("src/state/progress.ts", root).href)});
    const { readFileSync } = await import('node:fs');
    const load = id => JSON.parse(readFileSync(new URL('public/levels/level_' + String(id).padStart(3, '0') + '.json', ${JSON.stringify(root.href)}), 'utf8'));
    const result = await (async () => { ${body} })();
    process.stdout.write(JSON.stringify(result));
  `;
  return JSON.parse(execFileSync(process.execPath, ["--experimental-transform-types", "--input-type=module", "-e", code], {
    cwd: fileURLToPath(root), encoding: "utf8", timeout: 20_000, maxBuffer: 2_000_000
  }));
}

describe("offline campaign balance analysis", () => {
  it("makes repeatable policy choices without reading or advancing hidden engine RNG", () => {
    const result = probe<{ first: BoardAction[]; second: BoardAction[]; visible: BoardAction[]; objective: BoardAction[]; unchanged: boolean }>(`
      const level = load(1), engine = new BoardEngine(level, 71), snapshot = engine.snapshot;
      const state = snapshot.rngSeed, before = JSON.stringify(snapshot.grid);
      Object.defineProperty(snapshot, 'rngSeed', { get() { throw new Error('Hidden RNG was inspected'); } });
      const decisions = policy => {
        const rng = new SeededRNG(891);
        return Array.from({length: 12}, () => api.pickAction(policy, snapshot, level, engine.validMoves(), rng));
      };
      return { first: decisions('random'), second: decisions('random'),
        visible: decisions('visible-match'), objective: decisions('objective-aware'),
        unchanged: before === JSON.stringify(snapshot.grid) && state === engine.snapshot.rngSeed };
    `);
    expect(result.first).toEqual(result.second);
    expect(new Set(result.first.map(action => JSON.stringify(action))).size).toBeGreaterThan(1);
    expect(result.visible).toHaveLength(12);
    expect(result.objective).toHaveLength(12);
    expect(result.unchanged).toBe(true);
  });

  it("stops on the first win and never spends a booster", () => {
    const run = probe<SimulationResult>(`
      const level = load(1);
      level.objectives = [{id:'clear',target:1,displayName:'Clear',tileType:null}];
      return api.runSimulation(level, {policy:'random',engineSeed:71,policySeed:91,includeActions:true});
    `);
    expect(run.outcome).toBe("win");
    expect(run.movesUsed).toBe(1);
    expect(run.actions).toHaveLength(1);
    expect(run.actions.every((action: { kind: string }) => ["swap", "tap"].includes(action.kind))).toBe(true);
  });

  it("stops at the move budget without Play On or terminal contamination", () => {
    const run = probe<SimulationResult>(`
      const level = load(1); level.moveLimit = 1;
      level.objectives = [{id:'clear',target:10000,displayName:'Clear',tileType:null}];
      return api.runSimulation(level, {policy:'objective-aware',engineSeed:71,policySeed:91,includeActions:true});
    `);
    expect(run.outcome).toBe("fail");
    expect(run.movesUsed).toBe(1);
    expect(run.unusedMoves).toBe(0);
    expect(run.actions).toHaveLength(1);
    expect(run.remainingObjectives.clear).toBeGreaterThan(0);
  });

  it("rejects duplicate objective IDs before simulating misleading totals", () => {
    const result = probe<string>(`
      const level=load(1); level.objectives.push({...level.objectives[0]});
      try { api.runSimulation(level,{policy:'random',engineSeed:1,policySeed:1}); return 'accepted'; }
      catch(error) { return error.message; }
    `);
    expect(result).toMatch(/duplicate objective/i);
  });

  it("rejects unknown policies and injected booster actions", () => {
    const result = probe<string[]>(`
      const level=load(1), engine=new BoardEngine(level,1), messages=[];
      for (const [policy, actions] of [['future-rng',engine.validMoves()],['random',[{kind:'activateBooster',booster:'tnt',at:{row:3,col:3}}]]]) {
        try { api.pickAction(policy,engine.snapshot,level,actions,new SeededRNG(1)); messages.push('accepted'); }
        catch(error) { messages.push(error.message); }
      }
      return messages;
    `);
    expect(result[0]).toMatch(/unknown policy/i);
    expect(result[1]).toMatch(/swap.*tap|booster/i);
  });

  it("fails loudly on engine exceptions instead of counting them as losses", () => {
    const result = probe<string>(`
      const level=load(1); level.cellMap[0][0].powerUp='not-a-power-up';
      try { api.runSimulation(level,{policy:'random',engineSeed:1,policySeed:1}); return 'ordinary-loss'; }
      catch(error) { return error.message; }
    `);
    expect(result).toMatch(/simulation failed.*level 1/i);
    expect(result).not.toBe("ordinary-loss");
  });

  it("reports bounded Wilson intervals, including zero and perfect observed wins", () => {
    const result = probe<[number, number][]>(`return [api.wilsonInterval(0,100),api.wilsonInterval(50,100),api.wilsonInterval(100,100)];`);
    expect(result[0][0]).toBe(0);
    expect(result[0][1]).toBeLessThan(0.05);
    expect(result[1][0]).toBeCloseTo(0.4038, 3);
    expect(result[1][1]).toBeCloseTo(0.5962, 3);
    expect(result[2][0]).toBeGreaterThan(0.95);
    expect(result[2][1]).toBe(1);
  });

  it("repeats complete cohort metrics and keeps production and sensitivity seeds distinct", () => {
    const result = probe<{ equal: boolean; report: { totals: { runs: number; errors: number }; levels: { cohorts: Record<string, Record<string, Cohort>> }[] } }>(`
      const levels=[load(1),load(50)], options={seeds:[1,2],policies:['random','visible-match','objective-aware'],cohorts:['production','sensitivity']};
      const a=api.analyzeCampaign(levels,options), b=api.analyzeCampaign(levels,options);
      return {equal:JSON.stringify(a)===JSON.stringify(b),report:a};
    `);
    expect(result.equal).toBe(true);
    expect(result.report.totals.runs).toBe(24);
    expect(result.report.totals.errors).toBe(0);
    expect(result.report.levels).toHaveLength(2);
    const production = result.report.levels[0].cohorts.production.random;
    const sensitivity = result.report.levels[0].cohorts.sensitivity.random;
    expect(new Set(production.engineSeeds).size).toBe(1);
    expect(new Set(sensitivity.engineSeeds).size).toBe(2);
    expect(production.metrics.presentationMs.median).toBeGreaterThan(0);
    expect(production.metrics.initialLegalChoices.median).toBeGreaterThan(0);
  });

  it("models boss thinking time separately from forced presentation and raw move outcome", () => {
    const result = probe<TimingModel[]>(`
      const run={movesUsed:8,outcome:'win',presentationMs:1000};
      return [api.modelBossTiming(run,30,3),api.modelBossTiming({...run,presentationMs:100000},30,3),api.modelBossTiming(run,30,4)];
    `);
    expect(result[0].rawMoveWin).toBe(true);
    expect(result[0].modeledWin).toBe(true);
    expect(result[1].modeledWin).toBe(true);
    expect(result[0].controllableSeconds).toBe(result[1].controllableSeconds);
    expect(result[1].estimatedWallSeconds - result[0].estimatedWallSeconds).toBe(99);
    expect(result[2].rawMoveWin).toBe(true);
    expect(result[2].modeledWin).toBe(false);
  });

  it("samples both directed swaps for every policy without duplicating taps or caller actions", () => {
    const result = probe<{ choices: BoardAction[][]; repeated: BoardAction[]; unchanged: boolean; createdRows: number[] }>(`
      const level = load(1), engine = new BoardEngine(level, levelSeed(1));
      const pair = {kind:'swap',from:{row:2,col:4},to:{row:3,col:4}};
      const before = JSON.stringify(pair);
      const choices = api.policies.map(policy => [0,1].map(index =>
        api.pickAction(policy,engine.snapshot,level,[pair],{nextInt: count => index % count})));
      const tap = {kind:'tap',at:{row:0,col:0}};
      const supplied = [pair,{kind:'swap',from:pair.to,to:pair.from},tap,tap];
      const repeated = [0,1,2].map(index => api.pickAction('random',engine.snapshot,level,supplied,{nextInt: count => index % count}));
      const createdRows = choices[0].map(action => {
        const run = new BoardEngine(level, levelSeed(1)).applyWithResolution(action);
        return run.steps.flatMap(step => step.spawns).find(spawn => spawn.asPowerUp?.kind === 'rocket' && spawn.position.col === 4).position.row;
      });
      return {choices,repeated,unchanged:before===JSON.stringify(pair),createdRows};
    `);
    const forward: BoardAction = { kind: "swap", from: { row: 2, col: 4 }, to: { row: 3, col: 4 } };
    const reverse: BoardAction = { kind: "swap", from: forward.to, to: forward.from };
    for (const choices of result.choices) expect(choices).toEqual([forward, reverse]);
    expect(result.repeated).toEqual([forward, reverse, { kind: "tap", at: { row: 0, col: 0 } }]);
    expect(result.unchanged).toBe(true);
    expect(result.createdRows).toEqual([3, 2]);
  });

  it("counts directed legal choices in simulation metrics", () => {
    const result = probe<{ count: number; expected: number }>(`
      const level=load(1); level.objectives=[{id:'clear',target:1,displayName:'Clear',tileType:null}];
      const actions=new BoardEngine(level,71).validMoves();
      const run=api.runSimulation(level,{policy:'random',engineSeed:71,policySeed:91});
      return {count:run.initialLegalChoices,expected:actions.reduce((n,a)=>n+(a.kind==='swap'?2:1),0)};
    `);
    expect(result.count).toBe(result.expected);
  });
});
