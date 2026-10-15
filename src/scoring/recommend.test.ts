/* Loadout builder engine (SCORING_SPEC §3, §4, §5.1, §8; PRD P4-S2; AMENDMENTS-014 B68–B71,
 * AMENDMENTS-015 B94(3)/B97a, AMENDMENTS-016 B101): constants v2 (the §4.4 template), hand-derived
 * goldens over a checked-in fixture (ranking, DPP with ammo, GOAL_WEIGHTS armor scores, accessory
 * quotas + constraints, buffs, summon, tracked ∪ virtual availability, target cap, owned-unknown,
 * other-world exclusion, pins, swap options, gated track, profile), the §9.1 worked example's
 * components on live records (v2 re-pin: classSynergy 78), and invariants + copy audit over a
 * sweep of the live dataset (no hard counts — the dataset may be regenerated under these tests). */
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
import type { Difficulty, Goal, LoadoutClass, Stage } from '../schemas'
import { getField } from '../schemas/getField'
import * as builderCopy from './builderCopy'
import { availabilityOf } from './candidates'
import {
  BUFF_SLOTS,
  CATEGORY_TEMPLATE,
  categoryTemplate,
  DEMON_HEART_SLOT_INDEX,
  GATED_PER_SLOT,
  SCORING_CONSTANTS_VERSION,
  SLOT_COUNT,
  SPECIAL_SCOPE_CHANGELOG,
  SPECIAL_SCOPE_KEYWORDS,
  SPECIAL_SCOPE_VERSION,
  WORLD_EVIL_CONDITION,
} from './constants'
import { auditCopy } from './copyAudit'
import { scoreBuild } from './goals'
import { effectiveProgress, isNodeSatisfied, type TrackedProgress } from './progress'
import { damagePotential, isSummonStaff, specialFits, specialScope, weaponProfile } from './proxies'
import type { ReadinessData } from './readiness'
import { ownWords, plain, type Segment } from './readinessCopy'
import { ACCESSORY_SLOT_IDS, recommendLoadout, slotOptions, variantFits, type BuilderInput, type BuilderResult, type Pins, type SlotResult } from './recommend'
import { FIXTURE_DATA } from './testing/builderFixture'

const NONE: TrackedProgress = { worldEvil: null, nodeStates: {} }
const input = (o: Partial<BuilderInput> = {}): BuilderInput => ({ stage: 'early-prehm', cls: 'melee', difficulty: 'classic', goal: 'boss', bossId: null, owned: [], progress: NONE, ...o })
const slot = (r: BuilderResult, id: string) => r.slots.find((s) => s.id === id) as SlotResult
const pickName = (r: BuilderResult, id: string) => slot(r, id).pick?.name
const fx = (o: Partial<BuilderInput> = {}) => recommendLoadout(input(o), FIXTURE_DATA)

describe('constants v2: the §4 builder constants (B38 discipline)', () => {
  it('CATEGORY_TEMPLATE is §4.4 row for row; extension repeats the extra quota, balanced rotates', () => {
    expect(CATEGORY_TEMPLATE).toEqual({
      boss: { base: ['off', 'off', 'mob', 'def', 'off'], extra: 'off' },
      'max-damage': { base: ['off', 'off', 'off', 'off', 'mob'], extra: 'off' },
      exploration: { base: ['mob', 'mob', 'util', 'def', 'off'], extra: 'mob' },
      survivability: { base: ['def', 'def', 'mob', 'off', 'def'], extra: 'def' },
      mobility: { base: ['mob', 'mob', 'mob', 'util', 'def'], extra: 'mob' },
      balanced: { base: ['off', 'def', 'mob', 'util', 'off'], extra: 'rotate' },
    })
    expect(categoryTemplate('boss', 7)).toEqual(['off', 'off', 'mob', 'def', 'off', 'off', 'off'])
    expect(categoryTemplate('balanced', 7)).toEqual(['off', 'def', 'mob', 'util', 'off', 'off', 'def'])
    expect(categoryTemplate('exploration', 5)).toEqual(['mob', 'mob', 'util', 'def', 'off'])
    expect([BUFF_SLOTS, GATED_PER_SLOT, SCORING_CONSTANTS_VERSION]).toEqual([3, 3, 2])
  })
})

