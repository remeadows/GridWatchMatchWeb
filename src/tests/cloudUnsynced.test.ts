import { beforeEach, describe, expect, it } from "vitest";
import { CLOUD_UNSYNCED_KEY, clearUnsynced, markUnsynced, readUnsynced, setUnsyncedStorage, type UnsyncedStorage } from "../state/cloudUnsynced";

/** Minimal Storage-like double: vitest runs in a node environment, so there is no real localStorage. */
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    store: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => { map.set(key, value); },
      removeItem: (key: string) => { map.delete(key); },
    } satisfies UnsyncedStorage,
    map,
  };
}

function throwingStorage(): UnsyncedStorage {
  return {
    getItem: () => { throw new Error("SecurityError"); },
    setItem: () => { throw new Error("QuotaExceededError"); },
    removeItem: () => { throw new Error("SecurityError"); },
  };
}

beforeEach(() => {
  setUnsyncedStorage(null); // back to the real localStorage (absent under node) between cases
});

describe("cloudUnsynced", () => {
  it("reads nothing when the key has never been written", () => {
    setUnsyncedStorage(fakeStorage().store);
    expect(readUnsynced()).toEqual([]);
  });

  it("marks slots, reads them back in slot order, and is idempotent", () => {
    const { store } = fakeStorage();
    setUnsyncedStorage(store);
    markUnsynced(["settings"]);
    expect(readUnsynced()).toEqual(["settings"]);
    markUnsynced(["campaign"]);
    expect(readUnsynced()).toEqual(["campaign", "settings"]); // CLOUD_SLOTS order, not insertion order
    markUnsynced(["campaign", "settings"]);
    expect(readUnsynced()).toEqual(["campaign", "settings"]);
  });

  it("marking nothing does not create or change the record", () => {
    const { store, map } = fakeStorage();
    setUnsyncedStorage(store);
    markUnsynced([]);
    expect(map.has(CLOUD_UNSYNCED_KEY)).toBe(false);
    markUnsynced(["campaign"]);
    markUnsynced([]);
    expect(readUnsynced()).toEqual(["campaign"]);
  });

  it("clears only the named slots, and removes the key once nothing is flagged", () => {
    const { store, map } = fakeStorage();
    setUnsyncedStorage(store);
    markUnsynced(["campaign", "settings"]);
    clearUnsynced(["campaign"]);
    expect(readUnsynced()).toEqual(["settings"]);
    expect(map.has(CLOUD_UNSYNCED_KEY)).toBe(true);
    clearUnsynced(["settings"]);
    expect(readUnsynced()).toEqual([]);
    expect(map.has(CLOUD_UNSYNCED_KEY)).toBe(false);
    clearUnsynced(["campaign", "settings"]); // clearing again is harmless
    expect(readUnsynced()).toEqual([]);
  });

  it("survives a reload: a separate reader sees what a previous session wrote", () => {
    const { store, map } = fakeStorage();
    setUnsyncedStorage(store);
    markUnsynced(["settings"]);
    const persisted = map.get(CLOUD_UNSYNCED_KEY)!;
    // A fresh "session" backed by the same bytes.
    setUnsyncedStorage(fakeStorage({ [CLOUD_UNSYNCED_KEY]: persisted }).store);
    expect(readUnsynced()).toEqual(["settings"]);
  });

  it("treats a corrupt value as nothing flagged, and recovers on the next mark", () => {
    for (const corrupt of ["not json", "null", "[]", '"settings"', "42", '{"campaign":"yes"}', '{"nope":true}']) {
      const { store } = fakeStorage({ [CLOUD_UNSYNCED_KEY]: corrupt });
      setUnsyncedStorage(store);
      expect(readUnsynced()).toEqual([]);
    }
    const { store } = fakeStorage({ [CLOUD_UNSYNCED_KEY]: "not json" });
    setUnsyncedStorage(store);
    markUnsynced(["campaign"]);
    expect(readUnsynced()).toEqual(["campaign"]);
  });

  it("never throws when storage is unavailable or throws", () => {
    setUnsyncedStorage(throwingStorage());
    expect(readUnsynced()).toEqual([]);
    expect(() => markUnsynced(["campaign"])).not.toThrow();
    expect(() => clearUnsynced(["campaign"])).not.toThrow();
    expect(readUnsynced()).toEqual([]);
  });

  it("never throws when there is no storage at all (node, SSR)", () => {
    setUnsyncedStorage(null); // no injected store, and node has no global localStorage
    expect(readUnsynced()).toEqual([]);
    expect(() => markUnsynced(["settings"])).not.toThrow();
    expect(() => clearUnsynced(["settings"])).not.toThrow();
  });
});
