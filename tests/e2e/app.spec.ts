import { expect, test, type Page } from "@playwright/test";
import {
  GAMEPLAY_POLL_TIMEOUT_MS,
  BOARD_READY_TIMEOUT_MS,
  WIN_ROW_DESTRUCTION_POP_MS,
  WIN_ROW_DESTRUCTION_STAGGER_MS,
  WIN_SEQUENCE_FINAL_HOLD_MS,
  WIN_SEQUENCE_LEAD_IN_MS
} from "../../src/data/gameplayTiming";
import { winSequenceDurationMs } from "../../src/game/motion";
import type { PresentationTraceEntry } from "../../src/game/presentation";
import { testLevel } from "../../src/tests/helpers/testBoard";
import type { ResolutionFrameAudit } from "../../src/game/resolutionPlayback";

test.beforeEach(async ({ page }) => {
  await clearStorage(page);
});

test("boots from a non-root deep-link path via SPA fallback", async ({ page }) => {
  // App is mounted at /play/match/; deep links below that base must still boot via
  // the SPA history fallback (vite preview locally, the worker's ASSETS in production).
  await page.goto("./GridWatchMatchWeb/?gwTestMode=1");
  await expect(page.getByRole("heading", { name: "GridWatch Match" })).toBeVisible();
});

test("home presents the active operation and agent as a command deck", async ({ page }) => {
  await page.goto("./?gwTestMode=1");

  const deck = page.getByTestId("home-command-deck");
  await expect(deck).toBeVisible();
  await expect(deck.getByText("Live defense network", { exact: true })).toBeVisible();
  await expect(deck.getByText("Level 1", { exact: true })).toBeVisible();
  await expect(deck.getByLabel("Perimeter Defense progress")).toHaveAttribute("aria-valuenow", "0");
  await expect(deck.getByRole("img", { name: "Rusty, selected agent" })).toBeVisible();
  await expect(deck.getByRole("button", { name: "Resume Operations" })).toBeVisible();
  await expect(deck.getByRole("button", { name: "Quick Deploy" })).toBeVisible();
});

test("every ally can be picked as the avatar from the start", async ({ page }) => {
  await page.goto("./?gwTestMode=1");
  await page.locator(".main-nav").getByRole("button", { name: "Account", exact: true }).click();

  const cards = page.locator(".hero-card");
  await expect(cards).toHaveCount(11);
  await expect(cards.getByRole("button", { name: "Select", exact: true })).toHaveCount(10);
  await expect(cards.filter({ hasText: "Rusty" }).getByRole("button", { name: "Selected" })).toBeDisabled();

  await cards.filter({ has: page.getByRole("heading", { name: "AURORA-6", exact: true }) }).getByRole("button", { name: "Select" }).click();
  await expect(cards.filter({ hasText: "AURORA-6" }).getByRole("button", { name: "Selected" })).toBeDisabled();

  await page.reload();
  await expect(page.getByTestId("home-command-deck").getByRole("img", { name: "AURORA-6, selected agent" })).toBeVisible();
});

test("after 6 seconds without a move the board shows a hint, which goes on a touch and comes back", async ({ page }) => {
  // Russ, 2026-11-03: "When a user is looking at the board for more than 6 seconds looking for a match,
  // give an animated hint".
  test.setTimeout(60_000);
  type Hint = { action: { kind: string; from?: { row: number; col: number }; to?: { row: number; col: number } }; cells: unknown[] } | null;
  const hint = () => page.evaluate(() => (window as Window & { __gwHint?: Hint }).__gwHint ?? null);
  await page.goto("./?gwTestMode=1&level=1");
  await waitForBoardReady(page);

  await page.waitForTimeout(5_000);
  expect(await hint(), "no hint before 6 seconds").toBeNull();
  await expect.poll(hint, { timeout: 3_000 }).not.toBeNull();
  const shown = (await hint())!;
  expect(shown.action.kind).toBe("swap");
  expect(shown.cells.length).toBeGreaterThanOrEqual(3);

  await clickBoardPoint(page, await boardCellPoint(page, { row: 0, col: 0 }));
  expect(await hint(), "a touch takes the hint down").toBeNull();
  await clickBoardPoint(page, await boardCellPoint(page, { row: 0, col: 0 }));
  await expect.poll(hint, { timeout: 8_000 }).not.toBeNull();

  // The hinted move is a real one: playing it spends a move.
  const again = (await hint())!;
  const before = await movesShown(page).textContent();
  await dragBoardCells(page, again.action.from!, again.action.to!);
  await waitForResolutionComplete(page);
  await expect(movesShown(page)).not.toHaveText(before ?? "");
  expect(await hint()).toBeNull();
});

test("navigates Home to Operations to Level 1 and applies a deterministic swap", async ({ page }) => {
  await page.goto("./?gwTestMode=1");
  await page.getByRole("button", { name: "Operations", exact: true }).click();
  await page.getByRole("button", { name: "Open Levels" }).first().click();
  await page.getByRole("button", { name: "Level 1 Ready" }).click();
  await expect(page.getByTestId("board-canvas")).toBeVisible();
  await waitForBoardReady(page);
  await page.getByTestId("qa-swap").click();
  await expect(page.getByText(/Last clear:/)).toBeVisible();
});

test("dragging a board tile into a deterministic match applies a swap", async ({ page }) => {
  await page.goto("./?gwTestMode=1&level=1");
  await expect(page.getByTestId("board-canvas")).toBeVisible();

  await dragBoardCells(page, { row: 0, col: 0 }, { row: 1, col: 0 });

  await expect(page.getByText("24/25")).toBeVisible();
  await expect(page.getByText(/Last clear:/)).toBeVisible();
  await expect(page.getByText("Collect 20 Packets: 3/20")).toBeVisible();
});

test("level 6 cascades preserve surviving tile sprites across automatic matches", async ({ page }) => {
  await page.goto("./?gwTestMode=1&level=6");
  await expect(page.getByTestId("board-canvas")).toBeVisible();
  await waitForBoardReady(page);

  await dragBoardCells(page, { row: 0, col: 5 }, { row: 0, col: 6 });
  const firstSequenceId = await waitForResolutionComplete(page);
  await dragBoardCells(page, { row: 3, col: 5 }, { row: 3, col: 6 });
  const secondSequenceId = await waitForResolutionComplete(page, firstSequenceId);
  expect(secondSequenceId).toBeGreaterThan(firstSequenceId);

  const audits = await page.evaluate(() => (
    (window as Window & {
      __gwCascadeAudits?: {
        beforeIds: number[];
        moveIds: number[];
        spawnIds: number[];
        missingMoveIds: number[];
      }[];
    }).__gwCascadeAudits
  ));
  expect(audits).toBeDefined();
  expect(audits!.some(audit => audit.moveIds.length > 0)).toBe(true);
  expect(audits!.some(audit => audit.spawnIds.length > 0)).toBe(true);
  for (const audit of audits!) {
    expect(audit.missingMoveIds).toEqual([]);
    expect(audit.moveIds.every(id => audit.beforeIds.includes(id))).toBe(true);
    expect(audit.spawnIds.every(id => !audit.beforeIds.includes(id))).toBe(true);
  }
});