describe('fixture goldens: Early Pre-Hardmode melee, Classic, boss goal, nothing marked', () => {
  const r = fx()

  it('availability = tracked ∪ virtual: Early Pre-HM implies no defeats', () => {
    expect(r.progress).toEqual({ tracked: [], virtual: [], capped: [] })
  })

  it('§4.1 main weapon: highest DPP of the eligible pool; a tie decided by the §4.6 order (lower rarity) and shown', () => {
    const main = slot(r, 'main')
    expect(main.pick).toMatchObject({ name: 'Spear X', source: 'recommended', availability: { status: 'yes' } })
    // 12 damage × (60 / 20 ticks) × 1.04 = 37.44
    expect(main.pick?.score?.value).toBeCloseTo(37.44, 10)
    expect(main.pick?.score?.formulaText).toBe('12 damage per hit × 3 hits per second × 1.04 for critical hits ≈ 37.4 per second')
    expect(main.alternatives.map((a) => [a.name, a.tied])).toEqual([
      ['Iron Blade', true],
      ['Copper Blade', false],
    ])
    expect(plain(main.pick?.rationale ?? [])).toBe(
      'Highest estimated damage per second of the 3 melee weapons verified obtainable at your progress. Same score as Iron Blade; a fixed tie-break order (fewer boss gates, lower rarity, lower item ID) put this one first.',
    )
    // pool disclosure: unknown gating excluded, gated kept for the gated track, Unknown damage excluded
    expect(main.pool).toEqual({ considered: 8, eligible: 3, owned: 0, unknown: 1, gated: 3, unverified: 1, unqualified: 0, otherWorld: 0, otherWorldCondition: 0 })
    expect(plain(main.disclosure ?? [])).toBe(
      'Scored from 3 candidates verified obtainable at your progress. Left out: 1 with Unknown availability; 3 behind a boss outside your progress; 1 without the verified stats to score.',
    )
    // the DPP estimate carries its AssumptionsTip, the §2.2 sentence verbatim first
    expect(main.pick?.score?.estimate).toBe('dpp')
    expect(main.pick?.score?.assumptions?.[0]?.detail).toBe(
      'Single target, point-blank, target defense 0, no damage variance, no reforge modifiers, one hit per melee swing, projectile/DoT side effects not counted, held-attack rate.',
    )
    // B101a: no auto-reuse → the in-cell qualifier
    expect(main.pick?.score?.qualifier).toBe('One click per attack')
  })

  it('§4.2 alt weapon: the next-ranked with a different weapon type (tags[0]), its kind in plain words (B108 nit)', () => {
    expect(pickName(r, 'alt')).toBe('Iron Blade')
    expect(plain(slot(r, 'alt').pick?.rationale ?? [])).toBe('Next-highest estimated damage per second from a different kind of weapon than your main one — this one is a broadsword — as a second option.')
    // no slug jargon: a tag without plain words isn't named at all
    expect(plain(builderCopy.rationale.altType(builderCopy.weaponKind(undefined)))).toBe('Next-highest estimated damage per second from a different kind of weapon than your main one, as a second option.')
    expect(builderCopy.weaponKind('magic-guns')).toBe('a magic gun')
  })

  it('§4.3 armor: ArmorScore with the goal’s GOAL_WEIGHTS — boss picks Ninja, survivability picks Tank', () => {
    const armor = slot(r, 'armor')
    // boss weights: 0.1 × (7 defense) + 0.45 × 5 offense (crit) + 0.15 × 20 mobility + 0.2 × 0 = 5.95
    expect(armor.pick).toMatchObject({ name: 'Ninja armor', setId: 'ninja', pieces: [110, 111, 112] })
    expect(armor.pick?.score?.value).toBeCloseTo(5.95, 10)
    expect(armor.pick?.score?.formulaText).toBe('0.1 × 7 defense + 0.45 × 5 offense + 0.15 × 20 mobility + 0.2 × 0 survivability = 5.95')
    // Tank 0.1 × (16 + 2 × 5 DR) + 0.2 × 10 = 4.6; Duo 0.1 × 6 + 0.45 × 8 = 4.2; Wood 0.1 × 3 + 0.2 × 1 = 0.5
    expect(armor.alternatives.map((a) => [a.name, a.score.text])).toEqual([
      ['Tank armor', '4.6'],
      ['Duo armor', '4.2'],
      ['Wood armor', '0.5'],
    ])
    // the set-bonus special is named, not scored
    expect(armor.pick?.score?.effects.filter((e) => e.status === 'special').map((e) => e.text)).toEqual(['Allows the ability to dash'])
    // survivability weights: Tank 0.35 × (16 + 2×5 DR) + 0.35 × 10 = 12.6 beats Ninja 4.95
    const surv = fx({ goal: 'survivability' })
    expect(pickName(surv, 'armor')).toBe('Tank armor')
    expect(slot(surv, 'armor').pick?.score?.value).toBeCloseTo(12.6, 10)
    // class eligibility (B52 classes[]): the magic-only set is never a melee candidate
    expect(slot(r, 'armor').pool?.considered).toBe(5)
  })

  it('§4.4 accessories: quota template, qualification (points or a special), ranking, tie-free picks', () => {
    expect(ACCESSORY_SLOT_IDS.slice(0, SLOT_COUNT.classic).map((id) => [slot(r, id).quota, pickName(r, id)])).toEqual([
      ['off', 'Warrior Emblem'],
      ['off', 'Feral Claws'],
      ['mob', 'Wings B'],
      ['def', 'Shield'],
      ['off', 'Volatile Gel'],
    ])
    // Ranger Emblem (ranged-scoped), the fishing accessory and the Mana Charm (B108(a): its only effect is tied to magic)
    // have no counted benefit for melee: unqualified. The Yoyo String's unscored effect is melee's own: it qualifies.
    expect(slot(r, 'acc0').pool).toMatchObject({ eligible: 10, unknown: 1, gated: 2, unqualified: 3 })
    // a special-only pick says so
    expect(plain(slot(r, 'acc4').pick?.rationale ?? [])).toBe(
      'No offense accessory with counted points for your class is left for this slot. This one adds 0 counted points — its effect is not scored: Releases volatile gelatin periodically.',
    )
    expect(slot(r, 'acc4').pick?.zeroPoints).toBe(true)
    expect(r.zeroPoint).toEqual([{ key: 'i:204', id: 204, name: 'Volatile Gel', slot: 'acc4', specials: ['Releases volatile gelatin periodically'] }])
    // the defense quota counts Def + Surv points: Shield 2 + 2
    expect(slot(r, 'acc3').pick?.score?.formulaText).toBe('2 defense + 2 survivability = 4 defense and survivability points')
    // wings: flight read from wingStats (150 ticks → 15 mobility points)
    expect(slot(r, 'acc2').pick?.score?.value).toBe(15)
  })

  it('§4.5 buffs: by summed class points, ≤ 3, never the same buff twice; healing-only potions are not buff potions', () => {
    expect(['buff0', 'buff1', 'buff2'].map((id) => pickName(r, id))).toEqual(['Swift Potion', 'Iron Potion', 'Rage Potion'])
    expect(slot(r, 'buff0').alternatives[0]).toMatchObject({ name: 'Swift Potion II', tied: true })
    expect(slot(r, 'buff0').pool).toMatchObject({ considered: 5, eligible: 4, unqualified: 1 })
  })

  it('§4.5 summon slot: by base damage (not DPP), with the minion-AI note', () => {
    const summon = slot(r, 'summon')
    expect(summon.pick).toMatchObject({ name: 'Finch Staff' })
    expect(summon.pick?.score).toMatchObject({ kind: 'damage', value: 7, label: 'Base damage' })
    expect(plain(summon.pick?.rationale ?? [])).toMatch(/attack rate varies by minion AI — not estimated/)
  })

  it('ammo: a weapon that fires none gets the designed empty state', () => {
    expect(slot(r, 'ammo0')).toMatchObject({ state: 'empty' })
    expect(plain(slot(r, 'ammo0').empty ?? [])).toBe('Your main weapon doesn’t fire ammo.')
  })

  it('§4.7 gated track: items that would outrank the pick, grouped by the exact bosses missing, each with the obtainable-now alternative', () => {
    expect(r.gated.map((g) => [g.missing, g.entries.map((e) => [e.slot, e.name, e.alternative?.name])])).toEqual([
      [['evil-c'], [['main', 'Evil Blade', 'Spear X'], ['def', 'Evil Scarf', 'Shield']]],
      [['mech'], [['main', 'Mech Blade', 'Spear X'], ['summon', 'Bigger Staff', 'Finch Staff']]],
      // "hardmode" (a milestone) resolves to the boss that opens it
      [['wall-of-flesh'], [['main', 'Hard Blade', 'Spear X'], ['off', 'Avenger Emblem', 'Warrior Emblem']]],
    ])
    for (const g of r.gated) for (const e of g.entries) expect(e.availability).toMatchObject({ status: 'gated', missing: g.missing })
  })

  it('§5.1 profile (components only for one build): EDO with the gear’s bonuses, defense, mobility, survivability, synergy', () => {
    const c = Object.fromEntries(r.profile.components.map((x) => [x.id, x]))
    // (12 × 1.15) × 3 × 1.12 (Feral Claws melee speed) × 1.19 (4 + 5 hood + 10 Rage) = 55.18
    expect(c.estDamage.value).toBeCloseTo(12 * 1.15 * 3 * 1.12 * 1.19, 10)
    expect(c.estDamage.estimate).toBe('edo')
    expect(r.profile.estimates.edo?.length).toBeGreaterThan(0)
    expect(c.defense).toMatchObject({ value: 17, formulaText: '7 from armor pieces + 10 from effects = 17' })
    expect(c.mobility.value).toBe(60) // 20 (set) + 25 (Swift) + 15 (Wings B)
    expect(c.survivability.value).toBe(17)
    expect(c.classSynergy).toMatchObject({ value: 100, text: '100' })
    // no composite for one build (§5.3): the shape has no composite value
    expect(Object.keys(r.profile)).not.toContain('composite')
    expect(r.profile.components.map((x) => x.weight)).toEqual([0.45, 0.1, 0.15, 0.2, 0.1])
  })

  it('the loadout (DATA_SCHEMA_SPEC §8a LoadoutSlots, 7 accessory entries) and the build-level assumptions', () => {
    expect(r.loadout).toEqual({ mainWeapon: 3, altWeapon: 2, helmet: 110, chest: 111, legs: 112, accessories: [200, 203, 207, 208, 204, null, null], ammo: [], buffs: [300, 301, 302], summon: 30 })
    expect(r.assumptions.map((a) => a.id)).toEqual(['progress', 'availability', 'world-evil', 'potions', 'weights'])
    expect(r.assumptions.at(-1)?.title).toBe('Weights v2 — editorial constants')
  })

  it('is deterministic (same inputs ⇒ identical output)', () => {
    expect(fx()).toEqual(r)
  })
})

