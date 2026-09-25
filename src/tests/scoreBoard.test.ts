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
      body: { ok: true, levelScore: 610, levelImproved: true, campaignScore: 1500, levelBest: 610 },
    });
    expect(submitStatus({ status: "duplicate", improved: false, total: "1500" }, 610)).toEqual({
      status: 200,
      body: { ok: true, levelScore: 610, levelImproved: false, campaignScore: 1500, levelBest: 1500 },
    });
  });
  it("falls back to the level score when total is missing", () => {
    expect(submitStatus({ status: "ok", improved: true }, 610).body).toEqual({
      ok: true, levelScore: 610, levelImproved: true, campaignScore: 610, levelBest: 610,
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
