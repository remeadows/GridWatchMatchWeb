# GridWatch Match: Causal Playback, Blender Assets, and Balance

Status: proposed implementation plan, not an accepted gameplay release.
Owner: Russ Meadows. Prepared 2026-09-08 against `origin/main` at `328a1a7`.

## Outcome

Make every move explain itself visually: recognize the match, break the right pieces
on impact, fall into the next board, show the next cascade, finish all power-ups,
then show the result. Replace noisy tile surfaces with original, coherent Blender
renders and matching fragments. Establish measured campaign difficulty and test
specific balance candidates locally. Royal Match informs readability and event
hierarchy; all artwork remains original GridWatch work.

Read the accompanying [audit](../../research/2026-09-08-game-feel-audit.md) first.
It contains measured break/effect drift, the flattened-cascade limitation, eight
thousand simulated runs, limitations, and the reconciled historical backlog.

## Scope and Workflow

- Russ explicitly reopened local gameplay acceptance. Earlier approvals apply to
  historical releases only. Tests passing never substitutes for current acceptance.
- Pushes and PRs are authorized. Use reviewable branches from current main; no
  automatic merge or deploy. Keep local playtesting before publication of gameplay
  candidates. A planning PR may be opened immediately after documentation checks.
- Do not edit the sibling iOS repo. Read its current implementation for parity.
- Do not alter Worker, Supabase/auth, score formulas, leaderboard behavior, database,
  telemetry, secrets, payments, or live player saves. Do not add dependencies.
- This plan proposes a narrow expansion beyond July's renderer-only scope: pure
  engine **observation records**, App's presentation lifecycle/clock, and isolated
  local balance experiments. Engine rules, RNG calls, aggregate deltas, score, and
  existing level content stay identical during presentation work.
- Canonical `public/levels/*` changes are deferred until the local candidate diff is
  accepted and score-validation compatibility is established. Do not regenerate
  `worker/level-limits.json` as a side effect of balance exploration.
- Historical plans are context, not instructions to restart their numbered tasks or
  enforce obsolete counts/timings. Use this task order and the current architecture.
- Preserve pre-existing edits. Current original checkout contains a nanoid lockfile
  change and an untracked July plan. Use an isolated worktree; do not stash/discard
  them, include them in a commit, or require their removal to proceed.
- Use `apply_patch` for source edits. Each task has one coherent commit with its
  message below. Record focused verification in the handoff after each completed
  task. Continue between tasks without routine approval questions.
- Behavior changes use red-green tests: run the stated regression first, confirm
  the predicted behavioral failure, implement, rerun focused tests, then the relevant
  broader gate. Do not rewrite a failing assertion to agree with broken behavior.
  Inventory, documentation, and candidate rendering do not need artificial red tests.
- If a new unrelated failure occurs, report it accurately and keep independent work
  moving. Do not invent retries for timing regressions. Prior known flake handling
  applies only to the documented drag-init race, not to new failures.

## Non-Negotiable Playback Contract

1. One real occupant per tile identity. A falling tile retains its identity through
   every stage; new occupants spawn only when that stage actually creates them.
2. A piece does not disappear until its causal impact. The same impact callback
   drives visual contact, piece visibility, local burst, and sound. No two competing
   clocks calculate the same event independently.
3. Overlays losing HP are damage events, not occupant destruction. Locked cells,
   malware, generators, created power-ups, and reshuffles need explicit stage state.
4. Every distinct affected power-up activation is presented once. A deliberate
   combo and a chain reaction are different. Repeated engine records for a consumed
   origin cannot become repeated fictitious mega-combos.
5. Each visible wave settles before the next match recognition. Debris may continue
   outside the occupant layer while later gameplay proceeds.
6. Completion is callback-driven. All winning or losing action animation finishes
   before the result transition. Preserve the current 2,500 ms, bottom-up terminal
   celebration, measured from its own start, not from the winning move.
