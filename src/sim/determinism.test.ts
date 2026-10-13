/**
 * Determinism proof (ADR-001 D5): same seed + loadout + duration ⇒ bit-identical totals at any
 * frame rate. Scenarios deliberately exercise every RNG consumer (variance, crits, spread
 * inaccuracy, DoT chance + duration ranges) and every float path (homing, gravity, regen).
 */
import { describe, expect, it } from 'vitest'
import { createLabSim, mulberry32, type LabSim, type LabSimOptions, type SimSnapshot, type TimedTestDuration, type TimedTestResult } from './index'
import { ammoFixture, bowFixture, dotBuffFixture, staffFixture, swordFixture } from './testing/fixtures'

const SCENARIOS: Record<string, () => LabSimOptions> = {
  'sword (variance + crits)': () => ({ weapon: swordFixture({ autoReuse: true, critPct: 6 }), seed: 11 }),
  'shotgun (spread, gravity, pierce, armored row)': () => ({
    weapon: bowFixture({ projectilesPerUse: 4, spreadDegrees: 12 }, { useTimeTicks: 40, useAnimationTicks: 40, critPct: 10 }),
    ammo: ammoFixture({ damage: 7, velocityBonusTps: 4, projectile: { velocityTps: 1, gravity: true, pierce: 1 } }),
    dummies: [
      { id: 'near', x: 4, y: 0 },
      { id: 'armored', x: 8, y: 0.5, defense: 7 },
      { id: 'far', x: 14, y: 1 },
    ],
    seed: 2024,
  }),
  'staff (inaccuracy, homing, DoT ranges, mana regen)': () => ({
    weapon: staffFixture({ spreadDegrees: 8 }, { manaCost: 7, critPct: 4 }, {
      homing: { strength: 0.15, acquisitionRangeTiles: 18 },
      dot: { buffId: 'fixture-burn', chancePct: 60, durationTicks: { minTicks: 60, maxTicks: 240 } },
    }),
    buffs: [dotBuffFixture(3.5)],
    dummies: [{ x: 6, y: 0 }, { x: 9, y: -5, defense: 3 }],
    settings: { maxMana: 60 },
    seed: 77,
  }),
  'burst staff (useTime < useAnimation, slow-cast)': () => ({
    weapon: staffFixture({ projectilesPerUse: 2, spreadDegrees: 4 }, { useTimeTicks: 6, useAnimationTicks: 18, manaCost: 9 }),
    settings: { maxMana: 40, insufficientMana: 'slow-cast' },
    seed: 5,
  }),
}

function create(options: LabSimOptions): LabSim {
  const r = createLabSim(options)
  if (!r.ok) throw new Error(`refused: ${JSON.stringify(r.refusal)}`)
  return r.sim
}

type FramePattern = () => () => number
const PATTERNS: Record<string, FramePattern> = {
  '30 fps': () => () => 1000 / 30,
  '60 fps': () => () => 1000 / 60,
  '144 fps': () => () => 1000 / 144,
  'jittered 2–70 ms': () => {
    const r = mulberry32(31337)
    return () => 2 + r.next() * 68
  },
  'spiky (1 ms / 400 ms clamped)': () => {
    let i = 0
    return () => (i++ % 2 === 0 ? 1 : 400)
  },
}

interface TimedRun {
  result: TimedTestResult
  snapshot: SimSnapshot
  frames: number
}

function runTimed(options: LabSimOptions, duration: TimedTestDuration, pattern: FramePattern): TimedRun {
  const sim = create(options)
  expect(sim.startTimedTest(duration)).toEqual({ ok: true })
  const nextDt = pattern()
  let frames = 0
  while (sim.snapshot().timedTest.status === 'running') {
    sim.advance(nextDt())
    sim.drainEvents()
    if (++frames > 100_000) throw new Error('timed test did not finish')
  }
  const snapshot = sim.snapshot()
  const result = snapshot.timedTest.result
  if (!result) throw new Error('missing result')
  return { result, snapshot, frames }
}

