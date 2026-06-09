# Motion Graphics Parity Implementation Plan

> **For agentic workers:** Execute task by task. Each task has TDD steps (write failing test → run → implement → run → commit). Do not skip tests. Do not batch commits. After each task, stop and verify the test suite is green before moving on. If anything fails or is ambiguous, stop and ask.

**Goal:** Close the motion-feel gap between the web port and the iOS Swift reference for cascade, spawn, match pop, invalid bounce, drag lift, and swap commit threshold. The current code is functionally correct; this plan changes how motion looks and feels without changing any engine logic or test fixtures.

**Architecture:**
- New pure-TS module `src/game/motion.ts` holds three reusable helpers: a centroid-distance stagger calculator, a post-clear pre-cascade snapshot builder, and a seeded angle-jitter function. All three are unit-tested in isolation under `src/tests/motion.test.ts`.
- `src/game/BoardScene.ts` is modified to (a) animate the **real occupant containers** for cascade and spawn (currently it tweens fading ghost sprites while the destination is already painted, which reads as smeared trails), (b) stagger match pops by centroid distance, (c) replace the single-tween invalid-swap snap-back with a two-phase stretch+settle, (d) tween the drag lift instead of jumping, (e) raise the swap commit threshold to match iOS weight.
- The engine, asset manifest, level data, persistence, and React UI are **not touched**.

**Tech Stack:** TypeScript, Phaser 3 tweens, Vitest for unit tests, Playwright for e2e regression.

**Reference:** Consult the iOS `BoardNode.swift` methods `animateClears`, `animateMoves`, `animateSpawns`, `animateInvalidSwapBounceBack`, `springyReturnAction`, and `polishedSwapAction` for behavioral parity. Do **not** import from the iOS repo or modify it.

**Hard constraints (from `AGENTS.md` and `MEMORY.md`):**
- `src/engine` stays renderer-free; do not import Phaser/DOM/React there.
- Do not change engine, level JSON, or asset manifest.
- Do not introduce secrets, `.env`, Firebase private files, or backend.
- Keep `npm run test` (115 tests baseline) and `npm run test:e2e` (20 tests baseline) green.
- Persist serializable app state only.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/game/motion.ts` | Create | Pure helpers: centroid stagger, post-clear snapshot, seeded jitter |
| `src/tests/motion.test.ts` | Create | Vitest unit tests for the three helpers |
| `src/game/BoardScene.ts` | Modify | Wire helpers in; add real-sprite cascade method; replace ghost paths |

No other files should change. If you find you need to modify the engine, the React app, level JSON, or anything in `public/`, **stop and ask** — that is a signal the plan is wrong, not a license to extend scope.

---

## Task 1: Add `computeCentroidStagger` to `motion.ts`

Pure function that mimics iOS `animateClears` line 609 — tiles farther from the match's centroid pop later.

**Files:**
- Create: `src/game/motion.ts`
- Create: `src/tests/motion.test.ts`

- [ ] **Step 1.1: Write the failing test**

Append to `src/tests/motion.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeCentroidStagger } from "../game/motion";

describe("computeCentroidStagger", () => {
  it("returns an empty map for no positions", () => {
    const result = computeCentroidStagger([], { perUnitMs: 20, maxMs: 100 });
    expect(result.size).toBe(0);
  });

  it("gives a single position zero delay", () => {
    const result = computeCentroidStagger(
      [{ row: 3, col: 3 }],
      { perUnitMs: 20, maxMs: 100 }
    );
    expect(result.get("3,3")).toBe(0);
  });

  it("orders three collinear positions by distance from centroid", () => {
    const result = computeCentroidStagger(
      [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }],
      { perUnitMs: 30, maxMs: 200 }
    );
    // centroid is (0,1); distances are 1, 0, 1
    expect(result.get("0,1")).toBe(0);
    expect(result.get("0,0")).toBe(30);
    expect(result.get("0,2")).toBe(30);
  });

  it("clamps to maxMs", () => {
    const result = computeCentroidStagger(
      [{ row: 0, col: 0 }, { row: 0, col: 10 }],
      { perUnitMs: 100, maxMs: 75 }
    );
    expect(result.get("0,0")).toBe(75);
    expect(result.get("0,10")).toBe(75);
  });
});
```

- [ ] **Step 1.2: Run the test and verify it fails**

Run: `npm run test -- src/tests/motion.test.ts`
Expected: FAIL — `Cannot find module '../game/motion'`.

- [ ] **Step 1.3: Implement `computeCentroidStagger`**

Create `src/game/motion.ts`:

```ts
import type { GridPosition } from "../engine";

