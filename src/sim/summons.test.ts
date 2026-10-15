/**
 * P3-S9 (minion-sentry: minions + sentries) and P3-S10 (whips + tag synergy) engine behavior.
 * Fixture weapons (testing/fixtures.ts), never game data; expectations derive from the fixture params
 * (slot cost, attack interval, range, tag damage, multihit penalty), not hand-tuned.
 */
import { describe, expect, it } from 'vitest'
import { APPROXIMATIONS, createLabSim, dummyRow, WHIP_TAG_DURATION_TICKS, type LabSim, type LabSimOptions, type SimEvent } from './index'
import { DEFAULT_MINION_SLOTS, DEFAULT_SENTRY_SLOTS, MAX_MINION_SLOTS, MAX_SENTRY_SLOTS } from './constants'
import { whipHitDamage } from './interpreters/whip'
import { dotBuffFixture, summonFixture, swordFixture, whipFixture } from './testing/fixtures'

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

/** A press of `ticks` then a release (one tick), like a click held that long. */
const click = (s: LabSim, aim: { x: number; y: number } | null = null, ticks = 1) => [...run(s, ticks, { attacking: true, aim }), ...run(s, 1, { attacking: false, aim })]

const of = <T extends SimEvent['type']>(events: SimEvent[], type: T) => events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type)
const noVariance = { damageVariance: false } as const
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const SENTRY = { variant: 'sentry', aiClass: 'ranged-shot', sentryRangeTiles: 8 } as const

