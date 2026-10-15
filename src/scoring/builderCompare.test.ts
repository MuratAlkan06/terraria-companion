/* Loadout builder P4-S3/S4 engine (PRD P4-S3 AC1/AC2, P4-S4 AC1–AC3; SCORING_SPEC §4.8, §5.3, §5.4;
 * AMENDMENTS-016 B106 queue, B110 nit): Surprise Me (seeded draws from the full legal pool — fixture
 * goldens + a validity sweep over the live dataset), the B110 comparison-free alt line, per-item
 * contributions, the Step 3 bar references, and compareLoadouts (§5.3 scaling, symmetric exclusion,
 * zero maxima, GoalFit; one build ⇒ no fit) — with the copy audit over every new template. Live data
 * is read through properties only (no hard counts): the dataset may be regenerated under these tests. */
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
import * as builderCopy from './builderCopy'
import { availabilityOf } from './candidates'
import { DEMON_HEART_SLOT_INDEX, GOAL_COMPONENTS, GOAL_WEIGHTS, SCORING_CONSTANTS_VERSION, SLOT_COUNT } from './constants'
import { auditCopy } from './copyAudit'
import { buildSources, compareLoadouts, contributionOf, scoreBuild, sourceFigures, type BuildProfile } from './goals'
import { effectiveProgress, isNodeSatisfied, type TrackedProgress } from './progress'
import { isSummonStaff } from './proxies'
import type { ReadinessData } from './readiness'
import { ownWords, plain, type Segment } from './readinessCopy'
import { ACCESSORY_SLOT_IDS, isSeed, mulberry32, recommendLoadout, referencePools, SEED_MAX, variantFits, type BuilderInput, type BuilderResult, type SlotResult } from './recommend'
import { profileReferences, REFERENCED_COMPONENTS } from './references'
import { FIXTURE_DATA } from './testing/builderFixture'

const NONE: TrackedProgress = { worldEvil: null, nodeStates: {} }
const input = (o: Partial<BuilderInput> = {}): BuilderInput => ({ stage: 'early-prehm', cls: 'melee', difficulty: 'classic', goal: 'boss', bossId: null, owned: [], progress: NONE, ...o })
const slot = (r: BuilderResult, id: string) => r.slots.find((s) => s.id === id) as SlotResult
const fx = (o: Partial<BuilderInput> = {}) => recommendLoadout(input(o), FIXTURE_DATA)
const DRAWN = /^Drawn at random by Surprise Me from /

const byId = <T extends { id: K }, K>(list: readonly T[]) => new Map(list.map((x) => [x.id, x]))
const weapons = weaponsJson as unknown as Weapon[]
const LIVE: ReadinessData = {
  weapons: byId(weapons),
  armor: byId(armorJson as unknown as ArmorPiece[]),
  accessories: byId(accessoriesJson as unknown as Accessory[]),
  sets: byId(setsJson as unknown as ArmorSet[]),
  items: byId(itemsJson as unknown as Item[]),
  buffs: byId(buffsJson as unknown as Buff[]),
  bosses: byId(bossesJson as unknown as Boss[]),
  conditions: byId(conditionsJson as unknown as Condition[]),
  graph: progressionJson as { nodes: ProgressionNode[]; edges: ProgressionEdge[] },
  ammoTypeName: (slug) => slug,
  gameVersion: '1.4.5.8',
}

