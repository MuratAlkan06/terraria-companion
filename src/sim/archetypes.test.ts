import { describe, expect, it } from 'vitest'
import { APPROXIMATIONS, createLabSim, type LabSim, type LabSimOptions, type SimEvent } from './index'
import { ammoFixture, bowFixture, spearFixture, staffFixture, swordFixture } from './testing/fixtures'

function sim(options: LabSimOptions): LabSim {
  const r = createLabSim(options)
  if (!r.ok) throw new Error(`refused: ${JSON.stringify(r.refusal)}`)
  return r.sim
}

/** Hold attack for `ticks`, collecting every event. */
function hold(s: LabSim, ticks: number, aim: { x: number; y: number } | null = null): SimEvent[] {
  s.setInput({ attacking: true, aim })
  const events: SimEvent[] = []
  for (let i = 0; i < ticks; i++) {
    s.step()
    events.push(...s.drainEvents())
  }
  return events
}

const of = <T extends SimEvent['type']>(events: SimEvent[], type: T) => events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type)
const noVariance = { damageVariance: false } as const

describe('swing-melee', () => {
  it('hits the dummy once per swing at the weapon cadence', () => {
    const s = sim({ weapon: swordFixture(), settings: noVariance })
    hold(s, 600)
    const st = s.snapshot().stats
    expect(st.uses).toBe(30) // useAnimation 20, no autoReuse → cadence 20
    expect(st.hits).toBe(30)
    expect(st.totalDamage).toBe(10 * (st.hits - st.crits) + 20 * st.crits)
    expect(st.lastHit?.amount === 10 || st.lastHit?.amount === 20).toBe(true)
  })

  it('reach is data-driven: a dummy beyond reach is never hit', () => {
    const far = [{ x: 6, y: 0 }] // near face at 5 tiles
    const short = sim({ weapon: swordFixture({}, { reachTiles: 3 }), dummies: far })
    const long = sim({ weapon: swordFixture({}, { reachTiles: 5.5 }), dummies: far })
    hold(short, 120)
    hold(long, 120)
    expect(short.snapshot().stats.hits).toBe(0)
    expect(long.snapshot().stats.hits).toBe(6)
  })

  it('arc is data-driven: a 180° swing reaches a dummy overhead, a 90° swing does not', () => {
    const overhead = [{ x: 0, y: -3.5 }] // box y ∈ [-5, -2], x ∈ [-1, 1]
    const aimRight = { x: 10, y: 0 }
    const wide = sim({ weapon: swordFixture({}, { arcDegrees: 180 }), dummies: overhead })
    const narrow = sim({ weapon: swordFixture({}, { arcDegrees: 90 }), dummies: overhead })
    hold(wide, 60, aimRight)
    hold(narrow, 60, aimRight)
    expect(wide.snapshot().stats.hits).toBe(3)
    expect(narrow.snapshot().stats.hits).toBe(0)
  })

  it('swings toward the facing side (aim to the left hits a dummy on the left)', () => {
    const s = sim({ weapon: swordFixture(), dummies: [{ x: -2, y: 0 }] })
    hold(s, 60)
    expect(s.renderState().facing).toBe(-1)
    expect(s.snapshot().stats.hits).toBe(3)
  })

  it('cadence: useAnimationTicks (B14), one tick sooner for autoswing melee (wiki Use_time)', () => {
    const manual = sim({ weapon: swordFixture({ autoReuse: false, useTimeTicks: 20, useAnimationTicks: 21 }) })
    const auto = sim({ weapon: swordFixture({ autoReuse: true, useTimeTicks: 20, useAnimationTicks: 20 }) })
    expect(manual.weapon.cadenceTicks).toBe(21) // NOT useTimeTicks (20)
    expect(auto.weapon.cadenceTicks).toBe(19)
    hold(manual, 600)
    hold(auto, 600)
    expect(manual.snapshot().stats.uses).toBe(Math.ceil(600 / 21))
    expect(auto.snapshot().stats.uses).toBe(Math.ceil(600 / 19))
  })

  it('emits its projectile on each activation and the projectile can hit beyond blade reach', () => {
    const weapon = swordFixture({ useTimeTicks: 20, useAnimationTicks: 20 }, { emitted: { velocityTps: 30 } })
    const s = sim({ weapon, dummies: [{ x: 10, y: 0 }], settings: noVariance })
    const events = hold(s, 300)
    const st = s.snapshot().stats
    expect(st.projectilesSpawned).toBe(15)
    expect(of(events, 'damage').every((e) => e.source === 'projectile')).toBe(true)
    expect(st.hits).toBeGreaterThanOrEqual(14) // last beam may still be in flight
  })

  it('exposes a sweeping blade pose for the renderer', () => {
    const s = sim({ weapon: swordFixture() })
    s.setInput({ attacking: true })
    s.step(1)
    const a = s.renderState().blade
    s.step(5)
    const b = s.renderState().blade
    expect(a?.kind).toBe('swing')
    expect(b && a && b.angle > a.angle).toBe(true) // facing right: up → down
    expect(a?.length).toBe(3)
  })
})

