/** Mulberry32 — deterministic PRNG from a 32-bit seed. */

export interface Rng {
  next(): number;
  normal(): number;
  poisson(lambda: number): number;
}

export function makeRng(seed: number): Rng {
  let state = seed >>> 0;

  function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function normal(): number {
    const u1 = Math.max(next(), 1e-10);
    const u2 = next();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  function poisson(lambda: number): number {
    if (lambda <= 0) return 0;
    if (lambda > 30) {
      const n = Math.round(lambda + Math.sqrt(lambda) * normal());
      return Math.max(0, n);
    }
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k += 1;
      p *= next();
    } while (p > L);
    return k - 1;
  }

  return { next, normal, poisson };
}
