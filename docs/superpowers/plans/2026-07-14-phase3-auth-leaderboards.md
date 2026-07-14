# GridWatch Match — Phase 3: Auth + Server-Mediated Leaderboards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give GridWatch Match Supabase auth (guest-first magic link + Google/GitHub + handle) and server-mediated score submission through its own Cloudflare Worker, so the Command Nexus hub's Match leaderboard lights up. Hosting migrates Cloudflare Pages → Workers + Assets.

**Architecture (approved design D5, Command Nexus repo `docs/superpowers/specs/2026-07-14-command-nexus-architecture-design.md`):** client sends raw telemetry (never a score) + the deterministic engine `actionLog` as proof; the Worker verifies the Supabase user, validates plausibility, derives the score server-side, and writes improve-only best rows with the service-role key. Headline `standard` row = **campaign total** (sum of per-level bests, per-level rows as `category="level-NNN"`), Russ-decided. Daily/weekly rotating boards record best single-run scores. `playOnUsed` runs rank normally but are recorded in telemetry/metadata/proof (Russ-notified reversible default).

**Tech Stack:** existing React 19 + Phaser 4 + Vite 8 + TS 6 + vitest 4; add `@supabase/supabase-js@^2` (runtime) and `wrangler@^4.110.0` (dev).

## Global Constraints

- Backend facts (all live-verified 2026-07-14): Supabase project `https://mggxfzzxrpjgpzhwiwqi.supabase.co`, publishable anon key `sb_publishable_588CEYGJhys5YBDloHGJzw_A_Ew7wgL` (public by design); `games` row `gridwatch-match` EXISTS; `scores` CHECK is now `0..10000000`; unique `(game_id, category, user_id)`; RLS: clients cannot touch `scores` at all — only the Worker's service-role key writes. Redirect allowlist already includes `https://gridwatchmatchweb.warsignallabs.net/**` and `http://localhost:5173/**`.
- Worker caps (mirror in code + tests): `LEVEL_SCORE_CAP = 25000`, `CAMPAIGN_SCORE_CAP = 2500000`.
- Score formula (MUST match `src/engine/boardEngine.ts:724`): `tiles*10 + powerUps*25 + chain*50`. Stars formula (MUST match `src/App.tsx starsEarned`): `ratio = (moveLimit-moveCount)/max(1,moveLimit)`; `>=0.5→3, >=0.2→2, else 1`.
- Period category stamps must be byte-identical in logic to Drift's (`GWTetrisRace/index.html` ~L2113 and its `worker/index.js`) and the hub's `src/lib/periods.ts` — include the change-together comment.
- Levels: ids are integers 1..100; `moveLimit` ranges 17..48; per-level limits come from `public/levels/level_NNN.json`.
- **Never submit from QA/test paths**: any URL with `gwTestMode` present skips submission entirely.
- The game must remain fully playable signed out and offline (guest-first; submission is additive).
- Secrets: `SUPABASE_SERVICE_ROLE_KEY` is a wrangler secret + `.dev.vars` (gitignored — NOTE: must be added to `.gitignore` explicitly; the existing `.env.*` glob does not match it). Never committed, never echoed.
- Branch `feat/phase3-auth-leaderboards` from main in THIS repo (`~/Dev/1 - WarSignalLabs/4 - Games/GridWatchMatchWeb`); commit per task; do NOT push.
- Verification gate per task: `npm run validate:levels && npm test && npm run build` (build includes `tsc --noEmit`).
- Match the repo's existing code style (its CSS/design system, service-module conventions in `src/services/`).

---

### Task 1: Docs supersede + dependencies + wrangler scaffold

**Files:**
- Modify: `AGENTS.md` (L14, L32), `HANDOFF.md` (L186 area), `README.md` (L37, L78, L93), `CHALLENGE_CONTEXT.md` (L31, L39), `.gitignore`, `package.json`
- Create: `wrangler.jsonc`

**Interfaces (produces):** installed `@supabase/supabase-js` + `wrangler`; `wrangler.jsonc` (no routes yet — cutover adds the domain later).

