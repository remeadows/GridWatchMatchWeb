import type { TileType } from "./types";
import type { SeededRNG } from "./rng";

export const tileTypes: TileType[] = ["packet", "firewall", "key", "threat", "zeroDay"];

export class SpawnRule {
  readonly weights: Record<TileType, number>;

  constructor(weights: Partial<Record<TileType, number>>) {
    this.weights = {
      packet: weights.packet ?? 0,
      firewall: weights.firewall ?? 0,
      key: weights.key ?? 0,
      threat: weights.threat ?? 0,
      zeroDay: weights.zeroDay ?? 0
    };
  }

  validate(): void {
    const sum = Object.values(this.weights).reduce((total, value) => total + value, 0);
    if (Math.abs(sum - 1) > 0.001 || Object.values(this.weights).some((value) => value < 0)) {
      throw new Error(`Spawn weights must sum to 1.0, got ${sum}`);
    }
  }

  draw(rng: SeededRNG): TileType {
    const ordered = Object.entries(this.weights)
      .filter(([, weight]) => weight > 0)
      .sort(([left], [right]) => left.localeCompare(right)) as [TileType, number][];
    if (ordered.length === 0) return "packet";
    const roll = rng.nextDouble();
    let cumulative = 0;
    for (const [tile, weight] of ordered) {
      cumulative += weight;
      if (roll <= cumulative) return tile;
    }
    return ordered[ordered.length - 1]?.[0] ?? "packet";
  }
}

