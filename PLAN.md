# GridWatch Match Web Port Plan

## Summary

Build `GridWatchMatchWeb` as a public static web app built from `remeadows/GridWatchMatchWeb` and hosted on Cloudflare Pages at `GridWatchMatchWeb.warsignallabs.net`.

Use React 19 + Phaser 4 + Vite 8 + TypeScript. React owns menus, HUD, modals, settings, account, intel, rules, tutorial, and store stub. Phaser owns the match-3 board rendering, input, animation, and VFX. The board engine is pure TypeScript and renderer-free, matching the current Swift source behavior.

## Key Changes

- Initialize `GridWatchMatchWeb` as its own git repo, remote `https://github.com/remeadows/GridWatchMatchWeb.git`.
- Add app scaffold: `AGENTS.md`, `PLAN.md`, `README.md`, Vite config, React/Phaser app shell, CI workflow, tests.
- Add asset sync script from the iOS repo:
  - Copy all 100 level JSON files.
  - Copy tiles, power-ups, backgrounds, villains, heroes, app icon, audio, Lottie, and video assets.
  - Normalize assets into stable web manifest keys.
- Port the full Swift board engine to TypeScript:
  - deterministic RNG, Grid2D, match detection, gravity, spawn rules, deadlock shuffle
  - overlays, malware underlays, honeypot generators, locked cells
  - all power-ups and all 10 combos
  - boosters, Play On, win/fail, boss timers, scoring, stars, replay log
- Build complete web UX:
  - Home, Operations, Area Select, Level Select, Game, Account, Settings, Rules, Intel, result modals, tutorial overlay
  - IndexedDB persistence for progress, coins, boosters, hero, intel, settings, tutorial state
  - Web Audio music/SFX/voice service
- StoreKit becomes a playable web store stub:
  - Show coin packs and Security Clearance Pass UI.
  - Disable real purchase fulfillment with web beta messaging.
  - No backend, secrets, or Stripe until a future monetization phase.

## Test Plan

- Vitest:
  - engine primitives, RNG parity, spawn rules, level parsing
  - match patterns, power-up creation priority, all power-ups and all combos
  - gravity, overlays, malware, generators, locked cells
  - all 100 levels initialize with fixed seeds and have no broken invariants
  - replay determinism, Play On, boosters, win/fail, scoring
- Playwright:
  - root base path boots
  - Home -> Operations -> Level 1 -> Game
  - deterministic valid swap changes board and HUD
  - booster use, fail + Play On, win modal, next level unlock
  - boss timer fail
  - store stub does not grant coins
  - settings/intel/tutorial persistence
  - desktop and mobile screenshots have no board/HUD overlap
- CI:
  - `npm ci --ignore-scripts`
  - `npm run validate:levels`
  - `npm run test`
  - `npm run build`
  - `npm audit --audit-level=high`
- Deployment:
  - Cloudflare Pages auto-builds and deploys on push to `main` via its Git integration (independent of the CI workflow above).

## Assumptions

- Canonical public repo is confirmed as `remeadows/GridWatchMatchWeb`.
- Cloudflare Pages is the v1 host (`GridWatchMatchWeb.warsignallabs.net`).
- Current Swift source and current 100 JSON levels are authoritative where docs disagree.
- Web parity uses platform equivalents: IndexedDB for SwiftData, Web Audio for AVAudioPlayer, Vibration/no-op for haptics, optional disabled-by-default Firebase Web, and a store stub for StoreKit.

