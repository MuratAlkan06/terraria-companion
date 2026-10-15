/* Scoring primitives (SCORING_SPEC §2.2, §2.3, §3, §4.6, §5.2, §8.5; AMENDMENTS-014 B69/B71): the
 * versioned constants table, the DPP proxy on the §9 worked weapons, the scope rule and points, and
 * tracked-only availability with the target-boss cap — over the shipped dataset. */
import { describe, expect, it } from 'vitest'
import type { Accessory, Item, ProgressionEdge, ProgressionNode, Weapon } from '../data-access/types'
import accessoriesJson from '../data/accessories.detail.json'
import itemsJson from '../data/items.detail.json'
import progressionJson from '../data/progression.json'
import weaponsJson from '../data/weapons.detail.json'
import { AttackPatternTag, StatKind } from '../schemas'
import { availabilityOf, compareRankable, gateBosses, gateDistance, isCappedByTarget, rarityRank, targetCapNodes } from './candidates'
import {
  BASE_CRIT_PCT,
  CONSTANTS_CHANGELOG,
  DEMON_HEART_SLOT_INDEX,
  DPP_ASSUMPTIONS,
  FLIGHT_HELPS_TICKS,
  GOAL_COMPONENTS,
  GOAL_WEIGHTS,
  MAX_ACCESSORY_SLOTS,
  MOVE_SPEED_HELPS_PCT,
  NPC_DEFENSE_FACTOR,
  PLAYER_DEFENSE_FACTOR,
  SCORING_CONSTANTS_VERSION,
  SLOT_COUNT,
  STAT_POINTS,
  TAG_NEEDS,
} from './constants'
import { effectiveProgress, stepsFromFrontier } from './progress'
import { applicablePoints, appliesTo, critFactor, damagePotential, effectPoints, effectScope, isSummonStaff, statTotal, sumPoints, weaponProfile } from './proxies'

const graph = progressionJson as { nodes: ProgressionNode[]; edges: ProgressionEdge[] }
const weapons = weaponsJson as unknown as Weapon[]
const accessories = accessoriesJson as unknown as Accessory[]
const items = itemsJson as unknown as Item[]
const weapon = (name: string) => weapons.find((w) => w.name === name) as Weapon
const accessory = (name: string) => accessories.find((a) => a.name === name) as Accessory
const item = (name: string) => items.find((i) => i.name === name) as Item
const tracked = (...ids: string[]) => effectiveProgress(graph, { worldEvil: null, nodeStates: Object.fromEntries(ids.map((id) => [id, 'defeated' as const])) })

