# GridWatch Match Web Handoff

Last updated: 2026-06-12

## Current Status

GridWatch Match Web is hosted on Cloudflare Pages:

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
- Do not introduce a backend for store or telemetry; the store remains a playable stub.
- Keep `src/engine` renderer-free and deterministic.
- For visible gameplay changes, run Playwright and inspect the browser manually before declaring the fix done.
- When a Playwright test races against Phaser boot or layout settle, do not paper over it with retries, timeouts, or relaxed assertions. The fix must make the race deterministic — usually a readiness flag plus synchronous in-page dispatch — and must be verified with the 20-run loop above.