export interface CentroidStaggerOptions {
  perUnitMs: number;
  maxMs: number;
}

/**
 * Per-position pop delay keyed by `${row},${col}`. Positions near the group's
 * centroid get smaller delays so the pop reads as a wave radiating outward.
 * Mirrors iOS BoardNode.swift `animateClears` centroid-distance delay.
 */
export function computeCentroidStagger(
  positions: ReadonlyArray<GridPosition>,
  options: CentroidStaggerOptions
): Map<string, number> {
  const result = new Map<string, number>();
  if (positions.length === 0) return result;
  let sumRow = 0;
  let sumCol = 0;
  for (const p of positions) {
    sumRow += p.row;
    sumCol += p.col;
  }
  const centroidRow = sumRow / positions.length;
  const centroidCol = sumCol / positions.length;
  for (const p of positions) {
    const distance = Math.hypot(p.row - centroidRow, p.col - centroidCol);
    const delay = Math.min(options.maxMs, Math.round(distance * options.perUnitMs));
    result.set(`${p.row},${p.col}`, delay);
  }
  return result;
}
```

- [ ] **Step 1.4: Run the test and verify it passes**

Run: `npm run test -- src/tests/motion.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 1.5: Commit**

```bash
git add src/game/motion.ts src/tests/motion.test.ts
git commit -m "Add centroid stagger helper for match pops"
```

---

## Task 2: Add `seededAngleJitter` to `motion.ts`

Replace `Phaser.Math.Between(-10, 10)` non-determinism in match pops with a deterministic per-position seeded variant — keeps the visual variety but makes Playwright frames reproducible.

**Files:**
- Modify: `src/game/motion.ts`
- Modify: `src/tests/motion.test.ts`

- [ ] **Step 2.1: Write the failing test**

Append to `src/tests/motion.test.ts`:

```ts
import { seededAngleJitter } from "../game/motion";

describe("seededAngleJitter", () => {
  it("returns the same value for the same (position, seed)", () => {
    const a = seededAngleJitter({ row: 2, col: 5 }, "abc", 12);
    const b = seededAngleJitter({ row: 2, col: 5 }, "abc", 12);
    expect(a).toBe(b);
  });

  it("differs across positions for a fixed seed", () => {
    const a = seededAngleJitter({ row: 0, col: 0 }, "seed", 20);
    const b = seededAngleJitter({ row: 0, col: 1 }, "seed", 20);
    expect(a).not.toBe(b);
  });

  it("stays within [-amplitude, +amplitude]", () => {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const v = seededAngleJitter({ row: r, col: c }, "x", 15);
        expect(v).toBeGreaterThanOrEqual(-15);
        expect(v).toBeLessThanOrEqual(15);
      }
    }
  });
});
```

- [ ] **Step 2.2: Run and verify it fails**

Run: `npm run test -- src/tests/motion.test.ts`
Expected: FAIL on the new `seededAngleJitter` import.

- [ ] **Step 2.3: Implement `seededAngleJitter`**

Append to `src/game/motion.ts`:

```ts
/**
 * Deterministic angle (degrees) in [-amplitude, +amplitude] derived from a
 * position + seed. Used in place of Phaser.Math.Between so Playwright snapshots
 * of pop animations stay reproducible.
 */
export function seededAngleJitter(
  position: GridPosition,
  seed: string,
  amplitudeDeg: number
): number {
  let hash = 2166136261 >>> 0; // FNV-1a basis
  const input = `${seed}|${position.row},${position.col}`;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const normalized = (hash / 0xffffffff) * 2 - 1; // [-1, 1]
  return normalized * amplitudeDeg;
}
```

- [ ] **Step 2.4: Run and verify**

Run: `npm run test -- src/tests/motion.test.ts`
Expected: PASS, 7 tests total.

- [ ] **Step 2.5: Commit**

```bash
git add src/game/motion.ts src/tests/motion.test.ts
git commit -m "Add seeded angle jitter for deterministic pop animations"
```

---

## Task 3: Add `buildPostClearSnapshot` to `motion.ts`

This is the keystone for Task 6. It produces the visual board state **after clears but before cascade** so we can render it and then animate the real movers downward.

**Files:**
- Modify: `src/game/motion.ts`
- Modify: `src/tests/motion.test.ts`

- [ ] **Step 3.1: Write the failing test**

Append to `src/tests/motion.test.ts`:

```ts
import { buildPostClearSnapshot } from "../game/motion";
import { Grid2D } from "../engine/grid";
import type { BoardSnapshot, CellState } from "../engine";

function emptyCell(): CellState {
  return {
    baseTile: null,
    powerUp: null,
    overlay: null,
    underlay: null,
    generator: null,
    isMovable: true,
    debugTileId: null,
    debugDesignLocked: false
  };
}

function tileCell(baseTile: CellState["baseTile"]): CellState {
  return { ...emptyCell(), baseTile };
}

function snapshotOf(grid: Grid2D<CellState>): BoardSnapshot {
  return {
    grid,
    moveCount: 0,
    moveLimit: 30,
    objectiveProgress: {},
    objectiveTargets: {},
    spawnWeights: { packet: 1, firewall: 1, key: 1, threat: 1, zeroDay: 1 },
    rngSeed: "1",
    chainDepth: 0
  };
}

describe("buildPostClearSnapshot", () => {
  it("empties only the popped positions and preserves the rest", () => {
    const grid = new Grid2D<CellState>(3, 3, () => tileCell("packet"));
    grid.set({ row: 1, col: 1 }, tileCell("firewall"));
    const snap = snapshotOf(grid);

    const popped = new Set<string>(["0,0", "0,1", "0,2"]);
    const result = buildPostClearSnapshot(snap, popped);

    expect(result.grid.get({ row: 0, col: 0 }).baseTile).toBeNull();
    expect(result.grid.get({ row: 0, col: 1 }).baseTile).toBeNull();
    expect(result.grid.get({ row: 0, col: 2 }).baseTile).toBeNull();
    expect(result.grid.get({ row: 1, col: 1 }).baseTile).toBe("firewall");
    expect(result.grid.get({ row: 2, col: 2 }).baseTile).toBe("packet");
  });

  it("preserves generator, overlay, underlay, and isMovable on popped cells", () => {
    const grid = new Grid2D<CellState>(2, 2, () => tileCell("packet"));
    grid.set({ row: 0, col: 0 }, {
      ...tileCell("packet"),
      generator: "honeypot",
      overlay: { kind: "encryptedVolume", hp: 2 },
      underlay: { kind: "malwarePropagation", hp: 1 },
      isMovable: false
    });
    const snap = snapshotOf(grid);

    const result = buildPostClearSnapshot(snap, new Set(["0,0"]));
    const cell = result.grid.get({ row: 0, col: 0 });
    expect(cell.baseTile).toBeNull();
    expect(cell.powerUp).toBeNull();
    expect(cell.generator).toBe("honeypot");
    expect(cell.overlay).toEqual({ kind: "encryptedVolume", hp: 2 });
    expect(cell.underlay).toEqual({ kind: "malwarePropagation", hp: 1 });
    expect(cell.isMovable).toBe(false);
  });

  it("does not mutate the input grid", () => {
    const grid = new Grid2D<CellState>(2, 2, () => tileCell("packet"));
    const snap = snapshotOf(grid);
    buildPostClearSnapshot(snap, new Set(["0,0"]));
    expect(snap.grid.get({ row: 0, col: 0 }).baseTile).toBe("packet");
  });
});
```

- [ ] **Step 3.2: Run and verify failure**

Run: `npm run test -- src/tests/motion.test.ts`
Expected: FAIL on missing `buildPostClearSnapshot`.

- [ ] **Step 3.3: Implement**

Append to `src/game/motion.ts`:

```ts
import { cloneCell, type BoardSnapshot } from "../engine";

/**
 * Returns a snapshot equal to `source` but with every position in `poppedKeys`
 * stripped of its baseTile and powerUp (clears do not remove the cell's
 * generator/overlay/underlay/isMovable, matching engine semantics).
 *
 * Caller uses this as the visual "after clears, before cascade" state so that
 * real occupant containers can animate from their original cells down into the
 * post-cascade arrangement instead of materializing as ghosts.
 */
export function buildPostClearSnapshot(
  source: BoardSnapshot,
  poppedKeys: ReadonlySet<string>
): BoardSnapshot {
  const grid = source.grid.clone(cloneCell);
  for (const key of poppedKeys) {
    const [rowStr, colStr] = key.split(",");
    const position = { row: Number(rowStr), col: Number(colStr) };
    if (!grid.isValid(position)) continue;
    const cell = grid.get(position);
    grid.set(position, { ...cell, baseTile: null, powerUp: null });
  }
  return { ...source, grid };
}
```

- [ ] **Step 3.4: Run and verify**

Run: `npm run test -- src/tests/motion.test.ts`
Expected: PASS, 10 tests total.

- [ ] **Step 3.5: Commit**

```bash
git add src/game/motion.ts src/tests/motion.test.ts
git commit -m "Add post-clear snapshot builder for real-sprite cascade"
```

---

