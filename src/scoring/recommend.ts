/**
 * Loadout recommendation (SCORING_SPEC §3, §4, §4.6, §4.7; PRD P4-S2; AMENDMENTS-014 B68–B71;
 * AMENDMENTS-015 B94/B97a; AMENDMENTS-016 B101). Pure TypeScript: inputs {stage, class, difficulty,
 * goal, target boss?, owned[], tracked progress, pins} → a slot-by-slot loadout where EVERY pick
 * carries its score breakdown, rationale and pool disclosure.
 *
 * Binding rules encoded here:
 * - Availability = tracked ∪ virtual defeats (§2.4 scope split, B69/Q9): the selected stage is a
 *   hypothesis and contributes VirtualDefeats — unlike Feature A. The world-evil bosses are never
 *   virtual. With a target (current/next) boss, that boss and every fight it opens are kept OUT of
 *   the virtual defeats (they're what the user is preparing for), so their gear lands in the gated
 *   track; tracked marks always count (user ground truth).
 * - Candidate pools (§3): status "yes" only; "unknown" excluded and counted — except items the user
 *   marked owned (unknown → eligible, B69/Q2); "gated" never suggested (owned or not), kept for the
 *   gated track (§4.7); stats Unknown → excluded and counted, never defaulted (§1.3). With a world
 *   evil chosen, items behind the other world's evil boss are out of the modeled world (B97a).
 * - Ranking: main weapon by DPP (§2.2; ammo weapons with the highest-damage obtainable ammo of their
 *   type, else "scored without ammo"); alt = next with a different tags[0] (hybrid: different class);
 *   armor by the goal-weighted ArmorScore over (set, class-eligible variant) — B52 classes[]; accessories
 *   by CATEGORY_TEMPLATE quota with the qualification rule and constraints (no duplicates, ≤ 1 wings,
 *   no direct combinedFrom / upgradesTo pairs); ammo by damage; buffs by summed class points (≤ 3, no
 *   repeated buff); summon slot by base damage (not DPP). Ties follow the §4.6 total order and are
 *   shown as alternatives. Nothing is ever called "best" — a pick is the highest-scoring under the
 *   stated weights.
 * - Pins (swap-a-pick, loaded builds, deep links) replace a slot's recommendation; the rest is
 *   recommended around them. A pinned item is the user's choice: its availability is shown as it is
 *   (gated / Unknown), never upgraded.
 * - The Demon Heart slot (Expert / Master) exists only once the Wall of Flesh is in EP; then it is
 *   filled with the assumption chip (B69/Q3).
 * - Surprise Me (§4.8, P4-S4 AC3): with a `seed`, every slot the user didn't fix is drawn uniformly
 *   (seeded mulberry32) from its FULL legal pool — the same eligible candidates the recommendation
 *   ranks, under every constraint (class, availability, slot count, Demon Heart, no duplicates, ≤ 1
 *   wings, no direct upgrade pairs, no repeated buff, ammo the weapon fires). Randomness never relaxes
 *   legality; each drawn pick says it was drawn, not ranked.
 * - Deterministic: same inputs (and seed) ⇒ same output; every ordering ends in a total order.
 */
import type { Accessory, ArmorPiece, ArmorSet, Boss, DamageClass, Difficulty, Goal, Item, LoadoutClass, LoadoutSlots, Rarity, Stage, StatEffect, Weapon } from '../schemas'
import { getField } from '../schemas/getField'
import { availabilityOf, compareRankable, gateCount, rarityRank, targetCapNodes, type Availability } from './candidates'
import {
  BUFF_SLOTS,
  categoryTemplate,
  DEMON_HEART_GATE_NODE,
  DEMON_HEART_SLOT_INDEX,
  DEMON_HEART_SOURCE,
  DPP_ASSUMPTIONS,
  GATED_PER_SLOT,
  GOAL_COMPONENTS,
  GOAL_WEIGHTS,
  MAX_ACCESSORY_SLOTS,
  SCORING_CONSTANTS_VERSION,
  SLOT_COUNT,
  SPECIAL_SCOPE_VERSION,
  WORLD_EVIL_CONDITION,
  type AccessoryQuota,
} from './constants'
import * as copy from './builderCopy'
import { scoreBuild, type BuildProfile } from './goals'
import { countsInWorld, isNodeSatisfied, trackedDefeats, virtualDefeats, type TrackedProgress } from './progress'
import { applicablePoints, appliesTo, critFactor, damagePotential, effectPoints, isSummonStaff, specialFits, statTotal, sumPoints, weaponProfile, type Points, type WeaponProfile } from './proxies'
import type { ReadinessData } from './readiness'
import { DIFFICULTY_WORD, effectPhrase, oneDecimal, whole, type AssumptionText, type Segment } from './readinessCopy'

// --- public shapes -------------------------------------------------------------------------------------

export const ACCESSORY_SLOT_IDS = ['acc0', 'acc1', 'acc2', 'acc3', 'acc4', 'acc5', 'acc6'] as const
export const AMMO_SLOT_IDS = ['ammo0', 'ammo1'] as const
export const BUFF_SLOT_IDS = ['buff0', 'buff1', 'buff2'] as const
export const SLOT_IDS = ['main', 'alt', 'armor', ...ACCESSORY_SLOT_IDS, ...AMMO_SLOT_IDS, ...BUFF_SLOT_IDS, 'summon'] as const
export type SlotId = (typeof SLOT_IDS)[number]
export type SlotGroup = 'weapons' | 'armor' | 'accessories' | 'ammo' | 'buffs' | 'summon'

/** Alternatives listed under a pick (the next-ranked candidates, ties marked). */
export const ALTERNATIVES_SHOWN = 3

/** A user's choice for a slot: an item, a deliberately empty slot (null = deliberate, DATA_SCHEMA_SPEC §8a), or armor pieces. */
export type Pin = { kind: 'item'; id: number } | { kind: 'empty' } | { kind: 'armor'; helmet: number | null; chest: number | null; legs: number | null }
export type Pins = Readonly<Partial<Record<SlotId, Pin>>>

export interface BuilderInput {
  stage: Stage
  cls: LoadoutClass
  difficulty: Difficulty
  goal: Goal
  /** The boss being prepared for (current / next); null = none. */
  bossId: string | null
  /** Items the user owns (B69/Q2: unknown availability → eligible). */
  owned: readonly number[]
  /** tc.v1.progress: tracked defeats + world evil. */
  progress: TrackedProgress
  pins?: Pins
  /** Surprise Me (SCORING_SPEC §4.8): unpinned slots are drawn at random from their legal pools with this seed. */
  seed?: number
}

export type BuilderData = ReadinessData

export interface ScoreTerm {
  label: string
  value: string
  /** GOAL_WEIGHTS entry applied (armor score). */
  weight?: number
  contribution?: string
}

/** One effect named in a breakdown: what it adds, or why it doesn't. */
export interface EffectLine {
  text: string
  /** Where it comes from (a set's piece or its bonus). */
  from?: string
  /** "15 offense" — its counted points. */
  points?: string
  /** 'special-mismatch': an unscored effect whose wiki text ties it to another class (B108(a) keyword registry). */
  status: 'counted' | 'mismatch' | 'uncounted-kind' | 'special' | 'special-mismatch'
  sourceUrl?: string
}

/** A pick's score, decomposed (SCORING_SPEC §1.1): the number, what it is, its formula and its parts. */
export interface PickScore {
  kind: 'dpp' | 'armor' | 'accessory' | 'buff' | 'damage' | 'ammo'
  value: number
  text: string
  label: string
  formulaText: string
  terms: ScoreTerm[]
  effects: EffectLine[]
  /** The EstimateLabel key ("est.") and its AssumptionsTip. */
  estimate?: 'dpp'
  assumptions?: AssumptionText[]
  /** AMENDMENTS-016 B101a: the in-cell qualifier line (no auto-reuse, used up, explosive). */
  qualifier?: string
  /** An ammo weapon scored without ammo (§2.2 disclosure). */
  noAmmo?: boolean
}

export interface ItemRef {
  key: string
  /** The item to open (a set: its helmet). */
  id: number
  name: string
  setId?: string
  /** A set's helmet, chest and legs. */
  pieces?: readonly [number, number, number]
}

export interface PickView extends ItemRef {
  /** undefined: a pinned item whose stats can't be scored (`scoreMissing` names why). */
  score?: PickScore
  scoreMissing?: string[]
  rationale: Segment[]
  /** 'random': drawn by Surprise Me (§4.8) from the slot's legal pool, not ranked. */
  source: 'recommended' | 'pinned' | 'random'
  availability: Availability
  /** Gear the user marked owned whose availability is Unknown (recommended because owned, B69/Q2; or a pin, B108 M3). */
  ownedUnknown: boolean
  /** B108(a): an accessory / potion pick adding 0 counted points — the card names it "not scored". */
  zeroPoints?: true
}

export interface AltView extends ItemRef {
  score: PickScore
  /** Same score as the pick: the §4.6 tie-break decided. */
  tied: boolean
  /** Scores above the pick (only ever under a pinned pick, B108 H2). */
  higher: boolean
  availability: Availability
  ownedUnknown: boolean
}

export interface PoolCounts extends copy.DisclosureCounts {
  considered: number
}

/** B108(a) Step 3: a pick adding 0 counted points, with its unscored effects (verbatim wiki text). */
export interface ZeroPointPick extends ItemRef {
  slot: SlotId
  specials: string[]
}

export interface SlotResult {
  id: SlotId
  group: SlotGroup
  state: 'pick' | 'empty' | 'locked'
  pick?: PickView
  /** Why the slot is empty / locked. */
  empty?: Segment[]
  alternatives: AltView[]
  pool?: PoolCounts
  disclosure?: Segment[]
  /** Accessory quota category (§4.4). */
  quota?: AccessoryQuota
  /** Filled from any category because the quota had no qualifying candidate (disclosed). */
  fallback?: boolean
  /** The Expert / Master Demon Heart slot. */
  demonHeart?: boolean
  /** Ammo slots: the ammo type and which weapon fires it. */
  ammoClass?: string
  ammoFor?: 'main' | 'alt'
  /** Surprise Me drew this slot's pick (an accessory drawn from every category is scored on all its points). */
  random?: true
}

export interface GatedEntry extends ItemRef {
  slot: 'main' | 'armor' | 'summon' | AccessoryQuota
  score: PickScore
  availability: Availability
  /** The slot's obtainable-now pick ("Obtainable now: {item}"); absent → "No verified obtainable alternative". */
  alternative?: ItemRef
}

export interface GatedGroup {
  /** Bosses still to defeat (sorted): the GatedSection's "After you defeat …". */
  missing: string[]
  entries: GatedEntry[]
}

export interface BuilderResult {
  constantsVersion: number
  input: Omit<BuilderInput, 'progress' | 'pins' | 'owned'>
  progress: {
    /** Bosses marked defeated that count in this world. */
    tracked: string[]
    /** Implied by the stage (tracked ones not repeated). */
    virtual: string[]
    /** Kept out of the virtual defeats by the target boss. */
    capped: string[]
  }
  slots: SlotResult[]
  loadout: LoadoutSlots
  gated: GatedGroup[]
  profile: BuildProfile
  assumptions: AssumptionText[]
  /** Pins that couldn't be applied (said, never dropped silently). */
  notices: Segment[][]
  /** Every pick adding 0 counted points (B108(a): Step 3 names each). */
  zeroPoint: ZeroPointPick[]
  /** Surprise Me's seed when the draft was drawn at random (§7 RecommendationResult.seed). */
  seed?: number
}

// --- context -------------------------------------------------------------------------------------------

type Admission =
  | { kind: 'eligible'; availability: Availability; ownedUnknown: boolean }
  | { kind: 'gated'; availability: Availability }
  | { kind: 'unknown' }
  | { kind: 'other-world' }
  | { kind: 'other-world-condition' }

interface Ctx {
  input: BuilderInput
  data: BuilderData
  cls: LoadoutClass
  ep: ReadonlySet<string>
  memo: Map<string, boolean>
  owned: ReadonlySet<number>
  notices: Segment[][]
  /** The other world type's condition slug (B108(b)); undefined under "Both". */
  otherCondition?: string
}

