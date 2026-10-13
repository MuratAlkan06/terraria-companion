/**
 * Integration with COMMITTED data (src/data/weapons.detail.json, read-only).
 *
 * Core combat numbers come from the committed records. The Lab archetype params are TEST
 * FIXTURES: no committed weapon carries archetype params yet (P3-S0 authors them), so each test
 * swaps in fixture params and re-validates the record with the real Weapon schema. Expectations
 * are computed from the records, never hard-coded, so a data refresh can't silently pass/fail.
 */
import { describe, expect, it } from 'vitest'
import weaponsDetailJson from '../data/weapons.detail.json'
import { getField, Weapon, type ArchetypeParams } from '../schemas'
import { assessWeapon, createLabSim, type LabSim, type LabSimOptions } from './index'
import { ammoFixture } from './testing/fixtures'

const COPPER_BROADSWORD = 3508
const GOLD_BROADSWORD = 3520
const WOODEN_BOW = 39

const committed = weaponsDetailJson as unknown as readonly Weapon[]

function committedWeapon(id: number): Weapon {
  const raw = committed.find((w) => w.id === id)
  if (!raw) throw new Error(`committed weapon ${id} is missing from weapons.detail.json`)
  const weapon = Weapon.parse(raw)
  for (const f of ['damage', 'critPct', 'useTimeTicks', 'useAnimationTicks', 'damageClass']) {
    if (getField(weapon, f).status !== 'verified') throw new Error(`committed weapon ${id}: ${f} is not verified`)
  }
  return weapon
}

/** Committed record + FIXTURE archetype params (schema re-validated). */
const withFixtureLab = (weapon: Weapon, params: ArchetypeParams): Weapon => Weapon.parse({ ...weapon, labBehavior: { kind: 'archetype', params } })

function create(options: LabSimOptions): LabSim {
  const r = createLabSim(options)
  if (!r.ok) throw new Error(`refused: ${JSON.stringify(r.refusal)}`)
  return r.sim
}

function timed10(options: LabSimOptions) {
  const sim = create(options)
  sim.startTimedTest(10)
  sim.step(600)
  const result = sim.snapshot().timedTest.result
  if (!result) throw new Error('missing result')
  return { sim, result }
}

describe('every committed weapon gets a typed verdict (never a throw, never a guess)', () => {
  it('assessWeapon + createLabSim classify all records', () => {
    expect(committed.length).toBeGreaterThan(0)
    const buckets: Record<string, number> = {}
    for (const raw of committed) {
      const weapon = Weapon.parse(raw)
      const verdict = assessWeapon(weapon)
      const key = verdict.simulable ? `simulable:${verdict.archetype}` : verdict.refusal.reason
      buckets[key] = (buckets[key] ?? 0) + 1
      if (!verdict.simulable && weapon.labBehavior.kind === 'limitation') {
        expect(verdict.refusal.limitation).toEqual({
          inGameBehavior: weapon.labBehavior.inGameBehavior,
          reason: weapon.labBehavior.reason,
          sourceUrl: weapon.labBehavior.sourceUrl,
        })
      }
      const created = createLabSim({ weapon })
      if (!verdict.simulable) expect(created.ok).toBe(false)
    }
    expect(Object.values(buckets).reduce((a, b) => a + b, 0)).toBe(committed.length)
  })

  it('the committed Wooden Bow, as emitted, is refused with its own limitation card', () => {
    const weapon = committedWeapon(WOODEN_BOW)
    if (weapon.labBehavior.kind !== 'limitation') return // P3-S0 may have assigned params; covered above
    const r = createLabSim({ weapon })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.refusal).toMatchObject({ kind: 'not-simulable', reason: 'limitation', weaponId: WOODEN_BOW })
  })
})

