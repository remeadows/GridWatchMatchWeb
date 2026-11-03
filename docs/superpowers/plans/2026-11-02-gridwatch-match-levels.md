# GridWatch Match 200 Levels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn GridWatch Match into a 200-level campaign where blockers really block, clearing them is part of winning, and difficulty is measured.

**Architecture:** Rule changes go in the pure engine (`src/engine`). The display reads new engine events. A bot and level tool under `scripts/levels/` build levels as ordinary `public/levels/level_NNN.json` files, so the game loads levels exactly as it does today.

**Tech Stack:** TypeScript, React 19, Phaser 4, Vite, vitest, Playwright, Cloudflare Worker, esbuild for the node tool.

**Spec:** `docs/superpowers/specs/2026-11-02-gridwatch-match-levels-design.md`

## Global Constraints

- Work happens on local branch `dev/level-campaign`, started from `dev/feel-pieces-effects` at `a475b87` (Russ, 2026-11-02: build it all in this session). It moves onto `main` after the feel work ships. Local branch and dev site only. Pushing, merging and production are Russ's word, never routine.
- Do not run `npm run cf:dev-instance` until the controller says so: the dev site is holding `470d122-dev` for Russ's phone check of the feel work.
- Keep `src/engine` pure: no display, DOM or Phaser imports.
- No iOS parity in any decision. Never modify the iOS source repo. Do not run `npm run sync:assets`.
- Levels 1-10 stay byte-identical to `main`.
- Never leave `tsconfig.tsbuildinfo`: type-check with `npx tsc --noEmit`, not `npx tsc -b`.
- Do not commit `.env*`, keys or `dist/`. Port 5179 belongs to another project: never kill it.
- Board input or animation changes need Playwright coverage. Dark theme default: `CI=1 npm run test:e2e`, about 15 minutes. Classic: `GW_REPO="$PWD" GW_OUT=<dir> GW_THEME=classic GW_BUNDLED=1 CI=1 npx playwright test --config art/gridwatch-match/qa/pw.config.mjs`. Nothing else may build or upload during a run.
- Dev site: commit first, then `npm run cf:dev-instance`. Record implementation, verification, acceptance and deployment separately in `HANDOFF.md`. No physical-device claims from emulation.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Player-facing text names a game object with its picture and says what a button does.

## Review Focus

1. A dense board with no legal move after a resolve. Expected: the game opens the board and play continues, never a crash or stuck screen. Test in Task 3.
2. A refill below a frozen pane. Expected: the column stops at the pane, the cells below refill, and nothing floats or overlaps. Test in Task 3.
3. A player with reduced motion on, or on the classic theme, on a blocker goal. Expected: no flights, and the goal count stays correct. Test in Task 7.
4. A signed-in win on a level with custom star thresholds, and on level 150. Expected: the score server accepts both. Test in Task 9.
5. An old save with level 100 finished and no intro-card field. Expected: it loads, keeps progress, and offers level 101. Test in Task 12.

---

### Task 1: Foundation with no behaviour change

Freeze the levels the recorded test runs use, stop the iOS step touching levels, and put campaign length in one place.

**Files:**
- Modify: `src/data/areas.ts`, `src/App.tsx:356,527,548,555,610,1406,1408`, `src/components/DarkHomeScreen.tsx:30,59,65`, `src/state/progress.ts:133`, `worker/validation.ts:38`, `scripts/sync-ios-assets.mjs:475-480`, `src/tests/resolution.test.ts:214`, `docs/research/2026-09-08-game-feel/freeze-resolution.mjs`, `docs/research/2026-09-08-game-feel/verify-resolution.mjs`
- Create: `src/tests/fixtures/resolution/levels/level_001.json` to `level_100.json` (copies), `src/tests/campaign.test.ts`

**Interfaces:**
- Produces: `campaignLevelCount: number` from `src/data/areas.ts`.

- [ ] **Step 1: Commit the approved design and this plan**

```bash
git add docs/superpowers/specs docs/superpowers/plans/2026-11-02-gridwatch-match-levels.md docs/art/2026-11-02-villain-portrait-prompts.md
git commit -m "docs: design and plan for the 200-level campaign"
```

- [ ] **Step 2: Write the failing test in `src/tests/campaign.test.ts`**

```ts
import { areas, campaignLevelCount } from "../data/areas";

it("takes campaign length from the last sector", () => {
  expect(campaignLevelCount).toBe(areas[areas.length - 1].lastLevel);
});
```

