import { describe, expect, it } from 'vitest'
import { Buff, Item, MODELING_CONVENTIONS, Weapon, type ArchetypeParams } from '../schemas'
import { APPROXIMATIONS, CONVENTION_APPROXIMATIONS } from './approximations'
import { assessWeapon, createLabSim, type SimRefusal } from './index'
import { modifierEntry, NotImplementedError } from './modifiers'
import {
  ammoFixture,
  beamFixture,
  bowFixture,
  dotBuffFixture,
  fixtureProv,
  fixtureWeapon,
  returningFixture,
  spearFixture,
  staffFixture,
  summonFixture,
  swordFixture,
  whipFixture,
} from './testing/fixtures'

const refusalOf = (r: ReturnType<typeof createLabSim>): SimRefusal => {
  if (r.ok) throw new Error('expected a refusal, got a sim')
  return r.refusal
}

const notSimulable = (weapon: Weapon) => {
  const v = assessWeapon(weapon)
  if (v.simulable) throw new Error('expected not-simulable')
  return v.refusal
}

describe('fixtures are schema-conformant (real Zod schemas)', () => {
  it.each([
    ['sword', swordFixture()],
    ['spear', spearFixture(3)],
    ['bow', bowFixture()],
    ['staff', staffFixture()],
    ['boomerang', returningFixture({ variant: 'boomerang' })],
    ['flail', returningFixture({ variant: 'flail', hitsPerPass: 1 })],
    ['yoyo', returningFixture({ variant: 'yoyo', throwRangeTiles: 8 })],
    ['channel beam', beamFixture({ mode: 'channel-beam', tickRateTicks: 6 })],
    ['pierce bolt', beamFixture({ mode: 'pierce-projectile', pierce: 'infinite', projectile: { velocityTps: 30 } })],
    ['minion', summonFixture()],
    ['sentry', summonFixture({ variant: 'sentry', aiClass: 'ranged-shot', sentryRangeTiles: 20 })],
    ['whip', whipFixture({ tagCritPct: 10 })],
    ['staff+dot+homing', staffFixture({}, {}, { dot: { buffId: 'fixture-burn', durationTicks: { minTicks: 60, maxTicks: 240 } }, homing: { strength: 0.2, acquisitionRangeTiles: 20 } })],
  ])('%s parses as Weapon', (_name, weapon) => {
    expect(Weapon.safeParse(weapon).success).toBe(true)
  })
  it('ammo + buff fixtures parse', () => {
    expect(Item.safeParse(ammoFixture({ projectile: { velocityTps: 10, pierce: 'infinite' } })).success).toBe(true)
    expect(Buff.safeParse(dotBuffFixture()).success).toBe(true)
  })
})

