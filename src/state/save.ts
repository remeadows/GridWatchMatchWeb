import { defaultHeroId } from "../data/heroes";

const dbName = "gridwatch-match-web";
const storeName = "kv";
const saveKey = "save-state-v1";
const localStorageKey = "gridwatch-match-web.save.v1";

export interface LevelRecord {
  stars: number;
  score: number;
  completedAt: string;
}

export interface SettingsState {
  musicEnabled: boolean;
  sfxEnabled: boolean;
  voiceEnabled: boolean;
  reducedMotion: boolean;
}

export interface SaveState {
  version: 1;
  coins: number;
  boosters: Record<string, number>;
  selectedHeroId: string;
  completedTutorial: boolean;
  tutorialReplayRequested: boolean;
  levels: Record<string, LevelRecord>;
  areaRewards: Record<string, boolean>;
  intelSeen: Record<string, boolean>;
  settings: SettingsState;
}

export function defaultSaveState(): SaveState {
  return {
    version: 1,
    coins: 0,
    boosters: {
      rocket: 3,
      rocketVertical: 3,
      tnt: 3,
      propeller: 3,
      lightBall: 3
    },
    selectedHeroId: defaultHeroId,
    completedTutorial: false,
    tutorialReplayRequested: false,
    levels: {},
    areaRewards: {},
    intelSeen: {},
    settings: {
      musicEnabled: true,
      sfxEnabled: true,
      voiceEnabled: true,
      reducedMotion: false
    }
  };
}

export async function loadSaveState(): Promise<SaveState> {
  const raw = await getValue(saveKey);
  if (!raw) return defaultSaveState();
  try {
    return normalizeSave(JSON.parse(raw));
  } catch {
    return defaultSaveState();
  }
}

export async function persistSaveState(save: SaveState): Promise<void> {
  const normalized = normalizeSave(save);
  const payload = JSON.stringify(normalized);
  localStorage.setItem(localStorageKey, payload);
  await setValue(saveKey, payload);
}

export async function resetSaveState(): Promise<SaveState> {
  const fresh = defaultSaveState();
  await persistSaveState(fresh);
  return fresh;
}

function normalizeSave(value: Partial<SaveState>): SaveState {
  const defaults = defaultSaveState();
  return {
    ...defaults,
    ...value,
    version: 1,
    boosters: { ...defaults.boosters, ...(value.boosters ?? {}) },
    levels: { ...(value.levels ?? {}) },
    areaRewards: { ...(value.areaRewards ?? {}) },
    intelSeen: { ...(value.intelSeen ?? {}) },
    settings: { ...defaults.settings, ...(value.settings ?? {}) }
  };
}

async function getValue(key: string): Promise<string | null> {
  try {
    const db = await openDatabase();
    const fromIndexedDb = await new Promise<string | null>((resolve, reject) => {
      const request = db.transaction(storeName, "readonly").objectStore(storeName).get(key);
      request.onsuccess = () => resolve(typeof request.result === "string" ? request.result : null);
      request.onerror = () => reject(request.error);
    });
    return fromIndexedDb ?? localStorage.getItem(localStorageKey);
  } catch {
    return localStorage.getItem(localStorageKey);
  }
}

async function setValue(key: string, value: string): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(storeName, "readwrite").objectStore(storeName).put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    localStorage.setItem(localStorageKey, value);
  }
}

function openDatabase(): Promise<IDBDatabase> {
  if (!("indexedDB" in globalThis)) return Promise.reject(new Error("IndexedDB unavailable"));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(storeName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
