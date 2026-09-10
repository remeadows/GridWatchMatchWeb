import { describe, expect, it, vi } from "vitest";

import { presentationAudioUrl } from "../data/assets";
import { presentationAudioManifest } from "../data/presentationAssets";
import { chainPlaybackRate, createMatchAudioDispatch, type TilePopVariation } from "../game/presentation";
import {
  AudioService,
  type BoardAudioBackend,
  type BoardAudioPlayback,
  type BoardAudioSource
} from "../services/audio";
import type { SettingsState } from "../state/save";

const expectedPresentationAudioManifest = {
  tilePopA: "assets/audio/web-overrides/tile_pop_a.mp3",
  tilePopB: "assets/audio/web-overrides/tile_pop_b.mp3",
  tileClusterBody: "assets/audio/web-overrides/tile_cluster_body.mp3",
  cascadeLand: "assets/audio/web-overrides/cascade_land.mp3",
  powerUpCreate: "assets/audio/web-overrides/powerup_create.mp3",
  tntArm: "assets/audio/web-overrides/tnt_arm.mp3",
  tntBlast: "assets/audio/web-overrides/tnt_blast.mp3",
  rocketLaunch: "assets/audio/web-overrides/rocket_launch.mp3",
  rocketFlyby: "assets/audio/web-overrides/rocket_flyby.mp3",
  rocketImpact: "assets/audio/web-overrides/rocket_impact.mp3",
  propellerLift: "assets/audio/web-overrides/propeller_lift.mp3",
  propellerFly: "assets/audio/web-overrides/propeller_fly.mp3",
  propellerImpact: "assets/audio/web-overrides/propeller_impact.mp3",
  lightBallCharge: "assets/audio/web-overrides/lightball_charge.mp3",
  lightBallZapA: "assets/audio/web-overrides/lightball_zap_a.mp3",
  lightBallZapB: "assets/audio/web-overrides/lightball_zap_b.mp3",
  lightBallRelease: "assets/audio/web-overrides/lightball_release.mp3",
  comboCharge: "assets/audio/web-overrides/combo_charge.mp3",
  comboImpact: "assets/audio/web-overrides/combo_impact.mp3",
  chainRise: "assets/audio/web-overrides/chain_rise.mp3"
} as const;

describe("presentation board-audio manifest", () => {
  it("maps every semantic cue to its approved override file", () => {
    expect(presentationAudioManifest).toEqual(expectedPresentationAudioManifest);
  });
});

const enabledSettings: SettingsState = {
  musicEnabled: true,
  sfxEnabled: true,
  voiceEnabled: true,
  reducedMotion: false
};

class FakeBoardAudioBackend implements BoardAudioBackend {
  nowMs = 0;
  readonly preloaded: string[] = [];
  readonly plays: Array<{ url: string; playback: BoardAudioPlayback; source: FakeBoardAudioSource }> = [];

  async resume(): Promise<void> {}

  async preload(url: string): Promise<void> {
    this.preloaded.push(url);
  }

  play(url: string, playback: BoardAudioPlayback, onEnded: () => void): BoardAudioSource {
    const source = new FakeBoardAudioSource(onEnded);
    this.plays.push({ url, playback, source });
    return source;
  }
}

class FakeBoardAudioSource implements BoardAudioSource {
  stopped = false;

  constructor(private readonly onEnded: () => void) {}

  stop(): void {
    this.stopped = true;
    this.onEnded();
  }
}

function createService(backend: FakeBoardAudioBackend | null, playFallback = vi.fn()): { service: AudioService; playFallback: ReturnType<typeof vi.fn> } {
  const service = new AudioService({
    createBoardBackend: () => backend,
    now: () => backend?.nowMs ?? 0,
    playFallback
  });
  service.configure(enabledSettings);
  return { service, playFallback };
}