describe('fixture goldens: Early Hardmode ranged, Expert, Crimson world', () => {
  const r = fx({ stage: 'early-hm', cls: 'ranged', difficulty: 'expert', progress: { worldEvil: 'crimson', nodeStates: {} } })

  it('the stage contributes VirtualDefeats (the Wall of Flesh) — unlike Feature A’s tracked-only availability', () => {
    expect(r.progress).toEqual({ tracked: [], virtual: ['wall-of-flesh'], capped: [] })
  })

  it('ammo weapons are scored with the highest-damage obtainable ammo (Silver Bullet opens with Hardmode)', () => {
    // (10 + 8) × 6 × 1.04 = 112.32
    expect(slot(r, 'main').pick).toMatchObject({ name: 'Pistol' })
    expect(slot(r, 'main').pick?.score?.value).toBeCloseTo(112.32, 10)
    expect(slot(r, 'ammo0').pick).toMatchObject({ name: 'Silver Bullet' })
    expect(slot(r, 'ammo0').alternatives.map((a) => a.name)).toEqual(['Musket Ball'])
    // the Bow's only arrow has Unknown damage: scored without ammo, said
    expect(slot(r, 'alt').pick?.score).toMatchObject({ noAmmo: true })
    expect(slot(r, 'alt').pick?.score?.assumptions?.find((a) => a.id === 'dpp-ammo')?.title).toBe('Scored without ammo')
    expect(slot(r, 'ammo1')).toMatchObject({ state: 'empty', ammoFor: 'alt', pool: { unverified: 1 } })
    expect(r.loadout.ammo).toEqual([21])
    // at Early Pre-HM the same pistol fires Musket Balls: (10 + 5) × 6 × 1.04
    expect(fx({ cls: 'ranged' }).slots[0].pick?.score?.value).toBeCloseTo(93.6, 10)
  })

  it('B52 hybrid sets: a melee/ranged variant is a ranged candidate (and a melee one), never a magic one', () => {
    expect(slot(r, 'armor').pick).toMatchObject({ name: 'Duo armor' })
    const duo = FIXTURE_DATA.sets.get('duo')?.variants[0]
    if (!duo) throw new Error('fixture')
    expect((['melee', 'ranged', 'magic', 'summon', 'hybrid'] as const).map((c) => variantFits(duo, c))).toEqual([true, true, false, false, true])
  })

  it('accessory constraints: never co-equip a direct combinedFrom / upgradesTo pair; an unfillable quota falls back to any category (disclosed); the Demon Heart slot is filled once the Wall of Flesh is in progress', () => {
    const acc = ACCESSORY_SLOT_IDS.slice(0, SLOT_COUNT.expert).map((id) => slot(r, id))
    expect(acc.map((s) => [s.quota, s.pick?.name, s.fallback ?? false])).toEqual([
      ['off', 'Ranger Emblem', false],
      ['off', 'Volatile Gel', false], // Avenger Emblem is combined from Ranger Emblem: not co-equipped
      ['mob', 'Wings B', false],
      ['def', 'Shield', false],
      ['off', 'Boots', true],
      ['off', 'Band', true],
    ])
    expect(acc[5].demonHeart).toBe(true)
    expect(plain(acc[4].pick?.rationale ?? [])).toBe('No offense accessory qualifies for this slot, so this is the highest-scoring accessory of any category (8 counted points).')
    expect(r.assumptions.map((a) => a.id)).toContain('demon-heart')
  })

  it('B97a: with a world evil chosen, items behind the other world’s evil boss are out of the modeled world — counted, never in the gated track', () => {
    expect(slot(r, 'acc0').pool?.otherWorld).toBe(1)
    expect(r.gated.flatMap((g) => g.missing)).not.toContain('evil-c')
    // under "Both" (no world evil chosen) the same scarf is an ordinary gated item
    const both = fx({ stage: 'early-hm', cls: 'ranged', difficulty: 'expert' })
    expect(slot(both, 'acc0').pool?.otherWorld).toBe(0)
    expect(both.gated.find((g) => g.missing.join() === 'evil-c')?.entries.map((e) => e.name)).toEqual(['Evil Scarf'])
    // marked defeated in a Corruption world: it counts
    const marked = fx({ stage: 'early-hm', cls: 'ranged', difficulty: 'expert', progress: { worldEvil: 'corruption', nodeStates: { 'evil-c': 'defeated' } } })
    expect(marked.progress.tracked).toEqual(['evil-c'])
    expect(ACCESSORY_SLOT_IDS.slice(0, SLOT_COUNT.expert).map((id) => pickName(marked, id))).toContain('Evil Scarf')
  })
})

describe('fixture goldens: classes, the Demon Heart slot, target boss, ownership, pins', () => {
  it('Expert before the Wall of Flesh: the Demon Heart slot is a locked slot with its gate, never filled', () => {
    const r = fx({ cls: 'ranged', difficulty: 'expert' })
    const dh = slot(r, ACCESSORY_SLOT_IDS[DEMON_HEART_SLOT_INDEX.expert as number])
    expect(dh).toMatchObject({ state: 'locked', demonHeart: true })
    expect(plain(dh.empty ?? [])).toBe('The Demon Heart slot opens after you defeat Wall of Flesh (Expert and Master: the Demon Heart comes from its Treasure Bag).')
    expect(r.loadout.accessories[5]).toBeNull()
    expect(r.assumptions.map((a) => a.id)).not.toContain('demon-heart')
  })

  it('hybrid: any class; the alt differs in damage class; B101a qualifier on a used-up explosive', () => {
    const r = fx({ cls: 'hybrid' })
    expect(slot(r, 'main').pick).toMatchObject({ name: 'Bomb' })
    expect(slot(r, 'main').pick?.score).toMatchObject({ value: 150, qualifier: 'One click per throw · uses 1.5/s · blast and fuse not counted' })
    expect(slot(r, 'main').pick?.score?.assumptions?.map((a) => a.id)).toEqual(['dpp-base', 'dpp-formula', 'dpp-rate', 'dpp-clicks', 'dpp-usage', 'dpp-explosive', 'dpp-crit', 'dpp-proxy'])
    expect(slot(r, 'alt').pick).toMatchObject({ name: 'Pistol' })
    expect(slot(r, 'ammo0').state).toBe('empty')
    expect(slot(r, 'ammo1').pick).toMatchObject({ name: 'Musket Ball' })
  })

  it('summon: the main pool is whips (§3.2); the summon slot holds the staff', () => {
    const r = fx({ cls: 'summon' })
    expect(pickName(r, 'main')).toBe('Leather Whip')
    expect(slot(r, 'main').pick?.score?.value).toBe(28) // 14 × 2 hits/s, no crit for summon
    expect(pickName(r, 'summon')).toBe('Finch Staff')
  })

  it('the stage hypothesis: at Mid-Hardmode the Mech Blade is obtainable; preparing for Mech keeps it (and Mech) out of the virtual defeats → gated track', () => {
    const mid = fx({ stage: 'mid-hm' })
    expect(mid.progress.virtual).toEqual(['hardmode', 'mech', 'wall-of-flesh'])
    expect(pickName(mid, 'main')).toBe('Mech Blade')
    const target = fx({ stage: 'mid-hm', bossId: 'mech' })
    expect(target.progress).toEqual({ tracked: [], virtual: ['hardmode', 'wall-of-flesh'], capped: ['mech'] })
    expect(pickName(target, 'main')).toBe('Hard Blade')
    expect(target.gated.find((g) => g.missing.join() === 'mech')?.entries.map((e) => e.name)).toContain('Mech Blade')
    expect(target.assumptions.find((a) => a.id === 'target')?.title).toBe('Preparing for Mech')
    // a marked defeat is ground truth: the target never undoes it
    const marked = fx({ stage: 'mid-hm', bossId: 'mech', progress: { worldEvil: null, nodeStates: { mech: 'defeated' } } })
    expect(pickName(marked, 'main')).toBe('Mech Blade')
  })

  it('B69/Q2: an owned item with Unknown availability becomes eligible (said in its rationale); an owned GATED item stays gated', () => {
    const owned = fx({ owned: [5] })
    expect(slot(owned, 'main').pick).toMatchObject({ name: 'Mystery Blade', ownedUnknown: true, availability: { status: 'unknown' } })
    expect(plain(slot(owned, 'main').pick?.rationale ?? [])).toMatch(/You marked this as gear you own, so it counts although its availability is Unknown\.$/)
    expect(owned.assumptions.map((a) => a.id)).toContain('owned-unknown')
    const ownedGated = fx({ owned: [7] })
    expect(pickName(ownedGated, 'main')).toBe('Spear X')
  })

  it('pins (swap-a-pick): the pinned item stays, shown as it is; the rest is recommended around it; bad pins are said, never silent', () => {
    const pins: Pins = {
      main: { kind: 'item', id: 4 }, // Hard Blade: gated at Early Pre-HM
      acc0: { kind: 'item', id: 206 }, // Wings A
      acc1: { kind: 'item', id: 206 }, // the same again
      alt: { kind: 'empty' },
      summon: { kind: 'item', id: 1 }, // a sword is no summon item
    }
    const r = fx({ pins })
    expect(slot(r, 'main').pick).toMatchObject({ name: 'Hard Blade', source: 'pinned', availability: { status: 'gated', missing: ['wall-of-flesh'] } })
    expect(plain(slot(r, 'main').pick?.rationale ?? [])).toBe('Your pick, kept in place of the recommendation.')
    expect(slot(r, 'alt')).toMatchObject({ state: 'empty' })
    expect(plain(slot(r, 'alt').empty ?? [])).toBe('Kept empty — not filled by the recommendation.')
    // ≤ 1 wings: the mobility slot can't take Wings B next to the pinned Wings A
    expect(pickName(r, 'acc2')).toBe('Boots')
    expect(r.notices.map(plain)).toEqual(['Wings A is already in another accessory slot, so it isn’t placed twice.', 'Copper Blade doesn’t fit its slot, so the slot keeps its recommendation.'])
    expect(r.loadout).toMatchObject({ mainWeapon: 4, altWeapon: null, summon: 30 })
    // the pinned gated main is still the user's: the gated track compares against it
    expect(r.gated.flatMap((g) => g.entries).filter((e) => e.slot === 'main').every((e) => e.score.value > (slot(r, 'main').pick?.score?.value ?? 0))).toBe(true)
  })

  it('pins out of range: a slot the difficulty doesn’t have, or the closed Demon Heart slot', () => {
    expect(fx({ pins: { acc6: { kind: 'item', id: 200 } } }).notices.map(plain)).toEqual(['Warrior Emblem sits in accessory slot 7, which Classic Mode doesn’t have, so it isn’t placed.'])
    expect(fx({ difficulty: 'expert', pins: { acc5: { kind: 'item', id: 200 } } }).notices.map(plain)).toEqual([
      'Warrior Emblem sits in the Demon Heart slot, which opens after you defeat Wall of Flesh, so it isn’t placed.',
    ])
  })

  it('a pinned armor triple that is not a set: pieces scored without a set bonus', () => {
    const r = fx({ pins: { armor: { kind: 'armor', helmet: 120, chest: 111, legs: null } } })
    expect(slot(r, 'armor').pick).toMatchObject({ source: 'pinned', name: 'Tank Helmet, Ninja Shirt' })
    expect(slot(r, 'armor').pick?.setId).toBeUndefined()
    expect(r.loadout).toMatchObject({ helmet: 120, chest: 111, legs: null })
  })

  it('swap options: the slot’s whole legal pool ranked by its own score, the current pick flagged, constraint conflicts listed with the reason', () => {
    const pins: Pins = { acc0: { kind: 'item', id: 206 } }
    const opts = slotOptions(input({ pins }), FIXTURE_DATA, 'acc2')
    expect(opts.canEmpty).toBe(true)
    expect(opts.options.slice(0, 4).map((o) => [o.name, o.score.text, o.current, o.blocked ?? null])).toEqual([
      ['Wings B', '15', false, 'wings'],
      ['Wings A', '10', false, 'in-use'],
      ['Boots', '8', true, null],
      ['Warrior Emblem', '0', false, 'in-use'], // held by acc1
    ])
    // every option is obtainable (or owned): never a gated or Unknown one
    expect(opts.options.every((o) => o.availability.status === 'yes')).toBe(true)
    const main = slotOptions(input(), FIXTURE_DATA, 'main')
    expect(main.options.map((o) => [o.name, o.current])).toEqual([
      ['Spear X', true],
      ['Iron Blade', false],
      ['Copper Blade', false],
    ])
  })
})

