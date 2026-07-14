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
  // Per-move bounds sum to a 500 pts/move ceiling (~3x a strong real run) via the
  // score formula, so LEVEL_SCORE_CAP stays an unreachable backstop — fabricated
  // telemetry can't reach it. Conservative pending real-play telemetry; the stored
  // action-log proof is the future replay-verification path.
  if (!isInt(tilesCleared) || tilesCleared < 1 || tilesCleared > moveCount * 15)
    return { ok: false, error: "Implausible clear count." };
  if (!isInt(powerUpEvents) || powerUpEvents < 0 || powerUpEvents > moveCount * 4)
    return { ok: false, error: "Implausible power-up count." };
  if (!isInt(chainSum) || chainSum < 0 || chainSum > moveCount * 5)
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