describe('frame-rate independence (bit-identical totals)', () => {
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    it(`${name}: identical 10 s results at 30/60/144 fps, jittered and spiky frames`, () => {
      const runs = Object.entries(PATTERNS).map(([label, pattern]) => ({ label, ...runTimed(scenario(), 10, pattern) }))
      const [reference] = runs
      expect(reference.result.ticks).toBe(600)
      expect(reference.result.totalDamage).toBeGreaterThan(0)
      for (const run of runs) {
        expect(run.result, run.label).toEqual(reference.result) // incl. eventDigest + dpsSeries
        expect(run.snapshot.stats, run.label).toEqual(reference.snapshot.stats)
        expect(run.snapshot.rngState, run.label).toBe(reference.snapshot.rngState)
        expect(run.snapshot.tick, run.label).toBe(600)
      }
      // The patterns really did batch ticks differently.
      expect(new Set(runs.map((r) => r.frames)).size).toBe(runs.length)
    })
  }

  it('free play: identical state for step(1)×N, step(N) and random chunk sizes', () => {
    const N = 1234
    const play = (chunks: () => number) => {
      const sim = create(SCENARIOS['staff (inaccuracy, homing, DoT ranges, mana regen)']())
      sim.setInput({ attacking: true })
      let done = 0
      while (done < N) done += sim.step(Math.min(chunks(), N - done))
      return { snap: sim.snapshot(), render: sim.renderState() }
    }
    const r = mulberry32(9)
    const a = play(() => 1)
    const b = play(() => N)
    const c = play(() => 1 + Math.floor(r.next() * 37))
    expect(b.snap).toEqual(a.snap)
    expect(c.snap).toEqual(a.snap)
    expect(c.render.projectiles).toEqual(a.render.projectiles)
  })
})

describe('seeded reproducibility', () => {
  const scenario = SCENARIOS['sword (variance + crits)']

  it('same seed ⇒ identical; different seeds ⇒ different event streams', () => {
    const a = runTimed(scenario(), 30, PATTERNS['60 fps'])
    const b = runTimed(scenario(), 30, PATTERNS['60 fps'])
    expect(b.result).toEqual(a.result)
    const others = [1, 2, 3, 4, 5].map((seed) => runTimed({ ...scenario(), seed }, 30, PATTERNS['60 fps']).result)
    expect(others.every((o) => o.eventDigest !== a.result.eventDigest)).toBe(true)
    expect(new Set(others.map((o) => o.totalDamage)).size).toBeGreaterThan(1)
  })

  it('sims share no global state (interleaved == isolated)', () => {
    const iso = Object.values(SCENARIOS).map((s) => {
      const sim = create(s())
      sim.setInput({ attacking: true })
      sim.step(900)
      return sim.snapshot()
    })
    const sims = Object.values(SCENARIOS).map((s) => create(s()))
    for (const s of sims) s.setInput({ attacking: true })
    for (let t = 0; t < 900; t++) for (const s of sims) s.step()
    sims.forEach((s, i) => expect(s.snapshot()).toEqual(iso[i]))
  })

  it('reset() restores the seeded initial state (re-run is identical)', () => {
    const sim = create(scenario())
    sim.setInput({ attacking: true })
    sim.step(700)
    const first = sim.snapshot()
    sim.reset()
    expect(sim.snapshot().tick).toBe(0)
    expect(sim.snapshot().stats.totalDamage).toBe(0)
    sim.step(700)
    expect(sim.snapshot()).toEqual(first)
  })

  it('cross-run stability: pinned fingerprint of a reference scenario', () => {
    // Golden values pin the engine's observable semantics. If a deliberate engine change alters
    // them, update these numbers in the same change with a changelog note in README.md (AMENDMENTS-008 B38).
    const { result } = runTimed(SCENARIOS['staff (inaccuracy, homing, DoT ranges, mana regen)'](), 30, PATTERNS['144 fps'])
    expect({ total: result.totalDamage, dot: result.dotDamage, hits: result.hits, crits: result.crits, uses: result.uses, digest: result.eventDigest }).toEqual(
      GOLDEN_STAFF_30S,
    )
  })
})

/**
 * Re-pinned 2026-10-13 (Node 23.11 / V8) for the B35 `slow-cast` default (README changelog).
 * Mana-limited at max mana 60: 10 paid casts, then 32 slow casts (use time × 2.5) in 30 s.
 */
const GOLDEN_STAFF_30S = { total: 799, dot: 97, hits: 42, crits: 4, uses: 42, digest: '876a8729' }