## Task 4: Wire centroid stagger into `playTilePops`

Mimics iOS centroid-distance delay so pops radiate outward instead of all firing at once.

**Files:**
- Modify: `src/game/BoardScene.ts` (the `playTilePops` method, lines 471-519)

- [ ] **Step 4.1: Import the helper**

At the top of `BoardScene.ts`, add to the existing import block from local files:

```ts
import { computeCentroidStagger } from "./motion";
```

- [ ] **Step 4.2: Modify `playTilePops`**

Replace the body of `playTilePops` (currently `BoardScene.ts:471-519`) with this. Note the new `stagger` computation, the per-object `delayedCall` wrapping the tween chain, and the unchanged completion bookkeeping:

```ts
private playTilePops(sourceSnapshot: BoardSnapshot, popKeys: Set<string>, onComplete: () => void): void {
  if (!this.fxLayer || popKeys.size === 0) {
    onComplete();
    return;
  }

  this.snapshot = sourceSnapshot;
  this.renderSnapshot(popKeys);
  const positions: GridPosition[] = [];
  for (const position of sourceSnapshot.grid.allPositions) {
    if (popKeys.has(positionKey(position))) positions.push(position);
  }

  const stagger = computeCentroidStagger(positions, { perUnitMs: 28, maxMs: 110 });
  const popObjects: { object: Phaser.GameObjects.Container; delay: number; position: GridPosition }[] = [];
  for (const position of positions) {
    const object = this.addOccupant(position, sourceSnapshot.grid.get(position), this.fxLayer, 1);
    if (!object) continue;
    const delay = stagger.get(positionKey(position)) ?? 0;
    popObjects.push({ object, delay, position });
    this.flashCell(position, 0xf7d154, motionTiming.matchPop + motionTiming.matchPopAnticipation);
  }

  if (popObjects.length === 0) {
    onComplete();
    return;
  }

  let remaining = popObjects.length;
  const seed = this.snapshot?.rngSeed ?? "0";
  for (const entry of popObjects) {
    const angle = entry.object.angle + seededAngleJitter(entry.position, seed, 10);
    const startPop = () => {
      this.tweens.add({
        targets: entry.object,
        scaleX: 1.18,
        scaleY: 1.18,
        duration: motionTiming.matchPopAnticipation,
        ease: "Back.easeOut",
        onComplete: () => {
          this.tweens.add({
            targets: entry.object,
            alpha: 0,
            scaleX: 0.12,
            scaleY: 0.12,
            angle,
            duration: motionTiming.matchPop,
            ease: "Back.easeIn",
            onComplete: () => {
              entry.object.destroy();
              remaining -= 1;
              if (remaining === 0) onComplete();
            }
          });
        }
      });
    };
    if (entry.delay > 0) this.time.delayedCall(entry.delay, startPop);
    else startPop();
  }
}
```

- [ ] **Step 4.3: Update the import to include `seededAngleJitter`**

Change the import added in Step 4.1 to:

```ts
import { computeCentroidStagger, seededAngleJitter } from "./motion";
```

- [ ] **Step 4.4: Run the full unit + e2e suite**

Run:
```bash
npm run test
npm run test:e2e
```
Expected: PASS at the same counts as baseline (115 unit, 20 e2e).

If any e2e test fails because of the added stagger delay extending total animation budget, increase ONLY the relevant `await` timeout in `tests/e2e/app.spec.ts`. Do not weaken assertions. The maximum added budget per pop wave is 110ms — well within Playwright defaults.

- [ ] **Step 4.5: Commit**

```bash
git add src/game/BoardScene.ts
git commit -m "Stagger match pops by centroid distance"
```

---

## Task 5: Two-phase invalid swap bounce-back

Replace the single-tween snap-back (current `BoardScene.ts:372-391`) with a stretch + settle two-phase tween that matches iOS `springyReturnAction`.

**Files:**
- Modify: `src/game/BoardScene.ts` (the `playInvalidAnimation` primary path)

- [ ] **Step 5.1: Add a new motionTiming entry**

In the `motionTiming` const (currently `BoardScene.ts:96-110`), replace `snapBack: 150` with these two entries (order does not matter):

```ts
invalidStretch: 70,
invalidSettle: 60,
snapBack: 150,
```

Keep `snapBack` — it is still used by the cancelled-mid-drag path (`snapBackDrag`) and is correct there.

- [ ] **Step 5.2: Replace the primary-path tween block**

In `playInvalidAnimation`, find the block that currently reads (around lines 372-391):

