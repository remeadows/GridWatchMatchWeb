import { assetUrl } from "../data/assets";
import { audioService } from "../services/audio";
import type { CollectedPiece } from "./BoardScene";
import { matchV2BlockerAsset, matchV2TileAsset } from "./boardTheme";
import { OBJECTIVE_FLIGHT_CAP, OBJECTIVE_FLIGHT_MS, OBJECTIVE_FLIGHT_STAGGER_MS, flightKeyframes } from "./objectiveFlight";

// Draws the flights src/game/objectiveFlight.ts plans. They cross from the board's canvas to the
// objective above it, so they cannot be Phaser objects: each is a page element in one fixed layer
// on <body>, moved by the browser's compositor. The element animation is what makes this light
// enough for a phone: nothing here runs per frame.
const ARRIVAL_PULSE_MS = 200;
/** A hidden tab can hold an animation's finish back; the count must not wait for it. */
const LANDING_MARGIN_MS = 250;
const ARRIVAL_TICK_GAIN = 0.16;

export class PieceFlights {
  private layer: HTMLDivElement | null = null;
  private readonly flights = new Set<() => void>();
  private nextTakeoffMs = 0;
  private landings = 0;

  constructor(private readonly onLand: (objectiveId: string) => void) {}

  /** False when this piece will not fly, so that it counts at once. */
  launch(piece: CollectedPiece): boolean {
    if (this.flights.size >= OBJECTIVE_FLIGHT_CAP) return false;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
    const asset = piece.blocker ? matchV2BlockerAsset(piece.blocker) : piece.tileType ? matchV2TileAsset(piece.tileType) : undefined;
    const chip = document.querySelector<HTMLElement>(`[data-objective-id="${CSS.escape(piece.objectiveId)}"]`);
    if (!asset || !chip) return false;
    const target = (chip.querySelector(".objective-picture") ?? chip).getBoundingClientRect();
    const to = { x: target.left + target.width / 2, y: target.top + target.height / 2 };
    const frames = flightKeyframes(piece, to, piece.size, Math.min(target.height, piece.size));

    const flight = document.createElement("div");
    flight.className = "piece-flight";
    flight.style.width = `${piece.size}px`;
    flight.style.height = `${piece.size}px`;
    flight.style.left = `${piece.x - piece.size / 2}px`;
    flight.style.top = `${piece.y - piece.size / 2}px`;
    const picture = document.createElement("img");
    picture.src = assetUrl(asset.path);
    picture.alt = "";
    flight.append(picture);
    this.ensureLayer().append(flight);

    const now = performance.now();
    const delay = Math.max(0, this.nextTakeoffMs - now);
    this.nextTakeoffMs = Math.max(now, this.nextTakeoffMs) + OBJECTIVE_FLIGHT_STAGGER_MS;
    const animation = flight.animate(
      frames.map(({ offset, x, y, scale, opacity }) => ({ offset, opacity, transform: `translate(${x}px, ${y}px) scale(${scale})` })),
      { delay, duration: OBJECTIVE_FLIGHT_MS, easing: "linear", fill: "both" }
    );

    let landed = false;
    const finish = (arrived: boolean) => {
      if (landed) return;
      landed = true;
      clearTimeout(timer);
      this.flights.delete(cancel);
      animation.cancel();
      flight.remove();
      if (arrived) this.arrive(piece.objectiveId, chip);
    };
    const cancel = () => finish(false);
    const timer = setTimeout(() => finish(true), delay + OBJECTIVE_FLIGHT_MS + LANDING_MARGIN_MS);
    animation.onfinish = () => finish(true);
    this.flights.add(cancel);
    return true;
  }

  /** Drops everything in the air: the level is over or restarting, and its count starts afresh. */
  dispose(): void {
    for (const cancel of [...this.flights]) cancel();
    this.layer?.remove();
    this.layer = null;
  }

  private arrive(objectiveId: string, chip: HTMLElement): void {
    this.onLand(objectiveId);
    if (this.flights.size === 0) this.landings = 0;
    else this.landings += 1;
    audioService.playBoardCue("tilePopB", { gain: ARRIVAL_TICK_GAIN, playbackRate: Math.min(1.7, 1.2 + this.landings * 0.05) });
    chip.animate(
      [{ transform: "scale(1)", filter: "brightness(1)" }, { transform: "scale(1.09)", filter: "brightness(1.7)" }, { transform: "scale(1)", filter: "brightness(1)" }],
      { duration: ARRIVAL_PULSE_MS, easing: "ease-out" }
    );
  }

  private ensureLayer(): HTMLDivElement {
    if (!this.layer) {
      this.layer = document.createElement("div");
      this.layer.className = "piece-flights";
      this.layer.setAttribute("aria-hidden", "true");
      this.layer.dataset.testid = "piece-flights";
      document.body.append(this.layer);
    }
    return this.layer;
  }
}
