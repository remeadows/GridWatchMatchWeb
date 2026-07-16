import { describe, expect, it, vi } from "vitest";

import { presentationAudioUrl } from "../data/assets";
import { presentationAudioManifest } from "../data/presentationAssets";
import { chainPlaybackRate, type TilePopVariation } from "../game/presentation";
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
    service.playBoardCue("tntArm");
    service.configure({ ...enabledSettings, sfxEnabled: false });
    service.playBoardCue("tntBlast");

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
