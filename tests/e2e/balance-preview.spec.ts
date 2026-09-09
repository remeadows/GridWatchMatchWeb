import { expect, test, type Page } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import type { AddressInfo } from "node:net";

let server: ViteDevServer;
let developmentUrl: string;
const profiles = ["pilot-moves-v1", "canonical-control-v1"];
const query = (profile: string) => `/?gwTestMode=1&gwBalanceProfile=${profile}&level=51`;

test.beforeAll(async () => {
  server = await createServer({ server: { host: "127.0.0.1", port: 0, strictPort: true }, logLevel: "error" });
  await server.listen();
  developmentUrl = `http://127.0.0.1:${(server.httpServer!.address() as AddressInfo).port}`;
});

test.afterAll(async () => { await server?.close(); });

test.beforeEach(async ({ page }) => {
  await page.route(/\/src\/hooks\/useAuth\.ts(?:\?|$)/, route => route.fulfill({
    contentType: "application/javascript",
    body: `export function useAuth() { return {
      session: { access_token: 'preview-only-invalid-token', user: { id: 'preview-only', email: 'preview@example.test' } },
      handle: 'preview-only', loading: false, signInWithEmail: async()=>null, signInWithProvider: async()=>null,
      saveHandle: async()=>null, signOut: async()=>null
    }; }`
  }));
  await page.route("**/api/score", route => route.abort());
  await page.addInitScript(() => {
    const target = window as Window & { __balanceScoreAttempts?: number };
    target.__balanceScoreAttempts = 0;
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.pathname === "/api/score") {
        target.__balanceScoreAttempts!++;
        return Promise.reject(new Error("Score request blocked by isolated preview test"));
      }
      return original(input, init);
    };
  });
});

test("development preview applies the explicit candidate budget", async ({ page }) => {
  await page.goto(developmentUrl + query("pilot-moves-v1"));
  await ready(page);
  await expect(page.getByText("28/28", { exact: true })).toBeVisible();
  await expect(page.getByTestId("balance-profile")).toHaveText("Pilot moves v1");
});

for (const profile of profiles) {
  test(`${profile} leaves normal IndexedDB and localStorage unchanged after win and reset`, async ({ page }) => {
    await seedNormalSave(page);
    const before = await fingerprint(page);
    await page.goto(developmentUrl + query(profile));
    await ready(page);
    await page.getByTestId("qa-win").click();
    await expect(page.getByText("Grid secured", { exact: true })).toBeVisible();
    expect(await fingerprint(page)).toEqual(before);
    await page.getByRole("button", { name: "Level Select", exact: true }).click();
    await expect(page.getByText("Grid secured", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Reset Local Save", exact: true }).click();
    await expect(page.getByLabel("0 coins", { exact: true })).toBeVisible();
    expect(await fingerprint(page)).toEqual(before);
  });

  test(`${profile} cannot submit a score with a session after query removal`, async ({ page }) => {
    await seedNormalSave(page);
    await page.goto(developmentUrl + query(profile));
    await ready(page);
    await page.evaluate(() => history.replaceState(null, "", "/"));
    await page.getByTestId("qa-win").click();
    await expect(page.getByText("Grid secured", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as Window & { __balanceScoreAttempts?: number }).__balanceScoreAttempts)).toBe(0);
  });
}

test("development requests without an exact known profile keep the canonical budget", async ({ page }) => {
  for (const suffix of ["?gwTestMode=1&level=51", "?gwTestMode=1&level=51&gwBalanceProfile=unknown",
    "?gwTestMode=0&level=51&gwBalanceProfile=pilot-moves-v1"]) {
    await page.goto(developmentUrl + "/" + suffix);
    await expect(page.getByText("44/44", { exact: true })).toBeVisible();
    await expect(page.getByTestId("balance-profile")).toHaveCount(0);
  }
});

test("production build ignores candidate requests", async ({ page }) => {
  await page.goto(query("pilot-moves-v1"));
  await ready(page);
  await expect(page.getByText("44/44", { exact: true })).toBeVisible();
  await expect(page.getByTestId("balance-profile")).toHaveCount(0);
});

test("reset failure preserves the displayed save and shows a recoverable error", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await seedNormalSave(page);
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("777 coins", { exact: true })).toBeVisible();
  const before = await fingerprint(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === "gridwatch-match-web.save.v1") {
        Storage.prototype.setItem = original;
        throw new DOMException("Storage unavailable", "QuotaExceededError");
      }
      original.call(this, key, value);
    };
  });
  await page.getByRole("button", { name: "Reset Local Save", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Could not reset local save. Please try again.");
  await expect(page.getByLabel("777 coins", { exact: true })).toBeVisible();
  expect(await fingerprint(page)).toEqual(before);
  expect(errors).toEqual([]);
  await page.getByRole("button", { name: "Reset Local Save", exact: true }).click();
  await expect(page.getByLabel("0 coins", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("0 coins", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

async function ready(page: Page) {
  await page.waitForFunction(() => (window as Window & { __gwBoardReady?: boolean }).__gwBoardReady);
}

async function seedNormalSave(page: Page) {
  await page.goto(developmentUrl + "/");
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(page.getByText("preview@example.test", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign Out", exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const payload = JSON.stringify({ version: 1, coins: 777, completedTutorial: true,
      levels: { "7": { stars: 2, score: 222, completedAt: "normal-save-marker" } },
      settings: { musicEnabled: false, sfxEnabled: false, voiceEnabled: false, reducedMotion: true } });
    localStorage.setItem("gridwatch-match-web.save.v1", payload);
    localStorage.setItem("balance-test-unrelated", "preserve-this-value");
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("gridwatch-match-web", 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, transaction = db.transaction("kv", "readwrite");
        transaction.objectStore("kv").put(payload, "save-state-v1");
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => { db.close(); reject(transaction.error); };
      };
    });
  });
}

async function fingerprint(page: Page) {
  return page.evaluate(async () => {
    const local = Object.fromEntries(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)]));
    const indexed = await new Promise<unknown>((resolve, reject) => {
      const open = indexedDB.open("gridwatch-match-web", 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, transaction = db.transaction("kv", "readonly"), store = transaction.objectStore("kv");
        const keys = store.getAllKeys(), values = store.getAll();
        transaction.oncomplete = () => { db.close(); resolve({ keys: keys.result, values: values.result }); };
        transaction.onerror = () => { db.close(); reject(transaction.error); };
      };
    });
    return { local, indexed };
  });
}
