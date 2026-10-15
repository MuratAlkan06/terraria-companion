/**
 * P3-S6 (piercing-beam + Multiple Dummies) and P3-S7 (returning: boomerang / flail / yoyo variants)
 * engine behavior. Fixture weapons (testing/fixtures.ts), never game data; expectations are derived
 * from the fixture params (speed, range, tick rate), not hand-tuned.
 */
import { describe, expect, it } from 'vitest'
import { APPROXIMATIONS, createLabSim, DEFAULT_DUMMY, dummyRow, DUMMY_ROW_SPACING_TILES, type LabSim, type LabSimOptions, type SimEvent } from './index'
import { YOYO_HIT_COOLDOWN_TICKS } from './constants'
import { beamFixture, dotBuffFixture, returningFixture, staffFixture } from './testing/fixtures'

function sim(options: LabSimOptions): LabSim {
  const r = createLabSim(options)
  if (!r.ok) throw new Error(`refused: ${JSON.stringify(r.refusal)}`)
  return r.sim
}

/** Step `ticks` with the given input, collecting events. */
function run(s: LabSim, ticks: number, input: { attacking: boolean; aim?: { x: number; y: number } | null }): SimEvent[] {
  s.setInput({ attacking: input.attacking, aim: input.aim ?? null })
  const events: SimEvent[] = []
  for (let i = 0; i < ticks; i++) {
    s.step()
    events.push(...s.drainEvents())
  }
  return events
}

const of = <T extends SimEvent['type']>(events: SimEvent[], type: T) => events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type)
const noVariance = { damageVariance: false } as const
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

describe('Multiple Dummies (P3-S6 AC1): a configurable row, per-dummy attribution', () => {
  it('dummyRow: `count` standard dummies, nearest first, centres DUMMY_ROW_SPACING_TILES apart', () => {
    expect(dummyRow(1)).toEqual([{ id: 'dummy-0', x: DEFAULT_DUMMY.x, y: 0 }])
    expect(dummyRow(4, 6)).toEqual([0, 1, 2, 3].map((i) => ({ id: `dummy-${i}`, x: 6 + i * DUMMY_ROW_SPACING_TILES, y: 0 })))
    expect(DUMMY_ROW_SPACING_TILES).toBe(3) // 2-tile dummies, a tile of air between
    for (const bad of [0, -1, 2.5, Number.NaN]) expect(() => dummyRow(bad)).toThrow(RangeError)
  })

  it('setDummies swaps the row and fully resets; refused while a timed test runs; invalid rows are refused (current kept)', () => {
    const s = sim({ weapon: beamFixture({ mode: 'channel-beam', tickRateTicks: 6 }) })
    run(s, 30, { attacking: true })
    expect(s.snapshot().stats.hits).toBeGreaterThan(0)
    expect(s.setDummies(dummyRow(3, 4))).toEqual({ ok: true })
    expect(s.snapshot().tick).toBe(0)
    expect(s.snapshot().stats.totalDamage).toBe(0)
    expect(s.renderState().dummies.map((d) => d.id)).toEqual(['dummy-0', 'dummy-1', 'dummy-2'])
    expect(Object.keys(s.snapshot().stats.perDummy)).toEqual(['dummy-0', 'dummy-1', 'dummy-2'])
    expect(s.setDummies([{ id: 'a', x: 2, y: 0 }, { id: 'a', x: 5, y: 0 }])).toMatchObject({ ok: false, reason: 'invalid-dummy' })
    expect(s.renderState().dummies).toHaveLength(3)
    s.startTimedTest(10)
    expect(s.setDummies(dummyRow(1))).toEqual({ ok: false, reason: 'config-locked' })
    s.reset()
    expect(s.renderState().dummies).toHaveLength(3) // reset keeps the row; the Lab's Reset restores its own default target
  })

  it('per-dummy totals add up to the totals, and a timed test reports them per dummy', () => {
    const s = sim({ weapon: beamFixture({ mode: 'pierce-projectile', pierce: 1, projectile: { velocityTps: 30 } }), dummies: dummyRow(3, 6), settings: { ignoreMana: true } })
    s.startTimedTest(10)
    s.step(600)
    const { stats, timedTest } = s.snapshot()
    const per = Object.values(stats.perDummy)
    expect(sum(per.map((d) => d.damage))).toBe(stats.totalDamage)
    expect(sum(per.map((d) => d.hits))).toBe(stats.hits)
    expect(timedTest.result?.perDummy).toEqual(stats.perDummy)
    // pierce 1: the first two dummies are hit by every shot, the third never
    expect(stats.perDummy['dummy-0'].hits).toBe(stats.perDummy['dummy-1'].hits)
    expect(stats.perDummy['dummy-2'].hits).toBe(0)
  })
})