```ts
this.tweens.add({
  targets: drag.sprite,
  x: drag.startCenter.x,
  y: drag.startCenter.y,
  scaleX: 1,
  scaleY: 1,
  duration: motionTiming.snapBack,
  ease: "Sine.easeOut",
  onComplete: done
});
if (neighbor) {
  this.tweens.add({
    targets: neighbor.sprite,
    x: neighbor.home.x,
    y: neighbor.home.y,
    duration: motionTiming.snapBack,
    ease: "Sine.easeOut",
    onComplete: done
  });
}
```

Replace it with a two-phase stretch + settle. Each sprite first overshoots its home by 2.5% of `tileSize` along the drag axis (compressed perpendicular), then settles back to home with no scale offset.

```ts
const startBounce = (
  sprite: Phaser.GameObjects.Container,
  home: { x: number; y: number },
  travelX: number,
  travelY: number
) => {
  const overshoot = this.tileSize * 0.025;
  const axisX = travelX !== 0 ? Math.sign(travelX) : 0;
  const axisY = travelY !== 0 ? Math.sign(travelY) : 0;
  const overshootX = home.x - axisX * overshoot;
  const overshootY = home.y - axisY * overshoot;
  this.tweens.add({
    targets: sprite,
    x: overshootX,
    y: overshootY,
    scaleX: axisX !== 0 ? 0.94 : 1,
    scaleY: axisY !== 0 ? 0.94 : 1,
    duration: motionTiming.invalidStretch,
    ease: "Sine.easeOut",
    onComplete: () => {
      this.tweens.add({
        targets: sprite,
        x: home.x,
        y: home.y,
        scaleX: 1,
        scaleY: 1,
        duration: motionTiming.invalidSettle,
        ease: "Sine.easeInOut",
        onComplete: done
      });
    }
  });
};

const dragTravelX = drag.sprite.x - drag.startCenter.x;
const dragTravelY = drag.sprite.y - drag.startCenter.y;
startBounce(drag.sprite, drag.startCenter, dragTravelX, dragTravelY);
if (neighbor) {
  const nbTravelX = neighbor.sprite.x - neighbor.home.x;
  const nbTravelY = neighbor.sprite.y - neighbor.home.y;
  startBounce(neighbor.sprite, neighbor.home, nbTravelX, nbTravelY);
}
```

- [ ] **Step 5.3: Verify the e2e suite is still green**

Run:
```bash
npm run test:e2e
```
Expected: PASS, 20 tests. Total invalid-bounce duration is 130ms (was 150ms) so timing budgets only shrink.

- [ ] **Step 5.4: Commit**

```bash
git add src/game/BoardScene.ts
git commit -m "Two-phase stretch+settle on invalid swap bounce-back"
```

---

## Task 6: Real-sprite cascade and spawn (`playCascadeAndSpawn`)

The architectural fix. Currently `playDeltaEffects` calls `playMoveGhost` per move and per spawn — these create ghost sprites that fade to `alpha: 0` while the destination tile is already painted by the prior `renderSnapshot(nextSnapshot)`. This is the root cause of the smeared-trail feel.

The new path: render the post-clear snapshot first (movers are at their FROM, spawns are absent), animate the **real occupant containers** down to their destinations with a two-phase fall+settle curve, then render `nextSnapshot` on completion.

**Files:**
- Modify: `src/game/BoardScene.ts`

- [ ] **Step 6.1: Add `cascadeFall` and `cascadeSettle` timing entries**

In `motionTiming` (currently `BoardScene.ts:96-110`), add two entries (place above `cascadeMove`, which we keep for back-compat):

```ts
cascadeFall: 0.78,        // fraction of total (easeIn phase)
cascadeSettle: 0.22,      // fraction of total (easeOut phase)
cascadeMove: 340,
```

Both new entries are unitless fractions; leave `cascadeMove` and `spawnMove` numeric milliseconds for total duration.

- [ ] **Step 6.2: Import the snapshot helper**

Update the existing motion import to:

```ts
import { buildPostClearSnapshot, computeCentroidStagger, seededAngleJitter } from "./motion";
```

- [ ] **Step 6.3: Add `playCascadeAndSpawn`**

Insert the following method **before** `playMoveGhost` (so it sits near related code; do not delete `playMoveGhost` yet — Task 7 wires the new method in and the old one stays as the no-op-after fallback for the non-swap path until Step 7.4):

