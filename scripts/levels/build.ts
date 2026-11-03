// The `build` command of the level CLI: tunes levels from their sector recipes, writes them to the levels folder
// and writes a report. Levels marked handTuned are measured, never rewritten. A level is tuned again only when its
// fingerprint (recipe, name, settings and the source of everything that plays or builds it) has changed or its file
// no longer matches what the report recorded, so a second run with nothing changed reuses every stored result.
// The same command on the same commit writes the same files: nothing in them depends on time or worker count.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { normalizeLevel } from "../../src/data/levels";
import type { LevelDefinition } from "../../src/engine";
import { BAND_TOLERANCE, targetFailRate } from "./bands";
import type { BotOptions } from "./bot";
import { levelName } from "./levelNames";
import { recipeForLevel } from "./recipes";
import { measureLevel, type LevelReport } from "./report";
import { acceptsCandidate, tuneLevel, type Stretch, type TuneEnd, type TuneResult } from "./tune";

export interface BuildSettings {
  levelIds: number[];
  games: number;
  searchGames: number;
  candidates: number;
  bot: BotOptions;
  levelsDir: string;
  out: string;
}

export type LevelJob =
  | { kind: "tune"; levelId: number; name: string; games: number; searchGames: number; candidates: number }
  | { kind: "measure"; level: LevelDefinition; games: number };

export type LevelJobResult = { kind: "tune"; levelId: number; result: TuneResult } | { kind: "measure"; levelId: number; report: LevelReport };

export type JobRunner = (jobs: LevelJob[], onResult: (result: LevelJobResult, finished: number) => void) => Promise<LevelJobResult[]>;

/** Runs one job; called inside a worker thread. */
export function runLevelJob(job: LevelJob, bot: BotOptions): LevelJobResult {
  if (job.kind === "measure") return { kind: "measure", levelId: job.level.id, report: measureLevel(job.level, job.games, bot) };
  const result = tuneLevel(recipeForLevel(job.levelId), job.levelId, job.name, { games: job.games, searchGames: job.searchGames, candidates: job.candidates, bot });
  return { kind: "tune", levelId: job.levelId, result };
}

export interface BuildRow extends LevelReport {
  name: string;
  sector: number;
  target: number;
  inBand: boolean;
  /** Missed its band even after both stretch tiers: the candidate closest to the target was written anyway. */
  outOfBand: boolean;
  handTuned?: true;
  moveLimit: number;
  starMoves: { two: number; three: number } | null;
  goals: string;
  /** Tuned levels only: which candidate won, at what pressure, out of how many tried. */
  candidate?: number;
  pressure?: number;
  candidatesTried?: number;
  /** Dead boards in games played on to the recipe's most moves. */
  deadBoardsToMostMoves?: number;
  /** Why tuning stopped: see TuneEnd. */
  searchEnd?: TuneEnd;
  /** Whether the tuner had to stretch the recipe, the tier (0 none, 1, 2), and the ranges it built from. */
  stretched?: boolean;
  tier?: 0 | 1 | 2;
  stretch?: Stretch;
  fingerprint: string;
  fileHash: string;
}

export interface BuildOutcome {
  rows: BuildRow[];
  /** Built levels written although out of band. They do not fail the build. */
  outOfBand: number[];
  /** Built levels with a dead board in any game: they fail the build. */
  deadBoards: number[];
  /** validate-levels failures among the built levels: they fail the build. */
  invalid: string[];
  failed: boolean;
  reused: number;
  tuned: number;
  measured: number;
}