describe('thrust', () => {
  it('reach differences are observable (P3-S7 AC1)', () => {
    const dummies = [{ x: 3.5, y: 0 }] // near face at 2.5 tiles
    const short = sim({ weapon: spearFixture(2), dummies })
    const long = sim({ weapon: spearFixture(4), dummies })
    hold(short, 200)
    hold(long, 200)
    expect(short.snapshot().stats.hits).toBe(0)
    expect(long.snapshot().stats.hits).toBe(long.snapshot().stats.uses)
    expect(long.snapshot().stats.uses).toBe(10)
  })

  it('thrusts toward the aim point (latched per thrust)', () => {
    const above = [{ x: 0, y: -3 }]
    const atIt = sim({ weapon: spearFixture(3), dummies: above })
    const away = sim({ weapon: spearFixture(3), dummies: above })
    hold(atIt, 100, { x: 0, y: -3 })
    hold(away, 100, { x: 10, y: 0 })
    expect(atIt.snapshot().stats.hits).toBe(5)
    expect(away.snapshot().stats.hits).toBe(0)
  })

  it('extends to full reach mid-thrust and retracts', () => {
    const s = sim({ weapon: spearFixture(4) })
    s.setInput({ attacking: true })
    const lengths: number[] = []
    for (let i = 0; i < 20; i++) {
      s.step()
      lengths.push(s.renderState().blade?.length ?? -1)
    }
    expect(Math.max(...lengths)).toBe(4)
    expect(lengths[19]).toBe(0)
    expect(lengths[0]).toBeLessThan(lengths[5])
  })
})

