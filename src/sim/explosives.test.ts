/**
 * P3-S11 explosive-aoe interpreter (PRD P3-S11 AC1) and the Debuff Dummy's debuff state (AC3): fuse
 * timing, the thrown arc, radius inclusion / exclusion across a dummy row, the falloff math, one
 * explosion per throw (one item used per throw), the impact trigger, crit by class, refusals, labels.
 * Frame-rate independence + the pinned fingerprints live in determinism.test.ts with the other scenarios.
 */
import { describe, expect, it } from 'vitest'
import { Weapon } from '../schemas'
import { GRAVITY_TILES_PER_TICK2, GROUND_Y_TILES, THROWN_REST_HEIGHT_TILES } from './constants'
import { blastDamage, blastKeptPct } from './damage'
import { createLabSim, dummyRow, type LabSim, type LabSimOptions, type SimEvent } from './index'
import { arcPoint, landingPoint, throwArc } from './interpreters/explosiveAoe'
import { dotBuffFixture, explosiveFixture, fixtureProv, staffFixture } from './testing/fixtures'

const create = (options: LabSimOptions): LabSim => {
  const r = createLabSim(options)
  if (!r.ok) throw new Error(`refused: ${JSON.stringify(r.refusal)}`)
  return r.sim
}

type Of<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>
const ofType = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Of<T>[] => events.filter((e): e is Of<T> => e.type === type)

/** One throw (attack held for exactly one tick), then `ticks` more ticks; every event. */
function oneThrow(options: LabSimOptions, aim: { x: number; y: number } | null, ticks: number): { sim: LabSim; events: SimEvent[] } {
  const sim = create({ settings: { damageVariance: false }, ...options })
  sim.setInput({ attacking: true, aim })
  sim.step(1)
  sim.setInput({ attacking: false })
  sim.step(ticks)
  return { sim, events: sim.drainEvents() }
}

const REST_Y = GROUND_Y_TILES - THROWN_REST_HEIGHT_TILES

describe('the thrown arc (explosive-throw)', () => {
  it('lands exactly on the ground below the aim point after D ÷ speed ticks, rising first under the generic gravity', () => {
    const arc = throwArc({ x: 0, y: 0 }, { x: 12, y: REST_Y }, 0.3125)
    expect(arc.ticks).toBeCloseTo(38.4, 12)
    expect(arc.gravity).toBe(GRAVITY_TILES_PER_TICK2)
    expect(arcPoint(arc, 0)).toEqual({ x: 0, y: 0 })
    expect(arcPoint(arc, arc.ticks)).toEqual({ x: 12, y: REST_Y })
    expect(arcPoint(arc, 1000)).toEqual({ x: 12, y: REST_Y })
    // it goes up before it comes down (y down: negative is above the hand)
    expect(arc.vy0).toBeLessThan(0)
    expect(Math.min(...Array.from({ length: 38 }, (_, t) => arcPoint(arc, t).y))).toBeLessThan(0)
    // the vertical solution really lands there: y(T) = y0 + vy0·T + g·T²/2
    expect(arc.vy0 * arc.ticks + (arc.gravity * arc.ticks ** 2) / 2).toBeCloseTo(REST_Y, 12)
    // straight down at the player's feet: one tick, never a division by zero
    expect(throwArc({ x: 0, y: 0 }, { x: 0, y: REST_Y }, 0.3125).ticks).toBe(1)
  })

  it('the landing point is on the ground below the aim, inside the arena', () => {
    const arena = { minX: -60, maxX: 60, minY: -40, maxY: 40 }
    expect(landingPoint({ x: 9, y: -7 }, arena)).toEqual({ x: 9, y: REST_Y })
    expect(landingPoint({ x: 99, y: 30 }, arena)).toEqual({ x: 60, y: REST_Y })
    expect(GROUND_Y_TILES).toBe(1.5) // the feet of the player and of a standard dummy at y 0
  })
})

