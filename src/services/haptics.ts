import type { SettingsState } from "../state/save";

// Russ, 2026-11-05: "phone haptics so when pieces move, explode, fall, etc the player feels it".
//
// Android browsers vibrate through `navigator.vibrate`, with a pattern per moment. Safari and
// Chrome on iPhone have no vibration API. The iOS 18 trick of clicking a hidden
// `<input type="checkbox" switch>` from code was tried on Russ's iPhone the same day
// (`public/haptics-check.html`, since removed): only his own finger on the switch gave a tick,
// never a click from code, hidden or visible, in a tap or after it. So an iPhone gets none.

export type HapticKind =
  | "swap" | "tap" | "invalid" | "land" | "match" | "bigMatch"
  | "create" | "launch" | "impact" | "blast" | "combo" | "bigCombo";

interface HapticSpec {
  /** Vibration pattern: on, off, on... in milliseconds. */
  pattern: number[];
  /** A pulse never cuts off a heavier one that is still playing. */
  weight: number;
}

export const HAPTICS: Record<HapticKind, HapticSpec> = {
  land: { pattern: [6], weight: 0 },
  swap: { pattern: [10], weight: 1 },
  tap: { pattern: [12], weight: 1 },
  invalid: { pattern: [8, 50, 8], weight: 1 },
  match: { pattern: [14], weight: 1 },
  launch: { pattern: [12], weight: 1 },
  bigMatch: { pattern: [22], weight: 2 },
  impact: { pattern: [18], weight: 2 },
  create: { pattern: [16, 30, 24], weight: 2 },
  blast: { pattern: [18, 35, 28], weight: 3 },
  combo: { pattern: [20, 30, 28], weight: 3 },
  bigCombo: { pattern: [24, 35, 34], weight: 4 }
};

/** Pulses closer together than this blur into one buzz, so the lighter or equal one is dropped. */
export const HAPTIC_MIN_GAP_MS = 45;

export interface HapticEnvironment {
  now(): number;
  /** The device's vibration, or null where there is none. */
  vibrate: ((pattern: number[]) => void) | null;
  record?(kind: HapticKind): void;
}

export class Haptics {
  private enabled = true;
  private lastAt = Number.NEGATIVE_INFINITY;
  private lastWeight = -1;
  private busyUntil = Number.NEGATIVE_INFINITY;
  private busyWeight = -1;

  constructor(private readonly env: HapticEnvironment) {}

  /** Whether this device can vibrate at all; Settings shows the switch only where it can. */
  get supported(): boolean {
    return this.env.vibrate !== null;
  }

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
    this.busyUntil = now + spec.pattern.reduce((sum, ms) => sum + ms, 0);
    this.busyWeight = spec.weight;
    this.env.record?.(kind);
    this.env.vibrate?.(spec.pattern);
  }
}

function browserEnvironment(): HapticEnvironment {
  const hasWindow = typeof window !== "undefined" && typeof navigator !== "undefined";
  const vibrate = hasWindow && typeof navigator.vibrate === "function"
    ? (pattern: number[]) => { navigator.vibrate(pattern); }
    : null;
  const testMode = hasWindow && new URLSearchParams(window.location.search).get("gwTestMode") === "1";
  return {
    now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
    vibrate,
    record: testMode
      ? (kind) => {
          const target = window as Window & { __gwHaptics?: HapticKind[] };
          (target.__gwHaptics ??= []).push(kind);
        }
      : undefined
  };
}

export const haptics = new Haptics(browserEnvironment());
