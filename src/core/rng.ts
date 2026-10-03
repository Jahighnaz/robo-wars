// Seeded PRNG (mulberry32, identical to the prototype) with helpers.
export class Rng {
  private a: number;
  constructor(seed: number) { this.a = seed >>> 0; }
  next(): number {
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number { return a + (b - a) * this.next(); }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length)]; }
  /** Weighted pick from an object of weights (negative weights count as 0). */
  wpick<K extends string>(obj: Partial<Record<K, number>>): K {
    let s = 0;
    for (const k in obj) s += Math.max(0, obj[k] ?? 0);
    let r = this.next() * s;
    for (const k in obj) { r -= Math.max(0, obj[k] ?? 0); if (r <= 0) return k; }
    return Object.keys(obj)[0] as K;
  }
}
export const timeSeed = () => (Date.now() ^ 0x5bd1e995) >>> 0;
