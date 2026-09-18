import { expect, test, type Locator, type Page } from "@playwright/test";
import { RETRY_THROTTLE_PARAM } from "../../src/services/cloudGate";

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
   *  is what isolates the app's own unsynced flag. Read when the PUT ARRIVES, so arming it while an
   *  earlier PUT is still held open cannot retroactively fail that one. */
  failPuts: number | null;
  /** Per-slot GET failure status, so one slot can error while the other answers a real row. */
  failGets: Record<string, number | undefined>;
  /** Responses held open, so a test can act in the UI while a request is genuinely in flight.
   *  Mutable rather than constructor-only: a scenario often needs to hold only a LATER phase's
   *  requests (e.g. the reconcile after a reload, not the one that set the scene up). */
  getDelayMs: number;
  putDelayMs: number;
}

function fakeSavesApi(page: Page, rows: Record<string, Row | undefined>, options: { getDelayMs?: number } = {}): FakeSavesApi {
  const api: FakeSavesApi = { puts: [], gets: [], failPuts: null, failGets: {}, getDelayMs: options.getDelayMs ?? 0, putDelayMs: 0 };
  page.route("**/api/saves/match/*", async (route) => {
    const request = route.request();
    const slot = new URL(request.url()).pathname.split("/").pop()!;
    if (request.method() === "GET") {
      api.gets.push(slot);
      const failStatus = api.failGets[slot];
      // Held open so a test can act in the UI while the reconcile is genuinely in flight.
      if (api.getDelayMs) await new Promise((resolve) => setTimeout(resolve, api.getDelayMs));
      if (failStatus !== undefined) {
        return route.fulfill({ status: failStatus, contentType: "application/json", body: JSON.stringify({ error: "load_failed" }) });
      }
      const row = rows[slot];
      return route.fulfill(row ? { status: 200, contentType: "application/json", body: JSON.stringify(row) } : { status: 404, contentType: "application/json", body: JSON.stringify({ error: "no_save" }) });
    }
    const body = request.postDataJSON() as Record<string, unknown>;
    api.puts.push({ slot, body });
    const failStatus = api.failPuts; // decided on arrival, before the hold below
    if (api.putDelayMs) await new Promise((resolve) => setTimeout(resolve, api.putDelayMs));
    if (failStatus !== null) {
      return route.fulfill({ status: failStatus, contentType: "application/json", body: JSON.stringify({ error: "upload_failed" }) });
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

  // And it STAYS resolved. A second reload reconciles against the revision the resolution created,
  // so the kept value is still what is shown and there is nothing left to re-send: a flag that
  // lingered past its own `stored` would show up right here as a redundant PUT (or, if the cloud had
  // moved again, as a prompt whose "Keep this one" would push this same payload up a second time).
  api.puts.length = 0;
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel(/Voice Lines/)).not.toBeChecked();
  await expect(savePrompt(page)).toHaveCount(0);
  await page.waitForTimeout(1_500);
  expect(api.puts).toEqual([]);
  expect(rows.settings!.revision).toBe(3);
  expect(await unsyncedFlags(page)).toEqual([]);
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

/** Another device moved `settings` on to a revision whose content differs from anything local. */
const movedSettingsRow = (): Row => ({
  slot: "settings", schemaVersion: 1, revision: 2, updatedAt: "2026-09-17T18:00:00Z",
  payload: { musicEnabled: true, sfxEnabled: true, voiceEnabled: false, reducedMotion: false },
});

test("a commit made during a reconcile that UPLOADS is still sent, and stays flagged until it lands", async ({ page }) => {
  test.setTimeout(60_000);
  await seedSession(page);
  const rows: Record<string, Row | undefined> = { settings: settingsRow() };
  // Leaves the app with: cloud `settings` at revision 1, the kit's own record
  // { revision: 1, dirty: false } (403 is terminal for it), Voice Lines off locally, and the slot
  // flagged. The cloud has NOT moved, so the next reconcile hands the kit a real local copy with
  // localChanged, its record goes dirty at the SAME revision as the cloud — the `restore_dirty`
  // branch — and the kit UPLOADS, rather than prompting.
  const api = await heldLocalChange(page, rows, 403);
  api.gets.length = 0;
  // Hold the post-reload GETs open so a real commit lands mid-reconcile. 4 s, not 3 s: the two
  // clicks below happen inside this window and the pin after them has to be reliable on the slower
  // mobile project too — lengthening the hold is the cheap half of that trade.
  api.getDelayMs = 4_000;

  await page.reload();
  await expect(page.getByRole("heading", { name: "GridWatch Match" })).toBeVisible();
  await expect.poll(() => api.gets.slice().sort()).toEqual(["campaign", "settings"]);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel(/Sound Effects/).click(); // a real commitSave, mid-reconcile, held by the gate

  // The pin that this scenario is actually testing what it says: the GETs are STILL held, so the
  // reconcile has not settled and the gate cannot have let anything out. Without this, a hold that
  // expired early (or a reconcile that never held at all) would turn the whole test into an
  // ordinary post-settle commit and the two PUTs below would still line up.
  expect(api.puts.filter((p) => p.slot === "settings")).toEqual([]);
  expect(api.puts).toEqual([]);

  // Exactly two PUTs for this slot: the kit's upload of the PRE-commit projection, then the
  // settle-time flush carrying the mid-flight commit on the revision that upload just created.
  await expect.poll(() => api.puts.filter((p) => p.slot === "settings").length, { timeout: 20_000 }).toBe(2);
  await page.waitForTimeout(1_500); // ...and no third
  const settingsPuts = api.puts.filter((p) => p.slot === "settings");
  expect(settingsPuts).toHaveLength(2);
  expect(settingsPuts[0].body.baseRevision).toBe(1);
  expect(settingsPuts[0].body.payload).toMatchObject({ sfxEnabled: true, voiceEnabled: false });
  expect(settingsPuts[1].body.baseRevision).toBe(2);
  expect(settingsPuts[1].body.payload).toMatchObject({ sfxEnabled: false, voiceEnabled: false });
  expect(api.puts.some((p) => p.slot === "campaign")).toBe(false);
  // The cloud row now equals what the device holds. The old rule cleared the flag and SKIPPED the
  // flush for any uploaded slot, so this commit existed nowhere but this tab, with nothing marking
  // it: the cloud stayed at revision 2 holding the pre-commit projection.
  expect(rows.settings!.revision).toBe(3);
  expect(rows.settings!.payload).toMatchObject({ musicEnabled: false, sfxEnabled: false, voiceEnabled: false });
  await expect.poll(() => unsyncedFlags(page), { timeout: 10_000 }).toEqual([]);

  // Both changes are what survives a reload — and the settled cloud row needs no further traffic.
  api.getDelayMs = 0;
  api.puts.length = 0;
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel(/Sound Effects/)).not.toBeChecked();
  await expect(page.getByLabel(/Voice Lines/)).not.toBeChecked();
  await expect(savePrompt(page)).toHaveCount(0);
  await page.waitForTimeout(1_500);
  expect(api.puts).toEqual([]);
});

test("a run that failed on one slot still clears the flag on the slot the cloud replaced", async ({ page }) => {
  test.setTimeout(60_000);
  await seedSession(page);
  const rows: Record<string, Row | undefined> = { settings: settingsRow() };
  const api = fakeSavesApi(page, rows, { getDelayMs: 1_500 });
  // One slot errors while the other answers a real row. A 500 is transient for the kit, so its
  // bounded retry (3 attempts, 500 ms + 1 500 ms backoff) makes this leg several seconds long —
  // and reconcileAll awaits BOTH slots, so the fold only lands once that leg has given up.
  api.failGets.campaign = 500;

  // The gate throttles re-arming a failed run, and the retry leg below has to wait that out for
  // real. `RETRY_THROTTLE_PARAM` is the throttle override (exact `gwTestMode=1` only, see
  // cloudGate.cloudRetryThrottleMs): 1.5 s exercises the same throttle-then-allow path as the 30 s
  // production default without 30 s of sleeping.
  await page.goto(`./?gwTestMode=1&${RETRY_THROTTLE_PARAM}=1500`);
  await expect(page.getByRole("heading", { name: "GridWatch Match" })).toBeVisible();
  await expect.poll(() => [...new Set(api.gets)].sort()).toEqual(["campaign", "settings"]);
  // A real commit, mid-reconcile, to the slot the cloud is about to replace. This is what SETS the
  // flag; the device was pristine when the reconcile started, so the kit was handed `null` for that
  // slot and answers `use_cloud` — the in-flight edit is dropped by design.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel(/Voice Lines/).click();
  expect(await unsyncedFlags(page)).toEqual(["settings"]);

  // Music off is the cloud row's own value, so it is the signal that the fold landed.
  await expect(page.getByLabel(/Music/)).not.toBeChecked({ timeout: 20_000 });
  await expect(page.getByLabel(/Voice Lines/)).toBeChecked();
  // `settings` IS synced — the cloud demonstrably holds it — even though `campaign` errored and the
  // run therefore never flushes. Clearing used to sit BELOW the run-level flush decision, so this
  // flag stayed set: a stale flag, later good for a redundant upload or a misleading prompt.
  await expect.poll(() => unsyncedFlags(page), { timeout: 10_000 }).toEqual([]);
  expect(api.puts).toEqual([]);
  await expect(savePrompt(page)).toHaveCount(0);

  // The errored slot is retried later. `online` re-arms the gate, which refuses until its throttle
  // has elapsed, so the event is offered repeatedly rather than once.
  const campaignGets = api.gets.filter((slot) => slot === "campaign").length;
  api.failGets.campaign = undefined;
  api.getDelayMs = 0;
  await expect.poll(async () => {
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    return api.gets.filter((slot) => slot === "campaign").length > campaignGets;
  }, { timeout: 20_000, intervals: [2_000] }).toBe(true);

  // The settle comes FIRST, and it flushes on its own: the mid-reconcile Voice Lines commit was
  // held by the failed run, so run 2's settle sends it before the test touches anything. Asserting
  // it explicitly is what keeps the click's PUT below unambiguous — measuring "one PUT" after the
  // click used to measure THIS one, and a poll could land between the two.
  await expect.poll(() => api.puts.length, { timeout: 20_000 }).toBe(1);
  expect(api.puts[0].slot).toBe("settings");
  expect(api.puts[0].body.baseRevision).toBe(1); // the revision the run-1 use_cloud recorded
  expect(rows.settings!.revision).toBe(2);
  api.puts.length = 0;

  // Settled this time, so the gate releases stores again and the next commit goes straight up — on
  // the revision that flush just created.
  await page.getByLabel(/Reduced Motion/).click();
  await expect.poll(() => api.puts.length, { timeout: 10_000 }).toBe(1);
  expect(api.puts[0].slot).toBe("settings");
  expect(api.puts[0].body.baseRevision).toBe(2);
  expect((api.puts[0].body.payload as { reducedMotion: boolean }).reducedMotion).toBe(true);
  await page.waitForTimeout(1_500);
  expect(api.puts).toHaveLength(1); // ...and exactly one, not a second attempt behind it
  expect(rows.settings!.revision).toBe(3);
  await expect.poll(() => unsyncedFlags(page), { timeout: 10_000 }).toEqual([]);
  await expect(savePrompt(page)).toHaveCount(0);
});

test("an earlier PUT's success does not clear the flag of a later commit whose own PUT fails", async ({ page }) => {
  test.setTimeout(60_000);
  await seedSession(page);
  const rows: Record<string, Row | undefined> = {};
  const api = fakeSavesApi(page, rows);
  await page.goto("./?gwTestMode=1");
  await expect(page.getByRole("heading", { name: "GridWatch Match" })).toBeVisible();
  await page.waitForTimeout(1_500); // pristine device, no cloud rows: the reconcile stores nothing
  expect(api.puts).toEqual([]);

  api.putDelayMs = 4_000; // hold PUT1's REPLY open, so commit 2 lands while PUT1 is still in flight
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel(/Music/).click();                                // commit 1
  await expect.poll(() => api.puts.length, { timeout: 10_000 }).toBe(1); // PUT1 sent, reply held
  api.putDelayMs = 0;
  api.failPuts = 403;                             // terminal for the kit: its record stays CLEAN
  await page.getByLabel(/Sound Effects/).click();                        // commit 2

  // PUT1's `stored` reply lands while commit 2 is still queued behind it in the kit's per-slot
  // chain; PUT2 then fails terminally. Clearing on a `stored` reply alone cleared the WHOLE slot,
  // leaving commit 2 local-only with no flag at all.
  await expect.poll(() => api.puts.length, { timeout: 30_000 }).toBe(2);
  await page.waitForTimeout(2_000);
  expect(api.puts[1].slot).toBe("settings");
  expect(api.puts[1].body.baseRevision).toBe(1);                         // PUT1 did land
  expect(rows.settings!.revision).toBe(1);
  expect(rows.settings!.payload).toMatchObject({ musicEnabled: false, sfxEnabled: true });
  expect(await unsyncedFlags(page)).toEqual(["settings"]);
  await expect(page.getByLabel(/Sound Effects/)).not.toBeChecked();

  // The flag is the only thing left: the kit's record is clean at revision 1, so on a cloud that
  // has moved on, an unflagged slot would be replaced silently.
  rows.settings = movedSettingsRow();
  api.failPuts = null;
  api.puts.length = 0;
  await page.reload();
  const dialog = savePrompt(page);
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog).toContainText("Newer save in the cloud from another device");
  await dialog.getByRole("button", { name: "Keep this one" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => api.puts.filter((p) => p.slot === "settings").length, { timeout: 10_000 }).toBe(1);
  expect(api.puts[0].body.baseRevision).toBe(2);
  expect(api.puts[0].body.payload).toMatchObject({ musicEnabled: false, sfxEnabled: false });
  expect(rows.settings!.revision).toBe(3);
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