describe('bow-gun', () => {
  it('counts one ammo per shot and adds ammo damage to weapon damage', () => {
    const s = sim({ weapon: bowFixture(), ammo: ammoFixture({ damage: 5 }), settings: noVariance, dummies: [{ x: 6, y: 0 }] })
    hold(s, 600)
    const st = s.snapshot().stats
    expect(s.weapon.baseHitDamage).toBe(13)
    expect(st.uses).toBe(24)
    expect(st.ammoConsumed).toBe(24)
    expect(st.totalDamage).toBe(13 * (st.hits - st.crits) + 26 * st.crits)
    expect(st.hits).toBe(24)
  })

  it('switching ammo changes damage and projectile speed (P3-S4 AC2)', () => {
    const weak = sim({ weapon: bowFixture(), ammo: ammoFixture({ damage: 5 }) })
    const strong = sim({ weapon: bowFixture(), ammo: ammoFixture({ damage: 10, velocityBonusTps: 6, velocityMultiplier: 2 }) })
    expect(weak.weapon.baseHitDamage).toBe(13)
    expect(strong.weapon.baseHitDamage).toBe(18)
    const speed = (s: LabSim) => {
      const e = of(hold(s, 1), 'projectile-spawn')[0]
      return Math.hypot(e.vx, e.vy)
    }
    expect(speed(weak)).toBeCloseTo(24, 9)
    expect(speed(strong)).toBeCloseTo((24 + 6) * 2, 9)
  })

  it('multi-shot fires projectilesPerUse projectiles in an even spread fan (P3-S4 AC4)', () => {
    const s = sim({ weapon: bowFixture({ projectilesPerUse: 5, spreadDegrees: 20 }), ammo: ammoFixture(), dummies: [] })
    const events = hold(s, 25 * 4)
    const spawns = of(events, 'projectile-spawn')
    expect(s.snapshot().stats.uses).toBe(4)
    expect(spawns).toHaveLength(20)
    expect(s.snapshot().stats.ammoConsumed).toBe(4) // one ammo per shot, not per pellet
    const angles = spawns.slice(0, 5).map((e) => (Math.atan2(e.vy, e.vx) * 180) / Math.PI)
    const expected = [-10, -5, 0, 5, 10]
    angles.forEach((a, i) => expect(a).toBeCloseTo(expected[i], 9))
  })

  it('projectiles travel: the hit lands later the farther the dummy is', () => {
    const firstHitTick = (x: number) => {
      const s = sim({ weapon: bowFixture(), ammo: ammoFixture(), dummies: [{ x, y: 0 }] })
      return of(hold(s, 120), 'damage')[0]?.tick ?? -1
    }
    const near = firstHitTick(4)
    const far = firstHitTick(20)
    expect(near).toBeGreaterThanOrEqual(0)
    // 24 tps = 0.4 tiles/tick; near faces at 3 and 19 tiles → 8 vs 48 ticks of flight.
    expect(near).toBe(7)
    expect(far).toBe(47)
  })

  it('pierce comes from the ammo projectile when inherited', () => {
    const row = [3, 6, 9].map((x, i) => ({ id: `d${i}`, x, y: 0 }))
    const hitsWith = (pierce: number | 'infinite' | undefined, inherit = true) => {
      const ammo = ammoFixture(pierce === undefined ? {} : { projectile: { velocityTps: 1, pierce } })
      const s = sim({ weapon: bowFixture({ inheritsAmmoProjectile: inherit }), ammo, dummies: row })
      s.setInput({ attacking: true })
      s.step(1)
      s.setInput({ attacking: false })
      s.step(120)
      return s.snapshot().stats.hits
    }
    expect(hitsWith(undefined)).toBe(1)
    expect(hitsWith(0)).toBe(1)
    expect(hitsWith(1)).toBe(2)
    expect(hitsWith('infinite')).toBe(3)
    expect(hitsWith('infinite', false)).toBe(1) // weapon's own projectile: no inherited pierce
  })

  it('gravity arcs drop projectiles below a distant dummy (data flag)', () => {
    const dummies = [{ x: 30, y: 0 }]
    const straight = sim({ weapon: bowFixture(), ammo: ammoFixture({ projectile: { velocityTps: 1, gravity: false } }), dummies })
    const arcing = sim({ weapon: bowFixture(), ammo: ammoFixture({ projectile: { velocityTps: 1, gravity: true } }), dummies })
    hold(straight, 100)
    hold(arcing, 100)
    expect(straight.snapshot().stats.hits).toBeGreaterThan(0)
    expect(arcing.snapshot().stats.hits).toBe(0)
  })
})

