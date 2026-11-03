// Level tools. Games run in worker threads, one per core; results do not depend on how many workers ran, because
// game i of a level always uses the same seed.
// `npm run levels -- report --levels 1-100 --games 200 --out <file>` has the test bot play every level and writes
// the difficulty report.
// `npm run levels -- build --levels 11-200 --games 200 --out <report>` tunes levels from their sector recipes into
// public/levels (or --levels-dir) and writes the build report. A level that misses its band is written as the closest
// candidate and marked, as is a level whose recipe never deals MIN_OPENING_MOVES opening moves; the build exits 1 only
// for dead boards or levels that fail validation.
import { mkdirSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";
import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { areaForLevel } from "../../src/data/areas";
import { DEFAULT_BOT, type BotOptions, type GameResult } from "./bot";
import { reportJson, runBuild, runLevelJob, type LevelJob, type LevelJobResult } from "./build";
import { runJobs, type WorkerSetup } from "./pool";
import { MIN_OPENING_MOVES } from "./tune";
import { playGames, readLevelFile, summarizeLevel, type LevelReport } from "./report";

interface Chunk {
  kind: "games";
  levelId: number;
  start: number;
  count: number;
}

interface ChunkResult {
  chunk: Chunk;
  results: GameResult[];
}

const chunkSize = 10;

if (!isMainThread && (workerData as WorkerSetup | undefined)?.role === "levels-worker") {
  runWorker(workerData as WorkerSetup);
} else if (isMainThread) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  if (command === "build") return build(parseArgs(rest));
  if (command !== "report") throw new Error(usage());
  const args = parseArgs(rest);
  const levelIds = parseRange(args.levels ?? "1-100");
  const games = parseCount(args.games ?? "200", "--games");
  const workers = Math.min(parseCount(args.workers ?? String(availableParallelism()), "--workers"), levelIds.length * Math.ceil(games / chunkSize));
  const options = botOptions(args);
  const out = args.out;
  if (!out) throw new Error(usage());

  const levels = new Map(levelIds.map((id) => [id, readLevelFile(id)]));
  const chunks: Chunk[] = [];
  for (const levelId of levelIds) {
    for (let start = 0; start < games; start += chunkSize) chunks.push({ kind: "games", levelId, start, count: Math.min(chunkSize, games - start) });
  }

  const started = Date.now();
  console.error(`Playing ${levelIds.length} levels x ${games} games on ${workers} workers (mistake rate ${options.mistakeRate}).`);
  const done = await runJobs<Chunk, ChunkResult>(chunks, workers, options, (_result, finished) => {
    if (finished % 50 !== 0 && finished !== chunks.length) return;
    const elapsed = (Date.now() - started) / 1000;
    const eta = (elapsed / finished) * (chunks.length - finished);
    console.error(`  ${finished}/${chunks.length} chunks, ${elapsed.toFixed(0)}s elapsed, about ${eta.toFixed(0)}s left`);
  });

  const rows: LevelReport[] = levelIds.map((id) => {
    const results = done
      .filter((entry) => entry.chunk.levelId === id)
      .sort((left, right) => left.chunk.start - right.chunk.start)
      .flatMap((entry) => entry.results);
    return summarizeLevel(levels.get(id)!, results);
  });
  const seconds = (Date.now() - started) / 1000;
  const report = {
    generatedAt: new Date().toISOString(),
    bot: { ...options, lookahead: "greedy, one move" },
    games,
    levels: args.levels ?? "1-100",
    workers,
    seconds: Math.round(seconds),
    notes: [
      "Engine seed is levelSeed(levelId), as in real play; game i uses bot seed gameSeed(levelId, i).",
      "No bought power-ups, no Play On, boss timers ignored. A board the engine cannot shuffle is a loss (deadBoards).",
      "failRate: share of games lost. avgMovesLeft: over all games, a loss counts 0. winMovesLeft: moves left in each win.",
      "starSpread: wins with 1, 2, 3 stars. firstWinCoins: average first-win coins over the wins."
    ],
    sectors: sectorSummary(rows),
    rows
  };
  mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  writeFileSync(out, reportJson(report));
  console.error(`Wrote ${rows.length} rows to ${out} in ${seconds.toFixed(0)}s.`);
}