describe('Surprise Me (SCORING_SPEC §4.8; PRD P4-S4 AC3): seeded draws from the full legal pool', () => {
  it('mulberry32 is deterministic per seed, uniform floats in [0, 1); seeds are unsigned 32-bit integers', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const xs = Array.from({ length: 1000 }, () => a())
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b()))
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true)
    // roughly uniform: each tenth of [0, 1) gets a share
    const bins = Array(10).fill(0)
    for (const x of xs) bins[Math.floor(x * 10)]++
    for (const n of bins) expect(n).toBeGreaterThan(60)
    expect(mulberry32(1)()).not.toBe(mulberry32(2)())
    expect([isSeed(0), isSeed(SEED_MAX), isSeed(SEED_MAX + 1), isSeed(-1), isSeed(1.5), isSeed('7')]).toEqual([true, true, false, false, false, false])
  })

  it('fixture: every unpinned slot is drawn (source "random", the slot flagged), says so, and is a legal candidate; same seed ⇒ same loadout', () => {
    const r = fx({ seed: 7 })
    expect(r.seed).toBe(7)
    for (const s of r.slots) {
      if (!s.pick) continue
      expect(s.pick.source, s.id).toBe('random')
      expect(s.random, s.id).toBe(true)
      expect(plain(s.pick.rationale), s.id).toMatch(DRAWN)
      expect(plain(s.pick.rationale), s.id).toMatch(/not ranked by score\./)
      expect(s.pick.availability.status, s.id).toBe('yes')
    }
    // the main comes from the eligible melee pool (gated Hard Blade, Unknown Mystery Blade, unscoreable Broken Blade never)
    expect(['Copper Blade', 'Iron Blade', 'Spear X']).toContain(slot(r, 'main').pick?.name)
    expect(fx({ seed: 7 })).toEqual(r)
    // no seed: the recommendation, unchanged
    expect(fx().slots.every((s) => !s.random && s.pick?.source !== 'random')).toBe(true)
    expect(fx().seed).toBeUndefined()
  })

  it('fixture: draws are uniform over the legal list — over many seeds every eligible main and armor set turns up, never an ineligible one', () => {
    const mains = new Set<string>()
    const sets = new Set<string>()
    for (let seed = 1; seed <= 200; seed++) {
      const r = fx({ seed })
      mains.add(slot(r, 'main').pick?.name ?? '-')
      sets.add(slot(r, 'armor').pick?.name ?? '-')
    }
    expect([...mains].sort()).toEqual(['Copper Blade', 'Iron Blade', 'Spear X'])
    // melee-fitting sets verified obtainable at Early Pre-HM: Wood (classless), Ninja, Tank, Duo (melee/ranged) — never Mage or the gated Mech set
    expect([...sets].sort()).toEqual(['Duo armor', 'Ninja armor', 'Tank armor', 'Wood armor'])
  })

  it('fixture: pins override the draw; a pinned-empty slot stays empty; a drawn pick lists the top-ranked candidates (scoring-higher ones marked)', () => {
    const r = fx({ seed: 3, pins: { main: { kind: 'item', id: 2 }, acc0: { kind: 'empty' } } })
    expect(slot(r, 'main').pick).toMatchObject({ name: 'Iron Blade', source: 'pinned' })
    expect(slot(r, 'acc0').state).toBe('empty')
    expect(slot(r, 'acc0').random).toBeUndefined()
    for (let seed = 1; seed <= 40; seed++) {
      const main = slot(fx({ seed }), 'main')
      if (main.pick?.name !== 'Copper Blade') continue
      // Copper Blade drawn: the higher-scoring candidates are listed and marked
      expect(main.alternatives.filter((a) => a.higher).map((a) => a.name).sort()).toEqual(['Iron Blade', 'Spear X'])
      return
    }
    throw new Error('no seed in 1..40 drew Copper Blade')
  })

  it('fixture: a drawn accessory is drawn from every category and scored on all its points; a drawn summon keeps the minion-AI note', () => {
    let sawOffQuota = false
    for (let seed = 1; seed <= 60; seed++) {
      const r = fx({ seed, cls: 'summon', goal: 'boss' })
      for (const s of r.slots.filter((x) => x.group === 'accessories' && x.pick)) {
        expect(s.pick?.score?.label, s.id).toBe(builderCopy.scoreLabel.accessoryAny)
        const acc = FIXTURE_DATA.accessories.get(s.pick?.id ?? -1)
        if (acc && !acc.categories.map((c) => ({ offense: 'off', defense: 'def', mobility: 'mob', utility: 'util' })[c]).includes(s.quota as string)) sawOffQuota = true
      }
      const summon = slot(r, 'summon').pick
      if (summon) expect(plain(summon.rationale)).toMatch(/Its attack rate varies by minion AI — not estimated\.$/)
    }
    expect(sawOffQuota).toBe(true)
  })

  it('live sweep (5 stages × 5 classes × 3 difficulty/goal pairs × 6 seeds, Crimson world): every draw is stage-legal and honours every constraint', () => {
    const STAGES: Stage[] = ['early-prehm', 'late-prehm', 'early-hm', 'mid-hm', 'endgame']
    const CLASSES: LoadoutClass[] = ['melee', 'ranged', 'magic', 'summon', 'hybrid']
    const PAIRS: [Difficulty, Goal][] = [
      ['expert', 'boss'],
      ['master', 'balanced'],
      ['classic', 'survivability'],
    ]
    const recordOf = (id: number) => LIVE.weapons.get(id) ?? LIVE.armor.get(id) ?? LIVE.accessories.get(id) ?? LIVE.items.get(id)
    let drawnPicks = 0
    for (const stage of STAGES)
      for (const cls of CLASSES)
        for (const [difficulty, goal] of PAIRS)
          for (let seed = 1; seed <= 6; seed++) {
            const progress: TrackedProgress = { worldEvil: 'crimson', nodeStates: {} }
            const r = recommendLoadout(input({ stage, cls, difficulty, goal, progress, seed }), LIVE)
            const where = `${stage}/${cls}/${difficulty}/seed ${seed}`
            const ep = effectiveProgress(LIVE.graph, progress, stage)
            for (const s of r.slots) {
              if (!s.pick) continue
              drawnPicks++
              expect(s.pick.source, `${where}/${s.id}`).toBe('random')
              // availability: verified obtainable at tracked ∪ virtual — never gated, never Unknown (nothing owned)
              for (const id of s.pick.pieces?.filter((x) => x > 0) ?? [s.pick.id]) {
                expect(availabilityOf(recordOf(id) as Weapon, LIVE.graph, ep).status, `${where}/${s.id}/${id}`).toBe('yes')
              }
            }
            // weapons: class-legal, never a staff in a weapon slot; hybrid's alt is another damage class
            const main = slot(r, 'main').pick
            const alt = slot(r, 'alt').pick
            const mw = main ? (LIVE.weapons.get(main.id) as Weapon) : undefined
            const aw = alt ? (LIVE.weapons.get(alt.id) as Weapon) : undefined
            for (const w of [mw, aw]) {
              if (!w) continue
              expect(isSummonStaff(w), where).toBe(false)
              if (cls === 'summon') expect(w.tags, where).toContain('whips')
              else if (cls !== 'hybrid') expect(w.damageClass, where).toBe(cls)
            }
            if (mw && aw) {
              expect(aw.id, where).not.toBe(mw.id)
              if (cls === 'hybrid') expect(aw.damageClass, where).not.toBe(mw.damageClass)
            }
            // armor: a class-fitting variant of one set
            const armor = slot(r, 'armor').pick
            if (armor?.setId) {
              const set = LIVE.sets.get(armor.setId) as ArmorSet
              const variant = set.variants.find((v) => v.helmetId === armor.pieces?.[0])
              expect(variant && variantFits(variant, cls), where).toBe(true)
            }
            // accessories: slot count, the Demon Heart slot, no duplicates, ≤ 1 wings, no direct upgrade pair
            const acc = r.slots.filter((s) => s.group === 'accessories')
            expect(acc, where).toHaveLength(SLOT_COUNT[difficulty])
            const dh = DEMON_HEART_SLOT_INDEX[difficulty]
            if (dh !== null) expect(slot(r, ACCESSORY_SLOT_IDS[dh]).state === 'locked', where).toBe(!isNodeSatisfied(LIVE.graph, ep, 'wall-of-flesh'))
            const ids = acc.flatMap((s) => (s.pick ? [s.pick.id] : []))
            expect(new Set(ids).size, where).toBe(ids.length)
            const recs = ids.map((id) => LIVE.accessories.get(id) as Accessory)
            expect(recs.filter((a) => a.wingStats !== undefined).length, where).toBeLessThanOrEqual(1)
            for (const a of recs) for (const linked of [...a.combinedFrom, ...a.upgradesTo]) expect(ids, where).not.toContain(linked)
            // ammo: the type the weapon fires
            for (const id of ['ammo0', 'ammo1'] as const) {
              const s = slot(r, id)
              if (!s?.pick) continue
              const ammo = (LIVE.items.get(s.pick.id) ?? LIVE.weapons.get(s.pick.id)) as Item
              const weapon = s.ammoFor === 'main' ? mw : aw
              expect(ammo.ammoStats?.ammoClass, where).toBe(weapon?.ammoClass)
            }
            // potions: never the same buff twice
            const buffIds = r.slots
              .filter((s) => s.group === 'buffs' && s.pick)
              .flatMap((s) => (LIVE.items.get(s.pick?.id ?? -1)?.buffGrants ?? []).map((g) => g.buffId).filter((b) => b !== 'potion-sickness' && b !== 'mana-sickness'))
            expect(new Set(buffIds).size, where).toBe(buffIds.length)
            // the summon slot: a minion staff
            const summon = slot(r, 'summon').pick
            if (summon) expect((LIVE.weapons.get(summon.id) as Weapon).tags, where).toContain('minion-summon-items')
          }
    expect(drawnPicks).toBeGreaterThan(1000)
  })

  it('live: deterministic per seed, and different seeds give different loadouts where the pools allow it', () => {
    const base = input({ stage: 'endgame', cls: 'melee', difficulty: 'master', goal: 'balanced' })
    const a = recommendLoadout({ ...base, seed: 11 }, LIVE)
    expect(recommendLoadout({ ...base, seed: 11 }, LIVE).loadout).toEqual(a.loadout)
    const loadouts = new Set(Array.from({ length: 8 }, (_, i) => JSON.stringify(recommendLoadout({ ...base, seed: 100 + i }, LIVE).loadout)))
    expect(loadouts.size).toBeGreaterThan(1)
  })
})

