# SKILLS.md - GridWatch Match Web

## Purpose

This is the capability guide for agents and contributors working on GridWatch Match Web. It complements `AGENTS.md`; when instructions conflict, `AGENTS.md`, `MEMORY.md`, and `HANDOFF.md` win.

Work as a senior browser-game engineer and game-feel designer. The standard is a polished, immediately playable match-3 game, not a functional demo.

## Required Capabilities

### TypeScript, React, And Vite

- Write strict TypeScript and follow the existing React patterns.
- Keep React responsible for navigation, HUD, modals, account, settings, persistence controls, and text-heavy UI.
- Keep Phaser objects out of React state and persistence.
- Preserve responsive desktop and mobile layouts; all seven board rows and the booster tray must remain reachable.

### Phaser Board Rendering

- Treat `src/game/BoardScene.ts` as the owner of board rendering, pointer input, tweens, particles, hit testing, and board VFX.
- Drag the real occupant container under the pointer. The neighboring tile mirrors the drag while crossing a cell boundary.
- Keep valid swap settle, match impact, cascade, spawn, and invalid-swap return visually causal. Avoid destination pop-in, duplicate sprites, ghost trails, and hard snap-backs.
- Respect `reducedMotion` for every new animation, shake, flash, particle, projectile, and win sequence.
- Keep test-only browser globals gated behind the exact `?gwTestMode=1` query.

### Deterministic Engine Discipline

- Treat `src/engine` as a pure deterministic state machine. It must never import Phaser, React, DOM, storage, audio, analytics, or rendering code.
- Do not change engine outcomes to solve a presentation problem. Render from `BoardSnapshot` and `BoardDelta` only.
- Preserve the action queue maximum depth of 3 and existing level JSON semantics.
- Add pure helpers with Vitest coverage when timing, scheduling, or presentation planning becomes nontrivial.

### Game Feel And Presentation

- Prioritize readable silhouettes, strong event hierarchy, physical tile motion, and audiovisual synchronization.
- A normal match should be crisp; created power-ups should feel special; power-ups should own the board briefly; combinations should be visibly stronger than singles.
- Make effects communicate actual `BoardDelta` results. Do not imply a cell cleared before its causal effect reaches it or if the engine did not clear it.
- Keep color from being the sole identifier. Validate small tile size, grayscale readability, desktop, and mobile.
- Use original GridWatch visual and sound work. Royal Match is a benchmark for clarity, polish, and escalation, not an asset source.

### Audio And Haptics

- Cue board sounds from the Phaser visual beat, not immediately when React receives an engine delta.
- Keep music, SFX, and voice settings independent.
- Support short overlapping board sounds without clipping, long generic tails, or one `HTMLAudioElement` allocation per impact where a cached path is available.
- Use vibration only for meaningful power-up impacts, with graceful no-op behavior on unsupported devices.

### Asset Pipeline

- Keep stable generated asset-manifest keys. Use helpers instead of scattering copied public paths.
- iOS-synced images are fallbacks; web-specific visual overrides belong under `public/assets/images/web-overrides/`.
- Do not modify the iOS reference repo. Do not manually edit synced fallback images.
- Preserve web-owned overrides when changing `scripts/sync-ios-assets.mjs`.
- Do not add unapproved binary art or sound. Document asset provenance and validate at actual gameplay size.

### Testing And Browser Verification

- Use red-green TDD for pure logic and behavior changes.
- Run focused Vitest tests first, then `npm run test`.
- For visible game changes, add/update Playwright coverage and inspect desktop plus mobile browser output.
- Prefer scene-state/readiness helpers and synchronous in-page PointerEvents for board e2e flows. Do not paper over Phaser boot or resize races with retries or arbitrary sleeps.
- For the historically flaky board-drag test, use the 20-run warm-preview loop documented in `HANDOFF.md` before declaring a related change stable.
- Run `npm run validate:levels`, `npm run build`, and `npm audit --audit-level=high` for a final presentation/release gate.

### Backend, Data, And Security Boundaries

- Do not alter Worker score submission, Supabase auth, leaderboard behavior, database access, score formulas, telemetry, or secrets unless the task explicitly targets them.
- Never commit `.env*`, `.dev.vars*`, service-role keys, private Firebase files, generated `dist/`, or local caches.
- The store is a playable stub; do not introduce payments or fulfillment services.

## Definition Of Done

- Follow existing architecture and keep changes scoped.
- Preserve deterministic gameplay and input safety.
- Add focused tests proportionate to risk.
- Verify visible behavior in a real browser on desktop and mobile.
- Update `HANDOFF.md` when behavior, verification, or future work changes.
- Leave a clean, reviewable diff with no unrelated formatting churn.

## Cross-Reference

| Source | Use it for |
|---|---|
| `AGENTS.md` | Binding repository rules, commands, architecture, and verification requirements. |
| `MEMORY.md` | Durable facts and user preferences. |
| `HANDOFF.md` | Latest implementation state, known risks, and exact flaky-test methodology. |
| `docs/superpowers/plans/` | Approved task-by-task implementation plans. |
| `docs/art/` | GridWatch visual/audio direction and asset requirements. |

Read `AGENTS.md`, `MEMORY.md`, and `HANDOFF.md` before changing the project.