7. Reduced motion reaches the final state within the existing 180 ms budget, emits
   one compact cue per resolved action, and skips travel/particles/shake/flash.
8. Queue depth remains three. Navigation, scene shutdown, resize, backgrounding, and
   stale callbacks cannot overwrite a newer board or award a result twice.

## Proposed Timing Profiles

These are starting points for local comparison, not numbers to hard-code into tests
as a substitute for observing rendered behavior. Fix causality before changing them.

| Beat | Current | Initial candidate |
|---|---:|---:|
| Swap travel + settle | 175 + 60 ms | retain 175 + 60 ms |
| Initial recognition | 140 ms | retain 140 ms |
| Normal compression | 100 ms | 100 ms, ending at the actual impact |
| Separate match-group stagger | global centroid, max 150 ms | per connected group, 25 ms/cell, max 80 ms |
| Hold after last piece opens before gravity | currently tied to first pop | 90 ms baseline; compare 130 ms locally |
| Fall | 260-540 ms | retain distance curve initially |
| Landing squash + settle | 95 + 95 ms | retain initially; review after full stage playback |
| Subsequent cascade recognition | no independent stage | 100 ms, no skipped stage |
| Rocket lane flight | 360 ms | 420 ms candidate after arrival/break fix |
| Propeller flight | 380 ms | 450 ms candidate after arrival/break fix |
| Light Ball wave spacing | 100 ms | 120 ms candidate with identical target order for hits and pops |
| End celebration | 2,500 ms | retain |

Prefer readable anticipation/open space over a slow dissolving intact sprite. Do not
blindly add every delay in this table. Compare the same action logs with baseline
and candidate; keep only changes the playtest supports. Keep full-sequence watchdog
budgets derived from the actual plan, including creations and cleanup-independent
handoffs. Long chains may last longer than a single move; never truncate them to
hit a global duration cap.

## Task 0: Reproduce and Freeze the Baseline

Files: `HANDOFF.md`, new `src/tests/fixtures/resolution/` JSON fixtures, and
`docs/research/2026-09-08-game-feel/` evidence summaries only.

1. Read AGENTS, SKILLS, MEMORY, HANDOFF, this plan, the audit, `BoardScene.ts`,
   `presentation.ts`, `motion.ts`, `vfx.ts`, `App.tsx`, `GameCanvas.tsx`, and the
   engine types/grid/board/gravity/power-up files before code edits.
2. Record current commit, dirty state, Node/Blender versions, and immutable hashes
   of all engine sources and level JSON. Confirm main did not change the behavior
   described here. Start a fresh branch/worktree if necessary.
3. Run `npm run test`, `npm run validate:levels`, `npm run build`, then the existing
   `npm run test:e2e`. Expected audit baseline is 238 unit and 100 valid levels;
   102 e2e is the last historical full count and must be measured fresh.
4. Ensure port 4173 is serving the build just made before the existing e2e suite
   runs; its config reuses existing servers. Use port 4174 for interactive review.
5. Capture immutable fixtures from the **unmodified** engine: initial level/seed,
   actions, aggregate delta, complete snapshot (row-major cells, IDs, HP, RNG,
   objectives), and actionLog for focused specimens. Cover every combo, damage-only
   clear, generator/lock, repeated coordinate, creation consumed in a later wave,
   and reshuffle. For the larger all-100-level/20-sensitivity-seed corpus, store
   reproducible action logs and hashes of complete canonicalized deltas/snapshots,
   not tens of thousands of full board copies. Keep committed fixtures under 5 MiB.
6. Capture normal match, all four singles, representative combos, and the Level 1
   production-seed `(4,2)->(5,2)` cascade. Record actual visibility, scene `atMs`,
   screenshots/video at desktop and mobile size. Retain captures outside source.

Do not regenerate frozen expected outcomes from a changed engine later.
Commit: `Record gameplay timing and balance baselines`.

