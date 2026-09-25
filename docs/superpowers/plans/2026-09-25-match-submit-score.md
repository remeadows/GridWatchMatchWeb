# Match onto the shared board registry (leaderboards phase 3, game 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Match's `/api/score` worker writes each won level to the shared board registry through one service-role `submit_score` call (`gridwatch-match / campaign / r1`, entry `level:<id>`), and stops writing `public.scores`.

**Architecture:** The worker keeps its auth check, its telemetry plausibility validation (`worker/validation.ts`) and `deriveScore`. It replaces the legacy `scores` insert/patch fan-out (per-level, `standard` campaign total, `daily-*`, `weekly-*`) with a single RPC. The database sums level bests into the campaign total and maintains the `all` and week periods. The pure parts (replay key, RPC args, status → HTTP mapping) live in a new `worker/scoreBoard.ts` so they can be unit-tested. The client stamps each win with a `runId` and `endedAt`, so a retried or replayed submission is answered as a duplicate instead of a conflict. Match has no in-game leaderboard reads, so no read-side client change is needed. Nexus already renders the Match board.

**Tech Stack:** TypeScript, Cloudflare Workers (`worker/index.ts`), Supabase PostgREST RPC, React 19 client, Vitest 4.

**Spec:** `gridwatch-command-nexus` repo, `docs/superpowers/specs/2026-09-24-nexus-leaderboards-rebuild-design.md`: §2 (write path), §5 (Match row and per-game mapping), §6 (rollout). The database side is live: Nexus migrations `20260924131533_leaderboard_boards` and `20260924135833_submit_score_board_lock`. Drift's reference implementation is `GW-Tetris-Race` `worker/scoreBoard.js` at `9f484da`.

## Global Constraints

- Board: game slug `gridwatch-match`, board key `campaign`, ruleset `r1`, kind `sum`, `entry_key_pattern` `^level:[0-9]{1,3}$`, `max_entry_score` 25000, periods `all, week`.
- `submit_score(p_user_id uuid, p_game_slug text, p_board_key text, p_ruleset text, p_entries jsonb, p_achieved_at timestamptz, p_request_id text, p_proof_hash text, p_meta jsonb) returns jsonb` → `{status, improved, total}`. Statuses: `ok`, `duplicate`, `request_conflict`, `invalid_request`, `unknown_board`, `ruleset_mismatch`, `invalid_time`, `invalid_entry`, `score_out_of_range`. It never raises, and only `service_role` may execute it.
- `p_request_id` must match `^[A-Za-z0-9_-]{16,64}$`. `p_proof_hash` must match `^[0-9a-f]{64}$` or be null. `p_meta` must be a JSON object of at most 4 KB, or null.
- `p_achieved_at` must be within `[now − 24 h, now + 5 min]` in the DB. The worker honours a client `endedAt` only within `[now − 1 h, now + 1 min]` and otherwise uses server time (the same rule as Drift).
- Match "submits `{key: "level:<id>", score}` for the level just won; the database sums. It no longer computes `standard` itself." The weekly board becomes "sum of level bests set this week". There is no daily board.
- **Never write to `scores` from any client, ever.** The only writer is this worker, using the service-role key. The key stays a wrangler secret / gitignored `.dev.vars`, and must never be committed or echoed.
- Don't change the telemetry validation rules or `deriveScore` (they mirror the client's engine).
- Tests run with `npx vitest run`, and CI runs `npm run validate:levels`, `npm run test`, `npm audit --audit-level=high` and `npm run build`. The baseline on `origin/main` (`1c5ae8a`) is 498 passing tests.

## Rulings made while planning

- **Meta holds a compact proof; `proof_hash` covers the full one.** Legacy rows stored `{v, telemetry, actionLog}` (the action log can be up to 64 KB), but `p_meta` is capped at 4 KB. `p_meta` is `{v: 1, levelId, telemetry, actionLogLength}`, and `p_proof_hash` is the sha-256 of the full `{v: 1, telemetry, actionLog}` proof, exactly as today. *Cost if wrong:* the action logs for future replay verification are no longer kept server-side. Nothing reads them today. Restoring them later would need a separate proof-storage table (a Nexus migration).
- **"ARCHIVE BEST STANDS" shows the campaign total, not the level best.** `submit_score` returns only `improved` and the all-time `total`. It does not return the per-entry best, and the worker can't read `board_entries` (privileges are revoked). So when a win didn't beat the stored level best, the line reads `ARCHIVE BEST STANDS — CAMPAIGN TOTAL <n>`, and `levelBest` leaves the response. *Cost if wrong:* a copy tweak.
- **The client sends `runId` and `endedAt`.** Without them, the fallback request id is the proof hash. Two identical winning move sequences inside the one-hour replay window would then hash identically but carry different server times, and would get `request_conflict` (409) instead of a clean result. A per-win random id avoids that.

