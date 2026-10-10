// Background music: one looping track at a time, changed by crossfade.
//
// A track is streamed, not decoded (two and a half minutes of stereo is about 50 MB decoded), so
// it cannot loop sample-exactly the way a buffer can; an <audio> element's own `loop` leaves a
// gap at the join. Instead each track is prepared without a fade at either end and the player
// starts a second copy shortly before the first one finishes, crossfading between them.

export const TRACK_CROSSFADE_MS = 1_500;
export const LOOP_CROSSFADE_MS = 4_000;
const TICK_MS = 50;

/** One playing copy of a track. Times are in milliseconds. */
export interface MusicVoice {
  /** Start from the top. Rejects when the browser refuses (no user gesture yet). */
  start: () => Promise<void>;
  stop: () => void;
  setGain: (gain: number) => void;
  readonly positionMs: number;
  /** Null until the browser knows the track's length. */
  readonly durationMs: number | null;
  onEnded: (listener: () => void) => void;
}

export interface MusicPlayerOptions {
  createVoice: (url: string) => MusicVoice | null;
  now?: () => number;
  /** Calls `tick` regularly until the returned function is called. */
  startTicker?: (tick: () => void) => () => void;
}

interface Fade {
  from: number;
  to: number;
  startMs: number;
  durationMs: number;
}

interface ActiveVoice {
  voice: MusicVoice;
  url: string;
  fade: Fade;
}

export class MusicPlayer {
  private readonly createVoice: (url: string) => MusicVoice | null;
  private readonly now: () => number;
  private readonly startTicker: (tick: () => void) => () => void;
  private current: ActiveVoice | null = null;
  private currentLevel = 1;
  private leaving: ActiveVoice[] = [];
  private refused: { url: string; level: number } | null = null;
  private muted = false;
  private stopTicker: (() => void) | null = null;

  constructor(options: MusicPlayerOptions) {
    this.createVoice = options.createVoice;
    this.now = options.now ?? (() => performance.now());
    this.startTicker = options.startTicker ?? defaultTicker;
  }

  /** The track that is playing, or being faded in. */
  currentUrl(): string | null {
    return this.current?.url ?? null;
  }

  play(url: string, level: number): void {
    this.refused = null;
    if (this.current?.url === url) {
      this.currentLevel = level;
      return;
    }
    this.retire(TRACK_CROSSFADE_MS);
    this.currentLevel = level;
    this.begin(url, { from: 0, to: level, startMs: this.now(), durationMs: TRACK_CROSSFADE_MS });
  }

  /** Try again a track the browser refused to start; call from a user gesture. */
  retry(): void {
    const refused = this.refused;
    if (!refused || this.current) return;
    this.play(refused.url, refused.level);
  }

  stop(): void {
    this.refused = null;
    for (const active of this.all()) active.voice.stop();
    this.current = null;
    this.leaving = [];
    this.halt();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyGains();
  }

  /** Advance the fades and start the next loop copy when the current one nears its end. */
  tick(): void {
    const nowMs = this.now();
    this.applyGains();
    this.leaving = this.leaving.filter((active) => {
      if (nowMs - active.fade.startMs < active.fade.durationMs) return true;
      active.voice.stop();
      return false;
    });
    const current = this.current;
    if (current) {
      const duration = current.voice.durationMs;
      if (duration !== null && duration > LOOP_CROSSFADE_MS * 2 && current.voice.positionMs >= duration - LOOP_CROSSFADE_MS) {
        this.retire(LOOP_CROSSFADE_MS);
        this.begin(current.url, { from: 0, to: this.currentLevel, startMs: nowMs, durationMs: LOOP_CROSSFADE_MS });
      }
    }
    if (!this.current && this.leaving.length === 0) this.halt();
  }

  private begin(url: string, fade: Fade): void {
    const voice = this.createVoice(url);
    if (!voice) return;
    const active: ActiveVoice = { voice, url, fade };
    this.current = active;
    voice.setGain(this.gainOf(active, this.now()));
    voice.onEnded(() => this.ended(active));
    voice.start().catch(() => this.refusedToStart(active));
    this.stopTicker ??= this.startTicker(() => this.tick());
  }

  /** Fade out whatever is current; it is stopped once silent. */
  private retire(durationMs: number): void {
    const active = this.current;
    if (!active) return;
    const nowMs = this.now();
    active.fade = { from: this.levelOf(active, nowMs), to: 0, startMs: nowMs, durationMs };
    this.leaving.push(active);
    this.current = null;
  }

  private ended(active: ActiveVoice): void {
    if (this.current !== active) return;
    // No tick got to start the crossfade (a throttled background tab): carry on without one.
    active.voice.stop();
    this.current = null;
    const nowMs = this.now();
    this.begin(active.url, { from: this.currentLevel, to: this.currentLevel, startMs: nowMs, durationMs: 0 });
  }

  private refusedToStart(active: ActiveVoice): void {
    if (this.current !== active) return;
    active.voice.stop();
    this.current = null;
    this.refused = { url: active.url, level: this.currentLevel };
    if (this.leaving.length === 0) this.halt();
  }

  private applyGains(): void {
    const nowMs = this.now();
    for (const active of this.all()) active.voice.setGain(this.gainOf(active, nowMs));
  }

  private gainOf(active: ActiveVoice, nowMs: number): number {
    return this.muted ? 0 : this.levelOf(active, nowMs);
  }

  /** Equal-power fade, so two overlapping copies sum to the level of one. */
  private levelOf(active: ActiveVoice, nowMs: number): number {
    const { from, to, startMs, durationMs } = active.fade;
    const progress = durationMs <= 0 ? 1 : Math.min(1, Math.max(0, (nowMs - startMs) / durationMs));
    if (to >= from) return from + (to - from) * Math.sin((progress * Math.PI) / 2);
    return to + (from - to) * Math.cos((progress * Math.PI) / 2);
  }

  private all(): ActiveVoice[] {
    return this.current ? [...this.leaving, this.current] : [...this.leaving];
  }

  private halt(): void {
    this.stopTicker?.();
    this.stopTicker = null;
  }
}

function defaultTicker(tick: () => void): () => void {
  const id = setInterval(tick, TICK_MS);
  return () => clearInterval(id);
}

/**
 * A voice backed by a streaming <audio> element. Its level goes through a Web Audio gain node
 * when there is an audio context, because iOS ignores `HTMLMediaElement.volume`; without one it
 * falls back to the element's own volume.
 */
export function createElementVoice(url: string, context: AudioContext | null): MusicVoice | null {
  if (typeof Audio === "undefined") return null;
  const element = new Audio(url);
  element.preload = "auto";
  let gainNode: GainNode | null = null;
  if (context) {
    try {
      const source = context.createMediaElementSource(element);
      gainNode = context.createGain();
      source.connect(gainNode);
      gainNode.connect(context.destination);
    } catch {
      gainNode = null;
    }
  }
  return {
    start: () => {
      element.currentTime = 0;
      return element.play();
    },
    stop: () => {
      element.pause();
      element.removeAttribute("src");
      element.load();
      gainNode?.disconnect();
    },
    setGain: (gain) => {
      const clamped = Math.min(1, Math.max(0, gain));
      if (gainNode) gainNode.gain.value = clamped;
      else element.volume = clamped;
    },
    get positionMs() {
      return element.currentTime * 1_000;
    },
    get durationMs() {
      return Number.isFinite(element.duration) && element.duration > 0 ? element.duration * 1_000 : null;
    },
    onEnded: (listener) => {
      element.addEventListener("ended", listener);
    }
  };
}
