import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { fakeSavesApi, seedSession, type Row } from "./helpers/cloudSaves";

// Spec §6: the carry hand-off, end to end, across two real origins served by ONE preview server.
// `localhost:4173` plays the old hostname; `127.0.0.1:4173` is Nexus (VITE_NEXUS_ORIGIN), and the
// old origin is a permitted sender only because playwright.config.ts sets VITE_CARRY_TEST_ORIGIN.
const OLD = "http://localhost:4173";
const NEXUS = "http://127.0.0.1:4173";
const OLD_URL = `${OLD}/play/match/`;
const SAVE_KEY = "gridwatch-match-web.save.v1";

/** Seeds a local save on ONE origin, the way presentation.spec.ts seeds settings: the app's
 *  localStorage mirror, which `loadSaveState` reads whenever IndexedDB holds nothing — true for any
 *  origin this app has not yet persisted on. Installed on the CONTEXT so it also reaches the popup
 *  the hand-off opens. Re-runs on every load; a later call wins, since init scripts run in order. */
async function seedProgress(page: Page, origin: string, coins: number): Promise<void> {
  await page.context().addInitScript(([key, only, amount]) => {
    if (location.origin !== only) return;
    localStorage.setItem(key, JSON.stringify({ version: 1, coins: amount }));
  }, [SAVE_KEY, origin, coins] as const);
}

/** The coins this origin has persisted, read the way `loadSaveState` reads them: IndexedDB first,
 *  then the localStorage mirror. Never creates the database on an origin that has none. */
function storedCoins(page: Page): Promise<number | null> {
  return page.evaluate(async (key) => {
    const known = await indexedDB.databases();
    let raw: string | null = null;
    if (known.some((db) => db.name === "gridwatch-match-web")) {
      raw = await new Promise<string | null>((resolve) => {
        const open = indexedDB.open("gridwatch-match-web");
        open.onerror = () => resolve(null);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("kv")) { db.close(); resolve(null); return; }
          const get = db.transaction("kv", "readonly").objectStore("kv").get("save-state-v1");
          get.onsuccess = () => { db.close(); resolve(typeof get.result === "string" ? get.result : null); };
          get.onerror = () => { db.close(); resolve(null); };
        };
      });
    }
    raw ??= localStorage.getItem(key);
    if (!raw) return null;
    return (JSON.parse(raw) as { coins?: number }).coins ?? null;
  }, SAVE_KEY);
}

const nexusCoins = storedCoins;

/** The coin total as `TopBar` renders it. */
const coinTotal = (page: Page): Locator => page.locator("header.top-bar .currency strong");
const banner = (page: Page): Locator => page.getByRole("complementary", { name: "GridWatch Match has moved" });
const moveButton = (page: Page): Locator => page.getByRole("button", { name: "Move my progress" });

async function clickMove(page: Page): Promise<Page> {
  const [popup] = await Promise.all([page.waitForEvent("popup"), moveButton(page).click()]);
  return popup;
}

async function expectMoved(page: Page): Promise<void> {
  await expect(banner(page)).toContainText("Your progress is on the new site.");
  await expect(banner(page).getByRole("link", { name: "Continue there" })).toHaveAttribute("href", `${NEXUS}/play/match/`);
  await expect(moveButton(page)).toHaveCount(0);
}

interface CarryProbe {
  __carryReadyHeld(): boolean;
  __releaseCarryReady(): boolean;
  __carryResultAt?: number;
}

/**
 * Old origin only: holds Nexus's `ready` message until the test releases it, and stamps (on this
 * page's clock, which is the test process's wall clock too) the moment the hand-off's `result`
 * arrives. The hold is what makes "the cloud waits for the hand-off" checkable without a race: the
 * popup is loaded, signed in and idle for as long as the test likes, with the offer not yet sent.
 * The released message is re-dispatched with its real `origin` and `source`, so the kit's sender
 * checks it exactly as it would the original.
 */
async function probeOldOrigin(context: BrowserContext): Promise<void> {
  await context.addInitScript((oldOrigin) => {
    if (location.origin !== oldOrigin) return;
    const probe = window as unknown as CarryProbe;
    let held: MessageEvent | null = null;
    let replaying = false;
    probe.__carryReadyHeld = () => held !== null;
    probe.__releaseCarryReady = () => {
      if (!held) return false;
      const original = held;
      held = null;
      replaying = true;
      try {
        window.dispatchEvent(new MessageEvent("message", { data: original.data, origin: original.origin, source: original.source }));
      } finally {
        replaying = false;
      }
      return true;
    };
    // Registered before any app script, so at the window target it runs ahead of the kit's listener.
    window.addEventListener("message", (event) => {
      const data = event.data as { gw?: unknown; type?: unknown } | null;
      if (!data || data.gw !== "carry") return;
      if (data.type === "ready" && !replaying && held === null) {
        held = event;
        event.stopImmediatePropagation();
      } else if (data.type === "result") {
        probe.__carryResultAt = Date.now();
      }
    }, true);
  }, OLD);
}

test("moves progress into an empty Nexus origin", async ({ page }) => {
  await seedProgress(page, OLD, 40);
  await page.goto(OLD_URL);
  await expect(moveButton(page)).toBeVisible();

  const popup = await clickMove(page);
  await expect(popup.getByRole("status").filter({ hasText: "Progress moved from the old site." })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => nexusCoins(popup)).toBe(40);
  await expect(coinTotal(popup)).toHaveText("40");
  await expect.poll(() => popup.url()).toBe(`${NEXUS}/play/match/`); // the receiver dropped #gw-carry
  expect(popup.url()).not.toContain("#gw-carry");

  await expectMoved(page);
  await page.reload();
  await expectMoved(page);
  expect(await storedCoins(page)).toBe(40); // the old origin's own save is untouched
});

