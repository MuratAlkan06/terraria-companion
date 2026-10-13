/**
 * Which weapons the Lab equips, and how `/lab?weapon=` resolves (PRD P3-S1; UX_SPEC §3.4, §8, §10.11).
 * Runs on the committed dataset: every expectation is derived from the data, never a hand list.
 */
import { describe, expect, it } from 'vitest'
import type { Weapon } from '../data-access/types'
import weaponsJson from '../data/weapons.detail.json'
import { assessWeapon } from '../sim'
import {
  behaviorSourceUrl,
  defaultLabWeapon,
  inGameDescription,
  isLabEquippable,
  labStatus,
  labWeapons,
  notSimulatedReason,
  resolveLabSelection,
  UNASSIGNED_LIMITATION_PLAIN,
  UNASSIGNED_LIMITATION_REASON,
} from './labWeapons'
import { LAB_WEAPON_PARAM, labWeaponSearch, offersLab } from './labLinks'

const weapons = weaponsJson as Weapon[]
const byId = new Map(weapons.map((w) => [w.id, w]))
const list = labWeapons(weapons)

/** Independent derivation: the engine says simulable AND the archetype is swing-melee. */
const simulableSwingMelee = weapons.filter((w) => {
  const verdict = assessWeapon(w)
  return verdict.simulable && verdict.archetype === 'swing-melee'
})

describe('the in-Lab picker (P3-S1 minimal picker)', () => {
  it('is exactly the simulable swing-melee set — no more, no less', () => {
    expect(new Set(list.map((w) => w.id))).toEqual(new Set(simulableSwingMelee.map((w) => w.id)))
    expect(list).toHaveLength(simulableSwingMelee.length)
    // AMENDMENTS-010 B44: 35 broadswords are simulable under the ratified geometry convention.
    expect(list.length).toBeGreaterThanOrEqual(35)
    for (const w of list) {
      expect(w.labBehavior.kind).toBe('archetype')
      if (w.labBehavior.kind === 'archetype') expect(w.labBehavior.params.archetype).toBe('swing-melee')
    }
  })

  it('excludes every limitation, unimplemented and not-yet-equippable (bow/magic) weapon', () => {
    const ids = new Set(list.map((w) => w.id))
    const others = weapons.filter((w) => !ids.has(w.id))
    expect(others.length).toBeGreaterThan(0)
    for (const w of others) expect(isLabEquippable(w), w.name).toBe(false)
    expect(others.some((w) => labStatus(w).kind === 'not-in-lab-yet')).toBe(true)
    expect(others.some((w) => labStatus(w).kind === 'not-simulable')).toBe(true)
  })

  it('the data-only entry-point check (weapon pages) agrees with the engine’s verdict on every weapon', () => {
    for (const w of weapons) expect(offersLab(w), w.name).toBe(isLabEquippable(w))
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
  const firstWhere = (status: string) => weapons.find((w) => labStatus(w).kind === status)!

  it('no or blank parameter equips the default with no notice', () => {
    for (const param of [null, '', '   ']) expect(resolveLabSelection(param, byId, list)).toEqual({ weapon: fallback, notice: null })
  })

  it('every equippable id equips that weapon', () => {
    for (const w of list) expect(resolveLabSelection(String(w.id), byId, list)).toEqual({ weapon: w, notice: null })
  })

  it('a weapon the engine refuses falls back gracefully with its limitation info (never a broken equip)', () => {
    const refused = weapons.filter((w) => w.labBehavior.kind === 'limitation')
    expect(refused.length).toBeGreaterThan(0)
    for (const w of refused.slice(0, 25)) {
      const selection = resolveLabSelection(String(w.id), byId, list)!
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

  it('a simulable weapon of an archetype the Lab UI can’t equip yet says so plainly', () => {
    const bow = firstWhere('not-in-lab-yet')
    const selection = resolveLabSelection(String(bow.id), byId, list)!
    expect(selection.weapon).toBe(fallback)
    expect(selection.notice).toMatchObject({ kind: 'not-equippable', status: { kind: 'not-in-lab-yet' } })
    if (selection.notice?.kind !== 'not-equippable') throw new Error('unreachable')
    expect(notSimulatedReason(selection.notice.status)).toMatch(/swung melee weapons only/)
  })

  it('unknown or malformed ids fall back with a not-found notice echoing the request', () => {
    for (const param of ['abc', '0', '-5', '1.5', '99999999', '4956abc', '<script>']) {
      expect(resolveLabSelection(param, byId, list), param).toEqual({ weapon: fallback, notice: { kind: 'not-found', requested: param } })
    }
  })

  it('an empty Lab (no equippable weapons) resolves to null — the page shows its designed empty state', () => {
    expect(resolveLabSelection('1', byId, [])).toBeNull()
  })

  it('builds the deep-link query the Lab reads', () => {
    expect(LAB_WEAPON_PARAM).toBe('weapon')
    expect(labWeaponSearch(24)).toBe('?weapon=24')
  })
})
