import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type { GridPosition, LevelDefinition, TileType } from "../../src/engine";
import type { PresentationTraceEntry } from "../../src/game/presentation";
import type { ResolutionFrameAudit } from "../../src/game/resolutionPlayback";

test("each simultaneous match opens from its own center even when different families touch", async ({ page }) => {
  const specimens = JSON.parse(readFileSync("src/tests/fixtures/resolution/specimens.json", "utf8")) as { level: LevelDefinition }[];
  const level = structuredClone(specimens[0].level);
  const colors: TileType[] = ["packet", "firewall", "key", "threat", "zeroDay"];
  level.cellMap = Array.from({ length: 7 }, (_, row) => Array.from({ length: 7 }, (_, col) => ({
    tile: colors[(row * 2 + col) % colors.length], powerUp: null, overlay: null, underlay: null, generator: null, locked: false
  })));
  const replacements: [number, number, TileType][] = [[1, 3, "firewall"], [2, 3, "firewall"], [3, 3, "packet"],
    [3, 4, "firewall"], [4, 4, "packet"], [5, 4, "packet"], [4, 3, "threat"]];
  for (const [row, col, tile] of replacements) level.cellMap[row][col].tile = tile;
  await page.route("**/levels/level_001.json", route => route.fulfill({ json: level }));
  await open(page);
  await drag(page, { row: 3, col: 3 }, { row: 3, col: 4 });
  const { trace, frames } = await completed(page);
  const clear = frames.find(frame => frame.kind === "clear")!;
  const impacts = trace.filter(entry => entry.kind === "tile-impact" && entry.atMs <= clear.atMs);
  expect(impacts).toHaveLength(6);
  for (const [center, edges] of [["2,3", ["1,3", "3,3"]], ["4,4", ["3,4", "5,4"]]] as const) {
    const middle = impacts.find(entry => entry.detail === center)!;
    for (const edge of edges) expect(middle.atMs).toBeLessThanOrEqual(impacts.find(entry => entry.detail === edge)!.atMs);
  }
});

test("each cascade recognizes the landed board and holds open cells before the next fall", async ({ page }) => {
  await open(page);
  await drag(page, { row: 4, col: 2 }, { row: 5, col: 2 });
  const { trace, frames } = await completed(page);
  const clears = frames.filter(frame => frame.kind === "clear");
  expect(clears).toHaveLength(3);
  const recognition = trace.filter(entry => entry.kind === "match-recognition-start");
  expect(recognition).toHaveLength(clears.length);
  for (const clear of clears) {
    const start = recognition.find(entry => entry.detail === String(clear.ordinal))!;
    const recognized = trace.find(entry => entry.kind === "match-recognition-complete" && entry.detail === String(clear.ordinal))!;
    const previous = frames.filter(frame => frame.ordinal < clear.ordinal).at(-1)!;
    expect(start.atMs).toBeGreaterThanOrEqual(previous.atMs);
    expect(recognized.atMs).toBeGreaterThan(start.atMs);
    const impacts = trace.filter(entry => entry.kind === "tile-impact" && entry.atMs >= start.atMs && entry.atMs <= clear.atMs);
    expect(impacts.length).toBeGreaterThan(0);
    const holdComplete = trace.find(entry => entry.kind === "match-open-complete" && entry.atMs >= start.atMs && entry.atMs <= clear.atMs)!;
    expect(holdComplete.atMs).toBeGreaterThan(Math.max(...impacts.map(entry => entry.atMs)));
    const fall = trace.find(entry => entry.kind === "cascade-start" && entry.atMs >= clear.atMs)!;
    expect(fall.atMs).toBeGreaterThanOrEqual(holdComplete.atMs);
    for (const impact of impacts) expect(impact.atMs).toBeGreaterThanOrEqual(recognized.atMs);
  }
});

async function open(page: Page) {
  await page.goto("./?gwTestMode=1&level=1");
  await page.waitForFunction(() => (window as Window & { __gwBoardReady?: boolean }).__gwBoardReady);
}

async function drag(page: Page, from: GridPosition, to: GridPosition) {
  await page.evaluate(({ from, to }) => {
    const point = (window as unknown as { __gwBoardCellClientPoint: (row: number, col: number) => { x: number; y: number } }).__gwBoardCellClientPoint;
    const start = point(from.row, from.col), end = point(to.row, to.col);
    const canvas = document.querySelector("[data-testid=board-canvas] canvas")!;
    const dispatch = (type: string, x: number, y: number, buttons: number) => canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, button: 0, buttons, clientX: x, clientY: y,
      isPrimary: true, pointerId: 1, pointerType: "mouse", view: window
    }));
    dispatch("pointerdown", start.x, start.y, 1);
    for (let i = 1; i <= 12; i++) dispatch("pointermove", start.x + (end.x - start.x) * i / 12, start.y + (end.y - start.y) * i / 12, 1);
    dispatch("pointerup", end.x, end.y, 0);
  }, { from, to });
}

async function completed(page: Page) {
  await page.waitForFunction(() => (window as Window & { __gwPresentationTrace?: PresentationTraceEntry[] })
    .__gwPresentationTrace?.some(entry => entry.kind === "resolution-complete"));
  return page.evaluate(() => {
    const target = window as Window & { __gwPresentationTrace?: PresentationTraceEntry[]; __gwResolutionFrames?: ResolutionFrameAudit[] };
    return { trace: target.__gwPresentationTrace!, frames: target.__gwResolutionFrames! };
  });
}