const isKnown = (status: string) => status === 'verified' || status === 'editorial'
function known<T>(record: unknown, path: string): T | undefined {
  const view = getField(record, path)
  return isKnown(view.status) ? (view.value as T) : undefined
}
const unverified = (record: unknown, path: string) => getField(record, path).status === 'unverified'
const fmt2 = (n: number) => String(Number(n.toFixed(2)))
const itemKey = (id: number) => `i:${id}`

/** Seeds Surprise Me accepts (unsigned 32-bit, mulberry32's state). */
export const SEED_MAX = 0xffffffff
export const isSeed = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= SEED_MAX

/** SCORING_SPEC §4.8: the seeded mulberry32 generator — uniform floats in [0, 1), deterministic per seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A node the chosen world evil leaves out (the other world's evil boss, B97a); none under "Both". */
function isOtherWorld(ctx: Ctx, nodeId: string): boolean {
  const worldEvil = ctx.input.progress.worldEvil
  if (worldEvil === null) return false
  const node = ctx.data.graph.nodes.find((n) => n.id === nodeId)
  return node !== undefined && !countsInWorld(node, worldEvil)
}

/** §3.1 availability over one record or a set's pieces. */
function admit(ctx: Ctx, records: readonly { id: number; gatedBy?: Item['gatedBy'] }[]): Admission {
  const all = records.map((r) => ({ r, a: availabilityOf(r, ctx.data.graph, ctx.ep, ctx.memo) }))
  let ownedUnknown = false
  for (const { r, a } of all) {
    if (a.status !== 'unknown') continue
    if (!ctx.owned.has(r.id)) return { kind: 'unknown' }
    ownedUnknown = true
  }
  const missing = [...new Set(all.flatMap(({ a }) => a.missing))].sort()
  const conditions = [...new Set(all.flatMap(({ a }) => a.conditions))]
  if (missing.some((id) => isOtherWorld(ctx, id))) return { kind: 'other-world' }
  if (ctx.otherCondition !== undefined && conditions.includes(ctx.otherCondition)) return { kind: 'other-world-condition' }
  if (missing.length > 0) return { kind: 'gated', availability: { status: 'gated', missing, conditions } }
  return { kind: 'eligible', availability: { status: ownedUnknown ? 'unknown' : 'yes', missing: [], conditions }, ownedUnknown }
}

/**
 * A pinned item's availability as it is (never upgraded), and whether it is owned gear with Unknown
 * availability (B108 M3: a reopened build keeps its "you own this" chips).
 */
function pinnedAvailability(ctx: Ctx, records: readonly { id: number; gatedBy?: Item['gatedBy'] }[]): { availability: Availability; ownedUnknown: boolean } {
  const all = records.map((r) => ({ r, a: availabilityOf(r, ctx.data.graph, ctx.ep, ctx.memo) }))
  const unknown = all.filter(({ a }) => a.status === 'unknown')
  const status = unknown.length > 0 ? 'unknown' : all.some(({ a }) => a.status === 'gated') ? 'gated' : 'yes'
  return {
    availability: { status, missing: [...new Set(all.flatMap(({ a }) => a.missing))].sort(), conditions: [...new Set(all.flatMap(({ a }) => a.conditions))] },
    ownedUnknown: status === 'unknown' && unknown.every(({ r }) => ctx.owned.has(r.id)),
  }
}

// --- candidates -----------------------------------------------------------------------------------------

interface Cand extends ItemRef {
  score: PickScore
  availability: Availability
  ownedUnknown: boolean
  gateCount: number
  rarity: Rarity | undefined
  /** Tie-break key (§4.6): item id, or the set key. */
  order: number | string
  // weapons
  weapon?: Weapon
  tag0?: string
  damageClass?: DamageClass
  // accessories
  accessory?: Accessory
  points?: Points
  total?: number
  hasSpecial?: boolean
  firstSpecial?: string
  wings?: boolean
  links?: readonly number[]
  quotas?: readonly AccessoryQuota[]
  // buffs
  buffIds?: readonly string[]
  potion?: Item
  potionEffects?: readonly StatEffect[]
  // armor
  set?: ArmorSet
  variant?: ArmorSet['variants'][number]
  armorPieces?: readonly ArmorPiece[]
  // ammo
  ammoClass?: string
  ammoDamage?: number
}

interface Pool {
  eligible: Cand[]
  gated: Cand[]
  counts: PoolCounts
}

const emptyCounts = (): PoolCounts => ({ considered: 0, eligible: 0, owned: 0, unknown: 0, gated: 0, unverified: 0, unqualified: 0, otherWorld: 0, otherWorldCondition: 0 })

/**
 * Admits and scores candidates into a pool. Counting precedence: Unknown availability → other world →
 * the other world type's condition → gated → stats Unknown → no counted benefit. Gated candidates are
 * still scored (for the gated track). Eligible owned gear with Unknown availability is counted apart
 * from the verified obtainable (B108 H3).
 */
function collect<T extends { id: number; gatedBy?: Item['gatedBy'] }>(
  ctx: Ctx,
  items: Iterable<T>,
  records: (item: T) => readonly { id: number; gatedBy?: Item['gatedBy'] }[],
  score: (item: T, admission: Extract<Admission, { kind: 'eligible' | 'gated' }>) => Cand | 'unverified' | 'unqualified',
): Pool {
  const pool: Pool = { eligible: [], gated: [], counts: emptyCounts() }
  for (const item of items) {
    pool.counts.considered++
    const admission = admit(ctx, records(item))
    if (admission.kind === 'unknown') {
      pool.counts.unknown++
      continue
    }
    if (admission.kind === 'other-world') {
      pool.counts.otherWorld++
      continue
    }
    if (admission.kind === 'other-world-condition') {
      pool.counts.otherWorldCondition++
      continue
    }
    const cand = score(item, admission)
    if (admission.kind === 'gated') {
      pool.counts.gated++
      if (typeof cand !== 'string') pool.gated.push(cand)
      continue
    }
    if (cand === 'unverified') pool.counts.unverified++
    else if (cand === 'unqualified') pool.counts.unqualified++
    else {
      if (cand.ownedUnknown) pool.counts.owned++
      else pool.counts.eligible++
      pool.eligible.push(cand)
    }
  }
  return pool
}

const rankable = (c: Cand) => ({ score: c.score.value, gateCount: c.gateCount, rarity: c.rarity, key: c.order })
const byRank = (a: Cand, b: Cand) => compareRankable(rankable(a), rankable(b))

// --- weapons: DPP (§2.2) --------------------------------------------------------------------------------

/** AMENDMENTS-016 B101a/B102 caveats, each from ONE verified field (mirrors compareModel.dppCaveats; pinned equal by the UI tests). */
export function weaponCaveats(w: Weapon): { noAutoReuse: boolean; consumed: boolean; explosive: boolean } {
  return { noAutoReuse: known(w, 'autoReuse') === false, consumed: typeof known(w, 'maxStack') === 'number', explosive: w.tags.includes('explosives') }
}

/** The wiki rule behind "classless damage never crits" (AMENDMENTS-015 B85(b)). */
export const CRIT_RULE_SOURCE = 'https://terraria.wiki.gg/wiki/Critical_hit'

/** §2.2 DPP score with its decomposition and AssumptionsTip. `ammo` = the ammo it fires here (verified damage). */
export function dppScore(w: Weapon, profile: WeaponProfile, ammo: { name: string; damage: number } | undefined): PickScore {
  const ammoDamage = ammo?.damage ?? 0
  const value = damagePotential(profile, ammoDamage)
  const crit = critFactor(profile)
  const hps = fmt2(profile.hitsPerSec)
  const perHit = ammo ? `(${copy.formula.perHitWithAmmo(profile.damage, ammo.damage)})` : String(profile.damage)
  const formulaText = copy.formula.dpp(perHit, hps, fmt2(crit), oneDecimal(value))
  const caveats = weaponCaveats(w)
  const useAnimation = known<number>(w, 'useAnimationTicks') ?? profile.cadenceTicks
  const delay = known<number>(w, 'reuseDelayTicks') ?? 0
  const autoswing = profile.damageClass === 'melee' && known(w, 'autoReuse') === true
  const qualifierParts = [
    ...(caveats.noAutoReuse ? [caveats.consumed ? copy.QUALIFIER_CLICK_THROW : copy.QUALIFIER_CLICK_ATTACK] : []),
    ...(caveats.consumed ? [copy.qualifierUsage(hps)] : []),
    ...(caveats.explosive ? [copy.QUALIFIER_EXPLOSIVE] : []),
  ]
  const assumptions: AssumptionText[] = [
    copy.builderAssumption.dppBase(DPP_ASSUMPTIONS),
    copy.builderAssumption.dppFormula(formulaText),
    copy.builderAssumption.dppRate(copy.builderAssumption.cadence(useAnimation, autoswing, delay), profile.cadenceTicks, profile.activationsPerUse, hps),
    ...(caveats.noAutoReuse ? [copy.builderAssumption.clicks(profile.cadenceTicks)] : []),
    ...(caveats.consumed ? [copy.builderAssumption.usage(hps)] : []),
    ...(caveats.explosive ? [copy.builderAssumption.explosive()] : []),
    profile.critApplies
      ? copy.builderAssumption.dppCrit(4 + profile.critPct)
      : copy.builderAssumption.dppCritNone(profile.damageClass === 'summon', profile.damageClass === 'summon' ? undefined : CRIT_RULE_SOURCE),
    ...(profile.ammoClass ? [ammo ? copy.builderAssumption.ammoWith(ammo.name, ammo.damage) : copy.builderAssumption.ammoWithout()] : []),
    copy.builderAssumption.proxy(),
  ]
  return {
    kind: 'dpp',
    value,
    text: oneDecimal(value),
    label: copy.scoreLabel.dpp,
    formulaText,
    terms: [
      { label: copy.term.damagePerHit, value: ammo ? `${profile.damage} + ${ammo.damage}` : String(profile.damage) },
      { label: copy.term.hitsPerSecond, value: hps },
      { label: copy.term.critFactor, value: `× ${fmt2(crit)}` },
    ],
    effects: [],
    estimate: 'dpp',
    assumptions,
    ...(qualifierParts.length > 0 ? { qualifier: copy.dppQualifier(qualifierParts) } : {}),
    ...(profile.ammoClass && !ammo ? { noAmmo: true } : {}),
  }
}

/** Class eligibility for the main / alt pool (§3.2): undefined = damage class Unknown. */
function mainPoolEligible(w: Weapon, cls: LoadoutClass): boolean | undefined {
  if (isSummonStaff(w) || w.tags.includes('unobtainable')) return false
  const wc = known<DamageClass>(w, 'damageClass')
  if (wc === undefined) return undefined
  if (cls === 'hybrid') return true
  if (cls === 'summon') return w.tags.includes('whips')
  return wc === cls
}

/** The ammo pool of one ammo type (§4.5): items and dual-role weapons whose ammoStats name it. */
function ammoPool(ctx: Ctx, ammoClass: string): Pool {
  const holders = [...ctx.data.items.values(), ...ctx.data.weapons.values()].filter((r) => (r as Item).ammoStats?.ammoClass === ammoClass)
  const pool = collect(
    ctx,
    holders,
    (r) => [r],
    (r, admission) => {
      if (unverified(r, 'ammoStats.damage')) return 'unverified'
      const damage = known<number>(r, 'ammoStats.damage')
      if (damage === undefined) return 'unverified'
      return {
        key: itemKey(r.id),
        id: r.id,
        name: r.name,
        score: { kind: 'ammo', value: damage, text: String(damage), label: copy.scoreLabel.ammoDamage, formulaText: copy.formula.damage(damage), terms: [], effects: [] },
        availability: admission.availability,
        ownedUnknown: admission.kind === 'eligible' && admission.ownedUnknown,
        gateCount: gateCount(r),
        rarity: r.rarity,
        order: r.id,
        ammoClass,
        ammoDamage: damage,
      }
    },
  )
  // §4.5: damage desc, then id
  const order = (a: Cand, b: Cand) => b.score.value - a.score.value || (a.order as number) - (b.order as number)
  pool.eligible.sort(order)
  pool.gated.sort(order)
  return pool
}

// --- accessories (§4.4) ---------------------------------------------------------------------------------