test("match pops burst with particles", async ({ page }) => {
  await page.goto("./?gwTestMode=1&level=1");
  await expect(page.getByTestId("board-canvas")).toBeVisible();
  await waitForBoardReady(page);
  const burstCountBefore = await matchBurstCount(page);

  await dragBoardCells(page, { row: 0, col: 0 }, { row: 1, col: 0 });

  await expect(page.getByText(/Last clear:/)).toBeVisible();
  await expect.poll(() => matchBurstCount(page), { timeout: GAMEPLAY_POLL_TIMEOUT_MS }).toBeGreaterThan(burstCountBefore);
});

test("handles fail, Play On decline path, forced win, and next level unlock", async ({ page }) => {
  await page.goto("./?gwTestMode=1&level=1");
  await expect(page.getByTestId("board-canvas")).toBeVisible();
  await page.getByTestId("qa-fail").click();
  await expect(page.getByText("Mission at risk")).toBeVisible();
  await page.getByRole("button", { name: "End Mission" }).click();
  await expect(page.getByText("Grid compromised")).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await page.getByTestId("qa-win").click();
  await expect(page.getByText("Grid secured")).toBeVisible();
  await page.getByRole("button", { name: "Next Level" }).click();
  await expect(page.getByText("Level 2")).toBeVisible();
});

test("level 150 opens and can be won", async ({ page }) => {
  await page.goto("./?gwTestMode=1&level=150");
  await expect(page.getByTestId("board-canvas")).toBeVisible();
  await expect(page.getByText("Level 150")).toBeVisible();
  await page.getByTestId("qa-win").click();
  await expect(page.getByText("Grid secured")).toBeVisible();
  await page.getByRole("button", { name: "Next Level" }).click();
  await expect(page.getByText("Level 151")).toBeVisible();
});

test("the coins for a first win are counted on the banner and itemised on the result panel", async ({ page }) => {
  await page.goto("./?gwTestMode=1&level=1");
  const theme = await page.evaluate(() => document.documentElement.dataset.boardTheme);
  test.skip(theme !== "darkRealism", "the banner is the dark board's");
  await waitForBoardReady(page);
  await page.getByTestId("qa-win-animated").click();
  await expect(page.getByTestId("win-payout")).toContainText(/moves left/i);
  await expect(page.getByTestId("win-payout")).toContainText(/\+[1-9]\d*/);
  const coins = page.getByTestId("result-coins");
  await expect(coins).toBeVisible({ timeout: 8_000 });
  await expect(coins).toContainText(/stars \+\d+/i);
  await expect(coins).toContainText(/\d+ moves left \+\d+/i);
});

test("a replayed level pays no coins and shows no payout", async ({ page }) => {
  await page.goto("./?gwTestMode=1&level=1");
  await waitForBoardReady(page);
  await page.getByTestId("qa-win").click();
  await expect(page.getByTestId("result-coins")).toBeVisible();
  const total = page.locator("header.top-bar .currency strong");
  const after = await total.textContent();
  await page.goto("./?gwTestMode=1&level=1");
  await waitForBoardReady(page);
  await page.getByTestId("qa-win-animated").click();
  await expect(page.getByText("Grid secured", { exact: true })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByTestId("win-payout")).toHaveCount(0);
  await expect(page.getByTestId("result-coins")).toHaveCount(0);
  await expect(total).toHaveText(after!);
});

