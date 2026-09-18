import type { ReconcileResult, SavesClient } from "@gridwatch/account-kit";
import { applyCloudPayload, changedSlots, CLOUD_SLOTS, freshSlot, isPristine, projection, type CloudSlot } from "../state/cloudSaves";
import type { SaveState } from "../state/save";

export interface SlotOutcome {
  slot: CloudSlot;
  result: ReconcileResult;
}

export interface FoldedOutcomes {
  next: SaveState;
  /** Slots whose local copy the cloud replaced (`use_cloud`) or reset (`fresh`). */
  replaced: CloudSlot[];
  /** Slots the cloud accepted during the reconcile itself (`uploaded` / `stored`) — proof of
   *  upload, so they are no longer unsynced and must not be re-sent by the settle-time flush. */
  uploaded: CloudSlot[];
  failed: boolean;
}

/** Pure. Applies `use_cloud` (applyCloudPayload) and `fresh` (freshSlot) onto `current` — the state
 *  as it is *now*, never the snapshot the reconcile started from, so a reconcile result is applied
 *  even when the player changed something mid-flight. Returns `current` by identity when nothing was
 *  replaced. `failed` is true when any outcome has status "error". */
export function foldOutcomes(current: SaveState, outcomes: readonly SlotOutcome[]): FoldedOutcomes {
  let next = current;
  const replaced: CloudSlot[] = [];
  const uploaded: CloudSlot[] = [];
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
      case "uploaded":
      case "stored":
        uploaded.push(slot);
        break;
      case "error":
        failed = true;
        break;
      default:
        break;
    }
  }
  return { next, replaced, uploaded, failed };
}

export interface CloudSync {
  /** Once the session and the local save are both known (and again when the user changes).
   *  `unsynced` is the persisted per-slot "the cloud has never confirmed this" list.
   *  Never rejects: disabled / no client resolves to `[]`, and a client call that throws resolves
   *  to an "error" outcome for every slot. The caller folds the outcomes itself — the result of a
   *  reconcile is never discarded. */
  reconcileAll(save: SaveState, unsynced: readonly CloudSlot[]): Promise<SlotOutcome[]>;
  /** After every local commit, and once when a reconcile settles. Slots listed in `skip` are never
   *  stored. A `use_cloud` answer goes to onUseCloud; a `stored` reply — the only proof the cloud
   *  took the change — goes to onStored. */
  storeChanges(previous: SaveState | null, next: SaveState, skip?: readonly CloudSlot[]): void;
}

export interface CloudSyncOptions {
  saves: SavesClient | undefined;
  enabled: boolean;
  onUseCloud: (slot: CloudSlot, payload: unknown) => void;
  /** Called with a slot the cloud has definitely accepted (`stored`), never for `use_cloud`,
   *  `signed_out` or `error` — those leave the slot unsynced and offered again next reconcile. */
  onStored: (slot: CloudSlot) => void;
}

export function createCloudSync({ saves, enabled, onUseCloud, onStored }: CloudSyncOptions): CloudSync {
  const active = enabled && saves ? saves : null;

  return {
    async reconcileAll(save, unsynced) {
      if (!active) return [];
      try {
        // Both slots at once: identical prompts share one dialog in the kit.
        //
        // A pristine slot is handed to the kit as `null` — no real local save to protect — so a new
        // device adopts an existing cloud row silently instead of risking "Keep this one"
        // overwriting real cloud progress with an untouched default. The unsynced FLAG outranks
        // that rule: a slot the player deliberately reset to the defaults while unsynced is still
        // a real local copy, so it goes up as one and prompts (or uploads) rather than silently
        // re-adopting the cloud row.
        //
        // `localChanged` tells the kit that its own clean `{ revision, dirty: false }` record no
        // longer describes what is on screen (signed-out play, an expired token, stores held after
        // a failed reconcile). Without it the kit answers `use_cloud` and the held progress is gone
        // with no prompt.
        const results = await Promise.all(CLOUD_SLOTS.map((slot) => {
          const changed = unsynced.includes(slot);
          const local = isPristine(save, slot) && !changed ? null : projection(save, slot);
          return active.reconcile(slot, local, { localChanged: changed });
        }));
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
          if (result.status === "stored") onStored(slot);
          else if (result.status === "use_cloud") onUseCloud(slot, result.save.payload);
          else if (result.status === "error") console.warn(`[cloud-saves] store ${slot} failed:`, result.error.message);
        }).catch((error: unknown) => console.warn("[cloud-saves] store threw:", error instanceof Error ? error.message : String(error)));
      }
    },
  };
}
