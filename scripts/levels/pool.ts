// A pool of worker threads running jobs from the bundled level CLI. Each worker is the CLI file itself, started
// with `workerData.role === "levels-worker"`; cli.ts routes a job to its handler by `kind`. Results come back in
// finishing order: callers sort them, so the outcome never depends on how many workers ran.
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { BotOptions } from "./bot";

export interface WorkerSetup {
  role: "levels-worker";
  options: BotOptions;
}

export function runJobs<Job, Result>(jobs: Job[], workerCount: number, options: BotOptions, onResult: (result: Result, finished: number) => void): Promise<Result[]> {
  return new Promise((resolve, reject) => {
    const results: Result[] = [];
    if (jobs.length === 0) {
      resolve(results);
      return;
    }
    let next = 0;
    let live = 0;
    let failed = false;
    const workers: Worker[] = [];
    const retired = new Set<Worker>();
    const fail = (error: unknown) => {
      if (failed) return;
      failed = true;
      for (const other of workers) void other.terminate();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const feed = (worker: Worker) => {
      if (next < jobs.length) {
        worker.postMessage(jobs[next]);
        next += 1;
      } else {
        live -= 1;
        retired.add(worker);
        void worker.terminate();
        if (live === 0 && !failed) resolve(results);
      }
    };
    for (let index = 0; index < Math.max(1, Math.min(workerCount, jobs.length)); index += 1) {
      const setup: WorkerSetup = { role: "levels-worker", options };
      const worker = new Worker(fileURLToPath(import.meta.url), { workerData: setup });
      workers.push(worker);
      live += 1;
      worker.on("message", (message: { error?: string; result?: Result }) => {
        if (message.error !== undefined) {
          fail(new Error(message.error));
          return;
        }
        results.push(message.result as Result);
        try {
          onResult(message.result as Result, results.length);
        } catch (error) {
          fail(error);
          return;
        }
        feed(worker);
      });
      worker.on("error", fail);
      worker.on("exit", (code) => {
        // A worker that stops before it is retired would leave its job unfinished and the pool waiting forever.
        if (!retired.has(worker)) fail(new Error(`A level worker stopped unexpectedly with code ${code}.`));
      });
      feed(worker);
    }
  });
}