for (const [width, height] of [[440, 748], [393, 652], [375, 550]] as const) {
  test(`at ${width}x${height} the whole game fits one screen, with the power-ups in reach`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("./?gwTestMode=1&level=1");
    const theme = await page.evaluate(() => document.documentElement.dataset.boardTheme);
    test.skip(theme !== "darkRealism", "the archived classic board keeps its scrolling page");
    await waitForBoardReady(page);
    // The test-only tools sit below the fold on purpose; a player has none of them.
    await page.addStyleTag({ content: ".qa-tools, .delta-line { display: none !important; }" });

    await expect(page.locator("header.top-bar")).toBeHidden();
    await expect(page.locator(".game-hud").getByRole("button", { name: "Back" })).toBeVisible();
    const box = await page.locator(".game-board-panel").boundingBox();
    const tray = await page.locator(".booster-tray").boundingBox();
    expect(box!.width).toBeCloseTo(box!.height, 0);
    expect(box!.width).toBeGreaterThanOrEqual(240);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(tray!.y);
    expect(tray!.y + tray!.height).toBeLessThanOrEqual(height);
    const overflow = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("the store sells power-ups for coins, and greys out what the coins cannot reach", async ({ page }) => {
  await seedSave(page, { coins: 250 });
  await page.goto("./?gwTestMode=1");
  await page.getByRole("button", { name: "Store", exact: true }).click();
  const tnt = page.getByTestId("buy-tnt");
  await expect(tnt).toContainText("You have 3");
  await tnt.getByRole("button", { name: "200 coins" }).click();
  await expect(tnt).toContainText("You have 4");
  await expect(page.getByLabel("50 coins")).toBeVisible();
  await expect(page.getByTestId("buy-rocket").getByRole("button", { name: "100 coins" })).toBeDisabled();
});

test("an empty power-up offers itself for coins mid-level, and comes back armed", async ({ page }) => {
  await seedSave(page, { coins: 250, boosters: { tnt: 0 } });
  await page.goto("./?gwTestMode=1&level=1");
  await waitForBoardReady(page);
  await page.getByTestId("booster-tnt").click();
  await expect(page.getByText("Spend 200 coins for one. You have 250.")).toBeVisible();
  await page.getByRole("button", { name: "Buy", exact: true }).click();
  await expect(page.getByTestId("booster-tnt")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("booster-tnt").getByLabel("1 available")).toBeVisible();
  await expect(page.getByText("Choose a grid tile.")).toBeVisible();
});

test("an empty power-up the coins cannot reach cannot be bought, and costs nothing to dismiss", async ({ page }) => {
  await seedSave(page, { coins: 50, boosters: { lightBall: 0 } });
  await page.goto("./?gwTestMode=1&level=1");
  await waitForBoardReady(page);
  await page.getByTestId("booster-lightBall").click();
  await expect(page.getByRole("button", { name: "Buy", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(page.getByRole("button", { name: "Buy", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("booster-lightBall")).toHaveAttribute("aria-pressed", "false");
});

test("a wide screen keeps its top bar in a level", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("./?gwTestMode=1&level=1");
  await waitForBoardReady(page);
  await expect(page.locator("header.top-bar")).toBeVisible();
});

test("a won level plays the banner over the board, then lands its stars on the result panel", async ({ page }) => {
  await page.goto("./?gwTestMode=1&level=1");
  const theme = await page.evaluate(() => document.documentElement.dataset.boardTheme);
  test.skip(theme !== "darkRealism", "the archived classic board keeps its plain result panel");
  await waitForBoardReady(page);
  await page.getByTestId("qa-win-animated").click();
  await expect(page.getByTestId("win-banner")).toBeVisible();
  await expect(page.getByTestId("win-banner")).toContainText(/Level\s*1/i);
  await expect(page.getByText("Grid secured", { exact: true })).not.toBeVisible();
  await expect(page.getByText("Grid secured", { exact: true })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByTestId("win-banner")).toHaveCount(0);
  const stars = page.getByTestId("result-stars");
  await expect(stars).toHaveAttribute("aria-label", /^[1-3] of 3 stars$/);
  const earned = Number((await stars.getAttribute("aria-label"))![0]);
  await expect(stars.locator("svg.is-earned")).toHaveCount(earned);
  await expect(stars.locator("svg")).toHaveCount(3);
});

test("a level won without animation shows no banner", async ({ page }) => {
  await page.goto("./?gwTestMode=1&level=1");
  await waitForBoardReady(page);
  await page.getByTestId("qa-win").click();
  await expect(page.getByText("Grid secured", { exact: true })).toBeVisible();
  await expect(page.getByTestId("win-banner")).toHaveCount(0);
});

test("animated win destroys the board before showing the result modal", async ({ page }) => {
  await page.goto("./?gwTestMode=1&level=1");
  await expect(page.getByTestId("board-canvas")).toBeVisible();
  await waitForBoardReady(page);

  await page.getByTestId("qa-win-animated").click();

  const modalTitle = page.getByText("Grid secured");
  await page.waitForFunction(() => (
    (window as Window & { __gwPresentationTrace?: Array<{ kind: string }> }).__gwPresentationTrace
      ?.some((entry) => entry.kind === "win-sequence-start") ?? false
  ));
  await page.waitForTimeout(winSequenceDurationMs(
    7,
    WIN_ROW_DESTRUCTION_STAGGER_MS,
    WIN_ROW_DESTRUCTION_POP_MS,
    WIN_SEQUENCE_LEAD_IN_MS,
    WIN_SEQUENCE_FINAL_HOLD_MS
  ) - 120);
  await expect(modalTitle).not.toBeVisible();
  const boundaryTrace = await page.evaluate(() => (
    (window as Window & { __gwPresentationTrace?: Array<{ kind: string }> }).__gwPresentationTrace ?? []
  ));
  expect(boundaryTrace.some((entry) => entry.kind === "win-row-destroyed")).toBe(true);
  expect(boundaryTrace.some((entry) => entry.kind === "win-sequence-complete")).toBe(false);
  await expect(modalTitle).toBeVisible({ timeout: 1_200 });
  await page.waitForFunction(() => (
    (window as Window & { __gwPresentationTrace?: Array<{ kind: string }> }).__gwPresentationTrace
      ?.some((entry) => entry.kind === "win-sequence-complete") ?? false
  ));
  const finalTrace = await page.evaluate(() => (
    (window as Window & { __gwPresentationTrace?: Array<{ kind: string; detail?: string; atMs: number }> }).__gwPresentationTrace ?? []
  ));
  const destroyedRows = finalTrace.filter((entry) => entry.kind === "win-row-destroyed");
  const sequenceStart = finalTrace.find((entry) => entry.kind === "win-sequence-start");
  const sequenceComplete = finalTrace.find((entry) => entry.kind === "win-sequence-complete");
  expect(destroyedRows).toHaveLength(7);
  expect(destroyedRows[0]?.detail).toBe("6");
  expect(destroyedRows.at(-1)?.detail).toBe("0");
  for (let index = 1; index < destroyedRows.length; index += 1) {
    expect(destroyedRows[index]!.atMs - destroyedRows[index - 1]!.atMs)
      .toBeGreaterThanOrEqual(WIN_ROW_DESTRUCTION_POP_MS - 20);
  }
  expect((sequenceComplete?.atMs ?? 0) - (sequenceStart?.atMs ?? 0)).toBeGreaterThanOrEqual(2_300);
  expect((sequenceComplete?.atMs ?? 0) - (sequenceStart?.atMs ?? 0)).toBeLessThanOrEqual(2_900);
  expect(finalTrace.filter((entry) => entry.kind === "audio-cue" && entry.detail === "tileClusterBody")).toHaveLength(7);
});

test("starts terminal rows only after the winning board reaches its settled boundary", async ({ page }) => {
  await page.goto("./?gwTestMode=1&level=5");
  await waitForBoardReady(page);
  await page.getByTestId("qa-setup-winning-rocket-combo").click();
  await expect(page.getByText("Clear 1: 0/1")).toBeVisible();
  await page.getByTestId("qa-trigger-winning-rocket-combo").click();

  const boundary = await page.waitForFunction(() => {
    const target = window as Window & {
      __gwResolutionFrames?: ResolutionFrameAudit[];
      __gwPresentationTrace?: Array<{ kind: string; sequenceId: number; atMs: number }>;
    };
    const winStart = target.__gwPresentationTrace?.find(entry => entry.kind === "win-sequence-start");
    if (!winStart) return null;
    return {
      frame: target.__gwResolutionFrames?.at(-1),
      complete: target.__gwPresentationTrace?.find(entry => entry.kind === "resolution-complete"),
      winStart
    };
  });
  const state = (await boundary.jsonValue())!;
  expect(state.frame?.kind).toBe("settled");
  expect(state.complete).toBeDefined();
  expect(state.frame!.sequenceId).toBe(state.complete!.sequenceId);
  expect(state.winStart.sequenceId).toBeGreaterThan(state.complete!.sequenceId);
  expect(state.winStart.atMs).toBeGreaterThanOrEqual(state.complete!.atMs);
  expect(state.frame!.rendered.map(cell => ({ position: cell.position, occupantId: cell.occupantId })))
    .toEqual(state.frame!.expected);
  await expect(page.getByText("Grid secured")).toBeVisible({ timeout: 8_000 });
});

test("finishes a winning rocket combo before the terminal row sequence", async ({ page }) => {
  await page.goto("./?gwTestMode=1&level=5");
  await expect(page.getByTestId("board-canvas")).toBeVisible();
  await waitForBoardReady(page);

  await page.getByTestId("qa-setup-winning-rocket-combo").click();
  await expect(page.getByText("Clear 1: 0/1")).toBeVisible();
  await page.getByTestId("qa-trigger-winning-rocket-combo").click();
  await waitForResolutionComplete(page);
  await expect(page.getByText("Grid secured")).toBeVisible({ timeout: 8_000 });

  const trace = await page.evaluate(() => (
    (window as Window & { __gwPresentationTrace?: Array<{ kind: string; detail?: string; atMs: number }> }).__gwPresentationTrace ?? []
  ));
  const comboCharge = trace.find((entry) => entry.kind === "combo-charge" && entry.detail === "rocket+rocket");
  const comboImpact = trace.find((entry) => entry.kind === "combo-impact" && entry.detail === "rocket+rocket");
  const resolutionComplete = trace.find((entry) => entry.kind === "resolution-complete");
  const winStart = trace.find((entry) => entry.kind === "win-sequence-start");

  expect(comboCharge).toBeDefined();
  expect(comboImpact).toBeDefined();
  expect(resolutionComplete).toBeDefined();
  expect(winStart).toBeDefined();
  expect(comboCharge!.atMs).toBeLessThan(comboImpact!.atMs);
  expect(comboImpact!.atMs).toBeLessThanOrEqual(resolutionComplete!.atMs);
  expect(resolutionComplete!.atMs).toBeLessThanOrEqual(winStart!.atMs);
});

test("boss timer fail is surfaced", async ({ page }) => {
  await page.goto("./?gwTestMode=1&level=10");
  await expect(page.getByText("Breach")).toBeVisible();
  await page.getByTestId("qa-boss-timeout").click();
  await expect(page.getByText("Grid compromised")).toBeVisible();
  await expect(page.locator(".modal").getByText("Boss timer expired.")).toBeVisible();
});

test("booster tray requires a deliberate board target", async ({ page }) => {
  await page.goto("./?gwTestMode=1&level=1");
  await expect(page.getByTestId("board-canvas")).toBeVisible();
  const booster = page.getByTestId("booster-tnt");
  await expect(booster.locator("strong")).toHaveText("3");
  await booster.click();
  await expect(page.getByText("Choose a grid tile.")).toBeVisible();
  await expect(booster.locator("strong")).toHaveText("3");
  await expect(page.getByText(/Last clear:/)).not.toBeVisible();

  await waitForBoardReady(page);
  const target = await boardCellPoint(page, { row: 3, col: 3 });
  await clickBoardPoint(page, target);
  await expect(page.getByText(/Last clear:/)).toBeVisible();
  await expect(booster.locator("strong")).toHaveText("2");
});

test("booster tap clears use the tile pop animation path", async ({ page }) => {
  await page.goto("./?gwTestMode=1&level=1");
  await expect(page.getByTestId("board-canvas")).toBeVisible();
  await waitForBoardReady(page);
  const popCountBefore = await tilePopCount(page);

  const booster = page.getByTestId("booster-tnt");
  await booster.click();
  const target = await boardCellPoint(page, { row: 3, col: 3 });
  await clickBoardPoint(page, target);

  await expect(page.getByText(/Last clear:/)).toBeVisible();
  await expect.poll(() => tilePopCount(page), { timeout: GAMEPLAY_POLL_TIMEOUT_MS }).toBeGreaterThan(popCountBefore);
});

test("clicking a booster starts power-up fx before cascade", async ({ page }) => {
  await page.goto("./?gwTestMode=1&level=1");
  await expect(page.getByTestId("board-canvas")).toBeVisible();
  await waitForBoardReady(page);
  const popCountBefore = await tilePopCount(page);
  const fxCountBefore = await powerUpFxCount(page);
  const fxAfterPopRenderBefore = await powerUpFxAfterPopRenderCount(page);

  const booster = page.getByTestId("booster-tnt");
  await booster.click();
  const target = await boardCellPoint(page, { row: 3, col: 3 });
  await clickBoardPoint(page, target);

  await expect(page.getByText(/Last clear:/)).toBeVisible();
  await expect.poll(() => tilePopCount(page), { timeout: GAMEPLAY_POLL_TIMEOUT_MS }).toBeGreaterThan(popCountBefore);
  await expect.poll(() => powerUpFxCount(page), { timeout: GAMEPLAY_POLL_TIMEOUT_MS }).toBeGreaterThan(fxCountBefore);
  await expect.poll(() => powerUpFxAfterPopRenderCount(page), { timeout: GAMEPLAY_POLL_TIMEOUT_MS }).toBeGreaterThan(fxAfterPopRenderBefore);
});

test("TNT booster detonates with shockwave effects", async ({ page }) => {
  await page.goto("./?gwTestMode=1&level=1");
  await expect(page.getByTestId("board-canvas")).toBeVisible();
  await waitForBoardReady(page);
  const detonationCountBefore = await tntDetonationCount(page);

  await page.getByTestId("booster-tnt").click();
  const target = await boardCellPoint(page, { row: 3, col: 3 });
  await clickBoardPoint(page, target);

  await expect(page.getByText(/Last clear:/)).toBeVisible();
  await expect.poll(() => tntDetonationCount(page), { timeout: GAMEPLAY_POLL_TIMEOUT_MS }).toBeGreaterThan(detonationCountBefore);
});

test("rocket booster launches projectile heads", async ({ page }) => {
  await page.goto("./?gwTestMode=1&level=1");
  await expect(page.getByTestId("board-canvas")).toBeVisible();
  await waitForBoardReady(page);
  const launchCountBefore = await rocketLaunchCount(page);

  await page.getByTestId("booster-rocket").click();
  const target = await boardCellPoint(page, { row: 3, col: 3 });
  await clickBoardPoint(page, target);

  await expect(page.getByText(/Last clear:/)).toBeVisible();
  await expect.poll(() => rocketLaunchCount(page), { timeout: GAMEPLAY_POLL_TIMEOUT_MS }).toBeGreaterThan(launchCountBefore);
});

test("propeller booster drone flies and strikes", async ({ page }) => {
  await page.goto("./?gwTestMode=1&level=1");
  await expect(page.getByTestId("board-canvas")).toBeVisible();
  await waitForBoardReady(page);
  const strikeCountBefore = await propellerStrikeCount(page);

  await page.getByTestId("booster-propeller").click();
  const target = await boardCellPoint(page, { row: 3, col: 3 });
  await clickBoardPoint(page, target);

  await expect(page.getByText(/Last clear:/)).toBeVisible();
  await expect.poll(() => propellerStrikeCount(page), { timeout: GAMEPLAY_POLL_TIMEOUT_MS }).toBeGreaterThan(strikeCountBefore);
});

test("lightBall booster zaps its targets", async ({ page }) => {
  await page.goto("./?gwTestMode=1&level=1");
  await expect(page.getByTestId("board-canvas")).toBeVisible();
  await waitForBoardReady(page);
  const zapCountBefore = await lightBallZapCount(page);

  await page.getByTestId("booster-lightBall").click();
  const target = await boardCellPoint(page, { row: 3, col: 3 });
  await clickBoardPoint(page, target);

  await expect(page.getByText(/Last clear:/)).toBeVisible();
  await expect.poll(() => lightBallZapCount(page), { timeout: GAMEPLAY_POLL_TIMEOUT_MS }).toBeGreaterThan(zapCountBefore);
});

test("dragging a booster onto the board consumes inventory and activates at drop", async ({ page }) => {
  await page.goto("./?gwTestMode=1&level=1");
  await expect(page.getByTestId("board-canvas")).toBeVisible();
  await waitForBoardReady(page);
  const booster = page.getByTestId("booster-rocket");
  await booster.scrollIntoViewIfNeeded();
  const boosterBox = await booster.boundingBox();
  const target = await boardCellPoint(page, { row: 3, col: 3 });
  expect(boosterBox).not.toBeNull();

  await dragBoosterToBoardPoint(page, boosterBox!, target);

  await expect(page.getByText(/Last clear:/)).toBeVisible();
  await expect(booster.locator("strong")).toHaveText("2");
});

test("store stub never grants coins", async ({ page }) => {
  await page.goto("./?gwTestMode=1");
  await expect(page.getByLabel("0 coins")).toBeVisible();
  await page.getByRole("button", { name: "Store" }).click();
  await page.getByRole("button", { name: "$1.99" }).click();
  await expect(page.getByText(/disabled until a secure backend exists/)).toBeVisible();
  await expect(page.getByLabel("0 coins")).toBeVisible();
});

test("settings and intel review state persist", async ({ page }) => {
  await page.goto("./?gwTestMode=1");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Reduced Motion").check();
  await expect(page.getByLabel("Reduced Motion")).toBeChecked();
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Reduced Motion")).toBeChecked();

  await page.getByRole("button", { name: "Intel" }).click();
  await page.getByRole("button", { name: "Mark Reviewed" }).first().click();
  await page.reload();
  await page.getByRole("button", { name: "Intel" }).click();
  await expect(page.getByRole("button", { name: "Reviewed" }).first()).toBeVisible();
});

test("board and HUD do not overlap at active viewport", async ({ page }) => {
  await page.goto("./?gwTestMode=1&level=1");
  const hud = await page.locator(".game-hud").boundingBox();
  const objectives = await page.locator(".objective-row").boundingBox();
  const board = await page.getByTestId("board-canvas").boundingBox();
  expect(hud).not.toBeNull();
  expect(objectives).not.toBeNull();
  expect(board).not.toBeNull();
  expect(board!.y).toBeGreaterThanOrEqual(objectives!.y + objectives!.height);
  expect(objectives!.y).toBeGreaterThanOrEqual(hud!.y + hud!.height);
});

/** Starts the page on this save, which `loadSaveState` reads while IndexedDB is empty. */
async function seedSave(page: Page, save: { coins: number; boosters?: Record<string, number> }): Promise<void> {
  await page.addInitScript((value) => {
    localStorage.setItem("gridwatch-match-web.save.v1", JSON.stringify({ version: 1, ...value }));
  }, save);
}

async function clearStorage(page: Page): Promise<void> {
  await page.goto("./");
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase("gridwatch-match-web");
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });
}

async function dragBoardCells(page: Page, from: { row: number; col: number }, to: { row: number; col: number }): Promise<void> {
  await page.locator('[data-testid="board-canvas"] canvas').waitFor({ state: "visible" });
  await waitForBoardReady(page);

  await page.evaluate(({ from, to }) => {
    const w = window as Window & {
      __gwBoardCellClientPoint?: (row: number, col: number) => { x: number; y: number } | null;
    };
    const start = w.__gwBoardCellClientPoint?.(from.row, from.col);
    const end = w.__gwBoardCellClientPoint?.(to.row, to.col);
    if (!start || !end) throw new Error("Board cell client points unavailable");

    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="board-canvas"] canvas');
    if (!canvas) throw new Error("Board canvas not found");

    const dispatch = (type: "pointerdown" | "pointermove" | "pointerup", point: { x: number; y: number }, buttons: number) => {
      canvas.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        clientX: point.x,
        clientY: point.y,
        button: 0,
        buttons,
        view: window
      }));
    };

    dispatch("pointerdown", start, 1);
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      dispatch("pointermove", {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t
      }, 1);
    }
    dispatch("pointerup", end, 0);
  }, { from, to });
}

