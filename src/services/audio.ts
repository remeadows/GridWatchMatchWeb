import { audioUrl, presentationAudioUrl } from "../data/assets";
import { presentationAudioManifest, type PresentationAudioKey } from "../data/presentationAssets";
import { chainPlaybackRate, type TilePopVariation } from "../game/presentation";
import type { SettingsState } from "../state/save";

type MusicTrack = "bgm_menu.mp3" | "bgm_gameplay.mp3" | "bgm_boss.mp3";
type SoundName =
  | "sfx_breach_alert.mp3"
  | "sfx_chain_cascade.mp3"
  | "sfx_level_complete.mp3"
  | "sfx_level_fail.mp3"
  | "sfx_power_up.mp3"
  | "sfx_tile_clear.mp3"
  | "sfx_ui_tap.mp3"
  | "vo_area_cleared.mp3"
  | "vo_breach_alert.mp3"
  | "vo_connection_secure.mp3"
  | "vo_grid_compromised.mp3"
  | "vo_initiating_countermeasures.mp3";

const MAX_ACTIVE_BOARD_SOURCES = 16;
const CASCADE_LANDING_COALESCE_MS = 45;

export interface BoardAudioPlayback {
  gain: number;
  playbackRate: number;
}

export interface BoardAudioSource {
  stop: () => void;
}

export interface BoardAudioBackend {
  resume: () => Promise<void>;
  preload: (url: string) => Promise<void>;
  play: (url: string, playback: BoardAudioPlayback, onEnded: () => void) => BoardAudioSource | null;
}

interface AudioServiceOptions {
  createBoardBackend?: () => BoardAudioBackend | null;
  createAudio?: (url: string) => HTMLAudioElement | null;
  now?: () => number;
  playFallback?: (url: string, volume: number) => void;
}

interface ActiveBoardSource {
  source: BoardAudioSource;
  gain: number;
  order: number;
}

export class AudioService {
  private music: HTMLAudioElement | null = null;
  private settings: SettingsState | null = null;
  private boardBackend: BoardAudioBackend | null = null;
  private boardBackendResolved = false;
  private boardPreload: Promise<void> | null = null;
  private activeBoardSources: ActiveBoardSource[] = [];
  private boardSourceOrder = 0;
  private lastCascadeLandingMs = Number.NEGATIVE_INFINITY;
  private readonly createBoardBackend: () => BoardAudioBackend | null;
  private readonly createAudio: (url: string) => HTMLAudioElement | null;
  private readonly now: () => number;
  private readonly playFallback: (url: string, volume: number) => void;

  constructor(options: AudioServiceOptions = {}) {
    this.createBoardBackend = options.createBoardBackend ?? createDefaultBoardBackend;
    this.createAudio = options.createAudio ?? createHtmlAudio;
    this.now = options.now ?? (() => performance.now());
    this.playFallback = options.playFallback ?? ((url, volume) => this.playHtmlAudio(url, volume));
  }

  configure(settings: SettingsState): void {
    this.settings = settings;
    if (this.music) this.music.muted = !settings.musicEnabled;
  }

  playMusic(track: MusicTrack): void {
    if (!this.settings?.musicEnabled) return;
    if (this.music?.dataset.track === track && !this.music.paused) return;
    this.stopMusic();
    const audio = this.createAudio(audioUrl(track));
    if (!audio) return;
    audio.dataset.track = track;
    audio.loop = true;
    audio.volume = 0.45;
    audio.muted = !this.settings.musicEnabled;
    this.music = audio;
    void audio.play().catch(() => undefined);
  }

  stopMusic(): void {
    if (!this.music) return;
    this.music.pause();
    this.music.currentTime = 0;
    this.music = null;
  }

  playSfx(sound: SoundName): void {
    if (!this.settings?.sfxEnabled && !sound.startsWith("vo_")) return;
    if (sound.startsWith("vo_") && !this.settings?.voiceEnabled) return;
    this.playHtmlAudio(audioUrl(sound), sound.startsWith("vo_") ? 0.8 : 0.65);
  }

  async preloadBoardSounds(): Promise<void> {
    const backend = this.resolveBoardBackend();
    if (!backend || this.boardPreload) return this.boardPreload ?? Promise.resolve();
    const urls = Object.keys(presentationAudioManifest).map((key) => presentationAudioUrl(key as PresentationAudioKey));
    this.boardPreload = Promise.all(urls.map((url) => backend.preload(url).catch(() => undefined))).then(() => undefined);
    return this.boardPreload;
  }

  unlockBoardSounds(): void {
    const backend = this.resolveBoardBackend();
    if (backend) void backend.resume().catch(() => undefined);
  }