describe('AMENDMENTS-016 B110: a pinned main whose score is Unknown — the alt line compares nothing with it', () => {
  it('another kind (fixture): Broken Blade (damage Unknown) pinned — Spear X says it is the highest of another kind and that the pick’s score is Unknown', () => {
    const r = fx({ pins: { main: { kind: 'item', id: 6 } } })
    expect(slot(r, 'main').pick).toMatchObject({ name: 'Broken Blade', source: 'pinned' })
    expect(slot(r, 'main').pick?.score).toBeUndefined()
    expect(slot(r, 'alt').pick?.name).toBe('Spear X')
    const line = plain(slot(r, 'alt').pick?.rationale ?? [])
    expect(line).toBe('Highest estimated damage per second from a different kind of weapon than your main one — this one is a spear. Your pick’s score is Unknown.')
    expect(line).not.toMatch(/Next-highest|scores above your pick/)
  })

  it('the same kind (fixture without the spear): Iron Blade beside the unscored pin; the plain wording without a kind', () => {
    const swordsOnly = { ...FIXTURE_DATA, weapons: new Map([...FIXTURE_DATA.weapons].filter(([id]) => id !== 3)) }
    const r = recommendLoadout(input({ pins: { main: { kind: 'item', id: 6 } } }), swordsOnly)
    expect(slot(r, 'alt').pick?.name).toBe('Iron Blade')
    expect(plain(slot(r, 'alt').pick?.rationale ?? [])).toBe('Highest estimated damage per second; no other kind of weapon is verified obtainable at your progress. Your pick’s score is Unknown.')
    expect(plain(builderCopy.rationale.altTypeUnscoredPin(undefined))).toBe('Highest estimated damage per second from a different kind of weapon than your main one. Your pick’s score is Unknown.')
  })
})

