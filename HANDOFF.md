# GridWatch Match Web Handoff

Last updated: 2026-07-17

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

### Remaining to finish Phase 3
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

- Playtest the public URL on real mobile touch hardware after the live-drag deploy cache has settled.
- Continue tuning swap/match timing if the player still perceives the settle/pause/pop sequence as too fast.
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
