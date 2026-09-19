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
  /** Slots the cloud accepted during the reconcile itself (`uploaded` / `stored`). Proof that the
   *  cloud took the payload the kit SENT — a projection of the snapshot the run started from, which
   *  is not necessarily what the slot holds now. `settledSlots` is what turns it into a decision. */
  uploaded: CloudSlot[];
  failed: boolean;
}

/** Pure. Applies `use_cloud` (applyCloudPayload) and `fresh` (freshSlot) onto `current` — the state
 *  as it is *now*, never the snapshot the reconcile started from, so a reconcile result is applied
 *  even when the player changed something mid-flight. Returns `current` by identity when nothing was
 *  replaced. `failed` is true when any outcome has status "error".
 *
 *  `alreadyApplied` lists the slots whose answer the caller applied at its OWN resolve (the per-slot
 *  callback `reconcileAll` takes). Their payload must not be laid over `current` again: `current` is
 *  the state AFTER that application plus whatever the player has committed since, and re-applying
 *  here is precisely what used to overwrite those commits. They are still reported in `replaced` —
 *  the answer happened, and `settledSlots` decides what it proves. A slot NOT in the list is applied
 *  here as before, which keeps the property that no kit answer is ever discarded: every `use_cloud`
 *  payload is applied exactly once, either at its resolve or here. */
export function foldOutcomes(
  current: SaveState,
  outcomes: readonly SlotOutcome[],
  alreadyApplied: readonly CloudSlot[] = [],
): FoldedOutcomes {
  let next = current;
  const replaced: CloudSlot[] = [];
  const uploaded: CloudSlot[] = [];
  let failed = false;
  for (const { slot, result } of outcomes) {
    switch (result.status) {
      case "use_cloud":
        if (!alreadyApplied.includes(slot)) next = applyCloudPayload(next, slot, result.save.payload);
        replaced.push(slot);
        break;
      case "fresh":
        if (!alreadyApplied.includes(slot)) next = freshSlot(next, slot);
        replaced.push(slot);
        break;
      case "uploaded":
      case "stored":
        uploaded.push(slot);
        break;
      case "error":
      // A reconcile only runs for a signed-in user, so `signed_out` here means the session vanished
      // or was rejected mid-run (an expired or revoked token). Nothing was settled for this slot:
      // count it as a failure so the gate returns to idle and the retry paths can re-arm it,
      // rather than latching `done` over a client that will keep answering `signed_out`.
      case "signed_out":
        failed = true;
        break;
      default:
        break;
    }
  }
  return { next, replaced, uploaded, failed };
}

export interface SettledSlotsInput {
  /** The snapshot the reconcile run started from — the one the kit uploaded a projection of. */
  startedWith: SaveState;
  /** The state as it is NOW, i.e. `foldOutcomes(...).next`. */
  next: SaveState;
  replaced: readonly CloudSlot[];
  uploaded: readonly CloudSlot[];
  /** For each slot whose answer was applied at its OWN resolve, the slot's projection as recorded
   *  immediately after that application — i.e. what the cloud provably held at that instant. A slot
   *  the end-of-run fold applied has no entry: for those, `next` IS the state right after the
   *  application, so there is nothing to compare against. */
  applied?: ReadonlyMap<CloudSlot, unknown>;
}

export interface SettledSlots {
  /** Slots whose unsynced flag may be cleared: the cloud provably holds their current projection. */
  clear: CloudSlot[];
  /** Slots the settle-time flush must not re-send: the cloud already holds exactly that. */
  skip: CloudSlot[];
}

/**
 * Pure. Which slots a settled reconcile has PROVED the cloud holds — the one freshness predicate.
 *
 * `replaced` is conditional on the same question as `uploaded`, just measured from a different
 * instant. The cloud payload was applied when THAT slot's reconcile resolved, which — because the
 * kit serializes per slot and a prompt can hold one slot for minutes — can be long before the run
 * settles. Anything the player commits in that window sits ON TOP of the cloud state (the kit's
 * record is already at the cloud revision), is held by the gate, and has the settle-time flush as
 * its only route out. So a replaced slot counts as settled only while its projection is still the
 * one recorded right after its payload was applied; a slot that moved since is treated exactly like
 * a moved `uploaded` slot — flag kept, flushed normally. Clearing and skipping it unconditionally
 * is what made that commit invisible to the cloud forever with nothing left marking it as local-only.
 *
 * A replaced slot with no recorded projection was applied by the end-of-run fold itself, so `next`
 * is by construction the state right after its application: unconditionally settled, as before.
 *
 * `uploaded` is conditional, and this is the part that used to be wrong. The kit sends
 * `projection(startedWith)`. A commit that lands while that PUT is in flight is held by the gate, so
 * its ONLY route out is the settle-time flush: skipping the slot there while clearing its flag makes
 * that commit invisible to the cloud forever, with nothing left marking it as local-only. So an
 * uploaded slot counts as settled only when it has not changed since `startedWith`; a changed one is
 * flushed normally and keeps its flag until its own `stored` reply proves the cloud took it.
 *
 * `clear` and `skip` hold the same slots by construction — "the cloud holds this slot's current
 * projection" is the single fact behind both — but they are returned separately because they drive
 * two different actions, and the caller applies them at two different points (see App.tsx: clearing
 * is a per-slot fact and happens above the gate; skipping only matters if the gate allows a flush).
 */