describe('PRD P4-S3 AC1: what each piece of gear adds (profile contributions)', () => {
  it('fixture: pieces with their defense and points, the set bonus with its unscored dash, wings as flight points, other-class points apart', () => {
    const ninja = FIXTURE_DATA.sets.get('ninja') as ArmorSet
    const pieces = [110, 111, 112].map((id) => FIXTURE_DATA.armor.get(id) as ArmorPiece)
    const profile = scoreBuild({
      cls: 'melee',
      goal: 'boss',
      pieces,
      set: { set: ninja, variant: ninja.variants[0] },
      accessories: [FIXTURE_DATA.accessories.get(201) as Accessory, FIXTURE_DATA.accessories.get(206) as Accessory],
      potions: [],
    })
    expect(profile.contributions).toEqual([
      { name: 'Ninja Hood', kind: 'armor', id: 110, defense: 2, points: { off: 5, def: 0, mob: 0, surv: 0 }, otherClass: 0, unscored: 0 },
      { name: 'Ninja Shirt', kind: 'armor', id: 111, defense: 3, points: { off: 0, def: 0, mob: 0, surv: 0 }, otherClass: 0, unscored: 0 },
      { name: 'Ninja Pants', kind: 'armor', id: 112, defense: 2, points: { off: 0, def: 0, mob: 0, surv: 0 }, otherClass: 0, unscored: 0 },
      { name: 'Ninja armor', kind: 'set', setId: 'ninja', points: { off: 0, def: 0, mob: 20, surv: 0 }, otherClass: 0, unscored: 1 },
      // Ranger Emblem on a melee build: its 15% ranged damage counts for another class only
      { name: 'Ranger Emblem', kind: 'accessory', id: 201, points: { off: 0, def: 0, mob: 0, surv: 0 }, otherClass: 15, unscored: 0 },
      { name: 'Wings A', kind: 'accessory', id: 206, points: { off: 0, def: 0, mob: 10, surv: 0 }, otherClass: 0, unscored: 1 },
    ])
    // the profile's own figures agree with the itemization (mobility 20 + 10)
    expect(profile.components.find((c) => c.id === 'mobility')?.value).toBe(30)
    expect(contributionOf({ name: 'x', kind: 'potion', effects: [] }, 'melee')).toEqual({ name: 'x', kind: 'potion', points: { off: 0, def: 0, mob: 0, surv: 0 }, otherClass: 0, unscored: 0 })
  })

  it('every recommended loadout itemizes each armor piece, the set bonus, each accessory and each potion', () => {
    const r = fx({ stage: 'early-hm', cls: 'ranged', difficulty: 'expert' })
    const sources = r.slots.filter((s) => s.pick && (s.group === 'accessories' || s.group === 'buffs')).length + (r.loadout.helmet ? 3 : 0) + (r.profile.setBonus ? 1 : 0)
    expect(r.profile.contributions).toHaveLength(sources)
  })
})