describe('slots (PRD P3-S9 AC1: summoning again respects the slot settings)', () => {
  it('defaults are the wiki’s: one minion slot, one sentry slot; the settings range over the gear maximums (11 / 6)', () => {
    const s = sim({ weapon: summonFixture() })
    expect(s.snapshot().settings).toMatchObject({ minionSlots: DEFAULT_MINION_SLOTS, sentrySlots: DEFAULT_SENTRY_SLOTS })
    expect([DEFAULT_MINION_SLOTS, MAX_MINION_SLOTS, DEFAULT_SENTRY_SLOTS, MAX_SENTRY_SLOTS]).toEqual([1, 11, 1, 6])
    expect(s.updateSettings({ minionSlots: 11, sentrySlots: 6 }).ok).toBe(true)
    for (const bad of [{ minionSlots: 0 }, { minionSlots: 12 }, { sentrySlots: 7 }, { minionSlots: 1.5 }]) expect(s.updateSettings(bad)).toMatchObject({ ok: false, reason: 'invalid-settings' })
  })

  it('a press summons one minion; held, it summons no more once the slots are full; a new press replaces the oldest', () => {
    const s = sim({ weapon: summonFixture() })
    const first = run(s, 120, { attacking: true, aim: { x: 3, y: -2 } })
    expect(of(first, 'summon')).toMatchObject([{ agentId: 1, kind: 'minion', x: 3, y: -2, loadout: false }]) // at the click point
    expect(s.snapshot().stats.uses).toBe(1) // held for 2 s: no re-summon with the slot taken
    expect(s.snapshot().summons).toMatchObject({ minions: 1, minionSlotsUsed: 1, minionSlots: 1 })
    run(s, 1, { attacking: false })
    const again = run(s, 40, { attacking: true, aim: { x: -3, y: -1 } })
    expect(of(again, 'dismiss')).toMatchObject([{ agentId: 1, reason: 'replaced' }])
    expect(of(again, 'summon')).toMatchObject([{ agentId: 2, x: -3, y: -1 }])
    expect(s.snapshot().summons.minions).toBe(1)
    expect(s.renderState().agents.map((a) => a.id)).toEqual([2])
  })

  it('more slots: held attack fills them one use at a time (use 36 + reuse 2 ticks), then stops; the next press replaces the oldest', () => {
    const s = sim({ weapon: summonFixture(), settings: { minionSlots: 3 } })
    const events = run(s, 200, { attacking: true })
    expect(of(events, 'summon').map((e) => e.tick)).toEqual([0, 38, 76])
    expect(s.snapshot().summons).toMatchObject({ minions: 3, minionSlotsUsed: 3 })
    run(s, 1, { attacking: false })
    const again = run(s, 2, { attacking: true })
    expect(of(again, 'dismiss')).toMatchObject([{ agentId: 1, reason: 'replaced' }])
    expect(s.renderState().agents.map((a) => a.id)).toEqual([2, 3, 4])
  })

  it('slot cost counts: a 2-slot minion fills 2 of 3 slots; one costing more than every slot is never summoned', () => {
    const big = sim({ weapon: summonFixture({ slotCost: 2 }), settings: { minionSlots: 3 } })
    run(big, 200, { attacking: true })
    expect(big.snapshot().summons).toMatchObject({ minions: 1, minionSlotsUsed: 2, minionSlots: 3 })
    const tooBig = sim({ weapon: summonFixture({ slotCost: 2 }) })
    const events = run(tooBig, 60, { attacking: true })
    expect(of(events, 'summon')).toEqual([])
    expect(tooBig.snapshot().summons.minions).toBe(0)
    const halves = sim({ weapon: summonFixture({ slotCost: 0.5 }), settings: { minionSlots: 2 } })
    run(halves, 300, { attacking: true })
    expect(halves.snapshot().summons).toMatchObject({ minions: 4, minionSlotsUsed: 2 })
  })

  it('sentries have their own slots; lowering a slot setting dismisses the oldest beyond it', () => {
    const s = sim({ weapon: summonFixture(SENTRY), settings: { sentrySlots: 3 } })
    run(s, 200, { attacking: true })
    expect(s.snapshot().summons).toMatchObject({ minions: 0, sentries: 3, sentrySlotsUsed: 3, sentrySlots: 3 })
    expect(s.updateSettings({ sentrySlots: 1 }).ok).toBe(true)
    expect(of(s.drainEvents(), 'dismiss')).toMatchObject([
      { agentId: 1, reason: 'slots' },
      { agentId: 2, reason: 'slots' },
    ])
    expect(s.renderState().agents.map((a) => a.id)).toEqual([3])
  })

  it('PRD P3-S9 AC4: reset clears every minion and sentry instantly (and a minion loadout is summoned afresh)', () => {
    const s = sim({ weapon: summonFixture(), settings: { minionSlots: 2 } })
    run(s, 100, { attacking: true })
    expect(s.renderState().agents).toHaveLength(2)
    s.reset()
    expect(s.renderState().agents).toEqual([])
    expect(s.snapshot().summons.minions).toBe(0)
    const loadout = sim({ weapon: whipFixture(), minionLoadout: summonFixture(), settings: { minionSlots: 3 } })
    expect(loadout.renderState().agents.map((a) => a.loadout)).toEqual([true, true, true])
    run(loadout, 50, { attacking: false })
    loadout.reset()
    expect(loadout.renderState().agents.map((a) => a.id)).toEqual([1, 2, 3])
    expect(loadout.snapshot().stats.totalDamage).toBe(0)
  })
})

