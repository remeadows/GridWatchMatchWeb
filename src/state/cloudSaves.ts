import { defaultSaveState, normalizeSave, type SaveState, type SettingsState } from "./save";

// The single local SaveState v1 stays as it is; the cloud sees it as two slots (spec §5.5).
export const CLOUD_SLOTS = ["campaign", "settings"] as const;
export type CloudSlot = (typeof CLOUD_SLOTS)[number];
export type CampaignPayload = Omit<SaveState, "version" | "settings">;

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

/** Cloud payload → SaveState, through normalizeSave so the app never sees a shape it does not know. */
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