async function waitForBoardReady(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const w = window as Window & {
      __gwBoardReady?: boolean;
      __gwBoardCellClientPoint?: (row: number, col: number) => { x: number; y: number } | null;
    };
    return w.__gwBoardReady === true && typeof w.__gwBoardCellClientPoint === "function";
  }, { timeout: BOARD_READY_TIMEOUT_MS });
}

async function waitForResolutionComplete(page: Page, afterSequenceId = 0): Promise<number> {
  // Ordered cascades can exceed the short feedback poll limit; await actual completion.
  await page.waitForFunction((minimumSequenceId) => (
    (window as Window & { __gwPresentationTrace?: Array<{ kind: string; sequenceId: number }> }).__gwPresentationTrace
      ?.some((entry) => entry.kind === "resolution-complete" && entry.sequenceId > minimumSequenceId) ?? false
  ), afterSequenceId, { timeout: 30_000 });
  return page.evaluate((minimumSequenceId) => (
    (window as Window & { __gwPresentationTrace?: Array<{ kind: string; sequenceId: number }> }).__gwPresentationTrace
      ?.find((entry) => entry.kind === "resolution-complete" && entry.sequenceId > minimumSequenceId)?.sequenceId ?? 0
  ), afterSequenceId);
}

async function clickBoardPoint(page: Page, point: { x: number; y: number }): Promise<void> {
  await page.evaluate(({ point }) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="board-canvas"] canvas');
    if (!canvas) throw new Error("Board canvas not found");
    const eventInit = {
      bubbles: true,
      button: 0,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
      composed: true,
      isPrimary: true,
      pointerId: 1,
      pointerType: "mouse",
      view: window
    };
    canvas.dispatchEvent(new PointerEvent("pointerdown", { ...eventInit, buttons: 1 }));
    canvas.dispatchEvent(new PointerEvent("pointerup", { ...eventInit, buttons: 0 }));
    canvas.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, cancelable: true, clientX: point.x, clientY: point.y, view: window }));
  }, { point });
}

