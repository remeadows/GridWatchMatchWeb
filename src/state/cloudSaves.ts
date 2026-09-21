import { defaultSaveState, normalizeSave, type SaveState, type SettingsState } from "./save";

// The single local SaveState v1 stays as it is; the cloud sees it as two slots (spec §5.5).
export const CLOUD_SLOTS = ["campaign", "settings"] as const;
export type CloudSlot = (typeof CLOUD_SLOTS)[number];
export type CampaignPayload = Omit<SaveState, "version" | "settings">;

/** The kit reports a slot as a plain `string` (its own config is a `readonly string[]`), so anything
 *  arriving from a kit callback has to be narrowed before it can index the app's per-slot state. */
export function isCloudSlot(value: string): value is CloudSlot {
  return (CLOUD_SLOTS as readonly string[]).includes(value);
}

export function toCampaignPayload(save: SaveState): CampaignPayload {
  const { version: _version, settings: _settings, ...campaign } = save;
  return campaign;
}

export function toSettingsPayload(save: SaveState): SettingsState {
  return { ...save.settings };
}

export function projection(save: SaveState, slot: CloudSlot): Record<string, unknown> {
  return slot === "campaign" ? { ...toCampaignPayload(save) } : { ...toSettingsPayload(save) };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Cloud payload → SaveState, through normalizeSave so the app never sees a shape it does not know.
 *
 *  The two `as` casts below are safe without a guard of their own: a payload only reaches here from
 *  a kit answer, and the kit has already run `validatePayload(gameSlug, schemaVersion, slot, …)`
 *  against THIS slot's schema on every path that can produce one — `loadWith` rejects a bad cloud
 *  row before returning it (invalid_payload), and both `use_cloud` answers, the reconcile decision
 *  and the store conflict prompt's "Use cloud", read their save from it. `normalizeSave` is still
 *  the backstop that decides what the app actually holds. */
export function applyCloudPayload(save: SaveState, slot: CloudSlot, payload: unknown): SaveState {
  const incoming = asRecord(payload);
  if (slot === "settings") {
    return normalizeSave({ ...save, settings: { ...save.settings, ...(incoming as Partial<SettingsState>) } });
  }
  const { version: _version, settings: _settings, ...campaign } = incoming as Partial<SaveState>;
  return normalizeSave({ ...defaultSaveState(), ...campaign, settings: save.settings });
}

/** That slot reset to defaults, the other slot kept ("Start fresh"). */
export function freshSlot(save: SaveState, slot: CloudSlot): SaveState {
  return applyCloudPayload(save, slot, projection(defaultSaveState(), slot));
}

export function changedSlots(previous: SaveState | null, next: SaveState): CloudSlot[] {
  return CLOUD_SLOTS.filter((slot) => previous === null || JSON.stringify(projection(previous, slot)) !== JSON.stringify(projection(next, slot)));
}

/** True when this slot's projection is bit-for-bit the default — i.e. there is no real local
 *  save for the kit to protect. A brand-new device is always at the defaults, so treating a
 *  pristine projection as "no local save" lets the kit adopt an existing cloud row silently
 *  instead of prompting (and risking "Keep this one" overwriting real cloud progress). */
export function isPristine(save: SaveState, slot: CloudSlot): boolean {
  return JSON.stringify(projection(save, slot)) === JSON.stringify(projection(defaultSaveState(), slot));
}

/** 4a: cloud saves only on the Nexus origin. 4b lifts this when the old hostname gets carry-over. */
export function cloudSavesEnabled(origin: string, nexusOrigin: string): boolean {
  return origin === nexusOrigin;
}
