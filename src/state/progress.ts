import { areaForLevel, areas, type AreaInfo } from "../data/areas";
import type { SaveState } from "./save";

export function starsForLevel(save: SaveState, levelId: number): number {
  return save.levels[String(levelId)]?.stars ?? 0;
}

export function bestScoreForLevel(save: SaveState, levelId: number): number {
  return save.levels[String(levelId)]?.score ?? 0;
}

export function highestCompletedLevel(save: SaveState): number {
  return Math.max(0, ...Object.keys(save.levels).map(Number).filter((levelId) => starsForLevel(save, levelId) > 0));
}

export function isLevelUnlocked(save: SaveState, levelId: number): boolean {
  if (levelId <= 1) return true;
  return starsForLevel(save, levelId - 1) > 0;
}

export function isAreaUnlocked(save: SaveState, area: AreaInfo): boolean {
  if (area.id === 1) return true;
  const previousArea = areas.find((candidate) => candidate.id === area.id - 1);
  if (!previousArea) return false;
  return starsForLevel(save, previousArea.firstLevel) > 0;
}

export function completedLevelsInArea(save: SaveState, area: AreaInfo): number {
  let count = 0;
  for (let levelId = area.firstLevel; levelId <= area.lastLevel; levelId += 1) {
    if (starsForLevel(save, levelId) > 0) count += 1;
  }
  return count;
}

export function isAreaComplete(save: SaveState, area: AreaInfo): boolean {
  return completedLevelsInArea(save, area) >= area.lastLevel - area.firstLevel + 1;
}

export function isHeroUnlocked(save: SaveState, unlockAreaId: number | null): boolean {
  if (unlockAreaId === null) return true;
  const area = areas.find((candidate) => candidate.id === unlockAreaId);
  return area ? isAreaComplete(save, area) : false;
}

export function awardLevelCompletion(
  save: SaveState,
  levelId: number,
  stars: number,
  score: number,
  playOnUsed: boolean
): SaveState {
  const next = cloneSave(save);
  const current = next.levels[String(levelId)];
  const bestStars = Math.max(current?.stars ?? 0, stars);
  const bestScore = Math.max(current?.score ?? 0, score);
  next.levels[String(levelId)] = {
    stars: bestStars,
    score: bestScore,
    completedAt: current?.completedAt ?? new Date().toISOString()
  };
  if (!playOnUsed && stars > 0 && (current?.stars ?? 0) === 0) {
    next.coins += stars * 10;
  }
  next.completedTutorial = true;
  next.tutorialReplayRequested = false;
  return next;
}

export function collectAreaReward(save: SaveState, area: AreaInfo): { save: SaveState; amount: number } {
  if (!isAreaComplete(save, area) || save.areaRewards[String(area.id)]) return { save, amount: 0 };
  const next = cloneSave(save);
  next.areaRewards[String(area.id)] = true;
  next.coins += area.completionReward;
  return { save: next, amount: area.completionReward };
}

export function dueIntelCount(save: SaveState): number {
  const highest = highestCompletedLevel(save);
  const unlockedLevels = new Set<number>();
  for (let levelId = 1; levelId <= highest; levelId += 1) unlockedLevels.add(levelId);
  return unlockedLevels.size;
}

export function cloneSave(save: SaveState): SaveState {
  return JSON.parse(JSON.stringify(save)) as SaveState;
}

export function levelSeed(levelId: number): bigint {
  return BigInt(0x9e3779b97f4a7c15n ^ BigInt(levelId * 1_000_003));
}

export function areaProgressLabel(save: SaveState, area: AreaInfo): string {
  const complete = completedLevelsInArea(save, area);
  const total = area.lastLevel - area.firstLevel + 1;
  return `${complete}/${total}`;
}

export function currentArea(save: SaveState): AreaInfo {
  return areaForLevel(Math.min(100, Math.max(1, highestCompletedLevel(save) + 1)));
}