export async function runBuild(settings: BuildSettings, run: JobRunner, log: (line: string) => void): Promise<BuildOutcome> {
  const codeHash = sourceHash();
  const previous = readPreviousRows(settings.out);
  const rows = new Map<number, BuildRow>(previous);
  const fingerprints = new Map<number, string>();
  const jobs: LevelJob[] = [];
  let reused = 0;

  mkdirSync(settings.levelsDir, { recursive: true });
  for (const levelId of settings.levelIds) {
    const file = levelFile(settings.levelsDir, levelId);
    const text = existsSync(file) ? readFileSync(file, "utf8") : undefined;
    const existing = text === undefined ? undefined : (JSON.parse(text) as LevelDefinition);
    const handTuned = existing?.handTuned === true;
    const name = handTuned ? existing!.name : levelName(levelId);
    const fingerprint = handTuned
      ? hash({ kind: "measure", file: text, games: settings.games, bot: settings.bot, codeHash })
      : hash({ kind: "tune", recipe: recipeForLevel(levelId), levelId, name, games: settings.games, searchGames: settings.searchGames, candidates: settings.candidates, bot: settings.bot, tolerance: BAND_TOLERANCE, codeHash });
    fingerprints.set(levelId, fingerprint);
    const prior = previous.get(levelId);
    if (prior && prior.fingerprint === fingerprint && text !== undefined && prior.fileHash === hash(text)) {
      reused += 1;
      continue;
    }
    jobs.push(
      handTuned
        ? { kind: "measure", level: normalizeLevel(existing!), games: settings.games }
        : { kind: "tune", levelId, name, games: settings.games, searchGames: settings.searchGames, candidates: settings.candidates }
    );
  }

  log(`${settings.levelIds.length} levels: ${reused} reused, ${jobs.length} to play (${jobs.filter((job) => job.kind === "measure").length} hand-tuned to measure).`);
  const started = Date.now();
  await run(jobs, (done, finished) => {
    const levelId = done.levelId;
    const file = levelFile(settings.levelsDir, levelId);
    let row: BuildRow;
    if (done.kind === "tune") {
      const text = levelJson(done.result.level);
      if (!existsSync(file) || readFileSync(file, "utf8") !== text) writeFileSync(file, text);
      row = rowFor(done.result.level, done.result.report, done.result.inBand, fingerprints.get(levelId)!, hash(text), done.result);
    } else {
      const text = readFileSync(file, "utf8");
      const level = normalizeLevel(JSON.parse(text) as LevelDefinition);
      row = rowFor(level, done.report, acceptsCandidate(done.report, levelId), fingerprints.get(levelId)!, hash(text));
    }
    rows.set(levelId, row);
    writeReport(settings, rows);
    const elapsed = (Date.now() - started) / 1000;
    const eta = (elapsed / finished) * (jobs.length - finished);
    log(
      `  ${String(finished).padStart(3)}/${jobs.length} level ${levelId}: fail ${row.failRate.toFixed(3)} target ${row.target.toFixed(3)} ` +
        `${row.inBand ? "in band" : "OUT OF BAND"}, ${row.moveLimit} moves, ${row.goals}` +
        (row.stretched
          ? `, tier ${row.tier} step ${row.stretch!.step} (moves ${row.stretch!.moves.join("-")}, cells ${row.stretch!.blockedCells.join("-")}, panes ${row.stretch!.paneLayers.join("-")})`
          : "") +
        (row.candidatesTried === undefined ? " (hand-tuned)" : `, candidate ${row.candidate! + 1} of ${row.candidatesTried} tried`) +
        ` | ${elapsed.toFixed(0)}s, about ${eta.toFixed(0)}s left`
    );
  });
  const report = writeReport(settings, rows);
  log(report.summary);

  const built = settings.levelIds.map((id) => rows.get(id)!);
  for (const row of built) {
    if (row.handTuned && !row.inBand) log(`  Note: hand-tuned level ${row.id} is out of band (fail ${row.failRate}, target ${row.target.toFixed(3)}).`);
    else if (row.outOfBand) log(`  Out of band, closest written: level ${row.id} fail ${row.failRate} target ${row.target.toFixed(3)}, tier ${row.tier}, ${row.searchEnd}.`);
  }
  const tunedRows = built.filter((row) => !row.handTuned);
  const deadBoards = tunedRows.filter((row) => row.deadBoards > 0 || (row.deadBoardsToMostMoves ?? 0) > 0).map((row) => row.id);
  const invalid = validateBuilt(settings.levelsDir, tunedRows.map((row) => row.id));
  for (const line of invalid) log(`  Invalid: ${line}`);
  return {
    rows: built,
    outOfBand: tunedRows.filter((row) => row.outOfBand).map((row) => row.id),
    deadBoards,
    invalid,
    failed: deadBoards.length > 0 || invalid.length > 0,
    reused,
    tuned: jobs.filter((job) => job.kind === "tune").length,
    measured: jobs.filter((job) => job.kind === "measure").length
  };
}

function rowFor(level: LevelDefinition, report: LevelReport, inBand: boolean, fingerprint: string, fileHash: string, tuned?: TuneResult): BuildRow {
  const goals = level.objectives.map((goal) => `${goal.id}:${goal.target}${goal.tileType ? `:${goal.tileType}` : ""}`).join(",");
  return {
    id: level.id,
    name: level.name,
    sector: Math.ceil(level.id / 10),
    target: round(targetFailRate(level.id)),
    inBand,
    outOfBand: !inBand,
    ...(tuned ? {} : { handTuned: true as const }),
    moveLimit: level.moveLimit,
    starMoves: level.starMoves ?? null,
    goals,
    ...(tuned
      ? {
          candidate: tuned.details.candidate,
          pressure: round(tuned.details.pressure),
          candidatesTried: tuned.details.candidatesTried,
          deadBoardsToMostMoves: tuned.details.deadBoards,
          searchEnd: tuned.details.end,
          stretched: tuned.details.stretch.step > 0,
          tier: tuned.details.stretch.tier,
          stretch: tuned.details.stretch
        }
      : {}),
    games: report.games,
    failRate: report.failRate,
    avgMovesLeft: report.avgMovesLeft,
    starSpread: report.starSpread,
    firstWinCoins: report.firstWinCoins,
    deadBoards: report.deadBoards,
    winMovesLeft: report.winMovesLeft,
    fingerprint,
    fileHash
  };
}

