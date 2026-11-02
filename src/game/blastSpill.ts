import { seededRandom } from "./motion";

// Blasts break out past the board, as Royal Match's do. The canvas stops at the board's edge and
// growing it would lay it over the objective and tray, so the part that escapes is drawn here: page
// elements in one fixed layer, moved by the browser's compositor, like src/game/pieceFlights.ts.
const SPILL_ELEMENT_CAP = 40;
const SPILL_GLOW_MS = 300;
const SPILL_GLOW_PEAK_OPACITY = 0.5;
/** The glow is drawn this big and scaled up, so a 3x phone never rasters a board-sized gradient. */
const SPILL_GLOW_SIZE_PX = 220;
const SPILL_FRAME_COUNT = 6;
/** A hidden tab can hold an animation's finish back; the element must not wait for it. */
const SPILL_REMOVAL_MARGIN_MS = 250;

export interface BlastSpillOptions {
  radiusPx: number;
  shards: number;
  tint: number;
  seed: string;
  /** Thrown this way, in degrees (0 is right, 90 is down); all round when absent. */
  headingDeg?: number;
  spreadDeg?: number;
}

export interface SpillShard {
  sizePx: number;
  durationMs: number;
  spark: boolean;
  frames: { offset: number; x: number; y: number; rotate: number; opacity: number }[];
}

export function spillShardPlan(options: BlastSpillOptions): SpillShard[] {
  const random = seededRandom(options.seed);
  return Array.from({ length: options.shards }, (_, index) => {
    const heading = options.headingDeg === undefined
      ? (index / options.shards) * 360 + random() * 24
      : options.headingDeg + (random() - 0.5) * (options.spreadDeg ?? 0);
    const angle = heading * Math.PI / 180;
    const reach = options.radiusPx * (1 + random() * 0.7);
    const drop = reach * 0.5;
    const spin = (random() - 0.5) * 900;
    const spark = index % 3 === 2;
    const frames = Array.from({ length: SPILL_FRAME_COUNT }, (_unused, frame) => {
      const offset = frame / (SPILL_FRAME_COUNT - 1);
      const flown = 1 - (1 - offset) ** 2;
      return {
        offset,
        x: Math.cos(angle) * reach * flown,
        y: Math.sin(angle) * reach * flown + drop * offset * offset,
        rotate: spin * offset,
        opacity: offset < 0.6 ? 1 : (1 - offset) / 0.4
      };
    });
    return { sizePx: spark ? 3 + random() * 3 : 7 + random() * 8, durationMs: 520 + random() * 240, spark, frames };
  });
}

export class BlastSpill {
  private layer: HTMLDivElement | null = null;
  private readonly live = new Set<() => void>();

  /** How many shards flew: none in a hidden tab, under the OS setting or past the cap. */
  burst(x: number, y: number, options: BlastSpillOptions): number {
    if (document.hidden || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return 0;
    if (this.live.size >= SPILL_ELEMENT_CAP) return 0;
    const tint = `#${options.tint.toString(16).padStart(6, "0")}`;
    const glow = document.createElement("div");
    glow.className = "blast-spill-glow";
    glow.style.left = `${x}px`;
    glow.style.top = `${y}px`;
    glow.style.setProperty("--spill-tint", tint);
    const scale = options.radiusPx * 2.2 / SPILL_GLOW_SIZE_PX;
    this.play(glow, [
      { opacity: SPILL_GLOW_PEAK_OPACITY, transform: `scale(${scale * 0.4})` },
      { opacity: 0, transform: `scale(${scale})` }
    ], SPILL_GLOW_MS, "ease-out");

    const room = Math.max(0, SPILL_ELEMENT_CAP - this.live.size);
    const shards = spillShardPlan({ ...options, shards: Math.min(options.shards, room) });
    for (const shard of shards) {
      const element = document.createElement("div");
      element.className = shard.spark ? "blast-spill-shard is-spark" : "blast-spill-shard";
      element.style.left = `${x}px`;
      element.style.top = `${y}px`;
      element.style.width = `${shard.sizePx}px`;
      element.style.height = `${shard.sizePx}px`;
      element.style.setProperty("--spill-tint", tint);
      this.play(element, shard.frames.map(({ offset, x: dx, y: dy, rotate, opacity }) => (
        { offset, opacity, transform: `translate(${dx}px, ${dy}px) rotate(${rotate}deg)` }
      )), shard.durationMs, "linear");
    }
    return shards.length;
  }

  /** Clears anything in the air: the level has ended or the board is gone. */
  dispose(): void {
    for (const remove of [...this.live]) remove();
    this.layer?.remove();
    this.layer = null;
  }

  private play(element: HTMLElement, frames: Keyframe[], durationMs: number, easing: string): void {
    this.ensureLayer().append(element);
    const animation = element.animate(frames, { duration: durationMs, easing, fill: "both" });
    let removed = false;
    const remove = () => {
      if (removed) return;
      removed = true;
      clearTimeout(timer);
      this.live.delete(remove);
      animation.cancel();
      element.remove();
    };
    const timer = setTimeout(remove, durationMs + SPILL_REMOVAL_MARGIN_MS);
    animation.onfinish = remove;
    this.live.add(remove);
  }

  private ensureLayer(): HTMLDivElement {
    if (this.layer?.isConnected) return this.layer;
    this.layer = document.createElement("div");
    this.layer.className = "blast-spill";
    this.layer.setAttribute("aria-hidden", "true");
    document.body.append(this.layer);
    return this.layer;
  }
}