## Task 1: Synchronize Single Power-Up Hits and Tile Breaks

Files: `src/game/presentation.ts`, `src/game/BoardScene.ts`,
`src/tests/presentation.test.ts`, `tests/e2e/presentation.spec.ts`.

1. Red: add pure tests for shuffled-order TNT targets, propeller impact/compression,
   rocket near/edge hits, and Light Ball target order. Add browser comparisons of
   each actual `tile-impact`/piece hide to its own effect contact, not two labels
   emitted consecutively from the VFX-only callback. Current code must fail the
   target-to-time or visibility comparison for the reasons in the audit.
2. Introduce a shared per-cell impact record containing position, relative time,
   cause/event identity, and clear-versus-damage disposition. Return position/time
   pairs from TNT planning; never zip sorted times with an unsorted caller array.
3. Make effect advancement dispatch the impact callback once when it reaches a
   cell. That callback hides the correct occupant, emits the local burst, and cues
   audio. Compression ends at impact, including hits earlier than 100 ms; shorten
   preparation for those hits instead of delaying their contact.
4. Light Ball uses exactly the same seeded batches for arcs and tile breaks.
   Propeller uses its actual arrival and secondary-target schedule. Rocket origin
   consumption happens once even though two projectile heads start there.
5. For this task retain the existing final-snapshot cascade handoff; Tasks 2-3
   replace it. Do not claim complete cascade fidelity yet.
6. Green: focused planner/browser tests, unit suite, build, then singles on both
   viewports. At low frame rate require same rendered-frame contact/hide, not an
   impossible fixed wall-clock ceiling. Inspect at least one capture per family.

Commit: `Synchronize power-up impacts with tile breaks`.

## Task 2: Expose Pure Ordered Resolution Steps

Files: `src/engine/types.ts`, `src/engine/boardEngine.ts`, optionally
`src/engine/index.ts`; new `src/tests/resolution.test.ts`.

This is an observation-only engine change. No Phaser/React/DOM/audio/timing imports.

1. Red: require an additive `applyWithResolution(action)` API returning
   `{ delta, steps }`. Existing `apply(action): BoardDelta` remains compatible.
   Assert Level 1's recorded cascade has separate clear/gravity/refill boundaries,
   repeated coordinates can refer to different IDs, and earlier frames cannot be
   mutated by later resolution. The new API is absent today.
2. Use one internal resolution implementation with optional capture; do not run a
   second simulator or consume extra RNG. Capture exact engine boundaries, borrowing
   the existing Swift diagnostic boundary locations but retaining full state needed
   for playback. `apply()` must not allocate the optional full-frame trace.
3. Define `BoardResolutionStep` with ordinal, cascade depth, kind, detached before/
   after snapshots, and that step's clears/moves/spawns/objective changes. Cover
   post-action swap/booster, creation, damage/clear, chained activation, gravity,
   refill, malware propagation, shuffle, and settled boundary. Use the existing
   `afterGravityGrid`; do not change how gravity or spawn draws work.
4. Include occupant IDs and activation metadata in **new** records: activation ID,
   origin occupant ID, initiating action/parent activation, and whether it is a
   deliberate two-piece combo or a secondary hit. Preserve old aggregate
   PowerUpEvent trigger values and order for compatibility.
5. Green: compare both entry points with the frozen corpus. Delta bytes after
   stable serialization, score, RNG, objectives, tile IDs, HP, move count, and action
   log must match. Cover invalid actions too. Run unit suite and all-level corpus.
6. Measure capture overhead and memory on worst observed chains. Capture must not
   alter termination, insert an arbitrary cascade limit, or omit legitimate steps.

Commit: `Expose deterministic resolution steps for playback`.

## Task 3: Play Every Cascade Stage in Order

Files: `src/game/BoardScene.ts`, new `src/game/resolutionPlayback.ts`,
`src/game/motion.ts`, `src/game/GameCanvas.tsx`, `src/App.tsx` (action handoff only),
new `src/tests/resolutionPlayback.test.ts`, browser presentation tests.