describe('constants (SCORING_SPEC §2.3 / §5.2 / §6, versioned — B38 discipline)', () => {
  it('version 2 (AMENDMENTS-015 B94(3)), with a changelog entry per version, the latest naming its re-pinned golden', () => {
    expect(SCORING_CONSTANTS_VERSION).toBe(2)
    expect(CONSTANTS_CHANGELOG.map((c) => c.version)).toEqual([1, 2])
    expect(CONSTANTS_CHANGELOG.at(-1)?.version).toBe(SCORING_CONSTANTS_VERSION)
    const v2 = CONSTANTS_CHANGELOG[1].note
    expect(v2).toMatch(/B94\(3\)/)
    expect(v2).toMatch(/ammo-save-pct → Off 0\.5 per %/)
    expect(v2).toMatch(/armor-penetration-flat → Off 1 per point/)
    expect(v2).toMatch(/76 → 78/)
  })

  it('STAT_POINTS covers every StatKind (closed enum) and pins the §2.3 rows exactly', () => {
    expect(Object.keys(STAT_POINTS).sort()).toEqual([...StatKind.options].sort())
    expect(STAT_POINTS).toMatchObject({
      'damage-pct': { off: 1 },
      'damage-flat': { off: 2 },
      'crit-pct': { off: 1 },
      'melee-speed-pct': { off: 1, impliedScope: 'melee' },
      'attack-speed-pct': { off: 1 },
      'defense-flat': { def: 1, surv: 1 },
      'damage-reduction-pct': { def: 2, surv: 2 },
      'move-speed-pct': { mob: 1 },
      'jump-boost': { uncounted: 'units-unverified' },
      'flight-time-ticks': { mob: 0.1 },
      'life-regen': { surv: 2 },
      'max-life-flat': { surv: 0.25 },
      'max-mana-flat': { off: 0.1, impliedScope: 'magic' },
      'mana-cost-pct': { off: 1, impliedScope: 'magic', perReduction: true },
      'mana-regen': { off: 1, impliedScope: 'magic' },
      'minion-slots': { off: 20, impliedScope: 'summon' },
      'whip-range-pct': { off: 0.5, impliedScope: 'summon' },
      'sentry-slots': { off: 10, impliedScope: 'summon' },
      'mining-speed-pct': { uncounted: 'abstain' },
      'aggro-flat': { uncounted: 'abstain' },
    })
  })

  it('v2 rows (B94(3)): the two §2.3-exampled B54 kinds — ammo saving 0.5 Off per % (ranged-scoped), armor penetration 1 Off per point', () => {
    expect(STAT_POINTS['ammo-save-pct']).toEqual({ off: 0.5, impliedScope: 'ranged' })
    expect(STAT_POINTS['armor-penetration-flat']).toEqual({ off: 1 })
    const stat = (s: StatKind, value: number) => ({ kind: 'stat' as const, stat: s, value })
    expect(effectPoints(stat('ammo-save-pct', 10), 'ranged')).toEqual({ off: 5, def: 0, mob: 0, surv: 0 })
    expect(appliesTo(stat('ammo-save-pct', 10), 'melee')).toBe(false)
    expect(appliesTo(stat('ammo-save-pct', 10), 'hybrid')).toBe(true)
    expect(sumPoints(effectPoints(stat('armor-penetration-flat', 5), 'magic'))).toBe(5)
    expect(appliesTo(stat('armor-penetration-flat', 5), 'summon')).toBe(true)
  })

  it('the nine B54 kinds without a ruled row score nothing (listed, not counted) — none is given an invented weight', () => {
    const b54 = ['fishing-power-flat', 'knockback-pct', 'tag-effect-slots', 'lava-immunity-ticks', 'melee-scale-pct', 'tile-reach-flat', 'potion-cooldown-pct', 'minion-knockback', 'whip-speed-pct'] as const
    for (const kind of b54) {
      const row: { off?: number; def?: number; mob?: number; surv?: number; uncounted?: string } = STAT_POINTS[kind]
      expect(row.uncounted, kind).toBeDefined()
      expect([row.off, row.def, row.mob, row.surv], kind).toEqual([undefined, undefined, undefined, undefined])
    }
  })

  it('GOAL_WEIGHTS rows each sum to 1.0, in the §5.2 component order', () => {
    expect(GOAL_COMPONENTS).toEqual(['estDamage', 'defense', 'mobility', 'survivability', 'classSynergy'])
    for (const [goal, row] of Object.entries(GOAL_WEIGHTS)) expect(row.reduce((a, b) => a + b, 0), goal).toBeCloseTo(1, 10)
    expect(GOAL_WEIGHTS.boss).toEqual([0.45, 0.1, 0.15, 0.2, 0.1])
  })

  it('slots, Demon Heart slot, defense factors (wiki Defense page), thresholds', () => {
    expect(SLOT_COUNT).toEqual({ classic: 5, expert: 6, master: 7 })
    expect(DEMON_HEART_SLOT_INDEX).toEqual({ classic: null, expert: 5, master: 6 })
    expect(MAX_ACCESSORY_SLOTS).toBe(Math.max(...Object.values(SLOT_COUNT)))
    expect(PLAYER_DEFENSE_FACTOR).toEqual({ classic: 0.5, expert: 0.75, master: 1 })
    expect(NPC_DEFENSE_FACTOR).toBe(0.5)
    expect([MOVE_SPEED_HELPS_PCT, FLIGHT_HELPS_TICKS, BASE_CRIT_PCT]).toEqual([10, 100, 4])
  })

  it('TAG_NEEDS maps every curated attack-pattern tag', () => {
    expect(Object.keys(TAG_NEEDS).sort()).toEqual([...AttackPatternTag.options].sort())
  })
})