describe('autonomous attacks (PRD P3-S9 AC1/AC3)', () => {
  it('a minion attacks on its own once per attack interval — the first one interval after it appears — attributed as a minion source', () => {
    const s = sim({ weapon: summonFixture({ attackRateTicks: 12 }), settings: noVariance })
    const events = [...click(s), ...run(s, 120, { attacking: false })]
    const hits = of(events, 'damage')
    expect(hits.map((e) => e.tick)).toEqual([12, 24, 36, 48, 60, 72, 84, 96, 108, 120])
    expect(hits.every((e) => e.source === 'minion' && e.sourceId === 'minion:1' && e.amount === 10 && !e.crit)).toBe(true)
    const snap = s.snapshot()
    expect(snap.stats).toMatchObject({ hits: 10, totalDamage: 100, uses: 1 })
    expect(snap.stats.breakdown).toEqual({ weaponDamage: 0, weaponHits: 0, summonDamage: 100, summonHits: 10, tagBonusDamage: 0, dotDamage: 0 })
    expect(sum(snap.stats.dpsSeries) + snap.stats.currentSecondDamage).toBe(100) // in the live graph like any source
  })

  it('B17: summon damage never crits without a whip tag (thousands of hits with variance)', () => {
    const s = sim({ weapon: summonFixture({ attackRateTicks: 1 }), settings: { minionSlots: 4 }, dummies: dummyRow(2, 6) })
    run(s, 3000, { attacking: true })
    const stats = s.snapshot().stats
    expect(stats.hits).toBeGreaterThan(9000)
    expect(stats.crits).toBe(0)
  })

  it('a minion weapon’s debuff (DoT) applies on its minions’ hits', () => {
    const s = sim({ weapon: summonFixture({ aiClass: 'ranged-shot', attackRateTicks: 30 }, {}, { dot: { buffId: 'fixture-burn', durationTicks: 120 } }), buffs: [dotBuffFixture(6)] })
    const events = [...click(s), ...run(s, 200, { attacking: false })]
    expect(of(events, 'debuff-applied').length).toBe(of(events, 'damage').filter((e) => e.source === 'minion').length)
    expect(s.snapshot().stats.breakdown.dotDamage).toBeGreaterThan(0)
  })
})

describe('AI classes (AMENDMENTS-013 B63 P-6): each class behaves observably differently', () => {
  const path = (aiClass: 'melee-contact' | 'ground-melee' | 'hover-strike' | 'ranged-shot') => {
    const s = sim({ weapon: summonFixture({ aiClass, attackRateTicks: 20 }), dummies: [{ x: 6, y: 0 }], settings: noVariance })
    click(s)
    run(s, 40, { attacking: false }) // past its first approach
    const poses: { x: number; y: number }[] = []
    const hits: { x: number; y: number }[] = []
    for (let i = 0; i < 60; i++) {
      for (const e of run(s, 1, { attacking: false })) if (e.type === 'damage') hits.push({ x: e.x, y: e.y })
      const a = s.renderState().agents[0]
      poses.push({ x: a.x, y: a.y })
    }
    return { poses, hits, approximations: s.approximations.map((a) => a.id) }
  }
  const box = { minX: 5, maxX: 7, minY: -1.5, maxY: 1.5 }
  const xs = (ps: { x: number }[]) => ps.map((p) => p.x)
  const ys = (ps: { y: number }[]) => ps.map((p) => p.y)

  it('melee-contact loops above the dummy and dives through its centre, hitting as it passes', () => {
    const { poses, hits, approximations } = path('melee-contact')
    expect(hits).toHaveLength(3)
    for (const h of hits) expect([h.x, h.y].map((v) => Math.round(v * 1e9) / 1e9)).toEqual([6, 0])
    expect(Math.min(...ys(poses))).toBeLessThan(box.minY - 1) // above the dummy
    expect(Math.min(...xs(poses))).toBeLessThan(box.minX) // and on both sides of it
    expect(Math.max(...xs(poses))).toBeGreaterThan(box.maxX)
    expect(approximations).toContain('minion-melee-contact')
  })

  it('ground-melee stays on the ground at the near side, hopping into the dummy’s face', () => {
    const { poses, hits, approximations } = path('ground-melee')
    for (const h of hits) expect([h.x, h.y].map((v) => Math.round(v * 1e9) / 1e9)).toEqual([box.minX, box.maxY - 0.5])
    expect(Math.max(...ys(poses))).toBeCloseTo(box.maxY - 0.5, 9) // feet on the dummy's foot line
    expect(Math.min(...ys(poses))).toBeGreaterThanOrEqual(box.maxY - 1.5 - 1e-9) // a hop, never higher
    expect(Math.max(...xs(poses))).toBeLessThanOrEqual(box.minX) // never past the face
    expect(approximations).toContain('minion-ground-melee')
  })

  it('hover-strike hovers beside the dummy at chest height and lunges to its face to strike', () => {
    const { poses, hits, approximations } = path('hover-strike')
    for (const h of hits) expect(h.x).toBe(box.minX)
    expect(Math.max(...ys(poses))).toBeLessThan(0) // above the centre line, in the air
    expect(Math.min(...ys(poses))).toBeGreaterThan(box.minY - 1.5)
    expect(Math.min(...xs(poses))).toBeGreaterThan(box.minX - 2)
    expect(Math.max(...xs(poses))).toBeLessThan(box.minX)
    expect(approximations).toContain('minion-hover-strike')
  })

  it('ranged-shot stays by the player and shoots: hits land on the dummy’s edge facing it', () => {
    const { poses, hits, approximations } = path('ranged-shot')
    for (const p of poses) expect(Math.abs(p.x)).toBeLessThan(2.5) // near the player at x = 0, not at the dummy
    for (const h of hits) expect(h.x).toBe(box.minX)
    expect(approximations).toContain('minion-ranged-shot')
  })

  it('a ranged summon with a projectile speed shoots kernel projectiles of its own kind', () => {
    const s = sim({ weapon: summonFixture({ aiClass: 'ranged-shot', attackRateTicks: 30, projectile: { velocityTps: 30 } }), settings: noVariance })
    const events = [...click(s), ...run(s, 120, { attacking: false })]
    expect(of(events, 'projectile-spawn').length).toBeGreaterThan(2)
    const hits = of(events, 'damage')
    expect(hits.length).toBeGreaterThan(1)
    expect(hits.every((e) => e.source === 'minion' && e.sourceId.startsWith('proj:'))).toBe(true)
  })
})