async function boardCellPoint(page: Page, position: { row: number; col: number }): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(({ position }) => {
    const w = window as Window & {
      __gwBoardCellClientPoint?: (row: number, col: number) => { x: number; y: number } | null;
    };
    return w.__gwBoardCellClientPoint?.(position.row, position.col) ?? null;
  }, { position });
  if (!point) throw new Error(`Board cell point unavailable for ${position.row},${position.col}`);
  return point;
}

async function dragBoosterToBoardPoint(
  page: Page,
  boosterBox: { x: number; y: number; width: number; height: number },
  target: { x: number; y: number }
): Promise<void> {
  await page.evaluate(({ boosterBox, target }) => {
    const booster = document.querySelector<HTMLElement>('[data-testid="booster-rocket"]');
    if (!booster) throw new Error("Booster element not found");
    const start = {
      x: boosterBox.x + boosterBox.width / 2,
      y: boosterBox.y + boosterBox.height / 2
    };
    const dispatch = (type: "pointerdown" | "pointermove" | "pointerup", point: { x: number; y: number }, buttons: number) => {
      booster.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        clientX: point.x,
        clientY: point.y,
        button: 0,
        buttons,
        view: window
      }));
    };
    dispatch("pointerdown", start, 1);
    for (let i = 1; i <= 12; i++) {
      const t = i / 12;
      dispatch("pointermove", {
        x: start.x + (target.x - start.x) * t,
        y: start.y + (target.y - start.y) * t
      }, 1);
    }
    dispatch("pointerup", target, 0);
  }, { boosterBox, target });
}

