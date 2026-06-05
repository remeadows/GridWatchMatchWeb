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