describe('PRD P4-S3 AC2 / AMENDMENTS-016 B113a: the bars’ references — the highest figure found among verified-obtainable gear, pick-independent', () => {
  const base = input({ stage: 'early-hm', cls: 'ranged', difficulty: 'expert', goal: 'balanced', owned: [] })
  const GOALS: Goal[] = ['boss', 'max-damage', 'exploration', 'survivability', 'mobility', 'balanced']

  it('self-comparison is banned structurally: the goal, pins, a Surprise Me seed and owned gear never change a reference', () => {
    const refs = profileReferences(base, FIXTURE_DATA)
    for (const goal of GOALS) expect(profileReferences({ ...base, goal } as BuilderInput, FIXTURE_DATA), goal).toEqual(refs)
    const picked: BuilderInput = { ...base, goal: 'survivability', seed: 5, owned: [10, 11, 12], pins: { main: { kind: 'item', id: 10 }, acc0: { kind: 'empty' }, armor: { kind: 'armor', helmet: 120, chest: 121, legs: 122 } } }
    expect(profileReferences(picked, FIXTURE_DATA)).toEqual(refs)
    // …while the loadout those picks make does change (the reference is not a function of it)
    expect(fx(picked).profile).not.toEqual(fx(base).profile)
  })

  it('every default recommendation, whatever its goal, sits at or under each reference; each reference names the gear that reaches it', () => {
    for (const stage of ['early-prehm', 'early-hm', 'endgame'] as const) {
      for (const cls of ['melee', 'ranged', 'magic'] as const) {
        const i = input({ stage, cls, difficulty: 'expert' })
        const refs = profileReferences(i, FIXTURE_DATA)
        for (const goal of GOALS) {
          const p = fx({ ...i, goal }).profile
          for (const id of REFERENCED_COMPONENTS) {
            const v = p.components.find((c) => c.id === id)?.value
            if (v !== undefined) expect(v, `${stage}/${cls}/${goal}/${id}`).toBeLessThanOrEqual((refs[id].value ?? -Infinity) + 1e-9)
          }
        }
        for (const id of REFERENCED_COMPONENTS) {
          const r = refs[id]
          if (r.value === undefined) continue
          expect(r.assumptions.map((a) => a.id)[0], id).toBe('reference-found')
          if (r.value > 0) expect(r.gear.length, `${stage}/${cls}/${id}`).toBeGreaterThan(0)
        }
      }
    }
  })

  it('a full bar is earnable: pinning the gear a reference names reaches that figure exactly (scored by scoreBuild itself)', () => {
    const pools = referencePools(base, FIXTURE_DATA)
    const refs = profileReferences(base, FIXTURE_DATA)
    // defense: the reference loadout rebuilt from the pools by name, scored as a build
    const named = refs.defense.gear.join(' ')
    const armor = pools.armor.find((a) => named.includes(`Armor: ${a.name}.`))
    const accessories = pools.accessories.filter((a) => named.includes(a.accessory.name)).map((a) => a.accessory)
    const potions = pools.potions.filter((p) => named.includes(p.item.name)).map((p) => ({ item: p.item, effects: p.effects }))
    const rebuilt = scoreBuild({ cls: base.cls, goal: 'balanced', pieces: armor?.pieces ?? [], ...(armor ? { set: { set: armor.set, variant: armor.variant } } : {}), accessories, potions })
    expect(rebuilt.components.find((c) => c.id === 'defense')?.value).toBe(refs.defense.value)
    // the additive figures are sums over sources: sourceFigures adds up to scoreBuild's own figures
    const sources = buildSources({ cls: base.cls, goal: 'balanced', pieces: armor?.pieces ?? [], ...(armor ? { set: { set: armor.set, variant: armor.variant } } : {}), accessories, potions })
    for (const id of ['defense', 'mobility', 'survivability'] as const) {
      const sum = sources.reduce((acc, src) => acc + sourceFigures(src, base.cls)[id], 0)
      expect(sum, id).toBeCloseTo(rebuilt.components.find((c) => c.id === id)?.value as number, 9)
    }
  })

  it('a build without a main weapon: the reference still exists (it never depends on the build); no weapon obtainable → no damage reference', () => {
    const noMain = profileReferences({ ...base, pins: { main: { kind: 'empty' } } } as BuilderInput, FIXTURE_DATA)
    expect(noMain).toEqual(profileReferences(base, FIXTURE_DATA))
    const summonless = profileReferences(input({ cls: 'magic' }), FIXTURE_DATA)
    if (referencePools(input({ cls: 'magic' }), FIXTURE_DATA).weapons.length === 0) expect(summonless.estDamage.value).toBeUndefined()
  })
})