async function tilePopCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as Window & { __gwTilePopAnimationCount?: number };
    return w.__gwTilePopAnimationCount ?? 0;
  });
}

async function powerUpFxCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as Window & { __gwPowerUpFxStartCount?: number };
    return w.__gwPowerUpFxStartCount ?? 0;
  });
}

async function powerUpFxAfterPopRenderCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as Window & { __gwPowerUpFxAfterPopRenderCount?: number };
    return w.__gwPowerUpFxAfterPopRenderCount ?? 0;
  });
}

async function matchBurstCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as Window & { __gwMatchBurstCount?: number };
    return w.__gwMatchBurstCount ?? 0;
  });
}

async function tntDetonationCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as Window & { __gwTntDetonationCount?: number };
    return w.__gwTntDetonationCount ?? 0;
  });
}

async function rocketLaunchCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as Window & { __gwRocketLaunchCount?: number };
    return w.__gwRocketLaunchCount ?? 0;
  });
}

async function propellerStrikeCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as Window & { __gwPropellerStrikeCount?: number };
    return w.__gwPropellerStrikeCount ?? 0;
  });
}

async function lightBallZapCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as Window & { __gwLightBallZapCount?: number };
    return w.__gwLightBallZapCount ?? 0;
  });
}


// --- Blocker goals: panes, locks and malware (goal chips, flights, frozen panes) -------------------------------------

/** No matches anywhere; swapping (4,2)-(4,3) makes p p p along the bottom row, under the pane at (3,2). */
const PANE_BOARD = (pane: string) => [
  "z t k z f#2",
  "k f z p t",
  "p k t z f",
  `z t ${pane} f z`,
  "p p k p f"
];
const PANES_GOAL = [{ id: "panes", target: 2, displayName: "Panes", tileType: null }];

async function openBlockerLevel(page: Page, rows: string[], objectives = PANES_GOAL, query = ""): Promise<void> {
  const level = testLevel(rows, { moveLimit: 20, objectives });
  await page.route("**/levels/level_001.json", route => route.fulfill({ json: level }));
  await page.goto(`./?gwTestMode=1&level=1${query}`);
  await waitForBoardReady(page);
}

function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  // WebKit refuses the voice clips before the first tap; that is the audio unlock, not the board.
  const note = (text: string) => { if (!text.includes("/assets/audio/")) errors.push(text); };
  page.on("pageerror", error => note(error.message));
  page.on("console", message => { if (message.type() === "error") note(message.text()); });
  return errors;
}

const movesShown = (page: Page) => page.locator(".game-hud div", { hasText: "Moves" }).locator("strong");
const paneStrength = (page: Page, key: string) => page.evaluate(
  (cell) => (window as Window & { __gwPaneStrengths?: Record<string, number> }).__gwPaneStrengths?.[cell] ?? null, key);
const objectiveFlights = (page: Page) => page.evaluate(() =>
  ((window as Window & { __gwPresentationTrace?: PresentationTraceEntry[] }).__gwPresentationTrace ?? [])
    .filter(entry => entry.kind === "objective-fly").map(entry => entry.detail));

/** Counts, frame by frame from now on, the frames in which any flight is in the air. */
async function watchFlights(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as Window & { __gwFlightFrames?: number };
    w.__gwFlightFrames = 0;
    const look = () => {
      if (document.querySelector(".piece-flight")) w.__gwFlightFrames = (w.__gwFlightFrames ?? 0) + 1;
      requestAnimationFrame(look);
    };
    look();
  });
}
const flightFrames = (page: Page) => page.evaluate(() => (window as Window & { __gwFlightFrames?: number }).__gwFlightFrames ?? 0);

async function darkOnly(page: Page): Promise<void> {
  const theme = await page.evaluate(() => document.documentElement.dataset.boardTheme);
  test.skip(theme !== "darkRealism", "the archived classic board has no flights");
}

