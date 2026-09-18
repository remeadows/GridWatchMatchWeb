import type { ReconcileResult, SavesClient } from "@gridwatch/account-kit";
import { applyCloudPayload, changedSlots, CLOUD_SLOTS, freshSlot, isPristine, projection, type CloudSlot } from "../state/cloudSaves";
import type { SaveState } from "../state/save";

export interface SlotOutcome {
  slot: CloudSlot;
  result: ReconcileResult;
}

export interface FoldedOutcomes {
  next: SaveState;
  replaced: CloudSlot[];
  failed: boolean;
}

/** Pure. Applies `use_cloud` (applyCloudPayload) and `fresh` (freshSlot) onto `current` — the state
 *  as it is *now*, never the snapshot the reconcile started from, so a reconcile result is applied
 *  even when the player changed something mid-flight. Returns `current` by identity when nothing was
 *  replaced. `failed` is true when any outcome has status "error". */
export function foldOutcomes(current: SaveState, outcomes: readonly SlotOutcome[]): FoldedOutcomes {
  let next = current;
  const replaced: CloudSlot[] = [];
  let failed = false;
  for (const { slot, result } of outcomes) {
    switch (result.status) {
      case "use_cloud":
        next = applyCloudPayload(next, slot, result.save.payload);
        replaced.push(slot);
        break;
      case "fresh":
        next = freshSlot(next, slot);
        replaced.push(slot);
        break;
      case "error":
        failed = true;
        break;
      default:
        break;
    }
  }
  return { next, replaced, failed };
}

export interface CloudSync {
  /** Once the session and the local save are both known (and again when the user changes).
   *  Never rejects: disabled / no client resolves to `[]`, and a client call that throws resolves
   *  to an "error" outcome for every slot. The caller folds the outcomes itself — the result of a
   *  reconcile is never discarded. */
  reconcileAll(save: SaveState): Promise<SlotOutcome[]>;
  /** After every local commit, and once when a reconcile settles. Slots listed in `skip` are never
   *  stored. Applies "Use cloud" answers through onUseCloud. */
  storeChanges(previous: SaveState | null, next: SaveState, skip?: readonly CloudSlot[]): void;
}

export interface CloudSyncOptions {
  saves: SavesClient | undefined;
  enabled: boolean;
  onUseCloud: (slot: CloudSlot, payload: unknown) => void;
}

export function createCloudSync({ saves, enabled, onUseCloud }: CloudSyncOptions): CloudSync {
  const active = enabled && saves ? saves : null;

  return {
    async reconcileAll(save) {
      if (!active) return [];
      try {
        // Both slots at once: identical prompts share one dialog in the kit. A pristine slot has
        // no real local save to protect, so it's handed to the kit as `null` — that lets a new
        // device adopt an existing cloud row silently instead of risking "Keep this one"
        // overwriting real cloud progress with an untouched default.
        const results = await Promise.all(CLOUD_SLOTS.map((slot) => active.reconcile(slot, isPristine(save, slot) ? null : projection(save, slot))));
        return CLOUD_SLOTS.map((slot, index) => ({ slot, result: results[index] }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("[cloud-saves] reconcile failed:", message);
        return CLOUD_SLOTS.map((slot): SlotOutcome => ({ slot, result: { status: "error", error: { code: "network", message } } }));
      }
    },
    storeChanges(previous, next, skip = []) {
      if (!active) return;
      for (const slot of changedSlots(previous, next)) {
        if (skip.includes(slot)) continue;
        active.store(slot, projection(next, slot)).then((result) => {
          if (result.status === "use_cloud") onUseCloud(slot, result.save.payload);
          else if (result.status === "error") console.warn(`[cloud-saves] store ${slot} failed:`, result.error.message);
        }).catch((error: unknown) => console.warn("[cloud-saves] store threw:", error instanceof Error ? error.message : String(error)));
      }
    },
  };
}