## File structure

| File | Responsibility |
|---|---|
| `worker/scoreBoard.ts` (new) | Pure write-side helpers: board constants, run key, `submit_score` args, status → HTTP mapping. |
| `worker/index.ts` | Route handling. `handleScore` = auth → validate → derive → one RPC → mapped reply. The legacy `scores` helpers are removed. |
| `worker/validation.ts` | Unchanged validation. The unused category and campaign-cap exports are removed. |
| `src/services/scoreApi.ts` | Client submit call. It sends `runId` and `endedAt`, drops `levelBest` from the result, and adds `newRunId()`. |
| `src/App.tsx` | Stamps each win with `newRunId()` and `endedAt`. Not-improved copy uses the campaign total. |
| `src/tests/scoreBoard.test.ts` (new) | Unit tests for `worker/scoreBoard.ts`. |
| `src/tests/scoreWorker.test.ts` (new) | `/api/score` through the worker's default export with stubbed `fetch`. |
| `src/tests/scoreApi.test.ts` (new) | Client submit call and `newRunId`. |
| `src/tests/worker-validation.test.ts` | Drops the `categories` block for the removed exports. |
| `HANDOFF.md`, `MEMORY.md` | Record the change. |

---

### Task 1: `worker/scoreBoard.ts`, the pure write-side helpers

**Files:**
- Create: `worker/scoreBoard.ts`
- Test: `src/tests/scoreBoard.test.ts`

**Interfaces:**
- Consumes: `GAME_SLUG` from `worker/validation.ts` (`"gridwatch-match"`) and the `Telemetry` type from `worker/validation.ts`.
- Produces:
  - `BOARD_KEY = "campaign"`, `BOARD_RULESET = "r1"`
  - `validRunId(v: unknown): v is string`
  - `endedAtInWindow(v: unknown, now: Date): v is string`
  - `runKey(runId: unknown, endedAt: unknown, proofHash: string, now: Date): { requestId: string; achievedAt: string }`
  - `entryKey(levelId: number): string`
  - `interface ScoreMeta { v: 1; levelId: number; telemetry: Telemetry; actionLogLength: number }`
  - `interface SubmitScoreArgs { p_user_id: string; p_game_slug: string; p_board_key: string; p_ruleset: string; p_entries: { key: string; score: number }[]; p_achieved_at: string; p_request_id: string; p_proof_hash: string; p_meta: ScoreMeta }`
  - `submitArgs(input: { userId: string; levelId: number; score: number; meta: ScoreMeta; proofHash: string; requestId: string; achievedAt: string }): SubmitScoreArgs`
  - `interface ScoreReply { ok: true; levelScore: number; levelImproved: boolean; campaignScore: number }`
  - `interface MappedReply { status: number; body: ScoreReply | { error: string }; log?: string }`
  - `submitStatus(result: unknown, score: number): MappedReply`

