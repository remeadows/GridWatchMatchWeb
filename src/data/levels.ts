import { levelUrl } from "./assets";
import type { LevelDefinition, ObjectiveDefinition, TileType } from "../engine";
import { applyBalanceProfile, type BalanceProfile } from "../dev/balancePreview";

export async function loadLevel(levelId: number, profile: BalanceProfile | null = null): Promise<LevelDefinition> {
  const response = await fetch(levelUrl(levelId));
  if (!response.ok) throw new Error(`Failed to load level ${levelId}: ${response.status}`);
  const level = (await response.json()) as LevelDefinition;
  const normalized = normalizeLevel(level);
  return profile ? applyBalanceProfile(normalized, profile) : normalized;
}

export function normalizeLevel(level: LevelDefinition): LevelDefinition {
  return {
    ...level,
    bossLevel: Boolean(level.bossLevel),
    bonusLevel: Boolean(level.bonusLevel),
    bossTimerSeconds: level.bossTimerSeconds ?? null,
    objectives: level.objectives.map((objective) => ({
      ...objective,
      tileType: normalizeTileType(objective.tileType)
    }))
  };
}

export function objectiveLabel(objective: ObjectiveDefinition, progress: number): string {
  const current = Math.min(progress, objective.target);
  return `${objective.displayName}: ${current}/${objective.target}`;
}

function normalizeTileType(tileType: TileType | null): TileType | null {
  return tileType ?? null;
}