- [ ] **Step 1: Branch** — `git checkout main && git checkout -b feat/phase3-auth-leaderboards`
- [ ] **Step 2: Supersede the static-only guardrails** (the Phase 3 decision, Russ-approved 2026-07-14 — reference the design doc):
  - `AGENTS.md` L14: replace the "Static Cloudflare Pages hosting only … No backend, secrets, or real-money fulfillment in this repo." sentence with: "Hosted on Cloudflare Workers + static Assets (served from the root of `GridWatchMatchWeb.warsignallabs.net`). The ONLY backend surface is `worker/index.ts` (`/api/*`): Supabase-auth-verified, server-mediated score submission (see `docs/superpowers/plans/2026-07-14-phase3-auth-leaderboards.md`). No real-money fulfillment in this repo. The one secret (`SUPABASE_SERVICE_ROLE_KEY`) lives in wrangler secrets / gitignored `.dev.vars` — never in the repo."
  - `AGENTS.md` L32: "Store is stubbed until a secure backend exists." → "Store remains a playable stub (score submission's Worker is NOT a store backend; real-money fulfillment stays out of this repo)."
  - `HANDOFF.md` L186: "Do not introduce a backend for store or telemetry; the store remains a playable stub." → "Phase 3 (2026-07-14) added the one sanctioned backend: the `/api/score` Worker for auth-verified score submission. The store remains a playable stub — no store/payment backend."
  - `README.md` L37 "Static Cloudflare Pages deployment" → "Cloudflare Workers + static Assets deployment (a Worker serves `/api/*`; everything else is static)". L78 hosting paragraph: update Pages → Workers+Assets, note deploys via `npx wrangler deploy` / Workers Builds. L93: keep the store-stub sentence but drop "until a secure backend is added" → "…fulfillment is disabled and out of scope for this repo."
  - `CHALLENGE_CONTEXT.md` L31: append to the sentence: " — that future was explicitly added 2026-07-14: a score-submission Worker (`worker/`), approved in the Command Nexus architecture design (D5)." L39: append: " (Score submission is additive: everything still works signed-out/offline.)"
- [ ] **Step 3: Dependencies** — `npm install @supabase/supabase-js@^2 --no-audit --no-fund && npm install -D wrangler@^4.110.0 --no-audit --no-fund`
- [ ] **Step 4: `.gitignore`** — add lines: `.dev.vars` and `.dev.vars.*` and `/.wrangler/`
- [ ] **Step 5: Write `wrangler.jsonc`**

```jsonc
{
  "name": "gridwatch-match",
  "main": "worker/index.ts",
  "compatibility_date": "2026-07-14",
  "workers_dev": true,
  "assets": {
    "directory": "dist",
    "binding": "ASSETS",
    "run_worker_first": ["/api/*"]
  },
  // NOTE: no "routes" yet — the custom domain gridwatchmatchweb.warsignallabs.net is
  // still attached to the old Cloudflare Pages project. The cutover task detaches it
  // there first, then adds:
  // "routes": [{ "pattern": "gridwatchmatchweb.warsignallabs.net", "custom_domain": true }],
  "vars": {
    "SUPABASE_URL": "https://mggxfzzxrpjgpzhwiwqi.supabase.co",
    "SUPABASE_ANON_KEY": "sb_publishable_588CEYGJhys5YBDloHGJzw_A_Ew7wgL"
  }
}
```

- [ ] **Step 6: Verify** — `npm run validate:levels && npm test && npm run build` all pass (nothing functional changed yet).
- [ ] **Step 7: Commit**