describe('DPP proxy (SCORING_SPEC §2.2) on the §9 worked weapons', () => {
  it('§9.1 Clockwork Assault Rifle: cadence 12+14=26, ⌈12/4⌉=3 activations, 6.92 hits/s, DPP 122.4 (scored without ammo)', () => {
    const profile = weaponProfile(weapon('Clockwork Assault Rifle'))
    expect(profile.ok).toBe(true)
    if (!profile.ok) return
    expect(profile).toMatchObject({ cadenceTicks: 26, activationsPerUse: 3, ammoClass: 'musket-ball' })
    expect(profile.hitsPerSec).toBeCloseTo(6.923, 3)
    expect(critFactor(profile)).toBeCloseTo(1.04, 10)
    expect(damagePotential(profile)).toBeCloseTo(122.4, 1)
  })

  it('§9.2 Death Sickle: autoswing melee cadence 25−1 = 24 → 2.5 hits/s; crit ×1.04 on its own', () => {
    const profile = weaponProfile(weapon('Death Sickle'))
    if (!profile.ok) throw new Error('Death Sickle should be scoreable')
    expect(profile.cadenceTicks).toBe(24)
    expect(profile.hitsPerSec).toBe(2.5)
    expect(damagePotential(profile)).toBeCloseTo(57 * 2.5 * 1.04, 10)
  })

  it('a required field Unknown blocks the weapon — never defaulted (Snowball Launcher: damage)', () => {
    expect(weaponProfile(weapon('Snowball Launcher'))).toEqual({ ok: false, missing: ['damage'] })
  })

  it('summon and classless crit is not applicable: factor 1 (B17 / B85(b))', () => {
    const whip = weaponProfile(weapon('Leather Whip'))
    if (!whip.ok) throw new Error('Leather Whip should be scoreable')
    expect(whip.critApplies).toBe(false)
    expect(critFactor(whip)).toBe(1)
    expect(isSummonStaff(weapon('Finch Staff'))).toBe(true)
    expect(isSummonStaff(weapon('Leather Whip'))).toBe(false)
  })
})

describe('scope rule and points (SCORING_SPEC §2.3)', () => {
  const stat = (s: StatKind, value: number, scope?: 'melee' | 'ranged' | 'magic' | 'summon') => ({ kind: 'stat' as const, stat: s, value, ...(scope ? { scope } : {}) })

  it('an effect counts for C iff it has no scope or its scope is C; implied scopes for mana / melee speed / minion kinds; hybrid matches all', () => {
    expect(appliesTo(stat('damage-pct', 15, 'ranged'), 'melee')).toBe(false)
    expect(appliesTo(stat('damage-pct', 15, 'ranged'), 'ranged')).toBe(true)
    expect(appliesTo(stat('damage-pct', 7), 'magic')).toBe(true)
    expect(effectScope(stat('mana-cost-pct', -14))).toBe('magic')
    expect(effectScope(stat('melee-speed-pct', 10))).toBe('melee')
    expect(effectScope(stat('minion-slots', 1))).toBe('summon')
    expect(appliesTo(stat('minion-slots', 1), 'melee')).toBe(false)
    expect(appliesTo(stat('minion-slots', 1), 'hybrid')).toBe(true)
    expect(statTotal([stat('damage-pct', 10, 'melee'), stat('damage-pct', 7), stat('damage-pct', 15, 'ranged')], 'damage-pct', 'melee')).toBe(17)
  })

  it('points: defense 1+1 per point, crit 0 for summon (B17), mana cost per % of reduction, uncounted kinds 0, specials 0', () => {
    expect(effectPoints(stat('defense-flat', 8), 'melee')).toEqual({ off: 0, def: 8, mob: 0, surv: 8 })
    expect(sumPoints(effectPoints(stat('crit-pct', 10), 'summon'))).toBe(0)
    expect(sumPoints(effectPoints(stat('crit-pct', 10), 'melee'))).toBe(10)
    expect(sumPoints(effectPoints(stat('mana-cost-pct', -14), 'magic'))).toBe(14)
    expect(sumPoints(effectPoints(stat('mining-speed-pct', 25), 'melee'))).toBe(0)
    expect(sumPoints(effectPoints({ kind: 'special', text: 'x', simulated: false, sourceUrl: 'https://terraria.wiki.gg/wiki/X' }, 'melee'))).toBe(0)
    expect(sumPoints(applicablePoints(accessory('Ranger Emblem').effects, 'melee'))).toBe(0)
    expect(sumPoints(applicablePoints(accessory('Ranger Emblem').effects, 'ranged'))).toBe(15)
  })
})

