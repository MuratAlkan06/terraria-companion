/* Readiness factors + Improve My Build (SCORING_SPEC §6/§7/§8; PRD P5-S6/S7 + §9 Feature A;
 * AMENDMENTS-014 B68–B71, AMENDMENTS-015 B94) over the shipped dataset: the §9.2 golden, a fresh world,
 * an empty loadout, an Unknown-heavy state, owned gated items counted with an info line, the Demon
 * Heart slot, slot edge cases, gated suggestions nearest gate first, determinism, a
 * seeded sweep of invariants (summary = easier ∪ harder; every estimate paired with assumptions;
 * suggestions always obtainable-now or correctly grouped; strict improvement; the target-boss cap),
 * and the copy audit over every line. */
import { describe, expect, it } from 'vitest'
import type { Accessory, ArmorPiece, ArmorSet, Boss, Buff, Condition, Item, ProgressionEdge, ProgressionNode, Weapon } from '../data-access/types'
import accessoriesJson from '../data/accessories.detail.json'
import armorJson from '../data/armor.detail.json'
import setsJson from '../data/armor-sets.json'
import bossesJson from '../data/bosses.json'
import buffsJson from '../data/buffs.json'
import conditionsJson from '../data/conditions.json'
import itemsJson from '../data/items.detail.json'
import progressionJson from '../data/progression.json'
import weaponsJson from '../data/weapons.detail.json'
import type { LoadoutSlots } from '../schemas'
import { availabilityOf, gateDistance, isCappedByTarget, targetCapNodes } from './candidates'
import { auditCopy } from './copyAudit'
import { DEMON_HEART_SLOT_INDEX, MAX_ACCESSORY_SLOTS, SLOT_COUNT } from './constants'
import { improveSuggestions, type ImproveResult } from './improve'
import { effectiveProgress, trackedDefeats, type TrackedProgress } from './progress'
import { analyzeReadiness, FACTOR_IDS, type ReadinessAnalysis, type ReadinessData, type ReadinessInput, type ReadinessLine } from './readiness'
import { f1, improve as improveCopy, ownWords, plain, type Segment } from './readinessCopy'

const byId = <T extends { id: K }, K>(list: readonly T[]) => new Map(list.map((x) => [x.id, x]))
const weapons = weaponsJson as unknown as Weapon[]
const armor = armorJson as unknown as ArmorPiece[]
const accessories = accessoriesJson as unknown as Accessory[]
const items = itemsJson as unknown as Item[]
const graph = progressionJson as { nodes: ProgressionNode[]; edges: ProgressionEdge[] }

const DATA: ReadinessData = {
  weapons: byId(weapons),
  armor: byId(armor),
  accessories: byId(accessories),
  sets: byId(setsJson as unknown as ArmorSet[]),
  items: byId(items),
  buffs: byId(buffsJson as unknown as Buff[]),
  bosses: byId(bossesJson as unknown as Boss[]),
  conditions: byId(conditionsJson as unknown as Condition[]),
  graph,
  ammoTypeName: (slug) => ({ 'musket-ball': 'Bullets', 'wooden-arrow': 'Arrows', gel: 'Gel' })[slug] ?? slug,
  gameVersion: '1.4.5.8',
}

const ALL = [...weapons, ...armor, ...accessories, ...items]
const id = (name: string): number => {
  const found = ALL.find((x) => x.name === name)
  if (!found) throw new Error(`no item named ${name}`)
  return found.id
}
const defeated = (...ids: string[]): TrackedProgress => ({ worldEvil: 'corruption', nodeStates: Object.fromEntries(ids.map((n) => [n, 'defeated' as const])) })
const emptyLoadout = (): LoadoutSlots => ({ mainWeapon: null, altWeapon: null, helmet: null, chest: null, legs: null, accessories: Array(MAX_ACCESSORY_SLOTS).fill(null), ammo: [], buffs: [], summon: null })
const loadout = (parts: Partial<Omit<LoadoutSlots, 'accessories'>> & { accessories?: (number | null)[] } = {}): LoadoutSlots => {
  const base = emptyLoadout()
  const acc = [...(parts.accessories ?? []), ...base.accessories].slice(0, MAX_ACCESSORY_SLOTS)
  return { ...base, ...parts, accessories: acc }
}

function analyze(input: Partial<ReadinessInput> & { bossId: string }, data: ReadinessData = DATA): ReadinessAnalysis {
  const r = analyzeReadiness({ difficulty: 'classic', cls: 'melee', loadout: emptyLoadout(), progress: defeated(), ...input }, data)
  if ('error' in r) throw new Error('no boss')
  return r
}
function improve(input: Partial<ReadinessInput> & { bossId: string }, data: ReadinessData = DATA): ImproveResult {
  const r = improveSuggestions({ difficulty: 'classic', cls: 'melee', loadout: emptyLoadout(), progress: defeated(), ...input }, data)
  if ('error' in r) throw new Error('no boss')
  return r
}
const factor = (r: ReadinessAnalysis, fid: string) => r.factors.find((f) => f.id === fid) as ReadinessAnalysis['factors'][number]
const lines = (r: ReadinessAnalysis, fid: string) => factor(r, fid).lines.map((l) => `[${l.tone}] ${l.text}`)
const line = (r: ReadinessAnalysis, lid: string) => r.factors.flatMap((f) => f.lines).find((l) => l.id === lid)

/* §9.2: melee vs Plantera, Expert, tracked WoF + the three mechs. */
const PLANTERA_INPUT: ReadinessInput & { bossId: string } = {
  bossId: 'plantera',
  difficulty: 'expert',
  cls: 'melee',
  progress: defeated('wall-of-flesh', 'the-twins', 'the-destroyer', 'skeletron-prime'),
  loadout: loadout({
    mainWeapon: id('Death Sickle'),
    helmet: id('Hallowed Mask'),
    chest: id('Hallowed Plate Mail'),
    legs: id('Hallowed Greaves'),
    accessories: [id('Warrior Emblem'), id('Lightning Boots'), id('Leaf Wings')],
  }),
}

