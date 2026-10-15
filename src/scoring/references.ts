/**
 * The Step 3 profile bars' references (PRD P4-S3 AC2; AMENDMENTS-016 B113a). Pure TypeScript.
 *
 * Each referenced figure's bar runs to the highest value of THAT figure the search finds among gear
 * verified obtainable for the user's stage, class, difficulty, target boss and tracked progress — the
 * pools the swap sheets offer (`referencePools`), owned-but-unverified gear left out. The reference is
 * pick-independent by construction: it reads only a ReferenceInput, never the goal, a pin, owned gear or
 * a Surprise Me seed, so a bar can never compare a loadout with itself, and a FULL bar is earned — the
 * reference is a real, legal loadout from those pools (one armor set, ≤ the open accessory slots with no
 * repeat, ≤ 1 pair of wings, no direct combine / upgrade pair, ≤ 3 potions with different buffs), and its
 * figure is computed by scoreBuild itself, so swapping that gear in reaches it exactly.
 *
 * - defense, mobility, survivability are sums over the build's sources (`sourceFigures`): the armor set
 *   with the most, then accessories and potions greedily by what each adds, under the constraints.
 * - estDamage multiplies its terms: every weapon is tried (highest base estimate first, skipped once even
 *   an upper bound can't pass the figure found), each with gear chosen step by step (coordinate ascent:
 *   armor, accessories one slot at a time, potions; twice). Disclosed as "the highest found".
 * Every reference is an estimate with its own AssumptionsTip (how it was found, the gear, its formula).
 */
import type { Accessory, ArmorPiece, ArmorSet, DamageClass, Item, StatEffect, Weapon } from '../schemas'
import { BUFF_SLOTS, SCORING_CONSTANTS_VERSION } from './constants'
import { profileAssumption, referenceAssumption } from './builderCopy'
import { buildSources, edoValue, offenseTerms, scoreBuild, sourceFigures, type BuildSource, type BuildSources, type OffenseTerms, type ProfileEstimate } from './goals'
import { damagePotential, weaponProfile, type WeaponProfile } from './proxies'
import type { AssumptionText } from './readinessCopy'
import { referencePools, type BuilderData, type RecommendOptions, type ReferenceInput, type ReferencePools } from './recommend'

/** The figures that get a reference; class synergy is out of 100 on its own. */
export const REFERENCED_COMPONENTS = ['estDamage', 'defense', 'mobility', 'survivability'] as const
export type ReferencedComponent = (typeof REFERENCED_COMPONENTS)[number]

export interface ProfileReference {
  /** The highest figure found; undefined when nothing verified obtainable gives one (no bar). */
  value?: number
  text: string
  unit: string
  /** Its EstimateLabel key (every profile figure is an estimate, B108(d)). */
  estimate?: ProfileEstimate
  /** AssumptionsTip: how it was found, the gear that reaches it, its numbers. */
  assumptions: AssumptionText[]
  /** The gear that reaches it, by name (weapon, armor set, accessories, potions). */
  gear: string[]
}

type Additive = 'defense' | 'mobility' | 'survivability'

interface ArmorUnit {
  name: string
  set: ArmorSet
  variant: ArmorSet['variants'][number]
  pieces: readonly ArmorPiece[]
  sources: BuildSource[]
}
interface AccessoryUnit {
  accessory: Accessory
  wings: boolean
  links: readonly number[]
  source: BuildSource
}
interface PotionUnit {
  item: Item
  buffIds: readonly string[]
  effects: readonly StatEffect[]
  source: BuildSource
}

/** The loadout a reference figure comes from. */
interface ReferenceLoadout {
  weapon?: { weapon: Weapon; ammo?: { name: string; damage: number } }
  armor?: ArmorUnit
  accessories: AccessoryUnit[]
  potions: PotionUnit[]
}

const EPS = 1e-9