describe('timed trigger (a fuse): explosive-fuse', () => {
  it('goes off exactly fuseTicks after the throw (3 s = 180 ticks; 5 s = 300), at rest where it landed; nothing before', () => {
    for (const fuseTicks of [180, 300]) {
      const { sim, events } = oneThrow({ weapon: explosiveFixture({ fuseTicks }), dummies: dummyRow(3, 6) }, null, fuseTicks + 30)
      const [throwEvent] = ofType(events, 'projectile-spawn')
      expect(throwEvent.tick).toBe(0)
      const explosions = ofType(events, 'explosion')
      expect(explosions).toHaveLength(1)
      expect(explosions[0]).toMatchObject({ tick: fuseTicks, x: 6, y: REST_Y, radiusTiles: 4, projectileId: throwEvent.projectileId })
      const hits = ofType(events, 'damage')
      expect(hits.every((h) => h.tick === fuseTicks && h.sourceId === `proj:${throwEvent.projectileId}`)).toBe(true)
      expect(ofType(events, 'projectile-despawn')).toEqual([expect.objectContaining({ tick: fuseTicks, reason: 'detonated', projectileId: throwEvent.projectileId })])
      // event order: the explosion, then its hits, then the despawn
      const at = (e: SimEvent) => events.indexOf(e)
      expect(Math.max(...hits.map(at))).toBeLessThan(at(ofType(events, 'projectile-despawn')[0]))
      expect(Math.min(...hits.map(at))).toBeGreaterThan(at(explosions[0]))
      expect(sim.renderState().projectiles).toEqual([])
    }
  })

  it('flies through the dummies on its way without hitting them (only the explosion deals damage)', () => {
    // aimed past the first dummy: the arc crosses its hitbox, lands at x 12, and goes off there
    const { events } = oneThrow({ weapon: explosiveFixture(), dummies: dummyRow(3, 6) }, { x: 12, y: 0 }, 200)
    const hits = ofType(events, 'damage')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((h) => h.tick === 180)).toBe(true)
    expect(ofType(events, 'explosion')[0]).toMatchObject({ x: 12, y: REST_Y })
  })

  it('a fuse shorter than the flight goes off in the air, where it is', () => {
    const { events } = oneThrow({ weapon: explosiveFixture({ fuseTicks: 10 }), dummies: dummyRow(1, 30) }, { x: 30, y: 0 }, 20)
    const [explosion] = ofType(events, 'explosion')
    expect(explosion.tick).toBe(10)
    expect(explosion.x).toBeCloseTo(3.125, 9) // 10 ticks × 0.3125 tiles/tick toward x 30
    expect(explosion.y).toBeLessThan(REST_Y)
  })
})