```bash
git add AGENTS.md HANDOFF.md README.md CHALLENGE_CONTEXT.md .gitignore package.json package-lock.json wrangler.jsonc
git commit -m "feat: Phase 3 scaffolding — supersede static-only guardrails, add supabase-js/wrangler, worker config

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Score Worker + level-limits artifact + unit tests

**Files:**
- Create: `scripts/generate-level-limits.mjs`, `worker/level-limits.json` (generated, committed), `worker/validation.ts`, `worker/index.ts`, `tests/worker-validation.test.ts` (vitest; note existing unit tests live under `src/tests/` — put this there instead if vitest config only includes src: check `vite.config.ts` `test` block; default vitest picks up both, verify)
- Modify: `package.json` (add script `generate:level-limits`)

**Interfaces:**
- Produces HTTP: `POST /api/score` — request `{ levelId: number, telemetry: { tilesCleared, powerUpEvents, chainSum, moveCount, stars, playOnUsed: boolean, durationSec?: number }, actionLog: unknown[] }` with `Authorization: Bearer <supabase access token>`. Responses: `401 {error}` unauthenticated · `422 {error}` invalid telemetry · `200 { ok: true, levelScore, levelImproved: boolean, levelBest, campaignScore }` · `5xx {error}` on storage failure. All other `/api/*` → `404`. Everything else → static assets.
- Produces (consumed by Task 4's client): exactly the request/response contract above.

- [ ] **Step 1: Write `scripts/generate-level-limits.mjs`**

```js
// Regenerate worker/level-limits.json after any level rebalance:
//   npm run generate:level-limits
import { readFile, writeFile, readdir } from "node:fs/promises";

const dir = new URL("../public/levels/", import.meta.url);
const files = (await readdir(dir)).filter((f) => /^level_\d{3}\.json$/.test(f)).sort();
const limits = {};
for (const f of files) {
  const level = JSON.parse(await readFile(new URL(f, dir), "utf8"));
  limits[String(level.id)] = level.moveLimit;
}
await writeFile(new URL("../worker/level-limits.json", import.meta.url), JSON.stringify(limits, null, 2) + "\n");
console.log(`wrote worker/level-limits.json (${Object.keys(limits).length} levels)`);
```

Add to package.json scripts: `"generate:level-limits": "node scripts/generate-level-limits.mjs"`. Run it once — expect `100 levels`.

- [ ] **Step 2: Write `worker/validation.ts`** (pure, unit-testable — no I/O)

```ts
import limits from "./level-limits.json";

export const LEVEL_SCORE_CAP = 25000;
export const CAMPAIGN_SCORE_CAP = 2500000;
export const GAME_SLUG = "gridwatch-match";

export interface Telemetry {
  tilesCleared: number;
  powerUpEvents: number;
  chainSum: number;
  moveCount: number;
  stars: number;
  playOnUsed: boolean;
  durationSec?: number;
}

/* Rotating-board category stamps — UTC so every player shares one clock.
   Copied byte-for-byte in logic from Drift (index.html dailyCategory /
   weeklyCategory). Change together with Drift's client + worker helpers and the
   Command Nexus hub's src/lib/periods.ts. */
export function dailyCategory(now: Date): string {
  return "daily-" + now.toISOString().slice(0, 10);
}