describe('piercing-beam: pierce-projectile (P3-S6 AC2 — up to 1 + pierce dummies in one pass)', () => {
  const row = dummyRow(4, 4)
  const hitsPerShot = (pierce: number | 'infinite') => {
    const s = sim({ weapon: beamFixture({ mode: 'pierce-projectile', pierce, projectile: { velocityTps: 30 } }), dummies: row, settings: { ignoreMana: true } })
    run(s, 1, { attacking: true }) // one shot
    run(s, 120, { attacking: false })
    const st = s.snapshot().stats
    expect(st.projectilesSpawned).toBe(1)
    return row.map((d) => st.perDummy[d.id as string].hits)
  }

  it('pierce counts extra dummies after the first (B37): each dummy at most once per pass, nearest first', () => {
    expect(hitsPerShot(1)).toEqual([1, 1, 0, 0])
    expect(hitsPerShot(2)).toEqual([1, 1, 1, 0])
    expect(hitsPerShot('infinite')).toEqual([1, 1, 1, 1])
  })

  it('speed = params.projectile.velocityTps, else the weapon velocity; damage × the projectile’s quoted %', () => {
    const own = sim({ weapon: beamFixture({ mode: 'pierce-projectile', pierce: 1 }, { shootSpeedTps: 12 }), dummies: row })
    const spawn = of(run(own, 1, { attacking: true }), 'projectile-spawn')[0]
    expect(Math.hypot(spawn.vx, spawn.vy)).toBeCloseTo(12, 9)
    const pct = sim({ weapon: beamFixture({ mode: 'pierce-projectile', pierce: 1, projectile: { velocityTps: 30, damageMultiplierPct: 50 } }), dummies: row })
    expect(pct.weapon.baseHitDamage).toBe(10)
  })
})

describe('piercing-beam: channel-beam (P3-S6 AC3 — continuous while held, tick-rate damage)', () => {
  const TICK = 6
  const beam = (overrides = {}) => beamFixture({ mode: 'channel-beam', tickRateTicks: TICK }, overrides)

  it('hits every dummy on the line once per tick rate while held — continuous across attacks', () => {
    const s = sim({ weapon: beam(), dummies: dummyRow(3, 4), settings: { ...noVariance, ignoreMana: true } })
    const events = run(s, 120, { attacking: true }) // 6 uses of 20 ticks — not a multiple of 6
    const damage = of(events, 'damage')
    for (const id of ['dummy-0', 'dummy-1', 'dummy-2']) {
      const ticks = damage.filter((e) => e.dummyId === id).map((e) => e.tick)
      expect(ticks, id).toEqual(Array.from({ length: 120 / TICK }, (_, i) => i * TICK))
    }
    expect(damage.every((e) => e.source === 'projectile' && e.sourceId === 'beam')).toBe(true)
    expect(s.snapshot().stats.uses).toBe(6)
    expect(of(events, 'projectile-spawn')).toHaveLength(0) // a beam, not projectiles
  })

  it('stops when released and follows the current aim (aimed above the row: no hits)', () => {
    const s = sim({ weapon: beam(), dummies: dummyRow(2, 4), settings: { ignoreMana: true } })
    run(s, 30, { attacking: true })
    const before = s.snapshot().stats.hits
    run(s, 60, { attacking: false })
    expect(s.snapshot().stats.hits).toBe(before)
    run(s, 60, { attacking: true, aim: { x: 0, y: -10 } })
    expect(s.snapshot().stats.hits).toBe(before)
  })

  it('pays mana per attack like any magic weapon, and the beam is off during a reuse-delay cooldown', () => {
    const s = sim({ weapon: beam({ reuseDelayTicks: 10 }), dummies: [{ x: 4, y: 0 }], settings: noVariance })
    const events = run(s, 60, { attacking: true }) // uses at 0 and 30 (20 + 10 cooldown)
    expect(of(events, 'use-start').map((e) => e.tick)).toEqual([0, 30])
    expect(s.snapshot().stats.manaConsumed).toBe(8)
    // hits at 0, 6, 12, 18 in the first use; none during ticks 20–29; then the cadence resumes at 30
    expect(of(events, 'damage').map((e) => e.tick)).toEqual([0, 6, 12, 18, 30, 36, 42, 48])
  })

  it('exposes the beam pose: from the player toward the aim, to the arena edge', () => {
    const s = sim({ weapon: beam() })
    run(s, 1, { attacking: true, aim: { x: 10, y: 0 } })
    expect(s.renderState().blade).toEqual({ kind: 'beam', angle: 0, prevAngle: 0, length: 60, prevLength: 60 })
    expect(s.approximations.map((a) => a.id)).toContain('beam-geometry')
  })

  it('a damage-over-time beam applies its debuff to every dummy it hits (per-dummy DoT attribution)', () => {
    const dotBeam = sim({
      weapon: beamFixture({ mode: 'channel-beam', tickRateTicks: TICK }, {}, { dot: { buffId: 'fixture-burn', durationTicks: 120 } }),
      dummies: dummyRow(2, 4),
      buffs: [dotBuffFixture(6)],
      settings: { ignoreMana: true },
    })
    run(dotBeam, 60, { attacking: true })
    const { perDummy, dotDamage } = dotBeam.snapshot().stats
    expect(perDummy['dummy-0'].dotDamage).toBeGreaterThan(0)
    expect(perDummy['dummy-1'].dotDamage).toBe(perDummy['dummy-0'].dotDamage)
    expect(dotDamage).toBe(perDummy['dummy-0'].dotDamage + perDummy['dummy-1'].dotDamage)
  })
})

