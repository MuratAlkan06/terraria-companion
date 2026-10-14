/**
 * Which weapons the Lab equips, and how `/lab?weapon=` resolves (PRD P3-S1, P3-S4/S5; UX_SPEC §3.4,
 * §8, §10.11). Runs on the committed dataset with the Lab's setup (ammo + buff registry): every
 * expectation is derived from the data, never a hand list.
 */
import { describe, expect, it } from 'vitest'
import type { Weapon } from '../data-access/types'
import weaponsJson from '../data/weapons.detail.json'
import { assessWeapon, createLabSim, IMPLEMENTED_ARCHETYPES } from '../sim'
import {
  behaviorSourceUrl,
  defaultLabWeapon,
  inGameDescription,
  isLabEquippable,
  labScopeNouns,
  labStatus,
  labWeapons,
  notSimulatedReason,
  resolveLabSelection,
  UNASSIGNED_LIMITATION_PLAIN,
  UNASSIGNED_LIMITATION_REASON,
} from './labWeapons'
import { LAB_ARCHETYPES, LAB_WEAPON_PARAM, labWeaponSearch, offersLab } from './labLinks'
import { ALL_ITEMS, LAB_SETUP } from './testing/labData'

const weapons = weaponsJson as Weapon[]
const byId = new Map(weapons.map((w) => [w.id, w]))
const list = labWeapons(weapons, LAB_SETUP)
const isArchetype = (w: Weapon, archetype: string) => w.labBehavior.kind === 'archetype' && w.labBehavior.params.archetype === archetype

/**
 * Independent derivation: the engine says simulable, and it builds with what the Lab loads — some
 * compatible ammo item it accepts (bows and guns) and the committed buff registry (DoT weapons).
 */
const equippableByEngine = weapons.filter((w) => {
  const verdict = assessWeapon(w)
  if (!verdict.simulable) return false
  const ammoOptions = verdict.requiresAmmoClass === null ? [undefined] : ALL_ITEMS.filter((i) => i.ammoStats?.ammoClass === verdict.requiresAmmoClass)
  return ammoOptions.some((ammo) => createLabSim({ weapon: w, buffs: LAB_SETUP.buffs, ...(ammo ? { ammo } : {}) }).ok)
})