describe('AMENDMENTS-016 B113a on the live data: the reviewer’s four sampled inputs', () => {
  // Mid-HM melee Survivability (the reference WAS this loadout); Mid-HM Balanced; Early-HM ranged Max damage; Early-PreHM magic Mobility
  const combos: Partial<BuilderInput>[] = [
    { stage: 'mid-hm', cls: 'melee', goal: 'survivability' },
    { stage: 'mid-hm', cls: 'melee', goal: 'balanced' },
    { stage: 'early-hm', cls: 'ranged', goal: 'max-damage' },
    { stage: 'early-prehm', cls: 'magic', goal: 'mobility' },
  ]
  it('defense and survivability bars come out short wherever the data has more; a full one is the loadout holding the reference’s own figure', () => {
    let short = 0
    for (const c of combos) {
      const i = input({ difficulty: 'expert', ...c })
      const r = recommendLoadout(i, LIVE)
      const refs = profileReferences(i, LIVE)
      for (const id of ['defense', 'survivability'] as const) {
        const v = r.profile.components.find((x) => x.id === id)?.value as number
        const ref = refs[id].value as number
        expect(v, `${c.stage}/${c.goal}/${id}`).toBeLessThanOrEqual(ref + 1e-9)
        if (v < ref - 1e-9) short++
        // a reference is never the loadout itself: it holds the most of THIS figure the pools allow
        else expect(r.profile.components.find((x) => x.id === id)?.value).toBe(ref)
      }
      // the Survivability-goal loadout's reference differs from the loadout (the self-comparison the review found)
      if (c.goal === 'survivability') expect(refs.defense.value).toBeGreaterThan(r.profile.components.find((x) => x.id === 'defense')?.value as number)
    }
    expect(short).toBeGreaterThanOrEqual(6)
  })
})

