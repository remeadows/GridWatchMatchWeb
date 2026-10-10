import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { presentationAudioUrl } from "../data/assets";
import { presentationAudioManifest } from "../data/presentationAssets";
import { chainPlaybackRate, type TilePopVariation } from "../game/presentation";
import {
  AudioService,
  musicFiles,
  openingLines,
  voiceFile,
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

describe("board audio service", () => {
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

describe("music through the audio service", () => {
  function musicService(settings: SettingsState = enabledSettings, firstMusicFile = () => 0) {
    const started: string[] = [];
    const stopped: string[] = [];
    const service = new AudioService({
      createBoardBackend: () => null,
      now: () => 0,
      firstMusicFile,
      createMusicVoice: (url) => ({
        start: () => {
          started.push(url);
          return Promise.resolve();
        },
        stop: () => {
          stopped.push(url);
        },
        setGain: () => undefined,
        positionMs: 0,
        durationMs: null,
        onEnded: () => undefined
      })
    });
    service.configure(settings);
    return { service, started, stopped };
  }
  const file = (url: string) => url.replace(/^.*assets\/audio\//, "");

  it("gives every track two prepared files of its own", () => {
    const all = (["menu", "gameplay", "boss"] as const).flatMap((track) => musicFiles(track));
    expect(all).toHaveLength(6);
    expect(new Set(all).size).toBe(6);
    for (const name of all) {
      expect(name).toMatch(/^music\/(menu|gameplay|boss)_[ab]\.mp3$/);
      expect(existsSync(join(process.cwd(), "public/assets/audio", name)), name).toBe(true);
    }
  });

  it("starts a track once, however often the same track is asked for", () => {
    const { service, started } = musicService();
    service.playMusic("menu");
    service.playMusic("menu");
    service.playMusic("menu");
    expect(started.map(file)).toEqual([musicFiles("menu")[0]]);
  });

  it("plays a track's other file the next time the track comes round", () => {
    const { service, started } = musicService();
    service.playMusic("menu");
    service.playMusic("gameplay", { fresh: true });
    service.playMusic("menu");
    service.playMusic("gameplay", { fresh: true });
    service.playMusic("menu");
    expect(started.map(file)).toEqual([
      musicFiles("menu")[0],
      musicFiles("gameplay")[0],
      musicFiles("menu")[1],
      musicFiles("gameplay")[1],
      musicFiles("menu")[0]
    ]);
  });

  it("changes file from one level to the next without leaving the game", () => {
    const { service, started } = musicService();
    service.playMusic("gameplay", { fresh: true });
    service.playMusic("gameplay", { fresh: true });
    service.playMusic("boss", { fresh: true });
    service.playMusic("gameplay", { fresh: true });
    expect(started.map(file)).toEqual([
      musicFiles("gameplay")[0],
      musicFiles("gameplay")[1],
      musicFiles("boss")[0],
      musicFiles("gameplay")[0]
    ]);
  });

  it("can begin on either file", () => {
    const { service, started } = musicService(enabledSettings, () => 0.99);
    service.playMusic("menu");
    expect(started.map(file)).toEqual([musicFiles("menu")[1]]);
  });

  it("plays nothing while music is off, and stops what is playing when it is turned off", () => {
    const off = musicService({ ...enabledSettings, musicEnabled: false });
    off.service.playMusic("menu");
    expect(off.started).toHaveLength(0);

    const { service, started, stopped } = musicService();
    service.playMusic("menu");
    service.configure({ ...enabledSettings, musicEnabled: false });
    expect(stopped).toEqual(started);
    service.configure(enabledSettings);
    service.playMusic("menu");
    expect(started).toHaveLength(2);
  });
});

describe("Tish's voice lines", () => {
  const lines = [
    "connectionSecure", "gridCompromised", "areaCleared", "breachAlert",
    "initiatingCountermeasures", "defencesOnline", "securingTheGrid", "tracingTheIntrusion", "systemsReady"
  ] as const;

  it("has a prepared recording for every line", () => {
    for (const line of lines) {
      expect(voiceFile(line)).toMatch(/^voice\/tish_[a-z_]+\.mp3$/);
      expect(existsSync(join(process.cwd(), "public/assets/audio", voiceFile(line))), line).toBe(true);
    }
    expect(new Set(lines.map((line) => voiceFile(line))).size).toBe(lines.length);
  });

  it("plays through the decoded-audio backend at its own level", () => {
    const backend = new FakeBoardAudioBackend();
    const { service, playFallback } = createService(backend);
    service.playVoice("connectionSecure");
    expect(backend.plays).toHaveLength(1);
    expect(backend.plays[0].url).toContain(voiceFile("connectionSecure"));
    expect(backend.plays[0].playback).toEqual({ gain: 1, playbackRate: 1 });
    expect(playFallback).not.toHaveBeenCalled();
  });

  it("says a line that is not loaded yet as soon as it has loaded, never through an <audio> element", async () => {
    const backend = new FakeBoardAudioBackend();
    let ready = false;
    let finishLoading: () => void = () => undefined;
    backend.preload = () => new Promise<void>((resolve) => {
      finishLoading = () => {
        ready = true;
        resolve();
      };
    });
    const play = backend.play.bind(backend);
    backend.play = (url, playback, onEnded) => (ready ? play(url, playback, onEnded) : (null as unknown as BoardAudioSource));
    const { service, playFallback } = createService(backend);
    service.playVoice("breachAlert");
    expect(backend.plays).toHaveLength(0);
    finishLoading();
    await Promise.resolve();
    await Promise.resolve();
    expect(backend.plays).toHaveLength(1);
    expect(backend.plays[0].url).toContain(voiceFile("breachAlert"));
    expect(playFallback).not.toHaveBeenCalled();
  });

  it("lets a line go unsaid when loading it took too long", async () => {
    const backend = new FakeBoardAudioBackend();
    let ready = false;
    let finishLoading: () => void = () => undefined;
    backend.preload = () => new Promise<void>((resolve) => {
      finishLoading = () => {
        ready = true;
        resolve();
      };
    });
    const play = backend.play.bind(backend);
    backend.play = (url, playback, onEnded) => (ready ? play(url, playback, onEnded) : (null as unknown as BoardAudioSource));
    const { service } = createService(backend);
    service.playVoice("connectionSecure");
    backend.nowMs += 5_000;
    finishLoading();
    await Promise.resolve();
    await Promise.resolve();
    expect(backend.plays).toHaveLength(0);
  });

  it("is silenced by the voice setting alone", () => {
    const backend = new FakeBoardAudioBackend();
    const { service } = createService(backend);
    service.configure({ ...enabledSettings, sfxEnabled: false });
    service.playVoice("gridCompromised");
    expect(backend.plays).toHaveLength(1);
    service.configure({ ...enabledSettings, voiceEnabled: false });
    service.playVoice("gridCompromised");
    expect(backend.plays).toHaveLength(1);
  });

  it("opens each level with the next of five lines, and none twice running", () => {
    expect(openingLines()).toHaveLength(5);
    expect(new Set(openingLines()).size).toBe(5);
    expect(openingLines()).toContain("initiatingCountermeasures");
    const backend = new FakeBoardAudioBackend();
    const service = new AudioService({ createBoardBackend: () => backend, now: () => 0, firstOpening: () => 0 });
    service.configure(enabledSettings);
    for (let level = 0; level < 7; level += 1) service.playOpening();
    const said = backend.plays.map((entry) => entry.url.replace(/^.*assets\/audio\//, ""));
    expect(said.slice(0, 5)).toEqual(openingLines().map((line) => voiceFile(line)));
    expect(said.slice(5)).toEqual(said.slice(0, 2));
    expect(said.every((file, index) => index === 0 || file !== said[index - 1])).toBe(true);
  });

  it("can open on any of them, and does not use up a turn while the voice is off", () => {
    const backend = new FakeBoardAudioBackend();
    const service = new AudioService({ createBoardBackend: () => backend, now: () => 0, firstOpening: () => 0.99 });
    service.configure({ ...enabledSettings, voiceEnabled: false });
    service.playOpening();
    service.playOpening();
    expect(backend.plays).toHaveLength(0);
    service.configure(enabledSettings);
    service.playOpening();
    expect(backend.plays[0].url).toContain(voiceFile(openingLines()[4]));
  });

  it("loads every line ahead of time", async () => {
    const backend = new FakeBoardAudioBackend();
    const { service } = createService(backend);
    await service.preloadVoice();
    expect(backend.preloaded).toHaveLength(lines.length);
  });
});
