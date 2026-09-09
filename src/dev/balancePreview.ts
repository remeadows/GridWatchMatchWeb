import candidate from "../../docs/balance/candidates/pilot-moves-v1.json" with { type: "json" };
import type { LevelDefinition } from "../engine";

export interface BalanceProfile {
  readonly id: string;
  readonly label: string;
  readonly changes: readonly { levelId: number; from: number; to: number }[];
}

export function selectBalanceProfile({ isDevelopment, search }: { isDevelopment: boolean; search: string }): BalanceProfile | null {
  if (!isDevelopment) return null;
  const params = new URLSearchParams(search);
  if (params.getAll("gwTestMode").length !== 1 || params.get("gwTestMode") !== "1"
    || params.getAll("gwBalanceProfile").length !== 1) return null;
  const name = params.get("gwBalanceProfile");
  if (name === candidate.id) return structuredClone(candidate);
  if (name === "canonical-control-v1") return { id: name, label: "Canonical control v1", changes: [] };
  return null;
}

export function applyBalanceProfile(level: LevelDefinition, profile: BalanceProfile | null): LevelDefinition {
  const copy = structuredClone(level);
  const change = profile?.changes.find(item => item.levelId === level.id);
  // A stale candidate cannot silently override newly authored content.
  if (change && change.from === level.moveLimit) copy.moveLimit = change.to;
  return copy;
}

export function createPreviewSaveStore<T>(initial: () => T) {
  let memory = structuredClone(initial());
  return {
    async load(): Promise<T> { return structuredClone(memory); },
    async persist(value: T): Promise<void> { memory = structuredClone(value); },
    async reset(): Promise<T> {
      memory = structuredClone(initial());
      return structuredClone(memory);
    }
  };
}

export function maySubmitPreviewScore({ profile, hasSession, isTestMode }: {
  profile: BalanceProfile | null; hasSession: boolean; isTestMode: boolean;
}): boolean {
  return profile === null && hasSession && !isTestMode;
}