describe('magic-bolt + mana', () => {
  it('mana depletion (no regen): default slow-casts at 40% speed (AMENDMENTS-008 B35); "block" stops at zero and reports it once', () => {
    // Default = the pinned 1.4.5.8 rule: 5 paid casts, then casts continue at use time × 2.5, paying nothing.
    const d = sim({ weapon: staffFixture(), settings: { maxMana: 50, manaRegen: 'none' } })
    const defaultEvents = hold(d, 600)
    const starts = of(defaultEvents, 'use-start')
    expect(d.snapshot().settings.insufficientMana).toBe('slow-cast')
    expect(starts.slice(0, 5).every((e) => !e.slowCast && e.durationTicks === 20)).toBe(true)
    expect(starts.slice(5).every((e) => e.slowCast && e.durationTicks === 50)).toBe(true)
    expect(starts).toHaveLength(5 + Math.ceil((600 - 100) / 50))
    expect(d.snapshot().stats.manaConsumed).toBe(50)
    expect(d.snapshot().mana).toEqual({ current: 0, max: 50, ignoreMana: false })
    expect(of(defaultEvents, 'use-blocked')).toHaveLength(0)

    // Labeled "stop at zero" test setting.
    const s = sim({ weapon: staffFixture(), settings: { maxMana: 50, manaRegen: 'none', insufficientMana: 'block' } })
    const events = hold(s, 600)
    const snap = s.snapshot()
    expect(snap.stats.uses).toBe(5)
    expect(snap.stats.manaConsumed).toBe(50)
    expect(snap.mana).toEqual({ current: 0, max: 50, ignoreMana: false })
    expect(of(events, 'use-blocked')).toHaveLength(1)
  })

  it('"ignore mana (test mode)" never blocks, keeps the pool full, still counts cost', () => {
    const s = sim({ weapon: staffFixture(), settings: { maxMana: 50, manaRegen: 'none', ignoreMana: true } })
    hold(s, 600)
    const snap = s.snapshot()
    expect(snap.stats.uses).toBe(30)
    expect(snap.stats.manaConsumed).toBe(300)
    expect(snap.mana).toEqual({ current: 50, max: 50, ignoreMana: true })
  })

  it('max mana setting changes capacity (P3-S5 AC1)', () => {
    const uses = (maxMana: number) => {
      const s = sim({ weapon: staffFixture(), settings: { maxMana, manaRegen: 'none', insufficientMana: 'block' } })
      hold(s, 600)
      return s.snapshot().stats.uses
    }
    expect(uses(30)).toBe(3)
    expect(uses(60)).toBe(6)
  })

  it('wiki 1.4.5.7 regen refills mana so casting resumes (configurable regen behavior)', () => {
    const s = sim({ weapon: staffFixture(), settings: { maxMana: 50, insufficientMana: 'block' } })
    hold(s, 600)
    const snap = s.snapshot()
    expect(snap.stats.uses).toBeGreaterThan(5)
    expect(snap.stats.uses).toBeLessThan(30)
    expect(snap.stats.manaConsumed).toBe(snap.stats.uses * 10)
  })

  it('regen rate follows the wiki formula (standing still, not casting)', () => {
    // max 30: rate/s at mana m = (30/3 + 1) × 2 × (m/30 × 0.5 + 0.5) / 2 = 11 × (0.5 + m/60) ≈ 5.5–6.0 /s from empty.
    const s = sim({ weapon: staffFixture(), settings: { maxMana: 30, manaRegen: 'none' } })
    hold(s, 60)
    expect(s.snapshot().mana?.current).toBe(0)
    s.setInput({ attacking: false })
    s.updateSettings({ manaRegen: 'wiki-1.4.5.7' })
    s.step(60)
    const regained = s.snapshot().mana?.current ?? -1
    expect(regained).toBeGreaterThanOrEqual(5)
    expect(regained).toBeLessThanOrEqual(6)
  })

  it('slow-cast policy (1.4.5.7+ rule): out-of-mana casts continue at use time × 2.5, paying nothing', () => {
    const s = sim({ weapon: staffFixture(), settings: { maxMana: 30, manaRegen: 'none', insufficientMana: 'slow-cast' } })
    const events = hold(s, 600)
    const starts = of(events, 'use-start')
    expect(starts.slice(0, 3).every((e) => !e.slowCast && e.durationTicks === 20)).toBe(true)
    expect(starts.slice(3).every((e) => e.slowCast && e.durationTicks === 50)).toBe(true)
    expect(starts).toHaveLength(3 + Math.ceil((600 - 60) / 50))
    expect(s.snapshot().stats.manaConsumed).toBe(30)
  })

  it('two magic bolts differ observably purely from data (speed, count, cost) (P3-S5 AC4)', () => {
    const dummies = [{ x: 12, y: 0 }]
    const a = sim({ weapon: staffFixture({ projectile: { velocityTps: 15 } }, { manaCost: 10 }), dummies, settings: { manaRegen: 'none', maxMana: 100, insufficientMana: 'block' } })
    const b = sim({ weapon: staffFixture({ projectilesPerUse: 3, spreadDegrees: 6, projectile: { velocityTps: 45 } }, { manaCost: 25 }), dummies, settings: { manaRegen: 'none', maxMana: 100, insufficientMana: 'block' } })
    const ea = hold(a, 600)
    const eb = hold(b, 600)
    expect(of(eb, 'damage')[0].tick).toBeLessThan(of(ea, 'damage')[0].tick) // faster bolt lands first
    expect(a.snapshot().stats.uses).toBe(10)
    expect(b.snapshot().stats.uses).toBe(4)
    expect(b.snapshot().stats.projectilesSpawned).toBe(12)
  })

  it('useTime < useAnimation fires multiple times per use (wiki Use_time: Golden Shower 6/18)', () => {
    const s = sim({ weapon: staffFixture({}, { useTimeTicks: 6, useAnimationTicks: 18, manaCost: 5 }), settings: { ignoreMana: true } })
    hold(s, 180)
    const st = s.snapshot().stats
    expect(s.weapon.activationsPerUse).toBe(3)
    expect(st.uses).toBe(10)
    expect(st.activations).toBe(30)
    expect(st.projectilesSpawned).toBe(30)
    expect(st.manaConsumed).toBe(50) // paid once per use
  })
})