describe('the blast: every dummy in the radius, once (blast-area)', () => {
  it('radius inclusion / exclusion across a row: the distance is to each hitbox’s nearest point', () => {
    // auto-aim (Space, timed tests): at the first dummy → lands at x 6. Hitboxes 2 wide: [5,7] [8,10] [11,13].
    const auto = ofType(oneThrow({ weapon: explosiveFixture(), dummies: dummyRow(3, 6) }, null, 200).events, 'damage')
    expect(auto.map((h) => [h.dummyId, h.amount, h.blastKeptPct])).toEqual([
      ['dummy-0', 100, 100], // inside: distance 0
      ['dummy-1', 100, 100], // nearest point (8, 1): 2 tiles ≤ 4
    ]) // dummy-2: nearest (11, 1) — 5 tiles > 4: outside
    expect(auto[1]).toMatchObject({ x: 8, y: REST_Y }) // the hit lands on the hitbox point nearest the blast
    // aimed at the middle dummy: all three are within 4 tiles
    const middle = ofType(oneThrow({ weapon: explosiveFixture(), dummies: dummyRow(3, 6) }, { x: 9, y: -4 }, 200).events, 'damage')
    expect(middle.map((h) => h.dummyId)).toEqual(['dummy-0', 'dummy-1', 'dummy-2'])
    // just inside / just outside the far dummy (5 tiles from a blast at x 6)
    const reach = (radius: number) => ofType(oneThrow({ weapon: explosiveFixture({ blastRadiusTiles: radius }), dummies: dummyRow(3, 6) }, null, 200).events, 'damage').map((h) => h.dummyId)
    expect(reach(5)).toEqual(['dummy-0', 'dummy-1', 'dummy-2']) // exactly on the edge counts as inside
    expect(reach(4.99)).toEqual(['dummy-0', 'dummy-1'])
    expect(reach(1.99)).toEqual(['dummy-0'])
  })

  it('defense and variance apply to each blast hit as to any hit; the per-dummy totals add up', () => {
    const sim = create({ weapon: explosiveFixture(), dummies: dummyRow(3, 6).map((d, i) => (i === 1 ? { ...d, defense: 20 } : d)), settings: { damageVariance: false } })
    sim.setInput({ attacking: true, aim: { x: 9, y: 0 } })
    sim.step(1)
    sim.setInput({ attacking: false })
    sim.step(200)
    const { perDummy, totalDamage, hits } = sim.snapshot().stats
    expect([perDummy['dummy-0'].damage, perDummy['dummy-1'].damage, perDummy['dummy-2'].damage]).toEqual([100, 90, 100]) // ⌊100 − 20/2⌋
    expect(totalDamage).toBe(290)
    expect(hits).toBe(3)
  })

  it('falloff math: none = 100 % anywhere inside; linear = 100 → 0 % by distance, whole percent rounded down; outside = 0', () => {
    expect(blastKeptPct(0, 4, 'none')).toBe(100)
    expect(blastKeptPct(4, 4, 'none')).toBe(100)
    expect(blastKeptPct(4.0001, 4, 'none')).toBe(0)
    expect(blastKeptPct(0, 10, 'linear')).toBe(100)
    expect(blastKeptPct(2, 10, 'linear')).toBe(80)
    expect(blastKeptPct(5, 10, 'linear')).toBe(50)
    expect(blastKeptPct(3.7, 10, 'linear')).toBe(63)
    expect(blastKeptPct(8, 10, 'linear')).toBe(20) // not 19: exact percentages survive binary floating point
    expect(blastKeptPct(9.995, 10, 'linear')).toBe(0)
    expect(blastKeptPct(10, 10, 'linear')).toBe(0)
    expect(blastKeptPct(11, 10, 'linear')).toBe(0)
    expect(blastDamage(100, 63)).toBe(63)
    expect(blastDamage(55, 37)).toBe(20) // 20.35 → 20
    expect(blastDamage(250, 100)).toBe(250)
  })

  it('linear falloff in the sim: each dummy’s hit is labeled with its kept percent; one kept nothing is not hit', () => {
    const { events } = oneThrow({ weapon: explosiveFixture({ falloff: 'linear', blastRadiusTiles: 10 }), dummies: dummyRow(4, 6) }, null, 200)
    // blast at (6, 1): distances 0, 2, 5, 8 → kept 100, 80, 50, 20
    expect(ofType(events, 'damage').map((h) => [h.dummyId, h.blastKeptPct, h.amount])).toEqual([
      ['dummy-0', 100, 100],
      ['dummy-1', 80, 80],
      ['dummy-2', 50, 50],
      ['dummy-3', 20, 20],
    ])
    const edge = ofType(oneThrow({ weapon: explosiveFixture({ falloff: 'linear', blastRadiusTiles: 5 }), dummies: dummyRow(3, 6) }, null, 200).events, 'damage')
    expect(edge.map((h) => [h.dummyId, h.blastKeptPct])).toEqual([
      ['dummy-0', 100],
      ['dummy-1', 60],
    ]) // dummy-2 sits on the edge: kept 0 → not hit
  })

  it('one explosion per throw, one item used per throw; each explosion hits each dummy at most once', () => {
    const sim = create({ weapon: explosiveFixture(), dummies: dummyRow(3, 6), settings: { damageVariance: false } })
    expect(sim.weapon).toMatchObject({ consumable: true, usesAmmo: false, archetype: 'explosive-aoe', critChancePct: 0, cadenceTicks: 25 })
    sim.setInput({ attacking: true, aim: null })
    sim.step(600)
    const events = sim.drainEvents()
    const stats = sim.snapshot().stats
    const throws = ofType(events, 'projectile-spawn')
    expect(stats.uses).toBe(24) // ⌈600 / 25⌉
    expect(throws).toHaveLength(24)
    expect(stats.consumablesUsed).toBe(24)
    expect(stats.ammoConsumed).toBe(0)
    // thrown at 0, 25, …, 575: the ones thrown by tick 419 have gone off by tick 599
    const explosions = ofType(events, 'explosion')
    expect(explosions).toHaveLength(17)
    expect(new Set(explosions.map((e) => e.projectileId)).size).toBe(17)
    expect(stats.explosions).toBe(17) // the stat counts the events
    const pairs = ofType(events, 'damage').map((h) => `${h.sourceId}|${h.dummyId}`)
    expect(new Set(pairs).size).toBe(pairs.length)
    expect(stats.hits).toBe(34) // 17 blasts × 2 dummies in reach
    expect(stats.totalDamage).toBe(3400)
    expect(sim.renderState().projectiles).toHaveLength(7) // still on their fuses
  })

  it('a timed test counts the items used and the explosions (the rest still on their fuses at the end)', () => {
    const sim = create({ weapon: explosiveFixture(), dummies: dummyRow(3, 6) })
    sim.startTimedTest(10)
    sim.step(600)
    expect(sim.snapshot().timedTest.result).toMatchObject({ consumablesUsed: 24, explosions: 17, uses: 24, ammoConsumed: 0 })
    // a reset starts the count again
    sim.reset()
    expect(sim.snapshot().stats).toMatchObject({ consumablesUsed: 0, explosions: 0 })
  })
})

