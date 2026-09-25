# GridWatch Match Web Handoff

Last updated: 2026-09-25

## 2026-09-25: Leaderboards phase 3 — Match writes through the shared board registry (not deployed)

- **Plan / branch:** `docs/superpowers/plans/2026-09-25-match-submit-score.md`, branch `feat/match-submit-score`. It implements Nexus spec §6 phase 3, game 2 (gridwatch-command-nexus repo: `docs/superpowers/specs/2026-09-24-nexus-leaderboards-rebuild-design.md`). The database side is live.
- **Worker:** `/api/score` makes one service-role `rpc/submit_score` call for `gridwatch-match / campaign / r1` with entry `level:<id>`. That replaces the `scores` insert/patch fan-out: the per-level row, the self-computed `standard` campaign total, `daily-*` and `weekly-*`.
  - The database keeps level bests improve-only and sums them for `all` and the ISO week.
  - Telemetry validation and `deriveScore` are unchanged.
  - Statuses map to HTTP: 200 / 409 / 422 / 400 / 503 (registry mismatch, logged) / 500. A failed RPC request returns 502.
- **Behaviour changes (spec §5):** the weekly board is now "sum of level bests set this week" (it was best single run). There is no daily board. When a win doesn't beat the level best, the line reads `ARCHIVE BEST STANDS — CAMPAIGN TOTAL <n>`, because the per-level best isn't returned any more.
- **Proof:** `p_meta` holds `{v, levelId, telemetry, actionLogLength}`, and `p_proof_hash` covers the full `{v, telemetry, actionLog}`. The action log itself is no longer stored server-side, because it can reach 64 KB and meta is capped at 4 KB.
- **Client:** each win is stamped with `runId` (32 hex) and `endedAt`. The worker honours `endedAt` only within [now − 1 h, now + 1 min].
- **Evidence:** vitest 522/522, `validate:levels`, `npm audit --audit-level=high`, `npm run build`, all green.

**Next:** Russ merges the PR, then deploys on his go. Deploy waits until Drift's phase-3 screen checks are recorded (Nexus HANDOFF 2026-09-25 🟡 entry). Deploy from a clean checkout of `origin/main` with `npm run build && npx wrangler deploy`, and first check that `dist/assets/*.js` doesn't contain `localhost:4173`. Acceptance, per the spec §6 gate: one real signed-in win each on Mac and iPhone. In Match the result reads `SCORE TRANSMITTED — CAMPAIGN TOTAL <n>`. On Nexus, the Match board shows the row with the `is_you` highlight and `YOU // #n OF m ON THE GRID`, and the Match card and operator console show the rank. Then Breach.

## 🟢 2026-09-23: Nexus is the only host — old hostname 301s to `/play/match/`; carry-over retired

