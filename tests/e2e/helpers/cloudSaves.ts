import type { BrowserContext, Page } from "@playwright/test";

// Shared by cloud-saves.spec.ts and carry-over.spec.ts: a seeded Supabase session and a fake
// `/api/saves/match/*`. Each takes a Page or a BrowserContext — a context-level install also
// covers pages the app opens itself (the carry hand-off opens Nexus in a popup).

const USER_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_KEY = "sb-mggxfzzxrpjgpzhwiwqi-auth-token";

/** Page or context: both install init scripts and routes; a context's also reach popups. */
type Target = Page | BrowserContext;

/** `onlyOrigin` limits the seeded session to one origin (the carry spec signs in on Nexus only);
 *  omitted, every origin the target loads is signed in, as before. */
export async function seedSession(page: Target, onlyOrigin?: string): Promise<void> {
  await page.addInitScript(([key, userId, origin]) => {
    if (origin && location.origin !== origin) return;
    if (localStorage.getItem(key)) return;
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem(key, JSON.stringify({
      access_token: "e2e-access-token-0123456789", token_type: "bearer", expires_in: 3600, expires_at: expiresAt, refresh_token: "e2e-refresh",
      user: { id: userId, aud: "authenticated", role: "authenticated", email: "e2e@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
    }));
  }, [SESSION_KEY, USER_ID, onlyOrigin ?? ""] as const);
  // Profile lookup from the account bar: answer "no handle" without touching the network.
  await page.route("https://mggxfzzxrpjgpzhwiwqi.supabase.co/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
}

export type Row = { slot: string; schemaVersion: number; revision: number; payload: Record<string, unknown>; updatedAt: string };

export interface FakeSavesApi {
  /** Every PUT the app sent, in order. */
  puts: Array<{ slot: string; body: Record<string, unknown> }>;
  /** Every GET the app sent, by slot, in arrival order. */
  gets: string[];
  /** The same GETs with the test-process clock time each one reached this fake, for ordering checks. */
  getLog: Array<{ slot: string; at: number }>;
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
  /** Slots whose GET hangs until `releaseGet(slot)` is called. Unlike `getDelayMs` this is not a
   *  timer, so a scenario about ONE slot finishing while the other is still waiting has no window
   *  that can close early — the test decides exactly when the second slot resolves. */
  holdGets: Set<string>;
  releaseGet(slot: string): void;
}

/** Async, and awaited at every call site: `page.route` returns a promise, and a route that is still
 *  being installed when `page.goto` runs is a race the app can win — the first reconcile's GETs
 *  would then hit the real network instead of this fake. */
export async function fakeSavesApi(page: Target, rows: Record<string, Row | undefined>, options: { getDelayMs?: number } = {}): Promise<FakeSavesApi> {
  const waiting = new Map<string, Array<() => void>>();
  const api: FakeSavesApi = {
    puts: [], gets: [], getLog: [], failPuts: null, failGets: {}, getDelayMs: options.getDelayMs ?? 0, putDelayMs: 0,
    holdGets: new Set(),
    releaseGet(slot) {
      api.holdGets.delete(slot);
      const pending = waiting.get(slot) ?? [];
      waiting.set(slot, []);
      for (const resume of pending) resume();
    },
  };
  await page.route("**/api/saves/match/*", async (route) => {
    const request = route.request();
    const slot = new URL(request.url()).pathname.split("/").pop()!;
    if (request.method() === "GET") {
      api.gets.push(slot);
      api.getLog.push({ slot, at: Date.now() });
      const failStatus = api.failGets[slot];
      if (api.holdGets.has(slot)) {
        await new Promise<void>((resume) => {
          const pending = waiting.get(slot) ?? [];
          pending.push(resume);
          waiting.set(slot, pending);
        });
      }
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
