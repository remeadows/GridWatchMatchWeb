# GridWatch Match Web Handoff

Last updated: 2026-06-04

## Current Status

GridWatch Match Web is live on GitHub Pages:

`https://remeadows.github.io/GridWatchMatchWeb/`

The repo is clean on `main` after commit `6578026 Use live tile drag for swaps`. GitHub Pages and CodeQL both completed successfully for that commit.

## Latest Work Completed

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

### Flake-prone tests: 20-run methodology required

`tests/e2e/app.spec.ts` "dragging a board tile into a deterministic match applies a swap" was
empirically flaky on cold loads (chromium project). A single passing run does NOT prove this
test passes. Verify with at least 20 consecutive runs (`chromium` + `mobile` projects each
iteration, no Playwright retries) and require 100% pass rate before treating it as green.

Run the loop against a single warm preview server so the result reflects the test, not
server cold-start variance:

```
npm run build
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort &
# wait until http://127.0.0.1:4173 returns 200
for i in $(seq 1 20); do
  npx playwright test tests/e2e/app.spec.ts \
    --grep "dragging a board tile into a deterministic match" --reporter=line \
    || echo "Run $i FAILED"
done
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

Production fix (shipped, behind no flag):
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