const QUOTA_OF: Readonly<Record<Accessory['categories'][number], AccessoryQuota>> = { offense: 'off', defense: 'def', mobility: 'mob', utility: 'util' }

/** Component points of an accessory for `cls`, flight read as max(wingStats, flight effects) (§2.3, disclosed). */
function accessoryPoints(acc: Accessory, effects: readonly StatEffect[], cls: LoadoutClass): { points: Points; flightTicks: number } {
  const wing = known<number>(acc, 'wingStats.flightTimeTicks') ?? 0
  const points = applicablePoints(
    effects.filter((e) => !(e.kind === 'stat' && e.stat === 'flight-time-ticks')),
    cls,
  )
  const flightTicks = Math.max(wing, statTotal(effects, 'flight-time-ticks', cls))
  return { points: { ...points, mob: points.mob + 0.1 * flightTicks }, flightTicks }
}

/**
 * componentPts of a quota (§4.4): offense → Off; defense → Def + Surv (the data's "defense" accessories
 * include regeneration and max-life items, which only score Surv); mobility → Mob; utility → all points.
 */
export const quotaValue = (points: Points, quota: AccessoryQuota): number =>
  quota === 'util' ? sumPoints(points) : quota === 'def' ? points.def + points.surv : points[quota]

/** Effect lines of a breakdown: each effect's counted points, or why it doesn't count. */
function effectLines(effects: readonly StatEffect[], cls: LoadoutClass, from?: string, skipFlight = false): EffectLine[] {
  const out: EffectLine[] = []
  for (const e of effects) {
    if (e.kind === 'special') {
      out.push({ text: e.text, status: specialFits(e.text, cls) ? 'special' : 'special-mismatch', sourceUrl: e.sourceUrl, ...(from ? { from } : {}) })
      continue
    }
    if (skipFlight && e.stat === 'flight-time-ticks') continue
    const pts = effectPoints(e, cls)
    const total = sumPoints(pts)
    const phrase = effectPhrase(e)
    if (!appliesTo(e, cls)) out.push({ text: phrase, status: 'mismatch', ...(from ? { from } : {}) })
    else if (total === 0) out.push({ text: phrase, status: 'uncounted-kind', ...(from ? { from } : {}) })
    else out.push({ text: phrase, status: 'counted', points: pointsText(pts), ...(from ? { from } : {}) })
  }
  return out
}

/** "15 offense", "8 defense + 8 survivability". */
function pointsText(p: Points): string {
  const parts = (['off', 'def', 'mob', 'surv'] as const).filter((k) => p[k] !== 0).map((k) => `${fmt2(p[k])} ${copy.POINTS_WORD[k]}`)
  return parts.join(' + ')
}

function accessoryScore(cand: Cand, quota: AccessoryQuota | 'any', cls: LoadoutClass): PickScore {
  const acc = cand.accessory as Accessory
  const effects = known<StatEffect[]>(acc, 'effects') ?? []
  const points = cand.points as Points
  const value = quota === 'any' ? sumPoints(points) : quotaValue(points, quota)
  const lines = effectLines(effects, cls, undefined, true)
  const wing = known<number>(acc, 'wingStats.flightTimeTicks')
  const flightEffect = statTotal(effects, 'flight-time-ticks', cls)
  const flightTicks = Math.max(wing ?? 0, flightEffect)
  if (flightTicks > 0) lines.push({ text: copy.term.flight(oneDecimal(flightTicks / 60)), status: 'counted', points: `${fmt2(0.1 * flightTicks)} mobility` })
  const word = quota === 'any' || quota === 'util' ? 'points' : quota === 'def' ? 'defense and survivability points' : `${copy.QUOTA_WORD[quota]} points`
  const keys: readonly (keyof Points)[] = quota === 'any' || quota === 'util' ? ['off', 'def', 'mob', 'surv'] : quota === 'def' ? ['def', 'surv'] : [quota]
  const parts = keys.filter((k) => points[k] !== 0).map((k) => `${fmt2(points[k])} ${copy.POINTS_WORD[k]}`)
  return {
    kind: 'accessory',
    value,
    text: fmt2(value),
    label: quota === 'any' ? copy.scoreLabel.accessoryAny : copy.scoreLabel.accessory(quota),
    formulaText: copy.formula.sum(parts, fmt2(value), word),
    terms: (['off', 'def', 'mob', 'surv'] as const).map((k) => ({ label: copy.POINTS_WORD[k], value: fmt2(points[k]) })),
    effects: lines,
  }
}

// --- armor (§4.3) -----------------------------------------------------------------------------------------

const variantClasses = (v: ArmorSet['variants'][number]): readonly DamageClass[] => v.classes ?? [v.class]

/** §3.2 + B52: a variant fits class C iff C ∈ classes; ["other"] fits all; hybrid fits every variant. */
export function variantFits(v: ArmorSet['variants'][number], cls: LoadoutClass): boolean {
  const classes = variantClasses(v)
  return cls === 'hybrid' || classes.includes('other') || classes.includes(cls)
}

/** ArmorScore = W_def·(Σdefense + defense points) + W_off·offense + W_mob·mobility + W_surv·survivability (GOAL_WEIGHTS). */
function armorScore(pieces: readonly ArmorPiece[], setBonus: readonly StatEffect[], setName: string | undefined, goal: Goal, cls: LoadoutClass): PickScore | undefined {
  let pieceDefense = 0
  const effects: StatEffect[] = []
  const lines: EffectLine[] = []
  for (const piece of pieces) {
    const d = known<number>(piece, 'defense')
    const e = known<StatEffect[]>(piece, 'effects')
    if (d === undefined || e === undefined) return undefined
    pieceDefense += d
    effects.push(...e)
    lines.push(...effectLines(e, cls, piece.name))
  }
  effects.push(...setBonus)
  if (setName) lines.push(...effectLines(setBonus, cls, setName))
  const points = applicablePoints(effects, cls)
  const [wOff, wDef, wMob, wSurv] = [GOAL_WEIGHTS[goal][GOAL_COMPONENTS.indexOf('estDamage')], GOAL_WEIGHTS[goal][GOAL_COMPONENTS.indexOf('defense')], GOAL_WEIGHTS[goal][GOAL_COMPONENTS.indexOf('mobility')], GOAL_WEIGHTS[goal][GOAL_COMPONENTS.indexOf('survivability')]]
  const defense = pieceDefense + points.def
  const value = wDef * defense + wOff * points.off + wMob * points.mob + wSurv * points.surv
  const t = [
    { weight: wDef, raw: defense, word: 'defense', label: copy.term.defenseTerm },
    { weight: wOff, raw: points.off, word: 'offense', label: copy.term.offense },
    { weight: wMob, raw: points.mob, word: 'mobility', label: copy.term.mobility },
    { weight: wSurv, raw: points.surv, word: 'survivability', label: copy.term.survivability },
  ]
  return {
    kind: 'armor',
    value,
    text: fmt2(value),
    label: copy.scoreLabel.armor(goal),
    formulaText: copy.formula.weighted(
      t.map((x) => ({ weight: x.weight, value: fmt2(x.raw), word: x.word })),
      fmt2(value),
    ),
    terms: [
      { label: copy.term.pieceDefense, value: whole(pieceDefense) },
      ...t.map((x) => ({ label: x.label, value: fmt2(x.raw), weight: x.weight, contribution: fmt2(x.weight * x.raw) })),
    ],
    effects: lines,
  }
}

// --- buffs (§4.5) -------------------------------------------------------------------------------------------

/** Buffs a potion grants only as a side effect (cooldowns): never "buff potions". */
const COOLDOWN_BUFFS: ReadonlySet<string> = new Set(['potion-sickness', 'mana-sickness'])

function potionBuffs(ctx: Ctx, potion: Item): { buffIds: string[]; effects: StatEffect[] } | 'unverified' | undefined {
  if (unverified(potion, 'buffGrants')) return 'unverified'
  const grants = (known<NonNullable<Item['buffGrants']>>(potion, 'buffGrants') ?? []).filter((g) => !COOLDOWN_BUFFS.has(g.buffId))
  if (grants.length === 0) return undefined
  const effects: StatEffect[] = []
  for (const g of grants) {
    const buff = ctx.data.buffs.get(g.buffId)
    const e = buff ? known<StatEffect[]>(buff, 'effects') : undefined
    if (e === undefined) return 'unverified'
    // a debuff's specials are side notes; its stat effects (Tipsy) still apply (the readiness rule)
    effects.push(...e.filter((x) => x.kind === 'stat' || !buff?.isDebuff))
  }
  return { buffIds: grants.map((g) => g.buffId), effects }
}

function buffScore(effects: readonly StatEffect[], cls: LoadoutClass): PickScore {
  const points = applicablePoints(effects, cls)
  const value = sumPoints(points)
  const parts = (['off', 'def', 'mob', 'surv'] as const).filter((k) => points[k] !== 0).map((k) => `${fmt2(points[k])} ${copy.POINTS_WORD[k]}`)
  return {
    kind: 'buff',
    value,
    text: fmt2(value),
    label: copy.scoreLabel.buff,
    formulaText: copy.formula.sum(parts, fmt2(value), 'points'),
    terms: (['off', 'def', 'mob', 'surv'] as const).map((k) => ({ label: copy.POINTS_WORD[k], value: fmt2(points[k]) })),
    effects: effectLines(effects, cls),
  }
}

// --- the builder ----------------------------------------------------------------------------------------------

interface Built {
  ctx: Ctx
  slots: Map<SlotId, SlotResult>
  /** The candidates behind each slot's pick (for profile + options). */
  chosen: Map<SlotId, Cand | PinnedItem>
  pools: {
    main: Pool
    armor: Pool
    accessories: Pool
    buffs: Pool
    summon: Pool
    ammo: Map<string, Pool>
  }
  dhIndex: number | null
  dhOpen: boolean
  slotCount: number
  template: AccessoryQuota[]
  progress: BuilderResult['progress']
  /** Slots whose pick Surprise Me drew (§4.8). */
  random: ReadonlySet<SlotId>
}

/** A pinned item resolved against the dataset (scored when it can be). */
interface PinnedItem extends ItemRef {
  pinned: true
  score?: PickScore
  scoreMissing?: string[]
  availability: Availability
  ownedUnknown: boolean
  record: Weapon | Accessory | Item | undefined
  armorPieces?: readonly ArmorPiece[]
  set?: ArmorSet
  variant?: ArmorSet['variants'][number]
  wings?: boolean
  /** An accessory's class points (§2.3), when its effects are known. */
  points?: Points
  buffIds?: readonly string[]
  potionEffects?: readonly StatEffect[]
  ammoDamage?: number
  ammoClass?: string
}

const isPinned = (c: Cand | PinnedItem | undefined): c is PinnedItem => c !== undefined && 'pinned' in c

/** A pool's size for its rationale: verified obtainable and owned-Unknown kept apart (B108 H3). */
const sizeOf = (c: PoolCounts): copy.PoolSize => ({ verified: c.eligible, owned: c.owned })
const sizeOfList = (list: readonly Cand[]): copy.PoolSize => ({ verified: list.filter((c) => !c.ownedUnknown).length, owned: list.filter((c) => c.ownedUnknown).length })

/** The accessories an accessory is a direct combinedFrom / upgradesTo pair with (never co-equipped). */
const linksOf = (c: Cand | PinnedItem): readonly number[] =>
  isPinned(c) ? [...(known<number[]>(c.record, 'combinedFrom') ?? []), ...(known<number[]>(c.record, 'upgradesTo') ?? [])] : (c.links ?? [])

const SPACE: Segment = { kind: 'text', text: ' ' }

/**
 * A pinned pick's rationale against what the recommendation would put in its slot given the other
 * slots (AMENDMENTS-016 B108 H2 / M3): the same item → "also the recommendation" with the
 * recommendation's own why; a tie → the fixed tie-break would put the other one here; a higher-scoring
 * candidate → "kept over higher-scoring alternatives"; otherwise — it outscores every obtainable
 * candidate (it isn't obtainable at your progress) or there is nothing to compare — "kept in place of
 * the recommendation".
 */
