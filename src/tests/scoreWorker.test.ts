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
    expect(await res.json()).toEqual({ ok: true, levelScore: 20 * 10 + 1 * 25 + 2 * 50, levelImproved: true, campaignScore: 4200, levelBest: 325 });

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

  it("keeps levelBest in the reply for pre-deploy bundles with no runId/endedAt", async () => {
    stubFetch({ status: 200, json: { status: "ok", improved: false, total: 4200 } });
    const res = await post(body());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { levelBest: unknown };
    expect(typeof json.levelBest).toBe("number");
    expect(json.levelBest).toBe(4200);
  });

  it("maps duplicate to 200 with the campaign total", async () => {
    stubFetch({ status: 200, json: { status: "duplicate", improved: true, total: 900 } });
    const res = await post(body());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, levelScore: 325, levelImproved: true, campaignScore: 900, levelBest: 325 });
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