describe('compareLoadouts (SCORING_SPEC §5.3, §5.4; PRD P4-S4 AC1/AC2; AMENDMENTS-016 B113b)', () => {
  const boss = fx({ stage: 'early-hm', difficulty: 'expert', goal: 'boss' }).profile
  const tank = fx({ stage: 'early-hm', difficulty: 'expert', goal: 'survivability', pins: { armor: { kind: 'armor', helmet: 120, chest: 121, legs: 122 } } }).profile
  const raw = (p: BuildProfile, id: string) => p.components.find((c) => c.id === id)?.value as number
  /** A profile with every computed figure multiplied by `k` (class synergy kept, as a real loadout's 100 of 100 would be). */
  const scaledBy = (p: BuildProfile, k: number): BuildProfile => ({
    ...p,
    components: p.components.map((c) => (c.value === undefined || c.id === 'classSynergy' ? c : { ...c, value: c.value * k, text: (c.value * k).toFixed(1) })),
  })

  it('splits each figure — class synergy too — between the builds in proportion to their values and folds them with the goal’s weights', () => {
    const cmp = compareLoadouts([boss, tank], 'balanced')
    expect(cmp).toMatchObject({ goal: 'balanced', constantsVersion: SCORING_CONSTANTS_VERSION, dropped: [] })
    expect(Object.keys(cmp).sort()).toEqual(['builds', 'constantsVersion', 'difference', 'dropped', 'goal', 'zeroMax'])
    const w = GOAL_WEIGHTS.balanced
    for (const [b, profile] of [boss, tank].entries()) {
      let sum = 0
      for (const [k, id] of GOAL_COMPONENTS.entries()) {
        const c = cmp.builds[b].components[k]
        expect(c.id).toBe(id)
        const total = Math.abs(raw(boss, id)) + Math.abs(raw(tank, id))
        const share = total <= 0 ? 0 : (100 * raw(profile, id)) / total
        expect(c.scaled, `${b}/${id}`).toBeCloseTo(share, 10)
        expect(c.weight).toBe(w[k])
        expect(c.contribution).toBeCloseTo(w[k] * share, 10)
        sum += w[k] * share
      }
      expect(cmp.builds[b].fit?.value).toBeCloseTo(sum / 1, 10)
      expect(cmp.builds[b].fit?.formulaText).toMatch(/^\(0\.25 × [\d.]+ \+ 0\.2 × [\d.]+ \+ 0\.2 × [\d.]+ \+ 0\.2 × [\d.]+ \+ 0\.15 × [\d.]+\) ÷ 1 = [\d.]+$/)
    }
    // a figure's two shares add up to 100 ("100 × 35 ÷ (35 + 20) = 63.6"), so the two weighted sums do too
    for (const k of [0, 1, 2, 3, 4]) expect((cmp.builds[0].components[k].scaled as number) + (cmp.builds[1].components[k].scaled as number)).toBeCloseTo(100, 9)
    expect((cmp.builds[0].fit?.value as number) + (cmp.builds[1].fit?.value as number)).toBeCloseTo(100, 9)
    expect(cmp.builds[0].components[1].scaledFormula).toMatch(/^100 × \d+ ÷ \(\d+ \+ \d+\) = [\d.]+$/)
  })

  it('B113b: ONE signed difference (second − first) with its est. tip; the weighted sums stay in the breakdown', () => {
    const cmp = compareLoadouts([boss, tank], 'survivability', ['this draft', 'saved'])
    const [a, b] = cmp.builds.map((x) => x.fit?.value as number)
    expect(cmp.difference?.value).toBeCloseTo(b - a, 10)
    // the stated difference is the written sums' difference (one decimal each): the formula's arithmetic holds as read
    const [ta, tb] = cmp.builds.map((x) => Number(x.fit?.text))
    expect(cmp.difference?.sign).toBe(Math.abs(tb - ta) < 0.05 ? 0 : Math.sign(tb - ta))
    if (cmp.difference?.sign) expect(Number(cmp.difference.text)).toBeCloseTo(Math.abs(tb - ta), 9)
    expect(cmp.difference?.formulaText).toMatch(/^[\d.]+ \(saved\) − [\d.]+ \(this draft\) = (?:[+−][\d.]+|same)$/)
    expect(cmp.difference?.assumptions.map((x) => x.id)).toEqual(['fit-relative', 'fit-formula', 'fit-figures', 'fit-weights'])
    // three builds: no single difference
    expect(compareLoadouts([boss, tank, boss], 'boss').difference).toBeUndefined()
  })

  it('B113b: no 100.0 anchor — a build dominating every figure is never pinned at 100; ties read "same"', () => {
    const big = scaledBy(boss, 1.5)
    const cmp = compareLoadouts([boss, big], 'survivability')
    for (const b of cmp.builds) {
      expect(b.fit?.text).not.toBe('100.0')
      expect(b.fit?.formulaText).not.toMatch(/100\.0/)
      for (const c of b.components) expect(c.scaledText, c.id).not.toBe('100.0')
    }
    // every figure 1.5× → shares 40 / 60; class synergy level (100 of 100 each) → 50 / 50, never "100.0"
    for (const c of cmp.builds[1].components) if (c.raw) expect(c.scaled, c.id).toBeCloseTo(c.id === 'classSynergy' ? 50 : 60, 9)
    expect(cmp.difference).toMatchObject({ sign: 1 })
    expect(Number(cmp.difference?.text)).toBeGreaterThan(0)
    const tie = compareLoadouts([boss, boss], 'survivability')
    expect(tie.difference).toMatchObject({ sign: 0, text: '' })
    expect(tie.difference?.formulaText).toMatch(/= same$/)
    expect(tie.builds[0].fit?.text).toBe(tie.builds[1].fit?.text)
  })

  it('symmetric: the order of the builds flips the difference’s sign and nothing else; another goal only reweights', () => {
    const ab = compareLoadouts([boss, tank], 'boss')
    const ba = compareLoadouts([tank, boss], 'boss')
    expect(ba.builds).toEqual([ab.builds[1], ab.builds[0]])
    expect(ba.difference?.value).toBeCloseTo(-(ab.difference?.value as number), 10)
    const other = compareLoadouts([boss, tank], 'mobility')
    for (const b of [0, 1]) for (const k of [0, 1, 2, 3, 4]) expect(other.builds[b].components[k].scaled).toBe(ab.builds[b].components[k].scaled)
    expect(other.builds[0].components.map((c) => c.weight)).toEqual([...GOAL_WEIGHTS.mobility])
  })

  it('a figure missing from ONE build is left out for ALL (disclosed); a figure 0 everywhere gets 0 (flagged)', () => {
    const noWeapon = fx({ stage: 'early-hm', difficulty: 'expert', goal: 'boss', pins: { main: { kind: 'empty' } } }).profile
    expect(noWeapon.components.find((c) => c.id === 'estDamage')?.value).toBeUndefined()
    const cmp = compareLoadouts([boss, noWeapon], 'boss')
    expect(cmp.dropped).toEqual([{ id: 'estDamage', label: builderCopy.profileCopy.label.estDamage }])
    for (const b of cmp.builds) {
      expect(b.components[0]).toMatchObject({ id: 'estDamage', dropped: true })
      expect(b.components[0].scaled).toBeUndefined()
      // the sum divides by the included weights only (boss: 1 − 0.45)
      expect(b.fit?.formulaText).toMatch(/÷ 0\.55 = /)
    }
    const zero = (p: BuildProfile): BuildProfile => ({ ...p, components: p.components.map((c) => (c.id === 'mobility' ? { ...c, value: 0, text: '0.0' } : c)) })
    const flat = compareLoadouts([zero(boss), zero(tank)], 'boss')
    expect(flat.zeroMax).toEqual([{ id: 'mobility', label: builderCopy.profileCopy.label.mobility }])
    for (const b of flat.builds) expect(b.components[2].scaled).toBe(0)
  })

  it('one build: components only — no scaling, no sum, no difference (§5.3 "Single build ⇒ components-only")', () => {
    const one = compareLoadouts([boss], 'boss')
    expect(one.builds[0].fit).toBeUndefined()
    expect(one.difference).toBeUndefined()
    expect(one.builds[0].components.every((c) => c.scaled === undefined && c.contribution === undefined)).toBe(true)
    expect(one.zeroMax).toEqual([])
  })
})