describe('AMENDMENTS-016 B108 fix round: the review rulings on the engine', () => {
  it('B108(a) registry pins: the keyword list, its own version + changelog, and how texts are classified (conservative: none or several classes → unscoped)', () => {
    expect(SPECIAL_SCOPE_VERSION).toBe(1)
    expect(SPECIAL_SCOPE_CHANGELOG.at(-1)?.version).toBe(SPECIAL_SCOPE_VERSION)
    expect(SPECIAL_SCOPE_KEYWORDS).toEqual({
      ranged: ['arrow', 'arrows', 'bow', 'bows', 'ammo'],
      melee: ['yoyo', 'yoyos', 'yo-yo', 'yo-yos', 'melee speed', 'melee knockback', 'melee weapon', 'melee weapons', 'melee attack', 'melee attacks', 'melee damage'],
      magic: ['mana', 'magic damage', 'magic weapon', 'magic weapons', 'magic attack', 'magic attacks'],
      summon: ['minion', 'minions', 'whip', 'whips', 'sentry', 'sentries', 'summon damage', 'summon tag'],
    })
    // the scoring constants (points, weights) are untouched: readiness keeps reading v2
    expect(SCORING_CONSTANTS_VERSION).toBe(2)
    expect(WORLD_EVIL_CONDITION).toEqual({ corruption: 'corruption-world', crimson: 'crimson-world' })
    const cases: [string, string | undefined][] = [
      ['Increases yoyo range and duration', 'melee'],
      ['Allows the use of two yoyos at once', 'melee'],
      ['Gives the user magic yoyo skills', 'melee'], // bare "magic" is item flavour, not a class
      ['Increases melee knockback', 'melee'],
      ['Arrows inflict poison', 'ranged'],
      ['Periodically redirects arrows towards enemies', 'ranged'],
      ['Weapons use ammo randomly', 'ranged'],
      ['Automatically use mana potions when needed', 'magic'],
      ['Increases whip knockback', 'summon'],
      ['Walk past a sentry to carry it', 'summon'],
      ['Significantly increases the duration of your summon tag effects', 'summon'],
      ['Summons spores over time that will damage enemies', undefined], // the verb: any class gets the spores
      ['Enables auto swing for melee weapons and whips', undefined], // two classes → unscoped
      ['During daytime, grants minor increase to damage, melee speed, critical strike chance, life regeneration, defense, mining speed, and minion knockback', undefined],
      ['Negates fall damage', undefined],
      ['Rainbow sparkles trail behind you', undefined], // "bow" inside a word never matches
    ]
    for (const [text, cls] of cases) expect(specialScope(text), text).toBe(cls)
    expect([specialFits('Arrows inflict poison', 'summon'), specialFits('Arrows inflict poison', 'ranged'), specialFits('Arrows inflict poison', 'hybrid'), specialFits('Tells the time', 'summon')]).toEqual([false, true, true, true])
  })

  it('B108(a) H4 empty beats zero: a 0-point accessory whose only effect belongs to another class never fills a slot; with nothing scored left the slot is honestly empty', () => {
    const summon = fx({ cls: 'summon', difficulty: 'master', stage: 'early-hm' })
    const accIds = (r: BuilderResult) => r.slots.filter((s) => s.group === 'accessories').flatMap((s) => (s.pick ? [s.pick.id] : []))
    // Yoyo String (melee), Mana Charm (magic) and the class-scoped emblems are unqualified for a summoner, never picked
    expect(accIds(summon)).not.toContain(215)
    expect(accIds(summon)).not.toContain(214)
    expect(slot(summon, 'acc0').pool).toMatchObject({ eligible: 8, unqualified: 6 })
    // with the unscoped 0-point accessories gone too, the last slots go honestly empty — never filled with the Yoyo String
    const narrow: typeof FIXTURE_DATA = { ...FIXTURE_DATA, accessories: new Map([...FIXTURE_DATA.accessories].filter(([id]) => id !== 204 && id !== 213)) }
    const r = recommendLoadout(input({ cls: 'summon', difficulty: 'master', stage: 'early-hm' }), narrow)
    const acc = ACCESSORY_SLOT_IDS.slice(0, SLOT_COUNT.master).map((id) => slot(r, id))
    expect(acc.map((s) => [s.state, s.pick?.name ?? null])).toEqual([
      ['pick', 'Avenger Emblem'],
      ['pick', 'Wings B'],
      ['pick', 'Boots'],
      ['pick', 'Shield'],
      ['pick', 'Band'],
      ['empty', null],
      ['empty', null],
    ])
    expect(plain(acc[5].empty ?? [])).toBe('No accessory with a scored benefit for this class at this stage is left for this slot — empty rather than filled with one that does nothing for your class.')
    // the same data fills a melee slot with the Yoyo String: its effect is melee's own (0 points, named)
    const melee = recommendLoadout(input({ cls: 'melee', difficulty: 'master', stage: 'early-hm' }), narrow)
    const yoyo = melee.slots.find((s) => s.pick?.id === 215)
    expect(yoyo?.pick?.zeroPoints).toBe(true)
    expect(plain(yoyo?.pick?.rationale ?? [])).toMatch(/This one adds 0 counted points — its effect is not scored: Increases yoyo range and duration\.$/)
  })

  it('B108(a): every 0-point pick is flagged on its card and listed for Step 3, unscoped ones named "not scored" (never "for your class": a class-less effect isn’t scored for any class) — a fallback too', () => {
    const r = fx({ cls: 'summon', difficulty: 'master', stage: 'early-hm' })
    const flagged = r.slots.filter((s) => s.pick?.zeroPoints).map((s) => s.id)
    expect(flagged).toEqual(['acc1', 'acc6'])
    expect(r.zeroPoint.map((z) => [z.slot, z.name, z.specials])).toEqual([
      ['acc1', 'Volatile Gel', ['Releases volatile gelatin periodically']],
      ['acc6', 'Info Charm', ['Displays the time']],
    ])
    expect(plain(slot(r, 'acc6').pick?.rationale ?? [])).toBe(
      'No offense accessory qualifies for this slot, and no accessory of any category with counted points for your class is left. This one adds 0 counted points — its effect is not scored: Displays the time.',
    )
    // an effect tied to another class reads "not your class" in a breakdown (never "not scored" as if it might help)
    const ranged = fx({ cls: 'ranged', pins: { acc0: { kind: 'item', id: 215 } } })
    expect(slot(ranged, 'acc0').pick?.score?.effects).toEqual([{ text: 'Increases yoyo range and duration', status: 'special-mismatch', sourceUrl: 'https://terraria.wiki.gg/wiki/Special' }])
  })

  it('B108 H3: owned gear with Unknown availability is never folded into the verified count — rationale and disclosure split it', () => {
    const r = fx({ owned: [5] })
    const main = slot(r, 'main')
    expect(main.pool).toMatchObject({ eligible: 3, owned: 1 })
    expect(plain(main.pick?.rationale ?? [])).toBe(
      'Highest estimated damage per second of the 3 melee weapons verified obtainable at your progress + 1 owned (unverified). You marked this as gear you own, so it counts although its availability is Unknown.',
    )
    expect(plain(main.disclosure ?? [])).toBe(
      'Scored from 4 candidates: 3 verified obtainable at your progress + 1 owned (unverified). Left out: 3 behind a boss outside your progress; 1 without the verified stats to score.',
    )
    // only owned: never "0 verified"
    expect(plain(builderCopy.rationale.main({ verified: 0, owned: 2 }, 'ranged'))).toBe('Highest estimated damage per second of the 2 owned (unverified) ranged weapons.')
    expect(plain(builderCopy.poolPhrase({ verified: 40, owned: 1 }, 'weapon', 'weapons'))).toBe('the 40 weapons verified obtainable at your progress + 1 owned (unverified)')
  })

  it('B108 H2: a pin scoring below the slot’s top candidate says it was kept over higher-scoring alternatives, and those alternatives are marked', () => {
    const r = fx({ pins: { main: { kind: 'item', id: 1 } } })
    const main = slot(r, 'main')
    expect(plain(main.pick?.rationale ?? [])).toBe('Your pick, kept over higher-scoring alternatives.')
    expect(main.alternatives.map((a) => [a.name, a.higher, a.tied])).toEqual([
      ['Spear X', true, false],
      ['Iron Blade', true, false],
    ])
    // a recommended pick never has a higher-scoring alternative
    for (const s of fx().slots) for (const a of s.alternatives) expect(a.higher, `${s.id}/${a.name}`).toBe(false)
    // a tie: the fixed tie-break order would put the other one here
    expect(plain(slot(fx({ pins: { main: { kind: 'item', id: 2 } } }), 'main').pick?.rationale ?? [])).toBe('Your pick. It scores the same as Spear X, which the fixed tie-break order would put here.')
    // a pin the recommendation can't make (gated) keeps the neutral line
    expect(plain(slot(fx({ pins: { main: { kind: 'item', id: 4 } } }), 'main').pick?.rationale ?? [])).toBe('Your pick, kept in place of the recommendation.')
  })

  it('B108 M3: a reopened build recomputes its rationales — every recommendation-equal pick says so with the why; owned chips come back; pinned accessories and potions list their alternatives', () => {
    const base = fx({ owned: [5] })
    const L = base.loadout
    const pins: Partial<Record<string, Pins[keyof Pins]>> = {
      main: { kind: 'item', id: L.mainWeapon as number },
      alt: { kind: 'item', id: L.altWeapon as number },
      armor: { kind: 'armor', helmet: L.helmet, chest: L.chest, legs: L.legs },
      summon: { kind: 'item', id: L.summon as number },
    }
    L.accessories.slice(0, SLOT_COUNT.classic).forEach((id, i) => (pins[`acc${i}`] = { kind: 'item', id: id as number }))
    L.buffs.forEach((id, i) => (pins[`buff${i}`] = { kind: 'item', id }))
    const reopened = fx({ owned: [5], pins: pins as Pins })
    expect(reopened.loadout).toEqual(L)
    for (const s of reopened.slots) {
      if (!s.pick) continue
      expect(s.pick.source).toBe('pinned')
      expect(plain(s.pick.rationale), s.id).toMatch(/^Your pick, and also the recommendation\. /)
      // the recommendation's own why follows, word for word — accessories count what is still free given the OTHER slots
      if (s.group === 'accessories') expect(plain(s.pick.rationale), s.id).toMatch(/^Your pick, and also the recommendation\. (Most counted|No offense accessory)/)
      else expect(plain(s.pick.rationale), s.id).toBe(`Your pick, and also the recommendation. ${plain(slot(base, s.id).pick?.rationale ?? [])}`)
    }
    // the owned-Unknown weapon keeps its "you own this" chip as a pin
    expect(slot(reopened, 'main').pick).toMatchObject({ name: 'Mystery Blade', ownedUnknown: true, availability: { status: 'unknown' } })
    // pinned accessory / potion slots list their alternatives (they used to list none)
    expect(slot(reopened, 'acc2').alternatives.map((a) => a.name)).toEqual(['Wings A', 'Boots'])
    expect(slot(reopened, 'buff0').alternatives.map((a) => [a.name, a.tied])).toEqual([['Swift Potion II', true]])
    // the 0-point pick stays named as a pin
    expect(slot(reopened, 'acc4').pick?.zeroPoints).toBe(true)
  })

  it('B108(b) M10: with a world evil chosen, items needing the OTHER world type are out of play — counted in the left-out line, said in the assumptions', () => {
    const crimson = fx({ cls: 'summon', progress: { worldEvil: 'crimson', nodeStates: {} } })
    const summon = slot(crimson, 'summon')
    expect(summon.pool).toMatchObject({ eligible: 1, otherWorldCondition: 1 })
    expect(plain(summon.disclosure ?? [])).toBe('Scored from 1 candidate verified obtainable at your progress. Left out: 1 behind a boss outside your progress; 1 that needs a Corruption world.')
    expect(summon.alternatives).toEqual([])
    expect(crimson.assumptions.find((a) => a.id === 'world-type')).toMatchObject({ title: 'World type: Crimson world' })
    // a Corruption world (or "Both") keeps it
    for (const worldEvil of ['corruption', null] as const) {
      const r = fx({ cls: 'summon', progress: { worldEvil, nodeStates: {} } })
      expect(slot(r, 'summon').alternatives.map((a) => a.name)).toEqual(['Vile Staff'])
      expect(slot(r, 'summon').alternatives[0].availability.conditions).toEqual(['corruption-world'])
    }
    expect(fx({ cls: 'summon' }).assumptions.map((a) => a.id)).not.toContain('world-type')
  })

  it('B108 M1: the target boss’s group leads the gated track (by gate distance and name alone, "evil-c" would come first)', () => {
    expect(fx({ stage: 'mid-hm' }).gated.map((g) => g.missing.join('+'))).toEqual(['evil-c'])
    expect(fx({ stage: 'mid-hm', bossId: 'mech' }).gated.map((g) => g.missing.join('+'))).toEqual(['mech', 'evil-c'])
  })

  it('B108 nit: the swap sheet marks options tied with the current pick', () => {
    expect(slotOptions(input(), FIXTURE_DATA, 'main').options.map((o) => [o.name, o.current, o.tied])).toEqual([
      ['Spear X', true, false],
      ['Iron Blade', false, true],
      ['Copper Blade', false, false],
    ])
  })

  it('B108(d) M11: every computed profile figure is an estimate with a populated AssumptionsTip', () => {
    const r = fx()
    for (const c of r.profile.components) {
      if (c.value === undefined) continue
      expect(c.estimate, c.id).toBeDefined()
      expect(r.profile.estimates[c.estimate as keyof typeof r.profile.estimates]?.length, c.id).toBeGreaterThan(0)
    }
    expect(r.profile.components.map((c) => c.estimate)).toEqual(['edo', 'defense', 'mobility', 'survivability', 'synergy'])
  })

  it('B108 nit: the progress assumption reads naturally for 0, 1 and several marked bosses', () => {
    const p = builderCopy.buildAssumption.progress
    expect(p('Early Pre-Hardmode', [], 0).detail).toBe('Your stage (Early Pre-Hardmode) implies no defeated bosses on its own. No boss is marked defeated on the boss map. Optional bosses are never assumed.')
    expect(p('Early Hardmode', ['Wall of Flesh'], 1).detail).toBe(
      'Your stage (Early Hardmode) is taken as a hypothesis: the bosses it implies — Wall of Flesh — count as defeated. The 1 boss marked defeated on the boss map counts too. Optional bosses are never assumed.',
    )
    expect(p('Early Hardmode', ['Wall of Flesh'], 3).detail).toMatch(/The 3 bosses marked defeated on the boss map count too\./)
  })
})

