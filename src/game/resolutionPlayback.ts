import type { BoardPowerUpActivation, BoardResolutionStep, GridPosition } from "../engine";
import { canonicalComboKey, type PowerUpPresentationGroup } from "./presentation";

export interface ResolutionPowerUpGroup extends PowerUpPresentationGroup {
  activationId: string;
  parentActivationId: string | null;
}

export function groupResolutionPowerUps(
  activations: readonly BoardPowerUpActivation[],
  presented: Set<string>
): ResolutionPowerUpGroup[] {
  const groups = new Map<string, ResolutionPowerUpGroup>();
  for (const activation of activations) {
    if (activation.isRepeat || presented.has(activation.activationId)) continue;
    const previous = groups.get(activation.activationId);
    groups.set(activation.activationId, {
      activationId: activation.activationId,
      parentActivationId: activation.parentActivationId,
      kind: activation.kind === "combo" ? "combo" : "single",
      key: activation.kind === "combo"
        ? canonicalComboKey(activation.sources[0].powerUp, activation.sources[1].powerUp) : null,
      events: [...(previous?.events ?? []), activation.event],
      affectedPositions: [...(previous?.affectedPositions ?? []),
        ...activation.sources.map(source => source.position), ...activation.event.affectedPositions]
    });
  }
  for (const id of groups.keys()) presented.add(id);
  return [...groups.values()];
}

export function playEffectsTogether<T>(
  effects: readonly T[],
  play: (effect: T, done: () => void) => void,
  complete: () => void
): void {
  let remaining = effects.length;
  if (remaining === 0) { complete(); return; }
  for (const effect of effects) {
    let finished = false;
    play(effect, () => {
      if (finished) return;
      finished = true;
      if (--remaining === 0) complete();
    });
  }
}

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
