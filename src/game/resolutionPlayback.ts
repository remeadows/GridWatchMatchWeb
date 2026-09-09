import type { BoardResolutionStep, GridPosition } from "../engine";

export interface CascadeFrameAudit {
  beforeIds: number[];
  moveIds: number[];
  spawnIds: number[];
  missingMoveIds: number[];
}

export interface ResolutionFrameAudit {
  sequenceId: number;
  ordinal: number;
  kind: BoardResolutionStep["kind"];
  cascadeDepth: number;
  atMs: number;
  beforeIds: number[];
  spawnIds: number[];
  expected: { position: GridPosition; occupantId: number }[];
  rendered: { position: GridPosition; occupantId: number; instanceId: number; visible: boolean; distanceFromCenter: number }[];
}

export class ResolutionPlayback {
  private index = 0;
  private started = false;
  private cancelled = false;
  private finished = false;
  private waiting = false;
  private draining = false;

  constructor(
    private readonly steps: readonly BoardResolutionStep[],
    private readonly play: (step: BoardResolutionStep, done: () => void) => void,
    private readonly complete: () => void
  ) {}

  start(): void {
    if (this.started || this.cancelled) return;
    this.started = true;
    this.drain();
  }

  cancel(): void {
    this.cancelled = true;
  }

  private drain(): void {
    if (this.draining || this.cancelled || this.finished) return;
    this.draining = true;
    try {
      while (!this.waiting && !this.cancelled && this.index < this.steps.length) {
        this.waiting = true;
        let completed = false;
        this.play(this.steps[this.index], () => {
          if (completed || this.cancelled) return;
          completed = true;
          this.index++;
          this.waiting = false;
          this.drain();
        });
      }
      if (!this.cancelled && this.index === this.steps.length) {
        this.finished = true;
        this.complete();
      }
    } finally {
      this.draining = false;
    }
  }
}