describe('reuse delay (AMENDMENTS-010 B48(a); wiki Use_time: "reuseDelay is applied after the itemAnimation counter turns to zero")', () => {
  // Clockwork Assault Rifle shape: useTime 4, useAnimation 12, reuseDelay 14 ("adding 14-tick interval between the three round bursts").
  const rifle = (over = {}) => bowFixture({}, { useTimeTicks: 4, useAnimationTicks: 12, reuseDelayTicks: 14, autoReuse: true, ...over })

  it('the cooldown follows each use: cadence = useAnimation + reuseDelay; no shots during it', () => {
    const s = sim({ weapon: rifle(), ammo: ammoFixture(), settings: noVariance, dummies: [{ x: 6, y: 0 }] })
    expect(s.weapon).toMatchObject({ cadenceTicks: 26, reuseDelayTicks: 14, activationsPerUse: 3 })
    expect(s.weapon.nominalAttacksPerSec).toBeCloseTo(60 / 26, 12)
    const events = hold(s, 600)
    expect(of(events, 'use-start').map((e) => e.tick).slice(0, 4)).toEqual([0, 26, 52, 78])
    expect(of(events, 'use-start').every((e) => e.durationTicks === 12)).toBe(true) // the use itself is not stretched
    expect(of(events, 'projectile-spawn').map((e) => e.tick).slice(0, 6)).toEqual([0, 4, 8, 26, 30, 34])
    expect(s.snapshot().stats.uses).toBe(Math.ceil(600 / 26))
    expect(s.approximations.map((a) => a.id)).toContain('reuse-delay')
  })

  it('weapons without a reuse delay are unchanged (no cooldown, no reuse-delay label)', () => {
    const s = sim({ weapon: rifle({ reuseDelayTicks: undefined }), ammo: ammoFixture() })
    expect(s.weapon).toMatchObject({ cadenceTicks: 12, reuseDelayTicks: 0 })
    hold(s, 120)
    expect(s.snapshot().stats.uses).toBe(10)
    expect(s.approximations.map((a) => a.id)).not.toContain('reuse-delay')
  })

  it('autoswing melee: the −1 tick applies to the use, then the full cooldown follows', () => {
    const s = sim({ weapon: swordFixture({ autoReuse: true, useTimeTicks: 20, useAnimationTicks: 20, reuseDelayTicks: 5 }) })
    expect(s.weapon.cadenceTicks).toBe(24)
    hold(s, 240)
    expect(s.snapshot().stats.uses).toBe(10)
    expect(s.renderState().blade).toBeNull() // tick 240 = 10 × 24: between swings
  })

  it('slow-cast stretches the use (× 2.5) but not the cooldown after it', () => {
    const s = sim({ weapon: staffFixture({}, { useTimeTicks: 12, useAnimationTicks: 12, reuseDelayTicks: 6, manaCost: 500 }), settings: { maxMana: 100, manaRegen: 'none' } })
    const events = hold(s, 200)
    expect(of(events, 'use-start').map((e) => [e.tick, e.durationTicks, e.slowCast])).toEqual([
      [0, 30, true],
      [36, 30, true],
      [72, 30, true],
      [108, 30, true],
      [144, 30, true],
      [180, 30, true],
    ])
    expect(s.approximations.map((a) => a.id)).toEqual(expect.arrayContaining(['slow-cast-cooldown', 'cooldown-mana-regen']))
  })

  it('AMENDMENTS-012 B57(e): the two undocumented cooldown × mana choices are labeled only for a weapon with both', () => {
    const ids = (weapon: LabSimOptions['weapon'], ammo?: LabSimOptions['ammo']) => sim({ weapon, ...(ammo ? { ammo } : {}) }).approximations.map((a) => a.id)
    const B57E = ['slow-cast-cooldown', 'cooldown-mana-regen'] as const
    expect(ids(staffFixture({}, { reuseDelayTicks: 6, manaCost: 5 }))).toEqual(expect.arrayContaining([...B57E]))
    for (const list of [ids(staffFixture({}, { manaCost: 5 })), ids(rifle(), ammoFixture())]) for (const id of B57E) expect(list).not.toContain(id)
    for (const id of B57E) expect(APPROXIMATIONS[id]).toMatchObject({ id, detail: expect.stringMatching(/The wiki does not say .*; this is a Lab choice\.$/) })
  })

  it('a reuse delay listed unverified, or malformed, is refused — never defaulted to 0', () => {
    const listed = rifle({ reuseDelayTicks: undefined, _prov: { ...rifle()._prov, verified: false, unverifiedFields: ['reuseDelayTicks'] } })
    expect(createLabSim({ weapon: listed, ammo: ammoFixture() })).toMatchObject({ ok: false, refusal: { reason: 'unverified-required-field', fields: ['reuseDelayTicks'] } })
    expect(createLabSim({ weapon: rifle({ reuseDelayTicks: 1.5 }), ammo: ammoFixture() })).toMatchObject({ ok: false, refusal: { reason: 'invalid-data', fields: ['reuseDelayTicks'] } })
  })
})

