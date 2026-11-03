// Level tools. `npm run levels -- report --levels 1-100 --games 200 --out <file>` has the test bot play every level
// and writes the difficulty report. Games run in worker threads, one per core; the result does not depend on how
// many workers ran, because game i of a level always uses the same seed.
import { mkdirSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { areaForLevel } from "../../src/data/areas";
import { DEFAULT_BOT, type BotOptions, type GameResult } from "./bot";
import { playGames, readLevelFile, summarizeLevel, type LevelReport } from "./report";

interface Chunk {
  levelId: number;
  start: number;
  count: number;
}

interface WorkerSetup {
  role: "levels-worker";
  options: BotOptions;
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
  if (command !== "report") throw new Error(usage());
  const args = parseArgs(rest);
  const levelIds = parseRange(args.levels ?? "1-100");
  const games = parseCount(args.games ?? "200", "--games");
  const workers = Math.min(parseCount(args.workers ?? String(availableParallelism()), "--workers"), levelIds.length * Math.ceil(games / chunkSize));
  const options: BotOptions = { mistakeRate: args["mistake-rate"] === undefined ? DEFAULT_BOT.mistakeRate : Number(args["mistake-rate"]) };
  if (!(options.mistakeRate >= 0 && options.mistakeRate <= 1)) throw new Error("--mistake-rate must be between 0 and 1");
  const out = args.out;
  if (!out) throw new Error(usage());

  const levels = new Map(levelIds.map((id) => [id, readLevelFile(id)]));
  const chunks: Chunk[] = [];
  for (const levelId of levelIds) {
    for (let start = 0; start < games; start += chunkSize) chunks.push({ levelId, start, count: Math.min(chunkSize, games - start) });
  }

  const started = Date.now();
  console.error(`Playing ${levelIds.length} levels x ${games} games on ${workers} workers (mistake rate ${options.mistakeRate}).`);
  const done = await runChunks(chunks, workers, options, (finished) => {
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
  // Number lists (star spreads, moves left per win) stay on one line so the file reads as one block per level.
  const json = JSON.stringify(report, null, 2).replace(/\[\s+(-?[\d.]+(?:,\s+-?[\d.]+)*)\s+\]/g, (_match, list: string) => `[${list.split(/,\s+/).join(", ")}]`);
  writeFileSync(out, `${json}\n`);
  console.error(`Wrote ${rows.length} rows to ${out} in ${seconds.toFixed(0)}s.`);
}

function runChunks(chunks: Chunk[], workerCount: number, options: BotOptions, onProgress: (finished: number) => void): Promise<ChunkResult[]> {
  return new Promise((resolve, reject) => {
    const results: ChunkResult[] = [];
    let next = 0;
    let live = 0;
    let failed = false;
    const workers: Worker[] = [];
    const feed = (worker: Worker) => {
      if (next < chunks.length) {
        worker.postMessage(chunks[next]);
        next += 1;
      } else {
        live -= 1;
        void worker.terminate();
        if (live === 0 && !failed) resolve(results);
      }
    };
    for (let index = 0; index < workerCount; index += 1) {
      const setup: WorkerSetup = { role: "levels-worker", options };
      const worker = new Worker(fileURLToPath(import.meta.url), { workerData: setup });
      workers.push(worker);
      live += 1;
      worker.on("message", (message: ChunkResult) => {
        results.push(message);
        onProgress(results.length);
        feed(worker);
      });
      worker.on("error", (error) => {
        failed = true;
        for (const other of workers) void other.terminate();
        reject(error);
      });
      feed(worker);
    }
  });
}

function runWorker(setup: WorkerSetup): void {
  const levels = new Map<number, ReturnType<typeof readLevelFile>>();
  parentPort!.on("message", (chunk: Chunk) => {
    let level = levels.get(chunk.levelId);
    if (!level) {
      level = readLevelFile(chunk.levelId);
      levels.set(chunk.levelId, level);
    }
    const result: ChunkResult = { chunk, results: playGames(level, chunk.start, chunk.count, setup.options) };
    parentPort!.postMessage(result);
  });
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
  return "Usage: npm run levels -- report --levels 1-100 --games 200 --out <file> [--workers N] [--mistake-rate 0.2]";
}