describe('returning: boomerang (P3-S7 AC2 — out and back; wiki: most boomerangs "instantly turn around after hitting enemies")', () => {
  // 30 tiles/s = ½ tile per tick; range 12 tiles.
  const boomerang = (params = {}) => returningFixture({ variant: 'boomerang', ...params })

  it('turns back at its first hit and comes back to hand; the next throw waits until it is caught', () => {
    const s = sim({ weapon: boomerang(), dummies: [{ x: 6, y: 0 }], settings: noVariance })
    expect(s.weapon.returnsToHand).toBe(true)
    const events = run(s, 600, { attacking: true })
    const damage = of(events, 'damage')
    // out: 10 steps of ½ tile reach the near face (x = 5) on tick 9 — it turns there; back: 10 steps, caught on tick 20
    expect(damage[0]).toMatchObject({ tick: 9, x: 5, source: 'projectile' })
    const caught = of(events, 'projectile-despawn').filter((e) => e.reason === 'returned').map((e) => e.tick)
    expect(caught[0]).toBe(20)
    // the use time (20 ticks) is over by then: the next throw starts the tick after the catch
    expect(of(events, 'use-start').map((e) => e.tick).slice(0, 3)).toEqual([0, 21, 42])
    // one hit per throw (the dummy that turned it is not hit again on the way back); one projectile per throw
    expect(damage.filter((e) => e.tick <= caught.at(-1)!)).toHaveLength(caught.length)
    const st = s.snapshot().stats
    expect(st.projectilesSpawned).toBe(st.uses)
  })

  it('with nothing in its path it flies its full range and back (24 + 24 ticks), then the next throw', () => {
    const s = sim({ weapon: boomerang(), dummies: [{ x: 30, y: 0 }] })
    const events = run(s, 120, { attacking: true })
    expect(of(events, 'projectile-despawn').filter((e) => e.reason === 'returned').map((e) => e.tick)).toEqual([48, 97])
    expect(of(events, 'use-start').map((e) => e.tick)).toEqual([0, 49, 98])
    expect(s.snapshot().stats.hits).toBe(0)
  })

  it('against a row it strikes the nearest dummy and turns: the dummies behind are not reached', () => {
    const row = dummyRow(4, 4)
    const s = sim({ weapon: boomerang(), dummies: row, settings: noVariance })
    run(s, 600, { attacking: true })
    const st = s.snapshot().stats
    expect(row.map((d) => st.perDummy[d.id as string].hits)).toEqual([st.uses, 0, 0, 0])
  })

  it('is labeled with the boomerang flight approximation, sourced to the wiki statement it follows', () => {
    const ids = sim({ weapon: boomerang() }).approximations.map((a) => a.id)
    expect(ids).toEqual(expect.arrayContaining(['boomerang-flight', 'projectile-point', 'projectile-damage', 'no-shared-immunity']))
    expect(ids).not.toContain('projectile-lifetime') // it ends when caught
    expect(APPROXIMATIONS['boomerang-flight'].sourceUrl).toBe('https://terraria.wiki.gg/wiki/Combat_Wrench')
  })
})

describe('returning: launched flail (P3-S7 AC3 — out until it strikes, then back)', () => {
  const flail = (params = {}) => returningFixture({ variant: 'flail', throwRangeTiles: 9, ...params }, { shootSpeedTps: 45 })

  it('turns back at the first dummy it strikes and does not hit it again as it retracts', () => {
    const s = sim({ weapon: flail(), dummies: dummyRow(3, 4), settings: noVariance })
    const events = run(s, 600, { attacking: true })
    const per = s.snapshot().stats.perDummy
    const uses = s.snapshot().stats.uses
    expect(per['dummy-0'].hits).toBe(uses) // one hit per launch, on the nearest dummy
    expect(per['dummy-1'].hits + per['dummy-2'].hits).toBe(0)
    // a short flight (3 tiles out and back) — the use time (20 ticks) sets the pace
    expect(of(events, 'use-start').map((e) => e.tick).slice(0, 3)).toEqual([0, 20, 40])
    const impact = of(events, 'damage')[0]
    expect(impact.x).toBe(3) // the near face of the first dummy
  })

  it('with nothing in reach it extends to its full length and comes back', () => {
    const s = sim({ weapon: flail(), dummies: [{ x: 30, y: 0 }] })
    const events = run(s, 40, { attacking: true })
    // 9 tiles at ¾ tile per tick: 12 ticks out, 12 back, caught on the next tick
    expect(of(events, 'projectile-despawn')[0]).toMatchObject({ reason: 'returned', tick: 24 })
    expect(s.snapshot().stats.hits).toBe(0)
    expect(sim({ weapon: flail() }).approximations.map((a) => a.id)).toContain('flail-launch')
  })
})

