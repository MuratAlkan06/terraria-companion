/**
 * Which weapons the Lab equips, and how `/lab?weapon=` resolves (PRD P3-S1, P3-S4/S5; UX_SPEC §3.4,
 * §8, §10.11). Runs on the committed dataset with the Lab's setup (ammo + buff registry): every
 * expectation is derived from the data, never a hand list.
 */
import { describe, expect, it } from 'vitest'
import type { Weapon } from '../data-access/types'
import weaponsJson from '../data/weapons.detail.json'
import { isFlavorLine, tooltipBehavior } from '../schemas'
import { assessWeapon, createLabSim, IMPLEMENTED_ARCHETYPES } from '../sim'
import {
  behaviorSourceUrl,
  defaultLabWeapon,
  homesInGame,
  inGameDescription,
  isLabEquippable,
  labScopeNouns,
  labStatus,
  labWeapons,
  notSimulatedReason,
  resolveLabSelection,
  UNASSIGNED_LIMITATION_PLAIN,
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

describe('what the Lab equips (P3-S1 swords, B47 thrust, P3-S4 bows/guns, P3-S5 magic bolts, P3-S6/S7 beams and returning weapons, P3-S9/S10 summons and whips)', () => {
  it('the Lab equips every archetype the engine implements', () => {
    expect(LAB_ARCHETYPES).toEqual(['swing-melee', 'thrust', 'bow-gun', 'magic-bolt', 'returning', 'piercing-beam', 'minion-sentry', 'whip', 'explosive-aoe'])
    expect([...LAB_ARCHETYPES].sort()).toEqual([...IMPLEMENTED_ARCHETYPES].sort())
  })

  it('is exactly the engine-simulable set the Lab’s ammo and buff data can run — no more, no less', () => {
    expect(new Set(list.map((w) => w.id))).toEqual(new Set(equippableByEngine.map((w) => w.id)))
    expect(list).toHaveLength(equippableByEngine.length)
    // AMENDMENTS-010 B44: 35 broadswords are simulable under the ratified geometry convention.
    expect(list.filter((w) => isArchetype(w, 'swing-melee')).length).toBeGreaterThanOrEqual(35)
    // P3-S4 / P3-S5 / P3-S7 / P3-S9 / P3-S10: bows, guns and repeaters, magic bolts, returning weapons,
    // minion staves (the Imp Staff's On Fire! with the buff registry) and whips equip (every one in today's data).
    for (const archetype of ['bow-gun', 'magic-bolt', 'returning', 'minion-sentry', 'whip']) {
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
      // "Why it isn't simulated": the limitation's own plain-language reason, verbatim — the default
      // card's included (AMENDMENTS-014 B72(a): the pipeline emits the design-reviewed string itself;
      // the old bookkeeping string's mapping is gone, checked below).
      const reason = notSimulatedReason(selection.notice.status)
      expect(reason.length).toBeGreaterThan(10)
      if (w.labBehavior.kind === 'limitation') {
        expect(reason).toBe(w.labBehavior.reason)
        expect(behaviorSourceUrl(w)).toBe(w.labBehavior.sourceUrl)
      }
      // "What it does in-game" is real text or absent — never the pipeline's bare wiki pointer.
      expect(inGameDescription(w) ?? '').not.toBe(`See the ${w.name} wiki page for its in-game behavior.`)
    }
    // B72(a): the default card arrives as the design-reviewed string; nothing emits the old one any more
    const reasons = refused.map((w) => (w.labBehavior.kind === 'limitation' ? w.labBehavior.reason : ''))
    expect(reasons).toContain(UNASSIGNED_LIMITATION_PLAIN)
    expect(reasons.some((r) => /parameters have not been assigned/.test(r))).toBe(false)
  })

  it('"What it does in-game" is behavior, never the tooltip’s flavor quote (design review P3-S6/S7: Light Disc read "\'Greetings, programs!\'")', () => {
    // across every weapon the card could show: no flavor line, ever
    for (const w of weapons) {
      const text = inGameDescription(w)
      if (text === undefined) continue
      for (const line of text.split('\n')) expect(isFlavorLine(line), `${w.name}: "${line}"`).toBe(false)
    }
    // the returning-family cards whose tooltip is only a flavor quote show a reviewed sentence of their article
    const card = (name: string) => inGameDescription(weapons.find((w) => w.name === name)!)
    expect(card('Light Disc')).toBe(
      'It does not necessarily return immediately upon contact with objects, but instead can bounce off blocks before returning. Unlike most boomerangs, it does not have to return to the player before being fired, with a maximum of six Light Discs that can be thrown out at one time.',
    )
    for (const name of ['Light Disc', 'Sergeant United Shield', 'Combat Wrench', 'Trimarang', 'Flaming Mace']) {
      const w = weapons.find((x) => x.name === name)!
      expect(w.behaviorText, name).toMatch(/^'.*'$/) // the tooltip is flavor only
      expect(tooltipBehavior(w.behaviorText), name).toBeUndefined()
      expect(card(name)?.length, name).toBeGreaterThan(20)
      expect(card(name), name).not.toContain(w.behaviorText!)
    }
    // a tooltip with behavior lines keeps them and drops only its flavor line
    expect(card('Dao of Pow')).toBe('Has a chance to confuse')
    // flavor only, no reviewed sentence: no description (the card says "No verified description yet.")
    expect(card('Volcano')).toBeUndefined()
    // the UI's tooltip fallback (a weapon the Lab can't equip for another reason) drops the flavor line too
    const sword = list.find((w) => isArchetype(w, 'swing-melee'))!
    expect(inGameDescription({ ...sword, behaviorText: "Shoots a beam\n'Forged in fire'" })).toBe('Shoots a beam')
    expect(inGameDescription({ ...sword, behaviorText: "'Forged in fire'" })).toBeUndefined()
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
    expect(labScopeNouns()).toBe(
      'swung melee weapons, thrusting weapons, bows and guns, bolt-casting magic weapons, boomerangs, launched flails and yoyos, piercing shots and held beams, minion and sentry staves, whips, and thrown explosives',
    )
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

/**
 * PRD P3-S8 precondition audit (2026-10-15). TRIPWIRE: if a simulable weapon ever homes, the toggle is no
 * longer display-only — wire `LabSettings.homingEnabled` into the settings panel (default on = the weapon's
 * real behavior, off labeled "what-if: homing disabled") with goldens for both states, then update this pin.
 */
describe('P3-S8 homing audit: no simulated weapon homes, so the toggle ships disabled with its reason', () => {
  it('no simulable weapon carries a homing modifier, or verified text naming homing', () => {
    const simulable = weapons.filter((w) => assessWeapon(w).simulable)
    expect(simulable).toHaveLength(149)
    expect(simulable.filter((w) => w.labBehavior.kind === 'archetype' && w.labBehavior.modifiers?.homing !== undefined).map((w) => w.name)).toEqual([])
    expect(simulable.filter(homesInGame).map((w) => w.name)).toEqual([])
  })

  it('the 27 weapons whose data says they home are all limitation cards the Lab can’t equip', () => {
    const homing = weapons.filter(homesInGame)
    expect(homing.map((w) => w.id).sort((a, b) => a - b)).toEqual([
      113, 190, 218, 495, 739, 1121, 1122, 1123, 1155, 1313, 1446, 1801, 1826, 1946, 2611, 2622, 2888, 3474, 3475, 3540, 4760, 4911, 5118, 5294, 5477, 5479, 5526,
    ])
    for (const w of homing) {
      expect(w.labBehavior.kind, w.name).toBe('limitation')
      expect(labStatus(w, LAB_SETUP).kind, w.name).toBe('not-simulable')
    }
  })

  it('reads a homing modifier, the reason or the in-game text — conservative words, never the flavor line', () => {
    const base = weapons.find((w) => w.labBehavior.kind === 'limitation' && !homesInGame(w))!
    const card = (reason: string, inGameBehavior: string): Weapon => ({ ...base, labBehavior: { kind: 'limitation', reason, inGameBehavior, sourceUrl: base.wikiUrl } })
    expect(homesInGame(card('Its bolt homes onto the closest enemy — not modeled.', 'Shoots a bolt'))).toBe(true)
    expect(homesInGame(card('Not modeled.', 'Launches homing missiles'))).toBe(true)
    expect(homesInGame(card('Its skulls home in on enemies — not modeled.', 'Shoots a skull'))).toBe(true)
    expect(homesInGame(card('Not modeled.', 'Teleports you home'))).toBe(false)
    expect(homesInGame(card('Not modeled.', 'Shoots bees that will chase your enemy'))).toBe(false)
    expect(homesInGame(card('Not modeled.', "Shoots a bolt\n'Homing in on greatness'"))).toBe(false) // flavor line
    const sword = list.find((w) => isArchetype(w, 'swing-melee'))!
    if (sword.labBehavior.kind !== 'archetype') throw new Error('fixture drift')
    expect(homesInGame(sword)).toBe(false)
    expect(homesInGame({ ...sword, labBehavior: { ...sword.labBehavior, modifiers: { homing: { strength: 0.2, acquisitionRangeTiles: 10 } } } })).toBe(true)
  })
})