/** Each candidate as the BuildSources it adds (an armor set: its pieces and its bonus). */
function units(pools: ReferencePools, cls: ReferenceInput['cls']) {
  const sourcesOf = (o: Partial<BuildSources>) => buildSources({ cls, goal: 'balanced', pieces: [], accessories: [], potions: [], ...o })
  const armor: ArmorUnit[] = pools.armor.map((a) => ({ ...a, sources: sourcesOf({ pieces: a.pieces, set: { set: a.set, variant: a.variant } }) }))
  const accessories: AccessoryUnit[] = pools.accessories.map((a) => ({ ...a, source: sourcesOf({ accessories: [a.accessory] })[0] }))
  const potions: PotionUnit[] = pools.potions.map((p) => ({ ...p, source: sourcesOf({ potions: [{ item: p.item, effects: p.effects }] })[0] }))
  return { armor, accessories, potions }
}
type Units = ReturnType<typeof units>

/** Accessory legality against those already chosen (the builder's §4.4 constraints). */
function fits(chosen: readonly AccessoryUnit[], c: AccessoryUnit): boolean {
  for (const x of chosen) {
    if (x.accessory.id === c.accessory.id) return false
    if (x.wings && c.wings) return false
    if (x.links.includes(c.accessory.id) || c.links.includes(x.accessory.id)) return false
  }
  return true
}
const potionFits = (chosen: readonly PotionUnit[], p: PotionUnit) => chosen.every((x) => x.item.id !== p.item.id && !x.buffIds.some((b) => p.buffIds.includes(b)))

/**
 * Greedy picks, one slot at a time: the legal candidate adding the most given those already chosen, while
 * one still adds (ties: pool order — deterministic). `gainFor(chosen)` prepares one slot's gain function.
 */
function greedy<T>(pool: readonly T[], slots: number, gainFor: (chosen: readonly T[]) => (c: T) => number, legal: (chosen: readonly T[], c: T) => boolean): T[] {
  const chosen: T[] = []
  for (let k = 0; k < slots; k++) {
    const gain = gainFor(chosen)
    let top: T | undefined
    let topGain = EPS
    for (const c of pool) {
      if (!legal(chosen, c)) continue
      const g = gain(c)
      if (g > topGain + EPS) {
        top = c
        topGain = g
      }
    }
    if (top === undefined) break
    chosen.push(top)
  }
  return chosen
}

/** An additive figure's reference loadout: the armor set with the most, then accessories and potions by what each adds. */
function additiveLoadout(id: Additive, u: Units, slots: number, cls: ReferenceInput['cls']): ReferenceLoadout {
  const of = (sources: readonly BuildSource[]) => sources.reduce((acc, s) => acc + sourceFigures(s, cls)[id], 0)
  let armor: ArmorUnit | undefined
  let armorValue = EPS
  for (const a of u.armor) {
    const v = of(a.sources)
    if (v > armorValue + EPS) {
      armor = a
      armorValue = v
    }
  }
  const accValue = new Map(u.accessories.map((a) => [a, of([a.source])]))
  const potValue = new Map(u.potions.map((p) => [p, of([p.source])]))
  const accessories = greedy(u.accessories, slots, () => (c) => accValue.get(c) as number, fits)
  const potions = greedy(u.potions, BUFF_SLOTS, () => (p) => potValue.get(p) as number, potionFits)
  return { ...(armor ? { armor } : {}), accessories, potions }
}

const ZERO_TERMS: OffenseTerms = { pct: 0, flat: 0, speed: 0, crit: 0 }
const add = (a: OffenseTerms, b: OffenseTerms): OffenseTerms => ({ pct: a.pct + b.pct, flat: a.flat + b.flat, speed: a.speed + b.speed, crit: a.crit + b.crit })
const sumTerms = (list: readonly OffenseTerms[]) => list.reduce(add, ZERO_TERMS)

