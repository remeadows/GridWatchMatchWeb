# GridWatch Match Web Handoff

Last updated: 2026-06-04

## Current Status

GridWatch Match Web is live on GitHub Pages:

`https://remeadows.github.io/GridWatchMatchWeb/`

The repo is clean on `main` after commit `6578026 Use live tile drag for swaps`. GitHub Pages and CodeQL both completed successfully for that commit.

## Latest Work Completed

- Applied the suggested drag/swap feel fix from `/Users/russmeadows/Downloads/fix-drag-swap-feel.patch`.
- Replaced the player-drag ghost preview path with a live occupant drag path in `src/game/BoardScene.ts`.
- The real dragged tile now follows the pointer directly.
- The neighboring tile mirrors the drag offset.
- Valid swaps settle before match resolution starts.
- Invalid swaps snap the real sprites back.
- Programmatic/QA swaps still use a fallback ghost tween.
- Added Playwright coverage for dragging a deterministic level 1 tile into a match.
- Confirmed booster behavior: clicking a booster selects it but does not consume or fire it until a board target is chosen; dragging a booster onto the board activates at the drop point.

## Verification

Last full verification after commit `6578026`:

- `npm run test`: passed, 115 tests.
- `npm run test:e2e`: passed, 20 tests.
- `npm run validate:levels`: passed, 100 levels.
- `npm run build`: passed.
- `npm audit --audit-level=high`: passed, 0 vulnerabilities.
- GitHub Pages deploy: success.
- CodeQL: success.
- Public URL returned HTTP 200.

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