describe('availability (DATA_SCHEMA_SPEC §4a isObtainableNow; SCORING_SPEC §3.1) — tracked defeats only', () => {
  it('gatedBy absent / Unknown → "unknown", never "yes" (Death Sickle)', () => {
    expect(availabilityOf(weapon('Death Sickle'), graph, tracked('wall-of-flesh', 'plantera'))).toEqual({ status: 'unknown', missing: [], conditions: [] })
  })

  it('no boss gates → "yes"; condition gates are chips that never block (Enchanted Boomerang: night)', () => {
    expect(availabilityOf(weapon('Wooden Sword'), graph, tracked())).toEqual({ status: 'yes', missing: [], conditions: [] })
    expect(availabilityOf(weapon('Enchanted Boomerang'), graph, tracked())).toEqual({ status: 'yes', missing: [], conditions: ['night'] })
  })

  it('a boss gate is met only by its tracked defeat; a milestone gate resolves to the boss that opens it (Shotgun: Hardmode → Wall of Flesh)', () => {
    expect(availabilityOf(weapon('Clockwork Assault Rifle'), graph, tracked())).toMatchObject({ status: 'gated', missing: ['wall-of-flesh'] })
    expect(availabilityOf(weapon('Clockwork Assault Rifle'), graph, tracked('wall-of-flesh')).status).toBe('yes')
    expect(availabilityOf(weapon('Shotgun'), graph, tracked())).toMatchObject({ status: 'gated', missing: ['wall-of-flesh'] })
    expect(availabilityOf(weapon('Slap Hand'), graph, tracked('wall-of-flesh'))).toEqual({ status: 'yes', missing: [], conditions: ['blood-moon'] })
  })

  it('world evil (B69/Q6 + B96a): a tracked Eater of Worlds counts under "Both" and in a Corruption world, not in a Crimson one; untracked it never counts', () => {
    const scarf = accessory('Worm Scarf')
    const ep = (worldEvil: 'corruption' | 'crimson' | null) => effectiveProgress(graph, { worldEvil, nodeStates: { 'eater-of-worlds': 'defeated' } })
    expect(availabilityOf(scarf, graph, ep('corruption')).status).toBe('yes')
    expect(availabilityOf(scarf, graph, ep('crimson'))).toMatchObject({ status: 'gated', missing: ['eater-of-worlds'] })
    expect(availabilityOf(scarf, graph, ep(null)).status).toBe('yes')
    expect(availabilityOf(scarf, graph, effectiveProgress(graph, { worldEvil: null, nodeStates: {} }))).toMatchObject({ status: 'gated', missing: ['eater-of-worlds'] })
  })

  it('gate distance under "Both" (B96a, resolves the B95 nit): the marked evil boss is distance 0, the unmarked fork ranks normally (an open boss: 1)', () => {
    const both = effectiveProgress(graph, { worldEvil: null, nodeStates: { 'eye-of-cthulhu': 'defeated', 'eater-of-worlds': 'defeated' } })
    expect(stepsFromFrontier(graph, both, 'eater-of-worlds')).toBe(0)
    expect(stepsFromFrontier(graph, both, 'brain-of-cthulhu')).toBe(1)
    expect(gateDistance(graph, both, ['eater-of-worlds'])).toBe(0)
    expect(gateDistance(graph, both, ['brain-of-cthulhu'])).toBe(1)
    // nothing marked: both forks are open bosses, distance 1 each
    const none = effectiveProgress(graph, { worldEvil: null, nodeStates: {} })
    expect([stepsFromFrontier(graph, none, 'eater-of-worlds'), stepsFromFrontier(graph, none, 'brain-of-cthulhu')]).toEqual([1, 1])
  })

  it('distance from the frontier (B94(5)): sequential boss defeats along required gates — open boss 1, milestones add nothing, satisfied 0, unknown ids last', () => {
    const steps = (ep: ReadonlySet<string>, id: string) => stepsFromFrontier(graph, ep, id)
    const none = tracked()
    expect(['king-slime', 'eye-of-cthulhu', 'skeletron', 'wall-of-flesh', 'eater-of-worlds'].map((id) => steps(none, id))).toEqual([1, 1, 1, 1, 1])
    expect(['hardmode', 'the-twins', 'queen-slime', 'all-mechanical-bosses', 'plantera', 'golem', 'lunatic-cultist', 'celestial-pillars', 'moon-lord'].map((id) => steps(none, id))).toEqual([1, 2, 2, 2, 3, 4, 5, 5, 6])
    const wof = tracked('wall-of-flesh')
    expect(['wall-of-flesh', 'hardmode', 'the-twins', 'plantera', 'moon-lord'].map((id) => steps(wof, id))).toEqual([0, 0, 1, 2, 5])
    expect(steps(none, 'not-a-node')).toBe(graph.nodes.length + 1)
    // a gate set is as far as its farthest boss; nothing missing = 0
    expect(gateDistance(graph, none, ['plantera', 'queen-bee'])).toBe(3)
    expect(gateDistance(graph, wof, ['plantera', 'queen-bee'])).toBe(2)
    expect(gateDistance(graph, none, [])).toBe(0)
  })

  it('gateBosses: an unknown node stays itself (never dropped)', () => {
    expect(gateBosses(graph, new Set(), 'not-a-node', new Map())).toEqual(['not-a-node'])
    expect(gateBosses(graph, new Set(), 'all-mechanical-bosses', new Map()).sort()).toEqual(['skeletron-prime', 'the-destroyer', 'the-twins'])
  })

  it('target-boss cap: Plantera and everything it gates (Golem, …) — not its upstream (Hardmode)', () => {
    const cap = targetCapNodes(graph, 'plantera')
    expect(cap.has('plantera')).toBe(true)
    expect(cap.has('golem')).toBe(true)
    expect(cap.has('moon-lord')).toBe(true)
    expect(cap.has('hardmode')).toBe(false)
    expect(isCappedByTarget(weapon('Leaf Blower'), cap)).toBe(true)
    expect(isCappedByTarget(weapon('Clockwork Assault Rifle'), cap)).toBe(false)
    expect(isCappedByTarget(weapon('Death Sickle'), cap)).toBe(false) // Unknown gating is never "capped" — it is excluded as unknown
    expect(isCappedByTarget(item('Ironskin Potion'), cap)).toBe(false)
  })

  it('§4.6 tie-break: score desc → fewer gates → rarityRank (special tiers pinned after 11) → id', () => {
    expect(rarityRank(11)).toBeLessThan(rarityRank('rainbow'))
    expect(rarityRank('rainbow')).toBeLessThan(rarityRank('fiery-red'))
    expect(rarityRank('fiery-red')).toBeLessThan(rarityRank('amber'))
    expect(rarityRank('amber')).toBeLessThan(rarityRank(undefined))
    const sorted = [
      { score: 5, gateCount: 1, rarity: 3, key: 9 },
      { score: 7, gateCount: 2, rarity: 3, key: 1 },
      { score: 5, gateCount: 0, rarity: 3, key: 8 },
      { score: 5, gateCount: 1, rarity: 2, key: 7 },
      { score: 5, gateCount: 1, rarity: 2, key: 3 },
    ].sort(compareRankable)
    expect(sorted.map((x) => x.key)).toEqual([1, 8, 3, 7, 9])
  })
})

describe('DPP assumptions string (verbatim, SCORING_SPEC §2.2)', () => {
  it('is the spec sentence', () => {
    expect(DPP_ASSUMPTIONS).toBe('Single target, point-blank, target defense 0, no damage variance, no reforge modifiers, one hit per melee swing, projectile/DoT side effects not counted, held-attack rate.')
  })
})