async function build(args: Record<string, string>): Promise<void> {
  const out = args.out;
  if (!out) throw new Error(usage());
  const levelIds = parseRange(args.levels ?? "11-200");
  if (levelIds[0] < 11 || levelIds[levelIds.length - 1] > 200) throw new Error("build makes levels 11 to 200; levels 1-10 are hand-made.");
  const options = botOptions(args);
  const workers = parseCount(args.workers ?? String(availableParallelism()), "--workers");
  const settings = {
    levelIds,
    games: parseCount(args.games ?? "200", "--games"),
    searchGames: parseCount(args["search-games"] ?? "40", "--search-games"),
    candidates: parseCount(args.candidates ?? "12", "--candidates"),
    bot: options,
    levelsDir: path.resolve(args["levels-dir"] ?? "public/levels"),
    out
  };
  const started = Date.now();
  console.error(`Building ${levelIds.length} levels into ${settings.levelsDir} on up to ${workers} workers (mistake rate ${options.mistakeRate}).`);
  const outcome = await runBuild(settings, (jobs, onResult) => runJobs<LevelJob, LevelJobResult>(jobs, workers, options, onResult), (line) => console.error(line));
  console.error(`Done in ${((Date.now() - started) / 1000).toFixed(0)}s: ${outcome.tuned} tuned, ${outcome.measured} hand-tuned measured, ${outcome.reused} reused. Report: ${out}`);
  if (outcome.outOfBand.length > 0) console.error(`Out of band, closest written (does not fail the build): ${outcome.outOfBand.join(", ")}.`);
  if (outcome.deadBoards.length > 0) console.error(`Dead boards: ${outcome.deadBoards.join(", ")}.`);
  if (outcome.openingShort.length > 0) console.error(`Fewer than ${MIN_OPENING_MOVES} opening moves, closest written (does not fail the build): ${outcome.openingShort.join(", ")}.`);
  if (outcome.invalid.length > 0) console.error(`Invalid levels:\n  ${outcome.invalid.join("\n  ")}`);
  if (outcome.failed) process.exitCode = 1;
}

function runWorker(setup: WorkerSetup): void {
  const levels = new Map<number, ReturnType<typeof readLevelFile>>();
  parentPort!.on("message", (job: Chunk | LevelJob) => {
    try {
      if (job.kind === "games") {
        let level = levels.get(job.levelId);
        if (!level) {
          level = readLevelFile(job.levelId);
          levels.set(job.levelId, level);
        }
        const result: ChunkResult = { chunk: job, results: playGames(level, job.start, job.count, setup.options) };
        parentPort!.postMessage({ result });
      } else {
        parentPort!.postMessage({ result: runLevelJob(job, setup.options) });
      }
    } catch (error) {
      parentPort!.postMessage({ error: error instanceof Error ? (error.stack ?? error.message) : String(error) });
    }
  });
}

function botOptions(args: Record<string, string>): BotOptions {
  const options: BotOptions = { mistakeRate: args["mistake-rate"] === undefined ? DEFAULT_BOT.mistakeRate : Number(args["mistake-rate"]) };
  if (!(options.mistakeRate >= 0 && options.mistakeRate <= 1)) throw new Error("--mistake-rate must be between 0 and 1");
  return options;
}

function sectorSummary(rows: LevelReport[]) {
  const sectors = new Map<number, LevelReport[]>();
  for (const row of rows) {
    const sector = areaForLevel(row.id).id;
    sectors.set(sector, [...(sectors.get(sector) ?? []), row]);
  }
  return [...sectors.entries()].map(([sector, sectorRows]) => {
    const games = sectorRows.reduce((total, row) => total + row.games, 0);
    const weighted = (pick: (row: LevelReport) => number) =>
      Math.round((sectorRows.reduce((total, row) => total + pick(row) * row.games, 0) / Math.max(1, games)) * 10_000) / 10_000;
    const first = sectorRows[0].id;
    const last = sectorRows[sectorRows.length - 1].id;
    return {
      sector,
      levels: first === last ? String(first) : `${first}-${last}`,
      failRate: weighted((row) => row.failRate),
      avgMovesLeft: weighted((row) => row.avgMovesLeft),
      deadBoards: sectorRows.reduce((total, row) => total + row.deadBoards, 0)
    };
  });
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag.startsWith("--") || value === undefined || value.startsWith("--")) throw new Error(`Bad argument ${flag}.\n${usage()}`);
    args[flag.slice(2)] = value;
    index += 1;
  }
  return args;
}

function parseRange(text: string): number[] {
  const ids = new Set<number>();
  for (const part of text.split(",")) {
    const match = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!match) throw new Error(`Bad --levels ${text}: use a list of ids and ranges such as 1-100 or 41,60-62`);
    const first = Number(match[1]);
    const last = Number(match[2] ?? match[1]);
    if (first < 1 || last < first) throw new Error(`Bad --levels range ${part}`);
    for (let id = first; id <= last; id += 1) ids.add(id);
  }
  return [...ids].sort((left, right) => left - right);
}

function parseCount(text: string, flag: string): number {
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${flag} must be a whole number of at least 1`);
  return value;
}

function usage(): string {
  return [
    "Usage: npm run levels -- report --levels 1-100 --games 200 --out <file> [--workers N] [--mistake-rate 0.2]",
    "       npm run levels -- build --levels 11-200 --games 200 --out <report> [--levels-dir public/levels] [--search-games 40] [--candidates 12] [--workers N] [--mistake-rate 0.2]"
  ].join("\n");
}
