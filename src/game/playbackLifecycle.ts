import type { BoardResolutionStep, BoardSnapshot } from "../engine";
import { PLAYBACK_RECOVERY_GRACE_MS } from "../data/gameplayTiming";

interface TerminalTiming {
  rows: number;
  leadMs: number;
  staggerMs: number;
  popMs: number;
  holdMs: number;
}

export class TerminalPlayback {
  private lastAtMs: number;
  private elapsedMs = 0;
  private paused = false;
  private done = false;
  private nextRow = 0;
  private nextRowAtMs: number;
  private finishAtMs: number;

  constructor(now: number, private readonly timing: TerminalTiming) {
    this.lastAtMs = now;
    this.nextRowAtMs = timing.leadMs;
    this.finishAtMs = timing.leadMs + Math.max(0, timing.rows - 1) * timing.staggerMs + timing.popMs + timing.holdMs;
  }

  private advance(now: number): void {
    const at = Number.isFinite(now) ? Math.max(this.lastAtMs, now) : this.lastAtMs;
    if (!this.paused) this.elapsedMs += at - this.lastAtMs;
    this.lastAtMs = at;
  }

  setPaused(paused: boolean, now: number): void {
    this.advance(now);
    this.paused = paused;
  }

  cancel(): void { this.done = true; }

  update(now: number): { rowIndex: number | null; complete: boolean } {
    this.advance(now);
    if (this.done || this.paused) return { rowIndex: null, complete: false };
    if (this.nextRow < this.timing.rows && this.elapsedMs >= this.nextRowAtMs) {
      const rowIndex = this.nextRow++;
      // A delayed frame may extend the ending, but must never collapse its rows.
      this.nextRowAtMs = Math.max(this.timing.leadMs + this.nextRow * this.timing.staggerMs,
        this.elapsedMs + this.timing.popMs);
      if (this.nextRow === this.timing.rows) this.finishAtMs = Math.max(this.finishAtMs,
        this.elapsedMs + this.timing.popMs + this.timing.holdMs);
      return { rowIndex, complete: false };
    }
    if (this.nextRow === this.timing.rows && this.elapsedMs >= this.finishAtMs) {
      this.done = true;
      return { rowIndex: null, complete: true };
    }
    return { rowIndex: null, complete: false };
  }
}

export class PlaybackLifecycle<T> {
  private queue: T[] = [];
  private currentId: number | null = null;
  private lastId = 0;
  private stopped = false;
  private suspended = false;

  get activeId(): number | null { return this.currentId; }
  get queueDepth(): number { return this.queue.length; }

  enqueue(action: T): boolean {
    if (this.stopped || this.queue.length >= 3) return false;
    this.queue.push(action);
    return true;
  }

  next(): T | undefined {
    if (this.stopped || this.suspended || this.currentId !== null) return undefined;
    return this.queue.shift();
  }

  begin(id: number): boolean {
    if (this.stopped || this.currentId !== null || id <= this.lastId) return false;
    this.currentId = id;
    this.lastId = id;
    return true;
  }

  complete(id: number): boolean {
    if (id !== this.currentId) return false;
    this.currentId = null;
    return true;
  }

  suspend(value: boolean): void { this.suspended = value; }

  stop(): void {
    this.stopped = true;
    this.queue = [];
  }

  reset(): void {
    this.currentId = null;
    this.queue = [];
    this.stopped = false;
    this.suspended = false;
  }
}

export interface PlayClock {
  remainingMs: number;
  lastAtMs: number;
  running: boolean;
}

export function advancePlayClock(clock: PlayClock, now: number, running: boolean): PlayClock {
  const at = Number.isFinite(now) ? Math.max(clock.lastAtMs, now) : clock.lastAtMs;
  const remainingMs = Math.max(0, clock.remainingMs - (clock.running ? at - clock.lastAtMs : 0));
  return { remainingMs, lastAtMs: at, running: running && remainingMs > 0 };
}

export type PlaybackHud = Pick<BoardSnapshot, "moveCount" | "moveLimit" | "objectiveProgress"> & { score: number };

export function playbackHudAtStep(
  steps: readonly BoardResolutionStep[], ordinal: number, initialScore: number, finalScore: number
): PlaybackHud | null {
  const step = steps.find(candidate => candidate.ordinal === ordinal);
  const final = steps.at(-1);
  if (!step || !final) return null;
  const total = steps.reduce((sum, candidate) => sum + candidate.clears.length, 0);
  const shown = steps.reduce((sum, candidate) => sum + (candidate.ordinal <= ordinal ? candidate.clears.length : 0), 0);
  // Allocate the already-authoritative total across visible clears, never rescore a move.
  const fraction = step.kind === "settled" ? 1 : total > 0 ? shown / total : 0;
  return {
    moveCount: step.after.moveCount,
    moveLimit: step.after.moveLimit,
    objectiveProgress: Object.fromEntries(Object.entries(step.after.objectiveProgress)
      .map(([key, value]) => [key, Math.max(0, Math.min(value, final.after.objectiveProgress[key] ?? 0))])),
    score: Math.min(finalScore, initialScore + Math.floor(Math.max(0, finalScore - initialScore) * fraction))
  };
}

export function playbackRecoveryBudgetMs(
  steps: readonly BoardResolutionStep[], costs: Record<BoardResolutionStep["kind"], number>
): number {
  return PLAYBACK_RECOVERY_GRACE_MS + 2 * Math.max(costs.action,
    steps.reduce((sum, step) => sum + costs[step.kind], 0));
}