describe('honesty guard — NotSimulable, never a guess', () => {
  it('limitation weapons are refused with the card payload passed through', () => {
    const weapon = fixtureWeapon(
      { archetype: 'thrust', reachTiles: 2 },
      {
        labBehavior: {
          kind: 'limitation',
          inGameBehavior: 'Fires a homing skull.',
          reason: 'Not simulated yet.',
          sourceUrl: 'https://terraria.wiki.gg/wiki/Book_of_Skulls',
        },
      },
    )
    const refusal = notSimulable(weapon)
    expect(refusal.reason).toBe('limitation')
    expect(refusal.limitation).toEqual({
      inGameBehavior: 'Fires a homing skull.',
      reason: 'Not simulated yet.',
      sourceUrl: 'https://terraria.wiki.gg/wiki/Book_of_Skulls',
    })
    expect(refusalOf(createLabSim({ weapon }))).toMatchObject({ kind: 'not-simulable', reason: 'limitation', weaponId: weapon.id })
  })

  it('custom-scenario weapons are refused with their scenario id', () => {
    const weapon = fixtureWeapon({ archetype: 'thrust', reachTiles: 2 }, { labBehavior: { kind: 'custom-scenario', scenarioId: 'night-only' } })
    expect(notSimulable(weapon)).toMatchObject({ reason: 'custom-scenario', scenarioId: 'night-only' })
  })

  it.each<ArchetypeParams>([{ archetype: 'explosive-aoe', blastRadiusTiles: 3, trigger: 'impact', falloff: 'none' }])(
    'unimplemented archetype $archetype → archetype-not-implemented',
    (params) => {
      expect(notSimulable(fixtureWeapon(params))).toMatchObject({ reason: 'archetype-not-implemented', archetype: params.archetype })
    },
  )

  it('AMENDMENTS-013 B64: a summon weapon’s critPct is not applicable — absent, it is never required (whips, minions, sentries)', () => {
    for (const weapon of [summonFixture(), summonFixture({ variant: 'sentry', aiClass: 'ranged-shot', sentryRangeTiles: 20 }), whipFixture()]) {
      expect(weapon.critPct, weapon.name).toBeUndefined()
      expect(Weapon.safeParse(weapon).success, weapon.name).toBe(true)
      expect(assessWeapon(weapon), weapon.name).toMatchObject({ simulable: true })
      const created = createLabSim({ weapon })
      if (!created.ok) throw new Error(`${weapon.name} refused: ${created.refusal.message}`)
      expect(created.sim.weapon.critChancePct, weapon.name).toBe(0) // summon damage never crits (B17)
    }
    // every other class still requires it
    expect(notSimulable(swordFixture({ critPct: undefined }))).toMatchObject({ reason: 'missing-required-field', fields: ['critPct'] })
    expect(notSimulable(summonFixture({}, { damageClass: 'magic' }))).toMatchObject({ reason: 'missing-required-field', fields: ['critPct'] })
    // a present value is still checked, and listed unverified still blocks (the pipeline's own rule)
    expect(notSimulable(summonFixture({}, { critPct: 140 as number }))).toMatchObject({ reason: 'invalid-data', fields: ['critPct'] })
    expect(notSimulable(summonFixture({}, { _prov: fixtureProv(['critPct']) }))).toMatchObject({ reason: 'unverified-required-field', fields: ['critPct'] })
  })

  it('minion-sentry / whip: homing is refused, and a contact summon with a projectile contradicts its class', () => {
    const refusal = (w: Weapon) => refusalOf(createLabSim({ weapon: w }))
    const homing = { homing: { strength: 0.2, acquisitionRangeTiles: 10 } }
    expect(refusal(summonFixture({}, {}, homing))).toMatchObject({ reason: 'modifier-not-implemented', fields: ['labBehavior.modifiers.homing'] })
    expect(refusal(whipFixture({}, {}, homing))).toMatchObject({ reason: 'modifier-not-implemented', fields: ['labBehavior.modifiers.homing'] })
    expect(refusal(summonFixture({ aiClass: 'hover-strike', projectile: { velocityTps: 20 } }))).toMatchObject({ reason: 'invalid-data', fields: ['labBehavior.params.aiClass', 'labBehavior.params.projectile'] })
    expect(createLabSim({ weapon: summonFixture({ aiClass: 'ranged-shot', projectile: { velocityTps: 20 } }) }).ok).toBe(true)
  })

  it('minion loadout: a simulable minion weapon beside a non-summon weapon; anything else is an invalid-loadout setup refusal', () => {
    expect(createLabSim({ weapon: whipFixture(), minionLoadout: summonFixture() }).ok).toBe(true)
    expect(refusalOf(createLabSim({ weapon: summonFixture(), minionLoadout: summonFixture() }))).toMatchObject({ kind: 'invalid-setup', reason: 'invalid-loadout' })
    expect(refusalOf(createLabSim({ weapon: whipFixture(), minionLoadout: summonFixture({ variant: 'sentry', aiClass: 'ranged-shot', sentryRangeTiles: 9 }) }))).toMatchObject({ reason: 'invalid-loadout' })
    expect(refusalOf(createLabSim({ weapon: whipFixture(), minionLoadout: swordFixture() }))).toMatchObject({ reason: 'invalid-loadout' })
    const unverified = summonFixture({}, { damage: undefined, _prov: fixtureProv(['damage']) })
    expect(refusalOf(createLabSim({ weapon: whipFixture(), minionLoadout: unverified }))).toMatchObject({ kind: 'invalid-setup', reason: 'invalid-loadout', message: expect.stringContaining('unverified') })
  })

  it('returning: the velocity is required; a variant’s flight must be its documented one; homing and unhonorable hitsPerPass are refused', () => {
    expect(notSimulable(returningFixture({ variant: 'boomerang' }, { shootSpeedTps: undefined }))).toMatchObject({ reason: 'missing-required-field', fields: ['shootSpeedTps'] })
    const refusal = (w: Weapon) => refusalOf(createLabSim({ weapon: w }))
    for (const [variant, returnMode, control] of [
      ['boomerang', 'tethered', 'fire-and-forget'],
      ['flail', 'auto-return', 'cursor-follow'],
      ['yoyo', 'auto-return', 'fire-and-forget'],
    ] as const) {
      expect(refusal(returningFixture({ variant, returnMode, control })), variant).toMatchObject({
        kind: 'not-simulable',
        reason: 'invalid-data',
        fields: ['labBehavior.params.returnMode', 'labBehavior.params.control'],
      })
    }
    expect(refusal(returningFixture({ variant: 'boomerang' }, {}, { homing: { strength: 0.2, acquisitionRangeTiles: 10 } }))).toMatchObject({
      reason: 'modifier-not-implemented',
      fields: ['labBehavior.modifiers.homing'],
    })
    expect(refusal(returningFixture({ variant: 'boomerang', hitsPerPass: 3 }))).toMatchObject({ reason: 'invalid-data', fields: ['labBehavior.params.hitsPerPass'] })
    // a re-hit interval makes it honorable: the weapon's multiHit, or a yoyo's own
    expect(createLabSim({ weapon: returningFixture({ variant: 'boomerang', hitsPerPass: 3 }, {}, { multiHit: { localImmunityTicks: 10 } }) }).ok).toBe(true)
    expect(createLabSim({ weapon: returningFixture({ variant: 'yoyo', hitsPerPass: 3 }) }).ok).toBe(true)
  })

  it('piercing-beam: contradictory pierce, ammo it can’t carry, a missing speed and homing on a beam are refused', () => {
    const refusal = (w: Weapon) => refusalOf(createLabSim({ weapon: w }))
    expect(refusal(beamFixture({ mode: 'pierce-projectile', pierce: 2, projectile: { velocityTps: 30, pierce: 1 } }))).toMatchObject({ reason: 'invalid-data', fields: ['labBehavior.params.pierce', 'labBehavior.params.projectile.pierce'] })
    expect(refusal(beamFixture({ mode: 'pierce-projectile', pierce: 2 }, { ammoClass: 'fixture-arrow', shootSpeedTps: 20 }))).toMatchObject({ reason: 'invalid-data', fields: ['ammoClass', 'labBehavior.params'] })
    expect(refusal(beamFixture({ mode: 'pierce-projectile', pierce: 2 }))).toMatchObject({ reason: 'missing-required-field', fields: ['shootSpeedTps'] })
    expect(createLabSim({ weapon: beamFixture({ mode: 'pierce-projectile', pierce: 2 }, { shootSpeedTps: 20 }) }).ok).toBe(true) // the weapon's velocity when the params carry no projectile
    expect(refusal(beamFixture({ mode: 'channel-beam', tickRateTicks: 6 }, {}, { homing: { strength: 0.2, acquisitionRangeTiles: 10 } }))).toMatchObject({ reason: 'modifier-not-implemented' })
  })

  it('a required field listed unverified is refused (absent + listed)', () => {
    const weapon = swordFixture({ damage: undefined, _prov: fixtureProv(['damage']) })
    expect(Weapon.safeParse(weapon).success).toBe(true) // A1: legal record, Unknown damage
    expect(notSimulable(weapon)).toMatchObject({ reason: 'unverified-required-field', fields: ['damage'] })
  })

  it('any unverified labBehavior.* path blocks simulation (pipeline rule, defense-in-depth)', () => {
    const weapon = swordFixture({ _prov: fixtureProv(['labBehavior.params.reachTiles']) })
    expect(notSimulable(weapon)).toMatchObject({ reason: 'unverified-required-field', fields: ['labBehavior.params.reachTiles'] })
  })

  it('simRequiredWeaponFields (shared with the pipeline) and optional sim fields are honored', () => {
    expect(notSimulable(swordFixture({ knockback: undefined, _prov: fixtureProv(['knockback']) })).fields).toEqual(['knockback'])
    expect(notSimulable(swordFixture({ autoReuse: undefined, _prov: fixtureProv(['autoReuse']) })).fields).toEqual(['autoReuse'])
    expect(notSimulable(staffFixture({}, { manaCost: undefined, _prov: fixtureProv(['manaCost']) })).fields).toEqual(['manaCost'])
  })

  it('every modeling convention names its ruling, and its engine label carries the same ruling (B49)', () => {
    expect(MODELING_CONVENTIONS.map((c) => c.ruling)).toEqual([
      'AMENDMENTS-010 B44',
      'AMENDMENTS-010 B46',
      'AMENDMENTS-010 B47',
      'AMENDMENTS-013 B63 P-1',
      'AMENDMENTS-013 B63 P-2',
      'AMENDMENTS-013 B63 P-3',
      'AMENDMENTS-013 B63 P-5',
    ])
    for (const c of MODELING_CONVENTIONS) {
      const id = CONVENTION_APPROXIMATIONS[c.id]
      if (id) expect(APPROXIMATIONS[id].ruling, c.id).toBe(c.ruling)
      else expect(c.id).toBe('swing-geometry') // B44: labeled by the Lab UI (approximations.ts header)
    }
    // only convention labels carry a ruling
    expect(Object.values(APPROXIMATIONS).filter((a) => a.ruling).map((a) => a.id).sort()).toEqual(['slight-spread', 'square-blast-radius', 'summon-average-rate', 'summon-hit-cap', 'thrust-reach', 'whip-arc'])
    // B63 P-3: the AssumptionsTip states the caveat verbatim; every B63 label says it is a Lab choice
    expect(APPROXIMATIONS['summon-hit-cap'].detail).toContain('maximum rate; actual depends on minion AI pathing')
    for (const id of ['whip-arc', 'summon-average-rate', 'summon-hit-cap', 'square-blast-radius'] as const) expect(APPROXIMATIONS[id].detail).toMatch(/This is a Lab modeling choice, not game data\.$/)
  })

  it('absent required fields (not listed) are missing-required-field', () => {
    expect(notSimulable(swordFixture({ useAnimationTicks: undefined }))).toMatchObject({ reason: 'missing-required-field', fields: ['useAnimationTicks'] })
    expect(notSimulable(staffFixture({}, { manaCost: undefined }))).toMatchObject({ reason: 'missing-required-field', fields: ['manaCost'] })
    expect(notSimulable(bowFixture({}, { shootSpeedTps: undefined }))).toMatchObject({ reason: 'missing-required-field', fields: ['shootSpeedTps'] })
  })

  it('editorial values are consumable (curated overlay params)', () => {
    const weapon = swordFixture({ _prov: { ...fixtureProv(), editorialFields: ['labBehavior'] } })
    expect(assessWeapon(weapon)).toMatchObject({ simulable: true, archetype: 'swing-melee' })
  })

  it('contradictory ammo classes are invalid data', () => {
    const r = refusalOf(createLabSim({ weapon: bowFixture({}, { ammoClass: 'musket-ball' }), ammo: ammoFixture() }))
    expect(r).toMatchObject({ kind: 'not-simulable', reason: 'invalid-data' })
  })

  it('bounce/chain are NOT implemented: the registry stubs throw, the public API returns a typed refusal', () => {
    expect(() => modifierEntry('bounce')({ count: 2, speedRetention: 0.8 }, { weapon: swordFixture() })).toThrow(NotImplementedError)
    expect(() => modifierEntry('chain')({ maxTargets: 3, rangeTiles: 5 }, { weapon: swordFixture() })).toThrow(NotImplementedError)
    for (const modifiers of [{ bounce: { count: 2, speedRetention: 0.8 } }, { chain: { maxTargets: 3, rangeTiles: 5 } }]) {
      const weapon = staffFixture({}, {}, modifiers)
      expect(refusalOf(createLabSim({ weapon }))).toMatchObject({ kind: 'not-simulable', reason: 'modifier-not-implemented' })
      expect(notSimulable(weapon).reason).toBe('modifier-not-implemented')
    }
  })

  it('a setup-level DoT gap never masks a not-implemented modifier in assessWeapon', () => {
    const weapon = staffFixture({}, {}, { dot: { buffId: 'fixture-burn', durationTicks: 60 }, bounce: { count: 1, speedRetention: 1 } })
    expect(notSimulable(weapon).reason).toBe('modifier-not-implemented')
  })

  it('assessWeapon reports what a simulable weapon still needs from the setup', () => {
    expect(assessWeapon(bowFixture())).toEqual({ simulable: true, archetype: 'bow-gun', requiresAmmoClass: 'fixture-arrow', requiresBuffIds: [] })
    expect(assessWeapon(staffFixture({}, {}, { dot: { buffId: 'fixture-burn', durationTicks: 60 } }))).toEqual({
      simulable: true,
      archetype: 'magic-bolt',
      requiresAmmoClass: null,
      requiresBuffIds: ['fixture-burn'],
    })
  })
})

