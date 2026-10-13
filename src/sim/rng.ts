/**
 * Seeded deterministic RNG — mulberry32 (ADR-001 D5 layer 1).
 *
 * 32-bit state, integer-only arithmetic (`Math.imul`, `>>>`), so the sequence is bit-identical
 * on every JS engine. The state is a plain uint32, so it can be snapshotted and restored.
 * The sim owns exactly one stream and draws from it only inside `tick()`, in a fixed order —
 * that is what makes the output independent of how frames batch ticks.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number
  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number
  /** Current uint32 state (for snapshots / debugging). */
  readonly state: number
}

/** Normalizes any number to a uint32 seed (NaN/∞ → 0). */
export function toSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0
}

export function mulberry32(seed: number): Rng {
  let a = toSeed(seed)
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    get state() {
      return a
    },
  }
}
