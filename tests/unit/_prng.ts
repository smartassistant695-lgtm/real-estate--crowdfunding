/** Small seeded PRNG (mulberry32) so randomized tests are reproducible. */
export function prng(seed: number) {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  /** Integer in [min, max], inclusive. */
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));
  const big = (min: number, max: number): bigint => BigInt(int(min, max));
  return { next, int, big };
}

export const sum = (xs: readonly bigint[]): bigint => xs.reduce((a, b) => a + b, 0n);