Add one more test here: `validateSubmission` for level `campaignLevelCount + 1` answers `"Unknown level."`.

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run src/tests/campaign.test.ts`
Expected: FAIL, `campaignLevelCount` is undefined.

- [ ] **Step 4: Export `campaignLevelCount` and replace the fixed 100s**

In the worker, remove the `levelId > 100` test. `moveLimitFor(levelId) === null` already answers "Unknown level." Replace each other listed line with `campaignLevelCount`, including the copy "100 cyberpunk match-3 operations".

- [ ] **Step 5: Freeze the levels**

Copy `public/levels/*.json` to `src/tests/fixtures/resolution/levels/`. Point `resolution.test.ts:214` and both research scripts at that folder.

- [ ] **Step 6: Remove the level step from the iOS copy script**

Delete the `copyDirectoryFiles(... levelsOut ...)` call, the `levelsOut` constant, and the word "levels" from the final log line.

- [ ] **Step 7: Verify**

Run: `npm test && npm run validate:levels && npx tsc --noEmit`
Expected: all pass, and the game plays as before.

- [ ] **Step 8: Commit**

```bash
git add -A src worker scripts docs/research
git commit -m "chore: one campaign length, frozen test levels, no iOS level copy"
```

### Task 2: New villains and dossiers

**Files:**
- Modify: `src/data/areas.ts`, `src/data/intel.ts`, `scripts/sync-ios-assets.mjs:60-112`, `src/data/assetManifest.generated.ts`, `src/data/assetSyncState.generated.json`
- Create: `public/assets/images/villains/Dread.png`, `Vyrus.png`, `Shard.png`, `Lotus.png`, `Malus.png` (placeholders)
- Delete: `public/assets/images/villains/AX10M2.png`, `Rusty.png`, `Tee_v1.png`, `Tish3.jpg`, `Helix.jpg`
- Test: `src/tests/campaign.test.ts`

**Interfaces:**
- Produces: manifest keys `dread`, `vyrus`, `shard`, `lotus`, `malus`, replacing `ax10m2`, `rusty`, `tee`, `tish`, `helix` under `images.villains`. `images.heroes` is unchanged.

- [ ] **Step 1: Write failing tests**

```ts
it("gives sectors 5, 7, 8, 9 and 10 the new villains", () => {
  const byId = Object.fromEntries(areas.map((a) => [a.id, a.villainName]));
  expect([byId[5], byId[7], byId[8], byId[9], byId[10]]).toEqual(["DREAD", "VYRUS", "SHARD", "LOTUS", "MALUS"]);
});

it("keeps no team member in a dossier", () => {
  const names = intelFiles.map((file) => file.codename);
  for (const team of ["RUSTY", "TEE", "TISH", "HELIX", "AX-10M2"]) expect(names).not.toContain(team);
});
```

Also assert each sector's `villainKey` file exists under `public/`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/tests/campaign.test.ts`
Expected: FAIL on names.

- [ ] **Step 3: Change `areas.ts`**

Sector 5 `dread`/`DREAD`, 7 `vyrus`/`VYRUS`, 8 `shard`/`SHARD`, 9 `lotus`/`LOTUS`, 10 `malus`/`MALUS`. Accents stay.

- [ ] **Step 4: Replace the dossiers**

Replace the five entries in `intel.ts` with the text in the spec's Villains table. Keep unlock levels 41, 61, 71, 81, 91, use `faction: "THREAT"`, new ids `file_dread`, `file_vyrus`, `file_shard`, `file_lotus`, `file_malus`, and `portraitKey` equal to the new key. In the threat report at line 243, change "AX-10M2 files reports" to "DREAD files reports".

- [ ] **Step 5: Add placeholders and update the manifest**

Make each new file a 1024×1024 near-black PNG with `sips`. In the sync script, change the villain map and drop the five `imageCopies` rows. Hand-edit the two generated files to match what the script would write, because the script needs the iOS repo and must not be run.

- [ ] **Step 6: Verify and commit**

Run: `npm test && npx tsc --noEmit`
Expected: all pass.

```bash
git add -A src public/assets/images/villains scripts
git commit -m "feat(story): DREAD, VYRUS, SHARD, LOTUS and MALUS replace the team as villains"
```

### Task 3: Panes really block

**Files:**
- Modify: `src/engine/boardEngine.ts`, `src/engine/matchDetector.ts:169-171`, `scripts/validate-levels.mjs`
- Create: `src/tests/blockers.test.ts`, `src/tests/helpers/testBoard.ts`

**Interfaces:**
- Produces: `testLevel(rows: string[], options?: { moveLimit?: number; objectives?: ObjectiveDefinition[] }): LevelDefinition` in `src/tests/helpers/testBoard.ts`. Tokens separated by spaces: `p f k t` a piece, `p#2` a piece under a 2-layer pane, `p!` a locked piece, `p~1` a piece on 1-layer malware, `H` a honeypot. Used by Tasks 3, 4 and 5.

- [ ] **Step 1: Write the helper and failing tests in `src/tests/blockers.test.ts`**

Name the tests exactly:
- `"a piece under a pane cannot swap"`: swap into a pane cell throws code `invalidSwap`, and no `validMoves()` entry touches it.
- `"a piece under a pane cannot match"`: `p p p#1` in a row does not clear, with the pane's piece still present after a neighbouring swap.
- `"a piece under a pane does not fall"`: clearing below it leaves it in place. The cell's `debugTileId` is unchanged.
- `"a refill below a pane stays below the pane"`: clear the cells under a pane. Those cells refill from their own segment, every cell holds exactly one piece, and the cells above the pane did not move (Review Focus 2).
- `"a match next to a pane removes one layer"`: hp 3 becomes 2.
- `"a power-up hit removes one layer and leaves the piece"`: a rocket through hp 2 gives hp 1, and the piece remains.
- `"one move removes at most one layer per pane"`: a cascade that matches beside the same pane twice leaves hp 2 from hp 3.
- `"a broken pane frees its piece"`: at hp 0 the cell is movable and can match on the next move.
- `"a board with no legal move opens a pane instead of throwing"`: an all-pane board but for a cluster that resolves dead (Review Focus 1). `apply` returns, and `validMoves().length` is above 0.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/tests/blockers.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `parseCell` (`boardEngine.ts:727`): `isMovable` is false when `definition.overlay` is set.
- `matchableTile` (`matchDetector.ts:169`): return `null` when the cell has an overlay.
- In `resolveBoard`, replace both overlay branches (`:339-351`) with `this.hitPane(position, accumulator)` then `continue`.
- `private panesHitThisMove = new Set<string>()`, cleared at the start of `applyInternal`.
- `private hitPane(position, accumulator): void`: return if the position is already in the set; add it; lower `hp`, or at hp 1 set `overlay = null` and `isMovable = cell.generator === null`.
- Track `recentlyMatched`: positions cleared with `clearedByPowerUp === false`. Rename `applyAdjacentUnderlayDamage` to `applyAdjacentDamage(recentlyCleared, recentlyMatched, accumulator)`. It damages malware from `recentlyCleared` as today, and calls `hitPane` on any orthogonal neighbour of `recentlyMatched` with an overlay.
- `shuffleUntilPlayable`: when 256 attempts fail, remove the first pane in row order, set that cell movable, and try again. Throw `noMovesAvailable` only when no panes remain. Never remove a honeypot or a lock.

- [ ] **Step 4: Add validator rules**

In `scripts/validate-levels.mjs`: a pane cell must not be locked (`PANE_ON_LOCK`) and must not hold a power-up (`PANE_ON_POWERUP`).

- [ ] **Step 5: Run and commit**

Run: `npx vitest run src/tests/blockers.test.ts`
Expected: PASS. `resolution.test.ts` now fails, which Task 6 fixes.

```bash
git add src/engine src/tests/blockers.test.ts src/tests/helpers scripts/validate-levels.mjs
git commit -m "feat(engine): panes freeze the piece under them"
```

### Task 4: Remove all malware

**Files:**
- Modify: `src/engine/boardEngine.ts`, `src/engine/types.ts`, `src/engine/powerUps.ts:388`, `src/data/levels.ts`, `scripts/validate-levels.mjs:8`
- Test: `src/tests/blockers.test.ts`

**Interfaces:**
- Produces: `BoardSnapshot.malwareLeft: number`. Objective id `"malware"`, `target: 1`, `tileType: null`. Replaces the `spread` id everywhere.

- [ ] **Step 1: Write failing tests**

- `"malware spreads by one cell after a move that removes none"`: count rises by exactly 1, however many cascades ran and however many malware cells exist.
- `"a move that removes malware stops the spread"`.
- `"a move that only damages 2-layer malware still spreads"`: the design says "removes".
- `"a booster does not trigger a spread"`.
- `"a board with no malware draws no random number for spreading"`: in `applyWithResolution`, the `malware` step's `before.rngSeed` equals its `after.rngSeed`.
- `"removing the last malware wins a malware goal"`: `isWin` true, `malwareLeft` 0.
- `"a malware goal cannot be finished while any remains"`: with two cells, removing one leaves `isWin` false.
- `"the malware goal wins on the last move instead of failing"`: `isWin` true, `isFail` false, at `moveCount === moveLimit`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/tests/blockers.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- Remove `spreadMalwareOneStep()` from the cascade loop. Add `private malwareRemovedThisMove = false`, set wherever an underlay is destroyed (`decrementUnderlayIfPresent` returning true, and `applyAdjacentDamage`).
- After the `resolveBoard` loop ends, keep the `capture.record("malware", ...)` step. Call `spreadMalwareOneCell()` first only if `action.kind !== "activateBooster"` and nothing was removed. Pass the action kind in.
- `spreadMalwareOneCell()`: gather all empty non-generator orthogonal neighbours of malware cells, sorted by position and without duplicates. Return without drawing if there are none. Otherwise place `hp: 1` on one chosen by `rng.nextInt`.
- At the end of `applyInternal`, before `isWin`: if `objectiveTargetsValue.malware` is set, `objectiveProgressValue.malware = malwareLeft === 0 ? 1 : 0`.
- `snapshotAt` computes `malwareLeft` by counting underlays.
- `powerUps.ts:388`: `objective.id === "malware"`.
- `objectiveLabel` in `src/data/levels.ts`: for id `malware`, return `Malware left: ${progress}`, where the caller passes the number left. Task 7 wires that.
- Validator: remove `spread`, add `malware`; `MALWARE_GOAL_WITHOUT_MALWARE` if a level has that goal and no underlay.

- [ ] **Step 4: Run and commit**

Run: `npx vitest run src/tests/blockers.test.ts && npx tsc --noEmit`
Expected: PASS.

```bash
git add src/engine src/data/levels.ts src/tests/blockers.test.ts scripts/validate-levels.mjs
git commit -m "feat(engine): remove-all-malware goal, malware spreads only when ignored"
```

### Task 5: Pane and lock goals, and blocker events

**Files:**
- Modify: `src/engine/boardEngine.ts`, `src/engine/types.ts`, `src/engine/powerUps.ts`, `scripts/validate-levels.mjs:8`
- Test: `src/tests/blockers.test.ts`

**Interfaces:**
- Consumes: `hitPane`, `applyAdjacentDamage` from Tasks 3 and 4.
- Produces:

```ts
export type BlockerKind = "pane" | "lock" | "malware";
export interface BlockerClear { position: GridPosition; kind: BlockerKind; objectiveId: string | null }
```

`BoardDelta.blockerClears: BlockerClear[]` and `BoardResolutionStep.blockerClears: BlockerClear[]`. Objective ids `"panes"` and `"locks"`, `tileType: null`.

- [ ] **Step 1: Write failing tests**

- `"a pane counts for the goal when its last layer breaks"`: `panes` progress is 0 after the first of two hits and 1 after the second.
- `"a lock counts when its piece clears"`.
- `"a lock counts when a power-up clears it"`.
- `"each removed blocker appears in blockerClears once, with its objective id"`: kinds `pane`, `lock`, `malware`, and `objectiveId` is null when the level has no such goal.
- `"a blocker over its goal target gives a null objective id"`.
- `"step blockerClears sum to the delta's"` using `applyWithResolution`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/tests/blockers.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `private countBlocker(kind, position, accumulator)`: picks the goal id (`pane`→`panes`, `lock`→`locks`, `malware`→`malware`) if it exists and is below target for panes and locks. Adds progress for panes and locks, and pushes the `BlockerClear`. The malware goal's progress stays Task 4's rule.
- Call it where a pane's last layer breaks, where malware is destroyed, and where a locked piece clears. Detect the lock before `isMovable` is reset (`!cell.isMovable && cell.generator === null`).
- Carry `blockerClears` through `emptyAccumulator`, `BoardDelta` and `ResolutionCapture.record`, the same way `clears` is sliced per step.
- `weightForObjectivePriority`: `panes` adds 2.5 on an overlay cell, `locks` adds 2.5 on a locked cell.
- Validator: allow `panes` and `locks`. `GOAL_UNREACHABLE` when a `panes` or `locks` target exceeds the count of that blocker on the board.

- [ ] **Step 4: Run and commit**

Run: `npx vitest run src/tests/blockers.test.ts && npx tsc --noEmit`
Expected: PASS.

```bash
git add src/engine src/tests/blockers.test.ts scripts/validate-levels.mjs
git commit -m "feat(engine): pane and lock goals, blocker events for the display"
```

### Task 6: Re-record the 2,000 test runs

**Files:**
- Modify: `docs/research/2026-09-08-game-feel/freeze-resolution.mjs`, `docs/research/2026-09-08-game-feel/README.md`, `src/tests/resolution.test.ts`, `src/tests/fixtures/resolution/{manifest,specimens,corpus}.json`

- [ ] **Step 1: Check why each old fixture fails**

Run: `npx vitest run src/tests/resolution.test.ts src/tests/playbackLifecycle.test.ts src/tests/resolutionPlayback.test.ts`
Expected: failures only on levels or specimens with panes or malware. A failure on a level with neither is a bug in Tasks 3-5: stop and fix it.

- [ ] **Step 2: Re-record**

The script refuses to overwrite, so delete the three fixture JSON files. Set `baseline` to `git rev-parse --short HEAD`, and read levels from the frozen folder. Run it as `docs/research/2026-09-08-game-feel/README.md` describes. It asserts the corpus still contains the creation, tap and shuffle cases.

- [ ] **Step 3: Update the action count**

Replace `34054` in `resolution.test.ts` and its test name with the new total from the script's output. Update the README's number.

- [ ] **Step 4: Verify and commit**

Run: `node docs/research/2026-09-08-game-feel/verify-resolution.mjs && npm test`
Expected: verifier reports no fixture writes, all tests pass.

```bash
git add src/tests docs/research
git commit -m "test: re-record resolution runs under the new blocker rules"
```

### Task 7: Goal chips and flights for blockers

**Files:**
- Modify: `src/game/boardTheme.ts`, `src/game/BoardScene.ts:103-110,1486-1498`, `src/game/pieceFlights.ts:25-31`, `src/game/objectiveFlight.ts`, `src/App.tsx:727-731,1262-1272`, `src/darkRealism.css`
- Test: `src/tests/objectiveFlight.test.ts`, `tests/e2e/app.spec.ts`

**Interfaces:**
- Consumes: `BlockerClear`, `BlockerKind`, `BoardSnapshot.malwareLeft`.
- Produces: `matchV2BlockerAsset(kind: BlockerKind): MatchV2Asset | undefined` using `overlay:encryptedVolume`, `cell:locked`, `underlay:malwarePropagation`. `CollectedPiece` gains `blocker: BlockerKind | null`, and `tileType` becomes `TileType | null`. `malwareCountShown(counts: ObjectiveFlightCounts, left: number): number`.

- [ ] **Step 1: Write the failing unit test**

```ts
it("shows malware still in the air as not yet removed", () => {
  const counts = launchPiece({}, "malware", 0);
  expect(malwareCountShown(counts, 4)).toBe(5);
  expect(malwareCountShown({}, 4)).toBe(4);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/tests/objectiveFlight.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the flight**

- `malwareCountShown` is `left + (counts.malware?.inAir ?? 0)`.
- In `playResolutionClear`, send each `step.blockerClears` entry with an `objectiveId` through `onPieceCollected`, under the same `reducedMotion` and theme guard as `collectPiece`.
- `pieceFlights.launch` picks `matchV2BlockerAsset(piece.blocker)` when `blocker` is set.

- [ ] **Step 4: Implement the chip**

For `panes`, `locks` and `malware`, show the blocker's picture with class `objective-picture` in dark theme. For malware, the label uses `malwareCountShown` with `hud.malwareLeft`.

- [ ] **Step 5: Write Playwright tests in `tests/e2e/app.spec.ts`**

Route `level_001.json` to a hand-made level, using the file's existing helper pattern.
- `"a broken pane flies to its goal and the count waits for it"`: trace records `objective-fly` for `panes`, and the chip count rises after landing.
- `"reduced motion and classic count blockers at once"` (Review Focus 3): emulate reduced motion, and assert the chip number is right with no `.piece-flight` element.
- `"blocker goals fit one phone screen"`: at 375x550, chip text is not clipped, and there is no page scroll.

- [ ] **Step 6: Run and commit**

Run: `npx playwright test tests/e2e/app.spec.ts -g "blocker|broken pane" --project=chromium --project=mobile`
Expected: PASS. Look at one screenshot at 440x748 by eye.

```bash
git add src tests/e2e
git commit -m "feat(play): blocker goals show their picture and blockers fly to them"
```

### Task 8: Intro cards and Play On when short of coins

**Files:**
- Modify: `src/state/save.ts:21-32,83-96`, `src/App.tsx:818,873,1179-1187,1382-1394`, `src/data/rules.ts`
- Create: `src/data/blockerIntros.ts`
- Test: `tests/e2e/app.spec.ts`, `src/tests/cloudSync.test.ts`

**Interfaces:**
- Produces: `SaveState.blockerIntrosSeen: Record<string, boolean>`. `blockerIntros: Record<BlockerKind, { title: string; body: string }>`.

Exact copy for `src/data/blockerIntros.ts`:

| Kind | Title | Body |
|---|---|---|
| `pane` | Encrypted pane | The piece underneath is frozen. Make matches next to the pane, or hit it with a power-up, to break it. Each move removes one layer. |
| `lock` | Locked cell | This piece can't move. Match it, or hit it with a power-up, to free the cell. |
| `malware` | Malware | Clear pieces on or next to malware to remove it. If your move removes none, it spreads. |

- [ ] **Step 1: Write failing Playwright tests**

- `"the first pane goal shows its card once"`: card shows the picture, title and body. After "Got it" and a reload it does not return.
- `"the card stops the boss clock"`: the clock does not move while it is open.
- `"Play On short of coins keeps the mission open"`: with 100 coins, the modal says `Play On costs 500 coins. You have 100.`, the "Play On" button is disabled, and "End Mission" still ends it.
- `"Play On with enough coins still works"`.

These tests need a way past `gwTestMode`'s tutorial skip: use a param `gwIntroCards=1`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx playwright test tests/e2e/app.spec.ts -g "card|Play On" --project=chromium`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `normalizeSave` defaults `blockerIntrosSeen` to `{}`. Add a cloud merge test if `cloudSaves.ts` names fields explicitly.
- Show one modal at a time, for the first unseen kind among the level's goals. Skip in `gwTestMode` unless `gwIntroCards=1`. Include it in `tutorialVisibleRef.current`.
- `ResultModal` for `playOn`: when `save.coins < playOnCost`, use the message above and `primaryDisabled`. `acceptPlayOn` no longer sets `failed` when short.
- `src/data/rules.ts`: replace the blocker lines, including "Malware spreads if the grid is left exposed.", with the three card bodies above, so the Rules screen matches the game.

- [ ] **Step 4: Run and commit**

Run: `npx playwright test tests/e2e/app.spec.ts -g "card|Play On" --project=chromium --project=mobile && npm test`
Expected: PASS.

```bash
git add src tests/e2e
git commit -m "feat(play): blocker intro cards, Play On no longer ends a mission when short"
```

### Task 9: Star thresholds per level

**Files:**
- Modify: `src/engine/types.ts:48-58`, `src/App.tsx:886,1399,1403,1801-1807`, `worker/validation.ts:18-24,60`, `scripts/generate-level-limits.mjs`, `scripts/validate-levels.mjs`
- Create: `src/data/stars.ts`, `worker/level-stars.json`, `src/tests/stars.test.ts`

**Interfaces:**
- Produces: `LevelDefinition.starMoves?: { two: number; three: number }`, moves left needed. `starsForMovesLeft(movesLeft: number, moveLimit: number, starMoves?: { two: number; three: number }): number`. `worker/level-stars.json` maps level id to `starMoves`, only for levels that have it. Worker `starsFor(moveCount, moveLimit, levelId)`.

- [ ] **Step 1: Write failing tests in `src/tests/stars.test.ts`**

```ts
it("keeps the old rule without thresholds", () => {
  expect(starsForMovesLeft(13, 25)).toBe(3);
  expect(starsForMovesLeft(5, 25)).toBe(2);
  expect(starsForMovesLeft(4, 25)).toBe(1);
});

it("uses a level's own thresholds", () => {
  expect(starsForMovesLeft(4, 30, { two: 2, three: 4 })).toBe(3);
  expect(starsForMovesLeft(2, 30, { two: 2, three: 4 })).toBe(2);
  expect(starsForMovesLeft(1, 30, { two: 2, three: 4 })).toBe(1);
});
```

Add for Review Focus 4: `"the server accepts a win with custom stars"`. Use `vi.mock` on `worker/level-stars.json` to give a level thresholds, and assert `validateSubmission` returns `ok: true` for a run with those stars. Add a parity test that loops all `public/levels` and compares `starsForMovesLeft` with the worker's `starsFor` at every moves-left value.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/tests/stars.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`starsEarned` in `App.tsx` takes the level. `generate-level-limits.mjs` also writes `worker/level-stars.json`. Validator: `STAR_MOVES_INVALID` unless `0 < two < three < moveLimit`. Worker keeps the Play On relaxation. Update the "MUST mirror" comment at `worker/validation.ts:18` to name `src/data/stars.ts`.

- [ ] **Step 4: Run and commit**

Run: `npx vitest run src/tests/stars.test.ts && npm run build`
Expected: PASS.

```bash
git add src worker scripts
git commit -m "feat(stars): each level can set its own star thresholds, client and server"
```

### Task 10: Test bot and baseline report

**Files:**
- Modify: `src/engine/boardEngine.ts`, `src/engine/rng.ts`, `package.json`, `.gitignore`
- Create: `scripts/levels/bot.ts`, `scripts/levels/report.ts`, `scripts/levels/cli.ts`, `src/tests/levelBot.test.ts`, `docs/gridwatch-match/level-report-baseline.json`

**Interfaces:**
- Produces:

```ts
// src/engine/boardEngine.ts
fork(): BoardEngine;

// scripts/levels/bot.ts
export interface BotOptions { mistakeRate: number }
export const DEFAULT_BOT: BotOptions = { mistakeRate: 0.2 };
export interface GameResult { won: boolean; movesLeft: number; deadBoard: boolean }
export function chooseMove(engine: BoardEngine, rng: SeededRNG, options: BotOptions): BoardAction;
export function playLevel(level: LevelDefinition, botSeed: bigint, options?: BotOptions): GameResult;

// scripts/levels/report.ts
export interface LevelReport { id: number; games: number; failRate: number; avgMovesLeft: number; starSpread: [number, number, number]; firstWinCoins: number; deadBoards: number }
export function measureLevel(level: LevelDefinition, games: number, options?: BotOptions): LevelReport;
```

- [ ] **Step 1: Write failing tests in `src/tests/levelBot.test.ts`**

- `"fork plays on without touching the original"`: apply a move on the fork; `snapshot` of the original is unchanged.
- `"fork and original agree when given the same move"`: both `apply` outcomes deep-equal.
- `"the bot uses the real level seed"`: `playLevel` builds with `levelSeed(level.id)`.
- `"the bot beats random play"`: over 30 games on level 41, the fail rate is at most a random mover's.
- `"playing a level is repeatable"`: same `botSeed`, same `GameResult`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/tests/levelBot.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `SeededRNG` gains a static `fromState(state: bigint)`. `fork()` builds without running level setup (`Object.create(BoardEngine.prototype)` is fine) and deep-copies grid, progress, rng and history.
- `chooseMove`: with chance `mistakeRate` take a random valid move. Otherwise fork for each valid move, apply, and score the result, favouring goal progress, then power-ups, then board position. Exact weights are the builder's. Break ties with `rng`.
- `playLevel` plays until `isWin` or `isFail`, buys nothing, and uses no Play On. A caught `noMovesAvailable` sets `deadBoard: true` and counts as a loss.
- `firstWinCoins` uses `coinsPerLeftoverMove` and the star rule.
- `cli.ts` args: `report --levels 1-100 --games 200 --out <file>`.
- `package.json`: `"levels": "esbuild scripts/levels/cli.ts --bundle --platform=node --format=esm --outfile=.levels/cli.mjs && node .levels/cli.mjs"`. Add `.levels/` to `.gitignore`. Use worker threads across cores, because a full run can take hours.

- [ ] **Step 4: Verify the tests and write the baseline**

Run: `npx vitest run src/tests/levelBot.test.ts`, then `npm run levels -- report --levels 1-100 --games 200 --out docs/gridwatch-match/level-report-baseline.json`
Expected: PASS, then 100 rows.

- [ ] **Step 5: Commit**

```bash
git add src scripts/levels package.json .gitignore docs/gridwatch-match/level-report-baseline.json
git commit -m "feat(levels): test bot and baseline difficulty report"
```

### Task 11: Level tool

**Files:**
- Create: `scripts/levels/recipes.ts`, `scripts/levels/bands.ts`, `scripts/levels/buildLevel.ts`, `scripts/levels/tune.ts`, `scripts/levels/levelNames.ts`, `src/tests/levelTool.test.ts`
- Modify: `scripts/levels/cli.ts`, `src/engine/types.ts`

**Interfaces:**
- Consumes: `measureLevel`, `DEFAULT_BOT`.
- Produces:

```ts
// bands.ts
export function targetFailRate(levelId: number): number;
export const BAND_TOLERANCE = 0.07;

// recipes.ts
export type BoardPattern = "scattered" | "lowerRows" | "columns" | "corners" | "ring" | "centre" | "dividerRow" | "diagonals" | "mixed";
export interface SectorRecipe {
  sectorId: number;
  blockers: ("pane" | "lock" | "malware")[]; // the first is the main blocker
  pattern: BoardPattern;
  blockedCells: [number, number];
  paneLayers: [number, number];
  moves: [number, number];
}
export const sectorRecipes: SectorRecipe[];

// buildLevel.ts
export function buildLevel(recipe: SectorRecipe, levelId: number, name: string, candidateSeed: bigint): LevelDefinition;

// tune.ts
export interface TuneResult { level: LevelDefinition; report: LevelReport; inBand: boolean }
export function tuneLevel(recipe: SectorRecipe, levelId: number, name: string): TuneResult;
```

`LevelDefinition.handTuned?: boolean`.

Bands from the spec: 11-30 is 5-15%, 31-50 is 15-30%, 51-100 is 30-50%, 101-200 is 45-60%. `targetFailRate` is `min + fraction × (max − min)`, where `fraction` for position 1 to 10 in a sector is `[0.15, 0.35, 0.5, 0.35, 0.6, 0.5, 0.7, 0.6, 0.95, 1.0]`.

| Sector | Main, then others | Pattern | Blocked cells | Moves |
|---|---|---|---|---|
| 2 | pane, lock, malware | scattered | 4-8 | 24-28 |
| 3 | pane | lowerRows | 8-12 | 24-28 |
| 4 | lock | columns | 8-12 | 23-27 |
| 5 | malware, pane | corners | 6-10 | 23-27 |
| 6 | pane | ring | 12-16 | 24-28 |
| 7 | malware, lock | centre | 8-12 | 24-28 |
| 8 | lock, pane | dividerRow | 12-16 | 25-29 |
| 9 | pane, malware | diagonals | 14-18 | 25-29 |
| 10 | pane, lock, malware | mixed | 16-20 | 26-30 |
| 11-20 | Same as sector n−10, plus a second blocker if it had one | Same | 1.4× | Sector 10's range +0 to +4 |

Sector 2 brings blocker goals in one at a time: panes at level 11, locks at 14, malware at 17. Pane layers run 1 in sectors 2-3, 1-2 in 4-7, 1-3 from sector 8.

- [ ] **Step 1: Write failing tests in `src/tests/levelTool.test.ts`**

- `"no more than three levels in a row sit at the top of their band"`: over 11-200, `fraction >= 0.85` is never true four times running, and the level after a boss is below the boss.
- `"every band value is in its band"`.
- `"a built level passes the engine and has a reachable goal"`: for each recipe and three seeds, `new BoardEngine` succeeds, and pane and lock targets equal the count on the board.
- `"goals only ask for blockers on the board"`.
- `"levels below 50 have no zeroDay"`: spawn weights use four tiles under level 50 and five from 50.
- `"a boss gets a timer of 4 seconds per move, at least 60"`: every tenth level, `bossLevel` true, `bossTimerSeconds === Math.max(60, moveLimit * 4)`.
- `"sector 2 brings in one blocker goal at a time"`: 11 is panes only, 14 adds locks, 17 adds malware.
- `"recipes are sorted and sectors 2 to 20 have one each"`.
- `"100 new level names, none repeated or reused"`: against levels 1-100.
- `"a median moves step between sectors is at most 6"`, over `recipes` ranges.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/tests/levelTool.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `buildLevel` lays blockers out by pattern on a 7×7 board. `dividerRow` is a line of honeypots with `locked: true` and `tile: null`. Every level gets one blocker goal for each blocker type on the board, and may add one `collect` goal.
- `tuneLevel`: try up to 12 candidate seeds. For each, search `moveLimit` in the recipe range with 40-game measurements. Confirm with 200 games. Accept if `|failRate − target| ≤ BAND_TOLERANCE` and `deadBoards === 0`. Set `starMoves` so `three` is the 75th percentile of moves left among wins and `two` the median, keeping `0 < two < three`. Use the default stars when that cannot hold.
- `cli.ts` command `build --levels 11-200 --games 200 --out docs/gridwatch-match/level-report.json`: skip `handTuned` files, write `public/levels`, exit non-zero if any level is out of band. A second run with unchanged recipes reuses stored results where the output already matches. The report's summary line carries total first-win coins by sector.

- [ ] **Step 4: Run and commit**

Run: `npx vitest run src/tests/levelTool.test.ts && npx tsc --noEmit`
Expected: PASS.

```bash
git add scripts/levels src/tests/levelTool.test.ts src/engine/types.ts
git commit -m "feat(levels): recipes, level builder and difficulty tuner"
```

### Task 12: Build the levels and open sectors 11-20

**Files:**
- Modify: `src/data/areas.ts`, `src/App.tsx:624-630`, `src/styles.css`, `public/levels/*`, `worker/level-limits.json`, `worker/level-stars.json`, `art/gridwatch-match/qa/acceptance-probe.mjs`, `art/gridwatch-match/qa/net-check.mjs`
- Create: `public/levels/level_101.json` to `level_200.json`, `docs/gridwatch-match/level-report.json`
- Test: `src/tests/campaign.test.ts`, `tests/e2e/app.spec.ts`

- [ ] **Step 1: Write failing tests in `src/tests/campaign.test.ts`**

- `"the campaign has 200 levels in 20 sectors"`.
- `"sectors 11 to 20 repeat the first ten villains in order"`.
- Sector rewards 1,100 to 2,000 in steps of 100; names as in the spec's table; `accent`, `icon`, `theme` from the matching first-tour sector.
- `"levels 1 to 10 are byte-identical to the frozen copies"`.
- `"the server accepts a win on level 150"` (Review Focus 4): `validateSubmission` returns `ok: true` once limits are regenerated.
- `"an old save keeps its progress and is offered level 101"` (Review Focus 5): `normalizeSave` on a save with levels 1-100 won and no `blockerIntrosSeen`, then `currentArea` is sector 11.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/tests/campaign.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add sectors 11-20 to `areas.ts`**

- [ ] **Step 4: Build the levels**

Run: `npm run levels -- build --levels 11-200 --games 200 --out docs/gridwatch-match/level-report.json`
Expected: exit 0. It can take hours: run it in the background. If some levels stay out of band, change those recipes and rerun. Do not widen the tolerance.

- [ ] **Step 5: Regenerate server limits and validate**

Run: `npm run generate:level-limits && npm run validate:levels`
Expected: 200 levels, 0 failed.

- [ ] **Step 6: Add the sector heading**

In `AreasScreen`, add a heading before sector 11 with the text `The Return`. This is a designer's draft label.

- [ ] **Step 7: Fix tests pinned to old levels**

Levels 34 and 100 are opened by `art/gridwatch-match/qa/acceptance-probe.mjs:44,124` and `art/gridwatch-match/qa/net-check.mjs:10`. Point each at its intent: a fixture level, or the new board. Do not weaken what it asserts. Add `"level 150 opens and can be won"` to `tests/e2e/app.spec.ts` using test mode.

- [ ] **Step 8: Verify and commit**

Run: `npm test && npm run build`
Expected: all pass.

```bash
git add -A public/levels worker src tests art/gridwatch-match/qa docs/gridwatch-match
git commit -m "feat(levels): 200 levels, sectors 11 to 20"
npm run cf:dev-instance
```

### Task 13: Calibrate with Russ

**Files:**
- Modify: `scripts/levels/bot.ts` (`DEFAULT_BOT`), `public/levels/*`, `worker/level-*.json`, `HANDOFF.md`
- Create: `docs/gridwatch-match/calibration-2026-11.md`

- [ ] **Step 1: Pick the sample**

Choose 12 levels across the bands, at least three of them bosses, including one each from 11-30, 31-50 and 51-100, and the rest from 101-200. Include one level of each main blocker. Give Russ the list with dev-site links. Russ plays each on a phone on first sight and reports win or lose and moves left.

- [ ] **Step 2: Compare**

Write Russ's results beside the bot's fail rate and moves left in `calibration-2026-11.md`. One player is a correction, not proof.

- [ ] **Step 3: Adjust**

If Russ wins clearly more than the bot, lower `mistakeRate`. If clearly less, raise it. Rebuild with `npm run levels -- build --levels 11-200 --games 200 --out docs/gridwatch-match/level-report.json`, then `npm run generate:level-limits`.

- [ ] **Step 4: Bring Russ the coin numbers**

From the report's summary line, tell Russ what a campaign now earns against the power-up prices (100, 100, 150, 200, 300) and Play On (500). Price changes are Russ's decision. Do not change prices without one.

- [ ] **Step 5: Review boss timers**

Russ reports on the three boss levels played. If timers beat the player more than the moves did, change the formula with Russ, and update the Task 11 test.

- [ ] **Step 6: Commit and refresh the dev site**

```bash
git add -A scripts/levels public/levels worker docs/gridwatch-match HANDOFF.md
git commit -m "feat(levels): calibrate the test bot against real play"
npm run cf:dev-instance
```

### Task 14: Portraits in, final checks

Waits for Russ's five portraits. Russ generates them from `docs/art/2026-11-02-villain-portrait-prompts.md`, into `GridWatchArt/4 - GridWatch Match/`.

**Files:**
- Modify: `public/assets/images/villains/{Dread,Vyrus,Shard,Lotus,Malus}.png`, `HANDOFF.md`, `docs/gridwatch-match/README.md`, `AGENTS.md`
- Test: `src/tests/campaign.test.ts`

- [ ] **Step 1: Write the failing ship-gate test**

```ts
it("gives all ten villains their own portrait", () => {
  const hashes = new Set(areas.slice(0, 10).map((area) => sha256(portraitBytes(area))));
  expect(hashes.size).toBe(10);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/tests/campaign.test.ts -t "own portrait"`
Expected: FAIL, the placeholders match.

- [ ] **Step 3: Copy the portraits in**

Look at each one first: square, no text, face-on. Resize to at most 1024×1024 with `sips -Z 1024`. Copy to `public/assets/images/villains/` under the names above.

- [ ] **Step 4: Update the docs**

`HANDOFF.md`: implementation, verification and acceptance as separate entries. `docs/gridwatch-match/README.md` and `AGENTS.md`: the web game no longer follows iOS, levels come from `npm run levels`.

- [ ] **Step 5: Full verification**

Run: `npm run validate:levels && npm test && npm audit --audit-level=high && npm run build`, then `CI=1 npm run test:e2e`, then the classic command from Global Constraints.
Expected: all pass. Read the results, including skipped counts.

- [ ] **Step 6: Commit, then stop for Russ's phone check**

```bash
git add -A public/assets/images/villains src docs HANDOFF.md AGENTS.md
git commit -m "feat(art): five new villain portraits, campaign ready for review"
npm run cf:dev-instance
```

Russ checks the dev site on a phone. Pushing, the PR, merging and production wait for Russ's word. The score server must go live with the levels, and the production deploy procedure is in `HANDOFF.md`.