```ts
private playCascadeAndSpawn(
  postClearSnapshot: BoardSnapshot,
  nextSnapshot: BoardSnapshot,
  delta: BoardDelta,
  onComplete: () => void
): void {
  if (this.reducedMotion) {
    this.snapshot = nextSnapshot;
    this.renderSnapshot();
    onComplete();
    return;
  }

  this.snapshot = postClearSnapshot;
  // Hide the destination cells of all moves/spawns so renderSnapshot leaves them
  // empty — the real (for moves) or freshly-created (for spawns) sprites will
  // settle into them at the end of their tweens.
  const destinationKeys = new Set<string>();
  for (const move of delta.moves) destinationKeys.add(positionKey(move.to));
  for (const spawn of delta.spawns) destinationKeys.add(positionKey(spawn.position));
  this.renderSnapshot(destinationKeys, false);

  const moveTweens: { sprite: Phaser.GameObjects.Container; to: { x: number; y: number } }[] = [];
  for (const move of delta.moves) {
    const sprite = this.occupantNodes.get(positionKey(move.from));
    if (!sprite) continue;
    this.layer?.bringToTop(sprite);
    moveTweens.push({ sprite, to: this.cellCenter(move.to) });
    // Reattach under the destination key so subsequent renders find it.
    this.occupantNodes.delete(positionKey(move.from));
    this.occupantNodes.set(positionKey(move.to), sprite);
  }

  const spawnTweens: { sprite: Phaser.GameObjects.Container; to: { x: number; y: number } }[] = [];
  for (const spawn of delta.spawns) {
    if (!this.layer) continue;
    const targetCell = nextSnapshot.grid.get(spawn.position);
    const startX = this.cellCenter(spawn.position).x;
    const startY = this.boardBounds.y - this.tileSize * 0.5;
    const sprite = this.addOccupantAt(startX, startY, targetCell, this.layer, 0);
    if (!sprite) continue;
    this.tweens.add({ targets: sprite, alpha: 1, duration: Math.min(110, motionTiming.spawnMove * 0.3) });
    spawnTweens.push({ sprite, to: this.cellCenter(spawn.position) });
    this.occupantNodes.set(positionKey(spawn.position), sprite);
  }

  const allTweens = [
    ...moveTweens.map((t) => ({ ...t, total: motionTiming.cascadeMove })),
    ...spawnTweens.map((t) => ({ ...t, total: motionTiming.spawnMove }))
  ];

  if (allTweens.length === 0) {
    this.snapshot = nextSnapshot;
    this.renderSnapshot();
    onComplete();
    return;
  }

  let remaining = allTweens.length;
  const done = () => {
    remaining -= 1;
    if (remaining === 0) {
      this.snapshot = nextSnapshot;
      this.renderSnapshot();
      onComplete();
    }
  };

  for (const entry of allTweens) {
    const start = { x: entry.sprite.x, y: entry.sprite.y };
    const fallDuration = Math.max(40, Math.round(entry.total * motionTiming.cascadeFall));
    const settleDuration = Math.max(20, Math.round(entry.total * motionTiming.cascadeSettle));
    const bounceFromY = entry.to.y + Math.min(14, Math.abs(entry.to.y - start.y) * 0.08);
    this.tweens.add({
      targets: entry.sprite,
      x: entry.to.x,
      y: bounceFromY,
      scaleX: 0.96,
      scaleY: 1.05,
      duration: fallDuration,
      ease: "Sine.easeIn",
      onComplete: () => {
        this.tweens.add({
          targets: entry.sprite,
          x: entry.to.x,
          y: entry.to.y,
          scaleX: 1,
          scaleY: 1,
          duration: settleDuration,
          ease: "Sine.easeOut",
          onComplete: done
        });
      }
    });
  }
}
```

- [ ] **Step 6.4: Add an overload to `renderSnapshot` parameter signature comment**

The existing `renderSnapshot` already takes `(hiddenPositions, clearFx)`. No change needed — verify the second arg is supported by re-reading lines 192-211. If you find it does not accept the second argument, stop and ask.

- [ ] **Step 6.5: Run the full suite**

Run:
```bash
npm run test
npm run test:e2e
```
Expected: PASS at baseline counts. The new method is not yet wired in, so behavior is unchanged.

- [ ] **Step 6.6: Commit**

```bash
git add src/game/BoardScene.ts
git commit -m "Add real-sprite cascade+spawn animator (unwired)"
```

---

## Task 7: Wire `playCascadeAndSpawn` into the resolved path; drop ghost cascade

Replaces the ghost-move and ghost-spawn branches of `playDeltaEffects` and rewires `playPostSwapMatchResolution` plus the non-swap branch of `playResolvedAnimation` to use the new method. `flashCell` for clears and `playPowerUpEffect` for power-ups stay in `playDeltaEffects`.

**Files:**
- Modify: `src/game/BoardScene.ts`

- [ ] **Step 7.1: Update `playPostSwapMatchResolution`**

