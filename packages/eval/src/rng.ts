/**
 * The seeded generator's only source of randomness.
 *
 * mulberry32 is 32-bit, dependency-free and reproducible across platforms:
 * the same seed produces the same stream, so the eval cases (and therefore
 * every ground-truth answer) are identical on every machine and every run.
 * Nothing in packages/eval may call Math.random or Date.now to build cases.
 */

/** Raw mulberry32 stream. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  /** Next float in [0, 1). */
  next(): number;
  /** Integer in [min, max], inclusive both ends. */
  int(min: number, max: number): number;
  /** Uniform pick. The list must be non-empty; the caller guarantees it. */
  pick<T>(items: readonly T[]): T;
  /** Fisher-Yates copy; the input is not mutated. */
  shuffle<T>(items: readonly T[]): T[];
  /** True with probability p (default 0.5). */
  bool(p?: number): boolean;
}

export function makeRng(seed: number): Rng {
  const stream = mulberry32(seed);
  const rng: Rng = {
    next: stream,
    int(min: number, max: number): number {
      return min + Math.floor(stream() * (max - min + 1));
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error("rng.pick: empty list");
      const value = items[rng.int(0, items.length - 1)];
      if (value === undefined) throw new Error("rng.pick: undefined element");
      return value;
    },
    shuffle<T>(items: readonly T[]): T[] {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = rng.int(0, i);
        const a = out[i] as T;
        const b = out[j] as T;
        out[i] = b;
        out[j] = a;
      }
      return out;
    },
    bool(p = 0.5): boolean {
      return stream() < p;
    },
  };
  return rng;
}