test("a broken pane flies to its goal and the count waits for it", async ({ page }) => {
  await openBlockerLevel(page, PANE_BOARD("k#1"));
  await darkOnly(page);
  const chip = page.locator('[data-objective-id="panes"]');
  await expect(chip).toContainText("Panes: 0/2");
  await expect(chip.locator(".objective-picture")).toBeVisible();
  const track = page.evaluate(() => new Promise<string[]>((resolve) => {
    const seen: string[] = [];
    let started = false;
    const look = () => {
      const flying = document.querySelector(".piece-flight") !== null;
      if (flying) { started = true; seen.push(document.querySelector('[data-objective-id="panes"]')?.textContent ?? ""); }
      else if (started) { resolve(seen); return; }
      requestAnimationFrame(look);
    };
    look();
  }));
  await dragBoardCells(page, { row: 4, col: 2 }, { row: 4, col: 3 });
  const whileFlying = await track;
  expect(whileFlying.length).toBeGreaterThan(3);
  for (const text of whileFlying) expect(text).toContain("Panes: 0/2");
  expect((await objectiveFlights(page)).some(detail => detail?.startsWith("panes:3,2"))).toBe(true);
  await expect(chip).toContainText("Panes: 1/2");
});

test("a pane's strength number drops when a match beside it removes a layer", async ({ page }) => {
  await openBlockerLevel(page, PANE_BOARD("k#2"));
  expect(await paneStrength(page, "3,2")).toBe(2);
  await dragBoardCells(page, { row: 4, col: 2 }, { row: 4, col: 3 });
  await waitForResolutionComplete(page);
  expect(await paneStrength(page, "3,2")).toBe(1);
  await expect(page.locator('[data-objective-id="panes"]')).toContainText("Panes: 0/2");
});

test("swapping into a frozen pane is refused cleanly", async ({ page }) => {
  const errors = watchForErrors(page);
  // Column 3 holds k k above the swap target, so moving the pane's k into (3,3) would make a line
  // of three if the pane did not freeze it: only the pane can be what refuses this swap.
  const rows = PANE_BOARD("k#2");
  rows[1] = "k f z k t";
  rows[2] = "p k t k f";
  await openBlockerLevel(page, rows);
  await expect(movesShown(page)).toHaveText("20/20");
  await dragBoardCells(page, { row: 3, col: 3 }, { row: 3, col: 2 });
  // Nothing resolves: the board declines the gesture, so there is no trace to wait for.
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => (window as Window & { __gwPresentationTrace?: PresentationTraceEntry[] }).__gwPresentationTrace?.some(entry => entry.kind === "resolution-complete") ?? false)).toBe(false);
  await expect(movesShown(page)).toHaveText("20/20");
  expect(await paneStrength(page, "3,2")).toBe(2);
  // The board plays on.
  await dragBoardCells(page, { row: 4, col: 2 }, { row: 4, col: 3 });
  await expect(movesShown(page)).toHaveText("19/20");
  expect(errors).toEqual([]);
});

test("a booster dropped on a pane fires", async ({ page }) => {
  const errors = watchForErrors(page);
  await openBlockerLevel(page, PANE_BOARD("k#2"));
  const booster = page.getByTestId("booster-tnt");
  await expect(booster.locator("strong")).toHaveText("3");
  await booster.click();
  await clickBoardPoint(page, await boardCellPoint(page, { row: 3, col: 2 }));
  await expect(booster.locator("strong")).toHaveText("2");
  await waitForResolutionComplete(page);
  expect(await paneStrength(page, "3,2")).toBe(1);
  expect(errors).toEqual([]);
});

test("reduced motion and classic count blockers at once", async ({ page }) => {
  for (const mode of ["reduced", "classic"] as const) {
    await page.unroute("**/levels/level_001.json");
    // Classic is tried with motion on, so that only the classic board is what stops a flight.
    await page.emulateMedia({ reducedMotion: mode === "reduced" ? "reduce" : "no-preference" });
    await openBlockerLevel(page, PANE_BOARD("k#1"), PANES_GOAL, mode === "classic" ? "&theme=classic" : "");
    await expect(page.locator('[data-objective-id="panes"]')).toContainText("Panes: 0/2");
    await watchFlights(page);
    await dragBoardCells(page, { row: 4, col: 2 }, { row: 4, col: 3 });
    await waitForResolutionComplete(page);
    await expect(page.locator('[data-objective-id="panes"]')).toContainText("Panes: 1/2");
    // A flight lasts 480ms: waiting past it, the frame count says whether one ever flew.
    await page.waitForTimeout(700);
    expect(await flightFrames(page)).toBe(0);
    if (mode === "classic") expect(await objectiveFlights(page)).toEqual([]);
  }
});

test("a malware chip never rises because of a flight, and counts down as they land", async ({ page }) => {
  const rows = [
    "z t k z f~1",
    "k f z p t",
    "p k t z f",
    "z~1 t~1 k f z",
    "p p k p f"
  ];
  const goal = [{ id: "malware", target: 1, displayName: "Malware", tileType: null }];
  await openBlockerLevel(page, rows, goal);
  await darkOnly(page);
  const chip = page.locator('[data-objective-id="malware"]');
  await expect(chip).toContainText("Malware left: 3");
  await page.evaluate(() => {
    const w = window as Window & { __gwMalwareFrames?: { left: number; flying: boolean }[] };
    w.__gwMalwareFrames = [];
    const look = () => {
      const text = document.querySelector('[data-objective-id="malware"]')?.textContent ?? "";
      const left = Number(text.match(/(\d+)\s*$/)?.[1] ?? NaN);
      w.__gwMalwareFrames!.push({ left, flying: document.querySelector(".piece-flight") !== null });
      requestAnimationFrame(look);
    };
    look();
  });
  await dragBoardCells(page, { row: 4, col: 2 }, { row: 4, col: 3 });
  await waitForResolutionComplete(page);
  await page.waitForTimeout(700);
  const frames = await page.evaluate(() => (window as Window & { __gwMalwareFrames?: { left: number; flying: boolean }[] }).__gwMalwareFrames ?? []);
  expect(frames.some(frame => frame.flying)).toBe(true);
  const counts = frames.map(frame => frame.left);
  expect(Math.max(...counts)).toBe(3);
  for (let index = 1; index < counts.length; index += 1) expect(counts[index]).toBeLessThanOrEqual(counts[index - 1]);
  expect(counts.at(-1)).toBe(1);
  await expect(chip).toContainText("Malware left: 1");
});