describe('copy audit: the new engine templates (SCORING_SPEC §8.4) — no "best", outcome or winner wording', () => {
  it('every new template, with sample values', () => {
    const item: Segment = { kind: 'item', id: 1, text: 'Thing' }
    const n = { verified: 12, owned: 1 }
    const texts: string[] = []
    const r = builderCopy.rationale
    const d = builderCopy.drawnFrom
    for (const segs of [
      r.random(d.main(n, 'melee')),
      r.random(d.main(n, 'summon')),
      r.random(d.alt(n, 'hybrid')),
      r.random(d.alt(n, 'summon')),
      r.random(d.alt(n, 'ranged')),
      r.random(d.armor(n)),
      r.random(d.accessory(n)),
      r.random(d.ammo(n, 'Bullets', item)),
      r.random(d.buff(n)),
      r.random(d.summon(n)),
      r.altTypeUnscoredPin('a bow'),
      r.altTypeUnscoredPin(undefined),
      r.altSameTypeUnscoredPin(),
    ])
      texts.push(ownWords(segs))
    const c = builderCopy.comparisonCopy
    texts.push(c.fitLabel, c.share('35', ['35', '20'], '63.6'), c.zeroMax('Mobility'), c.dropped('Estimated damage per second'), c.fitFormula([{ weight: '0.25', scaled: '63.6' }], '1', '63.6'), c.differenceFormula('58.8', 'saved', '41.2', 'this draft', '+17.6'), c.same, c.noFit, c.estimateContext('boss fight'))
    const ref = builderCopy.referenceAssumption
    for (const x of [ref.found('Early Hardmode', true), ref.found('Early Hardmode', false), ref.gear([ref.weapon('Star Cannon', 'Fallen Star'), ref.weapon('Zenith'), ref.armor('Pearlwood armor'), ref.accessories(['Aglet', 'Anklet of the Wind']), ref.potions(['Ironskin Potion'])]), ref.formula('8 + 8 = 16')]) texts.push(x.title, x.detail)
    const a = builderCopy.comparisonAssumption
    for (const x of [a.relative(), a.weights('boss', 2), a.figures(), a.formula('1 + 2')]) texts.push(x.title, x.detail)
    const k = builderCopy.contributionCopy
    texts.push(k.defense('2'), k.points('15', 'offense'), k.otherClass('15'), k.unscored(1), k.unscored(3), k.nothing)
    for (const t of texts) {
      expect(auditCopy(t), t).toBeUndefined()
      expect(t, t).not.toMatch(/\bbetter\b|\bwinner\b|\bstronger\b|\bweaker\b|\bworse\b|\bahead\b/i)
    }
    // B113(e): the verb agrees with the count ("the 1 buff potion … that grants", "the 12 … that grant")
    expect(plain(r.buff({ verified: 1, owned: 0 }))).toContain('the 1 buff potion verified obtainable at your progress that grants a buff')
    expect(plain(r.buff(n))).toContain('the 12 buff potions verified obtainable at your progress that grant a buff')
    // the drawn line names its pool honestly (owned gear apart from the verified count, B108 H3)
    expect(plain(r.random(d.main(n, 'melee')))).toBe('Drawn at random by Surprise Me from the 12 melee weapons verified obtainable at your progress + 1 owned (unverified) — not ranked by score.')
  })
})