function pinnedWhy(pick: PinnedItem, top: Cand | undefined, recommended: () => Segment[]): Segment[] {
  const score = pick.score
  if (!score || !top) return copy.rationale.pinned()
  if (top.key === pick.key) {
    const why = copy.rationale.pinnedSame(recommended())
    return pick.ownedUnknown ? [...why, SPACE, ...copy.rationale.owned()] : why
  }
  if (sameScore(top.score.value, score.value)) return copy.rationale.pinnedTied({ kind: 'item', id: top.id, text: top.name })
  return top.score.value > score.value ? copy.rationale.pinnedBelow() : copy.rationale.pinned()
}

function makeContext(input: BuilderInput, data: BuilderData): { ctx: Ctx; progress: BuilderResult['progress'] } {
  const graph = data.graph
  const tracked = trackedDefeats(graph, input.progress)
  const boss: Boss | undefined = input.bossId ? data.bosses.get(input.bossId) : undefined
  const cap = boss ? targetCapNodes(graph, boss.nodeId) : new Set<string>()
  const allVirtual = virtualDefeats(graph, input.stage, input.progress.worldEvil)
  const virtual = [...allVirtual].filter((id) => !cap.has(id) && !tracked.has(id)).sort()
  const capped = [...allVirtual].filter((id) => cap.has(id) && !tracked.has(id)).sort()
  const ep = new Set([...tracked, ...virtual])
  const worldEvil = input.progress.worldEvil
  const otherCondition = worldEvil ? WORLD_EVIL_CONDITION[worldEvil === 'corruption' ? 'crimson' : 'corruption'] : undefined
  const ctx: Ctx = { input, data, cls: input.cls, ep, memo: new Map(), owned: new Set(input.owned), notices: [], ...(otherCondition ? { otherCondition } : {}) }
  return { ctx, progress: { tracked: [...tracked].sort(), virtual, capped } }
}

