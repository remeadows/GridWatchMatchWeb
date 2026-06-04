# AGENTS.md - GridWatch Match Web

GridWatch Match Web is the browser port of the iOS GridWatchMatch game.

Challenge context is recorded in `CHALLENGE_CONTEXT.md`. Treat "public link, immediately playable" as a release requirement for this repo.

## Stack

- React + TypeScript + Vite for app shell, HUD, modals, meta screens, settings, account, intel, and store stub.
- Phaser for the board renderer, tweens, particles, input hit testing, and board VFX.
- Pure TypeScript engine in `src/engine`; no DOM, React, Phaser, browser storage, audio, analytics, or rendering imports inside engine modules.
- Static GitHub Pages hosting only. No backend, secrets, or real-money fulfillment in this repo.

## Source Of Truth

- Match rules and data parity come from the current Swift source in the sibling iOS repo.
- Prefer current source over stale docs when they disagree.
- Levels are hand-authored JSON copied from the iOS repo; do not add procedural generation.
- The web port must support all current engine capabilities even when the current 100 levels do not exercise them.

## Architecture Rules

- React owns navigation and text-heavy UI.
- Phaser owns the board canvas only.
- BoardEngine is a pure state machine: `(level, seed, actions) -> snapshot + delta`.
- Keep action queue max depth at 3.
- Keep stable asset manifest keys; do not scatter raw copied paths across gameplay code.
- Persist serializable app state only, not Phaser objects.
- Use CSS variables/theme tokens; avoid hardcoded one-off colors outside theme files.
- Store is stubbed until a secure backend exists.
- Firebase Web telemetry is optional and disabled by default.
- Do not commit `.env*`, Firebase private files, Stripe keys, generated `dist/`, or local cache files.
- Keep README submission-ready with what was made, how Codex helped, and how to play/controls.

## Commands

- `npm ci`
- `npm run sync:assets`
- `npm run validate:levels`
- `npm run test`
- `npm run test:e2e`
- `npm run build`
- `npm run preview -- --host 127.0.0.1 --port 4173 --strictPort`

## Verification

- Run unit tests for engine changes.
- Run Playwright for visible UI/gameplay changes.
- For release/deploy changes run build, preview, dependency audit, and screenshot checks for desktop and mobile.