- [ ] **Step 1: Write the failing tests** in `src/tests/scoreBoard.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  BOARD_KEY,
  BOARD_RULESET,
  endedAtInWindow,
  entryKey,
  runKey,
  submitArgs,
  submitStatus,
  validRunId,
  type ScoreMeta,
} from "../../worker/scoreBoard";

const NOW = new Date("2026-09-25T12:00:00.000Z");
const HASH = "a".repeat(64);
const META: ScoreMeta = {
  v: 1,
  levelId: 7,
  telemetry: { tilesCleared: 30, powerUpEvents: 2, chainSum: 4, moveCount: 12, stars: 3, playOnUsed: false },
  actionLogLength: 12,
};

describe("board constants", () => {
  it("targets gridwatch-match / campaign / r1", () => {
    expect(BOARD_KEY).toBe("campaign");
    expect(BOARD_RULESET).toBe("r1");
  });
  it("keys entries level:<id> without padding (matches ^level:[0-9]{1,3}$)", () => {
    expect(entryKey(7)).toBe("level:7");
    expect(entryKey(100)).toBe("level:100");
  });
});

describe("validRunId", () => {
  it("accepts 16–64 chars of [A-Za-z0-9_-]", () => {
    expect(validRunId("a".repeat(16))).toBe(true);
    expect(validRunId("A-b_9".repeat(12) + "abcd")).toBe(true); // 64 chars
    expect(validRunId("0123456789abcdef0123456789abcdef")).toBe(true);
  });
  it("rejects anything else", () => {
    expect(validRunId(undefined)).toBe(false);
    expect(validRunId(12345678901234567)).toBe(false);
    expect(validRunId("a".repeat(15))).toBe(false);
    expect(validRunId("a".repeat(65))).toBe(false);
    expect(validRunId("a".repeat(15) + "!")).toBe(false);
  });
});

describe("endedAtInWindow", () => {
  it("accepts a parseable time within [now − 1 h, now + 1 min]", () => {
    expect(endedAtInWindow("2026-09-25T11:00:00.000Z", NOW)).toBe(true);
    expect(endedAtInWindow("2026-09-25T12:01:00.000Z", NOW)).toBe(true);
  });
  it("rejects outside the window, unparseable, non-string or over-long input", () => {
    expect(endedAtInWindow("2026-09-25T10:59:59.999Z", NOW)).toBe(false);
    expect(endedAtInWindow("2026-09-25T12:01:00.001Z", NOW)).toBe(false);
    expect(endedAtInWindow("not a time", NOW)).toBe(false);
    expect(endedAtInWindow(Date.parse("2026-09-25T11:30:00Z"), NOW)).toBe(false);
    expect(endedAtInWindow("2026-09-25T11:30:00.000Z" + " ".repeat(20), NOW)).toBe(false);
  });
});

describe("runKey", () => {
  it("uses a valid runId and in-window endedAt", () => {
    expect(runKey("r".repeat(32), "2026-09-25T11:59:00Z", HASH, NOW)).toEqual({
      requestId: "r".repeat(32),
      achievedAt: "2026-09-25T11:59:00.000Z",
    });
  });
  it("falls back to the proof hash and server time", () => {
    expect(runKey(undefined, "2026-09-20T00:00:00Z", HASH, NOW)).toEqual({
      requestId: HASH,
      achievedAt: NOW.toISOString(),
    });
  });
});

describe("submitArgs", () => {
  it("builds one level entry on gridwatch-match / campaign / r1", () => {
    expect(
      submitArgs({ userId: "u1", levelId: 7, score: 610, meta: META, proofHash: HASH, requestId: "r".repeat(32), achievedAt: NOW.toISOString() }),
    ).toEqual({
      p_user_id: "u1",
      p_game_slug: "gridwatch-match",
      p_board_key: "campaign",
      p_ruleset: "r1",
      p_entries: [{ key: "level:7", score: 610 }],
      p_achieved_at: NOW.toISOString(),
      p_request_id: "r".repeat(32),
      p_proof_hash: HASH,
      p_meta: META,
    });
  });
  it("keeps meta well under the 4 KB cap", () => {
    expect(JSON.stringify(META).length).toBeLessThan(4096);
  });
});

describe("submitStatus", () => {
  it("maps ok and duplicate to 200 with the campaign total", () => {
    expect(submitStatus({ status: "ok", improved: true, total: 1500 }, 610)).toEqual({
      status: 200,
      body: { ok: true, levelScore: 610, levelImproved: true, campaignScore: 1500 },
    });
    expect(submitStatus({ status: "duplicate", improved: false, total: "1500" }, 610)).toEqual({
      status: 200,
      body: { ok: true, levelScore: 610, levelImproved: false, campaignScore: 1500 },
    });
  });
  it("falls back to the level score when total is missing", () => {
    expect(submitStatus({ status: "ok", improved: true }, 610).body).toEqual({
      ok: true, levelScore: 610, levelImproved: true, campaignScore: 610,
    });
  });
  it("maps rejections to 409 / 422 / 400", () => {
    expect(submitStatus({ status: "request_conflict" }, 1)).toEqual({ status: 409, body: { error: "Run already logged to the archive." } });
    expect(submitStatus({ status: "invalid_time" }, 1)).toEqual({ status: 422, body: { error: "Run too old to log." } });
    expect(submitStatus({ status: "invalid_entry" }, 1)).toEqual({ status: 422, body: { error: "Score rejected by the archive." } });
    expect(submitStatus({ status: "score_out_of_range" }, 1)).toEqual({ status: 422, body: { error: "Score rejected by the archive." } });
    expect(submitStatus({ status: "invalid_request" }, 1)).toEqual({ status: 400, body: { error: "Bad submission." } });
  });
  it("maps registry mismatches to a logged 503", () => {
    for (const status of ["unknown_board", "ruleset_mismatch"]) {
      const out = submitStatus({ status }, 1);
      expect(out.status).toBe(503);
      expect(out.body).toEqual({ error: "Leaderboard season changed — try again later." });
      expect(out.log).toBe(`submit_score ${status} for gridwatch-match/campaign/r1`);
    }
  });
  it("maps anything else to a logged 500", () => {
    const out = submitStatus({ status: "weird" }, 1);
    expect(out.status).toBe(500);
    expect(out.body).toEqual({ error: "Archive write failed." });
    expect(out.log).toBe('submit_score unexpected result: {"status":"weird"}');
    expect(submitStatus(null, 1).status).toBe(500);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/tests/scoreBoard.test.ts`
Expected: FAIL, because `../../worker/scoreBoard` can't be resolved.

- [ ] **Step 3: Write `worker/scoreBoard.ts`**

