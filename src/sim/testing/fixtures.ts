/**
 * TEST FIXTURES ONLY — not game data and never shipped to the Lab UI.
 *
 * Schema-conformant records (validated with the real Zod schemas in sim tests) used to exercise the
 * engine. Weapon combat numbers below are illustrative unless a test says it loaded a committed
 * record from src/data/weapons.detail.json. All Lab archetype params are fixtures: no committed
 * weapon has archetype params yet (P3-S0 authors them).
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