describe('§9.2 golden: melee vs Plantera (Expert; tracked Wall of Flesh + 3 mechs)', () => {
  const r = analyze(PLANTERA_INPUT)

  it('F1: 189.7/s (est.) after Plantera’s 36 defense; ~11,380 per minute beside 42,000 HP on Expert; the sickle projectile named, not counted', () => {
    expect(lines(r, 'damage')).toEqual([
      '[info] Your Death Sickle is estimated at 189.7/s after Plantera’s 36 defense.',
      '[info] Sustained for a full minute that totals ~11,380; Plantera has 42,000 HP on Expert.',
      '[info] Not counted in this estimate: Death Sickle — Shoots a deathly sickle.',
    ])
    expect(factor(r, 'damage').computedFrom).toEqual({ used: 7, total: 7, unknownInputs: [] })
    const estimate = line(r, 'damage.estimate') as ReadinessLine
    // the figure carries its unit, so the est. chip follows the whole "189.7/s"
    expect(estimate.segments.find((s) => s.kind === 'num')).toEqual({ kind: 'num', text: '189.7/s', estimate: 'dps' })
    expect(estimate.evidence).toEqual(['i:1327', 'boss:plantera'])
  })

  it('F2 (1 of 2 inputs): 50 defense blocks an estimated 38 per hit on Expert (50 × 0.75); contact damage Unknown; equipment-only disclosure', () => {
    expect(lines(r, 'defense')).toEqual([
      '[info] Your equipment adds 50 defense, which blocks an estimated 38 per hit on Expert (50 × 0.75).',
      '[unknown] Plantera’s contact damage on Expert is Unknown (not verified for Terraria 1.4.5.8), so this factor covers your defense only.',
      '[info] Your max life isn’t tracked here, so this factor covers your equipment only.',
    ])
    expect(factor(r, 'defense').computedFrom).toEqual({ used: 1, total: 2, unknownInputs: ['Plantera’s contact damage on Expert'] })
  })

  it('F3: projectile-spam → easier (+16% movement speed, 2.7 s of flight from the owned Leaf Wings — the spec’s own §9.2 reading); enrage → harder, generic; multi-phase → info; inflicts-debuffs → xref Preparation; every line editorial and citing the boss page', () => {
    const f3 = factor(r, 'mobility')
    expect(f3.lines.map((l) => [l.id, l.tone])).toEqual([
      ['mobility.enrage-mechanic', 'harder'],
      ['mobility.inflicts-debuffs', 'info'],
      ['mobility.multi-phase', 'info'],
      ['mobility.projectile-spam', 'easier'],
    ])
    expect(line(r, 'mobility.projectile-spam')?.text).toBe('Plantera fires projectile barrages. Your gear gives you 16% movement speed and 2.7 s of flight (Leaf Wings) to reposition with.')
    for (const l of f3.lines) {
      expect(l.editorial).toBe(true)
      expect(l.sources).toContain('https://terraria.wiki.gg/wiki/Plantera')
      expect(l.evidence).toContain('boss:plantera')
    }
  })

  it('F4: weapon class matches; Hallowed set bonus active (named, not scored); all 91 counted points match melee (75 + the Leaf Wings’ 160 ticks × 0.1 — synergy 100/100 as in §9.2)', () => {
    expect(lines(r, 'synergy').slice(0, 3)).toEqual([
      '[info] Your Death Sickle is a melee weapon, matching your class.',
      '[easier] Your Hallowed armor set bonus is active: Become immune after striking an enemy. It’s named here, not scored.',
      '[info] 91 of 91 counted stat points on your gear apply to your melee class.',
    ])
    expect(line(r, 'synergy.set')?.segments.find((s) => s.kind === 'quote')?.text).toBe('Become immune after striking an enemy')
  })

  it('F5: no buff potions (harder), no healing potion (harder), summon method quoted with its source, the curated prep checklist', () => {
    expect(line(r, 'preparation.buffs')).toMatchObject({ tone: 'harder', text: 'No buff potions are in your loadout.' })
    expect(line(r, 'preparation.healing')).toMatchObject({ tone: 'harder', text: 'No potion in your loadout restores health.' })
    expect(line(r, 'preparation.boss-summon')?.sources).toEqual(['https://terraria.wiki.gg/wiki/Plantera'])
    expect(line(r, 'preparation.boss-conditions')?.segments.filter((s) => s.kind === 'cond').map((s) => (s as { id: string }).id)).toEqual(['post-mechanical-bosses', 'jungle'])
    expect(line(r, 'preparation.prep')?.text).toBe('Plantera’s page has a curated prep checklist of 8 steps.')
  })

  it('Leaf Wings are verified gated by Plantera + Queen Bee, but owned — so counted (SCORING_SPEC §6 "possession asserted"; B94(1)), the gate said in an info line under Synergy, never a "not counted" entry', () => {
    expect(r.notCounted).toEqual([])
    const wings = r.entries.find((e) => e.name === 'Leaf Wings')
    expect(wings).toMatchObject({ counted: true, availability: { status: 'gated', missing: ['plantera', 'queen-bee'] } })
    expect(wings?.reason).toBeUndefined()
    const info = line(r, 'synergy.owned-gated') as ReadinessLine
    expect(info).toMatchObject({
      tone: 'info',
      text: 'Leaf Wings is counted because it’s in your loadout; its usual sources open after you defeat Plantera and Queen Bee, not marked defeated on the boss map.',
      evidence: [`i:${id('Leaf Wings')}`, 'boss:plantera', 'boss:queen-bee'],
      sources: [DATA.accessories.get(id('Leaf Wings'))?.wikiUrl], // the record's own article (the shared Wings page)
    })
    // the bosses are named in the sentence, so the item carries no availability (no GateBadge repeating them)
    expect(info.segments.find((s) => s.kind === 'item')).toEqual({ kind: 'item', id: id('Leaf Wings'), text: 'Leaf Wings' })
    // info tone: it never moves the summary
    expect([...r.summary.easier, ...r.summary.harder].some((e) => e.line.id === info.id)).toBe(false)
  })

  it('owned items with Unknown or gated availability are counted, with the assumptions said; the summary is exactly the easier / harder lines', () => {
    expect(r.entries.filter((e) => e.counted && e.availability.status === 'unknown').map((e) => e.name)).toEqual(['Death Sickle', 'Hallowed Mask', 'Hallowed Plate Mail', 'Hallowed Greaves', 'Lightning Boots'])
    expect(r.assumptions.map((a) => a.id)).toEqual(['tracked-only', 'owned-gated', 'owned-unknown'])
    expect(r.summary.easier.map((e) => e.line.id)).toEqual(['mobility.projectile-spam', 'synergy.set'])
    expect(r.summary.harder.map((e) => e.line.id)).toEqual(['mobility.enrage-mechanic', 'preparation.buffs', 'preparation.healing'])
    expect(r.demonHeart).toEqual({ slotIndex: 5, gateMet: true })
  })
})

