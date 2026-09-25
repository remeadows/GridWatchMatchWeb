import { deriveScore, validateSubmission } from "./validation";
import { runKey, submitArgs, submitStatus, type ScoreMeta } from "./scoreBoard";
import { prefixRedirectLocation, redirectStatusFor, rewritePlayPath } from "./playPrefix";

const ASSET_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS: AssetsBinding;
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

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const rewrite = rewritePlayPath(url.pathname);
    if (rewrite.kind === "redirect") {
      return Response.redirect(new URL(rewrite.location + url.search, url).toString(), redirectStatusFor(request.method));
    }
    url.pathname = rewrite.pathname;
    const inner = new Request(url.toString(), request);

    if (url.pathname === "/api/score") {
      if (inner.method !== "POST") return json(405, { error: "POST only." });
      try {
        return await handleScore(inner, env);
      } catch (err) {
        console.error("[score] failed:", err instanceof Error ? err.message : err);
        return json(502, { error: "Archive write failed." });
      }
    }
    if (url.pathname.startsWith("/api/")) return json(404, { error: "Unknown endpoint." });

    const assetResponse = await env.ASSETS.fetch(inner);
    const location = assetResponse.headers.get("Location");
    if (ASSET_REDIRECT_STATUSES.has(assetResponse.status) && location) {
      const headers = new Headers(assetResponse.headers);
      headers.set("Location", prefixRedirectLocation(location));
      return new Response(null, { status: assetResponse.status, headers });
    }
    return assetResponse;
  },
};
