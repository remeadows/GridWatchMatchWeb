import { audioUrl } from "../data/assets";
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

class AudioService {
  private music: HTMLAudioElement | null = null;
  private settings: SettingsState | null = null;

  configure(settings: SettingsState): void {
    this.settings = settings;
    if (this.music) this.music.muted = !settings.musicEnabled;
  }

  playMusic(track: MusicTrack): void {
    if (!this.settings?.musicEnabled) return;
    if (this.music?.dataset.track === track && !this.music.paused) return;
    this.stopMusic();
    const audio = new Audio(audioUrl(track));
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
    const audio = new Audio(audioUrl(sound));
    audio.volume = sound.startsWith("vo_") ? 0.8 : 0.65;
    void audio.play().catch(() => undefined);
  }

  vibrate(pattern: number | number[]): void {
    if ("vibrate" in navigator) navigator.vibrate(pattern);
  }
}

export const audioService = new AudioService();