describe('fresh world (nothing tracked): the Eye of Cthulhu', () => {
  it('an EMPTY loadout analyzes honestly: nothing estimated, no defense, every gear need unmet — and nothing invented', () => {
    const r = analyze({ bossId: 'eye-of-cthulhu' })
    expect(lines(r, 'damage')).toEqual(['[info] No main weapon is in your loadout, so damage fit isn’t estimated.'])
    expect(factor(r, 'damage').computedFrom).toEqual({ used: 0, total: 0, unknownInputs: [] })
    expect(line(r, 'defense.no-defense')?.tone).toBe('harder')
    // charges, dashes, flies: unmet; contact damage known (15 on Classic) → after 0 defense still 15
    expect(line(r, 'mobility.charges')?.tone).toBe('harder')
    expect(line(r, 'mobility.flies')).toMatchObject({ tone: 'harder', text: 'Eye of Cthulhu flies. Nothing in your loadout gives flight.' })
    expect(line(r, 'defense.contact')?.text).toBe('Eye of Cthulhu’s contact damage on Classic is 15; after your defense, about 15 per touch.')
    expect(r.notCounted).toEqual([])
    expect(r.entries).toEqual([])
    expect(r.estimates.dps).toBeUndefined()
  })

  it('a starter loadout: Wooden Sword + Wood armor + Hermes Boots + Ironskin + Lesser Healing Potion', () => {
    const r = analyze({
      bossId: 'eye-of-cthulhu',
      loadout: loadout({ mainWeapon: id('Wooden Sword'), helmet: id('Wood Helmet'), chest: id('Wood Breastplate'), legs: id('Wood Greaves'), accessories: [id('Hermes Boots')], buffs: [id('Ironskin Potion'), id('Lesser Healing Potion')] }),
    })
    // Wooden Sword 7 dmg, 20 ticks, no autoswing → 3 hits/s; EoC defense 12 → ⌊7 − 6⌋ = 1 → the floor
    expect(line(r, 'damage.estimate')?.text).toBe('Your Wooden Sword is estimated at 3.1/s after Eye of Cthulhu’s 12 defense.')
    expect(line(r, 'damage.floor')).toMatchObject({ tone: 'harder', text: 'Eye of Cthulhu’s defense cuts each hit of your Wooden Sword to the 1-damage minimum.' })
    // Ironskin's +8 defense is counted with the armor
    expect(line(r, 'defense.defense')?.text).toMatch(/^Your equipment adds \d+ defense/)
    // Hermes Boots: speed is a special (unquantified) → the charge need reads Unknown, never "harder" (§1.3)
    expect(line(r, 'mobility.charges')).toMatchObject({ tone: 'unknown' })
    expect(line(r, 'mobility.charges')?.text).toContain('The wearer can run super fast')
    expect(line(r, 'preparation.buffs')).toMatchObject({ tone: 'easier', text: 'Your potions: Ironskin Potion (+8 defense).' })
    expect(line(r, 'preparation.healing')).toMatchObject({ tone: 'easier', text: 'Your loadout includes Lesser Healing Potion, which restores 50 health.' })
    expect(r.assumptions.map((a) => a.id)).toContain('potions-active')
    // a set bonus that is a number (Wood armor: "1 defense") is counted, and says so — not "named, not scored"
    expect(line(r, 'synergy.set')?.text).toBe('Your Wood armor set bonus is active: 1 defense. Its numbers count with the rest of your gear.')
    // the summoning item has no record of its own: named from the Iteminfo universe when the caller gives it, else "item #43"
    expect(line(r, 'preparation.boss-summon')?.text).toMatch(/^Eye of Cthulhu is summoned with item #43: /)
    const named = analyze({ bossId: 'eye-of-cthulhu' }, { ...DATA, nameOf: (n) => (n === 43 ? 'Suspicious Looking Eye' : undefined) })
    expect(line(named, 'preparation.boss-summon')?.text).toMatch(/^Eye of Cthulhu is summoned with Suspicious Looking Eye: /)
  })

  it('a set bonus mixing numbers and unmodeled effects says which part counts', () => {
    const sets = [...DATA.sets.values()]
    const mixed = sets.find((set) => set.variants.length === 1 && new Set(set.variants[0].setBonus.map((e) => e.kind)).size === 2) as ArmorSet
    const r = analyze({ bossId: 'king-slime', cls: 'hybrid', loadout: loadout({ helmet: mixed.pieces.helmets[0], chest: mixed.pieces.chest, legs: mixed.pieces.legs }), progress: defeated(...graph.nodes.filter((n) => n.kind === 'boss').map((n) => n.id)) })
    const set = line(r, 'synergy.set')
    // pieces with Unknown gating are still counted (owned), so the set is active
    expect(set?.text).toMatch(/Its numbers count with the rest of your gear; the rest isn’t modeled\.$/)
  })
})

/** A copy of a record with one field made Unknown (absent + listed), the way the pipeline emits it. */
function withUnknown<T extends { _prov: { unverifiedFields: string[] } }>(record: T, field: string, drop: (r: T) => T): T {
  const copy = drop(structuredClone(record))
  copy._prov = { ...copy._prov, unverifiedFields: [...copy._prov.unverifiedFields, field] }
  return copy
}

describe('Unknown-heavy: The Twins (all stats Unknown) with Unknown weapon, armor, accessory, wings, ammo and potion data', () => {
  const plate = armor.find((a) => a.name === 'Hallowed Plate Mail') as ArmorPiece
  const wings = accessories.find((a) => a.name === 'Angel Wings') as Accessory
  const unknownPlate = withUnknown(plate, 'defense', (r) => ({ ...r, defense: undefined }) as ArmorPiece)
  const unknownWings = withUnknown(wings, 'wingStats.flightTimeTicks', (r) => ({ ...r, wingStats: { hover: false } }) as Accessory)
  const data: ReadinessData = { ...DATA, armor: new Map(DATA.armor).set(plate.id, unknownPlate), accessories: new Map(DATA.accessories).set(wings.id, unknownWings) }
  const r = analyze(
    {
      bossId: 'the-twins',
      difficulty: 'expert',
      progress: defeated('wall-of-flesh'),
      loadout: loadout({ mainWeapon: id('Snowball Launcher'), helmet: id('Hallowed Mask'), chest: plate.id, legs: id('Hallowed Greaves'), accessories: [id('Razortip'), wings.id], buffs: [id('Strange Brew')] }),
    },
    data,
  )

  it('never counts an Unknown as 0: each one is an "unknown" line and an unknown input', () => {
    expect(line(r, 'damage.fields-unknown')).toMatchObject({ tone: 'unknown', text: 'Your Snowball Launcher’s damage is not verified, so no damage estimate is made.' })
    expect(factor(r, 'damage').computedFrom.unknownInputs).toEqual(['Snowball Launcher’s damage'])
    expect(line(r, 'defense.piece-unknown')?.text).toBe('Hallowed Plate Mail’s defense is Unknown, so it isn’t in that total.')
    expect(factor(r, 'defense').computedFrom.unknownInputs).toEqual(['Hallowed Plate Mail defense', 'The Twins’ contact damage on Expert'])
    // the total shown is the known pieces only (Mask 24 + Greaves 11)
    expect(line(r, 'defense.defense')?.text).toMatch(/^Your equipment adds 35 defense/)
    expect(line(r, 'synergy.effects-unknown')?.text).toBe('Razortip’s effects are Unknown, so they aren’t counted.')
    expect(line(r, 'mobility.flies')).toMatchObject({ tone: 'unknown', text: 'The Twins fly. Your Angel Wings’ flight time is Unknown.' })
    expect(line(r, 'preparation.healing-unknown')?.text).toBe('Strange Brew’s healing is Unknown.')
    expect(line(r, 'preparation.healing')).toBeUndefined() // no "no healing" claim while one is Unknown
  })

  it('Unknown segments carry their field for the UnknownValue marker; the boss’s Unknown contact damage is not "not-applicable"', () => {
    const markers = r.factors.flatMap((f) => f.lines.flatMap((l) => l.segments.filter((s) => s.kind === 'unknown')))
    // the Unknown wings show on both "flies" and "projectile barrages" (each need reads them)
    expect(markers.map((s) => (s as { field: string }).field).sort()).toEqual(['defense', 'effects', 'healLife', 'statsByDifficulty.expert.contactDamage', 'wingStats.flightTimeTicks', 'wingStats.flightTimeTicks'])
    expect(r.computedFrom.unknownInputs.length).toBeGreaterThanOrEqual(5)
  })
})

describe('owned items count whatever their gating, the gate said in an info line (SCORING_SPEC §6; B94(1)); owned Unknown items are counted (B69/Q2, tracked only — B69/Q9)', () => {
  const input = { bossId: 'skeletron', loadout: loadout({ mainWeapon: id('Leaf Blower'), accessories: [id('Death Sickle') /* not an accessory */, id('Warrior Emblem'), id('Warrior Emblem')] }) }

  it('with nothing tracked: the Plantera-gated main weapon and the WoF-gated emblem are counted, each with an info line in its factor; only the wrong-slot and duplicate items aren’t counted, saying why', () => {
    const r = analyze(input)
    expect(r.notCounted.map((n) => n.text)).toEqual(['Death Sickle — doesn’t fit that slot.', 'Warrior Emblem — already equipped in another slot.'])
    expect(r.entries.filter((e) => e.counted).map((e) => e.name)).toEqual(['Leaf Blower', 'Warrior Emblem'])
    expect(line(r, 'damage.estimate')?.text).toMatch(/^Your Leaf Blower is estimated at [\d,.]+\/s\.$/)
    expect(line(r, 'damage.owned-gated')).toMatchObject({
      tone: 'info',
      text: 'Leaf Blower is counted because it’s in your loadout; its usual sources open after you defeat Plantera, not marked defeated on the boss map.',
    })
    expect(line(r, 'synergy.owned-gated')).toMatchObject({
      tone: 'info',
      text: 'Warrior Emblem is counted because it’s in your loadout; its usual sources open after you defeat Wall of Flesh, not marked defeated on the boss map.',
    })
    expect(r.assumptions.map((a) => a.id)).toContain('owned-gated')
    expect(r.assumptions.map((a) => a.id)).not.toContain('demon-heart-closed')
  })

  it('marking the gates defeated clears the info lines — the stage selector never does (tracked only)', () => {
    const r = analyze({ ...input, progress: defeated('wall-of-flesh', 'the-twins', 'the-destroyer', 'skeletron-prime', 'plantera') })
    expect(r.entries.filter((e) => e.counted).map((e) => e.name)).toEqual(['Leaf Blower', 'Warrior Emblem'])
    expect(line(r, 'damage.estimate')?.text).toMatch(/^Your Leaf Blower is estimated at [\d,.]+\/s\.$/)
    expect(line(r, 'damage.defense-unknown')?.tone).toBe('unknown') // Skeleton's stats are Unknown: computed at defense 0, disclosed
    expect(r.factors.flatMap((f) => f.lines).filter((l) => l.id.includes('.owned-gated'))).toEqual([])
    expect(r.assumptions.map((a) => a.id)).not.toContain('owned-gated')
  })

  it('owned pieces sharing a gate share one line in their factor (Ninja armor before King Slime is marked) — and, counted, they activate their set bonus', () => {
    const ninja = [...DATA.sets.values()].find((set) => set.name === 'Ninja armor') as ArmorSet
    const r = analyze({ bossId: 'eye-of-cthulhu', loadout: loadout({ helmet: ninja.pieces.helmets[0], chest: ninja.pieces.chest, legs: ninja.pieces.legs }) })
    expect(factor(r, 'defense').lines.filter((l) => l.id.includes('.owned-gated')).map((l) => [l.id, l.tone, l.text])).toEqual([
      ['defense.owned-gated', 'info', 'Ninja Hood, Ninja Shirt and Ninja Pants are counted because they’re in your loadout; their usual sources open after you defeat King Slime, not marked defeated on the boss map.'],
    ])
    expect(line(r, 'synergy.set')?.tone).toBe('easier')
    expect(r.notCounted).toEqual([])
  })

  it('a persisted id that left the dataset degrades to a "not in this version’s data" line, never a throw', () => {
    const r = analyze({ bossId: 'king-slime', loadout: loadout({ mainWeapon: 999_999 }) })
    expect(r.notCounted.map((n) => n.text)).toEqual(['Item #999999 — not in this version’s data.'])
    expect(line(r, 'damage.no-weapon')?.text).toBe('Your main weapon (item #999999) isn’t in this version’s data, so damage fit isn’t estimated.')
  })

  it('no boss → { error: "no-boss" } for both analysis and suggestions', () => {
    expect(analyzeReadiness({ bossId: null, difficulty: 'classic', cls: 'melee', loadout: emptyLoadout(), progress: defeated() }, DATA)).toEqual({ error: 'no-boss' })
    expect(improveSuggestions({ bossId: 'not-a-boss', difficulty: 'classic', cls: 'melee', loadout: emptyLoadout(), progress: defeated() }, DATA)).toEqual({ error: 'no-boss' })
  })
})

describe('the Demon Heart slot (AMENDMENTS-001 A4; B69/Q3 — assumption chip, no toggle)', () => {
  const emblem = id('Feral Claws') // obtainable from the start
  const inSlot = (index: number) => {
    const acc: (number | null)[] = Array(MAX_ACCESSORY_SLOTS).fill(null)
    acc[index] = emblem
    return loadout({ accessories: acc })
  }

  it('Classic: no Demon Heart slot; a 6th or 7th stored accessory is kept but not analyzed', () => {
    const r = analyze({ bossId: 'king-slime', difficulty: 'classic', loadout: inSlot(5) })
    expect(r.demonHeart).toBeUndefined()
    expect(r.inactiveSlotItems).toBe(1)
    expect(r.entries).toEqual([])
  })

  it('Expert slot 6 / Master slot 7 while the Wall of Flesh isn’t marked: gated like an item, the gate named', () => {
    for (const difficulty of ['expert', 'master'] as const) {
      const index = DEMON_HEART_SLOT_INDEX[difficulty] as number
      const r = analyze({ bossId: 'king-slime', difficulty, loadout: inSlot(index) })
      expect(r.demonHeart).toEqual({ slotIndex: index, gateMet: false })
      expect(r.notCounted.map((n) => n.text)).toEqual(['Feral Claws — in the Demon Heart slot, which opens after you defeat Wall of Flesh.'])
      expect(r.assumptions.map((a) => a.id)).not.toContain('demon-heart')
      expect(r.assumptions.map((a) => a.id)).toContain('demon-heart-closed')
    }
  })

  it('once the Wall of Flesh is marked: counted, with the Demon Heart assumption (its wiki source) — the chip toggles with tracking', () => {
    const r = analyze({ bossId: 'queen-slime', difficulty: 'expert', progress: defeated('wall-of-flesh'), loadout: inSlot(5) })
    expect(r.demonHeart).toEqual({ slotIndex: 5, gateMet: true })
    expect(r.entries[0]).toMatchObject({ name: 'Feral Claws', counted: true })
    expect(r.assumptions.find((a) => a.id === 'demon-heart')?.sourceUrl).toBe('https://terraria.wiki.gg/wiki/Demon_Heart')
    // the Master Mode slot (index 5) needs no Demon Heart
    expect(analyze({ bossId: 'king-slime', difficulty: 'master', loadout: inSlot(5) }).entries[0].counted).toBe(true)
  })
})

describe('Improve My Build (P5-S7): tracked-only pools, strict improvement, the target-boss cap', () => {
  const r = improve(PLANTERA_INPUT)
  const group = (target: string) => r.groups.find((g) => g.target === target) as ImproveResult['groups'][number]

  it('weapon: obtainable-now melee weapons that beat 189.7/s against Plantera; gated ones grouped by the exact boss; nothing gated by Plantera or later', () => {
    const g = group('weapon')
    expect(g.obtainable.length).toBeGreaterThan(0)
    for (const s of g.obtainable) {
      expect(s.availability.status).toBe('yes')
      expect(s.value).toBeGreaterThan(189.7)
      expect(DATA.weapons.get(s.id)?.damageClass).toBe('melee')
    }
    expect(g.disclosure.capped).toBeGreaterThan(0)
    const cap = targetCapNodes(graph, 'plantera')
    for (const gg of g.gated) for (const s of gg.items) expect(isCappedByTarget(DATA.weapons.get(s.id) as Weapon, cap)).toBe(false)
  })

  it('accessories respect the slot count (Expert: 6, the Demon Heart slot open after the Wall of Flesh) and fill empty slots only with positive points', () => {
    const g = group('accessory')
    for (const s of g.obtainable) {
      expect(s.replaces).toBeUndefined()
      expect(s.value).toBeGreaterThan(0)
    }
    // the gated Leaf Wings fill no slot, but the slot they occupy isn't free either
    const full = improve({ ...PLANTERA_INPUT, loadout: { ...PLANTERA_INPUT.loadout, accessories: [id('Warrior Emblem'), id('Lightning Boots'), id('Leaf Wings'), id('Hermes Boots'), id('Cloud in a Bottle'), id('Shiny Red Balloon'), null] } })
    const acc = full.groups.find((x) => x.target === 'accessory')
    expect(acc?.obtainable.every((s) => s.replaces?.name === 'Warrior Emblem')).toBe(true)
  })

  it('healing appears only when the loadout has none; potions never repeat what you carry', () => {
    expect(group('healing').obtainable.map((s) => s.name)).toEqual(['Healing Potion', 'Restoration Potion', 'Bottled Honey'])
    const withHealing = improve({ ...PLANTERA_INPUT, loadout: { ...PLANTERA_INPUT.loadout, buffs: [id('Healing Potion'), id('Ironskin Potion')] } })
    expect(withHealing.groups.some((x) => x.target === 'healing')).toBe(false)
    expect(withHealing.groups.find((x) => x.target === 'potion')?.obtainable.map((s) => s.name)).not.toContain('Ironskin Potion')
  })

  it('class choice is respected: a summoner is offered whips, never a minion staff, never a sword', () => {
    const summon = improve({ ...PLANTERA_INPUT, cls: 'summon', loadout: emptyLoadout() })
    for (const s of summon.groups.find((x) => x.target === 'weapon')?.obtainable ?? []) expect(DATA.weapons.get(s.id)?.tags).toContain('whips')
  })
})

describe('gated suggestions rank nearest gate first (AMENDMENTS-015 B94(5)); ties keep the §4.6 order', () => {
  const distance = (missing: readonly string[], progress: TrackedProgress) => gateDistance(graph, effectiveProgress(graph, progress), missing)

  it('a fresh world facing the Eye of Cthulhu: King Slime / Wall of Flesh / Eater of Worlds upgrades come before Queen Slime / Duke Fishron ones; the Moon Lord weapons that top the damage order sink past the cut, counted', () => {
    const r = improve({ bossId: 'eye-of-cthulhu' })
    const group = (target: string) => r.groups.find((g) => g.target === target) as ImproveResult['groups'][number]
    expect(group('armor').gated.map((g) => g.missing)).toEqual([['king-slime'], ['wall-of-flesh'], ['queen-slime']])
    expect(group('accessory').gated.map((g) => g.missing)).toEqual([['eater-of-worlds'], ['wall-of-flesh'], ['duke-fishron']])
    expect(group('armor').gated.map((g) => distance(g.missing, defeated()))).toEqual([1, 1, 2])
    const weapon = group('weapon')
    expect(weapon.gated.flatMap((g) => g.missing)).not.toContain('moon-lord')
    expect(weapon.gated.flatMap((g) => g.items).length).toBe(3)
    expect(weapon.disclosure.gatedNotListed).toBeGreaterThan(0)
    expect(plain(weapon.disclosureText)).toContain(`${weapon.disclosure.gatedNotListed} more gated upgrades beyond the 3 listed`)
  })

  it('early Pre-Hardmode (Eye of Cthulhu + King Slime marked) vs Skeletron, ranged: Wall of Flesh / Deerclops / Queen Bee weapons, not the Plantera / Empress of Light ones', () => {
    const progress = defeated('eye-of-cthulhu', 'king-slime')
    const r = improve({ bossId: 'skeletron', cls: 'ranged', progress })
    const weapon = r.groups.find((g) => g.target === 'weapon') as ImproveResult['groups'][number]
    const gates = weapon.gated.flatMap((g) => g.missing)
    expect(gates).not.toContain('plantera')
    expect(gates).not.toContain('empress-of-light')
    for (const g of weapon.gated) expect(distance(g.missing, progress)).toBe(1)
  })

  it('over many states: groups run in non-decreasing gate distance; within a group (one gate), the §4.6 order (value desc)', () => {
    const random = prng(0xd15)
    for (let run = 0; run < 40; run++) {
      const input = randomInput(random)
      const r = improve({ ...input, bossId: input.bossId as string })
      for (const g of r.groups) {
        const d = g.gated.map((x) => distance(x.missing, input.progress))
        expect(d, `run ${run} ${g.target}`).toEqual([...d].sort((a, b) => a - b))
        for (const x of g.gated) for (let i = 1; i < x.items.length; i++) expect(x.items[i - 1].value, `run ${run}`).toBeGreaterThanOrEqual(x.items[i].value)
        // a cut is only ever made on a full list
        if (g.disclosure.gatedNotListed > 0) expect(g.gated.flatMap((x) => x.items).length, `run ${run}`).toBe(3)
      }
    }
  })
})

describe('world evil "Both" (AMENDMENTS-015 B96a): a marked evil boss counts in the analysis and the suggestions, as on the map', () => {
  const both = (...ids: string[]): TrackedProgress => ({ worldEvil: null, nodeStates: Object.fromEntries(ids.map((n) => [n, 'defeated' as const])) })
  const distance = (missing: readonly string[], progress: TrackedProgress) => gateDistance(graph, effectiveProgress(graph, progress), missing)

  it('analysis: the owned Worm Scarf is available once the Eater of Worlds is marked — no line names the boss as a gate; unmarked, its info line does', () => {
    const input = { bossId: 'skeletron', loadout: loadout({ accessories: [id('Worm Scarf')] }) }
    const marked = analyze({ ...input, progress: both('eye-of-cthulhu', 'eater-of-worlds') })
    expect(marked.entries[0].availability).toMatchObject({ status: 'yes', missing: [] })
    expect(marked.factors.flatMap((f) => f.lines).filter((l) => l.evidence.includes('boss:eater-of-worlds'))).toEqual([])
    expect(marked.assumptions.map((a) => a.id)).not.toContain('owned-gated')
    const unmarked = analyze({ ...input, progress: both('eye-of-cthulhu') })
    expect(unmarked.entries[0].availability).toMatchObject({ status: 'gated', missing: ['eater-of-worlds'] })
    expect(line(unmarked, 'synergy.owned-gated')?.evidence).toContain('boss:eater-of-worlds')
  })

  it('suggestions: no GatedSection is keyed by the marked Eater of Worlds (distance 0); Brain of Cthulhu sections rank as an open boss (distance 1)', () => {
    const before = improve({ bossId: 'skeletron', progress: both('eye-of-cthulhu') })
    const beforeGates = before.groups.flatMap((g) => g.gated.flatMap((x) => x.missing))
    expect(beforeGates).toContain('eater-of-worlds') // the comparison below isn't vacuous
    const progress = both('eye-of-cthulhu', 'eater-of-worlds')
    const after = improve({ bossId: 'skeletron', progress })
    const keys = after.groups.flatMap((g) => g.gated.map((x) => x.missing))
    expect(keys.flat()).not.toContain('eater-of-worlds')
    expect(distance(['eater-of-worlds'], progress)).toBe(0)
    for (const k of keys.filter((k) => k.includes('brain-of-cthulhu'))) expect(distance(k, progress)).toBe(1)
    // what the Eater of Worlds gated is obtainable now (or out-ranked), never still behind it
    for (const g of after.groups) for (const s of g.obtainable) expect(s.availability.missing).toEqual([])
  })

  it('a chosen world evil still filters the other world’s mark (B69/Q6 unchanged): Crimson + a marked Eater of Worlds keeps its items gated', () => {
    const r = analyze({ bossId: 'skeletron', loadout: loadout({ accessories: [id('Worm Scarf')] }), progress: { worldEvil: 'crimson', nodeStates: { 'eater-of-worlds': 'defeated' } } })
    expect(r.entries[0].availability).toMatchObject({ status: 'gated', missing: ['eater-of-worlds'] })
  })
})

describe('a chosen world evil (AMENDMENTS-015 B97a): Improve leaves out what needs the other world’s evil boss, counted in "Not shown"', () => {
  const world = (worldEvil: TrackedProgress['worldEvil'], ...ids: string[]): TrackedProgress => ({ worldEvil, nodeStates: Object.fromEntries(ids.map((n) => [n, 'defeated' as const])) })
  const gates = (r: ImproveResult) => r.groups.flatMap((g) => g.gated.flatMap((x) => x.missing))
  const otherWorldCount = (r: ImproveResult) => r.groups.reduce((n, g) => n + g.disclosure.otherWorld, 0)

  // Under "Both" the Eater of Worlds heads an accessory GatedSection here; no Brain of Cthulhu item makes
  // the per-group cut, so for the Corruption mirror the non-vacuous check is the disclosure count.
  it.each([
    ['crimson', 'eater-of-worlds', 'Eater of Worlds', true],
    ['corruption', 'brain-of-cthulhu', 'Brain of Cthulhu', false],
  ] as const)('%s world: nothing behind %s is suggested, marked or not; the disclosure counts them and names it; "Both" keeps them', (worldEvil, other, name, headedUnderBoth) => {
    const both = improve({ bossId: 'skeletron', progress: world(null, 'eye-of-cthulhu') })
    if (headedUnderBoth) expect(gates(both)).toContain(other) // the exclusion below isn't vacuous
    expect(otherWorldCount(both)).toBe(0)
    for (const g of both.groups) expect(plain(g.disclosureText)).not.toContain('other world')
    for (const marks of [['eye-of-cthulhu'], ['eye-of-cthulhu', other]]) {
      const r = improve({ bossId: 'skeletron', progress: world(worldEvil, ...marks) })
      expect(gates(r), marks.join('+')).not.toContain(other)
      expect(otherWorldCount(r), marks.join('+')).toBeGreaterThan(0)
      for (const g of r.groups) {
        for (const s of [...g.obtainable, ...g.gated.flatMap((x) => x.items)]) expect(s.availability.missing).not.toContain(other)
        const n = g.disclosure.otherWorld
        if (n > 0) expect(plain(g.disclosureText)).toContain(`${n} ${n === 1 ? 'that needs' : 'that need'} the other world’s evil boss (${name})`)
        else expect(plain(g.disclosureText)).not.toContain('other world')
      }
    }
  })

  it('the gate cut and the count stay honest: what needed the other world’s boss under "Both" is counted, not dropped', () => {
    const both = improve({ bossId: 'eye-of-cthulhu', progress: world(null) })
    const crimson = improve({ bossId: 'eye-of-cthulhu', progress: world('crimson') })
    for (const g of crimson.groups) {
      const b = both.groups.find((x) => x.target === g.target) as ImproveResult['groups'][number]
      // every candidate is accounted for exactly once: the considered pool is the same either way
      expect(g.disclosure.considered, g.target).toBe(b.disclosure.considered)
      if (b.gated.some((x) => x.missing.includes('eater-of-worlds'))) expect(g.disclosure.otherWorld, g.target).toBeGreaterThan(0)
    }
  })
})

describe('wording (AMENDMENTS-015 B96c/d): plural boss names agree; a quote that ends a line is punctuated; "Not shown" is one list', () => {
  it('The Twins charge, fly, fire, fight and are summoned — every boss verb agrees; a singular name keeps the singular', () => {
    const r = analyze({ bossId: 'the-twins', difficulty: 'expert', progress: defeated('wall-of-flesh'), loadout: loadout({ mainWeapon: id('Megashark') }) })
    expect(line(r, 'mobility.charges')?.text).toMatch(/^The Twins charge at you\. /)
    expect(line(r, 'mobility.flies')?.text).toMatch(/^The Twins fly\. /)
    expect(line(r, 'mobility.projectile-spam')?.text).toMatch(/^The Twins fire projectile barrages\. /)
    expect(line(r, 'mobility.multi-phase')?.text).toBe('The Twins fight in more than one phase. The stats this checker uses are their first form’s.')
    // the wiki's summon sentence ends with its own full stop: none is added after the closing mark
    expect(line(r, 'preparation.boss-summon')?.text).toMatch(/^The Twins are summoned with .+: The Twins can be summoned manually using a Mechanical Eye at night \(from 7:30 PM to 4:30 AM\)\.$/)
    for (const l of r.factors.flatMap((f) => f.lines)) expect(l.text, l.id).not.toMatch(/The Twins (charges|dashes|flies|fires|stays|burrows|teleports|fights|summons|inflicts|deals|has|is)\b/)
    const eoc = analyze({ bossId: 'eye-of-cthulhu' })
    expect(line(eoc, 'mobility.charges')?.text).toMatch(/^Eye of Cthulhu charges at you\. /)
    expect(line(eoc, 'mobility.multi-phase')?.text).toMatch(/are its first form’s\.$/)
  })

  it('a quoted fragment that ends a line or precedes a sentence gets its full stop; one that already has one doesn’t get a second', () => {
    expect(plain(f1Line('Shoots a deathly sickle'))).toBe('Not counted in this estimate: Sickle — Shoots a deathly sickle.')
    expect(plain(f1Line('Fires a beam.'))).toBe('Not counted in this estimate: Sickle — Fires a beam.')
    expect(plain(f1Line('“Who knew?”'))).toBe('Not counted in this estimate: Sickle — “Who knew?”')
  })

  it('"Not shown": one list, one clause per reason, separated by semicolons — never a run-on', () => {
    const boss: Segment = { kind: 'boss', id: 'plantera', text: 'Plantera' }
    expect(plain(improveCopy.disclosure(12, 3, 5, boss, 4, 3))).toBe('Not shown: 12 with Unknown availability; 3 without the verified stats to compare; 5 that need Plantera or a fight it opens; 4 more gated upgrades beyond the 3 listed.')
    expect(plain(improveCopy.disclosure(1, 0, 1, { kind: 'boss', id: 'the-twins', text: 'The Twins' }))).toBe('Not shown: 1 with Unknown availability; 1 that needs The Twins or a fight they open.')
    expect(improveCopy.disclosure(0, 0, 0, boss)).toEqual([])
    // B97a: the other world's evil boss, named and linked, in its own clause
    const eow: Segment = { kind: 'boss', id: 'eater-of-worlds', text: 'Eater of Worlds' }
    const withOther = improveCopy.disclosure(0, 0, 2, boss, 4, 3, { count: 7, bosses: [eow] })
    expect(plain(withOther)).toBe('Not shown: 2 that need Plantera or a fight it opens; 7 that need the other world’s evil boss (Eater of Worlds); 4 more gated upgrades beyond the 3 listed.')
    expect(withOther).toContainEqual(eow)
    expect(plain(improveCopy.disclosure(0, 0, 0, boss, 0, 0, { count: 1, bosses: [eow] }))).toBe('Not shown: 1 that needs the other world’s evil boss (Eater of Worlds).')
    expect(improveCopy.disclosure(0, 0, 0, boss, 0, 0, { count: 0, bosses: [] })).toEqual([])
  })
})

const f1Line = (behavior: string) => f1.uncounted({ kind: 'item', id: 1, text: 'Sickle' }, behavior)

/* Seeded sweep: random loadouts across bosses, classes, difficulties and tracked states. */
function prng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const BOSSES = (bossesJson as unknown as Boss[]).map((b) => b.id)
const BOSS_NODES = graph.nodes.filter((n) => n.kind === 'boss').map((n) => n.id)
const pick = <T>(random: () => number, list: readonly T[]): T => list[Math.floor(random() * list.length)]
const maybe = <T>(random: () => number, list: readonly T[], p = 0.6): T | null => (random() < p ? pick(random, list) : null)
const potions = items.filter((i) => i.category === 'potion')
const ammoItems = items.filter((i) => i.category === 'ammo')
const heads = armor.filter((a) => a.slot === 'head')
const chests = armor.filter((a) => a.slot === 'chest')
const legsList = armor.filter((a) => a.slot === 'legs')

function randomInput(random: () => number): ReadinessInput {
  const nodeStates: Record<string, 'defeated' | 'skipped'> = {}
  const density = random()
  for (const n of BOSS_NODES) if (random() < density) nodeStates[n] = random() < 0.9 ? 'defeated' : 'skipped'
  const accessoriesIds = Array.from({ length: MAX_ACCESSORY_SLOTS }, () => maybe(random, accessories, 0.5)?.id ?? null)
  return {
    bossId: pick(random, BOSSES),
    difficulty: pick(random, ['classic', 'expert', 'master'] as const),
    cls: pick(random, ['melee', 'ranged', 'magic', 'summon', 'hybrid'] as const),
    progress: { worldEvil: pick(random, ['corruption', 'crimson', null] as const), nodeStates },
    loadout: {
      mainWeapon: maybe(random, weapons, 0.85)?.id ?? null,
      altWeapon: maybe(random, weapons, 0.3)?.id ?? null,
      helmet: maybe(random, heads)?.id ?? null,
      chest: maybe(random, chests)?.id ?? null,
      legs: maybe(random, legsList)?.id ?? null,
      accessories: accessoriesIds,
      ammo: random() < 0.3 ? [pick(random, ammoItems).id] : [],
      buffs: Array.from({ length: Math.floor(random() * 4) }, () => pick(random, potions).id),
      summon: random() < 0.2 ? pick(random, weapons.filter((w) => w.tags.includes('minion-summon-items'))).id : null,
    },
    prepDone: random() < 0.5 ? Math.floor(random() * 8) : undefined,
  }
}

const segmentsOf = (r: ReadinessAnalysis): Segment[][] => [...r.factors.flatMap((f) => f.lines.map((l) => l.segments)), ...r.notCounted.map((n) => n.segments)]

function checkAnalysis(r: ReadinessAnalysis, input: ReadinessInput, label: string) {
  expect(r.factors.map((f) => f.id), label).toEqual(FACTOR_IDS)
  const all = r.factors.flatMap((f) => f.lines.map((l) => ({ factor: f.id, line: l })))
  // summary = exactly the easier / harder lines (§1.6)
  expect(r.summary.easier, label).toEqual(all.filter((x) => x.line.tone === 'easier'))
  expect(r.summary.harder, label).toEqual(all.filter((x) => x.line.tone === 'harder'))
  const ids = new Set<string>()
  for (const { factor: fid, line: l } of all) {
    expect(l.text.length, label).toBeGreaterThan(0)
    expect(l.text, label).toBe(l.segments.map((s) => s.text).join(''))
    expect(ids.has(l.id), `${label}: duplicate line id ${l.id}`).toBe(false)
    ids.add(l.id)
    // every estimate resolves to a populated AssumptionsTip (UX_SPEC §8)
    for (const s of l.segments) if (s.kind === 'num' && s.estimate) expect(r.estimates[s.estimate]?.length ?? 0, `${label}: ${l.id}`).toBeGreaterThan(0)
    if (fid === 'mobility' && l.tone !== 'unknown') expect(l.editorial, `${label}: ${l.id}`).toBe(true)
    expect(l.evidence.every((e) => /^(i:\d+|(boss|set|cond|buff):[a-z0-9-]+)$/.test(e)), label).toBe(true)
  }
  // owned items count whatever their gating (B94(1)): a slot goes uncounted only for a slot reason; every
  // counted item gated for the user (tracked only) is named, with its bosses, in exactly one info line
  const ep = effectiveProgress(graph, input.progress)
  const ownedGated = all.filter((x) => /\.owned-gated(\.\d+)?$/.test(x.line.id))
  for (const e of r.entries) {
    if (!e.counted) expect(['demon-heart', 'duplicate', 'wrong-slot', 'missing-from-dataset'], `${label}: ${e.name}`).toContain(e.reason)
    const record = ALL.find((x) => x.id === e.id)
    if (!record) continue
    const a = availabilityOf(record, graph, ep)
    expect(e.availability, `${label}: ${e.name}`).toEqual(a)
    const naming = ownedGated.filter((x) => x.line.evidence.includes(`i:${e.id}`))
    if (e.counted && a.status === 'gated') {
      expect(naming.length, `${label}: ${e.name}`).toBe(1)
      expect(naming[0].line.tone, label).toBe('info')
      for (const b of a.missing) expect(naming[0].line.evidence, `${label}: ${e.name}`).toContain(`boss:${b}`)
    } else if (!r.entries.some((o) => o.id === e.id && o.counted && o.availability.status === 'gated')) {
      expect(naming, `${label}: ${e.name}`).toEqual([])
    }
  }
  // accessories beyond the difficulty's slots are never analyzed
  expect(r.entries.filter((e) => e.slot.kind === 'accessory' && e.slot.index >= SLOT_COUNT[input.difficulty]), label).toEqual([])
  // the copy audit over our own words (wiki quotes removed)
  for (const segs of segmentsOf(r)) expect(auditCopy(ownWords(segs)), `${label}: ${ownWords(segs)}`).toBeUndefined()
  for (const a of [...r.assumptions, ...Object.values(r.estimates).flat()]) expect(auditCopy(`${a?.title} ${a?.detail}`), label).toBeUndefined()
}

function checkImprove(r: ImproveResult, input: ReadinessInput, label: string) {
  const ep = effectiveProgress(graph, input.progress)
  const boss = DATA.bosses.get(input.bossId as string) as Boss
  const cap = targetCapNodes(graph, boss.nodeId)
  const chosen = input.progress.worldEvil
  // B97a: with a world evil chosen, the other world's evil boss is out of the modeled world
  const otherWorld = new Set(graph.nodes.filter((n) => chosen !== null && n.worldEvil !== undefined && n.worldEvil !== chosen).map((n) => n.id))
  for (const g of r.groups) {
    if (chosen === null) expect(g.disclosure.otherWorld, label).toBe(0)
    for (const s of g.obtainable) {
      expect(s.availability.status, label).toBe('yes')
      expect(s.value, label).toBeGreaterThan(s.current)
      const records = s.pieces ? s.pieces.map((p) => ALL.find((x) => x.id === p)) : [ALL.find((x) => x.id === s.id)]
      for (const rec of records) {
        expect(availabilityOf(rec as Item, graph, ep).status, `${label}: ${s.name}`).toBe('yes')
        expect(isCappedByTarget(rec as Item, cap), label).toBe(false)
      }
    }
    for (const gg of g.gated) {
      expect(gg.missing.length, label).toBeGreaterThan(0)
      // B96a: a heading never names a boss whose tracked defeat counts (under "Both": any marked boss)
      for (const m of gg.missing) expect(trackedDefeats(graph, input.progress).has(m), `${label}: ${m}`).toBe(false)
      // B97a: nor, with a world evil chosen, the other world's evil boss (marked or not)
      for (const m of gg.missing) expect(otherWorld.has(m), `${label}: ${m}`).toBe(false)
      for (const s of gg.items) {
        expect(s.availability.status, label).toBe('gated')
        expect(s.availability.missing, label).toEqual(gg.missing)
        expect(s.value, label).toBeGreaterThan(s.current)
      }
    }
    expect(g.obtainable.length, label).toBeLessThanOrEqual(3)
    for (const segs of [g.basis, g.disclosureText, g.empty ?? [], ...g.obtainable.map((s) => s.rationale), ...g.gated.flatMap((x) => x.items.map((s) => s.rationale))]) {
      expect(auditCopy(ownWords(segs)), `${label}: ${ownWords(segs)}`).toBeUndefined()
    }
    for (const s of [...g.obtainable, ...g.gated.flatMap((x) => x.items)]) for (const seg of s.rationale) if (seg.kind === 'num' && seg.estimate) expect(r.estimates[seg.estimate]?.length ?? 0, label).toBeGreaterThan(0)
  }
}

describe('invariants over many states (seeded sweep) + determinism', () => {
  it('analysis: summary = easier ∪ harder, estimates paired, ids unique, gating honored, copy audit clean', () => {
    const random = prng(0x5e7)
    for (let run = 0; run < 250; run++) {
      const input = randomInput(random)
      const r = analyzeReadiness(input, DATA)
      if ('error' in r) throw new Error('every shipped boss has a record')
      checkAnalysis(r, input, `run ${run} ${input.bossId} ${input.cls} ${input.difficulty}`)
    }
  })

  it('suggestions: obtainable-now only, strictly better, never capped; gated ones keyed by their exact bosses; copy audit clean', () => {
    const random = prng(0xb00)
    let leftOut = 0
    for (let run = 0; run < 60; run++) {
      const input = randomInput(random)
      const r = improve({ ...input, bossId: input.bossId as string })
      checkImprove(r, input, `run ${run} ${input.bossId} ${input.cls}`)
      leftOut += r.groups.reduce((n, g) => n + g.disclosure.otherWorld, 0)
    }
    expect(leftOut).toBeGreaterThan(0) // the sweep covers chosen worlds where B97a leaves items out
  })

  it('deterministic: the same inputs give identical output', () => {
    expect(analyzeReadiness(PLANTERA_INPUT, DATA)).toEqual(analyzeReadiness(PLANTERA_INPUT, DATA))
    expect(improveSuggestions(PLANTERA_INPUT, DATA)).toEqual(improveSuggestions(PLANTERA_INPUT, DATA))
  })
})
