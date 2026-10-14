/**
 * Determinism proof (ADR-001 D5): same seed + loadout + duration ⇒ bit-identical totals at any
 * frame rate. Scenarios deliberately exercise every RNG consumer (variance, crits, spread
 * inaccuracy, DoT chance + duration ranges) and every float path (homing, gravity, regen).
 */
import { describe, expect, it } from 'vitest'
import { createLabSim, dummyRow, mulberry32, type LabSim, type LabSimOptions, type SimSnapshot, type TimedTestDuration, type TimedTestResult } from './index'
import { ammoFixture, beamFixture, bowFixture, dotBuffFixture, returningFixture, staffFixture, summonFixture, swordFixture, whipFixture } from './testing/fixtures'

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
  // AMENDMENTS-010 B48(a): Clockwork Assault Rifle-shaped burst (useTime 4 / useAnimation 12) + reuse delay 14.
  'burst rifle (reuse delay, slight spread)': () => ({
    weapon: bowFixture({ spreadDegrees: 10 }, { useTimeTicks: 4, useAnimationTicks: 12, reuseDelayTicks: 14, autoReuse: true, critPct: 0 }),
    ammo: ammoFixture({ damage: 7, velocityBonusTps: 2 }),
    dummies: [{ x: 10, y: 0 }],
    seed: 434,
  }),
  // P3-S6 / P3-S7 (pinned 2026-10-13): the returning variants and the piercing-beam modes on dummy rows.
  'boomerang (turns at its first hit, dummy row)': () => ({
    weapon: returningFixture({ variant: 'boomerang', throwRangeTiles: 14 }, { damage: 12, critPct: 6, shootSpeedTps: 33 }),
    dummies: dummyRow(3, 6),
    seed: 61,
  }),
  'launched flail (turns on strike, DoT chance)': () => ({
    weapon: returningFixture({ variant: 'flail', throwRangeTiles: 9.4 }, { damage: 14, critPct: 4, shootSpeedTps: 45, useTimeTicks: 28, useAnimationTicks: 28, autoReuse: true }, {
      dot: { buffId: 'fixture-burn', chancePct: 50, durationTicks: { minTicks: 60, maxTicks: 180 } },
    }),
    buffs: [dotBuffFixture(4)],
    dummies: dummyRow(3, 4),
    seed: 62,
  }),
  'yoyo (tethered dwell at the auto-aim point)': () => ({
    weapon: returningFixture({ variant: 'yoyo', throwRangeTiles: 9.25 }, { damage: 17, critPct: 2, shootSpeedTps: 60, useTimeTicks: 25, useAnimationTicks: 25 }),
    dummies: dummyRow(2, 6),
    seed: 63,
  }),
  'pierce bolt (pierce 2 vs an armored row of 4, slow-cast)': () => ({
    weapon: beamFixture({ mode: 'pierce-projectile', pierce: 2, projectile: { velocityTps: 24 } }, { critPct: 4, manaCost: 6 }),
    dummies: dummyRow(4, 6).map((d, i) => (i === 1 ? { ...d, defense: 8 } : d)),
    settings: { maxMana: 60 },
    seed: 64,
  }),
  'channel beam (tick rate across uses, reuse delay)': () => ({
    weapon: beamFixture({ mode: 'channel-beam', tickRateTicks: 7 }, { critPct: 4, useTimeTicks: 18, useAnimationTicks: 18, reuseDelayTicks: 4 }),
    dummies: dummyRow(3, 4),
    seed: 65,
  }),
  // P3-S9 / P3-S10 (pinned 2026-10-14): summons fill their slots under the held attack, then attack on their own.
  'minion (ground-melee, two slots, row)': () => ({
    weapon: summonFixture({ aiClass: 'ground-melee', attackRateTicks: 12 }, { damage: 9 }),
    settings: { minionSlots: 2 },
    dummies: dummyRow(2, 6),
    seed: 66,
  }),
  'sentry (ranged-shot, range, armored row)': () => ({
    weapon: summonFixture({ variant: 'sentry', aiClass: 'ranged-shot', attackRateTicks: 20, sentryRangeTiles: 6.5 }, { damage: 25 }),
    settings: { sentrySlots: 2 },
    dummies: dummyRow(3, 4).map((d, i) => (i === 0 ? { ...d, defense: 6 } : d)),
    seed: 67,
  }),
  'ranged minion (projectile, pierce)': () => ({
    weapon: summonFixture({ aiClass: 'ranged-shot', attackRateTicks: 25, projectile: { velocityTps: 24, pierce: 1 } }, { damage: 15 }),
    settings: { minionSlots: 2 },
    dummies: dummyRow(3, 6),
    seed: 69,
  }),
  'whip + minion loadout (tags, tag crit, falloff, minion DoT)': () => ({
    weapon: whipFixture({ rangeTiles: 14, tagDamageFlat: 6, tagCritPct: 10, falloffPerTarget: 0.3 }, { damage: 20 }),
    minionLoadout: summonFixture({ aiClass: 'hover-strike', attackRateTicks: 15 }, { damage: 12 }, { dot: { buffId: 'fixture-burn', chancePct: 50, durationTicks: { minTicks: 60, maxTicks: 120 } } }),
    buffs: [dotBuffFixture(3)],
    settings: { minionSlots: 3 },
    dummies: dummyRow(3, 5),
    seed: 68,
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

  it('cross-run stability: pinned fingerprint of every reference scenario', () => {
    // Golden values pin the engine's observable semantics. If a deliberate engine change alters
    // them, update these numbers in the same change with a changelog note in README.md (AMENDMENTS-008 B38).
    for (const [name, scenario] of Object.entries(SCENARIOS)) {
      const { result } = runTimed(scenario(), 30, PATTERNS['144 fps'])
      expect({ total: result.totalDamage, dot: result.dotDamage, hits: result.hits, crits: result.crits, uses: result.uses, digest: result.eventDigest }, name).toEqual(
        GOLDEN_30S[name],
      )
    }
  })

  it('the row scenarios attribute every hit to a dummy: per-dummy totals add up, pierce and flail reach exactly the dummies they should', () => {
    const per = (name: string) => runTimed(SCENARIOS[name](), 30, PATTERNS['60 fps']).result
    for (const name of ['boomerang (turns at its first hit, dummy row)', 'pierce bolt (pierce 2 vs an armored row of 4, slow-cast)', 'channel beam (tick rate across uses, reuse delay)']) {
      const result = per(name)
      const dummies = Object.values(result.perDummy)
      expect(dummies.reduce((a, d) => a + d.damage, 0), name).toBe(result.totalDamage)
      expect(dummies.reduce((a, d) => a + d.hits, 0), name).toBe(result.hits)
    }
    expect(Object.values(per('pierce bolt (pierce 2 vs an armored row of 4, slow-cast)').perDummy).map((d) => d.hits > 0)).toEqual([true, true, true, false]) // 1 + pierce 2
    expect(Object.values(per('launched flail (turns on strike, DoT chance)').perDummy).map((d) => d.hits > 0)).toEqual([true, false, false])
  })

  it('the reuse-delay scenario attacks once per useAnimation + reuseDelay (12 + 14 = 26 ticks)', () => {
    const { result } = runTimed(SCENARIOS['burst rifle (reuse delay, slight spread)'](), 30, PATTERNS['60 fps'])
    expect(result.uses).toBe(Math.ceil(1800 / 26)) // uses start at ticks 0, 26, 52, … < 1800
    // 3 shots per burst at use start + 0/4/8 (useTime 4 inside 12 ticks), none during the cooldown
    let shots = 0
    for (let start = 0; start < 1800; start += 26) for (const offset of [0, 4, 8]) if (start + offset < 1800) shots++
    expect(result.ammoConsumed).toBe(shots)
  })
})

