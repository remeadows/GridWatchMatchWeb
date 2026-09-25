import { apiUrl } from "./appUrls";

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