- **Decision (Russ):** `nexus.warsignallabs.net/play/match/` is the only place Match is played. His progress was already in the Nexus cloud save, so nothing needed moving. The 4b device pass and the two-week banner soak are waived.
- **Old hostname:** a Cloudflare zone redirect rule sends every path on `gridwatchmatchweb.warsignallabs.net` to `https://nexus.warsignallabs.net/play/match/` (Static 301, query string dropped). It runs before this worker. Verified with curl on 2026-09-23, both `/` and deep paths.
- **Nexus fetches Match from `https://gridwatch-match.russell-meadows.workers.dev`** (Nexus #34), not the old hostname. Keep the workers.dev route enabled. Its `/` 301s to `/play/match/`, which is expected.
- **Leaderboards reset:** all `scores` and `achievement_unlocks` rows were deleted (Russ's yes); Nexus will rebuild them. Cloud saves (`campaign`, `settings`) were kept.
- **Carry-over wiring is still in the code but unreachable in production.**
  - `CarryBanner` renders only on origins in `carryFrom`, which lists only the old hostname. The zone rule now 301s that hostname before this worker runs.
  - `App` still calls `receiveCarrySafely`, and startup still waits for `carrySettled`. The kit's `receiveCarry` returns `none` at once when the URL has no `#gw-carry` fragment (kit v0.3.0 `src/carry/receive.ts`), and only the old-host banner ever opened that URL. So the gate adds no wait.
  - Removing the wiring is a separate cleanup PR. It must take out the banner, `carryFrom`, the receiver and the gate together, and re-run the cloud-saves e2e. Until then the merge note in the 4b entry below still applies.
  - The parked review item "carry accepted before the IndexedDB write settles" has no remaining trigger, since no offer can arrive.

## 🟢 2026-09-23 (superseded by the entry above): 4b carry-over — "Move my progress" from the old hostname (kit v0.3.0; #63, deployed at `e7cec3e`)

Spec §6 in gridwatch-command-nexus (the plan is `docs/superpowers/plans/2026-09-22-4b-carry-handoff.md` there). Page-to-page hand-off, no server work.

**Old hostname** (`gridwatchmatchweb.warsignallabs.net`): `src/components/CarryBanner.tsx` renders above every screen except the game screen, which it would push off-screen.
- **No progress:** "GridWatch Match has moved." with a "Play on the new site" link.
- **Local progress:** "Move my progress". It calls `accountKit.carry.send` synchronously in the click and sends only non-pristine slots, so default settings never overwrite custom ones on Nexus.
- **After an accepted move:** "Your progress is on the new site." with "Continue there" and "Move again". The state is remembered in `gridwatch-match-web.carry.v1` as fingerprints of what was sent. Any later progress switches the banner to "You have new progress since you moved.", so nothing earned there is stranded when step 5's redirect lands.

The old save is never changed. Cloud saves stay Nexus-only.

**Nexus receiver** (`src/App.tsx`): the effect waits for the save to load, then runs `accountKit.carry.receive` through `receiveCarrySafely`/`receiveCarryOnce`. That call always settles: after 20 s with no valid offer, or on a throw, and only once per page even under StrictMode.
- **Applying:** the handler (`handleCarryOffer` in `src/services/carryOver.ts`) applies the save through `commitSave`, so the replaced slots are flagged unsynced. If any replaced slot has progress here, it first asks "Replace the progress on this site with your progress from the old site?".
- **Gate:** the cloud-start effect returns early while `carrySettled` is false. That is its own statement right after the 4a guard line. The first reconcile therefore sees the flags and either uploads (no cloud row) or shows the 4a conflict prompt.
- **Notice:** "Progress moved from the old site." clears on the first navigation.

**Constraint:** neither origin may send `Cross-Origin-Opener-Policy` (it would cut `window.opener`). Nexus strips it from proxied games (Nexus #33), and `src/tests/playPrefixWorker.test.ts` pins the Match worker.

**Tests:**
- `src/tests/carryOver.test.ts`, `src/tests/carryBanner.test.tsx` (jsdom).
- `tests/e2e/carry-over.spec.ts` covers the two origins, `localhost:4173` as the old host and `127.0.0.1:4173` as Nexus via `VITE_CARRY_TEST_ORIGIN`. It includes a signed-in test proving no saves GET happens before the hand-off settles.
- Run the e2e with `CI=1` locally: another checkout may hold port 4173, and `reuseExistingServer` would test its build.

**Deploy:** build from a clean checkout. The e2e build bakes `VITE_CARRY_TEST_ORIGIN` into `dist/`, so check that `dist/assets/*.js` does not contain `localhost:4173` before `wrangler deploy`.

**Acceptance:** a Mac + iPhone Safari pass (plan Task 9).
- Move with progress; the Nexus tab shows the notice.
- Signed in, no cloud row → upload.
- Signed in, divergent cloud row → conflict prompt, with `wrangler tail` running.
- New progress on the old host → move again.
- Home Screen launch → timeout message.

Record the banner-live date. Step 5's old-host 301 comes no earlier than two weeks after it.

**Merge note for the Codex Match branch** (it edits the same lines): keep `carryFrom` in the `game` object of `src/services/accountKit.ts`. Keep the separate `if (!carrySettled) return;` in the cloud-start effect and `carrySettled` in its deps. Afterwards, re-run `CI=1 npx playwright test tests/e2e/carry-over.spec.ts`; test 6 fails if the gate is lost.

## 🟢 2026-09-21: cloud saves 4a LIVE — accepted on Mac + iPhone

Deployed from `5f622f1` (kit v0.2.4) after Nexus `/api/saves` went live (migration `cloud_saves_generic` applied, service-role secret set, Nexus `9bc257a`). Russell's acceptance, one account on Mac + iPhone: two-way sync; a device with no local progress adopts the cloud copy silently; divergent progress shows the conflict prompt; the answer sticks on both devices. The first pass found global sign-out + a silent 401 (kit fix below, v0.2.4); the re-run passed. Cloud saves stay **Nexus-origin only** (`cloudSavesEnabled`); on the old hostname `gridwatchmatchweb.warsignallabs.net` signed-in play is local-only until 4b. Debugging tip: server-side rejections before the RPC (401/413/429) never reach `game_save_requests` — use `wrangler tail` on the Nexus worker.

## 2026-09-18: cloud saves 4a — Match wired to the kit saves client (merged as #59, #60, #61)

Two cloud slots projected from the unchanged local SaveState v1: `campaign` (all but version/settings) and `settings` (`src/state/cloudSaves.ts`). `src/services/cloudSync.ts` runs `reconcile` for both slots once the session is known (per user id) and `store` on every `commitSave` for the slots that changed; "Use cloud" answers are applied through `applyCloudPayload` + persist. Cloud saves are active only on the Nexus origin (`cloudSavesEnabled`, lifted in 4b). Playwright `tests/e2e/cloud-saves.spec.ts` fakes `/api/saves` and a stored Supabase session.
A slot whose projection is bit-for-bit the default (`isPristine`) is treated as "no local save" and reconciled as `null`, so a brand-new device with cloud progress adopts the cloud row silently instead of showing the conflict prompt (which risked "Keep this one" overwriting real cloud progress with an untouched default).
A reconcile result is never discarded: the run has no abort path, and `foldOutcomes` applies each slot's answer onto the CURRENT save rather than the snapshot the run started from, because by the time the kit answers it has already recorded this device as clean at the cloud revision — dropping the answer would let the next store replace the cloud row with no conflict and no prompt. A cloud store leaves the app only once a reconcile has settled successfully for the current user id — `src/services/cloudGate.ts` is the pure state machine that decides, because the kit reads `baseRevision` at flush time inside its per-slot serialized chain, so a store issued before or during a reconcile flushes on the base that reconcile's own `confirmed()` just wrote and replaces the cloud row with no 409 and no prompt. Every commit that is not stored (gate idle, run in flight, signed out, or after an errored reconcile) keeps updating and persisting locally and records the state before it as the pending base (first unsent commit wins); the run that succeeds flushes that whole batch in one diff minus the slots the cloud replaced, while a superseded or failed run still folds its results but never flushes — and an errored run leaves stores held and retries on `online`, on `visibilitychange` → visible, and on the next commit, throttled to one attempt per 30 s.
Because a held store leaves the kit's own sync record reading `{ revision, dirty: false }`, `src/state/cloudUnsynced.ts` keeps a persisted per-slot "the cloud has never confirmed this" flag (localStorage `gridwatch-match-web.cloud-unsynced.v1`): every `commitSave` marks the slots it changed before doing anything else, so the flag survives reloads and a killed tab. **A flag is cleared only on proof that the cloud holds the slot's CURRENT projection, never merely that the cloud accepted something for it** — "the cloud took a payload" and "the cloud is up to date" are different facts, because the kit debounces stores by 750 ms and serializes them per slot, and because a reconcile that uploads sends a projection of the snapshot it started from. Concretely (the one freshness predicate, `settledSlots` + `isCurrentProjection` in `src/services/cloudSync.ts`): a `stored` reply clears the flag only when `JSON.stringify` of the payload that was stored still equals the slot's projection right now; at settle a `replaced` slot clears — and is skipped by the flush — only if its projection still equals the one recorded right after its payload was applied, and an `uploaded` slot only if it is not in `changedSlots(startedWith, next)`; either way a commit that landed after the cloud last provably held the slot is flushed normally and keeps its flag until its own `stored`. Clearing is a per-slot fact and is applied ABOVE the gate's flush decision, so a failed or superseded run still clears the slots the cloud demonstrably replaced; the gate governs the flush only. A stale flag is not harmless: it later costs a redundant upload, or a misleading conflict prompt whose "Keep this one" pushes OLD content over a newer cloud row. `reconcileAll` passes a flagged slot to the kit (v0.2.1+; the dep is pinned at v0.2.4) as a real local copy with `{ localChanged: true }` even when the projection is bit-for-bit default, which makes the kit prompt instead of silently answering `use_cloud` (this is what protects signed-out play and an expired token, and it also closes the old "offline reset re-adopts the cloud row" edge).
A cloud answer is applied the moment **its own slot's** reconcile resolves, through the per-slot `onResolved` callback `reconcileAll` takes — not when the whole run settles. The kit serializes per slot and a slot's reconcile can sit on a player prompt for minutes, so `settings` can be done while `campaign` waits; applying both at the end meant every commit the player made to the finished slot in between was overwritten by the late fold, its flag cleared and the commit never flushed. The end-of-run fold now skips any slot the callback already applied (`foldOutcomes(current, outcomes, alreadyApplied)`), which keeps "every `use_cloud` payload is applied exactly once" while making the newer commits survive.

**Kit v0.2.4 (pinned 2026-09-21), found in live Mac + iPhone acceptance:** signing out on one device used to sign the player out everywhere (`supabase.auth.signOut()` defaults to the global scope), after which the other device's saves calls answered 401 while its header still showed the player's name and nothing synced. v0.2.4 signs out locally only, and a 401 from the saves API now gets one session refresh + retry; if that cannot help, the kit ends the local session so the header falls back to "Sign in". Unsynced progress and flags are untouched by a rejection, so they are still there after signing back in.

**Closed by kit v0.2.3 (`ReconcileOptions.current`):** a commit made between the `reconcile()` call and the kit's *decision* — one cloud GET — used to be overwritten when the kit answered an automatic `use_cloud`, because it decided on the snapshot handed to it at call time. `reconcileAll` now passes `current` for every slot: the kit re-reads it once the cloud row is known and immediately before deciding, and a value that differs from the payload passed in is what it decides on, sends and remembers, with the call treated as `localChanged` — so the conflict prompt appears instead of a silent replace. What `current()` returns is exactly what `reconcileAll` would pass for that slot if it were called at that instant: the same pristine/flag rule (`localForSlot`, extracted so the two cannot drift), evaluated against the LIVE save and the LIVE unsynced flags. Those come in as one required `live` option on `createCloudSync` (`() => saveRef.current` and `readUnsynced` in `src/App.tsx`), so `cloudSync` stays React-free and unit-testable and a `current` built from only one of the two halves is not constructible — a slot reset to the defaults while flagged must still read as a real local copy, not as "no local save", which would tell the kit to forget the payload the flag exists to protect. It is synchronous, returns a fresh object per call, and falls back to the call-time payload (i.e. the pre-`current` behaviour) if a reader ever throws or the save has not loaded.
One consequence, accepted deliberately: `settledSlots` is now conservative rather than exact. A slot that moved *before* the decision really is in the cloud, because the kit sent the fresh projection — but `changedSlots(startedWith, next)` cannot tell that apart from a commit that landed *after* the decision, which nobody has sent, so both keep the slot flagged and the settle-time flush re-sends the identical payload once, on the revision the upload just created (no prompt), and that PUT's own `stored` clears the flag. One redundant PUT, in exchange for one rule that errs toward keeping flags instead of a second source of truth for the fact `settledSlots` exists to decide.
**What remains accepted:** a change made while a kit *prompt* is open does not change the question the player was asked — their explicit answer wins, by design on both sides. "Keep this one" uploads the payload as of the decision and the later commit still reaches the cloud through the settle-time flush (the slot moved, so it keeps its flag and is sent); "Use cloud" replaces the slot with the cloud copy, that commit's content included, which is precisely what the player chose.

Kit v0.2.3 also adds `onBackgroundStored`, now wired through `src/services/accountKit.ts`. A background re-flush — the kit's own retry, on `online` or the tab becoming visible, of a slot it already knows is dirty — has no caller to resolve, so its success used to be invisible here and the slot stayed flagged until the next reconcile re-uploaded it. Because `accountKit` is a module singleton created before React mounts, the kit always gets a callback and that callback forwards to a module-level listener `App` registers in an effect and clears on unmount (no listener → no-op, which costs one redundant upload at the next load). The clear is gated on `clearsOnBackgroundStore` in `src/services/cloudSync.ts`: the payload must have landed in the row of the account signed in *now* (a background send can outlast an account switch and this flag is not per-user — the foreground `onStored` path needs no such check only because every kit path that produces it also writes the per-slot owner record), it must still be the slot's current projection (`isCurrentProjection`, the same rule `onStored` gets), and nothing else this module issued for that slot may still be outstanding (`cloudSync.outstandingStores`).


## 2026-09-12: Account kit v0.1.2 — header polish + hardening

- **Implementation**: dependency bump only (PR #54 @ `87c3052`; kit tag
  `v0.1.2` = `2065040`). The shared bar keeps its menu open across token
  refreshes, closes on Escape/outside-click (Escape returns focus to the
  chip), carries `role="navigation"` + menu ARIA, guards double mount/unmount,
  keeps the last known handle when a profile read fails, and shows a
  `role="alert"` notice when sign-out fails. `kit.signOut()`/`getProfile()`
  now reject on a returned Supabase error; `useAccount` (behind `useAuth`)
  absorbs both, so `void auth.signOut()` in `App.tsx` stays safe.
- **npm gotcha** (documented in `.npmrc`): npm 12 `allow-git=root` refuses a
  fresh `npm install` re-resolution of the git dep (`EALLOWGIT`); bump the tag
  with a one-off `npm install --allow-git=all`. CI's `npm ci` under `root`
  still passes.
- **Automated verification**: vitest 356/356, `tsc --noEmit` clean for app and
  worker, `npm run build` green, CI green. Playwright 1.63.0 (browsers had to be
  reinstalled): 170/172 on chromium + mobile — the 2 failures are
  `presentation.spec.ts:40` (desktop board 448 px vs the 450 px floor) on both
  projects, reproduced identically on main with kit v0.1.1, so pre-existing
  and unrelated to this bump; tracked as a separate task.
- **Player acceptance**: Russ, 2026-09-12, Mac + iPhone — logins work after
  the deploy.
- **Deployment**: deployed 2026-09-12 from a fresh clone of main with
  `npx wrangler deploy`; live `/play/match/` bundle contains the v0.1.2 notice class.

## 2026-09-11: Account kit adoption — sign in via Nexus

- **Implementation**: kit v0.1.1 adopted. Single Supabase client owned by the
  kit; `useAccount` sits behind `useAuth`; the account bar mounts in
  `src/main.tsx`; the Account screen's sign-in action links to Nexus
  (`OperatorIdentityPanel`, `src/App.tsx`). Providers are email magic link +
  Google only — GitHub is omitted until the GitHub OAuth app's callback is
  repaired. `.npmrc` restricts git dependencies with `allow-git=root`.
- **Automated verification**: vitest 355/355, `tsc --noEmit` clean for both
  the app and the worker, `npm run build` green, Playwright 172/172 on
  chromium + mobile from the first-pass run, CI green on PR #52.
- **Player acceptance**: Russ, 2026-09-11 evening, Mac (Chrome) and iPhone
  (Safari) — signed in on Nexus via the shared bar, opened Match at
  `/play/match/` already signed in with the same bar, no console CSP
  violations under the now-enforcing games policy, sign-out from Match
  propagated to Nexus. Gameplay acceptance for PR 47 remains as recorded below.
- **Deployment**: deployed 2026-09-11 evening (after Nexus PR #16) — Worker
  deployed from a fresh clone of main (`dcebb36`) with `npx wrangler deploy`.
  Post-deploy: old host `/play/match/` 200, bundle contains the account bar
  and links to the Nexus sign-in page, assets serve through the Nexus proxy.

## 2026-09-09: Gameplay Draft PR 47; Capture Security Repair

PR 45 was merged externally at `2026-09-09T15:45:56Z` as `67e1c6b`, with all
checks green. This supersedes the earlier ready-but-unmerged entries below.
Local merge `67e57bf` aligns the gameplay branch with that squash merge while
preserving every task commit. Its file tree exactly matches tested `514c04e`.
Draft PR 47 is open for timing/lifecycle review:
`https://github.com/remeadows/GridWatchMatchWeb/pull/47`.

- PR 47's CodeQL analysis identified one high insecure-temporary-file finding in
  Task 0's older `baseline-browser.cjs`. The helper now allocates a fresh private
  randomized capture directory and writes its trace exclusively with mode 0600.
  `GW_CAPTURE_DIR` selects an existing parent. Historical captures are preserved.
- A new regression runs the real setup block twice and verifies unique child
  directories with mode 0700. It first failed on the reused shared output path,
  then passed unchanged. The first attempted test invocation could not resolve
  Vitest in this fresh worktree; after the locked `npm ci --ignore-scripts`, the
  actual behavioral red was observed. No dependency file changed.
- All 336 units pass, script syntax and build/typechecks pass, and the gameplay
  bundle remains `index-CpK1aw8K.js`. No runtime, canonical level, engine, Worker,
  auth, leaderboard, or player-save changes in this repair. The Task 6 172/172
  browser result still applies to the identical gameplay bundle.

Independent work: Task 7 pipeline is local on `codex/blender-piece-pipeline`,
commit `73d6fa0`, with two material studies awaiting Russ's selection. Task 11 is
running on `codex/campaign-balance-analysis` in its own worktree; the first full
screen passed 60,000 runs / 772,840 actions / zero errors, with repeat/outlier
verification pending. Those changes are not included in PR 47.
No gameplay merge, Worker deployment, new player or physical-device acceptance.

## 2026-09-09: Task 6 Pacing Candidate Complete Locally

Task 5 is `08b7c33`; planning security integration is `b837dfb`. Task 6 has passed
its gates and is committed with `Tune readable match and cascade pacing`.
PR 45 remains green/ready, with all review threads resolved, not merged.

- Four pure regressions first failed for the missing connected-group planner.
  The approved 80 ms cap regression failed against the old 150 ms value. Browser
  reds then showed a group's edge opening before its center due to the distant
  shared centroid, and no independent recognition boundaries for three cascades.
- Added deterministic orthogonal same-family grouping, including different-family
  matches that touch. Input order and duplicate cells do not change the plan.
  Group stagger is 25 ms/cell capped at 80 ms; initial recognition stays 140 ms,
  later landed waves use 100 ms. Every required pop finishes its open-cell hold
  before gravity. The 130 ms hold already existed after ordered playback; no
  second hold was added. Cosmetic debris still overlaps later phases.
- Trial rocket flight is 420 ms, propeller 450 ms, Light Ball wave spacing 120 ms.
  Swap travel/settle, fall curve/landing, and the 2,500 ms ending are unchanged.
  The Light Ball primary-effect planned bound advances by exactly 80 ms for four
  20 ms longer intervals, preserving its existing 50 ms headroom. Contact/hiding,
  stage identities, secondary clears, wave counts and resource assertions remain.
- Focused pure tests pass 51/51; all 335 units pass in 11 files, including frozen
  engine parity. All 100 levels validate; build/typechecks and diff check pass.
  Candidate bundle: `index-CpK1aw8K.js`. Both new browser regressions pass on
  Chromium/iPhone WebKit (4 instances). The first full e2e stopped at 119 passed /
  1 failed / 52 not run: Next Level's test accepted the old trace after React
  detached its canvas but before Phaser's deferred teardown deleted it. The
  retained trace proves the array existed at 526649 ms and was absent at 526655 ms.
  Evidence: `/private/tmp/gridwatch-task6-first-failure-20260909/`. The probe now
  waits for a different trace identity and snapshots its kinds atomically; the
  no-stale-action assertion is unchanged. Temporarily restoring the old CREATE
  closure made that corrected assertion fail on `action-received`, proving it
  still detects the intended defect. Mutation evidence:
  `/private/tmp/gridwatch-task6-lifecycle-mutation-red-20260909/`. The temporary
  mutation is reverted; no GameCanvas production changes in Task 6. The corrected
  probe passes on both browsers (2/2), and the fresh full suite passes 172/172 in
  13.4 minutes on the unchanged `index-CpK1aw8K.js` candidate. No retries or
  assertion relaxation. Build/typechecks and final diff check also pass.
- Baseline captures: `/private/tmp/gridwatch-pacing-baseline-h2FQoj/`, 36 real
  flows across desktop and mobile, including ordinary/independent groups, a
  three-stage cascade, four singles, ten combos and a winning combo. Candidate
  captures at `/private/tmp/gridwatch-pacing-candidate-gHtGFD/` also pass all 36.
  `comparison.json` confirms all 660 stage boundaries, final occupants, HUD score
  and objectives are identical. Zero capture errors, overflow or leaked tracked
  VFX resources. Inspected desktop/mobile cascade and mobile power-up motion sheets:
  distinct waves, open cells before fall, no observed pop-in or ghost trails.
  Measured rocket flight increased 384->433 ms desktop / 380->439 ms mobile;
  propeller 386->451 / 387->460 ms. Light Ball dim-to-undim increased 1330->1410 /
  1117->1256 ms. Endings remain 2517 / 2520 ms. These single headless capture
  samples include scheduling/capture overhead, not physical performance targets.
  Nominal 25 ms first-wave stagger can span a roughly 90-100 ms frame gap during
  initial recorded VFX startup; it also occurred in the baseline. Later wave
  spreads generally track 20-40 ms. Warm headed performance remains Task 13.
  Reproduction: `/private/tmp/gridwatch-pacing-capture.cjs baseline|candidate`;
  comparison helper: `/private/tmp/gridwatch-pacing-compare.cjs <before> <after>`.
  No engine, canonical level, Worker, auth, leaderboard, or scoring changes.

Next: Task 7's reproducible Blender pipeline and concrete material studies.
No new player,
physical-device, art, audio, merge, or production-deployment acceptance claimed.

## 2026-09-09: Planning Security Repairs Integrated Locally

Task 5 is committed as `08b7c33`. The gameplay branch integrates planning repairs
`c586bc9` and `277ca02` through a local merge, preserving their PR ancestry and all
individual task commits. Only HANDOFF needed conflict resolution; both histories
are retained. No main/PR merge or production deployment. The repaired install,
high-severity audit and build/typechecks pass; two moderate Vitest advisories stay
separate maintenance. The client bundle remains exactly `index-DLcD2sj2.js`.
Next: Task 6, baseline/candidate pacing captures and connected-group timing.

## 2026-09-09: PR 45 Unblocked; Task 5 Complete Locally

Russ requested correction of the blocked PR and continuation through the plan.
The earlier incorrect test-probe pause is resolved under that authorization.

- PR 45 repair is committed/pushed as `c586bc9` on the separate planning branch
  `codex/game-feel-balance-plan-20260908`. Randomized private temporary output
  directories fix both high CodeQL findings. A narrow Miniflare override to Sharp
  0.35.4 fixes the high audit gate; only Sharp/native/libvips lock entries changed.
  Follow-up `277ca02` documents the randomized output paths and resolves the
  remaining review thread. Fresh CI, CodeQL analysis, CodeQL security gate and
  Pages preview all pass at that head; GitHub reports CLEAN. PR 45 is ready for
  review, not merged or Worker-deployed.
  Two moderate Vitest advisories remain separate maintenance. The repair is not
  yet integrated into this gameplay branch; do so at a clean task boundary.
- Task 5's corrected `rocket-head-launch` probe established the intended red:
  Play On covered a still-running final rocket. Additional pre-implementation
  browser reds confirmed early boss-fail UI, queue interruption of a long chain,
  immediate final HUD score, boss time charged during effects, and a win result
  appearing while hidden. The initial short queue specimen passed and was replaced
  with the existing long-chain fixture to expose the predicted fixed-budget bug.
- Twelve new pure lifecycle tests pass. Completion IDs now gate queue release,
  queue depth stays three, terminal outcomes discard queued actions, and HUD
  progress follows real step boundaries using the already-authoritative score.
  Engine scoring, awards, action logs, submission arguments and backend unchanged.
- Candidate boss rule is visible controllable time, not unchanged iOS parity.
  Authored durations are unchanged. Forced playback, hidden tabs and results pause
  the monotonic clock. Boss expiry and final-move failure wait for active playback.
  Win celebration remains 2,500 ms and callback-driven, with its wall fallback
  removed. Scene recovery is separate, plan-derived, paused with scene timers, and
  reports an interrupted run rather than awarding a false completion.
- Initial build/typechecks passed (`index-ALsBXgly.js`), 327 units passed, all 100
  levels validated, and 18 focused lifecycle browser instances passed on Chromium/
  iPhone WebKit. The full suite then stopped at 90 passed / 1 failed / 75 not run:
  mobile `app.spec.ts:160` measured the ending at 2,901 ms against its unchanged
  2,900 ms ceiling. No assertion relaxation or flake retry was applied.
- Diagnostic captures completed six final-power-up/result flows with exact stage
  identities, one completion each, and clean tracked VFX resources. Captured endings
  were 2,511 ms desktop / 2,509 ms mobile; this did not erase the full-suite failure.
  Evidence: `/private/tmp/gridwatch-lifecycle-LYtcwM/`. Some mobile screenshots were
  scrolled by Playwright's QA-button clicks; the capture helper now invokes those
  diagnostic buttons without scrolling for the final visual pass.
- Phaser Clock accumulates smoothed frame deltas but exposes unsmoothed `now`.
  The ending now uses a pure pause-aware elapsed-time timeline, driven by scene
  updates. It preserves the nominal 2,500 ms duration, at least one row-pop interval
  between overdue rows, and the final pop/hold before completing. It never bunches
  overdue rows or reports completion from an unrelated wall timer. Four additional
  pure regressions first failed for the missing timeline, then passed (16 focused
  pure tests total). New build/typechecks pass as `index-CFrz_7qr.js`; the unchanged
  desktop/mobile ending-time assertions pass in the focused browser run. Final
  full-suite/capture/warm-drag gates remain pending. No player/device acceptance.
- The second full run on `index-CFrz_7qr.js` stopped at 146 passed / 1 failed /
  19 not run: WebKit `presentation.spec.ts:577` timed out waiting for page load
  before the Light Ball test reached scene readiness or made an action. Its
  screenshot was blank; no DOM snapshot was available. This is a separate,
  unexplained navigation failure, not evidence of a Light Ball effect regression.
  No retry, timeout increase, config change, or assertion relaxation was applied.
- A new Next Level regression held the level response until the new scene booted.
  It failed because the CREATE callback replayed the previous level's final action
  from mount-time props. CREATE now reads the latest presentation props through a
  ref. Both Chromium and iPhone WebKit pass the unchanged regression on the fresh
  `index-DLcD2sj2.js` build. Scene mount/FPS timing remains unchanged. The final
  full suite passed all 168 cases (13.2 minutes), with no retries. This includes
  the previously timed-out navigation, without claiming its root cause is fixed.
- Fresh final verification: 331 units in 10 files, 100 level validations, build/
  typechecks and diff check pass. Final captures at
  `/private/tmp/gridwatch-lifecycle-MJqYPD/` cover final-fail, boss-expiry and winning
  power-ups at 1280x720 Chromium and iPhone 15 WebKit. All six retain exact stage
  IDs, one completion, zero page/console errors, no overflow and zero tracked VFX
  resources after cleanup. Inspected video frames show sequential bottom-up rows,
  no early result overlay, and complete board framing. Endings measured 2,516 ms
  desktop / 2,532 ms mobile. These are emulation/capture observations, not physical
  phone or subjective audio acceptance. The known TNT raw-scale art issue remains
  assigned to Task 8. All 20 consecutive warm drag runs passed on the final build
  (40 desktop/mobile instances, zero failures, no retries). Evidence:
  `/private/tmp/gridwatch-drag-gate-task5-Qyjzrx/`.
- A test helper needed a one-line `unknown` cast for TypeScript. One browser run
  was mistakenly launched after that failed build, repeated the known Task 4 red,
  and is not Task 5 evidence. The subsequent build and all focused passes used
  the fresh Task 5 bundle. No assertion was weakened to produce a pass.

Task 4 is `288ba0c`. This change is Task 5, committed with the exact message
`Gate game transitions on playback completion`. Original checkout's pre-existing
edits remain untouched. No gameplay push, main merge or production deployment.
Next: integrate the planning-branch security repairs, then Task 6's local pacing
comparison without a routine approval stop.

## 2026-09-09: Task 4 Chained Power-Up Playback Complete

Task 3 is committed locally as `687eced`. Task 4 completed on the same branch.

- Red browser regression confirmed the intended defect: tapping a recorded rocket
  played its own animation but omitted the secondary TNT. New pure tests initially
  failed for missing activation grouping, semantic combo contacts, and completion
  barrier APIs. Four contact cases remained red until recorded combo source cells
  were included, since legacy event target lists omit some consumed sources.
  Test expectations and frozen fixtures were not rewritten to obtain green.
- Added activation-ID grouping using recorded source identities to distinguish
  deliberate combos from secondary singles. Repeated records of consumed origins
  no longer create extra effects. Distinct effects share a wait-for-all callback
  barrier; combos and mixed single effects are not globally suppressed.
- Combo batch callbacks now open their actual pieces and trigger the existing
  local burst/audio on the contact frame. Cosmetic arc caps do not limit semantic
  contacts. No engine, level JSON, timing constant, auth/DB/leaderboard, or score
  changes. The 2,500 ms terminal sequence remains unchanged.
- Focused pure suite passes 18/18; full units pass 315/315 including immutable
  engine parity. New engine-driven browser suite passes 26/26 across Chromium and
  iPhone WebKit: all ten combos, a rocket/TNT chain, a combo hitting a third Light
  Ball, and two secondary effects with different durations. Checks require every
  real activation once, exact state boundaries, and contact-frame tile hiding.
- Final review also migrated the pre-flash stagger helper from legacy trigger
  grouping to the same activation-metadata groups. No timing constants changed.
  Fresh units pass 315/315; all 100 levels validate. Build/typechecks pass with
  the existing chunk warning. Both previews serve `index-Ejpx6kKs.js`. The final
  build passes 148/148 e2e (10.7 minutes), with no retries. The warm-preview drag
  gate passes 20/20 iterations (40 browser instances), with no failures/retries;
  logs are retained at `/tmp/gridwatch-drag-gate-task4-20260909/`.
- Six real-action captures pass: rocket -> TNT, combo -> third Light Ball, and
  rocket -> two concurrent secondaries, each in desktop Chromium and iPhone 15
  WebKit emulation. Exact stage occupants, distinct activation completion, and
  zero tracked VFX resources after cleanup were verified. No page exceptions,
  console errors, Vite overlays, or horizontal overflow; Chromium capture-only
  GPU ReadPixels warnings. Browser plugin not available; installed Playwright used.
  Videos, before/settled screenshots, traces, and results are retained at
  `/tmp/gridwatch-chains-20260909/`; reproduction script:
  `/private/tmp/gridwatch-chain-capture.cjs`.
- Inspected the complete motion sheets (including later cascade tails) on both
  viewports. Secondary effects precede gravity and subsequent matches follow
  landing. The single-secondary mobile capture also confirms the known Task 8
  scale defect: TNT charges toward raw `scaleX/scaleY: 1.15` after display sizing,
  briefly covering the board. These lines predate this work (June `5383aaf2`).
  It remains explicitly queued for Task 8's scale correction, not accepted as
  finished visual polish. No physical-device or new player acceptance claimed.

Commit: `Play chained power-ups without skipping effects`.
Next: Task 5, callback-driven queue/result/HUD/boss-clock lifecycle.
No implementation push, merge, deployment, or new player acceptance.

## 2026-09-09: Task 3 Ordered Cascade Playback Complete

Russ approved migrating remaining legacy timing assertions to their actual stage
boundaries, preserving per-effect limits and stopping for real regressions.

- Reproduced the unchanged Light Ball assertion failure: planned dim-to-gravity
  1,470 ms against 1,050 ms. The approved test correction keeps the 1,050 ms limit
  on dim-to-undim and separately requires both pre-gravity clears (14 then 12
  occupants), exactly the second clear's occupant IDs at impact, its actual
  rendered state, and completion before gravity. No gameplay timing/code changed.
- Focused test passes in Chromium and iPhone WebKit (2/2). Full Playwright suite
  passes 122/122 with no retries. Fresh unit suite passes 301/301, including frozen
  engine parity contracts; all 100 levels validate. Build/typechecks and
  `git diff --check` pass. Existing bundle-size warning only.
- All-level browser audit: one deterministic legal action on each of the 100
  levels in Chromium, plus Levels 1, 6, 7, 13, 51 in iPhone WebKit. All 105 sampled
  actions pass: 910 stage boundaries, 171 clear waves, exact rendered IDs/positions,
  persistent survivor container instances, and only genuinely new IDs spawning.
  No missing move IDs, page exceptions, console errors, Vite overlays, or horizontal
  overflow. These are action samples, not full campaign-completion playtests.
- Inspected desktop/mobile motion contact sheets and board screenshots for all
  five selected levels. Empty cells precede falling refills, subsequent matches
  follow landing, and lock markers remain legible. No observed destination pop-in,
  ghost trails, or hard snap-back. Captures include loading and element-screenshot
  viewport adjustments outside gameplay; do not mistake those for board motion.
  Browser plugin not available; used installed Playwright (Chromium 1280x720 and
  iPhone 15 WebKit emulation). Only console warnings were Chromium GPU ReadPixels
  stalls during capture, not app exceptions. No physical-device acceptance claim.
- Evidence: `/tmp/gridwatch-ordered-playback-20260909/` contains all action traces,
  `results.json`, ten before/settled screenshot pairs, videos and motion sheets.
  Reproduction script: `/private/tmp/gridwatch-campaign-playback.cjs`.
- Warm-preview drag gate passed 20/20 consecutive iterations, 40 browser instances,
  no retries/failures. Each run retained in `/tmp/gridwatch-drag-gate-20260909/`.
  A single preview on 4173 served the fresh `index-PhdOA2p2.js` build throughout.
- Task 3 implementation reuses real occupants at adjacent engine boundaries,
  awaits every clear/fall/refill, reveals creations before later movement, handles
  empty gravity without phantom falls, and protects active stages during resize.
  The previously approved win-only completion dependency is included; terminal
  duration remains 2,500 ms. Timing assertion migrations do not alter gameplay.
- Commit message: `Render cascades from ordered engine steps`. Nothing pushed,
  merged, or deployed. Local review remains at `http://127.0.0.1:4174/`.
  Original checkout retains only its pre-existing lockfile and untracked July plan.
  Task 4 secondary activation choreography and Task 5 remaining queue/fail/clock/
  recovery lifecycle work are still pending. Current gameplay acceptance is open.

Next: Task 4. Earlier Task 3 approval pauses below are historical/resolved.

## 2026-09-09: TNT Phase Assertions Pass; Light Ball Timing Boundary Pauses Task 3

Russ approved stage-aware effect-count tests with exact per-effect limits.
The TNT test now requires exactly one detonation, flash, shockwave, and activation
shake. It separately requires the recorded three six-tile later match groups,
one weaker shake at each group-start frame, and no unmatched extra shakes.
Both Chromium and iPhone WebKit focused tests pass (2/2). Gameplay code and
timing constants were not changed for this test correction.

- Full suite progressed to 43 passed, 1 failed, 78 not run. The next failure is
  `tests/e2e/presentation.spec.ts:494`, single Light Ball, at line 528: planned
  dim-to-first-cascade bound <= 1,050 ms, observed 1,470 ms. This assertion is
  unchanged. No retry or gameplay change was made after the failure.
- Read-only stage capture shows the first Light Ball clear removes 14 occupants;
  a subsequent recorded activation/clear removes 12 more before gravity. The
  initial effect's planned dim-to-undim duration remains 1,000 ms. The old bound
  spans the subsequent clear's 240 ms planned recognition/impact and a 230 ms
  cascade marker, totaling 1,470 ms. Unlike the prior empty-gravity issue, the
  intervening clear has real occupants and cannot simply be skipped.
- Actual scene times from this diagnostic: initial undim about 1,305 ms, first
  clear completion 1,537 ms, second clear completion / gravity start 2,076 ms,
  final settled boundary 11,146 ms. Planned time is NOT measured wall-clock
  performance. No page exceptions or missing move IDs. Raw trace, all 27 stage
  frames, and audits: `/tmp/gridwatch-lightball-stages-20260909/trace.json`.
- Proposed correction: apply the unchanged primary-effect timing bound to its
  own completion boundary, and separately assert the additional clear completes
  before gravity. Preserve wave counts, contact alignment, release/restore order,
  flash count, and fall-distance checks. Secondary activation choreography remains
  Task 4; this test migration must not claim that VFX work is complete.
- Request approval to handle remaining legacy stage-boundary timing assertions
  together, preserving per-effect limits and stopping for actual gameplay
  regressions. Current approval covered effect counts, not this timing-boundary
  change, so the assertion has not yet been edited.
- Task 3 remains uncommitted; all-level renderer audit, remaining e2e cases and
  warm drag loop remain pending. Last gameplay revision still has 301 passing
  units, 100 valid levels, passing build, and only the existing bundle warning.
  Build `index-PhdOA2p2.js` remains local at `http://127.0.0.1:4174/`.
  No implementation push, merge, deployment, or new player acceptance.

Next: await the timing-boundary migration approval, then resume Task 3 gates.
The TNT effect-count pause below is historical and resolved.

## 2026-09-09: Empty Stage Fixed; Whole-Action TNT Shake Assertion Pauses Task 3

Russ approved the empty-stage correction. A new browser regression first failed
with two `cascade-start` events where only one physical fall occurs. The renderer
now retains the empty engine boundary and its identity audit, but skips motion
tracing/audio when that stage has no moves or spawns. No timing constant changed.

- Focused gate passed 6/6 across Chromium and iPhone WebKit: empty-stage identity,
  unchanged normal-timeline bounds, and reduced-motion chain audio. Fresh full
  unit suite passes 301/301; all 100 level files validate; build/typechecks and
  `git diff --check` pass. Existing bundle-size warning only. Latest local build:
  `index-PhdOA2p2.js`.
- Full browser suite stopped at a different assertion: 40 passed, 1 failed,
  81 not run. `tests/e2e/presentation.spec.ts:389`, single TNT, fails at line 418:
  whole-action `shake-request` count expected 1, received 4. No retry, test
  relaxation, or gameplay change was made after this failure.
- Read-only capture confirms one TNT detonation and one TNT shake (intensity
  0.008) at the same scene time. Three later six-tile normal match groups each
  emit their existing strong-match shake (0.006), at their own group-start frame.
  Full playback reaches `settled`; zero page exceptions. Evidence:
  `/tmp/gridwatch-tnt-phases-20260909/trace.json`.
- This is a legacy whole-action assertion counting legitimate newly visible
  cascade effects as duplicate TNT effects. Proposed test correction: assert
  exactly one TNT activation shake within its activation phase and separately
  verify later shakes against actual normal match waves. Preserve exact per-effect
  counts and timing checks; do not replace the assertion with an unbounded minimum
  or suppress correct cascade presentation to satisfy it.
- Task 3 remains uncommitted. All-level rendered-state audit, remaining browser
  cases, and warm drag loop are still pending. Original checkout still has only
  its pre-existing lockfile edit and untracked July plan. No implementation push,
  merge, deployment, or new player acceptance.

Next: request approval to make presentation effect-count assertions stage-aware
while preserving their per-effect limits, then resume Task 3 verification.
The empty-stage pause below is historical and resolved.

## 2026-09-09: Winning Gate Fixed; Empty-Gravity Trace Regression Pauses Task 3

Russ approved moving only the winning-action completion gate from Task 5 into
Task 3. Added a browser regression first: at terminal start it expected the last
board boundary to be `settled`, but observed `clear`, confirming the expected red.

- Removed App's fixed pending-win fallback. Only the matching animation-complete
  callback starts the win sequence; pending completion is cleared on teardown.
  The winning-combo test now awaits actual resolution before its result check,
  retaining every existing combo/order assertion. Queue, boss clock, failure
  transitions, score calculations, submissions, and the 2,500 ms ending are unchanged.
  The celebration's own fallback remains Task 5 work, as do recovery/lifecycle cases.
- Green focused gate: 6/6 Chromium/iPhone WebKit tests for settled-before-ending,
  existing combo ordering, and ending duration. Fresh 301/301 unit tests and
  build/typechecks pass. Existing bundle-size warning only. Local build:
  `index-DNGpOuDG.js`, preview `http://127.0.0.1:4174/`.
- Full Playwright run stopped at the next failure: 28 passed, 1 failed, 91 not
  run. `tests/e2e/presentation.spec.ts:162` fails its unchanged planned-timeline
  upper bound at line 189: expected <= 1,300 ms, observed 1,330 ms. This is not
  the pointer-init flake; no retry or assertion relaxation was used.
- Read-only diagnostic of Level 1 `(0,0)->(1,0)` identifies empty-stage bookkeeping:
  gravity has zero moves and zero spawns, followed by a refill with three spawns.
  Both emit `cascade-start` at the same scene time (765.6 ms after the action),
  each adding 230 ms to the planned trace. Actual completion was 1,287.8 ms;
  planned completion was 1,330 ms. No page exceptions or missing move IDs.
  Evidence: `/tmp/gridwatch-timeline-20260909/trace.json`.
- Proposed narrow fix: preserve the empty engine boundary but do not run motion
  trace/audio bookkeeping for a gravity/refill stage with no moving or spawning
  occupants. Add the empty-stage regression before changing code. Keep existing
  timing constants and assertions intact; do not widen the failed upper bound.
- Task 3 remains uncommitted. All-level renderer verification, remaining browser
  cases, and the warm drag loop remain pending. No implementation push, merge,
  deployment, or player-acceptance claim.

Next: await approval for the empty-stage bookkeeping fix, then finish Task 3
verification and commit `Render cascades from ordered engine steps`. Both prior
approval pauses below are historical and resolved.

## 2026-09-09: Task 3 Level 6 Wait Fixed; Winning Transition Gate Blocks Completion

Russ approved adjusting the test-only completion wait. The Level 6 helper now
awaits the actual `resolution-complete` event with a bounded 30-second limit;
gameplay timing constants and every identity/state assertion are unchanged.
Both Chromium and mobile WebKit Level 6 regressions pass (2/2).

- Removed unused final-snapshot resolution methods superseded by the stage
  runner. Fresh verification: 301/301 unit tests, all 100 level validations,
  build/typechecks pass. Existing bundle-size warning only. Latest preview build
  is `index-J8HrFRJw.js` at `http://127.0.0.1:4174/`.
- Full Playwright run stopped at its first failure: 8 passed, 1 failed, 109 not
  run. Failure: `tests/e2e/app.spec.ts:163`, winning rocket combo before terminal
  rows, at the unchanged `comboCharge` assertion on line 181. This is not the
  authorized pointer-init flake and was not retried to claim green.
- A separate read-only browser observation retained events across trace resets.
  The combo charge and impact DO play, at scene times 943 and 1,607 ms. However,
  `win-sequence-start` occurs at 4,052 ms while a cascade is still active;
  `resolution-complete` occurs at 6,053 ms. The two presentations overlap for
  about two seconds. The premature win start also resets the trace, explaining
  why the final test trace no longer contains the earlier charge.
- Source diagnosis: App's `pendingWinRef` fixed
  `RESOLVE_ANIMATION_BUDGET_MS + 500` fallback calls `finishWin` before ordered
  playback completes. `BoardScene.playWinSequence` starts immediately and resets
  VFX/trace while the stage runner is still active. No browser page exceptions.
  Captured history and result screenshot:
  `/tmp/gridwatch-winning-combo-20260909/{trace.json,result.png}`.
- This exposes a Task 3/Task 5 dependency: Task 3's full regression gate cannot
  pass with the old terminal fallback interrupting its longer complete playback.
  Requested permission to move only the winning-action completion gate from
  Task 5 into Task 3. Preserve the 2,500 ms ending, test assertions, and engine
  outcomes; do not shorten cascades or merely preserve misleading trace entries.
  Remaining Task 4/5 work stays in plan order unless separately authorized.
- Task 3 remains uncommitted. The 100-level renderer audit and further e2e checks
  are paused. No implementation push, merge, or deployment. The original checkout
  and its unrelated changes remain untouched.

Next: await this narrow dependency approval, then add regression coverage for
the completion gate before implementing it and rerunning Task 3 verification.
The prior Level 6 timeout pause below is historical and resolved.

## 2026-09-09: Task 3 Paused On Level 6 Browser Timeouts

Task 2 is committed as `1ca31d8`. Task 3 is uncommitted on
`codex/gameplay-causal-playback` in `/private/tmp/gridwatch-match-planning-20260908`.
No implementation push, merge, or deployment has occurred.

- Added a callback-driven ordered stage runner and App's `applyWithResolution`
  handoff. Board playback now renders adjacent stages, reuses real occupant
  containers by ID, separates gravity/refill, and shows creation before later
  movement. Stage audits inspect actual sprites before the final truth redraw.
- Passed 301/301 unit tests and build/typechecks (existing chunk warning only).
  Focused Playwright run: 16 passed, 2 failed. New intermediate-wave, same-cell
  identity, falling-created-power-up, resize, and single-contact cases passed
  in Chromium and iPhone WebKit. Full e2e and the 100-level renderer audit have
  NOT run; Task 3 is not complete or accepted.
- Both failures are `tests/e2e/app.spec.ts:58`, the Level 6 cascade regression:
  its second swap `(3,5)->(3,6)` exceeds `waitForResolutionComplete`'s 5-second
  limit. This is NOT the previously authorized scene-init flake. The timeout
  has not been raised, and the failed run has not been retried to claim green.
- A separate read-only, bounded 30-second observation replayed the exact two
  swaps. The second action completed all five clear waves / 24 stages in both
  browsers, ending at `settled`, with matching IDs/positions, preserved survivor
  container instances, and zero page exceptions. Chromium: 8,924 ms wall-clock,
  7,409 ms scene-clock; mobile WebKit: 8,933 ms wall-clock, 7,441 ms scene-clock.
  The first action completed in about 1.45 seconds. These diagnostics establish
  that this reproduction is not stuck; they do not turn the failed tests green.
- Diagnostic JSON and final screenshots are in
  `/tmp/gridwatch-level6-timeout-20260909/`. Latest local build is
  `index-CQ8MKYD9.js`, preview at `http://127.0.0.1:4174/`.
- Secondary activation VFX remain Task 4; fixed-budget queue/result transitions
  remain Task 5. Timing acceptance is still open. Do not claim all chained or
  terminal effects are fixed by the partial Task 3 work.

Next: request approval to adapt the test-only completion wait for multi-stage
playback, retaining all identity/state assertions and gameplay timings. Then
finish Task 3 verification and commit `Render cascades from ordered engine steps`.
Do not advance, commit Task 3, or publish the partial implementation while paused.

## 2026-09-09: Task 2 Ordered Engine Records Complete

Russ approved correcting the new test scenario. Generator/lock assertions remain
against the frozen specimen; a separate in-memory level copy adds surviving malware
outside the blast and retains the propagation assertion. Frozen files and engine
rules were not changed to resolve the test failure.

- Passed 297/297 unit tests: both APIs preserve all 21 specimens and 34,054 frozen
  action outcomes each, including invalid actions, RNG, IDs, HP, score, objectives,
  move count, and action logs. Ten focused stage/identity/metadata checks pass.
- Build/typechecks and `git diff --check` pass. The existing Phaser chunk warning
  remains. All-level validation and capture-overhead evidence from the prior Task 2
  checks remain applicable; only the test scenario changed after that measurement.
- New pure `applyWithResolution` returns detached ordered boundaries and causal
  activation metadata. Legacy `apply` uses the same implementation without optional
  frames. The renderer still uses the old handoff until Task 3.
- Commit message: `Expose deterministic resolution steps for playback`.
  No implementation push, merge, deployment, or player-acceptance claim.

Next: Task 3, adjacent-stage renderer playback and browser identity checks.

## 2026-09-09: Task 2 Paused On An Unexpected New Test Failure

Task 0 is committed as `9554063`; Task 1 as `056909a`. Task 2 is uncommitted on
`codex/gameplay-causal-playback` in `/private/tmp/gridwatch-match-planning-20260908`.
Modified: `src/engine/{types,boardEngine}.ts`; new `src/tests/resolution.test.ts`.
No implementation push, merge, or deployment has occurred.

- Added optional `applyWithResolution` through the existing resolution algorithm.
  Records include detached stage snapshots, IDs, HP changes, objective changes,
  activation/parent identities, combo participants, and repeat-origin metadata.
  Legacy apply does not allocate optional snapshot frames.
- The initial eight stage tests passed after the expected missing-API reds.
  Full suite passed 295/295, including both APIs against 21 specimens and all
  34,054 frozen actions per API. Build passed; all 100 levels validate. No frozen
  fixture, game rule, RNG call, aggregate delta, score, or backend changes.
- A subsequent added coverage test FAILED at `src/tests/resolution.test.ts:171`:
  it expected the `generator-and-lock` fixture to contain a malware propagation
  change. This was an agent-authored test scenario mistake: the immutable baseline
  has one HP-1 malware tile at (5,5), destroyed by TNT at (5,6); final malware is
  empty. The assertion has NOT been weakened or removed, and rules are unchanged.
- Stopped for the user's unexpected-test-failure guardrail. Requested approval to
  correct this new test's scenario using surviving malware, preserving the existing
  frozen fixture and its assertions for generator/lock behavior. Do not claim Task 2
  green or commit it until the test is corrected and the gates rerun.
- Worst sampled depth was 10 (Level 3, seed 19): 49 steps, 808,812 serialized bytes,
  median apply 0.33 ms versus captured apply 1.12 ms on this Mac. Also sampled max
  event count 21 and max clears 102. Raw timings and noisy GC heap deltas are in
  `/tmp/gridwatch-resolution-benchmark-20260909.json`; script is
  `/tmp/gridwatch-resolution-benchmark.mjs`. These are local measurements, not
  mobile performance claims. Some heap deltas are negative and are not peak-memory
  estimates; serialized size and cell-copy counts are the reliable size measures.

Next: resolve the new test-scenario approval, rerun Task 2 gates, then commit
`Expose deterministic resolution steps for playback` and continue Task 3.

## 2026-09-08: Task 1 Single-Power-Up Contacts Complete

Branch/worktree remain `codex/gameplay-causal-playback` at
`/private/tmp/gridwatch-match-planning-20260908`.
Commit message: `Synchronize power-up impacts with tile breaks`.

- Red-green coverage reproduced shuffled TNT target/time pairing, missing shared
  contacts, early/late piece hides, and damage-only TNT completing before detonation.
  Tests were not weakened. The actual effect contact now hides each affected piece
  and cues its break once; rocket origin is deduplicated, propeller waits for arrival,
  and Light Ball uses the same seeded target batches. Shield-only TNT retains the
  pieces and waits for the effect before resolution completion.
- Passed: 243/243 units, build (existing chunk warning), 112/112 full Playwright
  tests (56 Chromium, 56 iPhone WebKit), and `git diff --check`. No browser retries.
  The no-write frozen verifier still matches 21 specimens and all 34,054 actions.
- Eight fresh single-power-up captures passed exact scene-frame contact/hide
  comparisons, including 4x CPU-throttled Chromium and mobile WebKit. Captures,
  traces, and videos: `/tmp/gridwatch-contact-20260908/`; reproduction script:
  `/tmp/gridwatch-contact-capture.cjs`. Inspected one impact capture per family.
  These are headless checks, not physical-device or subjective acceptance.
- Deliberately retained the flattened final-snapshot handoff and legacy combo
  suppression for Tasks 2-4. Subsequent-wave pieces may still appear prematurely
  cleared; this task does not claim full cascade fidelity or finished game feel.
- No engine, level, asset, dependency, backend, save, score, or leaderboard changes.
  No implementation push, merge, or deployment yet. Preview remains on port 4174.

Next: Task 2, observation-only ordered engine steps, checked against frozen outcomes.

## 2026-09-08: Task 0 Baseline Frozen

Implementation branch: `codex/gameplay-causal-playback`, in the isolated worktree
`/private/tmp/gridwatch-match-planning-20260908`, based on planning commit `34a7542`.
Task commit message: `Record gameplay timing and balance baselines`.
No gameplay, engine, level, asset, backend, or dependency files changed.

- Fresh baseline: 238/238 unit tests, 100 valid levels, build passed with the existing
  bundle-size warning, 102/102 Playwright tests passed (51 Chromium, 51 WebKit).
- Installed missing Playwright Chromium 1234 and WebKit 2336 test runtimes. Initial
  launch failures were missing executables, not gameplay assertion failures. Vite
  and browsers required local sandbox execution permission. No tests were relaxed.
- Node 24.16.0; Blender 5.1.0 `adfe2921d5f3` responds at its application CLI path.
  Blender's existing USD cache-line warning persists; renders are Task 7 work.
- Immutable fixtures total 2,945,594 bytes: 2,000 sensitivity runs, 34,054 actions,
  and 21 full specimens. Every engine/level source hash is recorded against
  `328a1a7`. A separate no-write replay verified every complete outcome hash and
  focused initial/before/after snapshot, including IDs, HP, RNG, and action logs.
- Specimens cover all ten combos, damage without occupant clear, generator/lock,
  repeated coordinates, created power-up then later tap, coordinate reuse across
  activation/creation, post-resolution shuffle, and five invalid actions.
- Coverage clarification: aggregate events at the same coordinate are not proof
  that a newly created power-up was consumed later in the same action. Existing
  resolution drains initial power-up chains before ordinary match creations.
  The corpus labels coordinate reuse honestly and separately covers a created
  piece consumed by a later action. Task 2 must use IDs/stages before claiming
  same-action created-then-consumed coverage; do not change rules to force it.
- Sixteen baseline browser captures cover ordinary match, the Level 1 three-wave
  engine cascade, all four singles, and two representative combo previews at
  1280x720 Chromium and iPhone 15 WebKit. Raw traces, 48 screenshots, and videos
  are in `/tmp/gridwatch-resolution-baseline-20260908/`. No page exceptions or
  horizontal page overflow. Some canvas-element screenshots include the sticky
  header after automatic scrolling; they are not clean art-acceptance captures.
- Actual scene-clock break-minus-contact ranges: desktop rocket 0..458 ms,
  TNT -97..222 ms, propeller +467 ms, Light Ball -480..435 ms; mobile rocket
  0..80 ms, TNT 39..162 ms, propeller +200 ms, Light Ball -561..107 ms.
  Capture overhead/parallel baseline tests affect wall timing. These demonstrate
  competing clocks, not performance benchmarks. Both render the three-wave
  Level 1 action as only one clear/fall stage. Player acceptance remains open.
- Dependency audit on the unchanged base reports 3 high findings (sharp via
  miniflare/wrangler) and 2 moderate (Vitest/mocker). Separate maintenance scope;
  no automatic dependency fixes, merge, push, or deployment performed this task.

Next: Task 1, shared single-power-up contact dispatch and actual visibility tests.
## 2026-09-09: PR 45 Security Gate Repairs

PR 45 was blocked by its dependency audit and two high-severity CodeQL findings,
not merge conflicts. This maintenance is isolated from the gameplay implementation.

- Audit scripts now create private, randomized temporary directories and exclusive
  mode-0600 JSON reports. Both actual scripts completed; directory mode 0700,
  report mode 0600, and overwrite rejection were verified. Future runs print their
  output paths. Historical capture paths below remain historical evidence.
- A scoped Miniflare override pins Sharp 0.35.4 (patched libheif 1.23.2). No broad
  dependency upgrade, audit suppression, application, level, or backend change.
  Lockfile changes are confined to Sharp and its native/libvips packages.
- `npm ci --ignore-scripts`, 238 unit tests, all 100 levels, build/typechecks,
  `npm audit --audit-level=high`, Sharp resize/PNG smoke, and Wrangler 4.119.0 CLI
  smoke passed. The two moderate Vitest advisories remain separate maintenance.
  Build retains the existing large-chunk warning. Wrangler log output was directed
  to `/private/tmp` after the sandbox denied its default user-preferences path.
- Production-seed screening completed 4,000 runs / 55,817 actions with zero errors.
  Ten browser audit flows completed against this PR's isolated preview on 4175
  with zero page exceptions. This validates script execution, not gameplay feel:
  the baseline's known contact timing defects remain on this planning branch.
- Evidence: `/var/folders/34/jr0n1ps531348kntshnbv8rm0000gn/T/gridwatch-balance-Oyxok5/`
  and `/var/folders/34/jr0n1ps531348kntshnbv8rm0000gn/T/gridwatch-feel-audit-ZKUADE/`.
  Browser audit used an in-memory URL substitution from 4174 to 4175; source and
  the interactive gameplay preview were not changed.

Published as `c586bc9`: fresh CI, CodeQL analysis, CodeQL security gate and Pages
preview passed; PR 45 reports CLEAN and is ready for review. A subsequent review
comment identified stale reproduction paths in the research README/report. Those
instructions now explain the logged randomized paths while preserving historical
September 8 evidence locations. `git diff --check` passed for that docs-only fix.
Do not merge or deploy. Gameplay Tasks 0-4 and Task 5 work remain on the separate
`codex/gameplay-causal-playback` branch.

## 2026-09-08: Gameplay Acceptance Reopened; Implementation Plan Prepared

Russ reports local gameplay is not fully accepted. Tile breaking still feels off,
the art can improve, and balance needs review. All earlier acceptance statements
below are historical. Current implementation and passing tests do not close this
new quality gate. Pushes and opening GitHub PRs are now authorized; merge/deployment
of unaccepted gameplay is not authorized by that change alone.

The next implementation plan is
`docs/superpowers/plans/2026-09-08-game-feel-assets-and-balance.md`.
Evidence, limitations, and backlog reconciliation are in
`docs/research/2026-09-08-game-feel-audit.md`. Reproducible analysis scripts and
compact results live in `docs/research/2026-09-08-game-feel/`.

Confirmed priorities:

1. Unify effect arrival, actual tile break, and sound. Separate schedulers currently
   produce roughly 0.2-0.3 second late rocket breaks and some Light Ball breaks more
   than half a second early in headless desktop/mobile-sized captures. TNT times are
   also assigned to the wrong cells after sorting loses their position pairing.
2. Preserve intermediate resolution stages. The aggregate delta/final-snapshot
   renderer currently collapses cascades and can omit intermediate creations.
   The proposed engine change is observation-only, with frozen outcome comparisons.
3. Distinguish genuine combos, chained pieces, and already-consumed origin records;
   remove blanket suppression only after causal metadata exists.
4. Make queue/result/HUD and boss timing follow the actual playback lifecycle.
   Retain the 2,500 ms bottom-up celebration after the winning action fully finishes.
5. Build original, reproducible Blender assets and matched fragments with clean
   silhouettes at real mobile size. CLI 5.1.0 is available through the app path.
6. Formalize balance tooling and test isolated hand-authored candidates. Production
   seed screening suggests a difficulty drop after Level 50, with 29-30 unused
   moves typically remaining in Levels 51-70 under the visible-match policy.

Verification this turn: 238/238 unit tests, 100/100 levels, successful build, ten
headless browser flows, 8,000 simulated runs / 113,583 legal actions / zero engine
errors. Browser audit found presentation defects; this is not a passed acceptance
gate. Full e2e and physical-device/audio acceptance remain to be rerun during
implementation. Baseline application code matches main at `328a1a7`; dependencies
in the original checkout differ from current main. No application, engine, level,
asset, backend, or deployment changes were made during planning.

Planning branch: `codex/game-feel-balance-plan-20260908`, isolated from the original
checkout's existing package-lock edit and untracked July plan. Those files are
preserved. Historical July Task 0-18 implementation is complete, but its quality
approval is reopened. Seven dependency PRs are separate maintenance work.

Next: execute Task 0, freeze current outcome fixtures, then Task 1's shared impact
schedule. Do not start another cosmetic timing increase before fixing contact
causality. No new user input is required for those implementation tasks once this
plan is selected for execution.

## 2026-07-19: Main-integration review corrections awaiting deployment

PR #29 integrates `codex/gridwatch-presentation-overhaul` into `main`. Automated
review identified and the branch now fixes two board-audio gaps: reduced-motion
resolutions retain one low-gain impact cue, and multi-stage cascades emit the authored
`chainRise` cue at cascade start. Review cleanup also centralizes existing timing
values, removes unsafe non-null assertions from the reviewed paths, and fixes the
Playwright resolution helper so repeated actions return the newly completed sequence.

- Engine outcomes, level data, Worker APIs, authentication, scores, leaderboards,
  Supabase, and database behavior are unchanged.
- `npm run test`: 238/238 passed.
- `npm run test:e2e`: 102/102 passed across desktop Chromium and mobile.
- `npm run validate:levels`: 100 passed, 0 failed, 0 warnings.
- `npm run build`: passed with only the existing Phaser bundle-size warning; the
  reviewed local build is `assets/index-tBNyYWXV.js`.
- `npm audit --audit-level=high`: zero vulnerabilities.
- These post-deployment review corrections are not deployed yet. Production remains on
  Cloudflare Worker version `9571cfdb-00d8-4afa-a2ff-61074046aff9`, serving
  `assets/index-DTqt8yiP.js`, until a separate deployment is explicitly authorized.

## 2026-07-19: Locked-cell containment and match pacing deployed

Level 7's two design-locked tiles previously differed from normal cells only through a
darker background, which made them look incorrectly rendered. The game now keeps
their tile art at normal readability and identifies each locked cell with an amber
containment frame, reinforced corner clamps, and a high-contrast padlock badge.
The approved renderer and pacing release shipped from app commit `e4590d7` as
Cloudflare Worker version `9571cfdb-00d8-4afa-a2ff-61074046aff9`; production serves
`assets/index-DTqt8yiP.js`.

- The treatment is renderer-only and keyed to the existing `debugDesignLocked` state.
  Match rules, unlock behavior, level JSON, engine determinism, and input are unchanged.
- The frame disappears automatically when the existing clear path unlocks the cell.
- The same treatment applies to every design-locked cell in every level, not only Level 7.
- A test-mode marker inventory verifies Level 7 renders exactly two containment locks at
  row 4, columns 4-5 and is unavailable outside exact test mode.

Verification:

- Red-green browser contract failed with no explicit marker on desktop and mobile, then
  passed after the containment hardware was implemented.
- `npm run test`: 238/238 passed.
- `npm run test:e2e`: 98/98 passed across desktop Chromium and mobile.
- `npm run validate:levels`: 100 passed, 0 failed, 0 warnings.
- `npm run build`: passed with only the existing Phaser bundle-size warning.
- `npm audit --audit-level=high`: zero vulnerabilities.
- Manual Level 7 board captures at 1280x900 and iPhone 15 size show readable orange and
  magenta tile identities, explicit lock silhouettes, no overlap, and no board overflow.
- Russ approved the locked-cell appearance after testing Level 7 locally.
- Public root, SPA deep-link, exact hashed asset, and workers.dev propagation checks
  passed after deployment.
- Live production desktop and mobile checks each rendered exactly two Level 7 lock
  markers, loaded the new bundle, and reported zero runtime errors.

## 2026-07-18: Ordinary match pacing deployed

Russ approved the ordinary match pacing after playing the local build. It changes
presentation timing only; engine outcomes, cascade fall duration, authored power-up
choreography, and the accepted 2,500 ms terminal clear are unchanged. The approved
pacing and locked-cell treatment shipped together in the 2026-07-19 production release.

- Swap travel is 175 ms with a 60 ms settle, up from 160/50 ms.
- The settled-match recognition hold is 140 ms, up from 100 ms.
- Pop compression is 100 ms, impact is 180 ms, and centroid waves can span 150 ms,
  up from 90/170/120 ms.
- Cascade begins 230 ms after ordinary-match impact, up from 200 ms. The total pure
  normal-match timing budget is 1,435 ms, roughly 105 ms longer than the accepted
  production build, with the added time concentrated around match readability.

Verification:

- Red-green timing contract: the focused Vitest case failed on the old 160 ms swap
  travel, then passed after the constant-only implementation.
- Rebuilt desktop/mobile browser contract failed against the old 205 ms
  settle-to-impact ceiling at the expected new 240 ms beat, then passed with the new
  required range.
- `npm run test`: 238/238 passed.
- `npm run test:e2e`: 96/96 passed across desktop Chromium and mobile.
- `npm run validate:levels`: 100 passed, 0 failed, 0 warnings.
- `npm run build`: passed with only the existing Phaser bundle-size warning.
- The required warm-preview drag gate passed 20/20 iterations, covering 40 successful
  desktop/mobile test instances with no input race.
- Manual 1280x720 and 393x852 inspection showed ordered settle, recognition, pop,
  cascade, and refill with no ghost trails, overlap, or horizontal overflow.
- Live production desktop and mobile traces both measured 240 ms from swap settle to
  match impact, 230 ms from impact to cascade, and 1,100 ms from action receipt through
  resolution completion.

## 2026-07-18: Power-up completion and cascade-integrity follow-up deployed

After physical-mobile testing exposed the last winning power-up being skipped, Russ
approved the all-level animation-completion fix for production. The follow-up is now
deployed from app commit `213945e` as Cloudflare Worker version
`41d5c91f-e1fa-4de4-8d36-0ce3823d905d`.

- The bottom-to-top terminal clear is now 2,500 ms: 150 ms lead-in, 300 ms row
  cadence, 250 ms row burst, and 300 ms final hold.
- Single power-up choreography holds the resolved board for another 200 ms before
  cascade, making the power-up result readable before refill begins.
- Winning actions now wait for the exact Phaser resolution-complete callback before
  starting the terminal row clear. A bounded watchdog remains as recovery only. This
  fixes winning rocket combinations skipping directly to `Grid secured` before their
  combo animation finishes.
- Cascade presentation now compares persistent tile IDs in the before/after snapshots.
  Surviving occupants move their real Phaser sprite to the final cell; only genuinely
  new IDs enter through the spawn path. This fixes the Level 6 report where lower-board
  clears appeared to replace stationary tiles with new pieces instead of dropping the
  pieces above them. The planner is level-independent and applies to every board.
- Power-up creation destinations are reserved for the existing hero-reveal animation,
  and intermediate creations that do not survive to the final snapshot are not rendered
  as ordinary refill tiles.

Verification:

- `npm run test`: 238/238 passed.
- Focused Level 6 cascade regression: passed on Chromium and mobile.
- Production-level identity audit: 1,350 deterministic actions across all 100 levels,
  9,097 surviving-tile moves, 8,762 true spawns, and zero missing sprites, identity
  mismatches, existing-as-spawn errors, or non-gravity moves.
- `npm run build`: passed with only the existing Phaser bundle-size warning.
- Full Playwright run: 95/96 passed; the sole mobile terminal-duration measurement was
  2,905 ms against a 2,900 ms wall-clock ceiling. Its immediate isolated rerun passed
  without code or assertion changes, confirming runner jitter rather than a gameplay
  regression. The complete desktop run and all other mobile gameplay, single-power-up,
  combo, cleanup, reduced-motion, and audio-ordering cases passed.
- Manual localhost Level 6 inspection confirmed the lower-board refill with no pop-in
  replacement or missing destination tile.
- Release build passed with only the existing Phaser bundle-size warning, and
  `npm audit --audit-level=high` reported zero vulnerabilities.
- The public root, SPA deep link, and workers.dev fallback serve
  `assets/index-c-pro_nY.js`.
- Live production checks passed on desktop and iPhone 15 emulation. The winning
  rocket-combo trace was `combo-charge` -> `combo-impact` -> `resolution-complete` ->
  `win-sequence-start` in both viewports, and `Grid secured` appeared only after that
  ordering completed.
- Russ completed the final physical-mobile production check successfully. Winning
  power-up choreography, the terminal clear sequence, and cascade behavior are accepted
  on real mobile hardware; this presentation and gameplay-fix cycle is complete.

## 2026-07-18: Production validation complete; game-feel timing retuned

Russ completed the remaining human production gates on physical mobile hardware:

- Account login works on the public site.
- A real signed-in level win submits successfully and the leaderboard updates.
- Mobile touch gameplay, board reachability, and booster interaction are verified.
- Campaign progress remains on the phone/browser where it was earned, as designed by
  the current local save system.

Persistence is intentionally split today. Supabase leaderboard rows are keyed to the
authenticated user and therefore follow that account across devices. Campaign progress,
level stars, coins, boosters, selected agent, intel state, and settings are stored in
IndexedDB with a localStorage fallback and therefore remain device/browser-local. There
is no account save-sync implementation.

The 2026-07-18 feel pass keeps deterministic engine results unchanged while slowing the
presentation layer. After playing Level 13 on production, Russ reported that the first
deployed pass still read too quickly. The follow-up therefore makes a substantial timing
change rather than another incremental adjustment:

- Ordinary resolved matches take roughly 35% longer than the first deployed feel pass.
  Recognition is 100 ms, pop compression is 90 ms, impact is 170 ms, and centroid pop
  waves can spread across 120 ms while the existing swap movement remains unchanged.
- One-cell cascade falls are now 260 ms and the long-fall cap is 540 ms, with 95 ms
  landing squash and settle phases. Power-up-specific choreography retains its own
  authored timing instead of inheriting an unintended extra cascade delay.
- The seven-row level-clear presentation is now 4,650 ms: a 500 ms charge-in, 450 ms
  bottom-to-top row cadence, 700 ms tile bursts, and a 750 ms final hold before the
  result modal. Level 13 measured 4.75 seconds in the scene clock with 2.75 seconds from
  the first destroyed row to the last on both desktop and mobile.
- Each destroyed row now receives a synchronized escalating impact cue. The final row
  adds a stronger impact cue, shake, shockwave, and larger bounded particle burst.
- `BoardScene` now owns the terminal presentation until completion so routine React
  snapshot sync or resize work cannot dispose its row audio and VFX mid-sequence.

Red-green verification is complete: both earlier timing sets failed the new unit timing
contracts and browser row-span assertions. The implementation passes 236/236 Vitest cases,
92/92 Playwright cases across desktop Chromium and the mobile project, all 100 level
validations, the production build, `git diff --check`, and a high-severity dependency
audit with zero vulnerabilities. Manual 1280x720 and 393x852 captures confirm the board
clears progressively without overlap before the result modal. Peak level-clear resources
were 132 desktop particles and 110 mobile particles, two simultaneous board-audio slots,
and all tracked timers, tweens, emitters, particles, and audio returned to zero. Deployment
for the first pass is complete: app commit `c61ed98` was pushed to
`origin/codex/gridwatch-presentation-overhaul` and deployed as Cloudflare Worker version
`53e82193-2bb1-4087-99d6-a1c3b7ac2621`. Public root and SPA deep-link requests serve the
new `index-B08Ht4Yz.js` bundle. Live desktop and mobile animated-clear smoke checks each
reported seven ordered row impacts, seven synchronized row cues, the completion event,
no runtime errors, and zero resources remaining after the modal appeared.
The slower Level 13 follow-up shipped as app commit `ac8e5af` and Cloudflare Worker
version `aa392aa0-11fa-4395-8849-d270396c1ab0`; production serves bundle
`index-Dumx3sC1.js` from both the root and Level 13 SPA deep link. Live Level 13 smoke
checks measured 4.74 seconds on desktop and 4.80 seconds on mobile, with approximately
2.8 seconds between the first and last row, seven synchronized row cues, no runtime
errors, and zero tracked resources remaining at completion.

## 2026-07-17: GridWatch presentation overhaul complete

Tasks 0-18 from `docs/superpowers/plans/2026-07-16-gridwatch-presentation-overhaul.md`
are complete on local branch `codex/gridwatch-presentation-overhaul`. The implementation
commits run from `7fa1c67 Add project skills guide` through
`eab2cfc Enforce light ball combo overlay budget`; `d8ecbe7` is the final Task 18
documentation commit and the application revision deployed on 2026-07-17.

The branch was pushed to `origin/codex/gridwatch-presentation-overhaul`. Production was
deployed with Wrangler as Worker version `f9699373-caf5-4046-a16f-7621ff0b133d` to
`https://gridwatchmatchweb.warsignallabs.net` and the workers.dev fallback. Live checks
passed for the root, SPA deep-link fallback, exact hashed JS/CSS assets, desktop and
iPhone 15 board rendering, unauthenticated score protection, and unknown API routing.

### Delivered presentation system

- Approved art is Candidate B, the bright tactical die-cast hardware set: five tile
  images, five board power-up images, and five booster-tray variants. Web-owned files
  live under `public/assets/images/web-overrides/` and asset sync preserves them.
- The presentation contract and approval record are in
  `docs/art/gridwatch-match-presentation-bible.md`. The audio source and license record
  are in `docs/art/gridwatch-match-audio-provenance.md`.
- Twenty CC0 Tactical Glass board cues live under `public/assets/audio/web-overrides/`.
  Board audio is driven from Phaser scene beats, not from the already-resolved engine
  delta. Normal clears vary pop samples; cascades, creation reveals, all four singles,
  and all ten combos have authored cues.
- Normal clears now read as recognition, compression, centroid-staggered impact, and
  refill landing. Cascades use distance-scaled drops and bounded squash/settle timing.
- Rocket, TNT, propeller, and light-ball creation and single activation have distinct
  causal choreography. All ten unordered power-up combinations have bespoke charge,
  impact, affected-position, and reduced-motion plans.
- Reduced motion removes travel, particles, shake, and full-screen flashes while
  preserving immediate final state and a low-gain impact cue. Central resource budgets,
  deterministic downsampling, and shutdown cleanup bound all transient Phaser objects.
- The final performance correction applies the authored 12-arc cap to dense Light Ball
  combo overlays. A 49-cell Light Ball + Light Ball clear now samples 12 evenly spread
  overlay cells while retaining its board-wide dimmer, charge, impact ring, and clear.

### Final verification

- `npm run test`: 235/235 passed across seven files. This reconciles to the 170-test
  baseline plus 65 presentation tests, including the final dense-overlay regression.
- `npm run test:e2e`: 90/90 passed across Chromium and mobile. This reconciles to the
  36-test baseline plus 54 presentation cases. The known pre-existing
  `tests/e2e/app.spec.ts:22` race did not occur and required no rerun.
- `npm run validate:levels`: 100 passed, 0 failed, 0 warnings.
- `npm run build`: passed. The existing non-blocking Vite warning for the Phaser-heavy
  bundle remaining above 500 kB is unchanged.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `git diff --check`: passed.
- Base audit from `821728bde9d3c05af7500c4884fb0345a2499f65` found no changes to
  `src/engine/**`, `public/levels/**`, Worker, auth, Supabase, score APIs, database,
  leaderboard, wrangler, environment, or validation code. `src/App.tsx` is limited to
  booster artwork and removal of three early delta-timed board SFX calls.
- Task 17's warm-preview drag loop passed 20/20 iterations across both Chromium and
  mobile, for 40/40 successful browser runs with no drag, swap, cascade, or cleanup
  failure.

### Manual presentation and performance matrix

The warm production preview was exercised with SFX and music enabled and real headed
browser audio at desktop 1280x720 and iPhone 15 393x852. The matrix covered idle board
and tray, live valid drag, invalid return, short and long cascades, all four creation
families, all four singles, all ten combos, animated win, and reduced-motion normal/TNT/
Light Ball/Light Ball + Light Ball. Fifty-six diagnostic captures were kept outside the
repo under `/tmp/gridwatch-task18-settled/`; direct canvas captures avoided fixed-header
stitching artifacts.

The matrix passed causal ordering, tile readability, settled refill, power hierarchy,
seven-row reachability, reduced-motion flash limits, and cleanup. No destination pop-in,
ghost trail, hard overshoot, duplicate sprite, board-waiting tail, page overlap, runtime
console error, emitter leak, or audio pile-up was observed. The approved audio pack was
exercised in a real browser; scene traces place cue dispatch on the authored impact beat,
and the asset audit confirms the files are peak-limited to -1.1 dBFS with no clipping.

After the final overlay cap, five fresh headed runs per viewport measured the heaviest
Light Ball + Light Ball combo at desktop p95 9.1-9.8 ms and iPhone-emulation p95
9.6-9.8 ms, with no JS long tasks and all FX resources returning to zero. Peak bounded
resources were 12 emitters, 48 live particles, and at most two active board-audio slots.

Accepted residual risks:

- Software-rendered headless Chromium can report a cold native WebGL task at 97-101 ms;
  the required real headed-browser gate produced no long tasks in ten fresh runs.
- The app requests an unconfigured `favicon.ico`, producing a benign 404 in generic
  browser logging; no Phaser, React, audio, or gameplay console error occurred.
- Physical-device speaker latency was not measured after deployment; the live browser
  audio path and scene-timed cue dispatch were verified before release.

## 2026-07-15: input-freeze bug reported live, root-caused, fixed, deployed

A live-site report ("tiles don't move, no matches can be made") triggered a full
root-cause investigation. **Could not reproduce the freeze on the live site or in a
real browser** — headless Chromium and WebKit e2e runs against production both passed
cleanly, and the full local suite (170 unit + 36 Playwright e2e) was green throughout.
The most likely explanation for what was actually seen: an embedded/backgrounded
browser pane reporting `document.hidden=true` pauses Phaser's tween/animation loop,
which — combined with a real, separate latent bug found during the investigation —
would look exactly like a permanent freeze.

**The latent bug (now fixed):** `BoardScene.ts`'s `handlePointerDown` refuses all new
input while a drag is in flight (`this.drag` non-null), and a **committed** swap only
ever cleared that gate via the engine's own resolve-animation event completing — there
was no fallback. A wedged settle-tween (or a genuinely hidden/paused tab) would leave
`this.drag` set forever, permanently freezing the board with no recovery except a page
reload.

**Fix (3 commits, `45428a3` → `91d6566` → `6f95154` on `main`, one direct follow-up
commit after review):**
- An input-freeze watchdog armed in `commitSwap` via `this.time.delayedCall` (Phaser's
  own clock, **not** `window.setTimeout` — deliberately, so the clock pausing with the
  game loop means a legitimately hidden/backgrounded tab never false-triggers it; only a
  truly wedged handoff with the loop still running does). Constant
  `DRAG_COMMIT_WATCHDOG_MS` lives next to the other timing constants it's derived from.
- Recovery resyncs the scene to the **true, already-advanced engine snapshot**
  (`recoverFromWedgedDrag`) rather than naively snapping back to the stale pre-swap
  board — the engine applies swaps+cascades synchronously in `App.tsx` well before the
  scene's own settle-tween would normally finish, so a naive snap-back would have left
  the visible board lying about the true model for one turn. Falls back to the old
  snap-back only in the (unreachable-under-current-wiring, but harmless) case where the
  resolved animation never reached the scene at all; that fallback branch now also calls
  `finishAnimation()` defensively.
- Fixed a companion e2e race: the "navigates Home to Operations to Level 1" test fired
  the `qa-swap` click before the board finished booting (visible only against a real
  network, not localhost) — now waits for board-ready like its sibling tests.
- Full review loop: implementer → task reviewer found a Critical (the stale-snapshot
  desync above) → fix round → re-review Approved. Two Minor items accepted as
  non-blocking: the fallback branch's now-closed `finishAnimation()` gap, and a
  pre-existing flaky mobile Playwright test (`match pops burst with particles`,
  unrelated code path) — spun off as its own follow-up task.
- All three commits: `npm run build` clean, `npx vitest run` 170/170, `npx playwright
  test` 36/36, verified multiple times across the review loop.
- **Pushed to `origin/main` and deployed to production** (`npm run build && npx wrangler
  deploy`) 2026-07-15 — this also closes the pre-existing live-vs-repo skew (live had
  been running the pre-Dependabot Phaser 4.1.0 bundle; deploys are manual, so bumps
  merged to `main` hadn't gone live yet).

## ⚠ Phase 3 shipped (2026-07-14): Supabase auth + server-mediated leaderboards

GridWatch Match now has an operator identity + real leaderboards, built into the
Command Nexus GridWatch fleet. Design: Command Nexus repo
`docs/superpowers/specs/2026-07-14-command-nexus-architecture-design.md` (D5); plan +
per-task record: `docs/superpowers/plans/2026-07-14-phase3-auth-leaderboards.md`.

- **Auth:** guest-first Supabase (magic link + Google/GitHub + 1–12 char handle) on the
  shared **GridWatchGamesDB** project (`mggxfzzxrpjgpzhwiwqi.supabase.co`) — the SAME
  identity as GridWatch Drift and the Command Nexus hub. UI lives in the Account screen
  (`src/App.tsx` OperatorIdentityPanel); client in `src/hooks/useAuth.ts` +
  `src/services/{supabase,handle}.ts`. Game is fully playable signed-out/offline.
- **Scores are server-mediated (anti-cheat).** The client NEVER submits a score — on a
  level win (`finishWin`, not QA, signed-in) it POSTs raw telemetry + the deterministic
  engine `actionLog` to **`/api/score`** (`src/services/scoreApi.ts`). The **Worker**
  (`worker/index.ts` + pure `worker/validation.ts`) verifies the Supabase user,
  validates plausibility (tight per-move bounds; Play-On runs relaxed + flagged),
  derives the score server-side (`tiles*10+powerups*25+chain*50`, capped 25000/level),
  and writes improve-only best rows via the service-role key. Headline `standard` row =
  **campaign total** (sum of per-level `level-NNN` bests); daily/weekly = best single
  run. `scores` is Worker-write-only (client can't touch it). 170 unit tests.
- **Hosting migrated Pages → Workers + Assets** (`wrangler.jsonc`; SPA fallback). The
  game is served by the same Worker that owns `/api/*`. Deploy: `npm run build &&
  npx wrangler deploy` (Workers Builds git-connection is the intended CI — see below).
- **🚀 LIVE on the production custom domain: https://gridwatchmatchweb.warsignallabs.net**
  (Workers + Assets). Cutover done 2026-07-14: domain detached from Pages project
  `gridwatchmatch`, `routes` block added, Worker deployed. Verified live: game serves
  200, SPA deep routes 200, assets 200, `/api/score` 401 unauth / 405 GET / 404 unknown.
  `SUPABASE_SERVICE_ROLE_KEY` secret is set (confirmed via `wrangler secret list`).
  workers.dev fallback: `gridwatch-match.russell-meadows.workers.dev`. Deploy is manual
  (`npm run build && npx wrangler deploy`).

### Historical Phase 3 Release Checklist

Status correction, 2026-09-08: all three gates below were completed; Russ confirmed
real signed-in score submission and leaderboard updates on 2026-07-18. The original
wording is retained as release history, not an open task or authorization to change
the database. Automatic deployment is deferred.
1. ✅ Worker secret set. 2. ✅ Domain cutover done.
3. **Live score E2E (human-playability gate — the one open item):** signed in on
   gridwatchmatchweb.warsignallabs.net, win a level → the won modal should show
   "SCORE TRANSMITTED — CAMPAIGN TOTAL …" and the hub's Match tab
   (nexus.warsignallabs.net, already live) should show the row. This first real win is
   also what confirms the service-key DB-write path end-to-end (everything up to the
   auth boundary is verified; a real submission is the honest way to confirm the write,
   rather than posting fabricated telemetry).
- Optional: connect the repo to **Workers Builds** to restore git-push-to-deploy (it
  was Pages' git integration before; now deploys are manual). Old `gridwatchmatch`
  Pages project + its `.pages.dev` still exist (harmless) — delete when convenient.

### Known follow-ups (non-blocking)
- Plausibility bounds (tiles ≤15/move, powerups ≤4/move, chain ≤5/move) are conservative
  — re-tune from real playtest telemetry so an exceptional legit run isn't 422-rejected
  (the stored action-log proof is the future replay-verification path).
- `playOnUsed=true` runs can reach the per-level cap via fabricated telemetry but are
  metadata-flagged and self-exclude from the competitive board — accepted per Russ's
  ranking model; a flagged-run filter/exclusion on the board is a future option.
- No App-level unit test for the client telemetry accumulation/gating/reset (verified by
  inspection + live QA); `MAX_PLAY_ONS=20` is an arbitrary backstop.

---
## 2026-09-11: Served Under `/play/match/` (Rollout Step 1, PR 50)

Implementation (merged `57a4f80`, deployed 2026-09-11): Vite base `/play/match/`;
`worker/playPrefix.ts` strips the prefix, 301s legacy GET/HEAD paths and 308s other
methods into it, and re-prefixes ASSETS redirect Locations; `src/services/appUrls.ts`
builds the score API and auth-return URLs from `BASE_URL`; Playwright navigates
relative to the base. Also reachable at `https://nexus.warsignallabs.net/play/match/`
with the Nexus session (the hub proxies the same path).

Automated verification: vitest 355/355, root and worker typecheck clean, `npm run build`
green, Playwright 172/172 on chromium + mobile (local), CI green on PR 50. Live curl
checks after deploy: `/` → 301 `/play/match/`, legacy `POST /api/score` → 308,
`/play/match/` 200 with prefixed assets, first JS asset 200.

Player acceptance: Russ, Mac (Chrome) and iPhone (Safari) — signed in on Nexus,
opened Match at `/play/match/` already signed in; no console CSP reports. Not yet
claimed: a completed level posting a score through `/play/match/api/score` (200), and
the signed-out reload check. Gameplay acceptance for PR 47 remains open as recorded
below; this entry does not claim it.

Deployment: Worker deployed from origin/main on 2026-09-11 (`npx wrangler deploy`).
Old hostname still serves. The old `/api/score` verification recipe below (401/405/404
at the host root) no longer applies at the root: the worker redirects every path outside
`/play/match/` into it — `301` for `GET`/`HEAD`, `308` (method and body preserved) for
`POST` and other methods. Re-run that recipe against `/play/match/api/score` instead,
where the 401/405/404 expectations hold unchanged.


## Pre-Phase-3 status (historical)

GridWatch Match Web was hosted on Cloudflare Pages:

`https://GridWatchMatchWeb.warsignallabs.net`

Cloudflare's Git integration auto-builds on push to `main` (build command
`npm run build`, output directory `dist`, Node pinned via `.nvmrc`).

The repo is clean on `main` after commit `6578026 Use live tile drag for swaps`. CI and CodeQL both completed successfully for that commit.

## Latest Work Completed

- VFX overhaul Tasks 1-9:
  - Tap power-up clears now use the tile-pop path before the board refills.
  - Clear-producing power-up FX now starts immediately after the pop render point, before cascade/refill.
  - Match clears burst with particles; TNT detonates with shockwave/shake; rockets sweep with projectile heads and trails; propeller drones lift, fly, and strike; lightBall fans out zaps; reduced motion skips these tweens.
  - Winning a level now destroys the board row by row from the bottom up before the result modal appears.
- VFX overhaul Task 8:
  - Board renderer now has named board chrome and per-tile identity palettes.
  - Tiles render with subtle per-type backplates plus 1-2 px neon rims on the real occupant containers, so drag/swap/VFX paths carry the same identity coding.
  - `npm run sync:assets` preserves `public/assets/images/web-overrides/` and resolves matching override files into the generated manifest while falling back to synced iOS art.
  - Asset sync now validates image manifest coverage against `imageCopies` and writes text-only source checksum state to `src/data/assetSyncState.generated.json`.
  - `docs/art/cyberpunk-asset-spec.md` defines the realistic cyberpunk art direction, exact override filenames, and generation prompts. No binary override art was added.
- Closed motion-feel gap with the iOS Swift reference:
  - Cascade and spawn now animate the real occupant containers with a two-phase fall+settle curve. The previous ghost-fade-to-zero path is removed.
  - Match pops are staggered by centroid distance so clears read as a wave.
  - Invalid swap snap-back uses a two-phase stretch+settle bounce.
  - Drag lift is tweened in over 80 ms instead of jumping.
  - Swap commit threshold raised from 0.32 to 0.45 of tile size to match iOS weight.
  - Pop angle randomness replaced with a seeded jitter so Playwright snapshots stay reproducible.
- Pure motion helpers extracted to `src/game/motion.ts` with vitest coverage.

## Verification

Last full verification after the motion-parity commits:

- `npm run test`: passed.
- `npm run test:e2e`: passed, 20 tests.
- `npm run validate:levels`: passed, 100 levels.
- `npm run build`: passed.
- `npm audit --audit-level=high`: passed, 0 vulnerabilities.

Task 8 verification on 2026-06-11:

- Failing test first: `npx vitest run src/tests/assets.test.ts` failed before `src/data/assetOverrides.ts` existed.
- `npx vitest run src/tests/assets.test.ts`: passed, 4 tests.
- `npm run sync:assets`: passed from the local iOS source. The run copied source raster files locally, but those out-of-scope binary diffs were discarded before commit.
- `npm run test`: passed, 149 tests.
- `npm run validate:levels`: passed, 100 levels.
- `npm run build`: passed.
- `npm run test:e2e`: passed, 34 tests.
- Manual screenshot check: level 54 on desktop and mobile showed all five base tile types with distinguishable identity colors; zeroDay reads violet-white and separates from cyan packet.

Task 8 CodeRabbit follow-up on 2026-06-12:

- Addressed review feedback by making `shake()` use shared VFX validation helpers, annotating web-only power-up timing groups, documenting the sync-script copy of override helpers with a runtime source assertion, and guarding `rowDestructionOrder()` against non-finite input.
- Follow-up cleanup centralized the board-ready e2e timeout, tightened the CodeRabbit `burst` override match, made `shake()` and required VFX coordinates use direct finite validation, moved override prefixes into `src/data/assetOverrideRules.json`, added defensive override path normalization, fixed VFX burst/shockwave coordinates inside the FX layer, and replaced board-target `page.mouse.click` calls with synchronous PointerEvent dispatch.
- PR-side review follow-up moved clear-producing power-up FX to start after the pop render point, restricted swap-resolution pop keys to actual match/clear positions, added a local ignored checksum manifest that rejects overwritten edited synced images, included FX particle tails in power-up budgets, guarded delayed FX cleanup against scene shutdown, removed dead visual-cell code, and restored the README public play link.
- `npm run sync:assets`: passed, no manifest/checksum drift reported. The command refreshed local copied raster files from iOS; those binary diffs were discarded before commit.
- Manual sync guard check: a perturbed synced tile with a temporary local manifest was rejected with "Refusing to overwrite edited synced asset(s)" before any overwrite.
- `npm run test`: passed, 155 tests.
- `npm run validate:levels`: passed, 100 levels.
- `npm run build`: passed.
- `npm run test:e2e`: passed, 34 tests.

Task 9 verification on 2026-06-12:

- Failing test first: `npx vitest run src/tests/motion.test.ts` failed before `winSequenceDurationMs` existed.
- Failing e2e first: `npx playwright test tests/e2e/app.spec.ts --grep "animated win destroys" --reporter=line` failed because `qa-win-animated` did not exist.
- `npx vitest run src/tests/motion.test.ts`: passed, 34 tests.
- `npx playwright test tests/e2e/app.spec.ts --grep "animated win destroys" --reporter=line`: passed, 2 tests.
- `npm run test`: passed, 157 tests.
- `npm run validate:levels`: passed, 100 levels.
- `npm run build`: passed.
- `npm run test:e2e`: passed, 36 tests.

PR review follow-up on 2026-06-12:

- Addressed queued PR feedback by refreshing the handoff date, replacing the remaining booster-drag `page.mouse` path with synchronous PointerEvent dispatch, relaxing the rocket e2e assertion to require a launch without assuming a doubled count, expanding the resolve animation budget for staggered power-up clear paths, and making manual CodeRabbit gate overrides match the full finding text.
- Local CodeRabbit CLI remained paused per user instruction; PR-side review/checks were used instead.
- `bash -n cli/codex-gate.sh`: passed.
- `git diff --check`: passed.
- `npm run test`: passed, 157 tests.
- `npm run validate:levels`: passed, 100 levels.
- `npm run build`: passed.
- `npm run test:e2e`: passed, 36 tests.

Task 10 final verification on 2026-06-12:

- `npm run test`: passed, 157 tests.
- `npm run validate:levels`: passed, 100 levels.
- `npm run build`: passed.
- `npm run test:e2e`: passed, 36 tests.
- `npm audit --audit-level=high`: passed, 0 vulnerabilities.
- Warm preview server at `http://127.0.0.1:4173/GridWatchMatchWeb/`: required 20-run drag-test loop passed 20/20, covering 40 total chromium+mobile test instances with 0 failures.
- Manual visual feel pass used screenshots saved outside the repo under `/tmp/gridwatch-manual-feel` and confirmed normal-motion desktop frames for match pop particles, TNT shockwave, rocket flight/trails, propeller lift/strike, lightBall multi-zaps, and bottom-up win board destruction with no modal mid-sequence.
- Mobile visual pass confirmed the same effect counters on an iPhone 15 viewport and checked board/effect framing in the scrolling viewport.
- Reduced-motion fast path check loaded `settings.reducedMotion: true`; TNT clear completed in 222 ms with no power-up FX, TNT detonation, or tile-pop animation counters, and animated win reached the result modal in 180 ms.

### Flake-prone tests: 20-run methodology required

`tests/e2e/app.spec.ts` "dragging a board tile into a deterministic match applies a swap" was
empirically flaky on cold loads (chromium project). A single passing run does NOT prove this
test passes. Verify with at least 20 consecutive runs (`chromium` + `mobile` projects each
iteration, no Playwright retries) and require 100% pass rate before treating it as green.

Run the loop against a single warm preview server so the result reflects the test, not
server cold-start variance:

```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort &
until curl -fsS http://127.0.0.1:4173/GridWatchMatchWeb/ >/dev/null; do
  sleep 0.25
done
failures=0
for i in $(seq 1 20); do
  npx playwright test tests/e2e/app.spec.ts \
    --grep "dragging a board tile into a deterministic match" --reporter=line \
    || { echo "Run $i FAILED"; failures=$((failures + 1)); }
done
test "$failures" -eq 0   # non-zero exit if any iteration failed
```

The race had two compounding sources:

1. DOM `pointer*` listeners on the canvas in `BoardScene.installDomPointerHandlers` are
   attached after `create()`, which finishes some time after the React host div first becomes
   visible. The test's old `requestAnimationFrame` × 2 wait was not always long enough.
2. Phaser's `Phaser.Scale.RESIZE` mode can fire a `resize` event mid-gesture on cold load
   (host's layout settling). `BoardScene.create()` installs a resize listener that calls
   `hardClearDrag()`, which kills any in-flight swap. Couple that with stale `scale.width`
   vs. the canvas's actual client width and the test's host-rect-derived tile centers point
   at the wrong column, so any swap that does start is rejected as an invalid match.

Production fix (shipped, test-mode gated via `?gwTestMode=1`):
- `BoardScene` exposes `window.__gwBoardReady: boolean` once DOM pointer handlers are
  installed AND `this.snapshot` is set; cleared on scene SHUTDOWN/DESTROY.
- `BoardScene` exposes `window.__gwBoardCellClientPoint(row, col)` returning the cell's
  center in client coords, computed from the scene's own `scale.width/height` so the
  round-trip through `pointerFromClientPoint` is internally consistent regardless of any
  pending resize.

Test fix:
- `dragBoardCells` waits for both the ready flag and the helper, then dispatches
  `PointerEvent`s (`pointerdown`/`pointermove`/`pointerup`) directly to the canvas inside a
  single `page.evaluate`. The whole gesture completes in one microtask, before any pending
  resize event can fire `hardClearDrag()`. Using the helper for coords avoids host-rect
  guesses. Do NOT switch this helper back to `page.mouse` — the chromium flake will return.

Previously flaky drag-test loop from supervisor verification:

- 20-run loop of the previously-flaky drag test: 20 passed, 0 failed (40 test instances
  across chromium + mobile projects).

## Important Files

- `AGENTS.md`: repo rules and future-agent instructions.
- `MEMORY.md`: durable project memory and user preferences.
- `CHALLENGE_CONTEXT.md`: submission and challenge context.
- `PLAN.md`: original web port implementation plan.
- `src/game/BoardScene.ts`: Phaser board rendering, live drag, swap animation, board VFX, booster targeting.
- `src/App.tsx`: React app flow, HUD, save state, booster tray, store stub.
- `src/data/assetOverrides.ts`: pure web image override path helper used by tests and mirrored by asset sync.
- `docs/art/cyberpunk-asset-spec.md`: text-only replacement art direction and exact override filenames.
- `src/engine/boardEngine.ts`: pure TypeScript board state machine.
- `tests/e2e/app.spec.ts`: Playwright gameplay and layout coverage.

## Open Priorities

- Keep improving animation feel for cascades, power-up effects, and match pops without changing engine determinism.
- Add regression coverage for any future row reachability, viewport overlap, or booster-targeting issue.
- Keep README challenge-ready with a public link, short description, and controls.

## Guardrails For Next Context

- Work only in the web repo unless the user explicitly asks for iOS changes.
- Do not add secrets, `.env` files, private Firebase files, Stripe keys, or generated `dist/`.
- Phase 3 (2026-07-14) added the one sanctioned backend: the `/api/score` Worker for auth-verified score submission. The store remains a playable stub — no store/payment backend.
- Keep `src/engine` renderer-free and deterministic.
- For visible gameplay changes, run Playwright and inspect the browser manually before declaring the fix done.
- When a Playwright test races against Phaser boot or layout settle, do not paper over it with retries, timeouts, or relaxed assertions. The fix must make the race deterministic — usually a readiness flag plus synchronous in-page dispatch — and must be verified with the 20-run loop above.