export function settledSlots({ startedWith, next, replaced, uploaded, applied }: SettledSlotsInput): SettledSlots {
  const moved = changedSlots(startedWith, next);
  const settledReplaced = (slot: CloudSlot): boolean => {
    if (!replaced.includes(slot)) return false;
    const atApplication = applied?.get(slot);
    return atApplication === undefined || isCurrentProjection(next, slot, atApplication);
  };
  const settled = CLOUD_SLOTS.filter((slot) => settledReplaced(slot)
    || (uploaded.includes(slot) && !moved.includes(slot)));
  return { clear: [...settled], skip: [...settled] };
}

/** True when `payload` is bit-for-bit what `slot` projects from `save` right now — the only proof
 *  that what the cloud acknowledged IS what the device holds. Same `JSON.stringify` comparison
 *  idiom `changedSlots` and `isPristine` already use, and conservative in the same direction: an
 *  inequality that is really only about key order keeps the flag, which costs a redundant upload or
 *  one extra prompt, never a lost commit. */
export function isCurrentProjection(save: SaveState, slot: CloudSlot, payload: unknown): boolean {
  return JSON.stringify(payload) === JSON.stringify(projection(save, slot));
}

export interface CloudSync {
  /** Once the session and the local save are both known (and again when the user changes).
   *  `unsynced` is the persisted per-slot "the cloud has never confirmed this" list.
   *  Never rejects: disabled / no client resolves to `[]`, and a client call that throws resolves
   *  to an "error" outcome for every slot. The caller folds the outcomes itself — the result of a
   *  reconcile is never discarded.
   *
   *  `onResolved` is called with each slot's own outcome the INSTANT that slot resolves, which is
   *  what makes applying a cloud answer per slot possible. The kit serializes per slot and a slot's
   *  reconcile can sit on a player prompt for minutes, so waiting for both to settle before applying
   *  either meant every commit the player made to the finished slot in between was overwritten by
   *  the late fold. Never called after the returned promise settles, and a callback that throws is
   *  swallowed: it must not turn a good run into an errored one. */
  reconcileAll(
    save: SaveState,
    unsynced: readonly CloudSlot[],
    onResolved?: (outcome: SlotOutcome) => void,
  ): Promise<SlotOutcome[]>;
  /** After every local commit, and once when a reconcile settles. Slots listed in `skip` are never
   *  stored. A `use_cloud` answer goes to onUseCloud with its payload and with whether anything else
   *  for that slot was still outstanding; a `stored` reply — proof the cloud took THAT payload —
   *  goes to onStored together with the payload that was stored, but only once nothing else it
   *  issued for that slot is still outstanding. Never throws, and never rejects. */
  storeChanges(previous: SaveState | null, next: SaveState, skip?: readonly CloudSlot[]): void;
}

export interface CloudSyncOptions {
  saves: SavesClient | undefined;
  enabled: boolean;
  /** A `use_cloud` answer to a store: the player resolved the kit's conflict prompt by taking the
   *  cloud copy. The payload is ALWAYS applied — a kit answer is never discarded, and by the time it
   *  answers the kit has already written its own record at the cloud revision, so holding the
   *  payload back would leave the app on a local copy the next store would silently push up.
   *
   *  `settled` is the conditional half, and it governs only the FLAG. It is true when nothing else
   *  this module issued for the slot is still outstanding. When it is false, another store is queued
   *  behind the answer and will flush on the revision the answer just confirmed — landing the very
   *  copy the player rejected — so the slot is genuinely out of sync and must stay flagged. The flag
   *  then stays set even though the applied payload just replaced that commit's content: intended,
   *  and the next reconcile repairs the slot through `restore_dirty`. */
  onUseCloud: (slot: CloudSlot, payload: unknown, settled: boolean) => void;
  /** Called with a slot the cloud has definitely accepted (`stored`) AND the exact payload it
   *  accepted, never for `use_cloud`, `signed_out` or `error` — those leave the slot unsynced and
   *  offered again next reconcile. The payload is handed over because the reply proves only that
   *  the cloud took *that*: a commit made while the PUT was in flight (the kit debounces by 750 ms
   *  and serializes per slot) is still unsent, so the receiver must compare before it clears
   *  anything. See `isCurrentProjection`.
   *
   *  Not called at all while ANY other store for the same slot is still outstanding — see
   *  `createCloudSync`. So the receiver's own check stays a pure "is this payload current?"
   *  question, and the two halves of the freshness predicate are each owned by the module that can
   *  actually answer them: this one knows what is in flight, the caller knows what is on screen. */
  onStored: (slot: CloudSlot, payload: Record<string, unknown>) => void;
}

