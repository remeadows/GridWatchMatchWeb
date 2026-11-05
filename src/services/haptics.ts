import type { SettingsState } from "../state/save";

// Russ, 2026-11-05: "phone haptics so when pieces move, explode, fall, etc the player feels it".
//
// Android browsers vibrate through `navigator.vibrate`, with a pattern per moment. Safari on iPhone
// has no vibration API. iOS 18 and later give one light tick whenever a switch control
// (`<input type="checkbox" switch>`) is toggled, so on an iPhone each moment is that tick, once or a
// few times in a row. Apple does not document it as a haptics API: an iOS update can change it.

export type HapticKind =
  | "swap" | "tap" | "invalid" | "land" | "match" | "bigMatch"
  | "create" | "launch" | "impact" | "blast" | "combo" | "bigCombo";

interface HapticSpec {
  /** Android vibration pattern: on, off, on... in milliseconds. */
  pattern: number[];
  /** A pulse never cuts off a heavier one that is still playing. */
  weight: number;
  /** Ticks on an iPhone. */
  ticks: number;
}

export const HAPTICS: Record<HapticKind, HapticSpec> = {
  land: { pattern: [6], weight: 0, ticks: 1 },
  swap: { pattern: [10], weight: 1, ticks: 1 },
  tap: { pattern: [12], weight: 1, ticks: 1 },
  invalid: { pattern: [8, 50, 8], weight: 1, ticks: 2 },
  match: { pattern: [14], weight: 1, ticks: 1 },
  launch: { pattern: [12], weight: 1, ticks: 1 },
  bigMatch: { pattern: [22], weight: 2, ticks: 2 },
  impact: { pattern: [18], weight: 2, ticks: 1 },
  create: { pattern: [16, 30, 24], weight: 2, ticks: 2 },
  blast: { pattern: [18, 35, 28], weight: 3, ticks: 2 },
  combo: { pattern: [20, 30, 28], weight: 3, ticks: 2 },
  bigCombo: { pattern: [24, 35, 34], weight: 4, ticks: 3 }
};

/** Pulses closer together than this blur into one buzz, so the lighter or equal one is dropped. */
export const HAPTIC_MIN_GAP_MS = 45;
/** Ticks of one iPhone pulse are spaced this far apart. */
export const HAPTIC_TICK_SPACING_MS = 70;

export interface HapticEnvironment {
  now(): number;
  vibrate: ((pattern: number[]) => void) | null;
  /** One iPhone tick, or null where there is none. */
  tick: (() => void) | null;
  later(callback: () => void, ms: number): void;
  record?(kind: HapticKind): void;
}

export class Haptics {
  private enabled = true;
  private lastAt = Number.NEGATIVE_INFINITY;
  private lastWeight = -1;
  private busyUntil = Number.NEGATIVE_INFINITY;
  private busyWeight = -1;

  constructor(private readonly env: HapticEnvironment) {}

  configure(settings: Pick<SettingsState, "hapticsEnabled">): void {
    this.enabled = settings.hapticsEnabled;
  }

  pulse(kind: HapticKind): void {
    if (!this.enabled) return;
    const spec = HAPTICS[kind];
    const now = this.env.now();
    if (now < this.busyUntil && spec.weight < this.busyWeight) return;
    if (now - this.lastAt < HAPTIC_MIN_GAP_MS && spec.weight <= this.lastWeight) return;
    this.lastAt = now;
    this.lastWeight = spec.weight;
    const ticks = this.env.vibrate ? 1 : spec.ticks;
    const lengthMs = this.env.vibrate
      ? spec.pattern.reduce((sum, ms) => sum + ms, 0)
      : (ticks - 1) * HAPTIC_TICK_SPACING_MS;
    this.busyUntil = now + lengthMs;
    this.busyWeight = spec.weight;
    this.env.record?.(kind);
    if (this.env.vibrate) {
      this.env.vibrate(spec.pattern);
      return;
    }
    const tick = this.env.tick;
    if (!tick) return;
    tick();
    for (let i = 1; i < ticks; i += 1) this.env.later(tick, i * HAPTIC_TICK_SPACING_MS);
  }
}

/** True on an iPhone or iPad, including an iPad that reports itself as a Mac. */
export function isAppleTouchDevice(nav: Pick<Navigator, "userAgent" | "maxTouchPoints"> & { platform?: string }): boolean {
  if (/iPhone|iPad|iPod/.test(nav.userAgent)) return true;
  return nav.platform === "MacIntel" && nav.maxTouchPoints > 1;
}

function switchTicker(doc: Document): () => void {
  let label: HTMLLabelElement | null = null;
  return () => {
    if (!label || !label.isConnected) {
      label = doc.createElement("label");
      label.dataset.gwHaptic = "";
      label.setAttribute("aria-hidden", "true");
      label.style.display = "none";
      const input = doc.createElement("input");
      input.type = "checkbox";
      input.setAttribute("switch", "");
      input.tabIndex = -1;
      label.appendChild(input);
      doc.body.appendChild(label);
    }
    label.click();
  };
}

function browserEnvironment(): HapticEnvironment {
  const hasWindow = typeof window !== "undefined" && typeof navigator !== "undefined";
  const vibrate = hasWindow && typeof navigator.vibrate === "function"
    ? (pattern: number[]) => { navigator.vibrate(pattern); }
    : null;
  const tick = hasWindow && !vibrate && isAppleTouchDevice(navigator) ? switchTicker(document) : null;
  const testMode = hasWindow && new URLSearchParams(window.location.search).get("gwTestMode") === "1";
  return {
    now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
    vibrate,
    tick,
    later: (callback, ms) => { setTimeout(callback, ms); },
    record: testMode
      ? (kind) => {
          const target = window as Window & { __gwHaptics?: HapticKind[] };
          (target.__gwHaptics ??= []).push(kind);
        }
      : undefined
  };
}

export const haptics = new Haptics(browserEnvironment());
