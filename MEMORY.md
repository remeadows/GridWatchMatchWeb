# GridWatch Match Web Memory

Last updated: 2026-09-08

## Durable Context

- This repo is the web port only: `/Users/russmeadows/Dev/1 - WarSignalLabs/4 - Games/GridWatchMatchWeb`.
- Do not modify the iOS source repo while working on the web game. The iOS repo is authoritative for parity and assets, but web work stays in this repo.
- Public GitHub repo: `https://github.com/remeadows/GridWatchMatchWeb`.
- Public playable URL: `https://nexus.warsignallabs.net/play/match/` (Nexus proxy; the only host since 2026-09-23). Worker origin: `https://gridwatch-match.russell-meadows.workers.dev`, which also serves the game directly at `/play/match/` but is not the URL to give players. The old hostname `GridWatchMatchWeb.warsignallabs.net` 301s to Nexus via a zone redirect rule.
- The project is for the Community Dev Challenge "Make a game we can play"; the core requirement is a public, immediately playable game link.
- Hosted on Cloudflare Workers + static Assets. The ONLY backend surface is `worker/index.ts` (`/api/score`): Supabase-auth-verified score submission. The one secret (`SUPABASE_SERVICE_ROLE_KEY`) lives in wrangler secrets / gitignored `.dev.vars`, never committed. No real-money fulfillment.

## Product Priorities

- Local gameplay is not fully accepted. Russ reopened acceptance on 2026-09-08:
  tile-break timing remains wrong, assets need improvement, and campaign balance
  needs analysis and local iteration.
- Active plan: `docs/superpowers/plans/2026-09-08-game-feel-assets-and-balance.md`.
  Fix causal impact timing and missing intermediate cascades before tuning delays.
- Blender 5.1.0 is available at `/Applications/Blender.app/Contents/MacOS/Blender`
  for original offline-rendered piece and fracture assets. Phaser stays the runtime.

- Gameplay feel and presentation clarity are release-critical.
- The board must be responsive on mouse, touch, desktop, and mobile.
- All seven rows must be playable; prior bugs affected rows 5-7 due to board interaction/layout issues.
- Tile drag should feel direct: click/press, hold, and move should move the real tile under the pointer.
- Valid swaps should settle into their new grid positions, pause briefly, then pop matched tiles.
- The moved matching tile must not start returning to its original cell before disappearing.
- Booster tray power-ups must not randomly detonate. They require a deliberate target by click-select plus board tap/click or by dragging onto the board.

## Presentation Contract

- `docs/art/gridwatch-match-presentation-bible.md` is the durable presentation contract.
- Candidate B is the historically approved bright tactical die-cast piece set;
  the next asset iteration requires fresh actual-size review. Web-owned tile,
  power-up, and booster art lives under `public/assets/images/web-overrides/` and must
  survive iOS asset sync.
- The approved Tactical Glass sound pack contains 20 CC0 board cues under
  `public/assets/audio/web-overrides/`; provenance is recorded in
  `docs/art/gridwatch-match-audio-provenance.md`.
- Board sound is scene-timed from Phaser animation beats, not delta-timed from React.
  Do not restore early clear, chain, or power-up board SFX calls in `src/App.tsx`.
- Presentation plans and budgets must not alter engine outcomes or affected positions.

## Current Implementation Notes

- React owns menus, HUD, modals, persistence controls, account, intel, rules, tutorial, and store stub.
- Phaser owns the board canvas, input, tweens, particles, and board VFX.
- `src/engine` is pure TypeScript and must not import React, Phaser, DOM, audio, analytics, or storage.
- `src/game/BoardScene.ts` contains the live tile drag implementation.
- `src/App.tsx` contains booster selection/drag UI and passes targeted booster actions to the scene.
- `tests/e2e/app.spec.ts` covers deterministic swap flow, live drag into a match, booster targeting, booster drag placement, persistence, and viewport overlap checks.

## Current Verification And Historical Release

- 2026-09-08 audit: 238 unit tests and all 100 level validations passed; build passed.
  Ten headless desktop/mobile-sized browser action flows completed, exposing real
  effect-versus-tile timing discrepancies. Full e2e, physical-device listening, and
  new player acceptance are not claimed by that audit.
- Eight thousand deterministic simulation runs completed with no engine errors.
  Actual production-seed runs won 98.65% with random legal choices and 99.85% with
  a simple visible-match policy. These exclude boss clocks and are screening data,
  not human win rates. Details: `docs/research/2026-09-08-game-feel-audit.md`.
- Auth, signed-in score submission, and leaderboard updates were already verified
  by Russ. Campaign saves remain device/browser-local. No backend changes planned.

Historical release record (not a claim of current gameplay acceptance):

- Presentation implementation `eab2cfc` and final handoff `d8ecbe7` are pushed on
  `codex/gridwatch-presentation-overhaul`. Application revision `d8ecbe7` was deployed
  on 2026-07-17 as Worker version `f9699373-caf5-4046-a16f-7621ff0b133d`.
- Verification: 235 unit tests, 90 Playwright tests, 100 levels, production build, and
  `npm audit --audit-level=high` all pass.
- The presentation overhaul did not change Worker, auth, Supabase, score, database, or
  leaderboard code.

## User Preferences

- Be pragmatic and direct.
- Do not change the iOS game source when fixing the web game.
- Treat gameplay polish as critical; code the game as if the public challenge result depends on it.
- Keep secrets out of git.
- GitHub pushes and opening PRs are authorized as of 2026-09-08, superseding the
  local-commits-only restriction. Test gameplay locally first; keep merge/deploy
  separate from PR publication and from player acceptance.