function writeReport(settings: BuildSettings, rows: Map<number, BuildRow>) {
  const sorted = [...rows.values()].sort((left, right) => left.id - right.id);
  const sectors = sectorSummary(sorted);
  const inBand = sorted.filter((row) => row.inBand).length;
  const outOfBand = sorted.filter((row) => row.outOfBand).length;
  const dead = sorted.filter((row) => row.deadBoards > 0 || (row.deadBoardsToMostMoves ?? 0) > 0).length;
  const moveSteps = moveLimitSteps(new Map([[1, sectorOneMedian()], ...sectors.map((sector) => [sector.sector, sector.medianMoveLimit] as [number, number])]));
  const flagged = moveSteps.filter((step) => step.overSix);
  const summary =
    `${inBand}/${sorted.length} levels in band, ${outOfBand} out of band (closest candidate written), ${dead} with dead boards. ` +
    `First-win coins by sector (sum of each level's average first-win coins): ` +
    sectors.map((sector) => `${sector.sector}: ${sector.firstWinCoins}`).join(", ") +
    `. Median move-limit steps over 6 between neighbouring sectors: ` +
    (flagged.length === 0 ? "none" : flagged.map((step) => `${step.from}->${step.to} (${step.fromMedian} to ${step.toMedian})`).join(", ")) +
    ".";
  const report = {
    bot: { ...settings.bot, lookahead: "greedy, one move" },
    games: settings.games,
    searchGames: settings.searchGames,
    candidates: settings.candidates,
    tolerance: BAND_TOLERANCE,
    levels: rangeText(sorted.map((row) => row.id)),
    notes: [
      "Built by `npm run levels -- build`. Engine seed is levelSeed(levelId), as in real play; game i uses bot seed gameSeed(levelId, i).",
      "No bought power-ups, no Play On, boss timers ignored. A board the engine cannot shuffle is a loss (deadBoards).",
      "inBand: failRate inside the level's band (ends included) and within tolerance of target, with no dead board; for tuned levels also none in games played on to the recipe's most moves.",
      "stretch: tier 0 is the recipe as written. Tier 1 (steps 1-3) takes 2 moves off a step and adds a sixth to the blocked cells, to -6 moves and x1.5. Tier 2 (steps 4-6), tried only when tier 1 cannot reach the band, adds a pane layer (max 3) and goes on to a fewest-moves limit of 12 and x2 cells.",
      "outOfBand: the level missed its band after both tiers and the candidate closest to its target was written. It does not fail the build; dead boards and invalid levels do.",
      "starMoves: two at the median and three at the 75th percentile of moves left in wins; null means the default 20% / 50% rule.",
      "fingerprint and fileHash let a rerun reuse a row; a hand-tuned level is measured, never rewritten.",
      "searchEnd: why tuning stopped. stretchRanOut: still too easy at the last stretch step. searchRanOut: the closest result at a step was too hard or had dead boards, so stretching further could not help.",
      "moveLimitSteps: the median built moveLimit of each sector (sector 1 read from public/levels) and the step to the next sector; overSix flags a step over 6. It does not fail the build."
    ],
    summary,
    moveLimitSteps: moveSteps,
    sectors,
    rows: sorted
  };
  mkdirSync(path.dirname(path.resolve(settings.out)), { recursive: true });
  writeFileSync(settings.out, reportJson(report));
  return report;
}

function sectorSummary(rows: BuildRow[]) {
  const sectors = new Map<number, BuildRow[]>();
  for (const row of rows) sectors.set(row.sector, [...(sectors.get(row.sector) ?? []), row]);
  return [...sectors.entries()].map(([sector, sectorRows]) => {
    const mean = (pick: (row: BuildRow) => number) => round(sectorRows.reduce((total, row) => total + pick(row), 0) / sectorRows.length);
    return {
      sector,
      levels: rangeText(sectorRows.map((row) => row.id)),
      inBand: `${sectorRows.filter((row) => row.inBand).length}/${sectorRows.length}`,
      outOfBand: sectorRows.filter((row) => row.outOfBand).map((row) => row.id),
      target: mean((row) => row.target),
      failRate: mean((row) => row.failRate),
      avgMovesLeft: mean((row) => row.avgMovesLeft),
      moveLimits: rangeText([...new Set(sectorRows.map((row) => row.moveLimit))].sort((left, right) => left - right)),
      medianMoveLimit: median(sectorRows.map((row) => row.moveLimit)),
      stretched: sectorRows.filter((row) => row.stretched).map((row) => row.id),
      firstWinCoins: Math.round(sectorRows.reduce((total, row) => total + row.firstWinCoins, 0)),
      deadBoards: sectorRows.reduce((total, row) => total + row.deadBoards, 0)
    };
  });
}

