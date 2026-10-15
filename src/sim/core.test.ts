import { describe, expect, it } from 'vitest'
import { FixedStepClock } from './clock'
import { MAX_FRAME_MS, TICK_MS } from './constants'
import { applyDefense, applyVariancePct, critChancePct, divideBy100HalfEven, rollHit } from './damage'
import { Digest } from './digest'
import { segmentAabbEntry } from './geometry'
import { mulberry32, toSeed, type Rng } from './rng'

/** Canonical mulberry32 (Tommy Ettinger / bryc reference form) for conformance. */
function referenceMulberry32(seed: number): () => number {
  let a = seed
  return () => {
    let t = (a += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('mulberry32 RNG', () => {
  it('matches the canonical reference sequence bit-for-bit', () => {
    for (const seed of [0, 1, 42, 0xdeadbeef >>> 0, 2 ** 31]) {
      const ours = mulberry32(seed)
      const ref = referenceMulberry32(seed)
      for (let i = 0; i < 2000; i++) expect(ours.next()).toBe(ref())
    }
  })

  it('is reproducible per seed and differs across seeds', () => {
    const a = mulberry32(7)
    const b = mulberry32(7)
    const c = mulberry32(8)
    const sa = Array.from({ length: 50 }, () => a.next())
    expect(Array.from({ length: 50 }, () => b.next())).toEqual(sa)
    expect(Array.from({ length: 50 }, () => c.next())).not.toEqual(sa)
    expect(a.state).toBe(b.state)
  })

  it('yields floats in [0,1) and inclusive integer ranges hitting both ends', () => {
    const r = mulberry32(3)
    const seen = new Set<number>()
    for (let i = 0; i < 20_000; i++) {
      const f = r.next()
      expect(f >= 0 && f < 1).toBe(true)
      const n = r.int(-15, 15)
      expect(Number.isInteger(n) && n >= -15 && n <= 15).toBe(true)
      seen.add(n)
    }
    expect(seen.size).toBe(31)
  })

  it('normalizes seeds to uint32', () => {
    expect(toSeed(-1)).toBe(0xffffffff)
    expect(toSeed(Number.NaN)).toBe(0)
    expect(toSeed(2 ** 32 + 5)).toBe(5)
    expect(toSeed(3.9)).toBe(3)
  })
})

/** RNG stub returning queued values for `int`, for exact damage-path assertions. */
function scriptedRng(ints: number[]): Rng {
  return {
    next: () => 0,
    int: () => {
      const v = ints.shift()
      if (v === undefined) throw new Error('scripted RNG exhausted')
      return v
    },
    state: 0,
  }
}

describe('damage math (wiki Defense / Damage / Critical hit)', () => {
  it('defense: floor(damage − defense/2), minimum 1', () => {
    expect(applyDefense(10, 0)).toBe(10)
    expect(applyDefense(10, 3)).toBe(8) // ⌊8.5⌋
    expect(applyDefense(10, 4)).toBe(8)
    expect(applyDefense(5, 20)).toBe(1)
    expect(applyDefense(1, 1)).toBe(1) // ⌊0.5⌋ → 0 → min 1
  })

  it('variance rounds half to even with integer-exact math', () => {
    expect(divideBy100HalfEven(1050)).toBe(10)
    expect(divideBy100HalfEven(1150)).toBe(12)
    expect(divideBy100HalfEven(1049)).toBe(10)
    expect(divideBy100HalfEven(1051)).toBe(11)
    expect(applyVariancePct(10, 5)).toBe(10) // 10.5 → 10
    expect(applyVariancePct(10, 15)).toBe(12) // 11.5 → 12
    expect(applyVariancePct(10, -15)).toBe(8) // 8.5 → 8
    expect(applyVariancePct(7, -15)).toBe(6) // 5.95 → 6
  })

  it('order: variance → defense → crit (crit doubles AFTER defense)', () => {
    // variance +15% on 10 → 12 (11.5 half-even), defense 3 → ⌊10.5⌋ = 10, crit roll 1 ≤ 4 → 20.
    const hit = rollHit(scriptedRng([15, 1]), 10, 3, 4, true)
    expect(hit).toEqual({ amount: 20, crit: true, variancePct: 15 })
    // Without variance: 10 − 1.5 → 8, crit → 16 (NOT ⌊(20 − 1.5)⌋ = 18).
    expect(rollHit(scriptedRng([4]), 10, 3, 4, false).amount).toBe(16)
    expect(rollHit(scriptedRng([5]), 10, 3, 4, false)).toEqual({ amount: 8, crit: false, variancePct: 0 })
  })

  it('crit chance = 4% base + weapon bonus for melee/ranged/magic; summon/other never crit', () => {
    expect(critChancePct('melee', 0)).toBe(4)
    expect(critChancePct('ranged', 10)).toBe(14)
    expect(critChancePct('magic', 99)).toBe(100)
    expect(critChancePct('summon', 50)).toBe(0)
    expect(critChancePct('other', 50)).toBe(0)
  })

  it('crit frequency converges on the configured chance', () => {
    const rng = mulberry32(99)
    let crits = 0
    const n = 100_000
    for (let i = 0; i < n; i++) if (rollHit(rng, 10, 0, 4, false).crit) crits++
    // 4% ± ~4.8σ (σ ≈ 62).
    expect(crits).toBeGreaterThan(3700)
    expect(crits).toBeLessThan(4300)
  })
})

describe('fixed-step clock', () => {
  const ticksFor = (fps: number, seconds: number): number => {
    const clock = new FixedStepClock()
    let ticks = 0
    for (let i = 0; i < fps * seconds; i++) ticks += clock.push(1000 / fps)
    return ticks
  }

  it.each([30, 60, 75, 120, 144, 240])('%i fps for 10 s yields exactly 600 ticks', (fps) => {
    expect(ticksFor(fps, 10)).toBe(600)
  })

  it('clamps huge frame deltas and ignores invalid ones', () => {
    const clock = new FixedStepClock()
    // 250 ms is exactly 15 ticks (a float floor of 250 / 16.67 would wrongly give 14).
    expect(MAX_FRAME_MS).toBe(250)
    expect(clock.push(10_000)).toBe(15)
    expect(clock.push(Number.NaN)).toBe(0)
    expect(clock.push(-5)).toBe(0)
    expect(clock.push(0)).toBe(0)
  })

  it('exposes the leftover fraction as alpha in [0,1)', () => {
    const clock = new FixedStepClock()
    expect(clock.push(TICK_MS / 4)).toBe(0)
    expect(clock.alpha).toBeCloseTo(0.25, 10)
    expect(clock.push(TICK_MS)).toBe(1)
    expect(clock.alpha).toBeCloseTo(0.25, 10)
    clock.clear()
    expect(clock.alpha).toBe(0)
  })
})

describe('geometry + digest', () => {
  const box = { minX: 1, minY: -1, maxX: 3, maxY: 1 }
  it('segment vs AABB returns the entry parameter or null', () => {
    expect(segmentAabbEntry(0, 0, 4, 0, box)).toBeCloseTo(0.25)
    expect(segmentAabbEntry(2, 0, 2.5, 0, box)).toBe(0) // starts inside
    expect(segmentAabbEntry(0, 2, 4, 2, box)).toBeNull()
    expect(segmentAabbEntry(0, 0, 0.9, 0, box)).toBeNull()
    expect(segmentAabbEntry(2, 5, 2, -5, box)).toBeCloseTo(0.4) // vertical, dx = 0
  })

  it('digest is order- and bit-sensitive', () => {
    const d = (parts: Array<string | number>) => {
      const g = new Digest()
      for (const p of parts) if (typeof p === 'number') g.num(p)
      else g.str(p)
      return g.value()
    }
    expect(d(['a', 1])).toBe(d(['a', 1]))
    expect(d(['a', 1])).not.toBe(d([1, 'a']))
    expect(d(['ab', 'c'])).not.toBe(d(['a', 'bc']))
    expect(d([0.1 + 0.2])).not.toBe(d([0.3]))
  })
})