describe('sentries (PRD P3-S9 AC2: stationary at the click point, attacking in range)', () => {
  it('stands exactly where it was placed, never moving, and attacks only dummies within its range', () => {
    const s = sim({ weapon: summonFixture({ ...SENTRY, attackRateTicks: 15 }), dummies: dummyRow(4, 4), settings: noVariance })
    const events = [...click(s, { x: 1, y: -1 }), ...run(s, 300, { attacking: false })]
    expect(of(events, 'summon')).toMatchObject([{ kind: 'sentry', x: 1, y: -1 }])
    for (let i = 0; i < 30; i++) {
      run(s, 1, { attacking: false })
      expect(s.renderState().agents[0]).toMatchObject({ x: 1, y: -1, prevX: 1, prevY: -1 })
    }
    const hit = new Set(of(events, 'damage').map((e) => e.dummyId))
    // centres 4, 7, 10, 13 at y 0 from (1, −1): distances 3.2, 6.1, 9.1, 12.0 — range 8
    expect([...hit]).toEqual(['dummy-0'])
    expect(of(events, 'damage').every((e) => e.source === 'sentry' && e.sourceId === 'sentry:1')).toBe(true)
  })

  it('no dummy in range: it never attacks', () => {
    const s = sim({ weapon: summonFixture(SENTRY), dummies: [{ x: 20, y: 0 }] })
    const events = [...click(s, { x: -10, y: 0 }), ...run(s, 300, { attacking: false })]
    expect(of(events, 'damage')).toEqual([])
    expect(s.renderState().agents[0].targetId).toBeNull()
  })

  it('placed with Space (auto-aim): 2 tiles in front of the player', () => {
    const s = sim({ weapon: summonFixture(SENTRY) })
    expect(of(click(s, null), 'summon')).toMatchObject([{ kind: 'sentry', x: 2, y: 0 }])
  })
})

