/**
 * TEST FIXTURES ONLY — not game data and never shipped to the Lab UI.
 *
 * Schema-conformant records (validated with the real Zod schemas in sim tests) used to exercise the
 * engine. Weapon combat numbers and the Lab archetype params below are illustrative fixtures, not the
 * committed data: committed weapons carry their own pipeline-derived params (P3-S0, B48 —
 * pipeline/merge/labParams.ts), and a test that needs them loads src/data/weapons.detail.json.
 */
import type { ArchetypeParams, Buff, Item, LabModifiers, Prov, Weapon } from '../../schemas'

const FIXTURE_URL = 'https://terraria.wiki.gg/wiki/Weapon_Lab_fixture'

export function fixtureProv(unverifiedFields: string[] = []): Prov {
  return {
    gameVersion: '1.4.5.8',
    sources: [{ kind: 'curated', url: FIXTURE_URL, fetchedAt: '2026-10-13', overlay: 'sim-test-fixture' }],
    verified: unverifiedFields.length === 0,
    unverifiedFields,
    editorialFields: [],
  }
}

/** Builds an archetype weapon; `overrides` win (pass `undefined` to drop a field). */
export function fixtureWeapon(
  params: ArchetypeParams,
  overrides: Partial<Weapon> = {},
  modifiers?: LabModifiers,
): Weapon {
  const base: Weapon = {
    id: 900_001,
    name: 'Fixture Weapon',
    slug: 'fixture-weapon',
    type: 'weapon',
    tags: [],
    wikiUrl: FIXTURE_URL,
    acquisition: [],
    _prov: fixtureProv(),
    damageClass: 'melee',
    damage: 10,
    critPct: 0,
    useTimeTicks: 20,
    useAnimationTicks: 20,
    knockback: 5,
    autoReuse: false,
    labBehavior: { kind: 'archetype', params, ...(modifiers ? { modifiers } : {}) },
  }
  const merged = { ...base, ...overrides } as Record<string, unknown>
  for (const [key, value] of Object.entries(overrides)) if (value === undefined) delete merged[key]
  return merged as Weapon
}

export const SWORD_PARAMS: ArchetypeParams = { archetype: 'swing-melee', arcDegrees: 180, reachTiles: 3 }

export const swordFixture = (overrides: Partial<Weapon> = {}, params: Partial<Extract<ArchetypeParams, { archetype: 'swing-melee' }>> = {}): Weapon =>
  fixtureWeapon({ ...SWORD_PARAMS, ...params } as ArchetypeParams, { name: 'Fixture Sword', ...overrides })

export const spearFixture = (reachTiles: number, overrides: Partial<Weapon> = {}): Weapon =>
  fixtureWeapon({ archetype: 'thrust', reachTiles }, { id: 900_002, name: 'Fixture Spear', slug: 'fixture-spear', ...overrides })

export const bowFixture = (
  params: Partial<Extract<ArchetypeParams, { archetype: 'bow-gun' }>> = {},
  overrides: Partial<Weapon> = {},
  modifiers?: LabModifiers,
): Weapon =>
  fixtureWeapon(
    { archetype: 'bow-gun', ammoClass: 'fixture-arrow', projectilesPerUse: 1, spreadDegrees: 0, inheritsAmmoProjectile: true, ...params },
    {
      id: 900_003,
      name: 'Fixture Bow',
      slug: 'fixture-bow',
      damageClass: 'ranged',
      damage: 8,
      useTimeTicks: 25,
      useAnimationTicks: 25,
      ammoClass: params.ammoClass ?? 'fixture-arrow',
      shootSpeedTps: 24,
      ...overrides,
    },
    modifiers,
  )

export const staffFixture = (
  params: Partial<Extract<ArchetypeParams, { archetype: 'magic-bolt' }>> = {},
  overrides: Partial<Weapon> = {},
  modifiers?: LabModifiers,
): Weapon =>
  fixtureWeapon(
    { archetype: 'magic-bolt', projectilesPerUse: 1, spreadDegrees: 0, projectile: { velocityTps: 30 }, ...params },
    {
      id: 900_004,
      name: 'Fixture Staff',
      slug: 'fixture-staff',
      damageClass: 'magic',
      damage: 15,
      useTimeTicks: 20,
      useAnimationTicks: 20,
      manaCost: 10,
      ...overrides,
    },
    modifiers,
  )

type ReturningParams = Extract<ArchetypeParams, { archetype: 'returning' }>
type BeamParams = Extract<ArchetypeParams, { archetype: 'piercing-beam' }>

/** A returning weapon (melee, 30 tiles/s = ½ tile per tick unless overridden). Variant defaults follow the family rules. */
export const returningFixture = (params: Partial<ReturningParams> & Pick<ReturningParams, 'variant'>, overrides: Partial<Weapon> = {}, modifiers?: LabModifiers): Weapon => {
  const modes = params.variant === 'yoyo' ? ({ returnMode: 'tethered', control: 'cursor-follow' } as const) : ({ returnMode: 'auto-return', control: 'fire-and-forget' } as const)
  return fixtureWeapon(
    { archetype: 'returning', throwRangeTiles: 12, ...modes, ...params },
    { id: 900_005, name: `Fixture ${params.variant}`, slug: `fixture-${params.variant}`, shootSpeedTps: 30, ...overrides },
    modifiers,
  )
}