1. Red: require a stage runner that preserves step order and IDs. Browser fixture:
   production Level 1 `(4,2)->(5,2)` must show more than one clear/fall stage and the
   distinct intermediate spawned occupants. Add a same-cell/different-ID case and
   a created power-up which falls before a later activation. The flattened renderer
   must fail intermediate-state assertions even though its final state is correct.
2. App uses `applyWithResolution` once per action and passes its steps alongside
   the unchanged delta. Keep authoritative score/save/telemetry calculations intact.
3. Replace before-to-final inference with adjacent-step transitions. Reuse the
   identity-based cascade helper between those snapshots. Animate real containers;
   render only the step's actual spawns. A shuffle is a shuffle, not a gravity fall.
4. Show creation at its true stage/identity, not only when a power-up survives at
   its creation coordinate in the final board. Render HP damage without hiding the
   occupant and preserve locked markers until their recorded unlock.
5. Complete each stage through real callbacks. Decorative debris may finish later.
   Protect the active step from routine React sync and resize replacing its board.
6. Green: focused pure/browser tests, full units/build/e2e. Across all 100 levels,
   compare rendered final tile IDs and positions with the engine and check no old
   occupant is sent down the spawn path. Inspect Levels 1, 6, 7, 13 and a five-color
   level. No destination pop-in, tile ghost, skipped reveal, or hard overshoot.

Commit: `Render cascades from ordered engine steps`.

## Task 4: Preserve Chained Power-Ups and Real Combos

Files: `src/game/resolutionPlayback.ts`, `src/game/presentation.ts`,
`src/game/BoardScene.ts`, corresponding unit/browser tests.

1. Red: cover single -> secondary power-up -> ordinary cascade; deliberate combo
   hitting a third power-up; two distinct activations with different durations;
   and repeated records for an already consumed origin. Current global
   `hasSingleGroup` suppression/first-single completion must fail this contract.
2. Use Task 2 activation metadata. Remove blanket mixed-group suppression. Present
   distinct secondary activations causally, and deduplicate only the same consumed
   activation identity. Retain every actual damage/state transition even if its
   activation visual is coalesced. Do not infer a mega-combo merely from `trigger.kind`.
3. Keep all ten deliberate combination identities. Await every required activation
   in the current step before gravity; independent effects within a step may overlap
   only when their contacts still agree with that step's occupant/damage records.
4. Use Task 1 contact dispatch for combo batches too. Subsample cosmetic arcs to the
   existing cap while retaining every semantic hit and clear.
5. Green: all ten combos through **engine-driven** actions, mixed chains, pure
   contracts, units/build/e2e. Preview-only VFX buttons are supplemental coverage.
   Aggregate engine delta and score remain identical to the baseline fixtures.

Commit: `Play chained power-ups without skipping effects`.

## Task 5: Finish Playback Before Queue and Result Transitions

Files: `src/App.tsx` (queue, displayed HUD, completion and boss-clock paths only),
`src/game/GameCanvas.tsx`, `src/game/BoardScene.ts`, `src/data/gameplayTiming.ts`,
new pure `src/game/playbackLifecycle.ts` and tests, browser tests.

1. Red: winning and failing final power-ups, boss timeout during an active effect,
   rapid queued actions, navigation/background/resize, and stale completion IDs.
   Assert Play On/lose/win UI never covers unfinished action effects. Existing
   immediate-fail and fixed-budget queue paths cannot satisfy all cases.
2. Drain actions on matching resolution completion rather than an estimated sleep.
   Keep maximum depth three and prevent applying an action against an unfinished
   visual board. A recovery watchdog is separate from normal scheduling and derives
   from the pending step plan. It cannot expire just because the scene was paused.
3. Animate visible objective/score progress from step events, capped at authoritative
   final values; never recalculate scoring, awards, logs, or submissions. A no-op
   damage step still updates the appropriate visual state.
