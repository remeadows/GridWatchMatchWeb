import { describe, expect, it } from "vitest";

import { LOOP_CROSSFADE_MS, MusicPlayer, TRACK_CROSSFADE_MS, type MusicVoice } from "../services/music";

class FakeVoice implements MusicVoice {
  gain = -1;
  positionMs = 0;
  durationMs: number | null = 120_000;
  started = false;
  stopped = false;
  refuse = false;
  private ended: (() => void) | null = null;

  constructor(readonly url: string) {}

  start(): Promise<void> {
    if (this.refuse) return Promise.reject(new Error("blocked until a gesture"));
    this.started = true;
    return Promise.resolve();
  }

  stop(): void {
    this.stopped = true;
  }

  setGain(gain: number): void {
    this.gain = gain;
  }

  onEnded(listener: () => void): void {
    this.ended = listener;
  }

  finish(): void {
    this.ended?.();
  }
}

function harness(options: { refuseFirst?: boolean } = {}) {
  const voices: FakeVoice[] = [];
  let nowMs = 0;
  let ticking = false;
  const player = new MusicPlayer({
    createVoice: (url) => {
      const voice = new FakeVoice(url);
      if (options.refuseFirst && voices.length === 0) voice.refuse = true;
      voices.push(voice);
      return voice;
    },
    now: () => nowMs,
    startTicker: () => {
      ticking = true;
      return () => {
        ticking = false;
      };
    }
  });
  const advance = (ms: number, positions = true) => {
    nowMs += ms;
    if (positions) for (const voice of voices) if (voice.started && !voice.stopped) voice.positionMs += ms;
    player.tick();
  };
  return { player, voices, advance, isTicking: () => ticking };
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("music player", () => {
  it("fades the first track in from silence to its level", () => {
    const { player, voices, advance } = harness();
    player.play("menu.mp3", 0.8);
    expect(voices).toHaveLength(1);
    expect(voices[0].started).toBe(true);
    expect(voices[0].gain).toBe(0);
    advance(TRACK_CROSSFADE_MS / 2);
    expect(voices[0].gain).toBeGreaterThan(0);
    expect(voices[0].gain).toBeLessThan(0.8);
    advance(TRACK_CROSSFADE_MS);
    expect(voices[0].gain).toBeCloseTo(0.8, 5);
  });

  it("does nothing when asked for the track that is already playing", () => {
    const { player, voices, advance } = harness();
    player.play("menu.mp3", 0.8);
    advance(5_000);
    player.play("menu.mp3", 0.8);
    expect(voices).toHaveLength(1);
    expect(voices[0].stopped).toBe(false);
  });

  it("crossfades to another track and stops the old one when it is silent", () => {
    const { player, voices, advance } = harness();
    player.play("menu.mp3", 0.8);
    advance(5_000);
    player.play("gameplay.mp3", 0.6);
    expect(voices).toHaveLength(2);
    advance(TRACK_CROSSFADE_MS / 2);
    // Equal power: neither voice is silent or at full level half way through.
    expect(voices[0].gain).toBeGreaterThan(0.3);
    expect(voices[0].gain).toBeLessThan(0.8);
    expect(voices[1].gain).toBeGreaterThan(0.2);
    expect(voices[1].gain).toBeLessThan(0.6);
    expect(voices[0].stopped).toBe(false);
    advance(TRACK_CROSSFADE_MS);
    expect(voices[0].stopped).toBe(true);
    expect(voices[1].gain).toBeCloseTo(0.6, 5);
  });

  it("loops by crossfading into a fresh copy before the end, with no silence", () => {
    const { player, voices, advance } = harness();
    player.play("gameplay.mp3", 0.6);
    advance(TRACK_CROSSFADE_MS);
    voices[0].positionMs = 120_000 - LOOP_CROSSFADE_MS - 100;
    advance(50);
    expect(voices).toHaveLength(1);
    advance(100);
    expect(voices).toHaveLength(2);
    expect(voices[1].url).toBe("gameplay.mp3");
    expect(voices[1].started).toBe(true);
    advance(LOOP_CROSSFADE_MS / 2);
    const powerMidway = voices[0].gain ** 2 + voices[1].gain ** 2;
    expect(powerMidway).toBeCloseTo(0.6 ** 2, 2);
    advance(LOOP_CROSSFADE_MS);
    expect(voices[0].stopped).toBe(true);
    expect(voices[1].gain).toBeCloseTo(0.6, 5);
    // The copy loops in its turn.
    voices[1].positionMs = 120_000 - LOOP_CROSSFADE_MS + 10;
    advance(50);
    expect(voices).toHaveLength(3);
  });

  it("restarts at once if a track ends before a tick could start the crossfade", () => {
    const { player, voices, advance } = harness();
    player.play("gameplay.mp3", 0.6);
    advance(TRACK_CROSSFADE_MS);
    voices[0].finish();
    expect(voices).toHaveLength(2);
    expect(voices[1].started).toBe(true);
    expect(voices[1].gain).toBeCloseTo(0.6, 5);
    expect(voices[0].stopped).toBe(true);
  });

  it("does not loop a track whose length is still unknown", () => {
    const { player, voices, advance } = harness();
    player.play("gameplay.mp3", 0.6);
    voices[0].durationMs = null;
    advance(200_000);
    expect(voices).toHaveLength(1);
  });

  it("mutes without stopping, and comes back at the same place", () => {
    const { player, voices, advance } = harness();
    player.play("menu.mp3", 0.8);
    advance(TRACK_CROSSFADE_MS);
    player.setMuted(true);
    expect(voices[0].gain).toBe(0);
    expect(voices[0].stopped).toBe(false);
    advance(1_000);
    expect(voices[0].gain).toBe(0);
    player.setMuted(false);
    expect(voices[0].gain).toBeCloseTo(0.8, 5);
  });

  it("stops everything and the ticker on stop", () => {
    const { player, voices, advance, isTicking } = harness();
    player.play("menu.mp3", 0.8);
    advance(100);
    player.play("gameplay.mp3", 0.6);
    expect(isTicking()).toBe(true);
    player.stop();
    expect(voices.every((voice) => voice.stopped)).toBe(true);
    expect(isTicking()).toBe(false);
    expect(player.currentUrl()).toBeNull();
  });

  it("keeps a track the browser refused and starts it on retry", async () => {
    const { player, voices } = harness({ refuseFirst: true });
    player.play("menu.mp3", 0.8);
    await settle();
    expect(voices[0].started).toBe(false);
    expect(player.currentUrl()).toBeNull();
    player.retry();
    expect(voices).toHaveLength(2);
    expect(voices[1].url).toBe("menu.mp3");
    expect(voices[1].started).toBe(true);
    expect(player.currentUrl()).toBe("menu.mp3");
  });

  it("forgets a refused track once another is asked for or music is stopped", async () => {
    const { player, voices } = harness({ refuseFirst: true });
    player.play("menu.mp3", 0.8);
    await settle();
    player.stop();
    player.retry();
    expect(voices).toHaveLength(1);
  });

  it("survives a backend with no audio at all", () => {
    const player = new MusicPlayer({ createVoice: () => null, now: () => 0, startTicker: () => () => undefined });
    expect(() => {
      player.play("menu.mp3", 0.8);
      player.tick();
      player.retry();
      player.stop();
    }).not.toThrow();
  });
});