/** The damage reference: every weapon tried with gear chosen for it (see the module doc). */
function damageLoadout(pools: ReferencePools, u: Units, slots: number): ReferenceLoadout | undefined {
  // gear terms per damage class (a weapon's bonuses are the ones for its own class)
  const termsBy = new Map<DamageClass, { armor: OffenseTerms[]; acc: OffenseTerms[]; pot: OffenseTerms[]; bound: OffenseTerms }>()
  const termsFor = (wc: DamageClass) => {
    let t = termsBy.get(wc)
    if (!t) {
      const armor = u.armor.map((a) => sumTerms(a.sources.map((s) => offenseTerms(s.effects, wc))))
      const acc = u.accessories.map((a) => offenseTerms(a.source.effects, wc))
      const pot = u.potions.map((p) => offenseTerms(p.source.effects, wc))
      // an upper bound on each term on its own: the most any armor set, `slots` accessories and 3 potions could add
      const top = (list: readonly OffenseTerms[], k: keyof OffenseTerms, n: number) =>
        list
          .map((x) => Math.max(0, x[k]))
          .sort((a, b) => b - a)
          .slice(0, n)
          .reduce((a, b) => a + b, 0)
      const bound = Object.fromEntries((['pct', 'flat', 'speed', 'crit'] as const).map((k) => [k, top(armor, k, 1) + top(acc, k, slots) + top(pot, k, BUFF_SLOTS)])) as unknown as OffenseTerms
      t = { armor, acc, pot, bound }
      termsBy.set(wc, t)
    }
    return t
  }
  const tried = pools.weapons
    .flatMap((w) => {
      const profile = weaponProfile(w.weapon)
      return profile.ok ? [{ ...w, profile, base: damagePotential(profile, w.ammo?.damage ?? 0) }] : []
    })
    .sort((a, b) => b.base - a.base || a.weapon.id - b.weapon.id)
  let found: { value: number; loadout: ReferenceLoadout } | undefined
  for (const w of tried) {
    const t = termsFor(w.profile.damageClass)
    const value = (terms: OffenseTerms) => edoValue(w.profile, w.ammo?.damage ?? 0, terms)
    if (found && value(t.bound) <= found.value + EPS) continue
    const picked = optimiseGear(w.profile, w.ammo?.damage ?? 0, t, u, slots)
    if (!found || picked.value > found.value + EPS) found = { value: picked.value, loadout: { weapon: { weapon: w.weapon, ...(w.ammo ? { ammo: w.ammo } : {}) }, ...picked.loadout } }
  }
  return found?.loadout
}

/** Coordinate ascent over armor, accessories (slot by slot) and potions for one weapon; two rounds. */
function optimiseGear(profile: WeaponProfile, ammoDamage: number, t: { armor: OffenseTerms[]; acc: OffenseTerms[]; pot: OffenseTerms[] }, u: Units, slots: number): { value: number; loadout: Omit<ReferenceLoadout, 'weapon'> } {
  const value = (terms: OffenseTerms) => edoValue(profile, ammoDamage, terms)
  const accIdx = new Map(u.accessories.map((a, i) => [a, i]))
  const potIdx = new Map(u.potions.map((p, i) => [p, i]))
  let armor = -1
  let accessories: AccessoryUnit[] = []
  let potions: PotionUnit[] = []
  const termsOf = (a: number, acc: readonly AccessoryUnit[], pot: readonly PotionUnit[]) =>
    sumTerms([a >= 0 ? t.armor[a] : ZERO_TERMS, ...acc.map((x) => t.acc[accIdx.get(x) as number]), ...pot.map((x) => t.pot[potIdx.get(x) as number])])
  const pickArmor = () => {
    const rest = termsOf(-1, accessories, potions)
    let top = -1
    let topValue = value(rest)
    t.armor.forEach((a, i) => {
      const v = value(add(rest, a))
      if (v > topValue + EPS) {
        top = i
        topValue = v
      }
    })
    armor = top
  }
  for (let round = 0; round < 2; round++) {
    pickArmor()
    const armorTerms = termsOf(armor, [], potions)
    accessories = greedy(
      u.accessories,
      slots,
      (chosen) => {
        const base = add(armorTerms, termsOf(-1, chosen, []))
        const v0 = value(base)
        return (c) => value(add(base, t.acc[accIdx.get(c) as number])) - v0
      },
      fits,
    )
    const gearTerms = termsOf(armor, accessories, [])
    potions = greedy(
      u.potions,
      BUFF_SLOTS,
      (chosen) => {
        const base = add(gearTerms, termsOf(-1, [], chosen))
        const v0 = value(base)
        return (p) => value(add(base, t.pot[potIdx.get(p) as number])) - v0
      },
      potionFits,
    )
  }
  pickArmor()
  return { value: value(termsOf(armor, accessories, potions)), loadout: { ...(armor >= 0 ? { armor: u.armor[armor] } : {}), accessories, potions } }
}