describe('whips (PRD P3-S10 AC1: an arc with data-driven range, tagging struck dummies)', () => {
  it('multihit penalty: each further dummy takes the penalty off the previous hit, rounded down (wiki Whips)', () => {
    expect([0, 1, 2, 3, 4].map((n) => whipHitDamage(14, 0.5, n))).toEqual([14, 7, 3, 1, 0])
    expect([0, 1, 2].map((n) => whipHitDamage(160, 0.05, n))).toEqual([160, 152, 144])
    expect(whipHitDamage(29, undefined, 3)).toBe(29)
  })

  it('one swing hits every dummy within its range once, nearest first, each further one with the penalty; beyond range never', () => {
    const s = sim({ weapon: whipFixture({ rangeTiles: 11, falloffPerTarget: 0.5 }), dummies: dummyRow(4, 4), settings: noVariance })
    const events = run(s, 30, { attacking: true }) // exactly one use (use time 30)
    const hits = of(events, 'damage')
    expect(hits.map((e) => [e.dummyId, e.amount, e.source, e.crit])).toEqual([
      ['dummy-0', 14, 'melee', false],
      ['dummy-1', 7, 'melee', false],
      ['dummy-2', 3, 'melee', false],
    ]) // dummy-3 (box from x = 12) is past the 11-tile range
    expect(s.renderState().blade).toMatchObject({ kind: 'whip', length: 11, arcDegrees: 180 })
  })

  it('a dummy the penalty would deal 0 to is not hit (nor tagged)', () => {
    const s = sim({ weapon: whipFixture({ rangeTiles: 30, falloffPerTarget: 0.5 }), dummies: dummyRow(5, 4), settings: noVariance })
    const events = run(s, 30, { attacking: true })
    expect(of(events, 'damage').map((e) => e.amount)).toEqual([14, 7, 3, 1])
    expect(of(events, 'tag-applied').map((e) => e.dummyId)).toEqual(['dummy-0', 'dummy-1', 'dummy-2', 'dummy-3'])
  })

  it('tags each struck dummy for the wiki’s 4 seconds; a new strike restarts it; whip hits never crit (summon damage)', () => {
    expect(WHIP_TAG_DURATION_TICKS).toBe(240)
    const s = sim({ weapon: whipFixture(), dummies: [{ x: 6, y: 0 }] })
    const swing = run(s, 30, { attacking: true })
    const [tag] = of(swing, 'tag-applied')
    expect(tag).toMatchObject({ dummyId: 'dummy-0', durationTicks: 240, refreshed: false })
    expect(s.renderState().dummies[0].tag).toMatchObject({ durationTicks: 240, damageFlat: 4, critPct: null })
    const rest = run(s, 300, { attacking: false })
    expect(of(rest, 'tag-expired')).toEqual([expect.objectContaining({ dummyId: 'dummy-0', tick: tag.tick + 239 })]) // tagged ticks t … t + 239
    expect(s.renderState().dummies[0].tag).toBeNull()
    const again = run(s, 60, { attacking: true })
    expect(of(again, 'tag-applied').map((e) => e.refreshed)).toEqual([false, true])
    const crits = run(s, 3000, { attacking: true })
    expect(of(crits, 'damage').some((e) => e.crit)).toBe(false)
  })
})