```ts
/* Write side of the shared board registry for GridWatch Match (Nexus spec
   docs/superpowers/specs/2026-09-24-nexus-leaderboards-rebuild-design.md §2, §5).
   Match's board is gridwatch-match / campaign / r1 (kind sum, one entry per won level keyed
   `level:<id>`; the database sums level bests into the campaign total). A new ruleset means a
   new board: bump BOARD_RULESET together with the Nexus migration that registers it —
   submit_score answers ruleset_mismatch until both agree. */
import { GAME_SLUG, type Telemetry } from "./validation";

export const BOARD_KEY = "campaign";
export const BOARD_RULESET = "r1";

const REQUEST_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

// The worker only honours endedAt within [now − 1 h, now + 1 min] — enough for a sign-in round
// trip or a retry, and never beyond the DB's 1 h replay window.
const ENDED_AT_MAX_AGE_MS = 60 * 60 * 1000;
const ENDED_AT_MAX_SKEW_MS = 60 * 1000;

export function validRunId(v: unknown): v is string {
  return typeof v === "string" && REQUEST_ID_RE.test(v);
}

export function endedAtInWindow(v: unknown, now: Date): v is string {
  if (typeof v !== "string" || v.length > 40) return false;
  const ended = Date.parse(v);
  if (!Number.isFinite(ended)) return false;
  const nowMs = now.getTime();
  return ended >= nowMs - ENDED_AT_MAX_AGE_MS && ended <= nowMs + ENDED_AT_MAX_SKEW_MS;
}

/* Replay key + run time. The client stamps each win with runId and endedAt; a resend of the
   same win gets submit_score's stored result back as `duplicate` instead of counting twice.
   Bundles from before this change send neither: fall back to the proof hash and server time.
   A skewed device clock falls back to server time, so honest runs are never rejected
   (the DB refuses achieved_at outside [now − 24 h, now + 5 min]) and a client can't pick an
   old week. */
export function runKey(
  runId: unknown,
  endedAt: unknown,
  proofHash: string,
  now: Date,
): { requestId: string; achievedAt: string } {
  const requestId = validRunId(runId) ? runId : proofHash;
  const achievedAt = endedAtInWindow(endedAt, now) ? new Date(Date.parse(endedAt)).toISOString() : now.toISOString();
  return { requestId, achievedAt };
}

export function entryKey(levelId: number): string {
  return `level:${levelId}`;
}

// Compact proof kept with the entry (p_meta ≤ 4 KB). The full proof — including the action
// log, up to 64 KB — is covered by p_proof_hash but not stored.
export interface ScoreMeta {
  v: 1;
  levelId: number;
  telemetry: Telemetry;
  actionLogLength: number;
}

export interface SubmitScoreArgs {
  p_user_id: string;
  p_game_slug: string;
  p_board_key: string;
  p_ruleset: string;
  p_entries: { key: string; score: number }[];
  p_achieved_at: string;
  p_request_id: string;
  p_proof_hash: string;
  p_meta: ScoreMeta;
}

export function submitArgs(input: {
  userId: string;
  levelId: number;
  score: number;
  meta: ScoreMeta;
  proofHash: string;
  requestId: string;
  achievedAt: string;
}): SubmitScoreArgs {
  return {
    p_user_id: input.userId,
    p_game_slug: GAME_SLUG,
    p_board_key: BOARD_KEY,
    p_ruleset: BOARD_RULESET,
    p_entries: [{ key: entryKey(input.levelId), score: input.score }],
    p_achieved_at: input.achievedAt,
    p_request_id: input.requestId,
    p_proof_hash: input.proofHash,
    p_meta: input.meta,
  };
}

export interface ScoreReply {
  ok: true;
  levelScore: number;
  levelImproved: boolean;
  campaignScore: number;
}

export interface MappedReply {
  status: number;
  body: ScoreReply | { error: string };
  log?: string;
}

/* submit_score status → HTTP. ok/duplicate are successes (a duplicate is a resend of a win
   that already committed). The two board-config statuses mean this worker is out of step
   with the registry — a deploy problem, logged loudly, not the player's fault. */
export function submitStatus(result: unknown, score: number): MappedReply {
  const r = (typeof result === "object" && result !== null ? result : {}) as Record<string, unknown>;
  const status = r.status;
  if (status === "ok" || status === "duplicate") {
    const total = r.total == null ? NaN : Number(r.total);
    return {
      status: 200,
      body: { ok: true, levelScore: score, levelImproved: r.improved === true, campaignScore: Number.isFinite(total) ? total : score },
    };
  }
  if (status === "request_conflict") return { status: 409, body: { error: "Run already logged to the archive." } };
  if (status === "invalid_time") return { status: 422, body: { error: "Run too old to log." } };
  if (status === "invalid_entry" || status === "score_out_of_range")
    return { status: 422, body: { error: "Score rejected by the archive." } };
  if (status === "invalid_request") return { status: 400, body: { error: "Bad submission." } };
  if (status === "unknown_board" || status === "ruleset_mismatch") {
    return {
      status: 503,
      body: { error: "Leaderboard season changed — try again later." },
      log: `submit_score ${status} for ${GAME_SLUG}/${BOARD_KEY}/${BOARD_RULESET}`,
    };
  }
  return { status: 500, body: { error: "Archive write failed." }, log: `submit_score unexpected result: ${JSON.stringify(result)}` };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/tests/scoreBoard.test.ts && npx tsc -p worker/tsconfig.json --noEmit`