4. For bosses, implement the candidate rule: charge **visible controllable play
   time**, pause during forced playback/hidden page/result transition. Use a pure
   monotonic elapsed-time reducer; wall-clock jitter must not count extra seconds.
   This is an explicit proposed balance rule and must be identified in local review,
   not described as unchanged timing parity. Do not change authored boss durations.
5. Preserve the exact winning-action -> settled -> 2,500 ms bottom-up clear ->
   result order. Reduced motion retains the compact path. Pending callbacks and
   timers must be cancelled on teardown; completion/awards run at most once.
6. Green: unit lifecycle tests, full unit/build/e2e suite, two viewport captures.
   Recheck audio/animation after backgrounding without artificial timer retries.

Commit: `Gate game transitions on playback completion`.

## Task 6: Tune Readable Match Pacing Locally

Files: `src/data/presentationTiming.ts`, `src/game/presentation.ts`,
`src/game/BoardScene.ts`, focused tests, presentation bible.

1. Red: independent connected match groups must not share a distant global centroid;
   gravity cannot start before required clears finish; next-stage recognition
   follows landing. Test relationships and observable transitions, not a copy of
   constants. Existing helpers lack group/last-impact boundaries.
2. Implement per-group stagger and timing profiles using the table above as trial
   values. Keep drag travel and the 2.5-second celebration unchanged initially.
3. Replay identical logs through baseline and candidate. Cover single three-match,
   simultaneous groups, long fall, three-stage chain, all singles, combos, and wins.
   Keep preparation, break, empty space, gravity, landing distinct. Do not add long
   opaque pauses or compress later waves out of existence.
4. Green: focused contracts, unit/build/e2e, desktop and mobile local comparison.
   Record chosen times and remaining subjective feedback in the bible/handoff.

Commit: `Tune readable match and cascade pacing`.

## Task 7: Build a Reproducible Blender Art Pipeline

Files: new `tools/art/render_gridwatch.py`, `tools/art/piece_specs.json`,
`tools/art/README.md`, new `docs/art/gridwatch-blender-pipeline.md`.
Candidate PNGs and contact sheets remain outside public assets until selected.

1. Use the installed executable, not `pip install bpy`, a Blender plugin, or a new
   runtime dependency. Validate one headless render before building the full set:

   ```bash
   /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python tools/art/render_gridwatch.py -- --piece packet --output /tmp/gridwatch-art-review
   ```

2. Build original hand-authored mesh forms via bpy from a small explicit spec. Use
   one orthographic camera, broad bevels, consistent upper-left key/fill lighting,
   fixed material roughness, transparent film, RGBA PNG, a recorded color transform,
   and deterministic render seed. Prefer Cycles CPU for reproducible reference
   renders; benchmark the installed renderer before choosing preview acceleration.
3. Render at 1024 then make 512 delivery images. Inspect 32, 40, 48, and 64 px versions
   on the real board. Keep a shared subject-size/pivot envelope and 8-12% alpha
   padding. Avoid full-white clipped rims, unreadable micro-circuitry, heavy bloom,
   baked cell frames, shadows competing with Phaser's shadow, and text on objects.
4. Produce two concrete material/lighting variants of Packet, Firewall, Key, and
   TNT: cleaner enamel/die-cast and restrained machined metal. Keep existing hue/
   silhouette identities; the distinction should be finish/readability, not a
   brand redesign. Show small-size contact sheets and one board mock-up locally.
5. Require nonblank alpha, correct bounds, known camera/pivot, and no missing
   textures. Record Blender version, script/spec hashes, samples, seed, transform,
   render command, licenses/provenance, and output inventory. Same pinned CPU setup
   must reproduce output; different device render noise needs a documented tolerance.
6. Record Russ's visual selection when available. Continue independent timing,
   balance, and pipeline work while it is pending. Do not ask for approval of
   individual implementation steps or pretend the selected art is already accepted.

