# GridWatch Match: Gameplay, Asset, and Balance Audit

Date: 2026-09-08. Status: gameplay acceptance reopened by Russ.

## Scope and Evidence

The local application is `2dbea72`; current `origin/main` is `328a1a7`.
Their `src/`, `public/`, scripts, and project guidance have no diff. Main's newer
changes are dependency updates and the presentation merge. The original checkout
has an existing nanoid lockfile change and an untracked July presentation plan;
neither was changed by this audit. Planning uses a separate worktree from main.

Read the web AGENTS, SKILLS, MEMORY, HANDOFF, original port plan, historical plan
task maps and relevant sections, presentation bible, engine resolution/gravity/
match/power-up code, renderer resolution/effect paths, tests, and app lifecycle.
There is no web CLAUDE.md. The sibling iOS CLAUDE.md and resolution code were read
as references only. Its debug phase checksums are not a ready-made animation stream.

Fresh checks on the local application:

- Unit suite: 238/238 passed.
- Level validator: 100 passed, zero errors/warnings.
- Production build: passed; existing large-Phaser-chunk warning remains.
- Playwright audit: ten real action flows reached completion, normal move and four
  boosters at desktop 1280x900 and mobile-sized 393x852; no page exceptions or
  horizontal overflow. Browser plugin unavailable; installed Playwright used.
- This was headless Chromium, not physical iOS or an audio listening test. Existing
  full e2e suite was not rerun this turn; the historical 102-pass result remains
  historical. Passing tests are not player approval.
- Blender CLI: `/Applications/Blender.app/Contents/MacOS/Blender`, version 5.1.0,
  build `adfe2921d5f3`. It is not on PATH. Version check passed with a USD
  cache-line warning. A full asset render has not yet been validated.

Original September 8 captures and raw traces: `/tmp/gridwatch-feel-audit-20260908/`.
Original full simulation outputs: `/tmp/gridwatch-balance-audit.json` and
`/tmp/gridwatch-balance-production.json`. Reproduction script and compact results
are retained beside this report under `2026-09-08-game-feel/`.

Those fixed paths are historical evidence, not the output paths of new runs.
After the September 9 security repair, balance reproduction prints
`Report: <path>` for `sensitivity.json` or `production.json` in a private randomized
`gridwatch-balance-*` directory. Browser reproduction prints
`Capture directory: <path>` for its PNGs and `traces.json` in a private randomized
`gridwatch-feel-audit-*` directory. Both directories are created inside the operating
system's temporary directory. See the adjacent reproduction README for commands.

## Confirmed Presentation Defects

### 1. Effect arrival and actual tile break use different schedules

`BoardScene.playTilePops` records `tile-impact` in the same callback that hides the
piece. `powerUpPopStagger` independently predicts a delay, then the pop adds its
compression tween. Power-up VFX have separate timers and tween callbacks.

Observed differences below are **tile break minus effect arrival**, using scene
`atMs`, not the synthetic `plannedAtMs` accumulator:

| Effect | Desktop | Mobile-sized Chromium |
|---|---|---|
| Rocket, non-origin lane cells | +217 to +285 ms | +233 to +270 ms |
| Propeller, primary target | +269 ms | +368 ms |
| Light Ball, matching target cells | -520 to +318 ms | -573 to +238 ms |
| TNT | -89 to +207 ms | -83 to +191 ms |

These are individual headless audit runs, not performance percentiles or a physical
device guarantee. The source independently confirms competing schedules. The
observable discrepancy is much larger than one render frame.

`tntDetonationPlan` sorts positions by Manhattan distance and returns only times;
`playTntPowerUpEffect` indexes those times with the original position order. Timing
is assigned to the wrong cells. Its pop path also uses a different radial metric.
Light Ball VFX batches targets by seeded order, while pops use radial delays.
Propeller pops append compression after the intended arrival time.

Existing rocket tests compare `rocket-pass` with `rocket-tile-impact`, both emitted
consecutively in the same callback. They do not compare either with `tile-impact`
or piece visibility. Normal timing tests mainly constrain accumulated planned
values. Add observable sprite-state assertions; do not loosen these tests to mask
the discrepancy.

### 2. Intermediate cascades are lost

`BoardEngine.resolveBoard` concatenates clears, moves, spawns, and power-up events
for every resolution wave into one `BoardDelta`. It returns only a final snapshot.
The renderer compares the first and final tile IDs, pops the missing initial
occupants, and falls survivors directly to their final cells once.

This protects final tile identity but cannot show intermediate falls, tiles spawned
and cleared in the same move, or power-ups created and consumed before the final
snapshot. More milliseconds on that flattened animation cannot restore the missing
causal sequence. `GravityResult.afterGravityGrid` already exists but is discarded by
the web engine's caller. Accurate playback needs observation-only phase records.

A reproducible production-seed example: Level 1, swap zero-based `(4,2)` to `(5,2)`.
The engine produces chainDepth 2, 15 clears, and two repeated clear positions in one
action. A coordinate-only clear set cannot represent those distinct occupants.

### 3. Mixed power-up sequences are suppressed

`playPowerUpEffects` and `powerUpPopStagger` skip combo groups when a single group
exists in the same aggregate delta (`hasSingleGroup`). `finishSingle` advances on
the first completion rather than waiting for every relevant activation.

The engine uses `trigger.kind = "combo"` for both deliberate two-piece combinations
and secondary activations. An activated origin can also appear again as a chain
record. The current Swift reference has the same pattern. Therefore **do not simply
remove the skip and play every record as a mega combo**, and do not silently change
power-up/score semantics. Capture causal activation identity at resolution time;
distinguish a consumed origin, an actual chained piece, and a deliberate combo.