Expected: all pass, with no type errors.

- [ ] **Step 5: Commit**

```bash
git add worker/scoreBoard.ts src/tests/scoreBoard.test.ts
git commit -m "feat(worker): submit_score helpers for gridwatch-match/campaign/r1"
```

---

### Task 2: Rewire `/api/score` to one `submit_score` call

**Files:**
- Modify: `worker/index.ts` (imports, remove `gameId`/`upsertBest`/`campaignTotal`, rewrite `handleScore`)
- Modify: `worker/validation.ts` (remove `CAMPAIGN_SCORE_CAP`, `dailyCategory`, `weeklyCategory`, `levelCategory` and the rotating-board comment above them)
- Modify: `src/tests/worker-validation.test.ts` (drop those imports and the `describe("categories", …)` block)
- Test: `src/tests/scoreWorker.test.ts`

**Interfaces:**
- Consumes (Task 1): `runKey`, `submitArgs`, `submitStatus`, `type ScoreMeta` from `./scoreBoard`.
- Produces: `POST /play/match/api/score` → `200 {ok, levelScore, levelImproved, campaignScore}` or the Task 1 error statuses. `401` without a valid bearer token, `422` on validation failure, `502 {error: "Archive write failed."}` when the RPC request itself fails (a non-2xx HTTP response or a network error). The request body gains optional `runId` and `endedAt` (strings), read at the top level next to `levelId`, `telemetry` and `actionLog`.

- [ ] **Step 1: Write the failing test** `src/tests/scoreWorker.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import worker from "../../worker/index";
import { starsFor, moveLimitFor } from "../../worker/validation";

const env = {
  ASSETS: { fetch: () => Promise.resolve(new Response("asset")) },
  SUPABASE_URL: "https://sb.example",
  SUPABASE_ANON_KEY: "anon-placeholder",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-placeholder",
};

const moveCount = 5;
const body = (over: Record<string, unknown> = {}) => ({
  levelId: 1,
  telemetry: {
    tilesCleared: 20,
    powerUpEvents: 1,
    chainSum: 2,
    moveCount,
    stars: starsFor(moveCount, moveLimitFor(1)!),
    playOnUsed: false,
  },
  actionLog: [{ a: 1 }, { a: 2 }],
  ...over,
});

type Rpc = { status: number; json: unknown };
function stubFetch(rpc: Rpc | Error, user: { id: string } | null = { id: "user-1" }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/auth/v1/user")) {
      return user ? new Response(JSON.stringify(user), { status: 200 }) : new Response("{}", { status: 401 });
    }
    if (url.endsWith("/rest/v1/rpc/submit_score")) {
      if (rpc instanceof Error) throw rpc;
      return new Response(JSON.stringify(rpc.json), { status: rpc.status });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  return calls;
}

const post = (b: unknown, token = "tok") =>
  worker.fetch(
    new Request("https://gridwatch-match.russell-meadows.workers.dev/play/match/api/score", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(b),
    }),
    env,
  );

afterEach(() => vi.unstubAllGlobals());

describe("/api/score → submit_score", () => {
  it("makes exactly one service-role RPC with a level entry and returns the campaign total", async () => {
    const calls = stubFetch({ status: 200, json: { status: "ok", improved: true, total: 4200 } });
    const runId = "0123456789abcdef0123456789abcdef";
    const endedAt = new Date(Date.now() - 5_000).toISOString();
    const res = await post(body({ runId, endedAt }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, levelScore: 20 * 10 + 1 * 25 + 2 * 50, levelImproved: true, campaignScore: 4200 });

    const rpcCalls = calls.filter((c) => c.url.includes("/rest/v1/"));
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].url).toBe("https://sb.example/rest/v1/rpc/submit_score");
    const headers = rpcCalls[0].init?.headers as Record<string, string>;
    expect(headers.apikey).toBe("service-role-placeholder");
    expect(headers.authorization).toBe("Bearer service-role-placeholder");

    const args = JSON.parse(String(rpcCalls[0].init?.body));
    expect(args).toMatchObject({
      p_user_id: "user-1",
      p_game_slug: "gridwatch-match",
      p_board_key: "campaign",
      p_ruleset: "r1",
      p_entries: [{ key: "level:1", score: 325 }],
      p_request_id: runId,
      p_achieved_at: endedAt,
    });
    expect(args.p_proof_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(args.p_meta).toEqual({ v: 1, levelId: 1, telemetry: body().telemetry, actionLogLength: 2 });
  });

  it("never touches the legacy scores table or games lookup", async () => {
    const calls = stubFetch({ status: 200, json: { status: "ok", improved: false, total: 325 } });
    await post(body());
    expect(calls.some((c) => c.url.includes("/rest/v1/scores") || c.url.includes("/rest/v1/games"))).toBe(false);
  });

  it("falls back to the proof hash as request id without a runId", async () => {
    const calls = stubFetch({ status: 200, json: { status: "ok", improved: true, total: 325 } });
    await post(body());
    const args = JSON.parse(String(calls.find((c) => c.url.endsWith("/rpc/submit_score"))?.init?.body));
    expect(args.p_request_id).toBe(args.p_proof_hash);
  });

  it("maps request_conflict to 409", async () => {
    stubFetch({ status: 200, json: { status: "request_conflict" } });
    const res = await post(body());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Run already logged to the archive." });
  });

  it("logs and 503s on a registry mismatch", async () => {
    stubFetch({ status: 200, json: { status: "ruleset_mismatch" } });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post(body());
    expect(res.status).toBe(503);
    expect(err).toHaveBeenCalledWith("[score] submit_score ruleset_mismatch for gridwatch-match/campaign/r1");
    err.mockRestore();
  });

  it("returns 502 when the RPC call fails", async () => {
    stubFetch({ status: 500, json: { message: "boom" } });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post(body());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Archive write failed." });
    err.mockRestore();
  });

  it("401s without a verified user and makes no RPC", async () => {
    const calls = stubFetch({ status: 200, json: { status: "ok" } }, null);
    const res = await post(body());
    expect(res.status).toBe(401);
    expect(calls.some((c) => c.url.includes("/rest/v1/"))).toBe(false);
  });

  it("422s on implausible telemetry and makes no RPC", async () => {
    const calls = stubFetch({ status: 200, json: { status: "ok" } });
    const res = await post(body({ levelId: 999 }));
    expect(res.status).toBe(422);
    expect(calls.some((c) => c.url.includes("/rest/v1/"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/tests/scoreWorker.test.ts`