/** A real board: 7 x 7, no matches anywhere, one pane, one lock and one malware cell. */
function realBoard(): string[] {
  const letters = ["p", "f", "k", "t", "z"];
  const rows = Array.from({ length: 7 }, (_, row) => Array.from({ length: 7 }, (_, col) => letters[(row * 2 + col) % 5]));
  rows[1][1] += "#1";
  rows[2][5] += "!";
  rows[5][3] += "~1";
  return rows.map(row => row.join(" "));
}

const GOAL_SETS = {
  "pane, lock and malware": [
    { id: "panes", target: 2, displayName: "Panes", tileType: null },
    { id: "locks", target: 1, displayName: "Locks", tileType: null },
    { id: "malware", target: 1, displayName: "Malware", tileType: null }
  ],
  "three collect goals": [
    { id: "c1", target: 20, displayName: "Packets", tileType: "packet" },
    { id: "c2", target: 20, displayName: "Firewalls", tileType: "firewall" },
    { id: "c3", target: 20, displayName: "Keys", tileType: "key" }
  ]
} as const;

for (const [width, height] of [[375, 550], [440, 748]] as const) {
  for (const [name, goals] of Object.entries(GOAL_SETS)) {
    test(`blocker goals fit one phone screen: ${name} at ${width}x${height}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height });
      await openBlockerLevel(page, realBoard(), goals as never);
      await darkOnly(page);
      await page.addStyleTag({ content: ".qa-tools, .delta-line { display: none !important; }" });
      await expect(page.locator(".objective-chip")).toHaveCount(3);
      const fit = await page.evaluate(() => ({
        chips: [...document.querySelectorAll<HTMLElement>(".objective-chip")].map(chip => {
          const box = chip.getBoundingClientRect();
          return { clipped: chip.scrollWidth > chip.clientWidth + 1 || chip.scrollHeight > chip.clientHeight + 1, top: box.top, right: box.right };
        }),
        scrollX: document.documentElement.scrollWidth - window.innerWidth,
        scrollY: document.documentElement.scrollHeight - window.innerHeight
      }));
      for (const chip of fit.chips) {
        expect(chip.clipped).toBe(false);
        expect(chip.right).toBeLessThanOrEqual(width);
        expect(chip.top).toBeCloseTo(fit.chips[0].top, 0);
      }
      expect(fit.scrollX).toBeLessThanOrEqual(0);
      expect(fit.scrollY).toBeLessThanOrEqual(0);
      const box = (await page.locator(".game-board-panel").boundingBox())!;
      const tray = (await page.locator(".booster-tray").boundingBox())!;
      expect(box.width).toBeCloseTo(box.height, 0);
      expect(box.width).toBeGreaterThanOrEqual(240);
      expect(box.y + box.height).toBeLessThanOrEqual(tray.y);
      expect(tray.y + tray.height).toBeLessThanOrEqual(height);
      await page.screenshot({ path: testInfo.outputPath(`blocker-goals-7x7-${name.replace(/[^a-z]+/g, "-")}-${width}x${height}.png`) });
    });
  }
}


// --- Blocker intro cards, and Play On when short of coins --------------------------------------------------------------

test("the first pane goal shows its card once", async ({ page }, testInfo) => {
  // No seedSave here: its init script would rewrite the save on the reload and forget "Got it".
  await page.setViewportSize({ width: 440, height: 748 });
  await openBlockerLevel(page, PANE_BOARD("k#1"), PANES_GOAL, "&gwIntroCards=1");
  await darkOnly(page);
  const card = page.getByTestId("blocker-intro");
  await expect(card).toBeVisible();
  await expect(card.locator("img.blocker-intro-picture")).toBeVisible();
  await expect(card.getByRole("heading", { name: "Encrypted pane" })).toBeVisible();
  await expect(card).toContainText("The piece underneath is frozen. Make matches next to the pane, or hit it with a power-up, to break it. Each move removes one layer.");
  await page.screenshot({ path: testInfo.outputPath("blocker-intro-card.png") });
  await card.getByRole("button", { name: "Got it" }).click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await waitForBoardReady(page);
  await expect(page.locator('[data-objective-id="panes"]')).toBeVisible();
  await expect(card).toHaveCount(0);
});

test("a mission with two new blockers shows one card at a time", async ({ page }) => {
  await openBlockerLevel(page, realBoard(), GOAL_SETS["pane, lock and malware"] as never, "&gwIntroCards=1");
  const card = page.getByTestId("blocker-intro");
  for (const title of ["Encrypted pane", "Locked cell", "Malware"]) {
    await expect(card.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.locator(".blocker-intro")).toHaveCount(1);
    await card.getByRole("button", { name: "Got it" }).click();
  }
  await expect(card).toHaveCount(0);
});

test("the card stops the boss clock", async ({ page }) => {
  const level = testLevel(PANE_BOARD("k#1"), { moveLimit: 20, objectives: PANES_GOAL });
  level.bossLevel = true;
  level.bossTimerSeconds = 90;
  await page.route("**/levels/level_001.json", route => route.fulfill({ json: level }));
  await page.goto("./?gwTestMode=1&level=1&gwIntroCards=1");
  await expect(page.getByTestId("blocker-intro")).toBeVisible();
  const shown = await page.locator(".timer strong").textContent();
  await page.waitForTimeout(2500);
  await expect(page.locator(".timer strong")).toHaveText(shown!);
  await page.getByRole("button", { name: "Got it" }).click();
  await expect.poll(() => page.locator(".timer strong").textContent(), { timeout: 5000 }).not.toBe(shown);
});

test("Play On short of coins keeps the mission open", async ({ page }) => {
  await seedSave(page, { coins: 100 });
  await page.goto("./?gwTestMode=1&level=1");
  await waitForBoardReady(page);
  await page.getByTestId("qa-fail").click();
  await expect(page.getByText("Play On costs 500 coins. You have 100.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Play On" })).toBeDisabled();
  await expect(page.getByText("Grid compromised")).not.toBeVisible();
  await page.getByRole("button", { name: "End Mission" }).click();
  await expect(page.getByText("Grid compromised")).toBeVisible();
});

test("Play On with enough coins still works", async ({ page }) => {
  await seedSave(page, { coins: 800 });
  await page.goto("./?gwTestMode=1&level=1");
  await waitForBoardReady(page);
  await page.getByTestId("qa-fail").click();
  await expect(page.getByText("Spend 500 coins for 5 extra moves. You have 800.")).toBeVisible();
  await page.getByRole("button", { name: "Play On" }).click();
  await expect(page.getByText("Mission at risk")).not.toBeVisible();
  await expect(page.getByText("Play On accepted: +5 moves.")).toBeVisible();
});
