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
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ ok: true, levelScore: 325, levelImproved: true, campaignScore: 900 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const stamp = { runId: "0123456789abcdef0123456789abcdef", endedAt: "2026-09-25T12:00:00.000Z" };

    const result = await submitScore("tok", 4, telemetry, [{ a: 1 }], stamp);

    expect(result).toEqual({ ok: true, levelScore: 325, levelImproved: true, campaignScore: 900 });
    const init = fetchMock.mock.calls[0][1];
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer tok");
    expect(JSON.parse(String(init?.body))).toEqual({ levelId: 4, telemetry, actionLog: [{ a: 1 }], ...stamp });
  });

  it("throws the worker's error message on failure", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "Run already logged to the archive." }), { status: 409 }));
    await expect(
      submitScore("tok", 4, telemetry, [], { runId: "0123456789abcdef0123456789abcdef", endedAt: "2026-09-25T12:00:00.000Z" }),
    ).rejects.toThrow("Run already logged to the archive.");
  });
});