Expected: FAIL. The current worker calls `/rest/v1/games` first, which the stub rejects with "unexpected fetch".

- [ ] **Step 3: Rewrite the worker.** In `worker/index.ts`:

Replace the import block from `./validation` with:

```ts
import { deriveScore, validateSubmission } from "./validation";
import { runKey, submitArgs, submitStatus, type ScoreMeta } from "./scoreBoard";
```

Delete `let cachedGameId`/`gameId()`, `interface UpsertResult`, `upsertBest()` and `campaignTotal()` entirely. Keep `json`, `verifyUser`, `sbHeaders` and `sha256Hex`. Replace `handleScore` with:

```ts
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
  const b = body as Record<string, unknown>;

  const score = deriveScore(v.telemetry);
  const now = new Date();
  // Full proof is hashed (as before); only a compact form rides in meta (≤ 4 KB).
  const proof = { v: 1, telemetry: v.telemetry, actionLog: v.actionLog };
  const proofHash = await sha256Hex(JSON.stringify(proof));
  const { requestId, achievedAt } = runKey(b.runId, b.endedAt, proofHash, now);
  const meta: ScoreMeta = { v: 1, levelId: v.levelId, telemetry: v.telemetry, actionLogLength: v.actionLog.length };

  // One write: submit_score (gridwatch-match / campaign / r1). The database keeps the level
  // best improve-only and re-sums the campaign total for `all` and the week of achievedAt.
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/submit_score`, {
    method: "POST",
    headers: sbHeaders(env),
    body: JSON.stringify(submitArgs({ userId: user.id, levelId: v.levelId, score, meta, proofHash, requestId, achievedAt })),
  });
  if (!res.ok) throw new Error(`submit_score failed: ${res.status}`);

  const out = submitStatus(await res.json(), score);
  if (out.log) console.error(`[score] ${out.log}`);
  return json(out.status, out.body);
}
```

The existing `fetch` handler already turns a thrown error into `502 {error: "Archive write failed."}`, so leave it unchanged.

In `worker/validation.ts`, delete `CAMPAIGN_SCORE_CAP`, the rotating-board comment block with `dailyCategory` and `weeklyCategory`, and `levelCategory`. Leave everything else byte-identical. In `src/tests/worker-validation.test.ts`, remove `dailyCategory`, `levelCategory` and `weeklyCategory` from the import list, and delete the whole `describe("categories", …)` block.

- [ ] **Step 4: Run the tests and type-check**

Run: `npx vitest run src/tests/scoreWorker.test.ts src/tests/scoreBoard.test.ts src/tests/worker-validation.test.ts src/tests/playPrefixWorker.test.ts && npx tsc -p worker/tsconfig.json --noEmit && git grep -n -E "rest/v1/scores|rest/v1/games|dailyCategory|weeklyCategory|levelCategory|CAMPAIGN_SCORE_CAP" -- worker src/services src/App.tsx src/tests/worker-validation.test.ts`
Expected: all tests pass, no type errors, and the grep prints nothing. The new `scoreWorker.test.ts` is deliberately excluded, because it asserts on the `/rest/v1/scores` URL string.

- [ ] **Step 5: Commit**

```bash
git add worker/index.ts worker/validation.ts src/tests/worker-validation.test.ts src/tests/scoreWorker.test.ts
git commit -m "feat(worker): /api/score writes through submit_score, not public.scores"
```

---

### Task 3: The client stamps each win and reads the new reply

**Files:**
- Modify: `src/services/scoreApi.ts`
- Modify: `src/App.tsx` (the `submitScore(...)` call in `finishWin`, about line 801, and `submitStatusLine`'s `"done"` case, about lines 1532–1535)
- Test: `src/tests/scoreApi.test.ts`

**Interfaces:**
- Consumes (Task 2): the request body accepts top-level `runId` and `endedAt`, and the reply is `{ok, levelScore, levelImproved, campaignScore}`.
- Produces:
  - `newRunId(): string` (32 lowercase hex chars)
  - `interface RunStamp { runId: string; endedAt: string }`
  - `submitScore(accessToken: string, levelId: number, telemetry: RunTelemetry, actionLog: unknown[], stamp: RunStamp): Promise<SubmitResult>`
  - `SubmitResult = { ok: boolean; levelScore: number; levelImproved: boolean; campaignScore: number }` (`levelBest` is removed)

- [ ] **Step 1: Write the failing test** `src/tests/scoreApi.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { newRunId, submitScore } from "../services/scoreApi";

