import { CLOUD_SLOTS, type CloudSlot } from "./cloudSaves";

export const CLOUD_UNSYNCED_KEY = "gridwatch-match-web.cloud-unsynced.v1";

/** The slice of the Storage interface this module needs, so tests can inject a double. */
export interface UnsyncedStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let injected: UnsyncedStorage | null = null;

/** Tests only: point the module at a Storage double, or back at the real localStorage with null. */
export function setUnsyncedStorage(storage: UnsyncedStorage | null): void {
  injected = storage;
}

function storage(): UnsyncedStorage | null {
  if (injected) return injected;
  try {
    // Absent under node/SSR, and a getter that throws in some privacy modes.
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Per-slot "this device holds local progress the cloud has never confirmed" flags.
 *
 * Set on every commit and cleared only on proof that the cloud took the change (a `stored` reply)
 * or that the player chose to abandon it (the cloud copy applied). It has to be *persisted*, not
 * in-memory: the kit's own sync record says `{ revision, dirty: false }` whenever the app held the
 * store back (signed-out play, an expired token, a failed reconcile), so on the next sign-in the
 * kit would answer `use_cloud` and the held progress would vanish without a prompt — and a reload
 * in between would take any in-memory bookkeeping with it.
 *
 * Every entry point is best-effort: a missing, throwing or corrupt store reads as "nothing
 * flagged" and never throws. That degrades to the pre-flag behaviour rather than breaking the app.
 */
export function readUnsynced(): CloudSlot[] {
  const store = storage();
  if (!store) return [];
  let raw: string | null;
  try {
    raw = store.getItem(CLOUD_UNSYNCED_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return [];
  const record = parsed as Record<string, unknown>;
  return CLOUD_SLOTS.filter((slot) => record[slot] === true);
}

function write(slots: readonly CloudSlot[]): void {
  const store = storage();
  if (!store) return;
  try {
    if (slots.length === 0) {
      store.removeItem(CLOUD_UNSYNCED_KEY);
      return;
    }
    store.setItem(CLOUD_UNSYNCED_KEY, JSON.stringify(Object.fromEntries(slots.map((slot) => [slot, true]))));
  } catch {
    // Quota, privacy mode, disabled storage: the flag is simply not durable here.
  }
}

export function markUnsynced(slots: readonly CloudSlot[]): void {
  if (slots.length === 0) return; // never create or rewrite the record for a no-op commit
  const current = readUnsynced();
  const next = CLOUD_SLOTS.filter((slot) => current.includes(slot) || slots.includes(slot));
  if (next.length === current.length) return; // already flagged: leave the bytes alone
  write(next);
}

export function clearUnsynced(slots: readonly CloudSlot[]): void {
  if (slots.length === 0) return;
  const current = readUnsynced();
  const next = current.filter((slot) => !slots.includes(slot));
  if (next.length === current.length) return;
  write(next);
}
