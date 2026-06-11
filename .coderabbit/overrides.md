# CodeRabbit Overrides

- review-20260607T144647Z docs/superpowers/plans/2026-06-04-motion-graphics-parity.md L14: stale; current reference names iOS `BoardNode.swift` methods and no longer includes the absolute `/Users/...` path.
- review-20260607T144647Z src/game/motion.ts seededAngleJitter: stale; current JSDoc includes `Mirrors iOS BoardNode.swift animateRowDestruction` and `iOS: BoardNode.swift - animateRowDestruction()`.
- review-20260607T144647Z src/game/BoardScene.ts cascade tween: stale; current code extracts 14 and 0.08 into `CASCADE_BOUNCE_MAX_PX` and `CASCADE_BOUNCE_FACTOR` with an iOS `BoardNode.swift animateMoves` citation.
- review-20260607T144647Z src/game/motion.ts buildPostClearSnapshot: stale; current JSDoc includes `Mirrors iOS BoardNode.swift apply(delta:to:completion:)` and `iOS: BoardNode.swift - apply(delta:to:completion:)`.
- review-20260610T142520Z src/game/BoardScene.ts helper symbols `powerUpEventKeys`/`clearFlashColors`/`unionKeys`: stale; current source defines each helper exactly once near the module end.
- review-20260610T144542Z src/game/BoardScene.ts POWERUP_FX_BUDGET_MS: stale; `POWERUP_FX_BUDGET_MS` is defined in the same file before use and `npm run build` type-checks it.
- review-20260610T150536Z tests/e2e/app.spec.ts booster title: stale; the current file has one `dragging a booster onto the board activates at the drop point` test and the FX counter test has a distinct title.
- review-20260610T162522Z tests/e2e/app.spec.ts power-up fx poll: stale; `powerUpFxCount(page)` already uses `expect.poll` with the same timeout as `tilePopCount`.
- review-20260611T164635Z tests/e2e/app.spec.ts counter helper duplicates: stale; current source defines `powerUpFxCount`, `matchBurstCount`, `tntDetonationCount`, and `rocketLaunchCount` exactly once.
- review-20260610T152544Z src/game/BoardScene.ts VFX imports: stale; current source imports `burst`, `ensureVfxTextures`, `shake`, `shockwave`, and `vfxTextureKeys` from `src/game/vfx.ts`.
- review-20260610T152544Z src/game/BoardScene.ts timing constants: stale; current source defines `motionTiming.powerUpEffect`, `motionTiming.matchPopAnticipation`, `motionTiming.matchPop`, `motionTiming.spawnMove`, and standalone budget constants before use.
- review-20260610T154602Z src/game/BoardScene.ts animation helper functions: stale; current source defines `powerUpEventKeys`, `clearFlashColors`, `powerUpPopStagger`, and `unionKeys` exactly once near the module end.
- review-20260611T170639Z src/game/BoardScene.ts board methods: stale; current source defines `activateBoosterAtPointer`, `playBlockedCellFeedback`, and `updateGeometry` exactly once inside `BoardScene`; module helpers after the class are not duplicate methods.
- review-20260610T164533Z src/game/vfx.ts VFX_TIMING: stale; current source imports `VFX_TIMING` and uses it for `PARTICLE_MIN_SPEED_RATIO` and `EMITTER_CLEANUP_BUFFER_MS`.