const telemetry = { tilesCleared: 20, powerUpEvents: 1, chainSum: 2, moveCount: 5, stars: 3, playOnUsed: false };

afterEach(() => vi.unstubAllGlobals());

describe("newRunId", () => {
  it("is 32 lowercase hex chars (a valid submit_score request id) and unique", () => {
    const a = newRunId();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(newRunId()).not.toBe(a);
  });
});

describe("submitScore", () => {
  it("posts levelId, telemetry, actionLog, runId and endedAt with the bearer token", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, levelScore: 325, levelImproved: true, campaignScore: 900 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const stamp = { runId: "0123456789abcdef0123456789abcdef", endedAt: "2026-09-25T12:00:00.000Z" };

    const result = await submitScore("tok", 4, telemetry, [{ a: 1 }], stamp);

    expect(result).toEqual({ ok: true, levelScore: 325, levelImproved: true, campaignScore: 900 });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(JSON.parse(String(init.body))).toEqual({ levelId: 4, telemetry, actionLog: [{ a: 1 }], ...stamp });
  });

  it("throws the worker's error message on failure", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "Run already logged to the archive." }), { status: 409 }));
    await expect(
      submitScore("tok", 4, telemetry, [], { runId: "0123456789abcdef0123456789abcdef", endedAt: "2026-09-25T12:00:00.000Z" }),
    ).rejects.toThrow("Run already logged to the archive.");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/tests/scoreApi.test.ts`
Expected: FAIL, because `newRunId` is not exported.

- [ ] **Step 3: Implement.** Replace `SubmitResult` and `submitScore` in `src/services/scoreApi.ts`, and add `newRunId` and `RunStamp`:

```ts
export interface SubmitResult {
  ok: boolean;
  levelScore: number;
  levelImproved: boolean;
  campaignScore: number;
}

// Stamped once per win so a resend of the same win is recognised by submit_score
// (request ids must match ^[A-Za-z0-9_-]{16,64}$).
export interface RunStamp {
  runId: string;
  endedAt: string;
}

