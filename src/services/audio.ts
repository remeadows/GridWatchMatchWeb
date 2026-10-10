import { audioUrl, presentationAudioUrl } from "../data/assets";
import { presentationAudioManifest, type PresentationAudioKey } from "../data/presentationAssets";
import { chainPlaybackRate, type TilePopVariation } from "../game/presentation";
import type { SettingsState } from "../state/save";
import { createElementVoice, MusicPlayer, type MusicVoice } from "./music";

export type MusicTrack = "menu" | "gameplay" | "boss";

/**
 * Each track's files and how loud it sits under the effects (1 is the file's own level, and
 * scripts/prepare-music.sh brings every file to one loudness). A track has more than one file so
 * it does not sound the same every time: each time the track comes round, the next file plays.
 */
const MUSIC_TRACKS: Record<MusicTrack, { files: readonly string[]; level: number }> = {
  menu: { files: ["music/menu_a.mp3", "music/menu_b.mp3"], level: 0.8 },
  gameplay: { files: ["music/gameplay_a.mp3", "music/gameplay_b.mp3"], level: 0.6 },
  boss: { files: ["music/boss_a.mp3", "music/boss_b.mp3"], level: 0.75 }
};

export function musicFiles(track: MusicTrack): readonly string[] {
  return MUSIC_TRACKS[track].files;
}

type SoundName =
  | "sfx_breach_alert.mp3"
  | "sfx_chain_cascade.mp3"
  | "sfx_level_complete.mp3"
  | "sfx_level_fail.mp3"
  | "sfx_power_up.mp3"
  | "sfx_tile_clear.mp3"
  | "sfx_ui_tap.mp3";

/**
 * What Tish says over the comms channel. The recordings are prepared by scripts/prepare-voice.sh,
 * which also sets their level: they play at their own loudness.
 */
export type VoiceLine =
  | "connectionSecure"
  | "gridCompromised"
  | "areaCleared"
  | "breachAlert"
  | "initiatingCountermeasures"
  | "defencesOnline"
  | "securingTheGrid"
  | "tracingTheIntrusion"
  | "systemsReady";

const VOICE_LINES: Record<VoiceLine, string> = {
  connectionSecure: "voice/tish_connection_secure.mp3",
  gridCompromised: "voice/tish_grid_compromised.mp3",
  areaCleared: "voice/tish_area_cleared.mp3",
  breachAlert: "voice/tish_breach_alert.mp3",
  initiatingCountermeasures: "voice/tish_initiating_countermeasures.mp3",
  defencesOnline: "voice/tish_defences_online.mp3",
  securingTheGrid: "voice/tish_securing_the_grid.mp3",
  tracingTheIntrusion: "voice/tish_tracing_the_intrusion.mp3",
  systemsReady: "voice/tish_systems_ready.mp3"
};

/** What she can say as a level begins. She takes them in turn, so no two levels running open alike. */
const OPENING_LINES: readonly VoiceLine[] = [
  "initiatingCountermeasures",
  "defencesOnline",
  "securingTheGrid",
  "tracingTheIntrusion",
  "systemsReady"
];

export function openingLines(): readonly VoiceLine[] {
  return OPENING_LINES;
}

export function voiceFile(line: VoiceLine): string {
  return VOICE_LINES[line];
}

const MAX_ACTIVE_BOARD_SOURCES = 16;
// A line that had to be loaded first is still said if that took no longer than this.
const VOICE_LATE_MS = 1_500;
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
  createMusicVoice?: (url: string) => MusicVoice | null;
  /** Which of a track's files plays first, as a fraction in [0, 1). Random unless given. */
  firstMusicFile?: () => number;
  /** Which opening line is said first, as a fraction in [0, 1). Random unless given. */
  firstOpening?: () => number;
  /** Fetches a file so the browser has it cached; the global `fetch` unless given. */
  prefetch?: (url: string, signal?: AbortSignal) => Promise<unknown>;
  now?: () => number;
  playFallback?: (url: string, volume: number) => void;
}