describe('per-projectile damage multiplier (AMENDMENTS-010 B48(b))', () => {
  const hitAmounts = (events: SimEvent[]) => of(events, 'damage').filter((e) => !e.crit).map((e) => e.amount)

  it('magic-bolt: the bolt deals ⌊damage × pct / 100⌋ (wiki: Ruby Staff 50% of 18 = "9 base damage", Sapphire 60% of 18 = "10")', () => {
    for (const [pct, expected] of [[50, 9], [60, 10], [80, 14]] as const) {
      const s = sim({ weapon: staffFixture({ projectile: { velocityTps: 30, damageMultiplierPct: pct } }, { damage: 18 }), settings: { ...noVariance, ignoreMana: true }, dummies: [{ x: 4, y: 0 }] })
      expect(s.weapon.baseHitDamage).toBe(expected)
      expect(new Set(hitAmounts(hold(s, 120)))).toEqual(new Set([expected]))
    }
    const plain = sim({ weapon: staffFixture({}, { damage: 18 }), settings: noVariance })
    expect(plain.weapon.baseHitDamage).toBe(18) // absent = 100%
  })

  it('swing-melee: an emitted projectile uses its own multiplier, the blade keeps full damage', () => {
    const weapon = swordFixture({ damage: 20 }, { emitted: { velocityTps: 30, damageMultiplierPct: 50 } })
    const s = sim({ weapon, settings: noVariance, dummies: [{ x: 10, y: 0 }] })
    expect(s.weapon.baseHitDamage).toBe(20)
    const events = hold(s, 120)
    expect(new Set(of(events, 'damage').filter((e) => e.source === 'projectile' && !e.crit).map((e) => e.amount))).toEqual(new Set([10]))
  })
})

describe('modeling-convention labels (AMENDMENTS-010 B46 / B47, B49 modeledFields)', () => {
  const modeled = <W extends { _prov: object }>(w: W, paths: string[]): W => ({ ...w, _prov: { ...w._prov, modeledFields: paths } })

  it('thrust reach listed as modeled → the B46 label, with its ruling', () => {
    const s = sim({ weapon: modeled(spearFixture(4), ['labBehavior.params.reachTiles']) })
    expect(s.approximations.find((a) => a.id === 'thrust-reach')).toMatchObject({ ruling: 'AMENDMENTS-010 B46', detail: expect.stringMatching(/modeling choice, not game data/) })
    expect(sim({ weapon: spearFixture(4) }).approximations.map((a) => a.id)).not.toContain('thrust-reach') // only when modeled
  })

  it('slight spread listed as modeled → the B47 label', () => {
    const s = sim({ weapon: modeled(bowFixture({ spreadDegrees: 10 }), ['labBehavior.params.spreadDegrees']), ammo: ammoFixture() })
    expect(s.approximations.find((a) => a.id === 'slight-spread')).toMatchObject({ ruling: 'AMENDMENTS-010 B47' })
    expect(sim({ weapon: bowFixture({ spreadDegrees: 45, projectilesPerUse: 8 }), ammo: ammoFixture() }).approximations.map((a) => a.id)).not.toContain('slight-spread')
  })

  it('B44 swing geometry is labeled by the Lab UI, so the engine adds no duplicate entry', () => {
    const s = sim({ weapon: modeled(swordFixture(), ['labBehavior.params.arcDegrees', 'labBehavior.params.reachTiles']) })
    expect(s.approximations.map((a) => a.id)).toEqual(sim({ weapon: swordFixture() }).approximations.map((a) => a.id))
  })

  it('a modeled path no ratified convention governs is refused (never a silent modeled value)', () => {
    const r = createLabSim({ weapon: modeled(spearFixture(4), ['labBehavior.params.reachTiles', 'damage']) })
    expect(r).toMatchObject({ ok: false, refusal: { kind: 'not-simulable', reason: 'invalid-data', fields: ['damage'] } })
    const wrongArchetype = createLabSim({ weapon: modeled(swordFixture(), ['labBehavior.params.spreadDegrees']) })
    expect(wrongArchetype).toMatchObject({ ok: false, refusal: { reason: 'invalid-data' } })
  })
})