describe('timed-test controller (P3-S3 AC3)', () => {
  const options = () => SCENARIOS['sword (variance + crits)']()

  it.each([10, 30] as const)('%i s runs exactly %i×60 ticks then halts', (duration) => {
    const { result, snapshot } = runTimed(options(), duration, PATTERNS['60 fps'])
    expect(result.ticks).toBe(duration * 60)
    expect(snapshot.tick).toBe(duration * 60)
    expect(result.estimatedDps).toBe(result.totalDamage / duration)
    expect(result.dpsSeries).toHaveLength(duration)
    expect(result.dpsSeries.reduce((a, b) => a + b, 0)).toBe(result.totalDamage)
  })

  it('locks config while running; reset aborts; a finished test halts until reset', () => {
    const sim = create(options())
    sim.setInput({ attacking: false })
    expect(sim.startTimedTest(10)).toEqual({ ok: true })
    expect(sim.startTimedTest(30)).toEqual({ ok: false, reason: 'already-running' })
    expect(sim.setInput({ attacking: false })).toEqual({ ok: false, reason: 'config-locked' })
    expect(sim.updateSettings({ damageVariance: false })).toEqual({ ok: false, reason: 'config-locked' })
    expect(sim.resetStats()).toEqual({ ok: false, reason: 'config-locked' })
    sim.step(300)
    const mid = sim.snapshot().timedTest
    expect(mid).toMatchObject({ status: 'running', ticksElapsed: 300, ticksTotal: 600, remainingSec: 5 })
    expect(sim.snapshot().stats.uses).toBeGreaterThan(0) // attack forced on despite released input
    expect(sim.step(1000)).toBe(300)
    expect(sim.snapshot().timedTest.status).toBe('finished')
    expect(sim.step(10)).toBe(0)
    expect(sim.advance(1000)).toEqual({ ticksRun: 0, alpha: 0 })
    expect(sim.updateSettings({ damageVariance: false }).ok).toBe(true) // unlocked after finishing
    sim.reset()
    expect(sim.snapshot().timedTest).toMatchObject({ status: 'idle', result: null })
    expect(sim.snapshot().tick).toBe(0)
  })

  it('aborts on reset mid-run and rejects unsupported durations', () => {
    const sim = create(options())
    sim.startTimedTest(30)
    sim.step(100)
    sim.reset()
    expect(sim.snapshot().timedTest.status).toBe('idle')
    expect(sim.startTimedTest(15 as TimedTestDuration)).toEqual({ ok: false, reason: 'invalid-duration' })
  })

  it('"Run again" reproduces the result; an explicit seed reproduces across sims', () => {
    const sim = create(options())
    sim.startTimedTest(10)
    sim.step(600)
    const first = sim.snapshot().timedTest.result
    sim.startTimedTest(10)
    sim.step(600)
    expect(sim.snapshot().timedTest.result).toEqual(first)
    const a = create(options())
    const b = create({ ...options(), seed: 999 })
    a.startTimedTest(10, { seed: 999 })
    b.startTimedTest(10)
    a.step(600)
    b.step(600)
    expect(a.snapshot().timedTest.result).toEqual(b.snapshot().timedTest.result)
  })

  it('10 s and 30 s tests give stable DPS estimates near the analytic expectation', () => {
    // Sword: 10 damage, 4% crit (×2), ±15% symmetric variance, 20-tick cadence ⇒ E[DPS] ≈ 10 × 1.04 × 3 = 31.2.
    const expected = 31.2
    const dps = (duration: TimedTestDuration, seed: number) =>
      runTimed({ weapon: swordFixture(), seed }, duration, PATTERNS['60 fps']).result.estimatedDps
    const tens = Array.from({ length: 20 }, (_, i) => dps(10, i + 1))
    const thirties = Array.from({ length: 20 }, (_, i) => dps(30, i + 1))
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    for (const d of tens) expect(Math.abs(d - expected) / expected).toBeLessThan(0.12)
    for (const d of thirties) expect(Math.abs(d - expected) / expected).toBeLessThan(0.07)
    expect(Math.abs(mean(thirties) - expected) / expected).toBeLessThan(0.02)
    expect(Math.abs(mean(tens) - mean(thirties)) / expected).toBeLessThan(0.03)
  })
})

describe('performance proxy (AMENDMENTS-001 A16: sim tick ≤ 4 ms)', () => {
  it('ticks with ≥500 live projectiles and 3 dummies stay well under 4 ms on average', () => {
    const sim = create({
      weapon: staffFixture({ projectilesPerUse: 25, spreadDegrees: 360, projectile: { velocityTps: 3, lifetimeTicks: 3000 } }, { useTimeTicks: 1, useAnimationTicks: 1, manaCost: 1 }, {
        homing: { strength: 0.05, acquisitionRangeTiles: 4 },
      }),
      settings: { ignoreMana: true },
      dummies: [{ x: 30, y: 0 }, { x: -30, y: 0 }, { x: 0, y: 30 }],
    })
    sim.setInput({ attacking: true, aim: { x: 1, y: 0 } })
    sim.step(20)
    sim.setInput({ attacking: false })
    expect(sim.renderState().projectiles.length).toBeGreaterThanOrEqual(500)
    const ticks = 300
    const start = performance.now()
    sim.step(ticks)
    const avgMs = (performance.now() - start) / ticks
    expect(sim.renderState().projectiles.length).toBeGreaterThanOrEqual(500)
    expect(avgMs).toBeLessThan(4)
  })
})