interface ActiveBoardSource {
  source: BoardAudioSource;
  gain: number;
  order: number;
}

export class AudioService {
  private readonly music: MusicPlayer;
  private musicTrack: MusicTrack | null = null;
  private readonly musicTurn: Record<MusicTrack, number>;
  private openingTurn: number;
  private voicePrefetched = false;
  private readonly prefetch: (url: string, signal?: AbortSignal) => Promise<unknown>;
  private gestureUnlockInstalled = false;
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
    this.music = new MusicPlayer({
      // The level runs through the audio context only once a touch has created it: a track asked
      // for before that is refused by a phone anyway, and is started again from the touch.
      createVoice: options.createMusicVoice ?? ((url) => createElementVoice(url, sharedAudioContext(false))),
      now: this.now
    });
    const first = options.firstMusicFile ?? Math.random;
    const firstTurn = (track: MusicTrack) => Math.floor(first() * MUSIC_TRACKS[track].files.length);
    this.musicTurn = { menu: firstTurn("menu"), gameplay: firstTurn("gameplay"), boss: firstTurn("boss") };
    this.openingTurn = Math.floor((options.firstOpening ?? Math.random)() * OPENING_LINES.length);
    this.prefetch = options.prefetch ?? ((url, signal) => (typeof fetch === "function" ? fetch(url, { signal }) : Promise.resolve()));
    this.playFallback = options.playFallback ?? ((url, volume) => this.playHtmlAudio(url, volume));
  }

  configure(settings: SettingsState): void {
    this.settings = settings;
    // Whatever is switched on, the first touch has to wake the audio context: the voice and the
    // board sounds run through it as well as the music's level.
    this.installGestureUnlock();
    if (!settings.musicEnabled) this.stopMusic();
  }

  /**
   * Play a track. Asking again for the one that is playing changes nothing, unless `fresh` says
   * this is a new occasion for it (the next level): then the track's next file is crossfaded in.
   */
  playMusic(track: MusicTrack, options: { fresh?: boolean } = {}): void {
    if (!this.settings?.musicEnabled) return;
    const { files, level } = MUSIC_TRACKS[track];
    if (this.musicTrack === track && options.fresh) this.musicTurn[track] += 1;
    else if (this.musicTrack !== null && this.musicTrack !== track) this.musicTurn[this.musicTrack] += 1;
    this.musicTrack = track;
    this.music.play(audioUrl(files[this.musicTurn[track] % files.length]), level);
  }

  stopMusic(): void {
    if (this.musicTrack !== null) this.musicTurn[this.musicTrack] += 1;
    this.musicTrack = null;
    this.music.stop();
  }

  /**
   * Browsers hold audio back until the player has touched the page. Call from a user gesture:
   * it wakes the audio context the music's level runs through and starts a track that was refused.
   * `startMusic: false` is for an event the browser does not yet count as a touch (a finger going
   * down): the track would be refused again, and that attempt would be in the way of the one made
   * when the finger lifts.
   */
  unlockMusic(options: { startMusic?: boolean } = {}): void {
    const context = sharedAudioContext();
    if (context && context.state !== "running") void context.resume().catch(() => undefined);
    // Now that a touch has made the context, the voice can be decoded into it.
    void this.preloadVoice();
    if (options.startMusic !== false && this.settings?.musicEnabled) this.music.retry();
  }

  playSfx(sound: SoundName): void {
    if (!this.settings?.sfxEnabled) return;
    this.playHtmlAudio(audioUrl(sound), 0.65);
  }

  /**
   * A spoken line. It goes through the decoded-audio backend when the line is loaded there, since
   * that is already unlocked by the player's first touch; an <audio> element started outside a
   * touch can be refused on a phone.
   */
  playVoice(line: VoiceLine): void {
    if (!this.settings?.voiceEnabled) return;
    const url = audioUrl(VOICE_LINES[line]);
    const backend = this.resolveBoardBackend();
    if (!backend) {
      this.playHtmlAudio(url, 1);
      return;
    }
    const playback: BoardAudioPlayback = { gain: 1, playbackRate: 1 };
    const say = () => backend.play(url, playback, () => undefined) !== null;
    if (say()) return;
    // Not decoded yet. Load it and say it then, unless the moment has passed; only if it cannot
    // be loaded at all is an <audio> element tried.
    const askedAtMs = this.now();
    const stillWanted = () => Boolean(this.settings?.voiceEnabled) && this.now() - askedAtMs <= VOICE_LATE_MS;
    backend.preload(url).then(
      () => {
        if (stillWanted()) say();
      },
      () => {
        if (stillWanted()) this.playHtmlAudio(url, 1);
      }
    );
  }

  /**
   * Have the browser fetch every line, without touching Web Audio: the audio context must not be
   * made before the player's first touch, and this runs on the menu before there has been one.
   * The touch then decodes them (unlockMusic), from the cache.
   */
  prefetchVoice(signal?: AbortSignal): void {
    if (!this.settings?.voiceEnabled || this.voicePrefetched) return;
    this.voicePrefetched = true;
    for (const file of Object.values(VOICE_LINES)) {
      this.prefetch(audioUrl(file), signal).catch(() => {
        // Aborted or offline: let a later call try again. The touch-time preload does not depend on it.
        this.voicePrefetched = false;
      });
    }
  }

  /** Her line as a level begins: the next of the openings. A turn is only used when she speaks. */
  playOpening(): void {
    if (!this.settings?.voiceEnabled) return;
    this.playVoice(OPENING_LINES[this.openingTurn % OPENING_LINES.length]);
    this.openingTurn += 1;
  }

  /** Decode every line into the audio backend. Called from the first touch and when a level's board mounts. */
  async preloadVoice(): Promise<void> {
    if (!this.settings?.voiceEnabled) return;
    const backend = this.resolveBoardBackend();
    if (!backend) return;
    await Promise.all(Object.values(VOICE_LINES).map((file) => backend.preload(audioUrl(file)).catch(() => undefined)));
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

  private installGestureUnlock(): void {
    if (this.gestureUnlockInstalled || typeof document === "undefined") return;
    this.gestureUnlockInstalled = true;
    // The menu music is asked for at page load and plays from then wherever the browser allows it
    // (arriving from the Nexus menu in Chrome or Edge). Elsewhere it is refused until the page is
    // touched, so it is started on the first event the browser counts as one: a mouse press, a
    // finger or pen lifting, a key. `click` is the net under those.
    const listen = (type: string, startMusic: (event: Event) => boolean) =>
      document.addEventListener(type, (event) => this.unlockMusic({ startMusic: startMusic(event) }), { capture: true, passive: true });
    const byMouse = (event: Event) => (event as PointerEvent).pointerType === "mouse";
    listen("pointerdown", byMouse);
    listen("pointerup", (event) => !byMouse(event));
    listen("touchend", () => true);
    listen("click", () => true);
    listen("keydown", () => true);
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

let audioContext: AudioContext | null | undefined;

/**
 * One audio context for the board sounds, the voice and the music's level. It is made on first
 * use, which should be inside a touch: pass `create = false` to get it only if it already exists.
 */
function sharedAudioContext(create = true): AudioContext | null {
  if (audioContext !== undefined) return audioContext;
  if (!create) return null;
  const audioGlobal = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  const AudioContextConstructor = audioGlobal.AudioContext ?? audioGlobal.webkitAudioContext;
  audioContext = AudioContextConstructor ? new AudioContextConstructor() : null;
  return audioContext;
}

function createDefaultBoardBackend(): BoardAudioBackend | null {
  const context = sharedAudioContext();
  return context ? new WebAudioBoardBackend(context) : null;
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