// --- live data ------------------------------------------------------------------------------------------

const byId = <T extends { id: K }, K>(list: readonly T[]) => new Map(list.map((x) => [x.id, x]))
const weapons = weaponsJson as unknown as Weapon[]
const armor = armorJson as unknown as ArmorPiece[]
const accessories = accessoriesJson as unknown as Accessory[]
const items = itemsJson as unknown as Item[]
const graph = progressionJson as { nodes: ProgressionNode[]; edges: ProgressionEdge[] }
const LIVE: ReadinessData = {
  weapons: byId(weapons),
  armor: byId(armor),
  accessories: byId(accessories),
  sets: byId(setsJson as unknown as ArmorSet[]),
  items: byId(items),
  buffs: byId(buffsJson as unknown as Buff[]),
  bosses: byId(bossesJson as unknown as Boss[]),
  conditions: byId(conditionsJson as unknown as Condition[]),
  graph,
  ammoTypeName: (slug) => slug,
  gameVersion: '1.4.5.8',
}
const named = <T extends { name: string }>(list: readonly T[], name: string) => {
  const found = list.find((x) => x.name === name)
  if (!found) throw new Error(`no record named ${name}`)
  return found
}

describe('P6 fix round: armor sets with alternative chests / no legs piece (live records)', () => {
  const ALL: TrackedProgress = { worldEvil: 'corruption', nodeStates: Object.fromEntries(graph.nodes.filter((n) => n.kind === 'boss').map((n) => [n.id, 'defeated' as const])) }
  const piece = (name: string) => named(armor, name).id
  const armorOptions = (r: BuilderResult) => {
    const s = slot(r, 'armor')
    return [...(s.pick ? [s.pick] : []), ...s.alternatives]
  }

  it('the Wizard set is offered per combination — hat + robe, the legs slot left free (0) — keyed set:wizard-set:<hat>.<robe>', () => {
    const r = recommendLoadout(input({ cls: 'magic', stage: 'early-prehm', owned: [piece('Wizard Hat'), piece('Mystic Robe')], progress: NONE }), LIVE)
    const wizard = armorOptions(r).filter((o) => o.setId === 'wizard-set')
    expect(wizard.length).toBeGreaterThan(0)
    for (const o of wizard) {
      const [, hat, robe] = /^set:wizard-set:(\d+)\.(\d+)$/.exec(o.key) ?? []
      expect(o.pieces, o.key).toEqual([Number(hat), Number(robe), 0])
      expect(o.name).toBe(`Wizard set (${LIVE.armor.get(Number(hat))?.name}, ${LIVE.armor.get(Number(robe))?.name})`)
    }
  })

  it('pinned pieces complete the set they belong to: Beetle armor by its chest, the Wizard set with ANY legs', () => {
    const shell = recommendLoadout(input({ cls: 'melee', progress: ALL, pins: { armor: { kind: 'armor', helmet: piece('Beetle Helmet'), chest: piece('Beetle Shell'), legs: piece('Beetle Leggings') } } }), LIVE)
    expect(slot(shell, 'armor').pick).toMatchObject({ key: `set:beetle-armor:${piece('Beetle Helmet')}.${piece('Beetle Shell')}`, name: 'Beetle armor (Beetle Shell)', setId: 'beetle-armor' })
    const robe = recommendLoadout(input({ cls: 'magic', progress: ALL, pins: { armor: { kind: 'armor', helmet: piece('Magic Hat'), chest: piece('Ruby Robe'), legs: piece('Moon Lord Legs') } } }), LIVE)
    expect(slot(robe, 'armor').pick).toMatchObject({ name: 'Wizard set (Magic Hat, Ruby Robe)', setId: 'wizard-set', pieces: [piece('Magic Hat'), piece('Ruby Robe'), piece('Moon Lord Legs')] })
    // the set bonus counts: the Magic Hat's "+60 max mana" is in the profile
    expect(robe.profile.setBonus).toMatchObject({ setId: 'wizard-set', text: 'Increases maximum mana by 60' })
  })
})