export function newRunId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function submitScore(
  accessToken: string,
  levelId: number,
  telemetry: RunTelemetry,
  actionLog: unknown[],
  stamp: RunStamp,
): Promise<SubmitResult> {
  const res = await fetch(apiUrl("score"), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ levelId, telemetry, actionLog, runId: stamp.runId, endedAt: stamp.endedAt }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Submit failed (${res.status}).`);
  }
  return (await res.json()) as SubmitResult;
}
```

In `src/App.tsx`, change the import to `import { newRunId, submitScore, type SubmitResult } from "./services/scoreApi";`. In `finishWin`, pass the stamp as the fifth argument:

```ts
      submitScore(token, currentLevel.id, {
        ...runStatsRef.current,
        moveCount: currentSnapshot.moveCount,
        stars,
        playOnUsed,
      }, engine.actionLog(), { runId: newRunId(), endedAt: new Date().toISOString() })
```

In `submitStatusLine`, replace the not-improved line:

```tsx
        : <p className="delta-line">ARCHIVE BEST STANDS &mdash; CAMPAIGN TOTAL {state.result.campaignScore.toLocaleString()}</p>;
```

- [ ] **Step 4: Run the tests and the build**

Run: `npx vitest run src/tests/scoreApi.test.ts && npm run build && git grep -n "levelBest" -- src worker`
Expected: tests pass, the build succeeds (`tsc` for app + worker, then `vite build`), and the grep prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/services/scoreApi.ts src/App.tsx src/tests/scoreApi.test.ts
git commit -m "feat(client): stamp each win with runId/endedAt; not-improved line shows the campaign total"
```

---

### Task 4: Full verification and docs

**Files:**
- Modify: `HANDOFF.md` (new top entry after the header lines, above `## 🟢 2026-09-23: Nexus is the only host`), set `Last updated: 2026-09-25`
- Modify: `MEMORY.md` (the `/api/score` line)

**Interfaces:**
- Consumes: Tasks 1–3 as merged on the branch.
- Produces: docs only.

- [ ] **Step 1: Run the full CI set**

Run: `npm run validate:levels && npx vitest run && npm audit --audit-level=high && npm run build`
Expected: all green. The Vitest count is the 498 baseline, minus the 2 deleted category tests, plus the new `scoreBoard`, `scoreWorker` and `scoreApi` tests. Record the exact number.

- [ ] **Step 2: Write the HANDOFF entry** (fill in the counted test number from Step 1):

```markdown
## 2026-09-25: Leaderboards phase 3 — Match writes through the shared board registry (not deployed)

- **Plan / branch:** `docs/superpowers/plans/2026-09-25-match-submit-score.md`, branch `feat/match-submit-score`. It implements Nexus spec §6 phase 3, game 2 (gridwatch-command-nexus repo: `docs/superpowers/specs/2026-09-24-nexus-leaderboards-rebuild-design.md`). The database side is live.
- **Worker:** `/api/score` makes one service-role `rpc/submit_score` call for `gridwatch-match / campaign / r1` with entry `level:<id>`. That replaces the `scores` insert/patch fan-out: the per-level row, the self-computed `standard` campaign total, `daily-*` and `weekly-*`.
  - The database keeps level bests improve-only and sums them for `all` and the ISO week.
  - Telemetry validation and `deriveScore` are unchanged.
  - Statuses map to HTTP: 200 / 409 / 422 / 400 / 503 (registry mismatch, logged) / 500. A failed RPC request returns 502.
- **Behaviour changes (spec §5):** the weekly board is now "sum of level bests set this week" (it was best single run). There is no daily board. When a win doesn't beat the level best, the line reads `ARCHIVE BEST STANDS — CAMPAIGN TOTAL <n>`, because the per-level best isn't returned any more.
- **Proof:** `p_meta` holds `{v, levelId, telemetry, actionLogLength}`, and `p_proof_hash` covers the full `{v, telemetry, actionLog}`. The action log itself is no longer stored server-side, because it can reach 64 KB and meta is capped at 4 KB.
- **Client:** each win is stamped with `runId` (32 hex) and `endedAt`. The worker honours `endedAt` only within [now − 1 h, now + 1 min].
- **Evidence:** vitest <N>/<N>, `validate:levels`, `npm audit --audit-level=high`, `npm run build`, all green.

**Next:** Russ merges the PR, then deploys on his go. Deploy from a clean checkout of `origin/main` with `npm run build && npx wrangler deploy`, and first check that `dist/assets/*.js` doesn't contain `localhost:4173`. Acceptance, per the spec §6 gate: one real signed-in win each on Mac and iPhone. In Match the result reads `SCORE TRANSMITTED — CAMPAIGN TOTAL <n>`. On Nexus, the Match board shows the row with the `is_you` highlight and `YOU // #n OF m ON THE GRID`, and the Match card and operator console show the rank. Then Breach.
```

- [ ] **Step 3: Update MEMORY.md.** Change the `/api/score` line to:

```markdown
- Hosted on Cloudflare Workers + static Assets. The ONLY backend surface is `worker/index.ts` (`/api/score`): Supabase-auth-verified score submission that writes one `submit_score` RPC (`gridwatch-match / campaign / r1`, entry `level:<id>`) since 2026-09-25 — never `public.scores`. The one secret (`SUPABASE_SERVICE_ROLE_KEY`) lives in wrangler secrets / gitignored `.dev.vars`, never committed. No real-money fulfillment.
```

- [ ] **Step 4: Check and commit**

Run: `git diff --check`
Expected: no output.

```bash
git add HANDOFF.md MEMORY.md docs/superpowers/plans/2026-09-25-match-submit-score.md
git commit -m "docs(handoff): Match phase 3 — /api/score through submit_score"
```
