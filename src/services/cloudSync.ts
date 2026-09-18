import type { ReconcileResult, SavesClient } from "@gridwatch/account-kit";
import { applyCloudPayload, changedSlots, CLOUD_SLOTS, freshSlot, projection, type CloudSlot } from "../state/cloudSaves";
import type { SaveState } from "../state/save";

export interface CloudSync {
  /** Once the session and the local save are both known (and again when the user changes). */
  reconcileAll(save: SaveState): Promise<SaveState>;
  /** After every local commit; applies "Use cloud" answers through onUseCloud. */
  storeChanges(previous: SaveState | null, next: SaveState): void;
}

export interface CloudSyncOptions {
  saves: SavesClient | undefined;
  enabled: boolean;
  onUseCloud: (slot: CloudSlot, payload: unknown) => void;
}

export function createCloudSync({ saves, enabled, onUseCloud }: CloudSyncOptions): CloudSync {
  const active = enabled && saves ? saves : null;

  function fold(save: SaveState, slot: CloudSlot, result: ReconcileResult): SaveState {
    switch (result.status) {
      case "use_cloud": return applyCloudPayload(save, slot, result.save.payload);
      case "fresh": return freshSlot(save, slot);
      default: return save;
    }
  }

  return {
    async reconcileAll(save) {
      if (!active) return save;
      let results: ReconcileResult[];
      try {
        // Both slots at once: identical prompts share one dialog in the kit.
        results = await Promise.all(CLOUD_SLOTS.map((slot) => active.reconcile(slot, projection(save, slot))));
      } catch (error) {
        console.warn("[cloud-saves] reconcile failed:", error instanceof Error ? error.message : String(error));
        return save;
      }
      let next = save;
      CLOUD_SLOTS.forEach((slot, index) => { next = fold(next, slot, results[index]); });
      return results.every((r) => r.status !== "use_cloud" && r.status !== "fresh") ? save : next;
    },
    storeChanges(previous, next) {
      if (!active) return;
      for (const slot of changedSlots(previous, next)) {
        active.store(slot, projection(next, slot)).then((result) => {
          if (result.status === "use_cloud") onUseCloud(slot, result.save.payload);
          else if (result.status === "error") console.warn(`[cloud-saves] store ${slot} failed:`, result.error.message);
        }).catch((error: unknown) => console.warn("[cloud-saves] store threw:", error instanceof Error ? error.message : String(error)));
      }
    },
  };
}