describe('tag synergy (PRD P3-S10 AC2/AC3: minion hits on tagged dummies, the summoner loop)', () => {
  const loop = (whip: Parameters<typeof whipFixture>[0] = {}, extra: Partial<LabSimOptions> = {}) =>
    sim({ weapon: whipFixture({ tagDamageFlat: 4, ...whip }), minionLoadout: summonFixture({ aiClass: 'melee-contact', attackRateTicks: 12 }), dummies: [{ x: 6, y: 0 }], settings: noVariance, ...extra })

  it('tagged: every minion hit adds the tag damage (its tagBonus); untagged hits have none', () => {
    const s = loop()
    const before = run(s, 30, { attacking: false }) // no whip yet
    expect(of(before, 'damage').map((e) => [e.amount, e.tagBonus])).toEqual([[10, undefined], [10, undefined]])
    const tagged = run(s, 60, { attacking: true })
    const minionHits = of(tagged, 'damage').filter((e) => e.source === 'minion')
    const tagTick = of(tagged, 'tag-applied')[0].tick
    for (const e of minionHits) expect([e.amount, e.tagBonus]).toEqual(e.tick >= tagTick ? [14, 4] : [10, undefined])
    expect(minionHits.some((e) => e.tagBonus === 4)).toBe(true)
  })

  it('tag critical strike chance: the only way summon hits crit (100% → every tagged hit crits; its bonus includes the doubling)', () => {
    const s = loop({ tagCritPct: 100 })
    run(s, 30, { attacking: true })
    const hits = of(run(s, 120, { attacking: true }), 'damage').filter((e) => e.source === 'minion')
    expect(hits.length).toBeGreaterThan(5)
    for (const e of hits) expect([e.amount, e.crit, e.tagBonus]).toEqual([28, true, 18])
    // whips without a tag crit chance: never
    const plain = loop({ tagCritPct: undefined }, { settings: {} })
    expect(of(run(plain, 2000, { attacking: true }), 'damage').some((e) => e.crit)).toBe(false)
  })

  it('combined DPS is attributed by source: whip + minions (+ tag bonus within) + DoT = total, live and in a timed test', () => {
    const s = loop({ tagDamageFlat: 6, tagCritPct: 10 }, { settings: { minionSlots: 3 }, dummies: dummyRow(3, 6) })
    s.startTimedTest(10)
    s.step(600)
    const result = s.snapshot().timedTest.result
    if (!result) throw new Error('no result')
    const b = result.breakdown
    expect(b.weaponDamage + b.summonDamage + b.dotDamage).toBe(result.totalDamage)
    expect(b.weaponHits + b.summonHits).toBe(result.hits)
    expect(b.weaponDamage).toBeGreaterThan(0)
    expect(b.summonDamage).toBeGreaterThan(b.weaponDamage)
    expect(b.tagBonusDamage).toBeGreaterThan(0)
    expect(b.tagBonusDamage).toBeLessThan(b.summonDamage)
    expect(sum(Object.values(result.perDummy).map((d) => d.damage))).toBe(result.totalDamage)
    expect(result.estimatedDps).toBe(result.totalDamage / 10)
  })

  it('minions switch to the dummy the whip struck last (whip focus)', () => {
    // the whip reaches only the far dummy when aimed… it swings in front, so put the near dummy behind the player
    const s = sim({ weapon: whipFixture({ rangeTiles: 8 }), minionLoadout: summonFixture({ attackRateTicks: 12 }), dummies: [{ id: 'behind', x: -4, y: 0 }, { id: 'front', x: 6, y: 0 }] })
    run(s, 30, { attacking: false, aim: { x: 6, y: 0 } })
    expect(s.renderState().agents[0].targetId).toBe('behind') // nearest to the player
    run(s, 40, { attacking: true, aim: { x: 6, y: 0 } })
    expect(s.renderState().agents[0].targetId).toBe('front')
    const later = run(s, 60, { attacking: false, aim: { x: 6, y: 0 } })
    expect(of(later, 'damage').every((e) => e.dummyId === 'front')).toBe(true)
  })

  it('the loadout’s approximations join the weapon’s (its class model and slots), and the loadout summary is exposed', () => {
    const s = loop()
    const ids = s.approximations.map((a) => a.id)
    for (const id of ['whip-swing', 'whip-tag', 'summon-slots', 'summon-attack', 'minion-melee-contact']) expect(ids).toContain(id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(s.loadout).toMatchObject({ name: 'Fixture Minion Staff', archetype: 'minion-sentry', critChancePct: 0 })
    expect(sim({ weapon: swordFixture() }).loadout).toBeNull()
    expect(APPROXIMATIONS['whip-tag'].detail).toContain('4 seconds')
    expect(APPROXIMATIONS['summon-hit-cap'].detail).toContain('maximum rate; actual depends on minion AI pathing')
  })
})
