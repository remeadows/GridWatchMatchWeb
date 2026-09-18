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
  /** When set, every PUT is answered with this status instead of being applied. 503 is retried by
   *  the kit and leaves its sync record dirty; a plain 4xx is terminal and leaves it CLEAN, which
   *  is what isolates the app's own unsynced flag. */
  failPuts: number | null;
}

function fakeSavesApi(page: Page, rows: Record<string, Row | undefined>, options: { getDelayMs?: number } = {}): FakeSavesApi {
  const api: FakeSavesApi = { puts: [], gets: [], failPuts: null };
  page.route("**/api/saves/match/*", async (route) => {
    const request = route.request();
    const slot = new URL(request.url()).pathname.split("/").pop()!;
    if (request.method() === "GET") {
      api.gets.push(slot);
      // Held open so a test can act in the UI while the reconcile is genuinely in flight.
      if (options.getDelayMs) await new Promise((resolve) => setTimeout(resolve, options.getDelayMs));
      const row = rows[slot];
      return route.fulfill(row ? { status: 200, contentType: "application/json", body: JSON.stringify(row) } : { status: 404, contentType: "application/json", body: JSON.stringify({ error: "no_save" }) });
    }
    const body = request.postDataJSON() as Record<string, unknown>;
    api.puts.push({ slot, body });
    if (api.failPuts !== null) {
      return route.fulfill({ status: api.failPuts, contentType: "application/json", body: JSON.stringify({ error: "upload_failed" }) });
    }
    const current = rows[slot];
    const base = body.baseRevision as number;
    if ((current?.revision ?? 0) !== base) {
      return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "conflict", cloud: { revision: current?.revision ?? 0, updatedAt: "2026-09-17T00:00:00Z", summary: { schemaVersion: 1, sizeBytes: 2, payloadDigest: "00", deviceId: null } } }) });
    }
    rows[slot] = { slot, schemaVersion: 1, revision: base + 1, payload: body.payload as Record<string, unknown>, updatedAt: new Date().toISOString() };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ revision: base + 1, updatedAt: rows[slot]!.updatedAt }) });
  });
  return api;
}

const UNSYNCED_KEY = "gridwatch-match-web.cloud-unsynced.v1";

/** The app's persisted per-slot "the cloud has never confirmed this" flags. */
function unsyncedFlags(page: Page): Promise<string[]> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return Object.keys(parsed).filter((slot) => parsed[slot] === true).sort();
    } catch {
      return [];
    }
  }, UNSYNCED_KEY);
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

/**
 * Shared setup for the unsynced-flag scenarios.
 *
 * Leaves the app: signed in, settled, local `settings` adopted from cloud revision 1, then a real
 * local change (Voice Lines off) whose upload FAILED — so the app's unsynced flag is set while the
 * player's change exists only on this device. `failStatus` decides what the kit itself remembers:
 * 503 is retried and leaves its record dirty; 403 is terminal and leaves it CLEAN, which is the
 * case where the app's own flag is the only thing standing between the player and a silent
 * replacement.
 */
async function heldLocalChange(page: Page, rows: Record<string, Row | undefined>, failStatus: number) {
  const api = fakeSavesApi(page, rows);
  await page.goto("./?gwTestMode=1");
  await expect(page.getByRole("heading", { name: "GridWatch Match" })).toBeVisible();
  await page.waitForTimeout(1_500); // pristine device adopts the cloud settings row, stores nothing
  expect(api.puts).toEqual([]);
  expect(await unsyncedFlags(page)).toEqual([]);

  api.failPuts = failStatus;
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel(/Voice Lines/).click();
  await expect.poll(() => api.puts.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(3_000); // let the kit exhaust its bounded retries and give up
  // The change was never confirmed by the cloud, so the flag stays set — across the reload below.
  expect(await unsyncedFlags(page)).toEqual(["settings"]);
  expect(await page.getByLabel(/Voice Lines/).isChecked()).toBe(false);

  api.failPuts = null;
  api.puts.length = 0; // only the post-reload PUTs matter from here
  return api;
}

const newerSettingsRow = (): Row => ({
  slot: "settings", schemaVersion: 1, revision: 2, updatedAt: "2026-09-17T12:00:00Z",
  payload: { musicEnabled: false, sfxEnabled: false, voiceEnabled: true, reducedMotion: false },
});

test("unsynced local progress survives a reload and prompts instead of being replaced", async ({ page }) => {
  await seedSession(page);
  const rows: Record<string, Row | undefined> = { settings: settingsRow() };
  // 403: terminal for the kit, so ITS record stays { revision: 1, dirty: false }. Without the app's
  // persisted flag the next reconcile would answer use_cloud and the held change would vanish.
  const api = await heldLocalChange(page, rows, 403);
  rows.settings = newerSettingsRow(); // another device moved the cloud on while we were failing

  await page.reload();
  const dialog = savePrompt(page);
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog).toContainText("Newer save in the cloud from another device");
  await dialog.getByRole("button", { name: "Keep this one" }).click();
  await expect(dialog).toBeHidden();

  await expect.poll(() => api.puts.filter((p) => p.slot === "settings").length, { timeout: 10_000 }).toBe(1);
  expect(api.puts[0].body.baseRevision).toBe(2); // the cloud revision the prompt was raised against
  expect((api.puts[0].body.payload as { voiceEnabled: boolean }).voiceEnabled).toBe(false);
  expect(rows.settings!.revision).toBe(3);
  expect(api.puts.some((p) => p.slot === "campaign")).toBe(false);
  // The player's change survived, and the slot is synced again.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel(/Voice Lines/)).not.toBeChecked();
  await expect.poll(() => unsyncedFlags(page), { timeout: 10_000 }).toEqual([]);
});

test("unsynced local progress can still be abandoned: 'Use cloud' takes the cloud copy and clears the flag", async ({ page }) => {
  await seedSession(page);
  const rows: Record<string, Row | undefined> = { settings: settingsRow() };
  const api = await heldLocalChange(page, rows, 403);
  rows.settings = newerSettingsRow();

  await page.reload();
  const dialog = savePrompt(page);
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole("button", { name: "Use cloud" }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel(/Voice Lines/)).toBeChecked();       // the cloud value
  await expect(page.getByLabel(/Sound Effects/)).not.toBeChecked(); // ...all of it
  await expect.poll(() => unsyncedFlags(page), { timeout: 10_000 }).toEqual([]);
  await page.waitForTimeout(1_500);
  expect(api.puts).toEqual([]); // nothing is pushed when the local copy was abandoned
  expect(rows.settings!.revision).toBe(2);
});

test("a 503 upload leaves the slot flagged and the change still prompts after a reload", async ({ page }) => {
  await seedSession(page);
  const rows: Record<string, Row | undefined> = { settings: settingsRow() };
  const api = await heldLocalChange(page, rows, 503); // retried by the kit, record left dirty
  rows.settings = newerSettingsRow();

  await page.reload();
  const dialog = savePrompt(page);
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole("button", { name: "Keep this one" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => api.puts.filter((p) => p.slot === "settings" && p.body.baseRevision === 2).length, { timeout: 10_000 }).toBe(1);
  await expect.poll(() => unsyncedFlags(page), { timeout: 10_000 }).toEqual([]);
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