### 4. Presentation duration affects lifecycle and timed difficulty

`App.drainQueue` uses a fixed resolve-budget timeout. Winning actions have an exact
completion callback but still use a fixed wall-clock fallback. Non-winning failures
set Play On immediately. Boss `setInterval` ticks whenever status is running,
including time spent waiting on the board animation. All of these need review when
real multi-stage playback lengthens a move. HUD score/objectives currently jump to
the final outcome before its visuals finish.

## Asset Assessment

Current web overrides are fifteen 512x512 RGBA PNGs with distinct silhouettes.
The mobile canvas capture shows bright, noisy edge highlights and small metallic
details that compete with the overall shape. Enlarging those files alone will not
improve readability. Keep the GridWatch identities and lock markers, but rebuild
broad forms, consistent bevels/light direction, and clean alpha at actual 32-48 px
piece size. Use Blender offline to render original objects and matching fragments;
Phaser remains the runtime renderer. No 3D runtime migration is needed.

The existing presentation bible's 160/50 ms swap and 55/45 ms recognition/compression
numbers are stale relative to 175/60 and 140/100 in current code. Candidate B is a
historical approval, not acceptance of this next iteration.

## Balance Method

Two cohorts, each 100 levels x 20 chooser seeds x two policies = 4,000 runs:

1. Sensitivity cohort: engine seeds 1 through 20.
2. Production cohort: `levelSeed(level.id)` exactly as App uses; chooser seeds 1-20
   vary decisions. Retries currently reuse the same engine seed.

Both policies choose only `engine.validMoves()`; no tray boosters, Play On, future
refill inspection, mutated engine, or score-service calls. The random policy samples
legal actions uniformly, not random screen taps. The visible-match policy evaluates
only the current post-swap match geometry: needed-color clears weigh 3, other clears
1, groups of 4+ gain 6; a single power-up is valued 9 and a two-piece combo 24.
Ties use a separate seeded chooser RNG. It is a simple heuristic, not a human model
or optimal solver. Boss clocks and thinking time are excluded.

Runs stop at win/fail or the authored move limit. Initialization/application errors
are recorded. An ordered action log for a cascade and mixed-trigger example is
retained. A repeated coordinate is evidence of missing temporal information, not by
itself an engine error. Twenty choices per level are a screening sample, not a
precise per-level success estimate.

## Balance Results

Across both cohorts: 8,000 runs, 113,583 legal actions, zero engine errors.

| Levels | Production random wins / 200 | Production heuristic wins / 200 | Median heuristic moves | Median moves unused |
|---|---:|---:|---:|---:|
| 1-10 | 200 | 200 | 7 | 19 |
| 11-20 | 198 | 200 | 9 | 15 |
| 21-30 | 199 | 200 | 8 | 16 |
| 31-40 | 187 | 198 | 10 | 13 |
| 41-50 | 194 | 199 | 10 | 14 |
| 51-60 | 200 | 200 | 14 | 29 |
| 61-70 | 200 | 200 | 13 | 30 |
| 71-80 | 199 | 200 | 14 | 29 |
| 81-90 | 198 | 200 | 13 | 29 |
| 91-100 | 198 | 200 | 13 | 27 |

Production totals: random 1,973/2,000 (98.65%), heuristic 1,997/2,000 (99.85%).
Sensitivity totals: random 1,966/2,000 (98.3%), heuristic 2,000/2,000 (100%).

The production cohort contains 28,214 actions with chainDepth > 0, 21,937 actions
with repeated clear coordinates, and 13,045 actions mixing single and combo-tagged
events. Those mixed records include same-origin follow-ups, not necessarily 13,045
distinct player-created combinations.

Interpretation: the move-budget challenge is weak under both legal-action policies,
especially after Level 50. Level 50 has 27 moves, Level 51 has 44, and Level 61 has
48; a fifth tile type is introduced at Level 50, but this screen suggests the extra
moves overcompensate. This is a balance hypothesis for local pilots, not permission
to cut all move limits or a claim that humans win 99% of games.

Content coverage: 77 levels have encrypted overlays, 80 have malware underlays, 17
have honeypots, 68 have design locks, and ten are timed bosses. Shipped objectives
use only collect variants and clear. Spread, guide, and multi are engine capabilities
not currently exercised by authored objectives. Their introduction would be new
content, not a defect repair.

## Reconciled Backlog

| Work | Current assessment |
|---|---|
| Original web port, June motion/VFX work | Implemented; old unchecked boxes are historical, not fresh tasks |
| July presentation Tasks 0-18 | Implemented according to commits/handoff; quality acceptance reopened |
| Login, real score submission, leaderboard integration | Previously verified by Russ; do not reopen or modify backend |
| Current feel, assets, complete causal playback | Open, release-critical |
| Formal balance baseline and local candidate levels | Open; screening evidence now exists |
| Physical-device listening/updated gameplay acceptance | Open for the new iteration |
| Seven dependency PRs | Separate maintenance: #26, #28, #30, #41, #42, #43, #44 as of this audit |
| Auto-deploy, account save sync, store fulfillment, extra objectives/levels | Deferred; not part of this plan |

GitHub push and PR creation are authorized by Russ on 2026-09-08. This does not
authorize merging unaccepted gameplay or deploying it. The historical deployment
record was not revalidated live during this audit.