Commit: `Add reproducible Blender piece rendering pipeline`.

Blender CLI reference: [5.1 command-line arguments](https://docs.blender.org/manual/de/5.1/advanced/command_line/arguments.html).

## Task 8: Integrate the Selected Piece Family

Files: `tools/art/*`, existing fifteen files under
`public/assets/images/web-overrides/{tiles,powerups,boosters}/`, asset tests,
`BoardScene.ts` sizing if required, presentation bible and provenance.

1. Use the selected material/camera recipe for all five tiles, five power-up images
   (including H/V rockets), and five tray variants. Preserve manifest keys/paths.
   Tile identities: cyan chevron, orange shield, green-gold clipped card, crimson
   triangle, asymmetric violet-white split crystal. TNT is an armored charge.
2. Add asset-contract validation before replacing files: alpha bounds, dimensions,
   pivot/subject scale, missing assets, and override preservation. Missing output
   should fail specifically; don't assert subjective beauty by file existence.
3. Integrate and inspect real idle, drag, falling, locked, overlaid, and powered-up
   boards. Avoid scaling raw texture units to `1.15` after `setDisplaySize`; effects
   must multiply the current display scale. Review TNT/creation tweens for this.
4. Validate grayscale and color-vision simulation at mobile sizes. Preserve explicit
   lock hardware and distinguish shield/card without relying on red versus orange.
5. Green: asset tests, units/build/e2e, actual board and booster-tray captures. Run
   asset-sync preservation in a disposable worktree against the read-only iOS source
   and check hashes; do not refresh unrelated fallback assets in the working branch.

Commit: `Replace board pieces with coherent Blender renders`.

## Task 9: Give Tile Breaks Matching Physical Fragments

Files: `tools/art/*`, new fragment atlas under
`public/assets/images/web-overrides/fx/`, `src/data/presentationAssets.ts`,
`src/game/vfx.ts`, `src/game/BoardScene.ts`, relevant asset/VFX/browser tests.

1. Red: semantic piece removal must happen once even when cosmetic debris is
   dropped by the resource budget; reduced motion emits no fragments; teardown
   releases fragment sprites/timers. Verify fragments use their piece family.
2. Render four to six recognizable fragments per base tile from the same Blender
   materials. Prefer small reusable images in one atlas over full explosion videos
   or hundreds of frames. Build atlas/metadata with a deterministic local script;
   explicit pivots and transparent edge padding prevent texture bleed.
3. At the shared impact callback: brief core, crisp piece break, 3-5 weighted
   fragments, restrained sparks, then open space. Use seeded variation and gravity
   arcs. Only major impacts get substantial shake, smoke, or board dimming.
4. Starting budget: one atlas at most 2048x1024 RGBA (8 MiB decoded), and at most
   24 MiB decoded for the fifteen 512 sprites plus the fragment atlas. Measure
   actual loaded textures including fallbacks. The existing mobile 110/desktop 180
   particle caps, 12 emitters and 12 simultaneous arcs remain ceilings.
5. Green: focused tests, units/build/e2e, dense chain and all ten combos on desktop/
   mobile. Preserve every clear when decorative effects are culled; no debris
   causes a fall to wait or resembles a second intact tile.

Commit: `Add material-matched tile fracture effects`.

## Task 10: Align Audio and Preserve Effect Hierarchy

Files: `src/services/audio.ts`, `src/game/BoardScene.ts`, presentation planner,
audio/VFX tests; audio overrides/provenance only for specifically replaced cues.

1. Red: match contact dispatch emits a bounded group body plus appropriate pop
   variations; each stage gets its own chain cue at landing/recognition; final
   power-up audio completes before the terminal sequence; reduced motion stays
   one compact cue. Test audio using the existing fake backend.
2. Use the common impact callback as the trigger. Coalesce landings and group
   impacts; don't play a full blast per tile or restart music on each stage. Keep
   independent SFX/music/voice controls and user-gesture unlock behavior.
3. Listen in a headed browser and on a physical phone. Compare muted visual playback
   with sound-on playback to distinguish scheduling from device output latency.
   Revise only weak cues; Blender is the asset-render tool, not an audio engine.
   Record provenance for original recordings/synthesis and retain existing licenses.
4. Green: audio/unit/browser tests, no clipping, bounded active sources, proper
   cleanup. Peak-limit new cues to the existing pack's headroom and trim leading
   silence. Record actual listening acceptance separately from scene traces.

Commit: `Align board audio with staged impacts`.

## Task 11: Turn Balance Screening Into a Regression Tool

Files: new `scripts/analyze-balance.mjs`, `src/tests/balance.test.ts`,
`docs/balance/baseline.json`, `docs/balance/README.md`. Reuse current engine APIs.

1. Red: a small fixture corpus checks deterministic policy decisions, proper terminal
   stop, no booster/Play On contamination, duplicate objective IDs, and separation
   between engine RNG and policy RNG. Test output determinism/metrics, not one
   arbitrary desired win rate.
2. Formalize the audit script with production-seed and sensitivity cohorts, sample
   size/seed list/source hashes, per-level error/rejection counts, confidence
   intervals, move usage, remaining objectives, power-up creations/activations,
   reshuffles, initial legal choices, and estimated presentation time per run.
3. Add a visible objective-aware policy for blockers/targets and a labeled diagnostic
   lookahead policy if useful. Report foresight bias; never present bots as people.
   Start 100 seeds/policy for the baseline and 500 on candidate outliers. Bound runs
   by terminal state/move budget and fail on exceptions rather than treating them
   as ordinary losses. No server requests or telemetry.
4. Evaluate ten boss levels separately: raw move outcome, modeled thinking time
   sensitivity, and measured controllable-time policy from Task 5. Include animation
   time as a separate metric; don't deduct it twice or ignore it silently.
5. Flag rather than automatically rebalance: post-tutorial random win rate >=95%,
   median unused moves >40%, large neighboring-level jumps, impossible objectives,
   and overused mechanics. Include fixed retry seeds as an explicit design choice.
6. Green: unit tests, deterministic repeated report, all 100 levels. Canonical
   level hashes and all backend files must remain unchanged.

Commit: `Add deterministic campaign balance analysis`.

## Task 12: Prepare Isolated Local Balance Candidates

Files: `docs/balance/candidates/*.json`, candidate-analysis report; new development
preview adapter/tests, with narrow `src/App.tsx`, `src/data/levels.ts`, and
`src/state/save.ts` wiring only if needed for isolated local playtesting.

1. Prepare hand-authored candidate diffs for a small pilot: Levels 19, 35, 49, 50,
   51, 60, 61, and 70. Keep Levels 1-3 as tutorial controls and retain representative
   untuned levels as controls. Use Task 11 measurements to choose exact values.
   Try move-budget adjustments first, one parameter per iteration. Do not apply a
   global percentage cut, change scoring, remove mechanics, or generate new boards.
2. Record each hypothesis, old/new values, production-seed outcomes, sensitivity
   intervals, expected session length, and manual goal. A five-color transition
   should introduce challenge without the large unused-move discontinuity.
3. Red: candidate preview requires development mode, exact `gwTestMode=1`, and an
   explicitly named profile. It cannot persist to the normal save keys or submit a
   score, even with a session present. Missing/unknown profiles fail closed to the
   canonical level. Normal mode and production builds ignore candidate requests.
4. Implement the smallest development-only adapter; use in-memory candidate saves
   and immutable clones of authored data. Preserve normal storage behavior. Verify
   blocked `/api/score` requests and unchanged IndexedDB/localStorage in e2e. Do not
   install a second game framework or expose an in-production balance menu.
5. Run local human sessions on the pilots with current/candidate profiles and record
   first-attempt success, moves unused, frustration points, and perceived fairness.
   Calibrate the intended difficulty curve from these results. Bot statistics alone
   cannot set final player targets.
6. Green: adapter tests, units/build/e2e, candidate report; canonical level and
   Worker hashes unchanged. Obtain acceptance of the concrete content diff before
   proposing its separate production migration. If it needs new validator limits,
   stop that release scope and explain the exact backend dependency; don't change
   the backend under this plan.

Commit: `Add isolated local balance candidates`.

## Task 13: Final Regression, Player Acceptance, and PRs

Files: tests as needed, HANDOFF, MEMORY, presentation bible, balance report.

1. Run `npm run test`, `npm run validate:levels`, `npm run build`,
   `npm run test:e2e`, `npm audit --audit-level=high`, and `git diff --check`.
   Reconcile counts from the fresh Task 0 baseline. Keep unrelated dependency PRs
   separate; report any dependency gate failures against the actual branch.
2. Run the documented 20-run warm-preview drag gate after input/queue changes.
   Zero failures required. Use real scene-ready coordinates and synchronous test
   gestures; don't add retries to hide lifecycle faults.
3. Full playback matrix: all singles and ten combos; mixed chains; three-stage
   cascade; creation moved/destroyed later; damage-only overlays; locks; generators;
   reshuffle; queue depth three; last-move win/fail; boss expiry; reduced motion;
   resize/background/restart/shutdown. Exercise real engine actions and final IDs.
4. Inspect 1280x720 desktop, 393x852 mobile, and a narrow 320px viewport. Test physical
   iPhone Safari plus an Android device when available. Record unavailable hardware
   honestly. All rows/tray remain reachable; texture edges and text remain readable.
5. Headed performance gate after warmup: measure p50/p95 frames, long tasks,
   GPU/texture inventory, and peak objects. Target p95 <=20 ms on the recorded test
   hardware, no presentation-attributable >50 ms JS task, and no leaked transient
   resources after cleanup. Report hardware and baseline; headless software-renderer
   timing is not physical-mobile proof.
6. Russ reviews one concrete local candidate: ordinary match, long cascade, all
   power-up families, a winning combination, 2.5-second ending, and pilot difficulty.
   Keep separate statuses for implementation, automation, local player acceptance,
   physical-device acceptance, PR review, and deployment. Never write "complete"
   across all statuses because only one is green.
7. Use separate PR boundaries for timing/lifecycle, approved art/audio, and balance
   tooling/candidates. Frozen behavior corpus must match for presentation-only PRs.
   Include actual captures and known limitations. Push and open PRs under Russ's
   authorization; do not merge/deploy until the corresponding acceptance is explicit.

Commit: `Record gameplay acceptance and release evidence`.

## Remaining Decisions and Deferred Work

No input is required to start Tasks 0-7 and the balance tool after this plan is
selected for execution. Art selection is based on delivered contact sheets, and
final acceptance is based on the working candidate. Continue independent work
while either is pending.

The boss controllable-time rule and actual difficulty targets are proposals to
evaluate locally. Canonical content changes, new spread/guide objectives, more
levels, account progress sync, store fulfillment, automatic deployment, broad
dependency upgrades, and backend plausibility changes are separate work.

## Handoff Format

After each task record: commit, changed behavior, tests actually run, evidence path,
known failures, and next task. At final review report:

```text
Implementation: [tasks completed / remaining]
Tile-break causality: [measured result]
Cascade stages and chains: [coverage and remaining gaps]
Assets: [selected Blender recipe and actual-size acceptance]
Balance: [bot cohorts, human pilot results, content still canonical/candidate]
Local and physical-device acceptance: [explicit statuses]
Verification: [fresh counts and performance evidence]
GitHub: [branches / PRs]
Deployment: [not deployed / separately authorized release]
Next action: [one concrete next step]
```
