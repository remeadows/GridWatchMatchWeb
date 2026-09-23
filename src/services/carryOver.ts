// Spec §6.3/§6.4: old-hostname banner state and the Nexus-side receiver for the carry hand-off.
import { canonicalJson } from "@gridwatch/account-kit/saves-schema";
import type { ReceiveResult } from "@gridwatch/account-kit";
import { CLOUD_SLOTS, applyCloudPayload, isCloudSlot, isPristine, projection, type CloudSlot } from "../state/cloudSaves";
import { normalizeSave, type SaveState } from "../state/save";

export const OLD_MATCH_ORIGIN = "https://gridwatchmatchweb.warsignallabs.net";
export const CARRY_MARKER_KEY = "gridwatch-match-web.carry.v1";
const LOOPBACK_HTTP = /^http:\/\/(localhost|127\.0\.0\.1):\d{1,5}$/;

export type BannerState = "move" | "moved" | "moved-again" | "nothing";
export interface CarryMarker { at: string; sent: Partial<Record<CloudSlot, string>> }
type Slots = Partial<Record<CloudSlot, Record<string, unknown>>>;

/** Production is exactly the old https origin; a loopback origin is added only for the local e2e. */
export function carryFromOrigins(testOrigin: unknown): string[] {
  return typeof testOrigin === "string" && LOOPBACK_HTTP.test(testOrigin) ? [OLD_MATCH_ORIGIN, testOrigin] : [OLD_MATCH_ORIGIN];
}

/** The banner belongs only where Nexus will accept the offer: an origin in the kit's `carryFrom`
 *  list, and never Nexus itself. Any other host (the workers.dev fallback, a preview) would open
 *  Nexus only to have the offer ignored, so it gets no banner at all. */
export function showsCarryBanner(origin: string, carryFrom: readonly string[], nexusOrigin: string): boolean {
  return origin !== nexusOrigin && carryFrom.includes(origin);
}

/** Plan ruling: only slots with real progress travel, so default settings never overwrite custom ones. */
export function slotsToCarry(save: SaveState): Slots {
  const out: Slots = {};
  for (const slot of CLOUD_SLOTS) if (!isPristine(save, slot)) out[slot] = projection(save, slot);
  return out;
}

export function markerFor(sent: Slots, at: Date): CarryMarker {
  const fingerprints: Partial<Record<CloudSlot, string>> = {};
  for (const slot of CLOUD_SLOTS) { const p = sent[slot]; if (p) fingerprints[slot] = canonicalJson(p); }
  return { at: at.toISOString(), sent: fingerprints };
}

function defaultStorage(): Storage | undefined {
  try { return typeof localStorage === "undefined" ? undefined : localStorage; } catch { return undefined; }
}

export function readCarryMarker(storage: Storage | undefined = defaultStorage()): CarryMarker | null {
  try {
    const raw = storage?.getItem(CARRY_MARKER_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== "object" || value === null) return null;
    const { at, sent } = value as { at?: unknown; sent?: unknown };
    if (typeof at !== "string" || typeof sent !== "object" || sent === null || Array.isArray(sent)) return null;
    const clean: Partial<Record<CloudSlot, string>> = {};
    for (const [slot, print] of Object.entries(sent)) if (isCloudSlot(slot) && typeof print === "string") clean[slot] = print;
    return { at, sent: clean };
  } catch {
    return null;
  }
}

export function writeCarryMarker(marker: CarryMarker, storage: Storage | undefined = defaultStorage()): void {
  try { storage?.setItem(CARRY_MARKER_KEY, JSON.stringify(marker)); } catch { /* private mode: banner falls back to "move" */ }
}

export function bannerState(save: SaveState, marker: CarryMarker | null): BannerState {
  const toCarry = slotsToCarry(save);
  const hasProgress = Object.keys(toCarry).length > 0;
  if (!hasProgress) return "nothing";
  if (!marker) return "move";
  const same = CLOUD_SLOTS.every((slot) => {
    const now = toCarry[slot];
    return (marker.sent[slot] ?? null) === (now ? canonicalJson(now) : null);
  });
  return same ? "moved" : "moved-again";
}

function cloudSlotsOf(incoming: Record<string, unknown>): CloudSlot[] {
  return Object.keys(incoming).filter(isCloudSlot);
}

export function needsReplacePrompt(current: SaveState, incoming: Record<string, unknown>): boolean {
  return cloudSlotsOf(incoming).some((slot) => !isPristine(current, slot));
}

export function applyIncoming(current: SaveState, incoming: Record<string, unknown>): SaveState {
  let next = current;
  for (const slot of cloudSlotsOf(incoming)) next = applyCloudPayload(next, slot, incoming[slot]);
  return normalizeSave(next);
}

export async function handleCarryOffer(args: {
  current: () => SaveState; slots: Record<string, unknown>; askReplace: () => Promise<boolean>; commit: (next: SaveState) => void;
}): Promise<"accepted" | "declined"> {
  const slots = cloudSlotsOf(args.slots);
  if (slots.length === 0) return "declined";
  let beforePrompt = args.current();
  if (needsReplacePrompt(beforePrompt, args.slots)) {
    // Where the kit's dialog is non-modal (no showModal) the player can play on under the prompt.
    // A "Replace" covers the slots that had progress when it was asked; a slot that was pristine
    // then and has progress now was never part of the question, so ask again — and again, by the
    // same rule, if yet another slot fills up under the second prompt.
    for (;;) {
      if (!(await args.askReplace())) return "declined";
      const latest = args.current();
      if (!slots.some((slot) => isPristine(beforePrompt, slot) && !isPristine(latest, slot))) break;
      beforePrompt = latest;
    }
  }
  // Re-read after the prompt: the player may have played on while it was open.
  args.commit(applyIncoming(args.current(), args.slots));
  return "accepted";
}

let pendingReceive: Promise<ReceiveResult> | null = null;
/** One hand-off per page load, however many times React runs the effect that asks for it. A
 *  synchronous throw is cached too, as a rejection: otherwise nothing is stored and a StrictMode
 *  re-run would call the kit a second time. `receive` itself still runs synchronously. */
export function receiveCarryOnce(receive: () => Promise<ReceiveResult>): Promise<ReceiveResult> {
  if (pendingReceive === null) {
    try {
      pendingReceive = receive();
    } catch (error) {
      pendingReceive = Promise.reject(error);
    }
  }
  return pendingReceive;
}
export function resetCarryReceiveForTests(): void { pendingReceive = null; }

/** The Nexus start-up path: never throws and never rejects, so the cloud start it gates always
 *  runs. A synchronous throw from the kit (e.g. crypto.randomUUID missing on a non-secure dev
 *  origin) or a rejection becomes "failed" with one warning, and the page carries on as "none". */
export function receiveCarrySafely(receive: () => Promise<ReceiveResult>): Promise<ReceiveResult | "failed"> {
  return Promise.resolve()
    .then(() => receiveCarryOnce(receive))
    .catch((error: unknown) => {
      console.warn("[carry] the hand-off receiver failed; carrying on without it:", error instanceof Error ? error.message : String(error));
      return "failed" as const;
    });
}
