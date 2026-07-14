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