test("asks before replacing progress on Nexus; \"Keep this site's\" changes nothing", async ({ page }) => {
  await seedProgress(page, NEXUS, 7);
  await seedProgress(page, OLD, 40);
  await page.goto(OLD_URL);

  const popup = await clickMove(page);
  const dialog = popup.locator("dialog.gw-save-prompt");
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog).toContainText("Replace the progress on this site with your progress from the old site?");
  await dialog.getByRole("button", { name: "Keep this site's" }).click();

  await expect(banner(page).getByRole("status")).toHaveText("You kept the progress already on the new site. Nothing changed here.");
  await expect(coinTotal(popup)).toHaveText("7");
  expect(await nexusCoins(popup)).toBe(7);
  await expect(popup.getByText("Progress moved from the old site.")).toHaveCount(0);
  await expect(moveButton(page)).toBeVisible(); // nothing moved, so the offer stands
  expect(await storedCoins(page)).toBe(40);
});

test("asks, and \"Replace\" moves it", async ({ page }) => {
  await seedProgress(page, NEXUS, 7);
  await seedProgress(page, OLD, 40);
  await page.goto(OLD_URL);

  const popup = await clickMove(page);
  const dialog = popup.locator("dialog.gw-save-prompt");
  await expect(dialog).toContainText("Replace the progress on this site with your progress from the old site?", { timeout: 15_000 });
  await dialog.getByRole("button", { name: "Replace", exact: true }).click();

  await expect(popup.getByRole("status").filter({ hasText: "Progress moved from the old site." })).toBeVisible();
  await expect.poll(() => nexusCoins(popup)).toBe(40);
  await expect(coinTotal(popup)).toHaveText("40");
  await expectMoved(page);
  expect(await storedCoins(page)).toBe(40);
});

test("nothing to move: the old origin just points at the new site", async ({ page }) => {
  await page.goto(OLD_URL);
  await expect(banner(page)).toContainText("GridWatch Match has moved.");
  await expect(banner(page).getByRole("link", { name: "Play on the new site" })).toHaveAttribute("href", "http://127.0.0.1:4173/play/match/");
  await expect(moveButton(page)).toHaveCount(0);
});

test("new progress after a move offers the move again", async ({ page }) => {
  await seedProgress(page, OLD, 40);
  await page.goto(OLD_URL);
  const popup = await clickMove(page);
  await expect(popup.getByRole("status").filter({ hasText: "Progress moved from the old site." })).toBeVisible({ timeout: 15_000 });
  await expectMoved(page);

  await seedProgress(page, OLD, 55); // runs after the 40-coin script, so it wins on the reload
  await page.reload();
  await expect(banner(page)).toContainText("You have new progress since you moved.");
  await expect(moveButton(page)).toBeVisible();
  expect(await storedCoins(page)).toBe(55);
});

test("signed in: no saves GET before the hand-off settles, then the carried campaign uploads at revision 0", async ({ page }) => {
  test.setTimeout(60_000);
  const context = page.context();
  // Nexus only: signed in, with no cloud row for either slot. The old origin stays signed out.
  await seedSession(context, NEXUS);
  const rows: Record<string, Row | undefined> = {};
  const api = await fakeSavesApi(context, rows);
  await probeOldOrigin(context);
  await seedProgress(page, OLD, 40);
  await page.goto(OLD_URL);

  const popup = await clickMove(page);
  // Nexus has loaded, is signed in, and has asked for the offer — which the probe is holding.
  await expect.poll(() => page.evaluate(() => (window as unknown as CarryProbe).__carryReadyHeld()), { timeout: 15_000 }).toBe(true);
  await expect(popup.getByRole("heading", { name: "GridWatch Match" })).toBeVisible();
  // 1.5 s, the cloud-saves settle: ample for a signed-in load to reach its first reconcile.
  await popup.waitForTimeout(1_500);
  expect(api.gets).toEqual([]); // the cloud start is waiting for `receive`, not racing it
  expect(api.puts).toEqual([]);

  expect(await page.evaluate(() => (window as unknown as CarryProbe).__releaseCarryReady())).toBe(true);
  await expect(popup.getByRole("status").filter({ hasText: "Progress moved from the old site." })).toBeVisible({ timeout: 15_000 });
  await expectMoved(page);
  const resultAt = await page.evaluate(() => (window as unknown as CarryProbe).__carryResultAt ?? null);
  expect(resultAt).not.toBeNull();

  // The first reconcile runs only now, and uploads the carried campaign as a new row: base 0.
  await expect.poll(() => api.puts.filter((p) => p.slot === "campaign").length, { timeout: 20_000 }).toBe(1);
  await popup.waitForTimeout(1_500); // the kit debounces stores by 750 ms: no second PUT follows
  expect(api.puts.map((p) => p.slot)).toEqual(["campaign"]);
  expect(api.puts[0].body.baseRevision).toBe(0);
  expect((api.puts[0].body.payload as { coins?: number }).coins).toBe(40);
  expect(rows.campaign?.revision).toBe(1);

  // Every saves GET came after the old page had the popup's answer.
  const campaignGets = api.getLog.filter((g) => g.slot === "campaign");
  expect(campaignGets.length).toBeGreaterThan(0);
  for (const get of api.getLog) expect(get.at).toBeGreaterThanOrEqual(resultAt!);
  expect(await storedCoins(page)).toBe(40);
});
