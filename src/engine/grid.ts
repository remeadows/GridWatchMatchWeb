import { comparePositions, type GridPosition } from "./types";

export class Grid2D<T> {
  readonly rows: number;
  readonly cols: number;
  private storage: T[];

  constructor(rows: number, cols: number, fill: T | ((position: GridPosition) => T)) {
    if (rows <= 0 || cols <= 0) throw new Error("Grid dimensions must be positive");
    this.rows = rows;
    this.cols = cols;
    this.storage = [];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        this.storage.push(typeof fill === "function" ? (fill as (position: GridPosition) => T)({ row, col }) : fill);
      }
    }
  }

  get count(): number {
    return this.rows * this.cols;
  }

  get allPositions(): GridPosition[] {
    const result: GridPosition[] = [];
    for (let row = 0; row < this.rows; row += 1) {
      for (let col = 0; col < this.cols; col += 1) {
        result.push({ row, col });
      }
    }
    return result;
  }

  isValid(position: GridPosition): boolean {
    return position.row >= 0 && position.row < this.rows && position.col >= 0 && position.col < this.cols;
  }

  get(position: GridPosition): T {
    if (!this.isValid(position)) throw new Error(`Grid index out of bounds: ${position.row},${position.col}`);
    return this.storage[this.index(position)];
  }

  set(position: GridPosition, value: T): void {
    if (!this.isValid(position)) throw new Error(`Grid index out of bounds: ${position.row},${position.col}`);
    this.storage[this.index(position)] = value;
  }

  swap(a: GridPosition, b: GridPosition): void {
    if (!this.isValid(a) || !this.isValid(b)) throw new Error("Swap position out of bounds");
    const ai = this.index(a);
    const bi = this.index(b);
    const tmp = this.storage[ai];
    this.storage[ai] = this.storage[bi];
    this.storage[bi] = tmp;
  }

  positionsWhere(predicate: (value: T, position: GridPosition) => boolean): GridPosition[] {
    const result: GridPosition[] = [];
    for (const position of this.allPositions) {
      if (predicate(this.get(position), position)) result.push(position);
    }
    return result.sort(comparePositions);
  }

  map<U>(transform: (value: T, position: GridPosition) => U): Grid2D<U> {
    return new Grid2D(this.rows, this.cols, (position) => transform(this.get(position), position));
  }

  clone(cloneValue: (value: T) => T): Grid2D<T> {
    return new Grid2D(this.rows, this.cols, (position) => cloneValue(this.get(position)));
  }

  private index(position: GridPosition): number {
    return position.row * this.cols + position.col;
  }
}