export function weeklyCategory(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `weekly-${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// MUST mirror src/App.tsx starsEarned — change together.
export function starsFor(moveCount: number, moveLimit: number): number {
  const ratio = (moveLimit - moveCount) / Math.max(1, moveLimit);
  if (ratio >= 0.5) return 3;
  if (ratio >= 0.2) return 2;
  return 1;
}

export function moveLimitFor(levelId: number): number | null {
  return (limits as Record<string, number>)[String(levelId)] ?? null;
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

export function validateSubmission(body: unknown):
  | { ok: true; levelId: number; telemetry: Telemetry; actionLog: unknown[] }
  | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "Malformed body." };
  const b = body as Record<string, unknown>;
  const levelId = b.levelId;
  if (!isInt(levelId) || levelId < 1 || levelId > 100) return { ok: false, error: "Unknown level." };
  const moveLimit = moveLimitFor(levelId);
  if (moveLimit === null) return { ok: false, error: "Unknown level." };

  const t = b.telemetry as Record<string, unknown> | undefined;
  if (typeof t !== "object" || t === null) return { ok: false, error: "Missing telemetry." };
  const { tilesCleared, powerUpEvents, chainSum, moveCount, stars, playOnUsed } = t as Partial<Telemetry>;
  if (!isInt(moveCount) || moveCount < 1 || moveCount > moveLimit)
    return { ok: false, error: "Implausible move count." };
  if (!isInt(tilesCleared) || tilesCleared < 1 || tilesCleared > moveCount * 49)
    return { ok: false, error: "Implausible clear count." };
  if (!isInt(powerUpEvents) || powerUpEvents < 0 || powerUpEvents > moveCount * 10)
    return { ok: false, error: "Implausible power-up count." };
  if (!isInt(chainSum) || chainSum < 0 || chainSum > moveCount * 20)
    return { ok: false, error: "Implausible cascade depth." };
  if (typeof playOnUsed !== "boolean") return { ok: false, error: "Missing playOn flag." };
  if (!isInt(stars) || stars !== starsFor(moveCount, moveLimit))
    return { ok: false, error: "Star count does not match move usage." };

  const actionLog = Array.isArray(b.actionLog) ? b.actionLog : null;
  if (!actionLog || actionLog.length > 500) return { ok: false, error: "Missing or oversized action log." };
  if (JSON.stringify(actionLog).length > 65536) return { ok: false, error: "Oversized action log." };

  return {
    ok: true,
    levelId,
    telemetry: { tilesCleared, powerUpEvents, chainSum, moveCount, stars, playOnUsed, durationSec: typeof t.durationSec === "number" ? t.durationSec : undefined },
    actionLog,
  };
}

// MUST mirror src/engine/boardEngine.ts score() — change together.
export function deriveScore(t: Telemetry): number {
  const raw = t.tilesCleared * 10 + t.powerUpEvents * 25 + Math.max(0, t.chainSum) * 50;
  return Math.min(LEVEL_SCORE_CAP, raw);
}

export function levelCategory(levelId: number): string {
  return `level-${String(levelId).padStart(3, "0")}`;
}
```

- [ ] **Step 3: Write `worker/index.ts`** (I/O shell around the pure module; Drift's `worker/index.js` is the reference pattern — read it at "/Users/russmeadows/Dev/1 - WarSignalLabs/4 - Games/GWTetrisRace/worker/index.js" before writing)

```ts
import {
  CAMPAIGN_SCORE_CAP,
  GAME_SLUG,
  dailyCategory,
  deriveScore,
  levelCategory,
  validateSubmission,
  weeklyCategory,
} from "./validation";

interface Env {
  ASSETS: Fetcher;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function verifyUser(request: Request, env: Env): Promise<{ id: string } | null> {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const user = (await res.json()) as { id?: string };
  return user && user.id ? { id: user.id } : null;
}

function sbHeaders(env: Env): Record<string, string> {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "content-type": "application/json",
  };
}

let cachedGameId: string | null = null;
async function gameId(env: Env): Promise<string> {
  if (cachedGameId) return cachedGameId;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/games?slug=eq.${GAME_SLUG}&select=id`, { headers: sbHeaders(env) });
  if (!res.ok) throw new Error("games lookup failed");
  const rows = (await res.json()) as { id: string }[];
  if (!rows[0]) throw new Error("game row missing");
  cachedGameId = rows[0].id;
  return cachedGameId;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface UpsertResult { improved: boolean; best: number; }

// Improve-only best row per (game, category, user) — mirrors Drift's upsertBest.
async function upsertBest(
  env: Env,
  game: string,
  userId: string,
  category: string,
  score: number,
  metadata: Record<string, unknown>,
  proof: unknown,
  proofHash: string,
): Promise<UpsertResult> {
  const row = { game_id: game, user_id: userId, category, score, metadata, proof, proof_hash: proofHash };
  const ins = await fetch(`${env.SUPABASE_URL}/rest/v1/scores`, {
    method: "POST",
    headers: { ...sbHeaders(env), prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (ins.ok) return { improved: true, best: score };
  if (ins.status !== 409) throw new Error(`insert failed: ${ins.status}`);

  const patch = await fetch(
    `${env.SUPABASE_URL}/rest/v1/scores?game_id=eq.${game}&user_id=eq.${userId}&category=eq.${category}&score=lt.${score}`,
    {
      method: "PATCH",
      headers: { ...sbHeaders(env), prefer: "return=representation" },
      body: JSON.stringify({ score, metadata, proof, proof_hash: proofHash, created_at: new Date().toISOString() }),
    },
  );
  if (!patch.ok) throw new Error(`patch failed: ${patch.status}`);
  const patched = (await patch.json()) as unknown[];
  if (patched.length > 0) return { improved: true, best: score };

  const standing = await fetch(
    `${env.SUPABASE_URL}/rest/v1/scores?game_id=eq.${game}&user_id=eq.${userId}&category=eq.${category}&select=score`,
    { headers: sbHeaders(env) },
  );
  const rows = standing.ok ? ((await standing.json()) as { score: number }[]) : [];
  return { improved: false, best: rows[0]?.score ?? score };
}

async function campaignTotal(env: Env, game: string, userId: string): Promise<{ total: number; levels: number }> {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/scores?game_id=eq.${game}&user_id=eq.${userId}&category=like.level-*&select=score`,
    { headers: sbHeaders(env) },
  );
  if (!res.ok) throw new Error(`campaign read failed: ${res.status}`);
  const rows = (await res.json()) as { score: number }[];
  const total = Math.min(CAMPAIGN_SCORE_CAP, rows.reduce((sum, r) => sum + r.score, 0));
  return { total, levels: rows.length };
}

async function handleScore(request: Request, env: Env): Promise<Response> {
  const user = await verifyUser(request, env);
  if (!user) return json(401, { error: "Sign in to transmit scores." });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(422, { error: "Malformed body." });
  }
  const v = validateSubmission(body);
  if (!v.ok) return json(422, { error: v.error });

  const score = deriveScore(v.telemetry);
  const game = await gameId(env);
  const metadata = {
    levelId: v.levelId,
    stars: v.telemetry.stars,
    moveCount: v.telemetry.moveCount,
    playOnUsed: v.telemetry.playOnUsed,
  };
  const proof = { v: 1, telemetry: v.telemetry, actionLog: v.actionLog };
  const proofHash = await sha256Hex(JSON.stringify(proof));

  // Headline path: per-level best, then the recomputed campaign total. Failures fail the request.
  const level = await upsertBest(env, game, user.id, levelCategory(v.levelId), score, metadata, proof, proofHash);
  const campaign = await campaignTotal(env, game, user.id);
  await upsertBest(env, game, user.id, "standard", campaign.total, { kind: "campaign", levels: campaign.levels }, { v: 1, kind: "campaign" }, await sha256Hex(`campaign:${user.id}:${campaign.total}`));

  // Rotating boards: best single-run score of the period — best-effort, never fail the request.
  const now = new Date();
  for (const category of [dailyCategory(now), weeklyCategory(now)]) {
    try {
      await upsertBest(env, game, user.id, category, score, metadata, proof, proofHash);
    } catch (err) {
      console.warn(`[score] rotating board ${category} failed:`, err instanceof Error ? err.message : err);
    }
  }

  return json(200, { ok: true, levelScore: score, levelImproved: level.improved, levelBest: level.best, campaignScore: campaign.total });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/score") {
      if (request.method !== "POST") return json(405, { error: "POST only." });
      try {
        return await handleScore(request, env);
      } catch (err) {
        console.error("[score] failed:", err instanceof Error ? err.message : err);
        return json(502, { error: "Archive write failed." });
      }
    }
    if (url.pathname.startsWith("/api/")) return json(404, { error: "Unknown endpoint." });
    return env.ASSETS.fetch(request);
  },
};
```

NOTE for implementer: `worker/*.ts` must NOT be swept into the app's `tsc --noEmit` if `Fetcher`/worker globals are undefined there — check `tsconfig.json` `include`; if it globs all TS, either add `@cloudflare/workers-types` as devDep + a `worker/tsconfig.json`, or exclude `worker/` from the app tsconfig and rely on wrangler's own build + the vitest tests for type safety of `validation.ts`. Choose the lightest option that keeps `npm run build` green, and document the choice in your report.

- [ ] **Step 4: Write the unit tests** (`src/tests/worker-validation.test.ts` — colocate with existing unit tests)

```ts
import { describe, expect, it } from "vitest";
import {
  LEVEL_SCORE_CAP,
  dailyCategory,
  deriveScore,
  levelCategory,
  moveLimitFor,
  starsFor,
  validateSubmission,
  weeklyCategory,
} from "../../worker/validation";

const okBody = (over: Record<string, unknown> = {}, tOver: Record<string, unknown> = {}) => ({
  levelId: 1,
  telemetry: {
    tilesCleared: 60,
    powerUpEvents: 2,
    chainSum: 4,
    moveCount: 15,
    stars: starsFor(15, moveLimitFor(1)!),
    playOnUsed: false,
    ...tOver,
  },
  actionLog: [{ kind: "swap" }],
  ...over,
});

describe("level limits artifact", () => {
  it("covers all 100 levels with plausible limits", () => {
    for (let id = 1; id <= 100; id++) {
      const limit = moveLimitFor(id);
      expect(limit, `level ${id}`).not.toBeNull();
      expect(limit!).toBeGreaterThanOrEqual(17);
      expect(limit!).toBeLessThanOrEqual(48);
    }
    expect(moveLimitFor(0)).toBeNull();
    expect(moveLimitFor(101)).toBeNull();
  });
});

describe("validateSubmission", () => {
  it("accepts a plausible run", () => {
    expect(validateSubmission(okBody()).ok).toBe(true);
  });
  it("rejects unknown levels, bad counts, star mismatch, missing log", () => {
    expect(validateSubmission(okBody({ levelId: 101 })).ok).toBe(false);
    expect(validateSubmission(okBody({}, { moveCount: 999 })).ok).toBe(false);
    expect(validateSubmission(okBody({}, { tilesCleared: 15 * 49 + 1 })).ok).toBe(false);
    expect(validateSubmission(okBody({}, { stars: 1 })).ok).toBe(false); // 15/25 used → not 1 star
    expect(validateSubmission(okBody({ actionLog: undefined })).ok).toBe(false);
    expect(validateSubmission(okBody({}, { playOnUsed: "yes" })).ok).toBe(false);
  });
});

describe("deriveScore", () => {
  it("mirrors the engine formula and caps", () => {
    expect(deriveScore({ tilesCleared: 60, powerUpEvents: 2, chainSum: 4, moveCount: 15, stars: 3, playOnUsed: false })).toBe(60 * 10 + 2 * 25 + 4 * 50);
    expect(deriveScore({ tilesCleared: 49000, powerUpEvents: 0, chainSum: 0, moveCount: 48, stars: 1, playOnUsed: false })).toBe(LEVEL_SCORE_CAP);
  });
});

describe("categories", () => {
  it("pads level categories", () => expect(levelCategory(7)).toBe("level-007"));
  it("stamps ISO periods (spot checks match hub/Drift)", () => {
    expect(dailyCategory(new Date("2026-07-14T12:00:00Z"))).toBe("daily-2026-07-14");
    expect(weeklyCategory(new Date("2026-07-14T12:00:00Z"))).toBe("weekly-2026-W29");
    expect(weeklyCategory(new Date("2021-01-01T12:00:00Z"))).toBe("weekly-2020-W53");
  });
});
```

- [ ] **Step 5: Run tests** — `npm test` — expect new tests pass alongside the existing suite; `npm run build` stays green (see tsconfig note above); `npx wrangler deploy --dry-run` succeeds (bundles the worker without deploying).
- [ ] **Step 6: Commit**

```bash
git add scripts/generate-level-limits.mjs worker package.json src/tests/worker-validation.test.ts
git commit -m "feat: score Worker — auth-verified, telemetry-validated, improve-only best rows + campaign total

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Plus any tsconfig change from the note, committed with it.)

---

### Task 3: Client auth — Supabase service + Account screen

**Files:**
- Create: `src/services/supabase.ts`, `src/services/handle.ts`, `src/hooks/useAuth.ts` (create `src/hooks/` dir)
- Modify: `src/App.tsx` (AccountScreen at ~L723-746 only, plus any prop threading it needs)

**Interfaces:**
- Consumes: nothing new (supabase-js from Task 1).
- Produces (consumed by Task 4): `useAuth()` with the same contract as the Command Nexus hub's hook: `{ session, handle, loading, signInWithEmail(email)→Promise<string|null>, signInWithProvider("google"|"github")→Promise<string|null>, saveHandle(raw)→Promise<string|null>, signOut() }` — null = success, string = user-displayable error. Also `supabase` client export.

- [ ] **Step 1:** Copy the hub's proven modules, adjusted for this repo's paths: `src/services/supabase.ts` and `src/services/handle.ts` are verbatim copies of Command Nexus `src/lib/supabase.ts` and `src/lib/handle.ts` ("/Users/russmeadows/Dev/1 - WarSignalLabs/1 - Apps/2 - WebApps/gridwatch-command-nexus/src/lib/…" — read them). `src/hooks/useAuth.ts` is a verbatim copy of the hub's `src/lib/useAuth.ts` with its imports repointed (`./supabase` → `../services/supabase`, `./handle` → `../services/handle`).
- [ ] **Step 2:** Extend `AccountScreen` in `src/App.tsx`: keep the existing hero/portrait selection content intact; add an "OPERATOR IDENTITY" section above/below it (match the screen's existing JSX patterns, class names, and copy style — read the surrounding components first):
  - Signed out: email input + "Send Magic Link" + Google/GitHub buttons + link-sent confirmation + error display (`role="alert"`), mirroring the hub's PlayerConsole flow (state: email, linkSent, busy, notice; reset linkSent when re-entering the screen).
  - Signed in: show email + handle (or handle registration input when null, 1-12 chars) + "Sign Out" button. Note copy: "Same identity as GridWatch Drift and the Command Nexus hub — one handle, every sector."
  - `useAuth()` is called ONCE in the top-level `App` component and passed down to `AccountScreen` (and later Task 4's `GameScreen`) via props — do not instantiate per-screen.
- [ ] **Step 3: Verify** — gates pass; `npm run dev` + browser: Account screen renders both states (signed-out only, since no local session), game unaffected. E2E tests (`npm run test:e2e`) if quick — note results either way.
- [ ] **Step 4: Commit**

```bash
git add src/services/supabase.ts src/services/handle.ts src/hooks/useAuth.ts src/App.tsx
git commit -m "feat: Supabase auth — guest-first magic link + OAuth + shared handle (Account screen)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Score submission wiring in the game

**Files:**
- Create: `src/services/scoreApi.ts`
- Modify: `src/App.tsx` (`GameScreen`: run-stats accumulation in `applyAction` ~L376, submission in `finishWin` ~L336, status line on the "won" modal)

**Interfaces:**
- Consumes: Task 2's HTTP contract; Task 3's `useAuth` session (threaded to GameScreen as a prop).
- Produces: `submitScore(accessToken, payload)` in `scoreApi.ts`; submission state surfaced on the won screen.

- [ ] **Step 1: Write `src/services/scoreApi.ts`**

```ts
export interface RunTelemetry {
  tilesCleared: number;
  powerUpEvents: number;
  chainSum: number;
  moveCount: number;
  stars: number;
  playOnUsed: boolean;
  durationSec?: number;
}

export interface SubmitResult {
  ok: boolean;
  levelScore: number;
  levelImproved: boolean;
  levelBest: number;
  campaignScore: number;
}

export async function submitScore(
  accessToken: string,
  levelId: number,
  telemetry: RunTelemetry,
  actionLog: unknown[],
): Promise<SubmitResult> {
  const res = await fetch("/api/score", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ levelId, telemetry, actionLog }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Submit failed (${res.status}).`);
  }
  return (await res.json()) as SubmitResult;
}
```

- [ ] **Step 2: Run-stats accumulation** in `GameScreen`: a `runStatsRef = useRef({ tilesCleared: 0, powerUpEvents: 0, chainSum: 0 })`, reset where the engine/level initializes (same place `scoreRef` resets); in `applyAction` after the existing `delta` handling add:

```ts
runStatsRef.current.tilesCleared += delta.clears.length;
runStatsRef.current.powerUpEvents += delta.powerUpEvents.length;
runStatsRef.current.chainSum += Math.max(0, delta.chainDepth);
```

- [ ] **Step 3: Submission in `finishWin`**, immediately after `commitSave(next); saveRef.current = next;` — fire-and-forget with state for the UI:

```ts
const isTestMode = new URLSearchParams(window.location.search).has("gwTestMode");
if (!isTestMode && auth.session) {
  const token = auth.session.access_token;
  setSubmitState({ kind: "sending" });
  submitScore(token, currentLevel.id, {
    ...runStatsRef.current,
    moveCount: currentSnapshot.moveCount,
    stars,
    playOnUsed,
  }, engine.actionLog())
    .then((r) => setSubmitState({ kind: "done", result: r }))
    .catch((err) => setSubmitState({ kind: "error", message: err instanceof Error ? err.message : "Transmit failed." }));
} else {
  setSubmitState({ kind: "skipped", reason: isTestMode ? "test" : "signedOut" });
}
```

(`auth` arrives in GameScreen as a prop from App; add `submitState` to GameScreen state, reset alongside `runStatsRef`. Add `auth.session` (or the stable token/user id) to `finishWin`'s `useCallback` deps.)
- [ ] **Step 4: Won-modal status line** (match existing modal styling): sending → "TRANSMITTING SCORE…"; done+improved → "SCORE TRANSMITTED — CAMPAIGN TOTAL {campaignScore.toLocaleString()}"; done+!improved → "ARCHIVE BEST STANDS ({levelBest.toLocaleString()})"; error → the error message; skipped signedOut → "SIGN IN ON THE ACCOUNT SCREEN TO POST SCORES"; skipped test → render nothing.
- [ ] **Step 5: Verify** — gates pass; dev-server manual check: win via `?gwTestMode=1` + QA Win button → NO network call to /api/score (verify in devtools/network or via code inspection) and no status line; normal signed-out win path would show the sign-in prompt (playing a real level manually is optional — code-inspect if impractical, and say so in the report).
- [ ] **Step 6: Commit**

```bash
git add src/services/scoreApi.ts src/App.tsx
git commit -m "feat: server-mediated score submission on level win (telemetry + action-log proof)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Hub — light up the Match tab (in the Command Nexus repo)

**Files (repo "/Users/russmeadows/Dev/1 - WarSignalLabs/1 - Apps/2 - WebApps/gridwatch-command-nexus", branch `feat/phase3-match-tab` from main):**
- Modify: `src/lib/leaderboards.ts` (GAME_SLUGS.match null → "gridwatch-match"), `src/lib/useOperatorStats.ts` + `components/PlayerConsole.tsx` (add MATCH STANDING row)

- [ ] **Step 1:** `GAME_SLUGS.match: "gridwatch-match"` (update the comment — Phase 3 shipped). The LeaderboardPanel offline copy for Match keys off the null slug and disappears automatically; Global Operators stays null/offline.
- [ ] **Step 2:** `useOperatorStats`: add `match: GameStat` (same `fetchRank(GAME_SLUGS.match, "standard")` pattern); PlayerConsole signed-in grid: add `<div><dt>MATCH STANDING</dt><dd>{statText(stats.match)}</dd></div>` after SIGNAL BREACH STANDING.
- [ ] **Step 3:** Verify (`npm run typecheck && npm run build && npm test`), commit:

```bash
git add src/lib/leaderboards.ts src/lib/useOperatorStats.ts components/PlayerConsole.tsx
git commit -m "feat: enable Match leaderboard tab + stats row (Phase 3 backend live)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Controller deploys the hub after the MatchWeb Worker is live.)

---

### Task 6: Provision, deploy, cutover, E2E, docs (controller task)

- [ ] Secret: pipe `SUPABASE_SERVICE_ROLE_KEY` from Drift's gitignored `.dev.vars` (value never enters the transcript) into `npx wrangler secret put` for worker `gridwatch-match`; fallback = ask Russ to run the command.
- [ ] First deploy (workers.dev only): `npm run build && npx wrangler deploy`; verify assets serve + `POST /api/score` returns 401 without a token and 422/401 for garbage.
- [ ] Domain cutover: detach `gridwatchmatchweb.warsignallabs.net` from Pages project `gridwatchmatch` (dashboard via Chrome), add the `routes` block to `wrangler.jsonc`, redeploy, verify the domain serves the game + Worker. Attempt Workers Builds git-connection (Chrome); manual deploys are the fallback.
- [ ] Live E2E: game loads on the domain; sign-in flow (magic link via Chrome/Gmail, hub-pattern); Account screen shows handle "Russ". REAL score submission E2E = Russ playtest (win any level signed-in; the won modal should show "SCORE TRANSMITTED — CAMPAIGN TOTAL …" and the hub's Match tab should show the row) — documented as the acceptance step, per the house human-playability gate.
- [ ] Deploy the hub (Task 5) and verify the Match tab reads (shows "NO RUNS LOGGED" until Russ's first submitted win).
- [ ] Update both repos' HANDOFF/MEMORY docs; merge branches; pushing = Russ's call.

---

## Self-review notes
- Spec coverage: D5.1 hosting (T1+T6), D5.2 auth (T3), D5.3 submission+hook+exclusions (T4), D5.4 worker validation/derivation (T2), D5.5 campaign-total semantics (T2 worker), D5.6 games row (done live pre-plan). playOnUsed recorded everywhere (telemetry/metadata/proof), ranks normally (reversible).
- Type consistency: `Telemetry`/`RunTelemetry` field names match across worker and client (tilesCleared/powerUpEvents/chainSum/moveCount/stars/playOnUsed); response fields consumed by the modal match `SubmitResult`; hub `GameStat` reused as-is.
- No placeholders: full code for worker, validation, tests, client service, and wiring; UI steps name exact anchors (AccountScreen L723, finishWin L336, applyAction L376) with adapt-to-local-style instructions.