describe('two committed broadswords differ purely from data (P3-S1 AC4)', () => {
  const SAME_FIXTURE_PARAMS: ArchetypeParams = { archetype: 'swing-melee', arcDegrees: 160, reachTiles: 3 }
  const copper = withFixtureLab(committedWeapon(COPPER_BROADSWORD), SAME_FIXTURE_PARAMS)
  const gold = withFixtureLab(committedWeapon(GOLD_BROADSWORD), SAME_FIXTURE_PARAMS)

  it('cadence = useAnimationTicks per B14 (Copper Broadsword: useTime 20 ≠ useAnimation 21)', () => {
    for (const w of [copper, gold]) {
      const sim = create({ weapon: w })
      const expected = w.damageClass === 'melee' && w.autoReuse === true ? (w.useAnimationTicks as number) - 1 : (w.useAnimationTicks as number)
      expect(sim.weapon.cadenceTicks).toBe(expected)
      expect(sim.weapon.nominalAttacksPerSec).toBeCloseTo(60 / expected, 12)
    }
    if (copper.useTimeTicks !== copper.useAnimationTicks) {
      expect(create({ weapon: copper }).weapon.cadenceTicks).not.toBe(copper.useTimeTicks)
    }
  })

  it('speed, damage and DPS change observably between the two', () => {
    const settings = { damageVariance: false }
    const a = timed10({ weapon: copper, settings })
    const b = timed10({ weapon: gold, settings })
    for (const [run, w] of [[a, copper], [b, gold]] as const) {
      const cadence = run.sim.weapon.cadenceTicks
      expect(run.result.uses).toBe(Math.ceil(600 / cadence))
      expect(run.result.hits).toBe(run.result.uses) // point-blank dummy within 3 tiles
      const dmg = w.damage as number
      expect(run.result.totalDamage).toBe(dmg * (run.result.hits - run.result.crits) + 2 * dmg * run.result.crits)
    }
    expect(a.sim.weapon.damage).not.toBe(b.sim.weapon.damage)
    expect(a.sim.weapon.cadenceTicks).not.toBe(b.sim.weapon.cadenceTicks)
    expect(b.result.estimatedDps).toBeGreaterThan(a.result.estimatedDps)
  })

  it('arc and reach come from params: the same committed sword with a longer reach hits a farther dummy', () => {
    const base = committedWeapon(COPPER_BROADSWORD)
    const dummies = [{ x: 5, y: 0 }] // near face at 4 tiles
    const short = timed10({ weapon: withFixtureLab(base, { archetype: 'swing-melee', arcDegrees: 160, reachTiles: 3 }), dummies })
    const long = timed10({ weapon: withFixtureLab(base, { archetype: 'swing-melee', arcDegrees: 160, reachTiles: 4.5 }), dummies })
    expect(short.result.hits).toBe(0)
    expect(long.result.hits).toBe(long.result.uses)
  })
})

describe('committed Wooden Bow + fixture arrow (P3-S4 ammo math)', () => {
  const bowRecord = committedWeapon(WOODEN_BOW)
  const ammoClass = bowRecord.ammoClass as string
  const bow = withFixtureLab(bowRecord, { archetype: 'bow-gun', ammoClass, projectilesPerUse: 1, spreadDegrees: 0, inheritsAmmoProjectile: true })
  const arrow = ammoFixture({ ammoClass, damage: 5, velocityBonusTps: 11.25 }) // FIXTURE values

  it('per-hit damage = weapon + ammo; speed = weapon shoot speed + ammo bonus; one arrow per shot', () => {
    const { sim, result } = timed10({ weapon: bow, ammo: arrow, settings: { damageVariance: false }, dummies: [{ x: 8, y: 0 }] })
    const perHit = (bowRecord.damage as number) + 5
    expect(sim.weapon.baseHitDamage).toBe(perHit)
    expect(sim.weapon.cadenceTicks).toBe(bowRecord.useAnimationTicks)
    expect(result.ammoConsumed).toBe(result.uses)
    expect(result.uses).toBe(Math.ceil(600 / (bowRecord.useAnimationTicks as number)))
    expect(result.totalDamage).toBe(perHit * (result.hits - result.crits) + 2 * perHit * result.crits)
    sim.reset()
    sim.setInput({ attacking: true })
    sim.step(1)
    const p = sim.renderState().projectiles[0]
    expect(Math.hypot(p.vx, p.vy)).toBeCloseTo((bowRecord.shootSpeedTps as number) + 11.25, 9)
  })

  it('refuses ammo of another class with a typed setup error', () => {
    const r = createLabSim({ weapon: bow, ammo: ammoFixture({ ammoClass: 'musket-ball' }) })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.refusal).toMatchObject({ kind: 'invalid-setup', reason: 'ammo-incompatible' })
  })
})