Replace the current body (lines 322-334) with:

```ts
private playPostSwapMatchResolution(postSwapSnapshot: BoardSnapshot, nextSnapshot: BoardSnapshot, delta: BoardDelta): void {
  this.snapshot = postSwapSnapshot;
  this.renderSnapshot();
  const popKeys = initialMatchKeys(postSwapSnapshot);
  this.time.delayedCall(motionTiming.matchLock, () => {
    this.playTilePops(postSwapSnapshot, popKeys, () => {
      const postClear = buildPostClearSnapshot(postSwapSnapshot, popKeys);
      this.playCascadeAndSpawn(postClear, nextSnapshot, delta, () => {
        this.playDeltaEffects(delta, popKeys);
        this.finishAnimation();
      });
    });
  });
}
```

- [ ] **Step 7.2: Update the non-swap branch of `playResolvedAnimation`**

Find the tail of `playResolvedAnimation` (lines 315-320):

```ts
this.hardClearDrag();
this.snapshot = nextSnapshot;
this.renderSnapshot();
this.playDeltaEffects(animation.delta);
this.finishAnimation();
```

Replace with a path that animates cascades when the engine produced them, and falls back to a direct render otherwise:

```ts
this.hardClearDrag();
const delta = animation.delta;
if (delta.moves.length === 0 && delta.spawns.length === 0) {
  this.snapshot = nextSnapshot;
  this.renderSnapshot();
  this.playDeltaEffects(delta);
  this.finishAnimation();
  return;
}
// Use the current snapshot as the "post-clear" baseline. For tap/booster paths
// there were no clears in this delta tick, so post-clear equals current.
const baseline = this.snapshot ?? nextSnapshot;
const postClear = buildPostClearSnapshot(baseline, new Set());
this.playCascadeAndSpawn(postClear, nextSnapshot, delta, () => {
  this.playDeltaEffects(delta);
  this.finishAnimation();
});
```

- [ ] **Step 7.3: Strip moves/spawns from `playDeltaEffects`**

In `playDeltaEffects` (lines 457-469), remove the two ghost-driving loops. Final body:

```ts
private playDeltaEffects(delta: BoardDelta, skipClearKeys = new Set<string>()): void {
  if (this.reducedMotion) return;
  for (const event of delta.powerUpEvents) this.playPowerUpEffect(event);
  for (const clear of delta.clears) {
    if (!skipClearKeys.has(positionKey(clear.position))) {
      this.flashCell(clear.position, clear.clearedByPowerUp ? 0x9bfff2 : 0xf7d154, motionTiming.clearFlash);
    }
  }
}
```

- [ ] **Step 7.4: Delete the now-unused `playMoveGhost` method**

Remove the entire `playMoveGhost` method (lines 521-539). It is no longer called.

If you find a remaining call site to `playMoveGhost`, stop and ask — the wiring in Steps 7.1-7.3 should have removed all of them.

- [ ] **Step 7.5: Run the full suite**

Run:
```bash
npm run test
npm run test:e2e
```
Expected: PASS at baseline counts.

If `npm run test:e2e` times out on a cascade-heavy scenario, the issue is most likely total animation duration. Confirm: `motionTiming.cascadeMove` is 340ms and `motionTiming.spawnMove` is 390ms — unchanged from before. If a test still fails, stop and report which assertion failed; do not edit assertion thresholds without confirmation.

- [ ] **Step 7.6: Manual browser smoke test**

Run:
```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
```
Open http://127.0.0.1:4173/GridWatchMatchWeb/ in a desktop browser. Play one or two swaps on level 1 and observe:
- Matched tiles pop with a visible centroid wave (closest first).
- Tiles **above** the cleared cells drop down — they should be the same tiles, not ghost trails.
- New tiles enter from above the board and settle into the top row(s).

You do not need to take a screenshot. Just verify the three behaviors with your eyes. If any of them looks wrong, stop and report.

- [ ] **Step 7.7: Commit**

```bash
git add src/game/BoardScene.ts
git commit -m "Use real sprites for cascade and spawn"
```

---

## Task 8: Drag-lift anticipation tween

Replace the cold `setScale(1.06)` in `handlePointerDown` with a brief tween-in so the pickup has the same anticipation curve as iOS.

**Files:**
- Modify: `src/game/BoardScene.ts` (`handlePointerDown` lines 740-769)

- [ ] **Step 8.1: Add a `dragLift` motionTiming entry**

In `motionTiming`, add:

```ts
dragLift: 80,
```

- [ ] **Step 8.2: Replace the static `setScale` with a tween**

