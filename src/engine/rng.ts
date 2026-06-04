const mask64 = (1n << 64n) - 1n;
const multiplier = 6364136223846793005n;
const increment = 1442695040888963407n;

export class SeededRNG {
  private value: bigint;

  constructor(seed: bigint | number | string) {
    const parsed = BigInt(seed);
    if (parsed === 0n) throw new Error("SeededRNG seed must be non-zero");
    this.value = parsed & mask64;
  }

  get state(): bigint {
    return this.value;
  }

  nextUInt64(): bigint {
    this.value = (this.value * multiplier + increment) & mask64;
    return this.value;
  }

  nextDouble(): number {
    const upper53 = this.nextUInt64() >> 11n;
    return Number(upper53) / 2 ** 53;
  }

  nextInt(upperBound: number): number {
    if (upperBound <= 0) throw new Error("upperBound must be greater than zero");
    return Number(this.nextUInt64() % BigInt(upperBound));
  }

  shuffle<T>(values: T[]): void {
    for (let i = values.length - 1; i >= 1; i -= 1) {
      const j = this.nextInt(i + 1);
      if (i !== j) {
        const tmp = values[i];
        values[i] = values[j];
        values[j] = tmp;
      }
    }
  }
}

