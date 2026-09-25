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

/* Replay key + run time. Each win carries its own runId so two wins with an identical move
   sequence don't collide on the proof-hash fallback and get rejected as a false replay.
   A resend of the same stamped request (none today) would get submit_score's stored result
   back as `duplicate` instead of counting twice. Bundles from before this change send
   neither runId nor endedAt: they fall back to the proof hash and server time, so an
   identical replay of one of those old-bundle runs within the DB's 1 h window gets 409.
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
  // Compat for bundles cached before 2026-09-25 (they render levelBest when !levelImproved).
  // Not read by the current client. Remove one release after the submit_score deploy.
  levelBest: number;
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
    const improved = r.improved === true;
    const campaignScore = Number.isFinite(total) ? total : score;
    return {
      status: 200,
      body: { ok: true, levelScore: score, levelImproved: improved, campaignScore, levelBest: improved ? score : campaignScore },
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