/**
 * 30 s @ 144 fps fingerprints (Node 23.11 / V8; README changelog, AMENDMENTS-008 B38).
 * - The first four were computed BEFORE the 2026-10-13 reuse-delay change (B48(a)) and re-pinned
 *   unchanged after it: weapons without a reuse delay behave bit-identically.
 * - staff: re-pinned 2026-10-13 for the B35 `slow-cast` default — mana-limited at max mana 60: 10 paid
 *   casts, then 32 slow casts (use time × 2.5) in 30 s.
 * - burst rifle: pinned 2026-10-13 with the reuse-delay change (new scenario).
 * - The five P3-S6 / P3-S7 scenarios (returning variants, piercing-beam modes): pinned 2026-10-13 as
 *   new scenarios; the kernel hooks they use (ready gate, guided projectiles, persistent hit sources)
 *   left the five earlier fingerprints unchanged — README changelog.
 * - The four P3-S9 / P3-S10 scenarios (minion, sentry, ranged minion with a projectile, whip + minion
 *   loadout): pinned 2026-10-14 as new scenarios; the kernel's summon, tag and loadout hooks left all
 *   ten earlier fingerprints unchanged — README changelog.
 */
const GOLDEN_30S: Record<string, { total: number; dot: number; hits: number; crits: number; uses: number; digest: string }> = {
  'sword (variance + crits)': { total: 1049, dot: 0, hits: 95, crits: 10, uses: 95, digest: 'ae897f46' },
  'shotgun (spread, gravity, pierce, armored row)': { total: 5278, dot: 0, hits: 360, crits: 48, uses: 45, digest: '97dabadc' },
  'staff (inaccuracy, homing, DoT ranges, mana regen)': { total: 799, dot: 97, hits: 42, crits: 4, uses: 42, digest: '876a8729' },
  'burst staff (useTime < useAnimation, slow-cast)': { total: 4073, dot: 0, hits: 258, crits: 13, uses: 43, digest: 'b6630161' },
  'burst rifle (reuse delay, slight spread)': { total: 3278, dot: 0, hits: 207, crits: 11, uses: 70, digest: '9bcbb3a6' },
  'boomerang (turns at its first hit, dummy row)': { total: 1073, dot: 0, hits: 86, crits: 3, uses: 86, digest: 'd0de41e8' },
  'launched flail (turns on strike, DoT chance)': { total: 1129, dot: 109, hits: 67, crits: 7, uses: 67, digest: '92a82efb' },
  'yoyo (tethered dwell at the auto-aim point)': { total: 3288, dot: 0, hits: 180, crits: 15, uses: 1, digest: '2bfbdb43' },
  'pierce bolt (pierce 2 vs an armored row of 4, slow-cast)': { total: 2576, dot: 0, hits: 129, crits: 8, uses: 44, digest: 'f5383fcd' },
  'channel beam (tick rate across uses, reuse delay)': { total: 15858, dot: 0, hits: 738, crits: 54, uses: 82, digest: 'c0eea291' },
  'minion (ground-melee, two slots, row)': { total: 2622, dot: 0, hits: 295, crits: 0, uses: 2, digest: '8e35ff66' },
  'sentry (ranged-shot, range, armored row)': { total: 3967, dot: 0, hits: 177, crits: 0, uses: 2, digest: '4fbff848' },
  'ranged minion (projectile, pierce)': { total: 4173, dot: 0, hits: 280, crits: 0, uses: 2, digest: '3830f899' },
  'whip + minion loadout (tags, tag crit, falloff, minion DoT)': { total: 9644, dot: 89, hits: 537, crits: 33, uses: 60, digest: '12a71806' },
}

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