describe('AMENDMENTS-016 B108 H2 residual: the alt beside a pinned main that scores below it', () => {
  it('the review repro (live records): summon, Durendal owned, Starcrash pinned as main — Durendal holds the alt and says it outscores the pick, never "next-highest"', () => {
    const durendal = named(weapons, 'Durendal').id
    const r = recommendLoadout(input({ cls: 'summon', owned: [durendal], pins: { main: { kind: 'item', id: named(weapons, 'Starcrash').id } } }), LIVE)
    const main = slot(r, 'main').pick
    const alt = slot(r, 'alt').pick
    expect(main).toMatchObject({ name: 'Starcrash', source: 'pinned' })
    expect(alt).toMatchObject({ name: 'Durendal', source: 'recommended' })
    expect(alt?.score?.value ?? 0).toBeGreaterThan(main?.score?.value ?? Infinity)
    expect(plain(alt?.rationale ?? [])).toBe(
      'Highest estimated damage per second; no other kind of weapon is verified obtainable at your progress. It scores above your pick, which holds the main slot. You marked this as gear you own, so it counts although its availability is Unknown.',
    )
    // unpinned: Durendal is the main, and the alt's line is unchanged
    const unpinned = recommendLoadout(input({ cls: 'summon', owned: [durendal] }), LIVE)
    expect(pickName(unpinned, 'main')).toBe('Durendal')
    expect(plain(slot(unpinned, 'alt').pick?.rationale ?? [])).toBe('Next-highest estimated damage per second; no other kind of weapon is verified obtainable at your progress.')
  })

  it('another kind (fixture): Copper Blade pinned — Spear X, the highest-scoring other kind, outscores it; a pin at or above the alt keeps "next-highest"', () => {
    const r = fx({ pins: { main: { kind: 'item', id: 1 } } })
    expect(pickName(r, 'alt')).toBe('Spear X')
    expect(plain(slot(r, 'alt').pick?.rationale ?? [])).toBe('Highest estimated damage per second from a different kind of weapon than your main one — this one is a spear. It scores above your pick, which holds the main slot.')
    expect(plain(builderCopy.rationale.altType(undefined, true))).toBe('Highest estimated damage per second from a different kind of weapon than your main one. It scores above your pick, which holds the main slot.')
    // a pin scoring above the alt (Hard Blade, gated) and a pin tied with it (Iron Blade = Spear X): unchanged
    const nextHighest = 'Next-highest estimated damage per second from a different kind of weapon than your main one — this one is a spear — as a second option.'
    for (const id of [4, 2]) {
      const other = fx({ pins: { main: { kind: 'item', id } } })
      expect(pickName(other, 'alt'), `pin ${id}`).toBe('Spear X')
      expect(plain(slot(other, 'alt').pick?.rationale ?? []), `pin ${id}`).toBe(nextHighest)
    }
  })

  it('the same kind (fixture without the spear): Copper Blade pinned — Iron Blade outscores it; unpinned unchanged; a pinned alt that is the recommendation says so too', () => {
    const swordsOnly = { ...FIXTURE_DATA, weapons: new Map([...FIXTURE_DATA.weapons].filter(([id]) => id !== 3)) }
    const above = 'Highest estimated damage per second; no other kind of weapon is verified obtainable at your progress. It scores above your pick, which holds the main slot.'
    const pinned = recommendLoadout(input({ pins: { main: { kind: 'item', id: 1 } } }), swordsOnly)
    expect(pickName(pinned, 'alt')).toBe('Iron Blade')
    expect(plain(slot(pinned, 'alt').pick?.rationale ?? [])).toBe(above)
    const unpinned = recommendLoadout(input(), swordsOnly)
    expect([pickName(unpinned, 'main'), pickName(unpinned, 'alt')]).toEqual(['Iron Blade', 'Copper Blade'])
    expect(plain(slot(unpinned, 'alt').pick?.rationale ?? [])).toBe('Next-highest estimated damage per second; no other kind of weapon is verified obtainable at your progress.')
    const both = recommendLoadout(input({ pins: { main: { kind: 'item', id: 1 }, alt: { kind: 'item', id: 2 } } }), swordsOnly)
    expect(plain(slot(both, 'alt').pick?.rationale ?? [])).toBe(`Your pick, and also the recommendation. ${above}`)
  })
})