  playMatchClear(variations: ReadonlyArray<TilePopVariation>): void {
    this.playBoardCue("tileClusterBody", { gain: 0.62 });
    for (const variation of variations) {
      this.playBoardCue(variation.sample === "tile_pop_a" ? "tilePopA" : "tilePopB", {
        gain: 0.42,
        playbackRate: variation.playbackRate
      });
    }
  }

  playCascadeLand(): void {
    const now = this.now();
    if (now - this.lastCascadeLandingMs < CASCADE_LANDING_COALESCE_MS) return;
    this.lastCascadeLandingMs = now;
    this.playBoardCue("cascadeLand", { gain: 0.34 });
  }

  playChain(depth: number): boolean {
    return this.playBoardCue("chainRise", { gain: 0.48, playbackRate: chainPlaybackRate(depth) });
  }

  playBoardCue(key: PresentationAudioKey, overrides: Partial<BoardAudioPlayback> = {}): boolean {
    if (!this.settings?.sfxEnabled) return false;
    const playback: BoardAudioPlayback = {
      gain: overrides.gain ?? boardCueGain(key),
      playbackRate: overrides.playbackRate ?? 1
    };
    const url = presentationAudioUrl(key);
    const backend = this.resolveBoardBackend();
    if (!backend) {
      this.playFallback(url, playback.gain);
      return true;
    }

    this.dropSourceForCapacity();
    let active: ActiveBoardSource | null = null;
    const source = backend.play(url, playback, () => {
      if (active) this.activeBoardSources = this.activeBoardSources.filter((entry) => entry !== active);
    });
    if (!source) {
      this.playFallback(url, playback.gain);
      return true;
    }
    active = { source, gain: playback.gain, order: this.boardSourceOrder++ };
    this.activeBoardSources.push(active);
    return true;
  }

  vibrate(pattern: number | number[]): void {
    const nav = typeof navigator === "undefined" ? null : navigator;
    if (typeof nav?.vibrate === "function") nav.vibrate(pattern);
  }

  private resolveBoardBackend(): BoardAudioBackend | null {
    if (!this.boardBackendResolved) {
      this.boardBackend = this.createBoardBackend();
      this.boardBackendResolved = true;
    }
    return this.boardBackend;
  }

  private dropSourceForCapacity(): void {
    if (this.activeBoardSources.length < MAX_ACTIVE_BOARD_SOURCES) return;
    const [candidate] = [...this.activeBoardSources].sort((left, right) => left.gain - right.gain || left.order - right.order);
    candidate?.source.stop();
  }

  private playHtmlAudio(url: string, volume: number): void {
    const audio = this.createAudio(url);
    if (!audio) return;
    audio.volume = volume;
    void audio.play().catch(() => undefined);
  }
}

class WebAudioBoardBackend implements BoardAudioBackend {
  private readonly cache = new Map<string, AudioBuffer>();
  private readonly pending = new Map<string, Promise<void>>();

  constructor(private readonly context: AudioContext) {}

  async resume(): Promise<void> {
    if (this.context.state !== "running") await this.context.resume();
  }

  preload(url: string): Promise<void> {
    if (this.cache.has(url)) return Promise.resolve();
    const existing = this.pending.get(url);
    if (existing) return existing;
    const request = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`Unable to load board sound: ${response.status}`);
        return response.arrayBuffer();
      })
      .then((bytes) => this.context.decodeAudioData(bytes))
      .then((buffer) => {
        this.cache.set(url, buffer);
      })
      .finally(() => this.pending.delete(url));
    this.pending.set(url, request);
    return request;
  }

  play(url: string, playback: BoardAudioPlayback, onEnded: () => void): BoardAudioSource | null {
    const buffer = this.cache.get(url);
    if (!buffer) {
      void this.preload(url).catch(() => undefined);
      return null;
    }
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = playback.playbackRate;
    gain.gain.value = playback.gain;
    source.connect(gain);
    gain.connect(this.context.destination);
    source.onended = onEnded;
    source.start();
    return { stop: () => source.stop() };
  }
}

function createDefaultBoardBackend(): BoardAudioBackend | null {
  const audioGlobal = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  const AudioContextConstructor = audioGlobal.AudioContext ?? audioGlobal.webkitAudioContext;
  if (!AudioContextConstructor) return null;
  return new WebAudioBoardBackend(new AudioContextConstructor());
}

function createHtmlAudio(url: string): HTMLAudioElement | null {
  if (typeof Audio === "undefined") return null;
  return new Audio(url);
}

function boardCueGain(key: PresentationAudioKey): number {
  if (key === "comboImpact" || key === "tntBlast") return 0.76;
  if (key === "comboCharge" || key === "lightBallRelease") return 0.62;
  return 0.5;
}

export const audioService = new AudioService();
