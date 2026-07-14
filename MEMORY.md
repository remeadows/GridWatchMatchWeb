# GridWatch Match Web Memory

Last updated: 2026-06-04

## Durable Context

- This repo is the web port only: `/Users/russmeadows/Dev/1 - WarSignalLabs/4 - Games/GridWatchMatchWeb`.
- Do not modify the iOS source repo while working on the web game. The iOS repo is authoritative for parity and assets, but web work stays in this repo.
- Public GitHub repo: `https://github.com/remeadows/GridWatchMatchWeb`.
- Public playable URL: `https://GridWatchMatchWeb.warsignallabs.net`.
- The project is for the Community Dev Challenge "Make a game we can play"; the core requirement is a public, immediately playable game link.
- Hosted on Cloudflare Workers + static Assets. The ONLY backend surface is `worker/index.ts` (`/api/score`): Supabase-auth-verified score submission. The one secret (`SUPABASE_SERVICE_ROLE_KEY`) lives in wrangler secrets / gitignored `.dev.vars`, never committed. No real-money fulfillment.

## Product Priorities

- Gameplay feel matters more than cosmetic polish right now.
- The board must be responsive on mouse, touch, desktop, and mobile.
- All seven rows must be playable; prior bugs affected rows 5-7 due to board interaction/layout issues.
- Tile drag should feel direct: click/press, hold, and move should move the real tile under the pointer.
- Valid swaps should settle into their new grid positions, pause briefly, then pop matched tiles.
- The moved matching tile must not start returning to its original cell before disappearing.
- Booster tray power-ups must not randomly detonate. They require a deliberate target by click-select plus board tap/click or by dragging onto the board.

## Current Implementation Notes

- React owns menus, HUD, modals, persistence controls, account, intel, rules, tutorial, and store stub.
- Phaser owns the board canvas, input, tweens, particles, and board VFX.
- `src/engine` is pure TypeScript and must not import React, Phaser, DOM, audio, analytics, or storage.
- `src/game/BoardScene.ts` contains the live tile drag implementation.
- `src/App.tsx` contains booster selection/drag UI and passes targeted booster actions to the scene.
- `tests/e2e/app.spec.ts` covers deterministic swap flow, live drag into a match, booster targeting, booster drag placement, persistence, and viewport overlap checks.

## Latest Known Good State

- Commit: `6578026 Use live tile drag for swaps`.
- Deploy passed for that commit.
- CodeQL passed for that commit.
- Verification after that commit:
  - `npm run test` passed: 115 tests.
  - `npm run test:e2e` passed: 20 tests.
  - `npm run validate:levels` passed: 100 levels.
  - `npm run build` passed.
  - `npm audit --audit-level=high` passed: 0 vulnerabilities.

## User Preferences

- Be pragmatic and direct.
- Do not change the iOS game source when fixing the web game.
- Treat gameplay polish as critical; code the game as if the public challenge result depends on it.
- Keep secrets out of git.
- Push to GitHub when preparing public web-hosted changes unless the user says not to.