describe('§9.1 worked example on live records (components; constants v2 re-pin)', () => {
  const set = named(setsJson as unknown as ArmorSet[], 'Crystal Assassin armor')
  const variant = set.variants[0]
  const pieces = [variant.helmetId, set.pieces.chest, set.pieces.legs].map((id) => armor.find((a) => a.id === id) as ArmorPiece)
  const profile = scoreBuild({
    cls: 'ranged',
    goal: 'boss',
    main: named(weapons, 'Clockwork Assault Rifle'),
    pieces,
    set: { set, variant },
    accessories: [named(accessories, 'Ranger Emblem'), named(accessories, 'Volatile Gelatin')],
    potions: [],
  })
  const c = Object.fromEntries(profile.components.map((x) => [x.id, x]))

  it('estDamage 17 × 1.30 × 6.92 × 1.19 = 182.1/s (est.); defense 36; mobility 20 + the dash named; survivability 36', () => {
    expect(c.estDamage.value).toBeCloseTo(182.1, 1)
    expect(c.estDamage.text).toBe('182.1')
    expect(c.defense.value).toBe(36)
    expect(c.mobility.value).toBe(20)
    expect(c.mobility.uncounted).toContainEqual({ from: 'Crystal Assassin armor', text: 'Allows the ability to dash' })
    expect(c.survivability.value).toBe(36)
  })

  it('classSynergy re-pinned under constants v2: 70 of 90 = 78/100 (v1: 65/85 = 76 — the Shirt’s 10% ammo saving now counts 5 ranged points); both mismatches itemized', () => {
    expect(profile.constantsVersion).toBe(2)
    expect(profile.synergy.matched).toBe(70)
    expect(profile.synergy.mismatched).toBe(20)
    expect(c.classSynergy.text).toBe('78')
    expect(profile.synergy.mismatches).toEqual([
      { name: 'Crystal Assassin Hood', phrases: ['−10% mana cost'] },
      { name: 'Crystal Assassin Pants', phrases: ['+10% melee speed'] },
    ])
  })

  it('its weapon’s DPP is still 122.4 scored without ammo (B68: no ammo verified obtainable in the spec’s snapshot)', () => {
    const p = weaponProfile(named(weapons, 'Clockwork Assault Rifle'))
    if (!p.ok) throw new Error('scoreable')
    expect(damagePotential(p)).toBeCloseTo(122.4, 1)
  })
})