export interface MoveLimitStep {
  from: number;
  to: number;
  fromMedian: number;
  toMedian: number;
  step: number;
  overSix: boolean;
}

/** Steps between the median move limits of neighbouring sectors (n and n + 1, both present); over 6 is flagged. */
export function moveLimitSteps(medians: Map<number, number>): MoveLimitStep[] {
  const steps: MoveLimitStep[] = [];
  for (const sector of [...medians.keys()].sort((left, right) => left - right)) {
    const next = medians.get(sector + 1);
    if (next === undefined) continue;
    const fromMedian = medians.get(sector)!;
    const step = round(Math.abs(next - fromMedian));
    steps.push({ from: sector, to: sector + 1, fromMedian, toMedian: next, step, overSix: step > 6 });
  }
  return steps;
}

/** Median move limit of the hand-made levels 1-10, from public/levels. */
function sectorOneMedian(root = process.cwd()): number {
  return median(Array.from({ length: 10 }, (_, index) => (JSON.parse(readFileSync(levelFile(path.join(root, "public/levels"), index + 1), "utf8")) as LevelDefinition).moveLimit));
}

export function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function readPreviousRows(out: string): Map<number, BuildRow> {
  const rows = new Map<number, BuildRow>();
  if (!existsSync(out)) return rows;
  try {
    const report = JSON.parse(readFileSync(out, "utf8")) as { rows?: BuildRow[] };
    for (const row of report.rows ?? []) if (typeof row.fingerprint === "string") rows.set(row.id, row);
  } catch {
    // An unreadable report is rebuilt from scratch.
  }
  return rows;
}

/** Runs validate-levels on just the built levels, in a scratch copy. Returns its FAIL lines. */
function validateBuilt(levelsDir: string, levelIds: number[]): string[] {
  if (levelIds.length === 0) return [];
  const dir = mkdtempSync(path.join(tmpdir(), "levels-build-"));
  try {
    for (const levelId of levelIds) copyFileSync(levelFile(levelsDir, levelId), levelFile(dir, levelId));
    const run = spawnSync(process.execPath, [path.resolve(process.cwd(), "scripts/validate-levels.mjs"), dir], { encoding: "utf8" });
    const failures = run.stdout.split("\n").filter((line) => line.startsWith("FAIL "));
    if (run.status !== 0 && failures.length === 0) return [`validate-levels exited ${run.status}: ${run.stderr.trim()}`];
    return failures;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Everything that plays, measures or builds a level. Recipes and names are hashed per level instead. */
function sourceHash(root = process.cwd()): string {
  const files = [
    ...readdirSync(path.join(root, "src/engine")).filter((file) => file.endsWith(".ts")).sort().map((file) => `src/engine/${file}`),
    "src/state/progress.ts",
    "src/data/levels.ts",
    "src/data/stars.ts",
    "src/data/store.ts",
    ...["bands", "bot", "buildLevel", "report", "tune"].map((name) => `scripts/levels/${name}.ts`)
  ];
  const digest = createHash("sha256");
  for (const file of files) digest.update(`${file}\n`).update(readFileSync(path.join(root, file)));
  return digest.digest("hex").slice(0, 16);
}

function hash(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export function levelFile(levelsDir: string, levelId: number): string {
  return path.join(levelsDir, `level_${String(levelId).padStart(3, "0")}.json`);
}

/** A level file in the same layout as the hand-made ones: two-space JSON and a final newline. */
export function levelJson(level: LevelDefinition): string {
  return `${JSON.stringify(level, null, 2)}\n`;
}

/** Report JSON with number lists (star spreads, moves left per win) kept on one line. */
export function reportJson(report: unknown): string {
  const json = JSON.stringify(report, null, 2).replace(/\[\s+(-?[\d.]+(?:,\s+-?[\d.]+)*)\s+\]/g, (_match, list: string) => `[${list.split(/,\s+/).join(", ")}]`);
  return `${json}\n`;
}

function rangeText(ids: number[]): string {
  const parts: string[] = [];
  for (let index = 0; index < ids.length; index += 1) {
    let end = index;
    while (end + 1 < ids.length && ids[end + 1] === ids[end] + 1) end += 1;
    parts.push(end === index ? String(ids[index]) : `${ids[index]}-${ids[end]}`);
    index = end;
  }
  return parts.join(",");
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