Find this block in `handlePointerDown` (around lines 754-755):

```ts
this.layer.bringToTop(sprite);
sprite.setScale(1.06);
```

Replace with:

```ts
this.layer.bringToTop(sprite);
sprite.setScale(1);
if (this.reducedMotion) {
  sprite.setScale(1.06);
} else {
  this.tweens.add({
    targets: sprite,
    scaleX: 1.06,
    scaleY: 1.06,
    duration: motionTiming.dragLift,
    ease: "Sine.easeOut"
  });
}
```

- [ ] **Step 8.3: Run the e2e suite**

Run: `npm run test:e2e`
Expected: PASS, 20 tests. The lift tween is 80ms, well under any Playwright wait threshold.

- [ ] **Step 8.4: Commit**

```bash
git add src/game/BoardScene.ts
git commit -m "Tween the drag lift in for anticipation"
```

---

## Task 9: Bump swap commit threshold to match iOS weight

iOS requires `tileSize * 0.5` of travel before committing a swap; the web port currently uses `0.32`, which makes swaps feel light.

**Files:**
- Modify: `src/game/BoardScene.ts` (`intentFromDelta` line 943)

- [ ] **Step 9.1: Change the threshold constant**

In `intentFromDelta`, find:

```ts
const threshold = this.tileSize * 0.32;
```

Replace with:

```ts
const threshold = this.tileSize * 0.45;
```

(Use 0.45, not 0.5 — the web pointer-up event fires after the gesture is already moving, so 0.45 reads as iOS-weighty without feeling sticky on touch.)

- [ ] **Step 9.2: Run the e2e suite — pay attention to drag tests**

Run: `npm run test:e2e`
Expected: PASS at 20. The deterministic level-1 drag test in `tests/e2e/app.spec.ts` already drags well past 0.5 of a cell, so it stays green. If it fails, the test was relying on the old loose threshold; report the specific assertion before changing anything.

- [ ] **Step 9.3: Commit**

```bash
git add src/game/BoardScene.ts
git commit -m "Raise swap commit threshold to match iOS weight"
```

---

## Task 10: Final verification + handoff doc update

**Files:**
- Modify: `HANDOFF.md`

- [ ] **Step 10.1: Run the full local verification gate**

Run, in order:

```bash
npm run test
npm run test:e2e
npm run validate:levels
npm run build
npm audit --audit-level=high
```

Expected:
- `npm run test`: PASS, 115 + 10 motion = 125 tests (or close — if the count is wrong by more than 2 either way, stop and report).
- `npm run test:e2e`: PASS, 20.
- `npm run validate:levels`: PASS, 100.
- `npm run build`: PASS.
- `npm audit --audit-level=high`: PASS, 0 vulnerabilities.

- [ ] **Step 10.2: Update HANDOFF.md**

Replace the `Latest Work Completed` and `Verification` sections of `HANDOFF.md` with:

```markdown
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
```

Leave the rest of `HANDOFF.md` unchanged.

- [ ] **Step 10.3: Final commit**

```bash
git add HANDOFF.md
git commit -m "Update handoff for motion-parity work"
```

- [ ] **Step 10.4: Report**

Output a short summary of what shipped, in this format:

```
Motion parity plan complete.
- Tasks 1-3: motion.ts helpers (centroid stagger, post-clear snapshot, seeded jitter), 10 unit tests added.
- Task 4: pops staggered by centroid.
- Task 5: two-phase invalid bounce.
- Tasks 6-7: real-sprite cascade & spawn; playMoveGhost removed.
- Task 8: drag lift tweened.
- Task 9: swap commit threshold 0.32 -> 0.45.
- Task 10: full verification gate green.

Open follow-ups not in scope of this plan:
- Power-up VFX differentiation (rocket scan, TNT shockwave, propeller orbits, lightBall full-board flash)
- Idle hint pulse (needs engine hint-cell API)
- Mobile touch playtest on real hardware
```

Do not push to remote unless explicitly told to.

---

## Out of Scope (Do Not Touch)

These items came up during the motion review but are deliberately deferred:
- Power-up activation VFX differentiation. Currently one generic line/circle fade serves all four kinds. Differentiation requires per-kind visual design and is a separate plan.
- Idle hint pulse. Requires the engine to expose a "hint cell" API; not present today.
- Replacing the per-frame `renderSnapshot` rebuild with persistent occupant nodes. Performance optimization, not a feel fix.
- iOS source changes. The iOS repo is the parity reference; do not modify it.
- Any engine, level JSON, asset manifest, React UI, persistence, or telemetry change.

If a task tempts you to touch any of these, stop and ask before proceeding.