function build(input: BuilderInput, data: BuilderData): Built {
  const { ctx, progress } = makeContext(input, data)
  const { cls, ep, memo } = ctx
  const pins = input.pins ?? {}
  const slots = new Map<SlotId, SlotResult>()
  const chosen = new Map<SlotId, Cand | PinnedItem>()
  const nodeName = (id: string) => data.graph.nodes.find((n) => n.id === id)?.name ?? id
  const otherWorldName = ctx.otherCondition ? (data.conditions.get(ctx.otherCondition)?.name ?? ctx.otherCondition) : undefined
  /** A slot's pool disclosure (SCORING_SPEC §3 "always rendered"). */
  const disc = (c: PoolCounts) => copy.disclosure(c, cls, otherWorldName)
  /**
   * §4.8 Surprise Me: with a seed, a slot's pick is a uniform draw from its legal list (one generator,
   * slots drawn in a fixed order, so the same seed and inputs give the same loadout); without one, the
   * list's first (top-ranked) candidate.
   */
  const rng = input.seed !== undefined ? mulberry32(input.seed) : undefined
  const random = new Set<SlotId>()
  const choose = <T>(slotId: SlotId, list: readonly T[]): T | undefined => {
    if (!rng || list.length === 0) return list[0]
    random.add(slotId)
    return list[Math.floor(rng() * list.length)]
  }
  /** A drawn pick's why: drawn at random from `pool` (never ranked). */
  const drawnWhy = (pool: readonly Segment[]) => copy.rationale.random(pool)

  // --- ammo pools (lazily, per type) and the highest-damage obtainable ammo per type
  const ammoPools = new Map<string, Pool>()
  const ammoPoolOf = (ammoClass: string) => {
    let pool = ammoPools.get(ammoClass)
    if (!pool) {
      pool = ammoPool(ctx, ammoClass)
      ammoPools.set(ammoClass, pool)
    }
    return pool
  }
  const topAmmo = (ammoClass: string | undefined) => {
    if (!ammoClass) return undefined
    const top = ammoPoolOf(ammoClass).eligible[0]
    return top ? { name: top.name, damage: top.ammoDamage as number } : undefined
  }

  // --- main pool (§3, §4.1)
  const weaponCand = (w: Weapon, availability: Availability, ownedUnknown: boolean): Cand | 'unverified' => {
    const profile = weaponProfile(w)
    if (!profile.ok) return 'unverified'
    return {
      key: itemKey(w.id),
      id: w.id,
      name: w.name,
      score: dppScore(w, profile, topAmmo(profile.ammoClass)),
      availability,
      ownedUnknown,
      gateCount: gateCount(w),
      rarity: w.rarity,
      order: w.id,
      weapon: w,
      tag0: w.tags[0],
      damageClass: profile.damageClass,
    }
  }
  const mainPool = collect(
    ctx,
    [...data.weapons.values()].filter((w) => mainPoolEligible(w, cls) !== false),
    (w) => [w],
    (w, admission) => (mainPoolEligible(w, cls) === undefined ? 'unverified' : weaponCand(w, admission.availability, admission.kind === 'eligible' && admission.ownedUnknown)),
  )
  mainPool.eligible.sort(byRank)
  mainPool.gated.sort(byRank)

  // --- pins: resolve one item pin into the dataset
  const pinnedWeapon = (id: number): PinnedItem | undefined => {
    const w = data.weapons.get(id)
    if (!w) return undefined
    const profile = weaponProfile(w)
    return {
      pinned: true,
      key: itemKey(id),
      id,
      name: w.name,
      record: w,
      ...pinnedAvailability(ctx, [w]),
      ...(profile.ok ? { score: isSummonStaff(w) ? damageScore(w) : dppScore(w, profile, topAmmo(profile.ammoClass)) } : { scoreMissing: profile.missing }),
    }
  }

  // --- main
  const mainPin = pins.main
  let main: Cand | PinnedItem | undefined
  if (mainPin?.kind === 'item') {
    const p = pinnedWeapon(mainPin.id)
    if (p && !isSummonStaff(p.record as Weapon)) main = p
    else ctx.notices.push(copy.pinNotice.notFit(data.weapons.get(mainPin.id)?.name ?? `Item #${mainPin.id}`))
  }
  if (mainPin?.kind !== 'empty' && !main) main = choose('main', mainPool.eligible)

  // --- alt (§4.2)
  const altPin = pins.alt
  let alt: Cand | PinnedItem | undefined
  if (altPin?.kind === 'item') {
    const p = pinnedWeapon(altPin.id)
    if (p && p.id !== main?.id && !isSummonStaff(p.record as Weapon)) alt = p
    else ctx.notices.push(copy.pinNotice.notFit(data.weapons.get(altPin.id)?.name ?? `Item #${altPin.id}`))
  }
  // The alt's own ranking (§4.2): a different weapon type first (hybrid: only another damage class), then the rest.
  let altRanked: Cand[] = []
  if (main) {
    const rest = mainPool.eligible.filter((c) => c.id !== main?.id)
    const mainWeapon = (isPinned(main) ? main.record : main.weapon) as Weapon
    if (cls === 'hybrid') {
      const mainClass = known<DamageClass>(mainWeapon, 'damageClass')
      altRanked = rest.filter((c) => c.damageClass !== mainClass)
    } else {
      const differs = (c: Cand) => c.tag0 !== mainWeapon.tags[0]
      altRanked = [...rest.filter(differs), ...rest.filter((c) => !differs(c))]
    }
  }
  if (altPin?.kind !== 'empty' && !alt && main) alt = choose('alt', altRanked)
  /**
   * §4.2's why for a recommended alt: another damage class (hybrid), another kind of weapon, or the same
   * kind (none other obtainable). B108 H2: beside a pinned main scoring below it, the alt is no
   * "next-highest" — the line says it outscores your pick. B110: beside a pinned main whose score is
   * Unknown, the line compares nothing with it ("your pick's score is Unknown").
   */
  const altWhy = (c: Cand): Segment[] => {
    const mainWeapon = main ? ((isPinned(main) ? main.record : main.weapon) as Weapon) : undefined
    if (cls === 'hybrid') return copy.rationale.altHybrid(copy.classWord(c.damageClass ?? 'other'))
    const pinUnscored = main !== undefined && isPinned(main) && main.score === undefined
    const pinScore = main && isPinned(main) ? main.score?.value : undefined
    const abovePin = pinScore !== undefined && c.score.value > pinScore && !sameScore(c.score.value, pinScore)
    if (c.tag0 !== mainWeapon?.tags[0]) return pinUnscored ? copy.rationale.altTypeUnscoredPin(copy.weaponKind(c.tag0)) : copy.rationale.altType(copy.weaponKind(c.tag0), abovePin)
    return pinUnscored ? copy.rationale.altSameTypeUnscoredPin() : copy.rationale.altSameType(abovePin)
  }

  // --- ammo for the weapons (§4.5); the weapons are then re-scored with the ammo in the loadout
  const ammoClassOf = (c: Cand | PinnedItem | undefined): string | undefined => {
    if (!c) return undefined
    const w = (isPinned(c) ? c.record : c.weapon) as Weapon | undefined
    return w ? known<string>(w, 'ammoClass') : undefined
  }
  const ammoSlot = (slotId: 'ammo0' | 'ammo1', ammoClass: string, forWeapon: Cand | PinnedItem, ammoFor: 'main' | 'alt'): Cand | PinnedItem | undefined => {
    const pool = ammoPoolOf(ammoClass)
    const pin = pins[slotId]
    let pick: Cand | PinnedItem | undefined
    if (pin?.kind === 'item') {
      const r = data.items.get(pin.id) ?? data.weapons.get(pin.id)
      const stats = (r as Item | undefined)?.ammoStats
      if (r && stats?.ammoClass === ammoClass) {
        const damage = known<number>(r, 'ammoStats.damage')
        pick = {
          pinned: true,
          key: itemKey(r.id),
          id: r.id,
          name: r.name,
          record: r,
          ...pinnedAvailability(ctx, [r]),
          ammoClass,
          ...(damage !== undefined
            ? { ammoDamage: damage, score: { kind: 'ammo', value: damage, text: String(damage), label: copy.scoreLabel.ammoDamage, formulaText: copy.formula.damage(damage), terms: [], effects: [] } }
            : { scoreMissing: ['ammoStats.damage'] }),
        }
      } else ctx.notices.push(copy.pinNotice.ammoMismatch(r?.name ?? `Item #${pin.id}`))
    }
    if (pin?.kind !== 'empty' && !pick) pick = choose(slotId, pool.eligible)
    const drawn = random.has(slotId)
    const result: SlotResult = {
      id: slotId,
      group: 'ammo',
      state: pick ? 'pick' : 'empty',
      alternatives: alternatives(pool, pick),
      pool: pool.counts,
      disclosure: disc(pool.counts),
      ammoClass,
      ammoFor,
      ...(drawn ? { random: true as const } : {}),
    }
    const weaponSeg: Segment = { kind: 'item', id: forWeapon.id, text: forWeapon.name }
    const ammoType = data.ammoTypeName(ammoClass)
    if (pick) {
      const recommended = () => copy.rationale.ammo(sizeOf(pool.counts), ammoType, weaponSeg)
      result.pick = view(pick, isPinned(pick) ? pinnedWhy(pick, pool.eligible[0], recommended) : drawn ? drawnWhy(copy.drawnFrom.ammo(sizeOf(pool.counts), ammoType, weaponSeg)) : recommended(), false, drawn)
      chosen.set(slotId, pick)
    } else result.empty = pin?.kind === 'empty' ? copy.empty.pinnedEmpty() : copy.empty.ammo(ammoType, weaponSeg)
    slots.set(slotId, result)
    return pick
  }
  const rescored = (c: Cand | PinnedItem | undefined, ammo: Cand | PinnedItem | undefined): Cand | PinnedItem | undefined => {
    if (!c) return c
    const w = (isPinned(c) ? c.record : c.weapon) as Weapon
    const profile = weaponProfile(w)
    if (!profile.ok || isSummonStaff(w) || !profile.ammoClass) return c
    const damage = ammo?.ammoDamage
    const ammoRef = ammo && damage !== undefined ? { name: ammo.name, damage } : undefined
    return { ...c, score: dppScore(w, profile, ammoRef) }
  }

  const mainAmmoClass = ammoClassOf(main)
  const altAmmoClass = ammoClassOf(alt)
  let ammo0: Cand | PinnedItem | undefined
  let ammo1: Cand | PinnedItem | undefined
  if (main && mainAmmoClass) ammo0 = ammoSlot('ammo0', mainAmmoClass, main, 'main')
  else {
    if (pins.ammo0?.kind === 'item') ctx.notices.push(copy.pinNotice.ammoMismatch(data.items.get(pins.ammo0.id)?.name ?? data.weapons.get(pins.ammo0.id)?.name ?? `Item #${pins.ammo0.id}`))
    slots.set('ammo0', { id: 'ammo0', group: 'ammo', state: 'empty', empty: copy.empty.noAmmoNeeded(main !== undefined), alternatives: [], ammoFor: 'main' })
  }
  if (alt && altAmmoClass && altAmmoClass !== mainAmmoClass) ammo1 = ammoSlot('ammo1', altAmmoClass, alt, 'alt')
  else if (pins.ammo1?.kind === 'item') ctx.notices.push(copy.pinNotice.ammoMismatch(data.items.get(pins.ammo1.id)?.name ?? data.weapons.get(pins.ammo1.id)?.name ?? `Item #${pins.ammo1.id}`))
  main = rescored(main, ammo0)
  alt = rescored(alt, altAmmoClass && altAmmoClass === mainAmmoClass ? ammo0 : ammo1)

  // weapon slots
  {
    const drawn = random.has('main')
    const result: SlotResult = { id: 'main', group: 'weapons', state: main ? 'pick' : 'empty', alternatives: alternatives(mainPool, main), pool: mainPool.counts, disclosure: disc(mainPool.counts), ...(drawn ? { random: true as const } : {}) }
    if (main) {
      const pick = main
      const recommended = () => withTies(copy.rationale.main(sizeOf(mainPool.counts), cls), pick, mainPool.eligible)
      result.pick = view(pick, isPinned(pick) ? pinnedWhy(pick, mainPool.eligible[0], recommended) : drawn ? drawnWhy(copy.drawnFrom.main(sizeOf(mainPool.counts), cls)) : recommended(), false, drawn)
      chosen.set('main', main)
    } else result.empty = mainPin?.kind === 'empty' ? copy.empty.pinnedEmpty() : copy.empty.main(cls)
    slots.set('main', result)
  }
  {
    const drawn = random.has('alt')
    const altPool: Pool = { ...mainPool, eligible: altRanked }
    const result: SlotResult = { id: 'alt', group: 'weapons', state: alt ? 'pick' : 'empty', alternatives: alternatives(altPool, alt), pool: mainPool.counts, disclosure: disc(mainPool.counts), ...(drawn ? { random: true as const } : {}) }
    if (alt) {
      const top = altRanked[0]
      result.pick = view(alt, isPinned(alt) ? pinnedWhy(alt, top, () => (top ? altWhy(top) : [])) : drawn ? drawnWhy(copy.drawnFrom.alt(sizeOfList(altRanked), cls)) : altWhy(alt), false, drawn)
      chosen.set('alt', alt)
    } else result.empty = altPin?.kind === 'empty' ? copy.empty.pinnedEmpty() : !main ? copy.empty.altNoMain() : cls === 'hybrid' ? copy.empty.altHybridNone() : copy.empty.altNone()
    slots.set('alt', result)
  }

  // --- armor (§4.3)
  const armorCands: { set: ArmorSet; variant: ArmorSet['variants'][number]; pieces: ArmorPiece[] }[] = []
  for (const set of data.sets.values()) {
    for (const variant of set.variants) {
      if (!variantFits(variant, cls)) continue
      const pieces = [variant.helmetId, set.pieces.chest, set.pieces.legs].map((id) => data.armor.get(id))
      if (pieces.some((p) => p === undefined)) continue
      armorCands.push({ set, variant, pieces: pieces as ArmorPiece[] })
    }
  }
  const armorPool = collect(
    ctx,
    armorCands.map((c) => ({ ...c, id: c.variant.helmetId })),
    (c) => c.pieces,
    (c, admission) => {
      const score = armorScore(c.pieces, c.variant.setBonus, c.set.name, input.goal, cls)
      if (!score) return 'unverified'
      const helmet = c.pieces[0]
      const multi = c.set.variants.length > 1
      return {
        key: `set:${c.set.id}:${helmet.id}`,
        id: helmet.id,
        name: multi ? `${c.set.name} (${helmet.name})` : c.set.name,
        setId: c.set.id,
        pieces: [helmet.id, c.set.pieces.chest, c.set.pieces.legs] as const,
        score,
        availability: admission.availability,
        ownedUnknown: admission.kind === 'eligible' && admission.ownedUnknown,
        gateCount: Math.max(...c.pieces.map(gateCount)),
        rarity: helmet.rarity,
        order: `${c.set.id}:${helmet.id}`,
        set: c.set,
        variant: c.variant,
        armorPieces: c.pieces,
      }
    },
  )
  armorPool.eligible.sort(byRank)
  armorPool.gated.sort(byRank)
  const armorPin = pins.armor
  let armor: Cand | PinnedItem | undefined
  if (armorPin?.kind === 'armor') {
    const ids = [armorPin.helmet, armorPin.chest, armorPin.legs]
    const slotsOk = ids.every((id, i) => id === null || data.armor.get(id)?.slot === (['head', 'chest', 'legs'] as const)[i])
    const pieces = ids.flatMap((id) => (id === null ? [] : [data.armor.get(id) as ArmorPiece]))
    if (slotsOk && pieces.length > 0) {
      const set = [...data.sets.values()].find((st) => armorPin.helmet !== null && st.pieces.helmets.includes(armorPin.helmet) && st.pieces.chest === armorPin.chest && st.pieces.legs === armorPin.legs)
      const variant = set?.variants.find((v) => v.helmetId === armorPin.helmet)
      const score = armorScore(pieces, variant?.setBonus ?? [], set?.name, input.goal, cls)
      const first = pieces[0]
      armor = {
        pinned: true,
        key: set && variant ? `set:${set.id}:${variant.helmetId}` : `pieces:${ids.map((x) => x ?? 0).join('.')}`,
        id: first.id,
        name: set ? (set.variants.length > 1 ? `${set.name} (${first.name})` : set.name) : pieces.map((p) => p.name).join(', '),
        ...(set ? { setId: set.id, set, variant } : {}),
        pieces: [armorPin.helmet ?? 0, armorPin.chest ?? 0, armorPin.legs ?? 0] as const,
        armorPieces: pieces,
        record: undefined,
        ...pinnedAvailability(ctx, pieces),
        ...(score ? { score } : { scoreMissing: ['defense'] }),
      }
    } else ctx.notices.push(copy.pinNotice.notFit(pieces.map((p) => p.name).join(', ') || 'That armor'))
  } else if (armorPin?.kind === 'item') ctx.notices.push(copy.pinNotice.notFit(data.armor.get(armorPin.id)?.name ?? `Item #${armorPin.id}`))
  if (armorPin?.kind !== 'empty' && !armor) armor = choose('armor', armorPool.eligible)
  {
    const drawn = random.has('armor')
    const result: SlotResult = { id: 'armor', group: 'armor', state: armor ? 'pick' : 'empty', alternatives: alternatives(armorPool, armor), pool: armorPool.counts, disclosure: disc(armorPool.counts), ...(drawn ? { random: true as const } : {}) }
    if (armor) {
      const pick = armor
      const recommended = () => withTies(copy.rationale.armor(sizeOf(armorPool.counts), input.goal), pick, armorPool.eligible)
      result.pick = view(pick, isPinned(pick) ? pinnedWhy(pick, armorPool.eligible[0], recommended) : drawn ? drawnWhy(copy.drawnFrom.armor(sizeOf(armorPool.counts))) : recommended(), false, drawn)
      chosen.set('armor', armor)
    } else result.empty = armorPin?.kind === 'empty' ? copy.empty.pinnedEmpty() : copy.empty.armor()
    slots.set('armor', result)
  }

  // --- accessories (§4.4)
  const accPool = collect(
    ctx,
    data.accessories.values(),
    (a) => [a],
    (a, admission) => {
      if (unverified(a, 'effects')) return 'unverified'
      if (a.wingStats && unverified(a, 'wingStats.flightTimeTicks')) return 'unverified'
      const effects = known<StatEffect[]>(a, 'effects') ?? []
      const { points } = accessoryPoints(a, effects, cls)
      const total = sumPoints(points)
      // B108(a): an unscored effect counts toward qualifying only when its text isn't tied to another class (keyword registry)
      const specials = effects.filter((e): e is Extract<StatEffect, { kind: 'special' }> => e.kind === 'special' && specialFits(e.text, cls))
      // qualification (§4.4 + B108(a) "empty beats zero"): ≥ 1 class-relevant point OR ≥ 1 special not tied to another class
      if (total <= 0 && specials.length === 0) return 'unqualified'
      const cand: Cand = {
        key: itemKey(a.id),
        id: a.id,
        name: a.name,
        score: { kind: 'accessory', value: total, text: fmt2(total), label: '', formulaText: '', terms: [], effects: [] },
        availability: admission.availability,
        ownedUnknown: admission.kind === 'eligible' && admission.ownedUnknown,
        gateCount: gateCount(a),
        rarity: a.rarity,
        order: a.id,
        accessory: a,
        points,
        total,
        hasSpecial: specials.length > 0,
        ...(specials[0] ? { firstSpecial: specials[0].text } : {}),
        wings: a.wingStats !== undefined,
        links: [...(known<number[]>(a, 'combinedFrom') ?? []), ...(known<number[]>(a, 'upgradesTo') ?? [])],
        quotas: (known<Accessory['categories']>(a, 'categories') ?? []).map((c) => QUOTA_OF[c]),
      }
      return cand
    },
  )
  const slotCount = SLOT_COUNT[input.difficulty]
  const dhIndex = DEMON_HEART_SLOT_INDEX[input.difficulty]
  const dhOpen = isNodeSatisfied(data.graph, ep, DEMON_HEART_GATE_NODE, memo)
  const template = categoryTemplate(input.goal, slotCount)
  const used = new Set<number>()
  let wingsUsed = false
  const linked = new Set<number>()
  const place = (id: number, wings: boolean, links: readonly number[]) => {
    used.add(id)
    if (wings) wingsUsed = true
    for (const l of links) linked.add(l)
  }
  const fitsConstraints = (c: Cand) => !used.has(c.id) && !(c.wings && wingsUsed) && !linked.has(c.id) && !(c.links ?? []).some((l) => used.has(l))
  const accChosen: (Cand | PinnedItem | undefined)[] = Array(slotCount).fill(undefined)
  const accPinned = new Set<number>()
  // pinned accessories first
  ACCESSORY_SLOT_IDS.forEach((slotId, i) => {
    const pin = pins[slotId]
    if (pin?.kind !== 'item') return
    const a = data.accessories.get(pin.id)
    const name = a?.name ?? `Item #${pin.id}`
    if (!a) return void ctx.notices.push(copy.pinNotice.notFit(name))
    if (i >= slotCount) return void ctx.notices.push(copy.pinNotice.noSlot(name, i + 1, DIFFICULTY_WORD[input.difficulty]))
    if (i === dhIndex && !dhOpen) return void ctx.notices.push(copy.pinNotice.demonHeartClosed(name, nodeName(DEMON_HEART_GATE_NODE)))
    if (used.has(a.id)) return void ctx.notices.push(copy.pinNotice.duplicate(name))
    if (a.wingStats && wingsUsed) return void ctx.notices.push(copy.pinNotice.secondWings(name))
    const effects = known<StatEffect[]>(a, 'effects')
    const points = effects !== undefined && !(a.wingStats && unverified(a, 'wingStats.flightTimeTicks')) ? accessoryPoints(a, effects, cls).points : undefined
    const pinnedItem: PinnedItem = {
      pinned: true,
      key: itemKey(a.id),
      id: a.id,
      name: a.name,
      record: a,
      ...pinnedAvailability(ctx, [a]),
      wings: a.wingStats !== undefined,
      ...(points ? { points, score: accessoryScore({ accessory: a, points } as Cand, template[i] ?? 'any', cls) } : { scoreMissing: ['effects'] }),
    }
    accChosen[i] = pinnedItem
    accPinned.add(i)
    place(a.id, a.wingStats !== undefined, [...(known<number[]>(a, 'combinedFrom') ?? []), ...(known<number[]>(a, 'upgradesTo') ?? [])])
  })
  const quotaOrder = (q: AccessoryQuota | 'any') => (a: Cand, b: Cand) => {
    const va = q === 'any' ? (a.total as number) : quotaValue(a.points as Points, q)
    const vb = q === 'any' ? (b.total as number) : quotaValue(b.points as Points, q)
    return vb - va || Number(b.hasSpecial) - Number(a.hasSpecial) || a.gateCount - b.gateCount || rarityRank(a.rarity) - rarityRank(b.rarity) || a.id - b.id
  }
  const withQuotaScore = (c: Cand, q: AccessoryQuota | 'any'): Cand => ({ ...c, score: accessoryScore(c, q, cls) })
  /** A recommended accessory's why (`c` scored on the slot's basis): its quota rank, a 0-point pick named (B108(a)), or the fallback. */
  const accWhy = (c: Cand, quota: AccessoryQuota, fallback: boolean, inQuota: readonly Cand[], ranked: readonly Cand[]): Segment[] => {
    const zero = (c.total as number) <= 0
    if (fallback) return zero && c.firstSpecial ? copy.rationale.accessoryFallbackZero(quota, c.firstSpecial) : copy.rationale.accessoryFallback(quota, fmt2(c.score.value))
    if (zero && c.firstSpecial) return copy.rationale.accessorySpecial(quota, c.firstSpecial)
    if (c.score.value <= 0) return copy.rationale.accessoryOtherPoints(quota, fmt2(c.total as number))
    return withTies(copy.rationale.accessory(sizeOfList(inQuota), quota), c, ranked, true)
  }
  for (let i = 0; i < slotCount; i++) {
    const slotId = ACCESSORY_SLOT_IDS[i]
    const quota = template[i]
    const isDh = i === dhIndex
    const base: SlotResult = { id: slotId, group: 'accessories', state: 'empty', alternatives: [], quota, ...(isDh ? { demonHeart: true } : {}) }
    if (isDh && !dhOpen) {
      slots.set(slotId, { ...base, state: 'locked', empty: copy.empty.demonHeart({ kind: 'boss', id: DEMON_HEART_GATE_NODE, text: nodeName(DEMON_HEART_GATE_NODE) }) })
      continue
    }
    const pinnedHere = accChosen[i]
    if (pinnedHere) {
      // its rationale and alternatives are set once every slot is filled (below)
      slots.set(slotId, { ...base, state: 'pick', pick: view(pinnedHere, copy.rationale.pinned()), pool: accPool.counts, disclosure: disc(accPool.counts) })
      chosen.set(slotId, pinnedHere)
      continue
    }
    if (pins[slotId]?.kind === 'empty') {
      slots.set(slotId, { ...base, empty: copy.empty.pinnedEmpty(), pool: accPool.counts, disclosure: disc(accPool.counts) })
      continue
    }
    if (rng) {
      // §4.8: drawn from EVERY free accessory (the quota is a ranking rule, not a legality one), scored on all its points
      const ranked = accPool.eligible
        .filter(fitsConstraints)
        .sort(quotaOrder('any'))
        .map((c) => withQuotaScore(c, 'any'))
      const drawn = choose(slotId, ranked)
      const result: SlotResult = { ...base, state: drawn ? 'pick' : 'empty', pool: accPool.counts, disclosure: disc(accPool.counts), alternatives: alternatives({ eligible: ranked }, drawn) }
      if (drawn) {
        result.random = true
        result.pick = view(drawn, drawnWhy(copy.drawnFrom.accessory(sizeOfList(ranked))), (drawn.total as number) <= 0, true)
        accChosen[i] = drawn
        chosen.set(slotId, drawn)
        place(drawn.id, drawn.wings === true, drawn.links ?? [])
      } else result.empty = copy.empty.accessory()
      slots.set(slotId, result)
      continue
    }
    const free = accPool.eligible.filter(fitsConstraints)
    const inQuota = free.filter((c) => c.quotas?.includes(quota)).sort(quotaOrder(quota))
    let pick: Cand | undefined = inQuota[0]
    let ranked = inQuota
    let fallback = false
    if (!pick) {
      ranked = [...free].sort(quotaOrder('any'))
      pick = ranked[0]
      fallback = pick !== undefined
    }
    const scoredRanked = ranked.map((c) => withQuotaScore(c, fallback ? 'any' : quota))
    const result: SlotResult = {
      ...base,
      state: pick ? 'pick' : 'empty',
      pool: accPool.counts,
      disclosure: disc(accPool.counts),
      alternatives: alternatives({ ...accPool, eligible: scoredRanked }, scoredRanked[0]),
      ...(fallback ? { fallback } : {}),
    }
    if (pick) {
      const scored = scoredRanked[0]
      result.pick = view(scored, accWhy(scored, quota, fallback, inQuota, scoredRanked), (pick.total as number) <= 0)
      accChosen[i] = scored
      chosen.set(slotId, scored)
      place(pick.id, pick.wings === true, pick.links ?? [])
    } else result.empty = copy.empty.accessory()
    slots.set(slotId, result)
  }
  // accessory pins in slots this difficulty doesn't have were noticed above

  // B108 H2 / M3: each pinned accessory against what the recommendation would put in its slot given the
  // OTHER slots (the swap sheet's legality), scored on the same basis as a recommended pick there — the
  // slot's quota, or any category when nothing of the quota is free — with the alternatives it would list.
  for (let i = 0; i < slotCount; i++) {
    const pick = accChosen[i]
    if (!isPinned(pick)) continue
    const slotId = ACCESSORY_SLOT_IDS[i]
    const quota = template[i]
    const others = accChosen.filter((c, j): c is Cand | PinnedItem => j !== i && c !== undefined)
    const otherIds = new Set(others.map((c) => c.id))
    const otherWings = others.some((c) => c.wings === true)
    const otherLinks = new Set(others.flatMap(linksOf))
    const free = accPool.eligible.filter((c) => !otherIds.has(c.id) && !(c.wings && otherWings) && !otherLinks.has(c.id) && !(c.links ?? []).some((l) => otherIds.has(l)))
    const inQuota = free.filter((c) => c.quotas?.includes(quota)).sort(quotaOrder(quota))
    const fallback = inQuota.length === 0 && free.length > 0
    const basis: AccessoryQuota | 'any' = fallback ? 'any' : quota
    const ranked = (fallback ? [...free].sort(quotaOrder('any')) : inQuota).map((c) => withQuotaScore(c, basis))
    const scoredPick: PinnedItem = pick.points ? { ...pick, score: accessoryScore({ accessory: pick.record, points: pick.points } as Cand, basis, cls) } : pick
    const top = ranked[0]
    const why = pinnedWhy(scoredPick, top, () => (top ? accWhy(top, quota, fallback, inQuota, ranked) : []))
    const prev = slots.get(slotId) as SlotResult
    slots.set(slotId, { ...prev, pick: view(scoredPick, why, pick.points !== undefined && sumPoints(pick.points) <= 0), alternatives: alternatives({ eligible: ranked }, scoredPick), ...(fallback ? { fallback } : {}) })
    accChosen[i] = scoredPick
    chosen.set(slotId, scoredPick)
  }

  // --- buffs (§4.5)
  const buffPool = collect(
    ctx,
    [...data.items.values()].filter((i) => i.category === 'potion' && potionBuffs(ctx, i) !== undefined),
    (p) => [p],
    (p, admission) => {
      const buffs = potionBuffs(ctx, p)
      if (buffs === 'unverified' || buffs === undefined) return 'unverified'
      const score = buffScore(buffs.effects, cls)
      if (score.value <= 0) return 'unqualified'
      return {
        key: itemKey(p.id),
        id: p.id,
        name: p.name,
        score,
        availability: admission.availability,
        ownedUnknown: admission.kind === 'eligible' && admission.ownedUnknown,
        gateCount: gateCount(p),
        rarity: p.rarity,
        order: p.id,
        buffIds: buffs.buffIds,
        potion: p,
        potionEffects: buffs.effects,
      }
    },
  )
  buffPool.eligible.sort(byRank)
  const buffsUsed = new Set<string>()
  const buffItems = new Set<number>()
  const buffChosen: (Cand | PinnedItem | undefined)[] = []
  BUFF_SLOT_IDS.forEach((slotId) => {
    const pin = pins[slotId]
    if (pin?.kind !== 'item') return
    const p = data.items.get(pin.id)
    const buffs = p && p.category === 'potion' ? potionBuffs(ctx, p) : undefined
    if (!p || buffs === undefined || buffItems.has(p.id)) return void ctx.notices.push(copy.pinNotice.notFit(p?.name ?? `Item #${pin.id}`))
    buffItems.add(p.id)
    if (buffs !== 'unverified') for (const b of buffs.buffIds) buffsUsed.add(b)
  })
  for (const slotId of BUFF_SLOT_IDS.slice(0, BUFF_SLOTS)) {
    const pin = pins[slotId]
    const base: SlotResult = { id: slotId, group: 'buffs', state: 'empty', alternatives: [], pool: buffPool.counts, disclosure: disc(buffPool.counts) }
    if (pin?.kind === 'item' && buffItems.has(pin.id) && !buffChosen.some((c) => c?.id === pin.id)) {
      const p = data.items.get(pin.id) as Item
      const buffs = potionBuffs(ctx, p)
      const pinnedItem: PinnedItem = {
        pinned: true,
        key: itemKey(p.id),
        id: p.id,
        name: p.name,
        record: p,
        ...pinnedAvailability(ctx, [p]),
        ...(buffs && buffs !== 'unverified' ? { score: buffScore(buffs.effects, cls), buffIds: buffs.buffIds, potionEffects: buffs.effects } : { scoreMissing: ['effects'] }),
      }
      buffChosen.push(pinnedItem)
      chosen.set(slotId, pinnedItem)
      slots.set(slotId, { ...base, state: 'pick', pick: view(pinnedItem, copy.rationale.pinned()) })
      continue
    }
    if (pin?.kind === 'empty') {
      buffChosen.push(undefined)
      slots.set(slotId, { ...base, empty: copy.empty.pinnedEmpty() })
      continue
    }
    const free = buffPool.eligible.filter((c) => !buffItems.has(c.id) && !(c.buffIds ?? []).some((b) => buffsUsed.has(b)))
    const pick = choose(slotId, free)
    const drawn = random.has(slotId)
    buffChosen.push(pick)
    if (pick) {
      buffItems.add(pick.id)
      for (const b of pick.buffIds ?? []) buffsUsed.add(b)
      chosen.set(slotId, pick)
      const why = drawn ? drawnWhy(copy.drawnFrom.buff(sizeOfList(free))) : withTies(copy.rationale.buff(sizeOf(buffPool.counts)), pick, free)
      slots.set(slotId, { ...base, state: 'pick', pick: view(pick, why, false, drawn), alternatives: alternatives({ ...buffPool, eligible: free }, pick), ...(drawn ? { random: true as const } : {}) })
    } else slots.set(slotId, { ...base, empty: copy.empty.buff() })
  }
  // B108 H2 / M3: each pinned potion against the slot's top candidate given the other potions (one push per slot above)
  BUFF_SLOT_IDS.slice(0, BUFF_SLOTS).forEach((slotId, i) => {
    const pick = buffChosen[i]
    if (!isPinned(pick)) return
    const others = buffChosen.filter((c, j): c is Cand | PinnedItem => j !== i && c !== undefined)
    const otherIds = new Set(others.map((c) => c.id))
    const otherBuffs = new Set(others.flatMap((c) => c.buffIds ?? []))
    const free = buffPool.eligible.filter((c) => !otherIds.has(c.id) && !(c.buffIds ?? []).some((b) => otherBuffs.has(b)))
    const prev = slots.get(slotId) as SlotResult
    const why = pinnedWhy(pick, free[0], () => withTies(copy.rationale.buff(sizeOf(buffPool.counts)), pick, free))
    slots.set(slotId, { ...prev, pick: view(pick, why, pick.score !== undefined && pick.score.value <= 0), alternatives: alternatives({ eligible: free }, pick) })
  })

  // --- summon slot (§4.5): base damage, not DPP
  const summonPool = collect(
    ctx,
    [...data.weapons.values()].filter((w) => w.tags.includes('minion-summon-items') && !w.tags.includes('unobtainable')),
    (w) => [w],
    (w, admission) => {
      const damage = known<number>(w, 'damage')
      if (damage === undefined) return 'unverified'
      return { key: itemKey(w.id), id: w.id, name: w.name, score: damageScore(w), availability: admission.availability, ownedUnknown: admission.kind === 'eligible' && admission.ownedUnknown, gateCount: gateCount(w), rarity: w.rarity, order: w.id, weapon: w }
    },
  )
  summonPool.eligible.sort(byRank)
  summonPool.gated.sort(byRank)
  {
    const pin = pins.summon
    let summon: Cand | PinnedItem | undefined
    if (pin?.kind === 'item') {
      const w = data.weapons.get(pin.id)
      if (w && isSummonStaff(w)) {
        const damage = known<number>(w, 'damage')
        summon = { pinned: true, key: itemKey(w.id), id: w.id, name: w.name, record: w, ...pinnedAvailability(ctx, [w]), ...(damage !== undefined ? { score: damageScore(w) } : { scoreMissing: ['damage'] }) }
      } else ctx.notices.push(copy.pinNotice.notFit(w?.name ?? `Item #${pin.id}`))
    }
    if (pin?.kind !== 'empty' && !summon) summon = choose('summon', summonPool.eligible)
    const drawn = random.has('summon')
    const result: SlotResult = { id: 'summon', group: 'summon', state: summon ? 'pick' : 'empty', alternatives: alternatives(summonPool, summon), pool: summonPool.counts, disclosure: disc(summonPool.counts), ...(drawn ? { random: true as const } : {}) }
    if (summon) {
      const pick = summon
      const top = summonPool.eligible[0]
      const recommended = () => withTies(copy.rationale.summon(sizeOf(summonPool.counts)), pick, summonPool.eligible)
      // the recommendation's why carries the minion-AI note; every other line (pinned, drawn) gets it appended
      const same = isPinned(pick) && pick.score !== undefined && top?.key === pick.key
      result.pick = view(
        pick,
        drawn
          ? [...drawnWhy(copy.drawnFrom.summon(sizeOf(summonPool.counts))), SPACE, ...copy.rationale.minionNote()]
          : !isPinned(pick)
            ? recommended()
            : same
              ? pinnedWhy(pick, top, recommended)
              : [...pinnedWhy(pick, top, recommended), SPACE, ...copy.rationale.minionNote()],
        false,
        drawn,
      )
      chosen.set('summon', summon)
    } else result.empty = pin?.kind === 'empty' ? copy.empty.pinnedEmpty() : copy.empty.summon()
    slots.set('summon', result)
  }

  return {
    ctx,
    slots,
    chosen,
    pools: { main: mainPool, armor: armorPool, accessories: accPool, buffs: buffPool, summon: summonPool, ammo: ammoPools },
    dhIndex,
    dhOpen,
    slotCount,
    template,
    progress,
    random,
  }
}