export function createCloudSync({ saves, enabled, onUseCloud, onStored }: CloudSyncOptions): CloudSync {
  const active = enabled && saves ? saves : null;

  /**
   * How many stores this module has issued for each slot that have not settled yet.
   *
   * A `stored` reply whose payload equals the current projection is NOT proof that the cloud holds
   * the slot, because that match is point-in-time and the kit serializes stores per slot:
   *
   *   commit1 -> B  (PUT1, slow reply)
   *   commit2 -> C  (>750 ms later, so a new PUT2 queued behind PUT1)
   *   commit3 -> B  (PUT3 queued behind PUT2)
   *
   * PUT1's reply arrives while PUT2 and PUT3 are still queued. Its payload is B, which IS what the
   * device holds — so a payload-only check clears the flag. PUT2 then moves the cloud to C with the
   * flag already clear, and if PUT3 dies terminally (403, or conflicts exhausted) the device holds
   * B, the cloud holds C, and nothing marks the slot as local-only: the next sign-in against the
   * moved cloud replaces B silently. So a reply counts only when nothing else for that slot is
   * still in the air.
   *
   * Deliberately a plain in-memory count, not persisted: the flag it guards is only ever CLEARED
   * here, so losing the count on reload just means the flag stays set — the safe direction, costing
   * at worst a redundant upload or one extra prompt.
   */
  const outstanding = new Map<CloudSlot, number>();
  const outstandingFor = (slot: CloudSlot): number => outstanding.get(slot) ?? 0;
  const release = (slot: CloudSlot): void => { outstanding.set(slot, Math.max(0, outstandingFor(slot) - 1)); };
  const warnThrew = (error: unknown): void =>
    console.warn("[cloud-saves] store threw:", error instanceof Error ? error.message : String(error));

  return {
    async reconcileAll(save, unsynced, onResolved) {
      if (!active) return [];
      // A callback that throws is this module's problem to contain: it runs inside the slot's own
      // promise chain, so an escaping error would reject `Promise.all` and turn every slot's genuine
      // answer into an "error" outcome — discarding answers the kit has already acted on.
      const report = (outcome: SlotOutcome): void => {
        if (!onResolved) return;
        try {
          onResolved(outcome);
        } catch (error) {
          console.warn(`[cloud-saves] reconcile callback for ${outcome.slot} threw:`,
            error instanceof Error ? error.message : String(error));
        }
      };
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
        const results = await Promise.all(CLOUD_SLOTS.map(async (slot) => {
          const changed = unsynced.includes(slot);
          const local = isPristine(save, slot) && !changed ? null : projection(save, slot);
          const result = await active.reconcile(slot, local, { localChanged: changed });
          // Reported here, not after `Promise.all`: this slot is done, and whatever the other slot
          // is still waiting for (a prompt the player may leave open for minutes) is not its
          // concern. The caller applies the answer now and records what it applied.
          report({ slot, result });
          return result;
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
        // Captured once, and handed to onStored unchanged: the receiver's freshness check has to
        // compare what the cloud took against what the device holds at REPLY time, so re-projecting
        // `next` later would compare the payload with itself and always look current.
        const payload = projection(next, slot);
        outstanding.set(slot, outstandingFor(slot) + 1);
        let pending: ReturnType<SavesClient["store"]>;
        try {
          pending = active.store(slot, payload);
        } catch (error) {
          // `store()` is contracted never to reject, but a synchronous throw (a bad slot name, a
          // disposed client, a caller-supplied dependency blowing up before the first await) settles
          // no promise at all, so the `.finally` below would never run: the count has to be released
          // right here or the slot's flag is unclearable for the life of the page. Swallowed rather
          // than rethrown for the same reason the rejection below is — by the time commitSave gets
          // here the local save is already committed and persisted, so a cloud-only failure must not
          // abort the rest of the commit path (including the OTHER slot's store).
          release(slot);
          warnThrew(error);
          continue;
        }
        pending
          // Decremented however the promise settles — stored, use_cloud, signed_out, error or a
          // throw — and BEFORE the handler below reads the count, so the count it sees is "everything
          // else still in the air for this slot", excluding this reply itself. A leaked count here
          // would wedge the slot's flag as permanently unclearable for the life of the page.
          .finally(() => release(slot))
          .then((result) => {
            if (result.status === "stored") {
              if (outstandingFor(slot) === 0) onStored(slot, payload);
            } else if (result.status === "use_cloud") {
              // Payload unconditionally, clear only when nothing else for this slot is in the air:
              // a queued store flushes on the revision this answer just confirmed and would land the
              // copy the player rejected, with the flag the only thing left saying so.
              onUseCloud(slot, result.save.payload, outstandingFor(slot) === 0);
            } else if (result.status === "error") console.warn(`[cloud-saves] store ${slot} failed:`, result.error.message);
          }).catch((error: unknown) => warnThrew(error));
      }
    },
  };
}