describe('impact trigger: explosive-impact', () => {
  const grenade = (params = {}, overrides: Partial<Weapon> = {}) =>
    explosiveFixture({ trigger: 'impact', ...params }, { name: 'Fixture Grenade', damageClass: 'ranged', critPct: 0, damage: 60, useTimeTicks: 45, useAnimationTicks: 45, shootSpeedTps: 20.625, _prov: fixtureProv(), ...overrides })

  it('goes off at its first dummy contact — at the touch point, in flight — and the touch itself deals no hit', () => {
    // thrown past the first dummy: it touches dummy-0's near face (x 5) long before it would land at x 12
    const { events } = oneThrow({ weapon: grenade(), dummies: dummyRow(3, 6) }, { x: 12, y: 0 }, 120)
    const [explosion] = ofType(events, 'explosion')
    expect(explosion.x).toBeCloseTo(5, 9)
    expect(explosion.tick).toBeLessThan(30) // flight to x 12 takes 12 ÷ 0.34375 ≈ 35 ticks
    const hits = ofType(events, 'damage')
    // dummy-0 touched (distance 0), dummy-1 (nearest point x 8: 3 tiles) in the 4-tile radius, dummy-2 (6 tiles) not
    expect(hits.map((h) => [h.dummyId, h.amount / (h.crit ? 2 : 1), h.blastKeptPct, h.tick])).toEqual([
      ['dummy-0', 60, 100, explosion.tick],
      ['dummy-1', 60, 100, explosion.tick],
    ]) // (a ranged hit may crit: 4% base — double damage)
    expect(ofType(events, 'projectile-despawn')).toEqual([expect.objectContaining({ reason: 'detonated', tick: explosion.tick })])
  })

  it('touching nothing, it goes off where it lands', () => {
    const { events } = oneThrow({ weapon: grenade(), dummies: dummyRow(2, 6) }, { x: -8, y: 0 }, 60)
    const [explosion] = ofType(events, 'explosion')
    expect(explosion).toMatchObject({ x: -8, y: REST_Y, tick: Math.ceil(8 / (20.625 / 60)) })
    expect(ofType(events, 'damage')).toEqual([]) // no dummy within 4 tiles of x −8
  })

  it('a ranged explosive crits at 4% + its bonus; a classless one never does (wiki Critical hit)', () => {
    const run = (weapon: Weapon) => {
      const sim = create({ weapon, dummies: dummyRow(3, 6), seed: 7 })
      sim.startTimedTest(30)
      sim.step(1800)
      return sim.snapshot().timedTest.result
    }
    const ranged = run(grenade({}, { critPct: 20 }))
    expect(ranged?.hits).toBeGreaterThan(50)
    expect(ranged?.crits).toBeGreaterThan(0)
    const classless = run(explosiveFixture({ trigger: 'impact' }))
    expect(classless?.hits).toBeGreaterThan(50)
    expect(classless?.crits).toBe(0)
  })
})