describe('returning: yoyo (P3-S7 AC3 — deployed under cursor control until recalled)', () => {
  // 60 tiles/s = 1 tile per tick; reach 8 tiles.
  const yoyo = (params = {}) => returningFixture({ variant: 'yoyo', throwRangeTiles: 8, ...params }, { shootSpeedTps: 60 })

  it('dwells at the aim point while held, re-hitting every 10 ticks (wiki: up to 6 hits per second) — one throw', () => {
    const s = sim({ weapon: yoyo(), dummies: [{ x: 6, y: 0 }], settings: noVariance })
    const events = run(s, 600, { attacking: true }) // auto-aim: the dummy's centre
    const ticks = of(events, 'damage').map((e) => e.tick)
    expect(s.snapshot().stats.uses).toBe(1)
    expect(ticks.slice(1).every((t, i) => t - ticks[i] === YOYO_HIT_COOLDOWN_TICKS)).toBe(true)
    expect(ticks).toHaveLength(Math.floor((599 - ticks[0]) / YOYO_HIT_COOLDOWN_TICKS) + 1)
    expect(s.renderState().projectiles).toHaveLength(1)
    expect(s.renderState().projectiles[0]).toMatchObject({ x: 6, y: 0 })
  })

  it('follows the cursor (another dummy takes the hits once the aim moves there), never past its reach', () => {
    const s = sim({ weapon: yoyo(), dummies: [{ id: 'low', x: 5, y: 0 }, { id: 'high', x: 5, y: -5 }, { id: 'far', x: 20, y: 0 }], settings: noVariance })
    run(s, 60, { attacking: true, aim: { x: 5, y: 0 } })
    const first = s.snapshot().stats.perDummy
    expect(first.low.hits).toBeGreaterThan(0)
    expect(first.high.hits).toBe(0)
    run(s, 60, { attacking: true, aim: { x: 5, y: -5 } })
    const second = s.snapshot().stats.perDummy
    expect(second.high.hits).toBeGreaterThan(0)
    expect(second.low.hits).toBe(first.low.hits) // left behind
    run(s, 60, { attacking: true, aim: { x: 30, y: 0 } })
    const at = s.renderState().projectiles[0]
    expect(at.x).toBeCloseTo(8, 9) // clamped to the 8-tile reach
    expect(at.y).toBeCloseTo(0, 9)
    expect(s.snapshot().stats.perDummy.far.hits).toBe(0)
  })

  it('hitsPerPass caps the hits on each dummy per throw (its time out is one pass)', () => {
    const s = sim({ weapon: yoyo({ hitsPerPass: 3 }), dummies: [{ x: 6, y: 0 }] })
    run(s, 600, { attacking: true })
    expect(s.snapshot().stats.hits).toBe(3)
  })

  it('recalled on release: it comes back, then the next press throws again', () => {
    const s = sim({ weapon: yoyo(), dummies: [{ x: 6, y: 0 }] })
    run(s, 60, { attacking: true })
    const back = run(s, 20, { attacking: false })
    expect(of(back, 'projectile-despawn')).toMatchObject([{ reason: 'returned' }])
    const hits = s.snapshot().stats.hits
    run(s, 30, { attacking: false })
    expect(s.snapshot().stats.hits).toBe(hits)
    expect(s.renderState().projectiles).toHaveLength(0)
    const again = run(s, 10, { attacking: true })
    expect(of(again, 'use-start')).toHaveLength(1)
    expect(s.snapshot().stats.uses).toBe(2)
    expect(s.approximations.map((a) => a.id)).toContain('yoyo-control')
  })
})

describe('the three variants are ONE archetype with variant params (P3-S7 AC4)', () => {
  it('every variant builds through the same interpreter and reports the same summary shape', () => {
    const summaries = (['boomerang', 'flail', 'yoyo'] as const).map((variant) => sim({ weapon: returningFixture({ variant }) }).weapon)
    for (const s of summaries) expect(s).toMatchObject({ archetype: 'returning', returnsToHand: true, usesAmmo: false })
    const staff = sim({ weapon: staffFixture() }).weapon
    expect(staff.returnsToHand).toBe(false)
  })
})
