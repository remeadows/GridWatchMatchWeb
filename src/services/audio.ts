import { audioUrl, presentationAudioUrl } from "../data/assets";
import { presentationAudioManifest, type PresentationAudioKey } from "../data/presentationAssets";
import { chainPlaybackRate, createMatchAudioDispatch, type TilePopVariation } from "../game/presentation";
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
  source: BoardAudioSource | null;
  gain: number;
  order: number;
  owner?: symbol;
}

export class AudioService {
  private music: HTMLAudioElement | null = null;
  private settings: SettingsState | null = null;
  private boardBackend: BoardAudioBackend | null = null;
  private boardBackendResolved = false;
  private boardPreload: Promise<void> | null = null;
  private activeBoardSources: ActiveBoardSource[] = [];
  private boardSourceOrder = 0;
  private readonly silenceListeners = new Set<{ callback: () => void; owner?: symbol }>();
  private lastCascadeLandingMs = Number.NEGATIVE_INFINITY;
  private readonly createBoardBackend: () => BoardAudioBackend | null;
  private readonly createAudio: (url: string) => HTMLAudioElement | null;
  private readonly now: () => number;
  private readonly playFallback: (url: string, volume: number, onEnded: () => void) => BoardAudioSource | null;

  constructor(options: AudioServiceOptions = {}) {
    this.createBoardBackend = options.createBoardBackend ?? createDefaultBoardBackend;
    this.createAudio = options.createAudio ?? createHtmlAudio;
    this.now = options.now ?? (() => performance.now());
    this.playFallback = options.playFallback
      ? (url, volume) => { options.playFallback!(url, volume); return null; }
      : (url, volume, onEnded) => this.playHtmlBoardAudio(url, volume, onEnded);
  }

  configure(settings: SettingsState): void {
    this.settings = settings;
    if (this.music) this.music.muted = !settings.musicEnabled;
    if (!settings.sfxEnabled) this.stopBoardSounds();
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
    const dispatch = createMatchAudioDispatch();
    for (const variation of variations) {
      for (const cue of dispatch("match", this.now(), variation)) this.playBoardCue(cue.key, cue.playback);
    }
  }

  playCascadeLand(): void {
    const now = this.now();
    if (now - this.lastCascadeLandingMs < CASCADE_LANDING_COALESCE_MS) return;
    this.lastCascadeLandingMs = now;
    this.playBoardCue("cascadeLand", { gain: 0.34 });
  }

  playChain(depth: number, owner?: symbol): boolean {
    return this.playBoardCue("chainRise", { gain: 0.48, playbackRate: chainPlaybackRate(depth) }, owner);
  }

  playBoardCue(key: PresentationAudioKey, overrides: Partial<BoardAudioPlayback> = {}, owner?: symbol): boolean {
    if (!this.settings?.sfxEnabled) return false;
    const playback: BoardAudioPlayback = {
      gain: overrides.gain ?? boardCueGain(key),
      playbackRate: overrides.playbackRate ?? 1
    };
    const url = presentationAudioUrl(key);
    const backend = this.resolveBoardBackend();
    this.dropSourceForCapacity();
    const active: ActiveBoardSource = { source: null, gain: playback.gain, order: this.boardSourceOrder++, owner };
    this.activeBoardSources.push(active);
    const ended = () => {
      this.activeBoardSources = this.activeBoardSources.filter(entry => entry !== active);
      this.notifyBoardSilence();
    };
    active.source = backend?.play(url, playback, ended) ?? this.playFallback(url, playback.gain, ended) ?? null;
    if (!active.source) ended();
    return true;
  }

  whenBoardSilent(onSilent: () => void, owner?: symbol): () => void {
    const listener = { callback: onSilent, owner };
    if (!this.activeBoardSources.some(entry => owner === undefined || entry.owner === owner)) onSilent();
    else this.silenceListeners.add(listener);
    return () => { this.silenceListeners.delete(listener); };
  }

  stopBoardSounds(owner?: symbol): void {
    const active = this.activeBoardSources.filter(entry => owner === undefined || entry.owner === owner);
    this.activeBoardSources = this.activeBoardSources.filter(entry => !active.includes(entry));
    for (const entry of active) entry.source?.stop();
    this.lastCascadeLandingMs = Number.NEGATIVE_INFINITY;
    this.notifyBoardSilence();
  }

  private notifyBoardSilence(): void {
    for (const listener of [...this.silenceListeners]) {
      if (this.activeBoardSources.some(entry => listener.owner === undefined || entry.owner === listener.owner)) continue;
      this.silenceListeners.delete(listener);
      listener.callback();
    }
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
    // WebAudio's ended event is asynchronous; reclaim ownership before replacement.
    this.activeBoardSources = this.activeBoardSources.filter(entry => entry !== candidate);
    candidate?.source?.stop();
  }

  private playHtmlBoardAudio(url: string, volume: number, onEnded: () => void): BoardAudioSource | null {
    const audio = this.createAudio(url);
    if (!audio) return null;
    audio.volume = volume;
    let ended = false;
    const finish = () => {
      if (ended) return;
      ended = true;
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      onEnded();
    };
    audio.onended = finish;
    audio.onerror = finish;
    void audio.play().catch(finish);
    return { stop: finish };
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
  private readonly output: DynamicsCompressorNode;

  constructor(private readonly context: AudioContext) {
    this.output = context.createDynamicsCompressor();
    this.output.threshold.value = -8;
    this.output.knee.value = 6;
    this.output.ratio.value = 12;
    this.output.attack.value = 0;
    this.output.release.value = 0.12;
    this.output.connect(context.destination);
  }

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
    if (this.context.state !== "running") return null;
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
    gain.connect(this.output);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      onEnded();
    };
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
