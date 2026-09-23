import { createAccountKit, type AccountKitConfig } from "@gridwatch/account-kit";
import { carryFromOrigins } from "./carryOver";

/** Accepts only an absolute http(s) URL and returns its origin; anything else → undefined. */
export function readPreviewOrigin(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

const previewOrigin = readPreviewOrigin(import.meta.env.VITE_NEXUS_ORIGIN);

/** The origins Nexus accepts a carry offer from. Handed to the kit below, and read by App to decide
 *  where the old-hostname banner shows — one list, so the two cannot drift. */
export const carryFrom = carryFromOrigins(import.meta.env.VITE_CARRY_TEST_ORIGIN);

/** The kit's `onBackgroundStored` shape, so this module cannot drift from it. */
export type BackgroundStoredListener = NonNullable<AccountKitConfig["onBackgroundStored"]>;

/**
 * The app's single subscription to the kit's background-re-flush notification.
 *
 * `accountKit` is a module singleton created before React mounts, and `onBackgroundStored` has to be
 * handed to `createAccountKit` at that point — but the state the notification has to be judged
 * against (the current save, the signed-in user, what is still in flight) only exists inside the
 * component. Hence one indirection: the kit always has a callback, and it forwards to whatever
 * listener is registered, or to nothing at all before React mounts (the common case is a re-flush
 * fired by an `online` event during the very first paint) and after it unmounts.
 */
let backgroundStoredListener: BackgroundStoredListener | null = null;

/** Register the listener, or clear it with `null` on unmount. One listener; a second replaces it. */
export function setBackgroundStoredListener(listener: BackgroundStoredListener | null): void {
  backgroundStoredListener = listener;
}

export const accountKit = createAccountKit({
  returnPath: "/play/match/",
  nexusOrigin: previewOrigin || (typeof window !== "undefined" && import.meta.env.DEV ? window.location.origin : undefined),
  game: { gameSlug: "gridwatch-match", routeAlias: "match", slots: ["campaign", "settings"], schemaVersion: 1,
    carryFrom },
  // Synchronous, and deliberately so: the kit does not wait on the game's bookkeeping before moving
  // on, so anything that must be recorded for this re-flush has to be recorded here and now.
  onBackgroundStored: (slot, payload, revision, userId) => {
    backgroundStoredListener?.(slot, payload, revision, userId);
  },
});