describe('setup validation', () => {
  const dotStaff = staffFixture({}, {}, { dot: { buffId: 'fixture-burn', durationTicks: 60 } })

  it('DoT needs the buff registry, and verified dps on the referenced buff', () => {
    expect(refusalOf(createLabSim({ weapon: dotStaff }))).toMatchObject({ kind: 'invalid-setup', reason: 'buff-registry-required' })
    expect(refusalOf(createLabSim({ weapon: dotStaff, buffs: [] }))).toMatchObject({ kind: 'not-simulable', reason: 'dependency-data-unavailable' })
    const noDot = dotBuffFixture(4, { dot: undefined })
    delete (noDot as { dot?: unknown }).dot
    expect(refusalOf(createLabSim({ weapon: dotStaff, buffs: [noDot] }))).toMatchObject({ reason: 'dependency-data-unavailable' })
    const unverifiedDot = { ...noDot, _prov: fixtureProv(['dot']) }
    expect(Buff.safeParse(unverifiedDot).success).toBe(true)
    expect(refusalOf(createLabSim({ weapon: dotStaff, buffs: [unverifiedDot] }))).toMatchObject({
      reason: 'dependency-data-unavailable',
      fields: ['buff:fixture-burn.dot.dps'],
    })
    expect(createLabSim({ weapon: dotStaff, buffs: [dotBuffFixture()] }).ok).toBe(true)
  })

  it('bow-gun needs compatible, verified ammo', () => {
    expect(refusalOf(createLabSim({ weapon: bowFixture() }))).toMatchObject({ kind: 'invalid-setup', reason: 'ammo-required' })
    expect(refusalOf(createLabSim({ weapon: bowFixture(), ammo: ammoFixture({ ammoClass: 'musket-ball' }) }))).toMatchObject({
      kind: 'invalid-setup',
      reason: 'ammo-incompatible',
    })
    const notAmmo = ammoFixture({}, { category: 'material' })
    delete (notAmmo as { ammoStats?: unknown }).ammoStats
    expect(refusalOf(createLabSim({ weapon: bowFixture(), ammo: notAmmo }))).toMatchObject({ reason: 'ammo-incompatible' })
    const unverifiedAmmo = { ...notAmmo, category: 'ammo' as const, _prov: fixtureProv(['ammoStats']) }
    expect(refusalOf(createLabSim({ weapon: bowFixture(), ammo: unverifiedAmmo }))).toMatchObject({
      kind: 'not-simulable',
      reason: 'dependency-data-unavailable',
    })
  })

  it('ammo without a damage value is refused, never treated as 0 (P2-S7: ammoStats.damage optional)', () => {
    const noDamage = ammoFixture()
    delete (noDamage.ammoStats as { damage?: number }).damage
    const listed = { ...noDamage, _prov: fixtureProv(['ammoStats.damage']) }
    for (const ammo of [noDamage, listed]) {
      expect(Item.safeParse(ammo).success).toBe(true)
      expect(refusalOf(createLabSim({ weapon: bowFixture(), ammo }))).toMatchObject({
        kind: 'not-simulable',
        reason: 'dependency-data-unavailable',
        fields: ['ammo.ammoStats.damage'],
      })
    }
  })

  it('rejects invalid settings, dummies and arenas', () => {
    const weapon = swordFixture()
    expect(refusalOf(createLabSim({ weapon, settings: { maxMana: 0 } }))).toMatchObject({ reason: 'invalid-settings' })
    expect(refusalOf(createLabSim({ weapon, dummies: [{ x: 2, y: 0, defense: -1 }] }))).toMatchObject({ reason: 'invalid-dummy' })
    expect(refusalOf(createLabSim({ weapon, dummies: [{ x: 2, y: 0, widthTiles: 0 }] }))).toMatchObject({ reason: 'invalid-dummy' })
    expect(refusalOf(createLabSim({ weapon, dummies: [{ id: 'a', x: 2, y: 0 }, { id: 'a', x: 4, y: 0 }] }))).toMatchObject({ reason: 'invalid-dummy' })
    expect(refusalOf(createLabSim({ weapon, arena: { minX: 1, maxX: 10, minY: -5, maxY: 5 } }))).toMatchObject({ reason: 'invalid-arena' })
  })
})