function createHtmlService() {
  const elements: Array<ReturnType<typeof makeElement>> = [];
  const makeElement = (src: string) => ({
    src, currentTime: 0, volume: 1,
    onended: null as (() => void) | null, onerror: null as (() => void) | null,
    play: vi.fn<() => Promise<void>>().mockResolvedValue(undefined), pause: vi.fn()
  });
  const createAudio = vi.fn((url: string) => {
    const element = makeElement(url);
    elements.push(element);
    return element as unknown as HTMLAudioElement;
  });
  const service = new AudioService({ createBoardBackend: () => null, createAudio });
  service.configure(enabledSettings);
  return { service, elements, createAudio };
}

describe("board audio service", () => {
  it("reuses and resets a completed HTML player for a different cue and gain", () => {
    const { service, elements, createAudio } = createHtmlService();
    service.playBoardCue("tntBlast");
    const first = elements[0];
    const staleEnded = first.onended;
    const staleError = first.onerror;
    first.currentTime = 0.6;
    first.onended?.();
    expect(first.currentTime).toBe(0);
    expect(first.onended).toBeNull();
    expect(first.onerror).toBeNull();
    service.playBoardCue("tilePopB", { gain: 0.2 });
    expect(createAudio).toHaveBeenCalledTimes(1);
    expect(first.src).toBe(presentationAudioUrl("tilePopB"));
    expect(first.volume).toBe(0.2);
    expect(first.play).toHaveBeenCalledTimes(2);
    const done = vi.fn();
    service.whenBoardSilent(done);
    staleEnded?.();
    staleError?.();
    expect(done).not.toHaveBeenCalled();
    first.onended?.();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("bounds HTML allocation to sixteen players across dense overlapping waves", () => {
    const { service, elements, createAudio } = createHtmlService();
    for (let index = 0; index < 40; index++) service.playBoardCue("tilePopA");
    expect(createAudio).toHaveBeenCalledTimes(16);
    expect(elements.filter(element => element.onended !== null)).toHaveLength(16);
    const done = vi.fn();
    service.whenBoardSilent(done);
    service.stopBoardSounds();
    expect(done).toHaveBeenCalledTimes(1);
    expect(elements.every(element => element.onended === null && element.onerror === null)).toBe(true);
    for (let index = 0; index < 40; index++) service.playBoardCue("comboImpact");
    expect(createAudio).toHaveBeenCalledTimes(16);
    service.configure({ ...enabledSettings, sfxEnabled: false });
    expect(elements.every(element => element.onended === null)).toBe(true);
  });

  it("recycles only the stopped owner's HTML player and ignores its late play rejection", async () => {
    const { service, elements, createAudio } = createHtmlService();
    const oldOwner = Symbol("old"), newOwner = Symbol("new");
    service.playBoardCue("tilePopA", {}, oldOwner);
    service.stopBoardSounds(oldOwner);
    let rejectPlay: (reason: Error) => void = () => { throw new Error("Missing pending play"); };
    elements[0].play.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectPlay = reject; }));
    service.playBoardCue("tilePopB", {}, oldOwner);
    service.playBoardCue("tntBlast", {}, newOwner);
    service.stopBoardSounds(oldOwner);
    service.playBoardCue("comboImpact", {}, newOwner);
    expect(createAudio).toHaveBeenCalledTimes(2);
    const done = vi.fn();
    service.whenBoardSilent(done, newOwner);
    rejectPlay(new Error("Old play aborted"));
    await Promise.resolve();
    expect(elements.filter(element => element.onended !== null)).toHaveLength(2);
    expect(done).not.toHaveBeenCalled();
    elements[0].onended?.();
    expect(done).not.toHaveBeenCalled();
    elements[1].onended?.();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it.each(["suspended", "interrupted"])("releases a %s Web Audio cue without allocating HTML fallback players", (state) => {
    const createBufferSource = vi.fn();
    vi.stubGlobal("AudioContext", class {
      state = state;
      destination = {};
      createBufferSource = createBufferSource;
      createDynamicsCompressor() {
        return { threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 },
          attack: { value: 0 }, release: { value: 0 }, connect() {} };
      }
    });
    try {
      const playFallback = vi.fn();
      const service = new AudioService({ playFallback });
      service.configure(enabledSettings);
      service.playBoardCue("comboImpact");
      const complete = vi.fn();
      service.whenBoardSilent(complete);
      expect(complete).toHaveBeenCalledTimes(1);
      service.stopBoardSounds();
      expect(playFallback).not.toHaveBeenCalled();
      expect(createBufferSource).not.toHaveBeenCalled();
      expect(complete).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });

  it("routes decoded sounds through one shared compressor instead of clipping summed cue outputs", async () => {
    const destination = {};
    const compressor = { threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 },
      attack: { value: 0 }, release: { value: 0 }, connect: vi.fn() };
    const gains: Array<{ gain: { value: number }; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
    const makeCompressor = vi.fn(() => compressor);
    vi.stubGlobal("AudioContext", class {
      state = "running";
      destination = destination;
      createDynamicsCompressor = makeCompressor;
      async decodeAudioData() { return {}; }
      createGain() {
        const node = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
        gains.push(node);
        return node;
      }
      createBufferSource() { return { buffer: null, playbackRate: { value: 1 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() }; }
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) })));
    try {
      const service = new AudioService();
      service.configure(enabledSettings);
      await service.preloadBoardSounds();
      service.playBoardCue("comboImpact");
      service.playBoardCue("tntBlast");
      expect(makeCompressor).toHaveBeenCalledTimes(1);
      expect(compressor.connect).toHaveBeenCalledWith(destination);
      expect(compressor.threshold.value).toBeLessThan(0);
      expect(compressor.ratio.value).toBeGreaterThan(1);
      expect(gains).toHaveLength(2);
      expect(gains.every(node => node.connect.mock.calls[0][0] === compressor)).toBe(true);
    } finally { vi.unstubAllGlobals(); }
  });

  it("an old scene stops only its own sounds and cannot delay or cancel the new scene", () => {
    const backend = new FakeBoardAudioBackend();
    const { service } = createService(backend);
    const oldScene = Symbol("old"), newScene = Symbol("new");
    service.playBoardCue("tntBlast", {}, oldScene);
    service.playBoardCue("comboImpact", {}, newScene);
    const oldDone = vi.fn(), newDone = vi.fn();
    service.whenBoardSilent(oldDone, oldScene);
    service.whenBoardSilent(newDone, newScene);
    service.stopBoardSounds(oldScene);
    expect(oldDone).toHaveBeenCalledTimes(1);
    expect(newDone).not.toHaveBeenCalled();
    expect(backend.plays[1].source.stopped).toBe(false);
    backend.plays[1].source.stop();
    expect(newDone).toHaveBeenCalledTimes(1);
  });

  it("tracks default HTML fallback completion and releases rejected playback", async () => {
    const element = {
      volume: 1, onended: null as (() => void) | null, onerror: null as (() => void) | null,
      play: vi.fn().mockResolvedValue(undefined), pause: vi.fn()
    };
    const service = new AudioService({ createBoardBackend: () => null,
      createAudio: () => element as unknown as HTMLAudioElement });
    service.configure(enabledSettings);
    service.playBoardCue("tntBlast");
    const done = vi.fn();
    service.whenBoardSilent(done);
    expect(done).not.toHaveBeenCalled();
    element.onended?.();
    expect(done).toHaveBeenCalledTimes(1);
    expect(element.onended).toBeNull();
    expect(element.onerror).toBeNull();
    element.play.mockRejectedValueOnce(new Error("Autoplay denied"));
    service.playBoardCue("comboImpact");
    service.whenBoardSilent(done);
    await Promise.resolve();
    expect(done).toHaveBeenCalledTimes(2);
    expect(element.pause).toHaveBeenCalledTimes(2);
  });

  it("bounds a large clear to one body and three pop variations", () => {
    const backend = new FakeBoardAudioBackend();
    const { service } = createService(backend);
    service.playMatchClear(Array.from({ length: 49 }, (_, index) => ({
      sample: index % 2 ? "tile_pop_b" : "tile_pop_a", playbackRate: 1
    })));
    expect(backend.plays.map(entry => entry.url)).toEqual([
      "tileClusterBody", "tilePopA", "tilePopB", "tilePopA"
    ].map(key => presentationAudioUrl(key as keyof typeof presentationAudioManifest)));
  });

  it("coalesces simultaneous group bodies and bounds every clear wave without losing later variations", () => {
    const dispatch = createMatchAudioDispatch();
    const variation: TilePopVariation = { sample: "tile_pop_b", playbackRate: 1.04 };
    const first = dispatch("left", 0, variation);
    const simultaneous = dispatch("right", 0, variation);
    expect(first.map(cue => cue.key)).toEqual(["tileClusterBody", "tilePopB"]);
    expect(simultaneous.map(cue => cue.key)).toEqual(["tilePopB"]);
    expect(simultaneous[0].playback.playbackRate).toBe(1.04);
    const cues = [...first, ...simultaneous];
    for (let index = 1; index <= 49; index++) cues.push(...dispatch(String(index), index * 50, variation));
    expect(cues.filter(cue => cue.key === "tileClusterBody")).toHaveLength(4);
    expect(cues.filter(cue => cue.key === "tilePopB")).toHaveLength(8);
    const nextWave = createMatchAudioDispatch();
    expect(nextWave("left", 0, variation).map(cue => cue.key)).toEqual(["tileClusterBody", "tilePopB"]);
  });

  it("spaces match bodies at the 45 ms boundary independently of their pop variations", () => {
    const dispatch = createMatchAudioDispatch();
    const variation: TilePopVariation = { sample: "tile_pop_a", playbackRate: 1 };
    expect(dispatch("first", 0, variation).map(cue => cue.key)).toEqual(["tileClusterBody", "tilePopA"]);
    expect(dispatch("early", 44, variation).map(cue => cue.key)).toEqual(["tilePopA"]);
    expect(dispatch("boundary", 45, variation).map(cue => cue.key)).toEqual(["tileClusterBody", "tilePopA"]);
  });

  it("reclaims a stopped slot immediately even when WebAudio delivers ended asynchronously", () => {
    const backend = new FakeBoardAudioBackend();
    backend.play = (url, playback, _onEnded) => {
      const source = new FakeBoardAudioSource(() => undefined);
      backend.plays.push({ url, playback, source });
      return source;
    };
    const { service } = createService(backend);
    for (let index = 0; index < 40; index++) service.playBoardCue("tilePopA");
    expect(backend.plays.filter(entry => !entry.source.stopped)).toHaveLength(16);
    expect(backend.plays.slice(0, 24).every(entry => entry.source.stopped)).toBe(true);
  });

  it("waits for the final power-up source and notifies completion exactly once", () => {
    const backend = new FakeBoardAudioBackend();
    const { service } = createService(backend);
    service.playBoardCue("tntBlast");
    service.playBoardCue("tilePopA");
    const complete = vi.fn();
    service.whenBoardSilent(complete);
    backend.plays[1].source.stop();
    expect(complete).not.toHaveBeenCalled();
    backend.plays[0].source.stop();
    backend.plays[0].source.stop();
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("cancels an old scene completion before releasing every board sound on teardown", () => {
    const backend = new FakeBoardAudioBackend();
    const { service } = createService(backend);
    service.playBoardCue("comboImpact");
    const complete = vi.fn();
    const cancel = service.whenBoardSilent(complete);
    cancel();
    service.stopBoardSounds();
    expect(backend.plays.every(entry => entry.source.stopped)).toBe(true);
    expect(complete).not.toHaveBeenCalled();
    service.whenBoardSilent(complete);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("muting SFX stops board tails without disabling voice or music", () => {
    const backend = new FakeBoardAudioBackend();
    const { service } = createService(backend);
    service.playBoardCue("lightBallRelease");
    const complete = vi.fn();
    service.whenBoardSilent(complete);
    service.configure({ ...enabledSettings, sfxEnabled: false });
    expect(backend.plays[0].source.stopped).toBe(true);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(service.playBoardCue("tntBlast")).toBe(false);
  });

  it("preloads every approved board sample once", async () => {
    const backend = new FakeBoardAudioBackend();
    const { service } = createService(backend);

    await service.preloadBoardSounds();
    await service.preloadBoardSounds();

    expect(backend.preloaded).toEqual(Object.keys(presentationAudioManifest).map((key) => presentationAudioUrl(key as keyof typeof presentationAudioManifest)));
  });

  it("plays one clear body and deterministic short pop variants instead of the legacy tile-clear sound", () => {
    const backend = new FakeBoardAudioBackend();
    const { service } = createService(backend);
    const variations: TilePopVariation[] = [
      { sample: "tile_pop_a", playbackRate: 0.94 },
      { sample: "tile_pop_b", playbackRate: 1 },
      { sample: "tile_pop_a", playbackRate: 1.06 }
    ];

    service.playMatchClear(variations);

    expect(backend.plays.map((entry) => entry.url)).toEqual([
      presentationAudioUrl("tileClusterBody"),
      presentationAudioUrl("tilePopA"),
      presentationAudioUrl("tilePopB"),
      presentationAudioUrl("tilePopA")
    ]);
    expect(backend.plays.slice(1).map((entry) => entry.playback.playbackRate)).toEqual([0.94, 1, 1.06]);
    expect(backend.plays.some((entry) => entry.url.endsWith("sfx_tile_clear.mp3"))).toBe(false);
  });

  it("coalesces cascade landings inside one 45 ms window and applies capped chain pitch", () => {
    const backend = new FakeBoardAudioBackend();
    const { service } = createService(backend);

    service.playCascadeLand();
    backend.nowMs = 44;
    service.playCascadeLand();
    backend.nowMs = 45;
    service.playCascadeLand();
    service.playChain(9);

    expect(backend.plays.filter((entry) => entry.url === presentationAudioUrl("cascadeLand"))).toHaveLength(2);
    expect(backend.plays.at(-1)?.playback.playbackRate).toBe(chainPlaybackRate(9));
  });

  it("keeps board cues enabled when voice is disabled and suppresses them only when SFX are disabled", () => {
    const backend = new FakeBoardAudioBackend();
    const { service } = createService(backend);

    service.configure({ ...enabledSettings, voiceEnabled: false });
    expect(service.playBoardCue("tntArm")).toBe(true);
    service.configure({ ...enabledSettings, sfxEnabled: false });
    expect(service.playBoardCue("tntBlast")).toBe(false);

    expect(backend.plays.map((entry) => entry.url)).toEqual([presentationAudioUrl("tntArm")]);
  });

  it("never leaves more than sixteen active board sources and drops the oldest transient first", () => {
    const backend = new FakeBoardAudioBackend();
    const { service } = createService(backend);

    for (let index = 0; index < 17; index += 1) service.playBoardCue("tilePopA");

    expect(backend.plays).toHaveLength(17);
    expect(backend.plays.filter((entry) => entry.source.stopped)).toHaveLength(1);
  });

  it("uses the HTML fallback without throwing when decoded board audio is unavailable", () => {
    const { service, playFallback } = createService(null);

    expect(() => service.playBoardCue("comboImpact")).not.toThrow();
    expect(playFallback).toHaveBeenCalledWith(presentationAudioUrl("comboImpact"), expect.any(Number));
  });

  it("imports in Node without touching browser globals", () => {
    expect(AudioService).toBeTypeOf("function");
  });
});