/** A piercing-beam magic weapon (mana cost 4). Pass `{ mode: 'channel-beam', tickRateTicks }` or `{ mode: 'pierce-projectile', pierce, projectile? }`. */
export const beamFixture = (params: Omit<BeamParams, 'archetype'>, overrides: Partial<Weapon> = {}, modifiers?: LabModifiers): Weapon =>
  fixtureWeapon(
    { archetype: 'piercing-beam', ...params } as ArchetypeParams,
    { id: 900_006, name: 'Fixture Beam', slug: 'fixture-beam', damageClass: 'magic', damage: 20, useTimeTicks: 20, useAnimationTicks: 20, manaCost: 4, ...overrides },
    modifiers,
  )

type SummonParams = Extract<ArchetypeParams, { archetype: 'minion-sentry' }>
type WhipParams = Extract<ArchetypeParams, { archetype: 'whip' }>

/**
 * A summon weapon shaped like the pipeline emits them (AMENDMENTS-013 B64): summon class, NO critPct
 * (not applicable), autoReuse, use 36 + reuse delay 2. Default: a ground-melee minion, 1 slot, every 12
 * ticks. A sentry needs `sentryRangeTiles` (schema: present iff sentry).
 */
export const summonFixture = (params: Partial<SummonParams> = {}, overrides: Partial<Weapon> = {}, modifiers?: LabModifiers): Weapon =>
  fixtureWeapon(
    { archetype: 'minion-sentry', variant: 'minion', slotCost: 1, aiClass: 'ground-melee', attackRateTicks: 12, ...params } as ArchetypeParams,
    {
      id: 900_007,
      name: params.variant === 'sentry' ? 'Fixture Sentry Staff' : 'Fixture Minion Staff',
      slug: params.variant === 'sentry' ? 'fixture-sentry-staff' : 'fixture-minion-staff',
      damageClass: 'summon',
      critPct: undefined,
      damage: 10,
      useTimeTicks: 36,
      useAnimationTicks: 36,
      reuseDelayTicks: 2,
      autoReuse: true,
      ...overrides,
    },
    modifiers,
  )

/** A whip as the pipeline emits them: summon class, no critPct, use time 30, arc 180° (B63 P-1). Default range 11, tag 4, falloff 0.5. */
export const whipFixture = (params: Partial<WhipParams> = {}, overrides: Partial<Weapon> = {}, modifiers?: LabModifiers): Weapon =>
  fixtureWeapon(
    { archetype: 'whip', arcDegrees: 180, rangeTiles: 11, tagDamageFlat: 4, falloffPerTarget: 0.5, ...params } as ArchetypeParams,
    { id: 900_008, name: 'Fixture Whip', slug: 'fixture-whip', damageClass: 'summon', critPct: undefined, damage: 14, useTimeTicks: 30, useAnimationTicks: 30, autoReuse: false, ...overrides },
    modifiers,
  )

type ExplosiveParams = Extract<ArchetypeParams, { archetype: 'explosive-aoe' }>

/**
 * A thrown explosive shaped like the pipeline emits the Bomb (P3-S11): classless, critPct not applicable
 * (AMENDMENTS-015 B85(b): absent, not listed), use time 25, throw speed 18.75 tiles/s (Iteminfo
 * shootSpeed 5), 100 damage. Default params: a 3 s fuse (180 ticks), 4-tile radius, no falloff; pass
 * `{ trigger: 'impact' }` for an impact explosive (no fuse — schema: fuseTicks iff timed).
 */
export const explosiveFixture = (params: Partial<ExplosiveParams> = {}, overrides: Partial<Weapon> = {}, modifiers?: LabModifiers): Weapon => {
  const trigger = params.trigger ?? 'timed'
  return fixtureWeapon(
    { archetype: 'explosive-aoe', blastRadiusTiles: 4, trigger, ...(trigger === 'timed' ? { fuseTicks: 180 } : {}), falloff: 'none', ...params } as ArchetypeParams,
    {
      id: 900_009,
      name: 'Fixture Bomb',
      slug: 'fixture-bomb',
      damageClass: 'other',
      critPct: undefined,
      damage: 100,
      useTimeTicks: 25,
      useAnimationTicks: 25,
      knockback: 8,
      autoReuse: false,
      shootSpeedTps: 18.75,
      _prov: fixtureProv(),
      ...overrides,
    },
    modifiers,
  )
}

export function ammoFixture(ammoStats: Partial<NonNullable<Item['ammoStats']>> = {}, overrides: Partial<Item> = {}): Item {
  return {
    id: 900_100,
    name: 'Fixture Arrow',
    slug: 'fixture-arrow-item',
    type: 'item',
    tags: [],
    wikiUrl: FIXTURE_URL,
    acquisition: [],
    _prov: fixtureProv(),
    category: 'ammo',
    isStation: false,
    ammoStats: { ammoClass: 'fixture-arrow', damage: 5, ...ammoStats },
    ...overrides,
  }
}

export function dotBuffFixture(dps = 4, overrides: Partial<Buff> = {}): Buff {
  return {
    id: 'fixture-burn',
    name: 'Fixture Burn',
    isDebuff: true,
    effects: [],
    dot: { dps },
    wikiUrl: FIXTURE_URL,
    _prov: fixtureProv(),
    ...overrides,
  }
}