/** Base-damage score of a minion staff (§4.5: not DPP — cast time isn't the minion's attack rate). */
function damageScore(w: Weapon): PickScore {
  const damage = known<number>(w, 'damage') ?? 0
  return { kind: 'damage', value: damage, text: String(damage), label: copy.scoreLabel.damage, formulaText: copy.formula.damage(damage), terms: [], effects: [] }
}

/**
 * A slot's pick as shown. `zero`: an accessory / potion adding 0 counted points (B108(a): named on the
 * card and in Step 3). `drawn`: Surprise Me drew it (§4.8).
 */
function view(c: Cand | PinnedItem, rationale: Segment[], zero = false, drawn = false): PickView {
  const pinned = isPinned(c)
  return {
    key: c.key,
    id: c.id,
    name: c.name,
    ...(c.setId ? { setId: c.setId } : {}),
    ...(c.pieces ? { pieces: c.pieces } : {}),
    ...(c.score ? { score: c.score } : {}),
    ...(pinned && c.scoreMissing ? { scoreMissing: c.scoreMissing } : {}),
    rationale: !pinned && c.ownedUnknown ? [...rationale, SPACE, ...copy.rationale.owned()] : rationale,
    source: pinned ? 'pinned' : drawn ? 'random' : 'recommended',
    availability: c.availability,
    ownedUnknown: c.ownedUnknown,
    ...(zero ? { zeroPoints: true as const } : {}),
  }
}

