import { expect, test, type Page } from "@playwright/test";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_KEY = "sb-mggxfzzxrpjgpzhwiwqi-auth-token";

async function seedSession(page: Page): Promise<void> {
  await page.addInitScript(([key, userId]) => {
    if (localStorage.getItem(key)) return;
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem(key, JSON.stringify({
      access_token: "e2e-access-token-0123456789", token_type: "bearer", expires_in: 3600, expires_at: expiresAt, refresh_token: "e2e-refresh",
      user: { id: userId, aud: "authenticated", role: "authenticated", email: "e2e@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
    }));
  }, [SESSION_KEY, USER_ID] as const);
  // Profile lookup from the account bar: answer "no handle" without touching the network.
  await page.route("https://mggxfzzxrpjgpzhwiwqi.supabase.co/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
}

type Row = { slot: string; schemaVersion: number; revision: number; payload: Record<string, unknown>; updatedAt: string };

function fakeSavesApi(page: Page, rows: Record<string, Row | undefined>) {
  const puts: Array<{ slot: string; body: Record<string, unknown> }> = [];
  page.route("**/api/saves/match/*", async (route) => {
    const request = route.request();
    const slot = new URL(request.url()).pathname.split("/").pop()!;
    if (request.method() === "GET") {
      const row = rows[slot];
      return route.fulfill(row ? { status: 200, contentType: "application/json", body: JSON.stringify(row) } : { status: 404, contentType: "application/json", body: JSON.stringify({ error: "no_save" }) });
    }
    const body = request.postDataJSON() as Record<string, unknown>;
    puts.push({ slot, body });
    const current = rows[slot];
    const base = body.baseRevision as number;
    if ((current?.revision ?? 0) !== base) {
      return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "conflict", cloud: { revision: current?.revision ?? 0, updatedAt: "2026-09-17T00:00:00Z", summary: { schemaVersion: 1, sizeBytes: 2, payloadDigest: "00", deviceId: null } } }) });
    }
    rows[slot] = { slot, schemaVersion: 1, revision: base + 1, payload: body.payload as Record<string, unknown>, updatedAt: new Date().toISOString() };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ revision: base + 1, updatedAt: rows[slot]!.updatedAt }) });
  });
  return puts;
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

const campaignRow = (coins: number): Row => ({
  slot: "campaign", schemaVersion: 1, revision: 1, updatedAt: "2026-09-17T00:00:00Z",
  payload: { coins, boosters: { rocket: 3, rocketVertical: 3, tnt: 3, propeller: 3, lightBall: 3 }, selectedHeroId: "rusty", completedTutorial: false, tutorialReplayRequested: false, levels: {}, areaRewards: {}, intelSeen: {} },
});

test.beforeEach(async ({ page }) => {
  await clearStorage(page);
});

test("first signed-in load with no cloud row uploads both slots as revision 1", async ({ page }) => {
  await seedSession(page);
  const puts = fakeSavesApi(page, {});
  await page.goto("./?gwTestMode=1");
  await expect(page.getByRole("heading", { name: "GridWatch Match" })).toBeVisible();
  await expect.poll(() => puts.map((p) => p.slot).sort(), { timeout: 10_000 }).toEqual(["campaign", "settings"]);
  for (const put of puts) expect(put.body.baseRevision).toBe(0);
});

test("a newer cloud row replaces an untouched local save", async ({ page }) => {
  await seedSession(page);
  fakeSavesApi(page, { campaign: campaignRow(250) });
  await page.goto("./?gwTestMode=1");
  // The kit has no local sync record yet on a fresh browser, so it cannot assume the local
  // (untouched) default is worthless — it always asks before overwriting. Answer "Use cloud".
  const dialog = page.locator("dialog.gw-save-prompt");
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole("button", { name: "Use cloud" }).click();
  await expect(page.getByText("250", { exact: false }).first()).toBeVisible({ timeout: 10_000 });
});

test("a settings change stores only the settings slot", async ({ page }) => {
  await seedSession(page);
  const puts = fakeSavesApi(page, {});
  await page.goto("./?gwTestMode=1");
  await expect.poll(() => puts.length, { timeout: 10_000 }).toBe(2);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel(/Music/).click();
  await expect.poll(() => puts.length, { timeout: 10_000 }).toBe(3);
  expect(puts[2].slot).toBe("settings");
  expect((puts[2].body.payload as { musicEnabled: boolean }).musicEnabled).toBe(false);
});

test("a conflicting store shows the prompt; 'Use cloud' applies the cloud copy, 'Keep this one' re-sends", async ({ page }) => {
  await seedSession(page);
  const rows: Record<string, Row | undefined> = {};
  const puts = fakeSavesApi(page, rows);
  await page.goto("./?gwTestMode=1");
  await expect.poll(() => puts.length, { timeout: 10_000 }).toBe(2);
  // Give the campaign slot a real local change first: a fresh local save is bit-for-bit the
  // default, so "Reset Local Save" alone would be a no-op diff and send nothing.
  await page.getByRole("button", { name: "Intel", exact: true }).click();
  await page.getByRole("button", { name: "Mark Reviewed" }).first().click();
  await expect.poll(() => puts.length, { timeout: 10_000 }).toBe(3);
  // Another device moved the campaign on.
  rows.campaign = { ...campaignRow(900), revision: 5 };
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Reset Local Save" }).click();           // commits campaign (intel cleared)
  const dialog = page.locator("dialog.gw-save-prompt");
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog).toContainText("Newer save in the cloud from another device");
  await dialog.getByRole("button", { name: "Use cloud" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByText("900", { exact: false }).first()).toBeVisible();

  rows.campaign = { ...rows.campaign!, revision: 9 };
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Reset Local Save" }).click();
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole("button", { name: "Keep this one" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => puts.filter((p) => p.slot === "campaign" && p.body.baseRevision === 9).length, { timeout: 10_000 }).toBe(1);
  expect(rows.campaign!.revision).toBe(10);
});

test("signed out stays local-only: no saves requests at all", async ({ page }) => {
  const puts = fakeSavesApi(page, {});
  await page.goto("./?gwTestMode=1");
  await expect(page.getByRole("heading", { name: "GridWatch Match" })).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel(/Music/).click();
  await page.waitForTimeout(1500);
  expect(puts).toEqual([]);
});