describe('live dataset sweep: invariants (properties, no hard counts)', () => {
  const STAGES: Stage[] = ['early-prehm', 'late-prehm', 'early-hm', 'mid-hm', 'endgame']
  const CLASSES: LoadoutClass[] = ['melee', 'ranged', 'magic', 'summon', 'hybrid']
  const runs: { inp: BuilderInput; r: BuilderResult }[] = []
  for (const stage of STAGES)
    for (const cls of CLASSES)
      for (const [difficulty, goal] of [
        ['expert', 'boss'],
        ['master', 'balanced'],
        ['classic', 'survivability'],
      ] as [Difficulty, Goal][]) {
        const inp = input({ stage, cls, difficulty, goal, progress: { worldEvil: 'crimson', nodeStates: {} } })
        runs.push({ inp, r: recommendLoadout(inp, LIVE) })
      }
  const recordOf = (id: number) => LIVE.weapons.get(id) ?? LIVE.armor.get(id) ?? LIVE.accessories.get(id) ?? LIVE.items.get(id)

  it('every recommended pick is verified obtainable under tracked ∪ virtual (status "yes"): never gated, never Unknown (nothing is owned here)', () => {
    for (const { inp, r } of runs) {
      const ep = effectiveProgress(LIVE.graph, inp.progress, inp.stage)
      for (const s of r.slots) {
        if (!s.pick) continue
        expect(s.pick.source).toBe('recommended')
        expect(s.pick.availability.status, `${inp.stage}/${inp.cls}/${s.id}`).toBe('yes')
        const ids = s.pick.pieces ?? [s.pick.id]
        for (const id of ids) expect(availabilityOf(recordOf(id) as Weapon, LIVE.graph, ep).status).toBe('yes')
      }
    }
  })

  it('PRD P4-S2 AC4: at Early Pre-Hardmode no recommended item needs a Hardmode gate', () => {
    for (const { inp, r } of runs.filter((x) => x.inp.stage === 'early-prehm')) {
      for (const s of r.slots) {
        for (const id of s.pick?.pieces ?? (s.pick ? [s.pick.id] : [])) {
          const view = getField(recordOf(id), 'gatedBy')
          const gates = (view.value as { bosses: string[] } | undefined)?.bosses ?? []
          expect(gates.filter((g) => isNodeSatisfied(LIVE.graph, new Set(), g) === false), `${inp.cls}/${s.id}`).toEqual([])
        }
      }
    }
  })

  it('the main weapon is the argmax DPP of the class pool (independent oracle); the summon slot is a minion staff', () => {
    for (const { inp, r } of runs) {
      const main = slot(r, 'main')
      if (!main.pick) continue
      for (const alt of main.alternatives) expect(alt.score.value).toBeLessThanOrEqual((main.pick.score?.value ?? 0) + 1e-9)
      const w = LIVE.weapons.get(main.pick.id) as Weapon
      expect(isSummonStaff(w)).toBe(false)
      if (inp.cls === 'summon') expect(w.tags).toContain('whips')
      else if (inp.cls !== 'hybrid') expect(w.damageClass).toBe(inp.cls)
      const summon = slot(r, 'summon').pick
      if (summon) expect((LIVE.weapons.get(summon.id) as Weapon).tags).toContain('minion-summon-items')
    }
  })

  it('accessory constraints hold: no duplicates, ≤ 1 wings, no direct combinedFrom / upgradesTo pair; slots = SLOT_COUNT[difficulty]', () => {
    for (const { inp, r } of runs) {
      const acc = r.slots.filter((s) => s.group === 'accessories')
      expect(acc).toHaveLength(SLOT_COUNT[inp.difficulty])
      const ids = acc.flatMap((s) => (s.pick ? [s.pick.id] : []))
      expect(new Set(ids).size).toBe(ids.length)
      const recs = ids.map((id) => LIVE.accessories.get(id) as Accessory)
      expect(recs.filter((a) => a.wingStats !== undefined).length).toBeLessThanOrEqual(1)
      for (const a of recs) for (const linked of [...a.combinedFrom, ...a.upgradesTo]) expect(ids).not.toContain(linked)
    }
  })

  it('the Demon Heart slot is locked exactly when the Wall of Flesh is outside tracked ∪ virtual', () => {
    for (const { inp, r } of runs) {
      const index = DEMON_HEART_SLOT_INDEX[inp.difficulty]
      if (index === null) continue
      const ep = effectiveProgress(LIVE.graph, inp.progress, inp.stage)
      expect(slot(r, ACCESSORY_SLOT_IDS[index]).state === 'locked').toBe(!isNodeSatisfied(LIVE.graph, ep, 'wall-of-flesh'))
    }
  })

  it('buffs never repeat a buff; at most BUFF_SLOTS', () => {
    for (const { r } of runs) {
      const picks = r.slots.filter((s) => s.group === 'buffs').flatMap((s) => (s.pick ? [s.pick.id] : []))
      expect(picks.length).toBeLessThanOrEqual(BUFF_SLOTS)
      const buffIds = picks.flatMap((id) => (LIVE.items.get(id)?.buffGrants ?? []).map((g) => g.buffId).filter((b) => b !== 'potion-sickness' && b !== 'mana-sickness'))
      expect(new Set(buffIds).size).toBe(buffIds.length)
    }
  })

  it('gated entries sit only in the group keyed by their exact missing bosses; B97a: never the other world’s evil boss (Crimson chosen)', () => {
    for (const { r } of runs) {
      for (const g of r.gated) {
        expect(g.missing).not.toContain('eater-of-worlds')
        for (const e of g.entries) expect(e.availability.missing).toEqual(g.missing)
      }
    }
  })

  it('every score is decomposed (label + formula) and every DPP estimate has a populated AssumptionsTip', () => {
    for (const { r } of runs) {
      for (const s of r.slots) {
        for (const score of [s.pick?.score, ...s.alternatives.map((a) => a.score)]) {
          if (!score) continue
          expect(score.label).not.toBe('')
          expect(score.formulaText).not.toBe('')
          if (score.estimate) expect(score.assumptions?.length).toBeGreaterThan(0)
        }
      }
      const edo = r.profile.components.find((c) => c.id === 'estDamage')
      if (edo?.value !== undefined) expect(r.profile.estimates.edo?.length).toBeGreaterThan(0)
    }
  })

  it('every slot that can be empty says why (designed empty states), and every slot carries its pool disclosure', () => {
    for (const { r } of runs) {
      for (const s of r.slots) {
        if (s.state !== 'pick') expect(plain(s.empty ?? []).length, s.id).toBeGreaterThan(0)
        if (s.pool) expect(plain(s.disclosure ?? [])).toMatch(/^Scored from /)
      }
    }
  })

  it('tracked ∪ virtual is the builder’s scope: at Early Hardmode with nothing marked, Wall of Flesh-gated weapons are obtainable (Feature A’s tracked-only rule would gate them)', () => {
    const car = named(weapons, 'Clockwork Assault Rifle')
    const r = recommendLoadout(input({ stage: 'early-hm', cls: 'ranged' }), LIVE)
    expect(r.progress.virtual).toContain('wall-of-flesh')
    const ep = effectiveProgress(LIVE.graph, NONE, 'early-hm')
    expect(availabilityOf(car, LIVE.graph, ep).status).toBe('yes')
    expect(availabilityOf(car, LIVE.graph, effectiveProgress(LIVE.graph, NONE)).status).toBe('gated')
    const options = slotOptions(input({ stage: 'early-hm', cls: 'ranged' }), LIVE, 'main').options.map((o) => o.id)
    expect(options).toContain(car.id)
  })

  it('B108(a): no recommended accessory adds 0 points through an effect tied to another class; every 0-point pick is listed for Step 3; owned-Unknown never counts as verified', () => {
    for (const { inp, r } of runs) {
      for (const s of r.slots) {
        if (s.group !== 'accessories' || !s.pick?.zeroPoints) continue
        const effects = (LIVE.accessories.get(s.pick.id)?.effects ?? []) as { kind: string; text?: string }[]
        const specials = effects.filter((e) => e.kind === 'special').map((e) => e.text as string)
        expect(specials.some((t) => specialFits(t, inp.cls)), `${inp.stage}/${inp.cls}/${s.id} ${s.pick.name}`).toBe(true)
      }
      expect(r.zeroPoint.map((z) => z.slot)).toEqual(r.slots.filter((s) => s.pick?.zeroPoints).map((s) => s.id))
      for (const s of r.slots) if (s.pool) expect(s.pool.owned).toBe(0)
    }
  })

  it('B108 M3: reopening any recommended loadout (every slot pinned) reproduces it, and every pick reads as also the recommendation', () => {
    for (const { inp, r } of runs) {
      const pins: Partial<Record<string, Pins[keyof Pins]>> = {}
      for (const s of r.slots) {
        if (!s.pick) continue
        pins[s.id] = s.id === 'armor' ? { kind: 'armor', helmet: r.loadout.helmet, chest: r.loadout.chest, legs: r.loadout.legs } : { kind: 'item', id: s.pick.id }
      }
      const again = recommendLoadout({ ...inp, pins: pins as Pins }, LIVE)
      expect(again.loadout).toEqual(r.loadout)
      for (const s of again.slots) if (s.pick) expect(plain(s.pick.rationale), `${inp.stage}/${inp.cls}/${s.id}`).toMatch(/^Your pick, and also the recommendation\. /)
    }
  })

  it('copy audit (SCORING_SPEC §8.4): no "best", outcome, odds or forward-promise wording in anything the engine emits (wiki quotes excluded)', () => {
    const texts: string[] = []
    const seg = (segments: readonly Segment[] | undefined) => segments && texts.push(ownWords(segments))
    for (const { r } of runs) {
      for (const s of r.slots) {
        seg(s.pick?.rationale)
        seg(s.empty)
        seg(s.disclosure)
        for (const score of [s.pick?.score, ...s.alternatives.map((a) => a.score)]) {
          if (!score) continue
          texts.push(score.label, score.formulaText, ...(score.qualifier ? [score.qualifier] : []))
          for (const a of score.assumptions ?? []) texts.push(a.title, a.detail)
          for (const e of score.effects) if (e.status !== 'special') texts.push(e.text)
        }
      }
      for (const a of r.assumptions) texts.push(a.title, a.detail)
      for (const n of r.notices) seg(n)
      for (const c of r.profile.components) texts.push(c.label, c.unit, c.formulaText ?? '', c.excluded ?? '', ...c.notes)
      for (const a of r.profile.estimates.edo ?? []) texts.push(a.title, a.detail)
    }
    // and every template with sample values
    const item: Segment = { kind: 'item', id: 1, text: 'Thing' }
    const r = builderCopy.rationale
    const e = builderCopy.empty
    for (const segs of [
      r.main({ verified: 3, owned: 0 }, 'melee'),
      r.main({ verified: 40, owned: 1 }, 'melee'),
      r.main({ verified: 0, owned: 2 }, 'ranged'),
      r.main({ verified: 1, owned: 0 }, 'summon'),
      r.altType('a broadsword'),
      r.altType(undefined),
      r.altSameType(),
      r.altType('a spear', true),
      r.altType(undefined, true),
      r.altSameType(true),
      r.altHybrid('ranged'),
      r.armor({ verified: 4, owned: 1 }, 'max-damage'),
      r.accessory({ verified: 2, owned: 0 }, 'def'),
      r.accessorySpecial('off', 'x'),
      r.accessoryOtherPoints('off', '4'),
      r.accessoryFallback('util', '8'),
      r.accessoryFallbackZero('off', 'x'),
      r.ammo({ verified: 2, owned: 1 }, 'Bullets', item),
      r.buff({ verified: 4, owned: 0 }),
      r.summon({ verified: 1, owned: 0 }),
      r.owned(),
      r.pinned(),
      r.pinnedBelow(),
      r.pinnedSame(r.main({ verified: 3, owned: 0 }, 'melee')),
      r.pinnedTied(item),
      r.minionNote(),
      r.tied([[item]], true),
      e.main('magic'),
      e.main('summon'),
      e.altNoMain(),
      e.altNone(),
      e.altHybridNone(),
      e.armor(),
      e.accessory(),
      e.ammo('Arrows', item),
      e.buff(),
      e.summon(),
      e.pinnedEmpty(),
      e.noAmmoNeeded(true),
      e.noAmmoNeeded(false),
      e.demonHeart(item),
      builderCopy.disclosure({ eligible: 1, owned: 7, unknown: 2, gated: 3, unverified: 4, unqualified: 5, otherWorld: 6, otherWorldCondition: 8 }, 'summon', 'Crimson world'),
      ...Object.values(builderCopy.pinNotice).map((fn) => (fn as (a: string, b: number, c: string) => Segment[])('Thing', 6, 'Classic')),
      builderCopy.gatedCopy.alternative(item),
      builderCopy.gatedCopy.noAlternative(),
    ])
      seg(segs)
    const b = builderCopy.buildAssumption
    const pa = builderCopy.profileAssumption
    for (const a of [
      b.progress('Early Hardmode', ['Wall of Flesh'], 2),
      b.progress('Early Hardmode', ['Wall of Flesh'], 1),
      b.progress('Early Pre-Hardmode', [], 0),
      b.availability(),
      b.worldEvil(),
      b.worldType('Corruption world', 'Crimson world'),
      b.target('Plantera'),
      b.demonHeart('https://terraria.wiki.gg/wiki/Demon_Heart'),
      b.potions(),
      b.ownedUnknown(),
      b.weights(2, 1),
      pa.defense(),
      pa.mobility(),
      pa.survivability(),
      pa.synergy(),
      pa.formula('1 + 2 = 3'),
      pa.weights(2),
    ])
      texts.push(a.title, a.detail)
    for (const text of texts) expect(auditCopy(text), text).toBeUndefined()
    expect(texts.length).toBeGreaterThan(1000)
  })
})