const sameScore = (a: number, b: number) => Math.abs(a - b) < 1e-9

/** The next-ranked candidates after the pick (ties marked) — the pick excluded wherever it ranks. */
function alternatives(pool: Pick<Pool, 'eligible'>, pick: Cand | PinnedItem | undefined): AltView[] {
  return pool.eligible
    .filter((c) => c.key !== pick?.key)
    .slice(0, ALTERNATIVES_SHOWN)
    .map((c) => ({
      key: c.key,
      id: c.id,
      name: c.name,
      ...(c.setId ? { setId: c.setId } : {}),
      ...(c.pieces ? { pieces: c.pieces } : {}),
      score: c.score,
      tied: pick?.score !== undefined && sameScore(c.score.value, pick.score.value),
      higher: pick?.score !== undefined && !sameScore(c.score.value, pick.score.value) && c.score.value > pick.score.value,
      availability: c.availability,
      ownedUnknown: c.ownedUnknown,
    }))
}

/** Appends the tie line when candidates share the pick's score (§4.6 decided). */
function withTies(lines: Segment[], pick: Cand | PinnedItem, ranked: readonly Cand[], accessory = false): Segment[] {
  if (!pick.score) return lines
  const tied = ranked.filter((c) => c.key !== pick.key && sameScore(c.score.value, (pick.score as PickScore).value)).slice(0, ALTERNATIVES_SHOWN)
  if (tied.length === 0) return lines
  return [...lines, SPACE, ...copy.rationale.tied(tied.map((c) => [{ kind: 'item', id: c.id, text: c.name } as Segment]), accessory)]
}

// --- the gated track (§4.7) -----------------------------------------------------------------------------------

function gatedTrack(b: Built): GatedGroup[] {
  const entries: GatedEntry[] = []
  const ref = (c: Cand | PinnedItem): ItemRef => ({ key: c.key, id: c.id, name: c.name, ...(c.setId ? { setId: c.setId } : {}), ...(c.pieces ? { pieces: c.pieces } : {}) })
  /** §4.7: gated items that would outrank the slot's pick; the easier alternative = the slot's top status-"yes" candidate. */
  const fromPool = (slot: GatedEntry['slot'], pool: Pool, slotId: SlotId) => {
    const floor = b.chosen.get(slotId)?.score?.value
    const top = pool.eligible[0]
    for (const c of pool.gated.filter((g) => floor === undefined || g.score.value > floor).slice(0, GATED_PER_SLOT)) {
      entries.push({ ...ref(c), slot, score: c.score, availability: c.availability, ...(top ? { alternative: ref(top) } : {}) })
    }
  }
  fromPool('main', b.pools.main, 'main')
  fromPool('armor', b.pools.armor, 'armor')
  // accessories: per quota category, gated ones whose category points beat the lowest pick of that category
  const quotas = [...new Set(b.template)]
  for (const quota of quotas) {
    const slotsOfQuota = b.template.map((q, i) => ({ q, i })).filter(({ q, i }) => q === quota && !(i === b.dhIndex && !b.dhOpen))
    if (slotsOfQuota.length === 0) continue
    const slotIds = slotsOfQuota.map(({ i }) => ACCESSORY_SLOT_IDS[i])
    // a slot of this quota left empty, or filled from another category: any qualifying gated item would outrank it
    const open = slotIds.some((id) => !b.chosen.get(id) || b.slots.get(id)?.fallback)
    // a pick's worth in this quota: its quota score — a Surprise Me draw is scored on all its points, so read its quota points (§4.8)
    const inQuota = (id: SlotId, p: Cand | PinnedItem) => (b.random.has(id) && p.points ? quotaValue(p.points, quota) : (p.score?.value ?? 0))
    let floor: number | undefined
    if (!open)
      for (const id of slotIds) {
        const v = inQuota(id, b.chosen.get(id) as Cand | PinnedItem)
        if (floor === undefined || v < floor) floor = v
      }
    const scored = b.pools.accessories.gated
      .filter((c) => c.quotas?.includes(quota))
      .map((c) => ({ ...c, score: accessoryScore(c, quota, b.ctx.cls) }))
      // "would score higher": counted points above the weakest pick of the quota (any counted points when a slot of it is open)
      .filter((c) => c.score.value > (floor ?? 0))
      .sort((x, y) => y.score.value - x.score.value || x.gateCount - y.gateCount || rarityRank(x.rarity) - rarityRank(y.rarity) || x.id - y.id)
      .slice(0, GATED_PER_SLOT)
    const top = b.pools.accessories.eligible.filter((c) => c.quotas?.includes(quota)).sort((x, y) => quotaValue(y.points as Points, quota) - quotaValue(x.points as Points, quota) || Number(y.hasSpecial) - Number(x.hasSpecial) || x.gateCount - y.gateCount || rarityRank(x.rarity) - rarityRank(y.rarity) || x.id - y.id)[0]
    for (const c of scored) entries.push({ ...ref(c), slot: quota, score: c.score, availability: c.availability, ...(top ? { alternative: ref(top) } : {}) })
  }
  fromPool('summon', b.pools.summon, 'summon')
  // one entry per item (an accessory can rank in two quota categories): keep its first
  const seen = new Set<string>()
  const unique = entries.filter((e) => (seen.has(e.key) ? false : (seen.add(e.key), true)))
  const groups = new Map<string, GatedGroup>()
  for (const e of unique) {
    const key = e.availability.missing.join('+')
    const group = groups.get(key) ?? { missing: e.availability.missing, entries: [] }
    group.entries.push(e)
    groups.set(key, group)
  }
  // B108 M1: the target boss's group leads (exactly that boss first, then groups that include it); then
  // nearest gates first: fewer bosses, then name order (deterministic)
  const target = b.ctx.input.bossId ? b.ctx.data.bosses.get(b.ctx.input.bossId)?.nodeId : undefined
  const lead = (g: GatedGroup) => (target === undefined ? 2 : g.missing.length === 1 && g.missing[0] === target ? 0 : g.missing.includes(target) ? 1 : 2)
  return [...groups.values()].sort((a, c) => lead(a) - lead(c) || a.missing.length - c.missing.length || a.missing.join('+').localeCompare(c.missing.join('+')))
}

/** B108(a): every pick adding 0 counted points, in slot order, with its unscored effects (verbatim). */
function zeroPointPicks(b: Built): ZeroPointPick[] {
  const out: ZeroPointPick[] = []
  for (const id of SLOT_IDS) {
    const pick = b.slots.get(id)?.pick
    const c = b.chosen.get(id)
    if (!pick?.zeroPoints || !c) continue
    const record = isPinned(c) ? c.record : c.accessory
    const effects = c.potionEffects ?? (record && record.type === 'accessory' ? (known<StatEffect[]>(record, 'effects') ?? []) : [])
    const specials = effects.flatMap((e) => (e.kind === 'special' ? [e.text] : []))
    out.push({ key: pick.key, id: pick.id, name: pick.name, slot: id, specials })
  }
  return out
}

// --- result ----------------------------------------------------------------------------------------------------

/** The loadout the slots hold (DATA_SCHEMA_SPEC §8a LoadoutSlots; 7 accessory entries, null = empty). */
function loadoutOf(b: Built): LoadoutSlots {
  const id = (slot: SlotId) => b.chosen.get(slot)?.id ?? null
  const armor = b.chosen.get('armor')
  const pieces = armor?.pieces ?? [0, 0, 0]
  const piece = (i: number) => (pieces[i] ? pieces[i] : null)
  return {
    mainWeapon: id('main'),
    altWeapon: id('alt'),
    helmet: armor ? piece(0) : null,
    chest: armor ? piece(1) : null,
    legs: armor ? piece(2) : null,
    accessories: Array.from({ length: MAX_ACCESSORY_SLOTS }, (_, i) => (i < b.slotCount ? id(ACCESSORY_SLOT_IDS[i]) : null)),
    ammo: AMMO_SLOT_IDS.map(id).filter((x): x is number => x !== null),
    buffs: BUFF_SLOT_IDS.map(id).filter((x): x is number => x !== null),
    summon: id('summon'),
  }
}

