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