/** The names of a reference loadout's gear, for its AssumptionsTip. */
function gearParts(l: ReferenceLoadout): string[] {
  const parts: string[] = []
  if (l.weapon) parts.push(referenceAssumption.weapon(l.weapon.weapon.name, l.weapon.ammo?.name))
  if (l.armor) parts.push(referenceAssumption.armor(l.armor.name))
  if (l.accessories.length > 0) parts.push(referenceAssumption.accessories(l.accessories.map((a) => a.accessory.name)))
  if (l.potions.length > 0) parts.push(referenceAssumption.potions(l.potions.map((p) => p.item.name)))
  return parts
}

/**
 * profileReferences (PRD P4-S3 AC2; AMENDMENTS-016 B113a): per referenced figure, the highest value found
 * among gear verified obtainable for `input` — scored by scoreBuild on the loadout that reaches it.
 */
export function profileReferences(input: ReferenceInput, data: BuilderData, options: RecommendOptions = {}): Record<ReferencedComponent, ProfileReference> {
  const pools = referencePools(input, data)
  const u = units(pools, input.cls)
  const stageWord = options.stageName ?? input.stage
  const loadouts: Record<ReferencedComponent, ReferenceLoadout | undefined> = {
    estDamage: damageLoadout(pools, u, pools.accessorySlots),
    defense: additiveLoadout('defense', u, pools.accessorySlots, input.cls),
    mobility: additiveLoadout('mobility', u, pools.accessorySlots, input.cls),
    survivability: additiveLoadout('survivability', u, pools.accessorySlots, input.cls),
  }
  const out = {} as Record<ReferencedComponent, ProfileReference>
  for (const id of REFERENCED_COMPONENTS) {
    const l = loadouts[id]
    const empty: ProfileReference = { text: '', unit: '', assumptions: [], gear: [] }
    if (!l) {
      out[id] = empty
      continue
    }
    const profile = scoreBuild({
      cls: input.cls,
      goal: 'balanced',
      ...(l.weapon ? { main: l.weapon.weapon, ...(l.weapon.ammo ? { ammo: l.weapon.ammo } : {}) } : {}),
      pieces: l.armor?.pieces ?? [],
      ...(l.armor ? { set: { set: l.armor.set, variant: l.armor.variant } } : {}),
      accessories: l.accessories.map((a) => a.accessory),
      potions: l.potions.map((p) => ({ item: p.item, effects: p.effects })),
    })
    const c = profile.components.find((x) => x.id === id)
    if (c?.value === undefined) {
      out[id] = { ...empty, unit: c?.unit ?? '' }
      continue
    }
    const parts = gearParts(l)
    const tip = c.estimate ? (profile.estimates[c.estimate] ?? []) : []
    const formula = tip.find((a) => a.id === 'profile-formula' || a.id === 'edo-formula')
    out[id] = {
      value: c.value,
      text: c.text,
      unit: c.unit,
      ...(c.estimate ? { estimate: c.estimate } : {}),
      assumptions: [
        referenceAssumption.found(stageWord, id === 'estDamage'),
        ...(parts.length > 0 ? [referenceAssumption.gear(parts)] : []),
        ...(formula ? [referenceAssumption.formula(formula.detail.replace(/\.$/, ''))] : []),
        profileAssumption.weights(SCORING_CONSTANTS_VERSION),
      ],
      gear: parts,
    }
  }
  return out
}