describe('refusals and labels', () => {
  const refusalOf = (weapon: Weapon) => {
    const r = createLabSim({ weapon })
    if (r.ok) throw new Error('expected a refusal')
    return r.refusal
  }

  it('fires ammunition (a launcher) → invalid-data; homing / multiHit → not implemented; no throw speed → missing', () => {
    expect(refusalOf(explosiveFixture({}, { ammoClass: 'rocket-i' }))).toMatchObject({ reason: 'invalid-data', fields: ['ammoClass', 'labBehavior.params'] })
    expect(refusalOf(explosiveFixture({}, {}, { homing: { strength: 0.2, acquisitionRangeTiles: 9 } }))).toMatchObject({ reason: 'modifier-not-implemented', fields: ['labBehavior.modifiers.homing'] })
    expect(refusalOf(explosiveFixture({}, {}, { multiHit: { localImmunityTicks: 10 } }))).toMatchObject({ reason: 'modifier-not-implemented', fields: ['labBehavior.modifiers.multiHit'] })
    expect(refusalOf(explosiveFixture({}, { shootSpeedTps: undefined }))).toMatchObject({ reason: 'missing-required-field', fields: ['shootSpeedTps'] })
  })

  it('labels by params: the trigger’s rule, the falloff formula only where used, the B63 P-5 radius when modeled, classless crit', () => {
    const ids = (weapon: Weapon) => {
      const r = createLabSim({ weapon })
      if (!r.ok) throw new Error(r.refusal.message)
      return r.sim.approximations.map((a) => a.id)
    }
    const timed = ids(explosiveFixture())
    expect(timed).toEqual(expect.arrayContaining(['explosive-throw', 'gravity', 'explosive-fuse', 'blast-area', 'explosive-consumable', 'classless-crit', 'knockback']))
    expect(timed).not.toContain('blast-falloff')
    expect(timed).not.toContain('explosive-impact')
    expect(timed).not.toContain('square-blast-radius')
    expect(ids(explosiveFixture({ trigger: 'impact', falloff: 'linear' }))).toEqual(expect.arrayContaining(['explosive-impact', 'blast-falloff', 'projectile-point']))
    const modeled = explosiveFixture({ blastRadiusTiles: 7.8, fuseTicks: 300 }, { _prov: { ...fixtureProv(), modeledFields: ['labBehavior.params.blastRadiusTiles'] } })
    expect(Weapon.safeParse(modeled).success).toBe(true)
    expect(ids(modeled)).toContain('square-blast-radius')
  })
})

describe('debuff state for the Debuff Dummy (PRD P3-S11 AC3)', () => {
  it('render state lists each active debuff with its time left and the duration it was (re)applied with', () => {
    const staff = staffFixture({}, { manaCost: 1 }, { dot: { buffId: 'fixture-burn', durationTicks: 120 } })
    const sim = create({ weapon: staff, buffs: [dotBuffFixture(6)], dummies: [{ x: 3, y: 0 }], settings: { ignoreMana: true } })
    sim.setInput({ attacking: true, aim: null })
    sim.step(30) // the first bolt lands well inside 30 ticks
    sim.setInput({ attacking: false })
    const [debuff] = sim.renderState().dummies[0].debuffs
    expect(debuff).toMatchObject({ buffId: 'fixture-burn', durationTicks: 120 })
    expect(debuff.remainingTicks).toBeGreaterThan(0)
    expect(debuff.remainingTicks).toBeLessThanOrEqual(120)
    sim.step(200)
    expect(sim.renderState().dummies[0].debuffs).toEqual([]) // expired
    expect(sim.snapshot().stats.debuffsApplied).toBeGreaterThan(0)
  })
})
