import { expect, test, type Locator, type Page } from "@playwright/test";

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

interface FakeSavesApi {
  /** Every PUT the app sent, in order. */
  puts: Array<{ slot: string; body: Record<string, unknown> }>;
  /** Every GET the app sent, by slot, in arrival order. */
  gets: string[];
}

function fakeSavesApi(page: Page, rows: Record<string, Row | undefined>, options: { getDelayMs?: number } = {}): FakeSavesApi {
  const puts: FakeSavesApi["puts"] = [];
  const gets: string[] = [];
  page.route("**/api/saves/match/*", async (route) => {
    const request = route.request();
    const slot = new URL(request.url()).pathname.split("/").pop()!;
    if (request.method() === "GET") {
      gets.push(slot);
      // Held open so a test can act in the UI while the reconcile is genuinely in flight.
      if (options.getDelayMs) await new Promise((resolve) => setTimeout(resolve, options.getDelayMs));
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
  return { puts, gets };
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

const settingsRow = (): Row => ({
  slot: "settings", schemaVersion: 1, revision: 1, updatedAt: "2026-09-17T00:00:00Z",
  payload: { musicEnabled: false, sfxEnabled: true, voiceEnabled: true, reducedMotion: false },
});

/** The coin total as `TopBar` actually renders it — not a page-wide substring match. */
const coinTotal = (page: Page): Locator => page.locator("header.top-bar .currency strong");

const savePrompt = (page: Page): Locator => page.locator("dialog.gw-save-prompt");

test.beforeEach(async ({ page }) => {
  await clearStorage(page);
});

test("a pristine first signed-in load uploads nothing; the first real change uploads that slot at revision 0", async ({ page }) => {
  await seedSession(page);
  const { puts } = fakeSavesApi(page, {});
  await page.goto("./?gwTestMode=1");
  await expect(page.getByRole("heading", { name: "GridWatch Match" })).toBeVisible();
  // A brand-new device's local save is bit-for-bit the default: the kit treats that as "no local
  // save" for both slots, so with no cloud row either, reconcile is "nothing" for both — no PUT.
  // 1.5 s, not 0.5 s: the kit debounces stores by 750 ms, so a shorter settle proves nothing.
  await page.waitForTimeout(1_500);
  expect(puts).toEqual([]);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel(/Music/).click();
  await expect.poll(() => puts.length, { timeout: 10_000 }).toBe(1);
  expect(puts[0].slot).toBe("settings");
  expect(puts[0].body.baseRevision).toBe(0);
  await page.waitForTimeout(1_000);
  expect(puts.some((p) => p.slot === "campaign")).toBe(false); // campaign stayed pristine, never stored
});

test("a newer cloud row replaces an untouched local save", async ({ page }) => {
  await seedSession(page);
  fakeSavesApi(page, { campaign: campaignRow(250) });
  await page.goto("./?gwTestMode=1");
  // The device is pristine (bit-for-bit default), so the kit treats it as "no local save to
  // protect" and adopts the existing cloud row silently — no conflict prompt.
  await expect(coinTotal(page)).toHaveText("250", { timeout: 10_000 });
  await expect(savePrompt(page)).toHaveCount(0);
});

test("an edit made while the first reconcile is in flight can never overwrite cloud progress", async ({ page }) => {
  await seedSession(page);
  // A brand-new device signing in to an account that already has real progress in BOTH slots.
  const { puts, gets } = fakeSavesApi(page, { campaign: campaignRow(250), settings: settingsRow() }, { getDelayMs: 2_000 });
  await page.goto("./?gwTestMode=1");
  await expect(page.getByRole("heading", { name: "GridWatch Match" })).toBeVisible();
  // The GETs are held open: everything below happens while the reconcile is genuinely in flight.
  await expect.poll(() => gets.slice().sort()).toEqual(["campaign", "settings"]);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel(/Music/).click();   // a real commitSave, mid-reconcile
  // Let the reconcile settle, then well past the kit's 750 ms store debounce.
  await expect(coinTotal(page)).toHaveText("250", { timeout: 10_000 });
  await page.waitForTimeout(1_500);
  // Nothing was ever pushed: not the pre-reconcile projection, not the in-flight edit to a slot the
  // cloud replaced. The old bug sent a PUT here at the confirmed base revision, with no 409 and no
  // prompt, replacing 250 coins with a near-default campaign.
  expect(puts).toEqual([]);
  await expect(savePrompt(page)).toHaveCount(0);
  await expect(coinTotal(page)).toHaveText("250");
  // And the cloud copy is what got persisted locally, not just what got rendered.
  await page.reload();
  await expect(coinTotal(page)).toHaveText("250", { timeout: 10_000 });
});

test("a signed-in load reconciles exactly once: two GETs, and no more on re-render", async ({ page }) => {
  await seedSession(page);
  const { puts, gets } = fakeSavesApi(page, {});
  await page.goto("./?gwTestMode=1");
  await expect(page.getByRole("heading", { name: "GridWatch Match" })).toBeVisible();
  await page.waitForTimeout(1_500);
  expect(gets.slice().sort()).toEqual(["campaign", "settings"]);
  expect(puts).toEqual([]);
  // Re-rendering the tree (and re-emitting the session object) must not reconcile again.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.waitForTimeout(1_500);
  expect(gets.slice().sort()).toEqual(["campaign", "settings"]);
  expect(puts).toEqual([]);
});

test("a settings change stores only the settings slot", async ({ page }) => {
  await seedSession(page);
  const { puts } = fakeSavesApi(page, {});
  await page.goto("./?gwTestMode=1");
  await page.waitForTimeout(1_500);
  expect(puts).toEqual([]); // pristine device: reconcile uploads nothing for either slot
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel(/Music/).click();
  await expect.poll(() => puts.length, { timeout: 10_000 }).toBe(1);
  expect(puts[0].slot).toBe("settings");
  expect((puts[0].body.payload as { musicEnabled: boolean }).musicEnabled).toBe(false);
  await page.waitForTimeout(1_000);
  expect(puts.some((p) => p.slot === "campaign")).toBe(false); // campaign stayed pristine, never stored
});

test("a conflicting store shows the prompt; 'Use cloud' applies the cloud copy, 'Keep this one' re-sends", async ({ page }) => {
  await seedSession(page);
  const rows: Record<string, Row | undefined> = {};
  const { puts } = fakeSavesApi(page, rows);
  await page.goto("./?gwTestMode=1");
  await expect(page.getByRole("heading", { name: "GridWatch Match" })).toBeVisible();
  await page.waitForTimeout(1_500);
  expect(puts).toEqual([]); // pristine device, no cloud row yet: reconcile uploads nothing
  // Give the campaign slot a real local change and let it sync, so the device becomes a known,
  // non-pristine peer before the conflict setup below.
  await page.getByRole("button", { name: "Intel", exact: true }).click();
  await page.getByRole("button", { name: "Mark Reviewed" }).first().click();
  await expect.poll(() => puts.length, { timeout: 10_000 }).toBe(1);
  expect(puts[0].slot).toBe("campaign");
  expect(puts[0].body.baseRevision).toBe(0);
  // Another device moved the campaign on.
  rows.campaign = { ...campaignRow(900), revision: 5 };
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Reset Local Save" }).click();           // commits campaign (intel cleared)
  const dialog = savePrompt(page);
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog).toContainText("Newer save in the cloud from another device");
  await dialog.getByRole("button", { name: "Use cloud" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(coinTotal(page)).toHaveText("900");

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
  const { puts, gets } = fakeSavesApi(page, {});
  await page.goto("./?gwTestMode=1");
  await expect(page.getByRole("heading", { name: "GridWatch Match" })).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel(/Music/).click();
  await page.waitForTimeout(1_500);
  expect(gets).toEqual([]);
  expect(puts).toEqual([]);
});