describe('what the Lab equips (P3-S1 swords, B47 thrust, P3-S4 bows/guns, P3-S5 magic bolts)', () => {
  it('the Lab equips every archetype the engine implements', () => {
    expect(LAB_ARCHETYPES).toEqual(['swing-melee', 'thrust', 'bow-gun', 'magic-bolt'])
    expect([...LAB_ARCHETYPES].sort()).toEqual([...IMPLEMENTED_ARCHETYPES].sort())
  })

  it('is exactly the engine-simulable set the Lab’s ammo and buff data can run — no more, no less', () => {
    expect(new Set(list.map((w) => w.id))).toEqual(new Set(equippableByEngine.map((w) => w.id)))
    expect(list).toHaveLength(equippableByEngine.length)
    // AMENDMENTS-010 B44: 35 broadswords are simulable under the ratified geometry convention.
    expect(list.filter((w) => isArchetype(w, 'swing-melee')).length).toBeGreaterThanOrEqual(35)
    // P3-S4 / P3-S5: bows, guns and repeaters and magic bolts equip (every one in today's data).
    for (const archetype of ['bow-gun', 'magic-bolt']) {
      const engine = weapons.filter((w) => isArchetype(w, archetype) && assessWeapon(w).simulable)
      expect(engine.length, archetype).toBeGreaterThan(0)
      expect(list.filter((w) => isArchetype(w, archetype)), archetype).toHaveLength(engine.length)
    }
    for (const w of list) {
      expect(w.labBehavior.kind).toBe('archetype')
      if (w.labBehavior.kind === 'archetype') expect(LAB_ARCHETYPES).toContain(w.labBehavior.params.archetype)
    }
  })

  it('the damage-over-time weapons equip with the buff registry (AMENDMENTS-012 follow-up)', () => {
    const dot = weapons.filter((w) => w.labBehavior.kind === 'archetype' && w.labBehavior.modifiers?.dot !== undefined)
    expect(dot.map((w) => w.name)).toEqual(expect.arrayContaining(['Stylish Scissors', 'Brand of the Inferno', 'Frost Staff']))
    for (const w of dot) {
      expect(labStatus(w, LAB_SETUP).kind, w.name).toBe('equippable')
      // Without the registry the engine would refuse — the buffs are what makes them equippable.
      expect(labStatus(w, { ...LAB_SETUP, buffs: [] }), w.name).toMatchObject({ kind: 'not-in-lab-yet', needs: 'debuff-data' })
    }
  })

  it('a damage-over-time debuff without verified data is never a broken equip: its card says why', () => {
    const sword = list.find((w) => isArchetype(w, 'swing-melee'))!
    if (sword.labBehavior.kind !== 'archetype') throw new Error('unreachable')
    const cursed: typeof sword = { ...sword, labBehavior: { ...sword.labBehavior, modifiers: { dot: { buffId: 'not-in-the-registry', durationTicks: 120 } } } }
    const status = labStatus(cursed, LAB_SETUP)
    expect(status).toMatchObject({ kind: 'not-in-lab-yet', needs: 'debuff-data' })
    if (status.kind !== 'not-in-lab-yet') throw new Error('unreachable')
    expect(notSimulatedReason(status)).toMatch(/no verified damage-over-time data/)
  })

  it('excludes every limitation and unimplemented weapon', () => {
    const ids = new Set(list.map((w) => w.id))
    const others = weapons.filter((w) => !ids.has(w.id))
    expect(others.length).toBeGreaterThan(0)
    for (const w of others) expect(isLabEquippable(w, LAB_SETUP), w.name).toBe(false)
    expect(others.some((w) => labStatus(w, LAB_SETUP).kind === 'not-simulable')).toBe(true)
  })

  it('the data-only entry-point check (weapon pages) agrees with the engine’s verdict on every weapon', () => {
    for (const w of weapons) expect(offersLab(w), w.name).toBe(isLabEquippable(w, LAB_SETUP))
  })

  it('is alphabetical (stable ties by id)', () => {
    const names = list.map((w) => w.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')))
  })

  it('defaults to the weakest equippable weapon, chosen from the data (a starter sword)', () => {
    const minDamage = Math.min(...list.map((w) => w.damage ?? Infinity))
    const expected = list.filter((w) => w.damage === minDamage).sort((a, b) => a.id - b.id)[0]
    expect(defaultLabWeapon(list)).toBe(expected)
    expect(defaultLabWeapon([])).toBeUndefined()
  })
})

describe('/lab?weapon=:id deep links (UX_SPEC §10.11)', () => {
  const fallback = defaultLabWeapon(list)!

  it('no or blank parameter equips the default with no notice', () => {
    for (const param of [null, '', '   ']) expect(resolveLabSelection(param, byId, list, LAB_SETUP)).toEqual({ weapon: fallback, notice: null })
  })

  it('every equippable id equips that weapon', () => {
    for (const w of list) expect(resolveLabSelection(String(w.id), byId, list, LAB_SETUP)).toEqual({ weapon: w, notice: null })
  })

  it('a weapon the engine refuses falls back gracefully with its limitation info (never a broken equip)', () => {
    const refused = weapons.filter((w) => w.labBehavior.kind === 'limitation')
    expect(refused.length).toBeGreaterThan(0)
    for (const w of refused.slice(0, 25)) {
      const selection = resolveLabSelection(String(w.id), byId, list, LAB_SETUP)!
      expect(selection.weapon).toBe(fallback)
      expect(selection.notice).toMatchObject({ kind: 'not-equippable', weapon: w, status: { kind: 'not-simulable' } })
      if (selection.notice?.kind !== 'not-equippable') throw new Error('unreachable')
      // "Why it isn't simulated": the limitation's own plain-language reason — the pipeline's
      // default (bookkeeping) reason is restated in plain language (design review M4).
      const reason = notSimulatedReason(selection.notice.status)
      expect(reason.length).toBeGreaterThan(10)
      if (w.labBehavior.kind === 'limitation') {
        expect(reason).toBe(w.labBehavior.reason === UNASSIGNED_LIMITATION_REASON ? UNASSIGNED_LIMITATION_PLAIN : w.labBehavior.reason)
        expect(behaviorSourceUrl(w)).toBe(w.labBehavior.sourceUrl)
      }
      // "What it does in-game" is real text or absent — never the pipeline's bare wiki pointer.
      expect(inGameDescription(w) ?? '').not.toBe(`See the ${w.name} wiki page for its in-game behavior.`)
    }
  })

  it('a bow whose ammo type has no ammo the engine can fire says so plainly (never a broken equip)', () => {
    // A real bow re-pointed at an ammo class whose only item carries no damage (Gel): the data the
    // Lab needs is missing, so it falls back with a card instead of equipping.
    const bow = list.find((w) => isArchetype(w, 'bow-gun'))!
    if (bow.labBehavior.kind !== 'archetype' || bow.labBehavior.params.archetype !== 'bow-gun') throw new Error('unreachable')
    const gelClass = ALL_ITEMS.find((i) => i.ammoStats && i.ammoStats.damage === undefined)!.ammoStats!.ammoClass
    const mock: Weapon = { ...bow, id: 999_001, ammoClass: gelClass, labBehavior: { kind: 'archetype', params: { ...bow.labBehavior.params, ammoClass: gelClass } } }
    const selection = resolveLabSelection(String(mock.id), new Map([...byId, [mock.id, mock]]), list, LAB_SETUP)!
    expect(selection.weapon).toBe(fallback)
    expect(selection.notice).toMatchObject({ kind: 'not-equippable', status: { kind: 'not-in-lab-yet', needs: 'ammo' } })
    if (selection.notice?.kind !== 'not-equippable') throw new Error('unreachable')
    expect(notSimulatedReason(selection.notice.status)).toMatch(/None of the ammo this weapon fires has the verified data/)
  })

  it('names what the Lab simulates in plain words (a serial comma: a noun may contain "and")', () => {
    expect(labScopeNouns()).toBe('swung melee weapons, thrusting weapons, bows and guns, and bolt-casting magic weapons')
    expect(labScopeNouns(['swing-melee', 'thrust'])).toBe('swung melee weapons and thrusting weapons')
  })

  it('unknown or malformed ids fall back with a not-found notice echoing the request', () => {
    for (const param of ['abc', '0', '-5', '1.5', '99999999', '4956abc', '<script>']) {
      expect(resolveLabSelection(param, byId, list, LAB_SETUP), param).toEqual({ weapon: fallback, notice: { kind: 'not-found', requested: param } })
    }
  })

  it('an empty Lab (no equippable weapons) resolves to null — the page shows its designed empty state', () => {
    expect(resolveLabSelection('1', byId, [], LAB_SETUP)).toBeNull()
  })

  it('builds the deep-link query the Lab reads', () => {
    expect(LAB_WEAPON_PARAM).toBe('weapon')
    expect(labWeaponSearch(24)).toBe('?weapon=24')
  })
})
