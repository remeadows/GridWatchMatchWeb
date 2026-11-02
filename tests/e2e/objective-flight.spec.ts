import { expect, test, type Page } from "@playwright/test";
import type { PresentationTraceEntry } from "../../src/game/presentation";

// Pieces that count for an objective fly to it, and the count rises as they land
// (src/game/objectiveFlight.ts, src/game/pieceFlights.ts). Dark board only: the archived classic
// board, which a GW_THEME=classic build of this suite runs on, keeps its old behaviour.
async function openLevel(page: Page, url = "./?gwTestMode=1&level=1"): Promise<void> {
  await page.goto(url);
  const theme = await page.evaluate(() => document.documentElement.dataset.boardTheme);
  test.skip(theme !== "darkRealism", "the archived classic board has no flights");
  await page.waitForFunction(() => (window as Window & { __gwBoardReady?: boolean }).__gwBoardReady === true);
}

async function swap(page: Page): Promise<void> {
  const point = (row: number, col: number) => page.evaluate(([r, c]) =>
    (window as Window & { __gwBoardCellClientPoint?: (row: number, col: number) => { x: number; y: number } | null })
      .__gwBoardCellClientPoint?.(r, c) ?? null, [row, col]);
  const from = (await point(0, 0))!;
  const to = (await point(1, 0))!;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
}

const flights = (page: Page) => page.locator(".piece-flight");
const chip = (page: Page) => page.locator('[data-objective-id="collect"]');
const flown = (page: Page) => page.evaluate(() =>
  ((window as Window & { __gwPresentationTrace?: PresentationTraceEntry[] }).__gwPresentationTrace ?? [])
    .filter((entry) => entry.kind === "objective-fly").length);
const finished = (page: Page) => page.waitForFunction(() =>
  ((window as Window & { __gwPresentationTrace?: PresentationTraceEntry[] }).__gwPresentationTrace ?? [])
    .some((entry) => entry.kind === "resolution-complete"));

test("each piece that counts flies up to its objective, and the count rises only as they land", async ({ page }) => {
  await openLevel(page);
  await expect(chip(page)).toContainText("0/20");
  // One flight, watched every frame from inside the page: the pop follows the swap so closely that
  // a flight can be most of the way there by the time a query from out here reaches it.
  const track = page.evaluate(() => new Promise<{ y: number; count: string }[]>((resolve) => {
    const seen: { y: number; count: string }[] = [];
    let flight: Element | null = null;
    const look = () => {
      flight ??= document.querySelector(".piece-flight");
      if (flight && !flight.isConnected) { resolve(seen); return; }
      if (flight) {
        const box = flight.getBoundingClientRect();
        seen.push({ y: box.top + box.height / 2, count: document.querySelector('[data-objective-id="collect"]')?.textContent ?? "" });
      }
      requestAnimationFrame(look);
    };
    look();
  }));
  await swap(page);
  const path = await track;
  expect(path.length).toBeGreaterThan(5);
  expect(path.at(-1)!.y).toBeLessThan(path[0].y);
  expect(path[0].count).toContain("0/20");

  await expect(flights(page)).toHaveCount(0);
  await finished(page);
  const count = await flown(page);
  expect(count).toBeGreaterThanOrEqual(3);
  await expect(chip(page)).toContainText(`${count}/20`);
});

test("a flight lands on the objective's own picture", async ({ page }) => {
  await openLevel(page);
  const target = (await page.locator('[data-objective-id="collect"] .objective-picture').boundingBox())!;
  await swap(page);
  await expect(flights(page).first()).toBeVisible();
  // The last sighting of the first flight, read every frame until it is gone.
  const last = await page.evaluate(() => new Promise<{ x: number; y: number } | null>((resolve) => {
    let seen: { x: number; y: number } | null = null;
    const look = () => {
      const flight = document.querySelector(".piece-flight");
      if (!flight) { resolve(seen); return; }
      const box = flight.getBoundingClientRect();
      seen = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      requestAnimationFrame(look);
    };
    look();
  }));
  expect(Math.abs(last!.x - (target.x + target.width / 2))).toBeLessThan(target.width);
  expect(Math.abs(last!.y - (target.y + target.height / 2))).toBeLessThan(target.height);
});

test("leaving the level mid-flight leaves nothing in the air", async ({ page }) => {
  await openLevel(page);
  await swap(page);
  await expect(flights(page).first()).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(flights(page)).toHaveCount(0);
  await expect(page.getByTestId("piece-flights")).toHaveCount(0);
});

test("with reduced motion nothing flies and the count simply moves", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openLevel(page);
  await swap(page);
  await finished(page);
  await expect(flights(page)).toHaveCount(0);
  await expect(chip(page)).not.toContainText("0/20");
});