function profileOf(b: Built): BuildProfile {
  const { data, input } = b.ctx
  const main = b.chosen.get('main')
  const mainWeapon = main ? ((isPinned(main) ? main.record : main.weapon) as Weapon) : undefined
  const ammo = b.chosen.get('ammo0')
  const armor = b.chosen.get('armor')
  const armorPieces = armor?.armorPieces ?? []
  const set = armor?.set && armor.variant ? { set: armor.set, variant: armor.variant } : undefined
  const accessories = ACCESSORY_SLOT_IDS.slice(0, b.slotCount).flatMap((slot) => {
    const c = b.chosen.get(slot)
    const a = c ? (isPinned(c) ? c.record : c.accessory) : undefined
    return a && data.accessories.has(a.id) ? [a as Accessory] : []
  })
  const potions = BUFF_SLOT_IDS.flatMap((slot) => {
    const c = b.chosen.get(slot)
    if (!c) return []
    const item = data.items.get(c.id)
    const effects = c.potionEffects
    return item && effects ? [{ item, effects }] : []
  })
  const ammoDamage = ammo?.ammoDamage
  return scoreBuild({
    cls: input.cls,
    goal: input.goal,
    ...(mainWeapon ? { main: mainWeapon } : {}),
    ...(ammo && ammoDamage !== undefined ? { ammo: { name: ammo.name, damage: ammoDamage } } : {}),
    pieces: armorPieces,
    ...(set ? { set } : {}),
    accessories,
    potions,
  })
}

function assumptionsOf(b: Built, input: BuilderInput, stageWord: string): AssumptionText[] {
  const { data } = b.ctx
  const name = (id: string) => data.graph.nodes.find((n) => n.id === id)?.name ?? id
  // the assumption names the BOSSES the stage implies (milestones such as Hardmode follow from them)
  const virtualBosses = b.progress.virtual.filter((id) => data.graph.nodes.find((n) => n.id === id)?.kind === 'boss')
  const out: AssumptionText[] = [copy.buildAssumption.progress(stageWord, virtualBosses.map(name), b.progress.tracked.length), copy.buildAssumption.availability(), copy.buildAssumption.worldEvil()]
  const worldEvil = input.progress.worldEvil
  if (worldEvil && b.ctx.otherCondition) {
    const own = WORLD_EVIL_CONDITION[worldEvil]
    out.push(copy.buildAssumption.worldType(data.conditions.get(own)?.name ?? own, data.conditions.get(b.ctx.otherCondition)?.name ?? b.ctx.otherCondition))
  }
  const boss = input.bossId ? data.bosses.get(input.bossId) : undefined
  if (boss) out.push(copy.buildAssumption.target(boss.name))
  if (b.dhIndex !== null && b.dhOpen && b.slots.get(ACCESSORY_SLOT_IDS[b.dhIndex])?.state === 'pick') out.push(copy.buildAssumption.demonHeart(DEMON_HEART_SOURCE))
  if (BUFF_SLOT_IDS.some((slot) => b.chosen.has(slot))) out.push(copy.buildAssumption.potions())
  if ([...b.slots.values()].some((sl) => sl.pick?.ownedUnknown)) out.push(copy.buildAssumption.ownedUnknown())
  out.push(copy.buildAssumption.weights(SCORING_CONSTANTS_VERSION, SPECIAL_SCOPE_VERSION))
  return out
}

export interface RecommendOptions {
  /** The stage's display name for the assumptions ("Early Hardmode"); defaults to the stage id. */
  stageName?: string
}

/** recommendLoadout (SCORING_SPEC §7): degrade, never throw on data. */
export function recommendLoadout(input: BuilderInput, data: BuilderData, options: RecommendOptions = {}): BuilderResult {
  const b = build(input, data)
  const order: SlotId[] = SLOT_IDS.filter((id) => b.slots.has(id))
  return {
    constantsVersion: SCORING_CONSTANTS_VERSION,
    input: { stage: input.stage, cls: input.cls, difficulty: input.difficulty, goal: input.goal, bossId: input.bossId },
    progress: b.progress,
    slots: order.map((id) => b.slots.get(id) as SlotResult),
    loadout: loadoutOf(b),
    gated: gatedTrack(b),
    profile: profileOf(b),
    assumptions: assumptionsOf(b, input, options.stageName ?? input.stage),
    notices: b.ctx.notices,
    zeroPoint: zeroPointPicks(b),
    ...(input.seed !== undefined ? { seed: input.seed } : {}),
  }
}

// --- the Step 3 references' search space (PRD P4-S3 AC2; AMENDMENTS-016 B113a) ---------------------------------

/**
 * What a bar's reference may depend on: the user's stage, class, difficulty, target boss and tracked
 * progress — never a pick, the goal, owned gear or a Surprise Me draw (B113a: a bar never compares a build
 * with itself). Structural: only these fields are read.
 */
export type ReferenceInput = Pick<BuilderInput, 'stage' | 'cls' | 'difficulty' | 'bossId' | 'progress'>

/** The verified-obtainable candidates of each slot for a ReferenceInput (the swap sheets' pools, owned gear left out). */
export interface ReferencePools {
  /** Main-slot weapons with the highest-damage verified ammo of their type (§4.5), when they fire ammo. */
  weapons: readonly { weapon: Weapon; ammo?: { name: string; damage: number } }[]
  armor: readonly { name: string; set: ArmorSet; variant: ArmorSet['variants'][number]; pieces: readonly ArmorPiece[] }[]
  accessories: readonly { accessory: Accessory; wings: boolean; links: readonly number[] }[]
  potions: readonly { item: Item; buffIds: readonly string[]; effects: readonly StatEffect[] }[]
  /** Accessory slots open at this difficulty and progress (a locked Demon Heart slot left out). */
  accessorySlots: number
}

export function referencePools(input: ReferenceInput, data: BuilderData): ReferencePools {
  // only the five reference fields; the goal is fixed (it orders pools, never admits or drops a candidate)
  const b = build({ stage: input.stage, cls: input.cls, difficulty: input.difficulty, bossId: input.bossId, progress: input.progress, goal: 'balanced', owned: [] }, data)
  const verified = (c: Cand) => !c.ownedUnknown && c.availability.status === 'yes'
  const ammoTop = new Map<string, { name: string; damage: number } | undefined>()
  const ammoFor = (ammoClass: string | undefined) => {
    if (!ammoClass) return undefined
    if (!ammoTop.has(ammoClass)) {
      const top = ammoPool(b.ctx, ammoClass).eligible.find(verified)
      ammoTop.set(ammoClass, top ? { name: top.name, damage: top.ammoDamage as number } : undefined)
    }
    return ammoTop.get(ammoClass)
  }
  return {
    weapons: b.pools.main.eligible.filter(verified).map((c) => {
      const w = c.weapon as Weapon
      const ammo = ammoFor(known<string>(w, 'ammoClass'))
      return { weapon: w, ...(ammo ? { ammo } : {}) }
    }),
    armor: b.pools.armor.eligible.filter(verified).map((c) => ({ name: c.name, set: c.set as ArmorSet, variant: c.variant as ArmorSet['variants'][number], pieces: c.armorPieces as ArmorPiece[] })),
    accessories: b.pools.accessories.eligible.filter(verified).map((c) => ({ accessory: c.accessory as Accessory, wings: c.wings === true, links: c.links ?? [] })),
    potions: b.pools.buffs.eligible.filter(verified).map((c) => ({ item: c.potion as Item, buffIds: c.buffIds ?? [], effects: c.potionEffects ?? [] })),
    accessorySlots: b.slotCount - (b.dhIndex !== null && !b.dhOpen ? 1 : 0),
  }
}

// --- swap options ------------------------------------------------------------------------------------------------

export interface SlotOption extends ItemRef {
  score: PickScore
  availability: Availability
  ownedUnknown: boolean
  /** The current pick of this slot. */
  current: boolean
  /** Same score as the current pick (B108 nit: tie tag in the swap sheet). */
  tied: boolean
  /** Why it can't go here (another slot holds it, a second pair of wings, a direct upgrade pair, a buff already granted). */
  blocked?: 'in-use' | 'wings' | 'linked' | 'buff'
}

export interface SlotOptions {
  slot: SlotId
  options: SlotOption[]
  /** The slot can be left empty (every slot but a locked one). */
  canEmpty: boolean
}

/**
 * Swap-a-pick: the slot's whole legal pool (status "yes", or owned with Unknown availability), ranked
 * by the slot's own score, given what the OTHER slots hold. Candidates that would break a constraint
 * are listed with the reason, not hidden.
 */
export function slotOptions(input: BuilderInput, data: BuilderData, slot: SlotId): SlotOptions {
  const b = build(input, data)
  const result = b.slots.get(slot)
  const current = b.chosen.get(slot)
  const toOption = (c: Cand, blocked?: SlotOption['blocked']): SlotOption => ({
    key: c.key,
    id: c.id,
    name: c.name,
    ...(c.setId ? { setId: c.setId } : {}),
    ...(c.pieces ? { pieces: c.pieces } : {}),
    score: c.score,
    availability: c.availability,
    ownedUnknown: c.ownedUnknown,
    current: c.key === current?.key,
    tied: false,
    ...(blocked ? { blocked } : {}),
  })
  if (!result || result.state === 'locked') return { slot, options: [], canEmpty: false }
  let options: SlotOption[] = []
  if (slot === 'main') options = b.pools.main.eligible.map((c) => toOption(c))
  else if (slot === 'alt') options = b.pools.main.eligible.map((c) => toOption(c, c.id === b.chosen.get('main')?.id ? 'in-use' : undefined))
  else if (slot === 'armor') options = b.pools.armor.eligible.map((c) => toOption(c))
  else if (slot === 'summon') options = b.pools.summon.eligible.map((c) => toOption(c))
  else if (slot === 'ammo0' || slot === 'ammo1') options = result.ammoClass ? (b.pools.ammo.get(result.ammoClass)?.eligible ?? []).map((c) => toOption(c)) : []
  else if ((ACCESSORY_SLOT_IDS as readonly string[]).includes(slot)) {
    const others = ACCESSORY_SLOT_IDS.slice(0, b.slotCount)
      .filter((id) => id !== slot)
      .flatMap((id) => {
        const c = b.chosen.get(id)
        return c ? [c] : []
      })
    const otherIds = new Set(others.map((c) => c.id))
    const otherWings = others.some((c) => c.wings === true)
    const otherLinks = new Set(others.flatMap((c) => (isPinned(c) ? [...(known<number[]>(c.record, 'combinedFrom') ?? []), ...(known<number[]>(c.record, 'upgradesTo') ?? [])] : (c.links ?? []))))
    const quota = result.quota ?? 'util'
    options = [...b.pools.accessories.eligible]
      .sort((x, y) => quotaValue(y.points as Points, quota) - quotaValue(x.points as Points, quota) || (y.total as number) - (x.total as number) || x.gateCount - y.gateCount || rarityRank(x.rarity) - rarityRank(y.rarity) || x.id - y.id)
      .map((c) => {
        const scored = { ...c, score: accessoryScore(c, quota, b.ctx.cls) }
        const blocked: SlotOption['blocked'] = otherIds.has(c.id) ? 'in-use' : c.wings && otherWings ? 'wings' : otherLinks.has(c.id) || (c.links ?? []).some((l) => otherIds.has(l)) ? 'linked' : undefined
        return toOption(scored, blocked)
      })
  } else if ((BUFF_SLOT_IDS as readonly string[]).includes(slot)) {
    const others = BUFF_SLOT_IDS.filter((id) => id !== slot).flatMap((id) => {
      const c = b.chosen.get(id)
      return c ? [c] : []
    })
    const otherBuffs = new Set(others.flatMap((c) => c.buffIds ?? []))
    const otherIds = new Set(others.map((c) => c.id))
    options = b.pools.buffs.eligible.map((c) => toOption(c, otherIds.has(c.id) ? 'in-use' : (c.buffIds ?? []).some((x) => otherBuffs.has(x)) ? 'buff' : undefined))
  }
  // ties with the current pick, on the sheet's own scoring (the current option's score when it is listed)
  const currentScore = options.find((o) => o.current)?.score.value ?? current?.score?.value
  if (currentScore !== undefined) options = options.map((o) => (!o.current && sameScore(o.score.value, currentScore) ? { ...o, tied: true } : o))
  return { slot, options, canEmpty: true }
}
