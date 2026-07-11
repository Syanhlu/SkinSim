// ─── Tiny seeded PRNG (no deps) ──────────────────────────────────────────────
// mulberry32: fast, decent-quality 32-bit PRNG. Used for deterministic agent
// layout, avatar picks, and the demo-timeline generator.

/** Returns a deterministic pseudo-random () => number in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic 32-bit hash of a string (FNV-1a) — string → PRNG seed. */
export function hashSeed(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Convenience: seeded PRNG from any string. */
export function rngFrom(input: string): () => number {
  return mulberry32(hashSeed(input));
}

/** Pick one element deterministically. */
export function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length) % items.length];
}

/** Integer in [min, max] inclusive. */
export function randInt(rand: () => number, min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}
