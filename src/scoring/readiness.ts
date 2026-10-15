/**
 * Readiness factors (SCORING_SPEC §6, P5-S6; PRD §9 Feature A; AMENDMENTS-014 B68–B71). Pure
 * TypeScript: one boss × the user's state (tracked defeats, world evil, the loadout they entered) →
 * five factor explanations. Never a fight-outcome prediction: factors emit TAGGED LINES (easier |
 * harder | info | unknown) with the data behind each — no factor grade, no total, no verdict field
 * (§1.6). The summary is exactly the union of the easier / harder lines.
 *
 * Rules applied here:
 * - Availability is TRACKED-ONLY (B69/Q9): effectiveProgress with no stage — never virtual defeats.
 * - The loadout is what the user owns, and possession is asserted (SCORING_SPEC §6; AMENDMENTS-015
 *   B94(1)): every owned item counts whatever its derived gating. Unknown availability → counted ("you
 *   put it in your loadout", B69/Q2); gated for the user (a boss on its gate not marked defeated) →
 *   counted too, with an info line in its factor naming the bosses its usual sources need. B71's
 *   gated→never rule governs the suggestion pool only (improve.ts).
 * - The Demon Heart slot (Expert / Master) carries an assumption chip; while the Wall of Flesh is not
 *   marked defeated the slot is taken as closed and its accessory isn't counted (AMENDMENTS-001 A4,
 *   B69/Q3 — no toggle). That is the slot's existence, not the item's gating.
 * - Unknown is excluded and disclosed, never 0 (§1.3): a field that reads Unknown removes its
 *   comparison and shows up as an "unknown" line and in the factor's computedFrom.
 * - Boss stats come from statsByDifficulty[selected] only — no cross-difficulty substitution.
 * - Tone policy: easier / harder only where the spec names a comparison (a TAG_NEEDS need met or not,
 *   a scope mismatch, a set bonus on or off, missing ammo / potions / healing, the 1-damage floor, no
 *   defense at all). Juxtapositions (estimates beside boss stats) are "info".
 */
import type { Accessory, ArmorPiece, ArmorSet, AttackPatternTag, Boss, Buff, Condition, Difficulty, Item, LoadoutClass, LoadoutSlots, StatEffect, Weapon } from '../schemas'
import { getField } from '../schemas/getField'
import { availabilityOf, UNKNOWN_AVAILABILITY, type Availability } from './candidates'
import {
  BASE_CRIT_PCT,
  DEFENSE_RULE_SOURCE,
  DEMON_HEART_GATE_NODE,
  DEMON_HEART_SLOT_INDEX,
  DEMON_HEART_SOURCE,
  DPP_ASSUMPTIONS,
  FLIGHT_HELPS_TICKS,
  MIN_DAMAGE_PER_HIT,
  MOVE_SPEED_HELPS_PCT,
  NPC_DEFENSE_FACTOR,
  PLAYER_DEFENSE_FACTOR,
  SCORING_CONSTANTS_VERSION,
  SLOT_COUNT,
  TAG_NEEDS,
} from './constants'
import { effectiveProgress, isNodeSatisfied, type ProgressionGraphLike, type ProgressionNodeLike, type TrackedProgress } from './progress'
import { appliesTo, effectPoints, isSummonStaff, statTotal, sumPoints, weaponProfile, type ClassChoice, type WeaponProfile } from './proxies'
import {
  analysisAssumption,
  assumptionText,
  CLASS_WORD,
  DIFFICULTY_WORD,
  effectPhrase,
  f1,
  f2,
  f3,
  f4,
  f5,
  FACTOR_TITLES,
  FIELD_WORD,
  notCounted as notCountedCopy,
  num,
  oneDecimal,
  owned,
  plain,
  possessive,
  s,
  seconds,
  unknown,
  whole,
  type AssumptionText,
  type EstimateKey,
  type Segment,
} from './readinessCopy'

// --- public shapes ----------------------------------------------------------------------------------

export type Tone = 'easier' | 'harder' | 'info' | 'unknown'
export type FactorId = 'damage' | 'defense' | 'mobility' | 'synergy' | 'preparation'
export const FACTOR_IDS: readonly FactorId[] = ['damage', 'defense', 'mobility', 'synergy', 'preparation']

export interface ReadinessLine {
  /** Stable within the analysis (`<factor>.<key>`). */
  id: string
  tone: Tone
  segments: Segment[]
  /** The segments' plain text (summaries, audits). */
  text: string
  /** TypedRefs behind the line (`i:<id>`, `boss:<slug>`, `set:<slug>`, `buff:<slug>`, `cond:<slug>`). */
  evidence: string[]
  /** terraria.wiki.gg pages the line's claims come from. */
  sources: string[]
  /** Built from the editorial TAG_NEEDS map (F3): rendered with the "curated" label. */
  editorial?: true
}

export interface ComputedFrom {
  used: number
  total: number
  /** The inputs that read Unknown, in words ("Plantera’s contact damage on Expert"). */
  unknownInputs: string[]
}

/** One factor (SCORING_SPEC §6 shape). Structurally no verdict / grade / probability field. */
export interface ReadinessFactor {
  id: FactorId
  title: string
  lines: ReadinessLine[]
  computedFrom: ComputedFrom
}

export type SlotRef =
  | { kind: 'mainWeapon' }
  | { kind: 'altWeapon' }
  | { kind: 'helmet' }
  | { kind: 'chest' }
  | { kind: 'legs' }
  | { kind: 'accessory'; index: number }
  | { kind: 'ammo'; index: number }
  | { kind: 'buff'; index: number }
  | { kind: 'summon' }

/** Why a filled slot isn't counted. Derived gating is never one (owned items count — B94(1)). */
export type NotCountedReason = 'demon-heart' | 'duplicate' | 'wrong-slot' | 'missing-from-dataset'

/** One filled loadout slot, resolved against the dataset and the user's tracked progress. */
export interface LoadoutEntry {
  slot: SlotRef
  id: number
  name: string
  kind: 'weapon' | 'armor' | 'accessory' | 'item' | 'missing'
  counted: boolean
  reason?: NotCountedReason
  availability: Availability
}

export interface NotCountedLine {
  entry: LoadoutEntry
  segments: Segment[]
  text: string
}

export interface SummaryEntry {
  factor: FactorId
  line: ReadinessLine
}

export interface ReadinessAnalysis {
  bossId: string
  difficulty: Difficulty
  cls: LoadoutClass
  constantsVersion: number
  entries: LoadoutEntry[]
  notCounted: NotCountedLine[]
  factors: ReadinessFactor[]
  /** Exactly the easier / harder lines of the factors, in factor order (§1.6). */
  summary: { easier: SummaryEntry[]; harder: SummaryEntry[] }
  computedFrom: ComputedFrom
  /** AssumptionsTip content for each estimate the lines carry (never empty where used). */
  estimates: Partial<Record<EstimateKey, AssumptionText[]>>
  assumptions: AssumptionText[]
  /** The Expert / Master Demon Heart slot: its index, and whether its gate (Wall of Flesh) is marked defeated. */
  demonHeart?: { slotIndex: number; gateMet: boolean }
  /** Accessories stored in slots this difficulty doesn't have (kept for switching back; not analyzed). */
  inactiveSlotItems: number
}

export type ReadinessResult = ReadinessAnalysis | { error: 'no-boss' }

export interface ReadinessInput {
  bossId: string | null
  difficulty: Difficulty
  cls: LoadoutClass
  loadout: LoadoutSlots
  /** tc.v1.progress — tracked defeats + world evil (never the stage). */
  progress: TrackedProgress
  /** Checked steps of the boss's prep checklist (tc.v1.checklists), when the caller has them. */
  prepDone?: number
}

export interface ReadinessGraph extends ProgressionGraphLike {
  readonly nodes: readonly (ProgressionNodeLike & { name: string })[]
}

export interface ReadinessData {
  weapons: ReadonlyMap<number, Weapon>
  armor: ReadonlyMap<number, ArmorPiece>
  accessories: ReadonlyMap<number, Accessory>
  sets: ReadonlyMap<string, ArmorSet>
  items: ReadonlyMap<number, Item>
  buffs: ReadonlyMap<string, Buff>
  bosses: ReadonlyMap<string, Boss>
  conditions: ReadonlyMap<string, Pick<Condition, 'id' | 'name'>>
  graph: ReadinessGraph
  /** Ammo-type words for an ammoClass slug ("Bullets"). */
  ammoTypeName: (slug: string) => string
  /** meta.json gameVersion (the "not verified for …" lines). */
  gameVersion: string
  /**
   * Names of items with no record in the collections above (e.g. a boss's summoning item — Module:Iteminfo
   * names, item-universe.json). Optional: without it such an item reads "item #<id>".
   */
  nameOf?: (id: number) => string | undefined
}

// --- internals ----------------------------------------------------------------------------------------

const isKnown = (status: string) => status === 'verified' || status === 'editorial'

function known<T>(record: unknown, path: string): T | undefined {
  const view = getField(record, path)
  return isKnown(view.status) ? (view.value as T) : undefined
}

const unverified = (record: unknown, path: string) => getField(record, path).status === 'unverified'

/** Buffs a potion grants only as a side effect (cooldowns): never "buff potions". */
const COOLDOWN_BUFFS: ReadonlySet<string> = new Set(['potion-sickness', 'mana-sickness'])

/** A special whose verified text names a dash (Shield of Cthulhu, Tabi, Master Ninja Gear, …). */
export const DASH_TEXT = /\bdash/i
/**
 * Unmodeled mobility in a special's verified text (Hermes Boots "The wearer can run super fast",
 * Rocket Boots "Allows flight", Cloud in a Bottle "double jump"): real but unquantified, so an unmet
 * need next to one reads "unknown", never "harder" (§1.3). Informational texts ("Displays movement
 * speed…") don't count; wings with a verified flight time are already counted.
 */
export const UNCOUNTED_MOBILITY = {
  dodge: /\b(run|runs|running|super fast|movement speed|move speed)\b/i,
  flight: /\b(flight|fly|flying)\b/i,
  jump: /\b(double jump|jump height|jump speed|jump mobility)\b/i,
} as const
export const INFORMATIONAL = /^\s*displays\b/i

export const itemRef = (id: number) => `i:${id}`
export const bossRef = (id: string) => `boss:${id}`

interface Source {
  /** The loadout entry it comes from; undefined for a set bonus. */
  entry?: LoadoutEntry
  kind: 'armor' | 'set' | 'accessory' | 'potion'
  label: Segment
  ref: string
  /** Known effects (stat + special); empty when Unknown. */
  effects: StatEffect[]
  effectsUnknown: boolean
  /** Verified wing flight time (accessories), and whether it reads Unknown. */
  wingTicks?: number
  wingUnknown?: boolean
  urls: string[]
}

interface SetState {
  kind: 'none' | 'active' | 'inactive' | 'mixed'
  set?: ArmorSet
  variant?: ArmorSet['variants'][number]
  missing?: Segment[][]
}

/** Everything the factors (and Improve My Build) read about the loadout. */
export interface LoadoutContext {
  input: ReadinessInput
  data: ReadinessData
  boss: Boss
  difficulty: Difficulty
  cls: ClassChoice
  ep: ReadonlySet<string>
  memo: Map<string, boolean>
  entries: LoadoutEntry[]
  main?: { entry: LoadoutEntry; weapon: Weapon }
  alt?: { entry: LoadoutEntry; weapon: Weapon }
  pieces: { slot: 'helmet' | 'chest' | 'legs'; entry: LoadoutEntry; piece: ArmorPiece }[]
  accessories: { entry: LoadoutEntry; accessory: Accessory }[]
  ammo: { entry: LoadoutEntry; ammoClass?: string; damage?: number; damageUnknown: boolean }[]
  potions: { entry: LoadoutEntry; item: Item }[]
  summon?: { entry: LoadoutEntry; weapon: Weapon }
  set: SetState
  sources: Source[]
  /** Known effects of every counted source. */
  effects: StatEffect[]
  item: (id: number) => Segment
  bossSeg: Segment
  nodeName: (id: string) => string
}

function slotList(loadout: LoadoutSlots, difficulty: Difficulty): { slot: SlotRef; id: number }[] {
  const out: { slot: SlotRef; id: number }[] = []
  const one = (slot: SlotRef, id: number | null) => {
    if (id !== null) out.push({ slot, id })
  }
  one({ kind: 'mainWeapon' }, loadout.mainWeapon)
  one({ kind: 'altWeapon' }, loadout.altWeapon)
  one({ kind: 'helmet' }, loadout.helmet)
  one({ kind: 'chest' }, loadout.chest)
  one({ kind: 'legs' }, loadout.legs)
  loadout.accessories.slice(0, SLOT_COUNT[difficulty]).forEach((id, index) => one({ kind: 'accessory', index }, id))
  loadout.ammo.forEach((id, index) => one({ kind: 'ammo', index }, id))
  loadout.buffs.forEach((id, index) => one({ kind: 'buff', index }, id))
  one({ kind: 'summon' }, loadout.summon)
  return out
}

const ARMOR_SLOT = { helmet: 'head', chest: 'chest', legs: 'legs' } as const

/** Builds the loadout context: every slot resolved (counted or not, with why), sources, the set bonus. */
export function buildLoadoutContext(input: ReadinessInput, data: ReadinessData, boss: Boss): LoadoutContext {
  const { graph } = data
  const ep = effectiveProgress(graph, input.progress) // tracked only (B69/Q9)
  const memo = new Map<string, boolean>()
  const avail = (record: { gatedBy?: Item['gatedBy'] }) => availabilityOf(record, graph, ep, memo)
  const nameOfItem = (id: number) => data.weapons.get(id)?.name ?? data.armor.get(id)?.name ?? data.accessories.get(id)?.name ?? data.items.get(id)?.name
  const recordOf = (id: number) => data.weapons.get(id) ?? data.armor.get(id) ?? data.accessories.get(id) ?? data.items.get(id)
  const nodeNames = new Map(graph.nodes.map((n) => [n.id, n.name]))
  const nodeName = (id: string) => nodeNames.get(id) ?? id
  const item = (id: number): Segment => {
    const record = recordOf(id)
    return { kind: 'item', id, text: record?.name ?? data.nameOf?.(id) ?? `item #${id}`, availability: record ? avail(record) : UNKNOWN_AVAILABILITY }
  }

  const ctx: LoadoutContext = {
    input,
    data,
    boss,
    difficulty: input.difficulty,
    cls: input.cls,
    ep,
    memo,
    entries: [],
    pieces: [],
    accessories: [],
    ammo: [],
    potions: [],
    set: { kind: 'none' },
    sources: [],
    effects: [],
    item,
    bossSeg: { kind: 'boss', id: boss.id, text: boss.name },
    nodeName,
  }

  const dhIndex = DEMON_HEART_SLOT_INDEX[input.difficulty]
  const dhOpen = isNodeSatisfied(graph, ep, DEMON_HEART_GATE_NODE, memo)
  const seenAccessories = new Set<number>()

  for (const { slot, id } of slotList(input.loadout, input.difficulty)) {
    const record = recordOf(id)
    const entry: LoadoutEntry = {
      slot,
      id,
      name: nameOfItem(id) ?? `Item #${id}`,
      kind: data.weapons.has(id) ? 'weapon' : data.armor.has(id) ? 'armor' : data.accessories.has(id) ? 'accessory' : data.items.has(id) ? 'item' : 'missing',
      counted: false,
      availability: record ? avail(record) : UNKNOWN_AVAILABILITY,
    }
    ctx.entries.push(entry)
    if (!record) {
      entry.reason = 'missing-from-dataset'
      continue
    }
    // Does the record fit the slot?
    let fits: boolean
    switch (slot.kind) {
      case 'mainWeapon':
      case 'altWeapon':
      case 'summon':
        fits = data.weapons.has(id)
        break
      case 'helmet':
      case 'chest':
      case 'legs':
        fits = data.armor.get(id)?.slot === ARMOR_SLOT[slot.kind]
        break
      case 'accessory':
        fits = data.accessories.has(id)
        break
      case 'ammo':
        fits = (data.items.get(id)?.ammoStats ?? data.weapons.get(id)?.ammoStats) !== undefined
        break
      case 'buff':
        fits = data.items.get(id)?.category === 'potion'
        break
    }
    if (!fits) {
      entry.reason = 'wrong-slot'
      continue
    }
    if (slot.kind === 'accessory') {
      if (seenAccessories.has(id)) {
        entry.reason = 'duplicate'
        continue
      }
      seenAccessories.add(id)
      if (slot.index === dhIndex && !dhOpen) {
        entry.reason = 'demon-heart'
        continue
      }
    }
    // Owned → counted, gated or not (SCORING_SPEC §6 "possession asserted"; B94(1)): the gate becomes an info line.
    entry.counted = true
    const label: Segment = { kind: 'item', id, text: entry.name, availability: entry.availability }
    switch (slot.kind) {
      case 'mainWeapon':
        ctx.main = { entry, weapon: data.weapons.get(id) as Weapon }
        break
      case 'altWeapon':
        ctx.alt = { entry, weapon: data.weapons.get(id) as Weapon }
        break
      case 'summon':
        ctx.summon = { entry, weapon: data.weapons.get(id) as Weapon }
        break
      case 'helmet':
      case 'chest':
      case 'legs': {
        const piece = data.armor.get(id) as ArmorPiece
        ctx.pieces.push({ slot: slot.kind, entry, piece })
        const effects = known<StatEffect[]>(piece, 'effects')
        ctx.sources.push({ entry, kind: 'armor', label, ref: itemRef(id), effects: effects ?? [], effectsUnknown: effects === undefined, urls: [piece.wikiUrl] })
        break
      }
      case 'accessory': {
        const accessory = data.accessories.get(id) as Accessory
        ctx.accessories.push({ entry, accessory })
        const effects = known<StatEffect[]>(accessory, 'effects')
        const wingTicks = known<number>(accessory, 'wingStats.flightTimeTicks')
        ctx.sources.push({
          entry,
          kind: 'accessory',
          label,
          ref: itemRef(id),
          effects: effects ?? [],
          effectsUnknown: effects === undefined,
          ...(wingTicks !== undefined ? { wingTicks } : {}),
          ...(unverified(accessory, 'wingStats.flightTimeTicks') ? { wingUnknown: true } : {}),
          urls: [accessory.wikiUrl],
        })
        break
      }
      case 'ammo': {
        const ammoStats = data.items.get(id)?.ammoStats ?? data.weapons.get(id)?.ammoStats
        const holder = data.items.get(id) ?? data.weapons.get(id)
        const damage = known<number>(holder, 'ammoStats.damage')
        ctx.ammo.push({ entry, ammoClass: ammoStats?.ammoClass, ...(damage !== undefined ? { damage } : {}), damageUnknown: unverified(holder, 'ammoStats.damage') })
        break
      }
      case 'buff': {
        const potion = data.items.get(id) as Item
        ctx.potions.push({ entry, item: potion })
        const grants = known<NonNullable<Item['buffGrants']>>(potion, 'buffGrants') ?? []
        const effects: StatEffect[] = []
        let effectsUnknown = unverified(potion, 'buffGrants')
        const urls = [potion.wikiUrl]
        for (const grant of grants) {
          const buff: Buff | undefined = data.buffs.get(grant.buffId)
          if (!buff) {
            effectsUnknown = true
            continue
          }
          const buffEffects = known<StatEffect[]>(buff, 'effects')
          if (buffEffects === undefined) {
            if (!COOLDOWN_BUFFS.has(buff.id)) effectsUnknown = true
            continue
          }
          // A debuff's specials (Potion Sickness) are side notes; its stat effects (Tipsy) still apply.
          effects.push(...buffEffects.filter((e) => e.kind === 'stat' || !buff.isDebuff))
          if (!urls.includes(buff.wikiUrl)) urls.push(buff.wikiUrl)
        }
        ctx.sources.push({ entry, kind: 'potion', label, ref: itemRef(id), effects, effectsUnknown, urls })
        break
      }
    }
  }

  ctx.set = setState(ctx)
  if (ctx.set.kind === 'active' && ctx.set.set && ctx.set.variant) {
    const set = ctx.set.set
    ctx.sources.push({
      kind: 'set',
      label: { kind: 'set', id: set.id, text: set.name },
      ref: `set:${set.id}`,
      effects: [...ctx.set.variant.setBonus],
      effectsUnknown: false,
      urls: [set.wikiUrl],
    })
  }
  ctx.effects = ctx.sources.flatMap((src) => src.effects)
  return ctx
}

/**
 * Every filled slot resolved (counted or not, and why) — for the setup's live slot status, which is
 * shown before a boss is chosen. Resolution never reads the boss.
 */
export function loadoutEntries(input: Omit<ReadinessInput, 'bossId'>, data: ReadinessData): LoadoutEntry[] {
  const noBoss = { id: '', name: '', wikiUrl: '' } as Boss
  return buildLoadoutContext({ ...input, bossId: null }, data, noBoss).entries
}

function setState(ctx: LoadoutContext): SetState {
  const { data } = ctx
  const counted = ctx.pieces
  if (counted.length === 0) return { kind: 'none' }
  const setIdOf = (piece: ArmorPiece) => known<string>(piece, 'setId')
  const bySet = new Map<string, number>()
  for (const p of counted) {
    const id = setIdOf(p.piece)
    if (id) bySet.set(id, (bySet.get(id) ?? 0) + 1)
  }
  const [bestId, bestCount] = [...bySet.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? [undefined, 0]
  const set = bestId ? data.sets.get(bestId) : undefined
  if (!set || bestCount < 2) return counted.length >= 2 ? { kind: 'mixed' } : { kind: 'none' }
  const helmet = counted.find((p) => p.slot === 'helmet')
  const chest = counted.find((p) => p.slot === 'chest')
  const legs = counted.find((p) => p.slot === 'legs')
  const helmetOk = helmet !== undefined && set.pieces.helmets.includes(helmet.piece.id)
  const chestOk = chest?.piece.id === set.pieces.chest
  const legsOk = legs?.piece.id === set.pieces.legs
  if (helmetOk && chestOk && legsOk) {
    return { kind: 'active', set, variant: set.variants.find((v) => v.helmetId === helmet.piece.id) }
  }
  // Name what's missing: a slot holding the set's piece but not counted reads "(not counted)".
  const stored = ctx.input.loadout
  const missing: Segment[][] = []
  const setSeg: Segment = { kind: 'set', id: set.id, text: set.name }
  const notCountedNote = (id: number | null, wanted: (id: number) => boolean) => id !== null && wanted(id) && ctx.entries.some((e) => e.id === id && !e.counted)
  if (!helmetOk) missing.push(notCountedNote(stored.helmet, (id) => set.pieces.helmets.includes(id)) ? s`${ctx.item(stored.helmet as number)} (not counted)` : f4.setMissingHelmet(setSeg))
  if (!chestOk) missing.push(notCountedNote(stored.chest, (id) => id === set.pieces.chest) ? s`${ctx.item(set.pieces.chest)} (not counted)` : [ctx.item(set.pieces.chest)])
  if (!legsOk) missing.push(notCountedNote(stored.legs, (id) => id === set.pieces.legs) ? s`${ctx.item(set.pieces.legs)} (not counted)` : [ctx.item(set.pieces.legs)])
  return { kind: 'inactive', set, missing }
}

// --- line building --------------------------------------------------------------------------------------

class Lines {
  readonly lines: ReadinessLine[] = []
  private readonly prefix: FactorId
  private readonly keys = new Map<string, number>()
  constructor(prefix: FactorId) {
    this.prefix = prefix
  }
  add(key: string, tone: Tone, segments: Segment[], extra: { evidence?: string[]; sources?: string[]; editorial?: boolean } = {}): void {
    const n = this.keys.get(key) ?? 0
    this.keys.set(key, n + 1)
    const evidence = [...new Set([...(extra.evidence ?? []), ...refsIn(segments)])]
    this.lines.push({
      id: `${this.prefix}.${key}${n > 0 ? `.${n + 1}` : ''}`,
      tone,
      segments,
      text: plain(segments),
      evidence,
      sources: [...new Set(extra.sources ?? [])],
      ...(extra.editorial ? { editorial: true as const } : {}),
    })
  }
}

function refsIn(segments: readonly Segment[]): string[] {
  const out: string[] = []
  for (const seg of segments) {
    if (seg.kind === 'item') out.push(itemRef(seg.id))
    else if (seg.kind === 'boss') out.push(bossRef(seg.id))
    else if (seg.kind === 'set') out.push(`set:${seg.id}`)
    else if (seg.kind === 'cond') out.push(`cond:${seg.id}`)
  }
  return out
}

class Inputs {
  used = 0
  total = 0
  readonly unknownInputs: string[] = []
  add(isKnownInput: boolean, words: string): void {
    this.total++
    if (isKnownInput) this.used++
    else this.unknownInputs.push(words)
  }
  get value(): ComputedFrom {
    return { used: this.used, total: this.total, unknownInputs: [...this.unknownInputs] }
  }
}

const statOf = (boss: Boss, difficulty: Difficulty, key: 'hp' | 'defense' | 'contactDamage') => getField(boss, `statsByDifficulty.${difficulty}.${key}`)

// --- F1 Damage fit ---------------------------------------------------------------------------------------

export interface DamageEstimate {
  profile: WeaponProfile
  estDps: number
  effPerHit: number
  perHitWithPct: number
  /** Boss defense applied (undefined = Unknown, computed at 0 and disclosed). */
  bossDefense?: number
  ammo?: { entry: LoadoutEntry; damage: number }
  ammoUnknown?: LoadoutEntry
  /** The weapon fires ammo but none in the loadout fits it. */
  noAmmo: boolean
}

/**
 * F1 estDps = effPerHit × hitsPerSec × speedFactor × critFactorTotal, with
 * effPerHit = max(1, ⌊perHit × (1 + Σdamage%/100) + Σdamage-flat − bossDefense/2⌋). Bonuses count
 * when they apply to the WEAPON's damage class (that is what the game applies them to).
 */
export function estimateDamage(ctx: LoadoutContext, weapon: Weapon, effects: readonly StatEffect[] = ctx.effects): DamageEstimate | { missing: string[] } {
  const profile = weaponProfile(weapon)
  if (!profile.ok) return { missing: profile.missing }
  const wc = profile.damageClass
  let ammo: DamageEstimate['ammo']
  let ammoUnknown: LoadoutEntry | undefined
  if (profile.ammoClass) {
    const fitting = ctx.ammo.filter((a) => a.ammoClass === profile.ammoClass)
    const withDamage = fitting.filter((a) => a.damage !== undefined).sort((a, b) => (b.damage ?? 0) - (a.damage ?? 0) || a.entry.id - b.entry.id)
    if (withDamage[0]) ammo = { entry: withDamage[0].entry, damage: withDamage[0].damage as number }
    else ammoUnknown = fitting.find((a) => a.damageUnknown)?.entry
  }
  const perHit = profile.damage + (ammo?.damage ?? 0)
  const perHitWithPct = perHit * (1 + statTotal(effects, 'damage-pct', wc) / 100) + statTotal(effects, 'damage-flat', wc)
  const defenseView = statOf(ctx.boss, ctx.difficulty, 'defense')
  const bossDefense = isKnown(defenseView.status) ? (defenseView.value as number) : undefined
  const effPerHit = Math.max(MIN_DAMAGE_PER_HIT, Math.floor(perHitWithPct - (bossDefense ?? 0) * NPC_DEFENSE_FACTOR))
  const speedFactor = 1 + (statTotal(effects, 'attack-speed-pct', wc) + (wc === 'melee' ? statTotal(effects, 'melee-speed-pct', 'melee') : 0)) / 100
  const critTotal = profile.critApplies ? 1 + (BASE_CRIT_PCT + profile.critPct + statTotal(effects, 'crit-pct', wc)) / 100 : 1
  return {
    profile,
    estDps: effPerHit * profile.hitsPerSec * speedFactor * critTotal,
    effPerHit,
    perHitWithPct,
    ...(bossDefense !== undefined ? { bossDefense } : {}),
    ...(ammo ? { ammo } : {}),
    ...(ammoUnknown ? { ammoUnknown } : {}),
    noAmmo: profile.ammoClass !== undefined && !ammo && !ammoUnknown,
  }
}

function damageFactor(ctx: LoadoutContext, estimates: ReadinessAnalysis['estimates']): ReadinessFactor {
  const out = new Lines('damage')
  const inputs = new Inputs()
  const { boss, difficulty } = ctx
  const D = DIFFICULTY_WORD[difficulty]
  const stored = ctx.input.loadout.mainWeapon
  const mainEntry = ctx.entries.find((e) => e.slot.kind === 'mainWeapon')
  const sources = [boss.wikiUrl]

  if (stored === null || !mainEntry) {
    out.add('no-weapon', 'info', f1.noWeapon())
  } else if (mainEntry.reason === 'missing-from-dataset') {
    out.add('no-weapon', 'info', f1.missingFromData(stored))
  } else if (!ctx.main) {
    out.add('no-weapon', 'info', f1.weaponNotCounted(ctx.item(stored)))
  } else if (isSummonStaff(ctx.main.weapon)) {
    out.add('summon-staff', 'info', f1.summonStaff(ctx.item(ctx.main.weapon.id)), { sources: [ctx.main.weapon.wikiUrl] })
  } else {
    const weapon = ctx.main.weapon
    const w = ctx.item(weapon.id)
    const result = estimateDamage(ctx, weapon)
    const fieldsNeeded = ['damageClass', 'damage', 'useTimeTicks', 'useAnimationTicks', ...(['melee', 'ranged', 'magic'].includes(String(known<string>(weapon, 'damageClass'))) ? ['critPct'] : [])]
    if ('missing' in result) {
      for (const f of fieldsNeeded) inputs.add(!result.missing.includes(f), `${possessive(weapon.name)} ${FIELD_WORD[f] ?? f}`)
      const words = [...new Set(result.missing.map((f) => FIELD_WORD[f] ?? f))]
      out.add('fields-unknown', 'unknown', f1.fieldsUnknown(w, words.map((word) => s`${word}`)), { sources: [weapon.wikiUrl] })
    } else {
      for (const f of fieldsNeeded) inputs.add(true, `${possessive(weapon.name)} ${FIELD_WORD[f] ?? f}`)
      const defenseKnown = result.bossDefense !== undefined
      inputs.add(defenseKnown, `${possessive(boss.name)} defense on ${D}`)
      const dps = num(`${oneDecimal(result.estDps)}/s`, 'dps')
      if (defenseKnown) out.add('estimate', 'info', f1.estimate(w, dps, ctx.bossSeg, result.bossDefense as number), { sources })
      else {
        out.add('estimate', 'info', f1.estimateNoDefense(w, dps))
        out.add('defense-unknown', 'unknown', f1.defenseUnknown(ctx.bossSeg, D, unknown(`statsByDifficulty.${difficulty}.defense`, boss.wikiUrl)), { sources })
      }
      const hpView = statOf(boss, difficulty, 'hp')
      inputs.add(isKnown(hpView.status), `${possessive(boss.name)} health on ${D}`)
      if (isKnown(hpView.status)) out.add('per-minute', 'info', f1.perMinute(num(whole(result.estDps * 60), 'perMinute'), ctx.bossSeg, whole(hpView.value as number), D), { sources })
      else out.add('hp-unknown', 'unknown', f1.hpUnknown(ctx.bossSeg, D, unknown(`statsByDifficulty.${difficulty}.hp`, boss.wikiUrl)), { sources })
      if (defenseKnown && result.perHitWithPct - (result.bossDefense as number) * NPC_DEFENSE_FACTOR <= MIN_DAMAGE_PER_HIT) {
        out.add('floor', 'harder', f1.floor(ctx.bossSeg, w), { sources: [DEFENSE_RULE_SOURCE.url] })
      }
      if (result.ammo) out.add('ammo', 'info', f1.ammoIncluded(ctx.item(result.ammo.entry.id), result.ammo.damage))
      else if (result.ammoUnknown) out.add('ammo', 'unknown', f1.ammoDamageUnknown(ctx.item(result.ammoUnknown.id), unknown('ammoStats.damage')))
      else if (result.noAmmo) out.add('ammo', 'info', f1.noAmmo(w))
      const behavior = tooltipBehavior(known<string>(weapon, 'behaviorText'))
      if (behavior) out.add('uncounted', 'info', f1.uncounted(w, behavior), { sources: [weapon.wikiUrl] })

      const base: AssumptionText[] = [
        assumptionText.dppBase(DPP_ASSUMPTIONS),
        defenseKnown ? assumptionText.bossDefense(DEFENSE_RULE_SOURCE.url) : assumptionText.bossDefenseUnknown(),
        assumptionText.bonuses(),
        ...(result.ammo ? [assumptionText.ammo(result.ammo.entry.name, result.ammo.damage)] : result.profile.ammoClass ? [assumptionText.noAmmo()] : []),
      ]
      estimates.dps = base
      estimates.perMinute = [...base, assumptionText.minute()]
    }
  }
  return { id: 'damage', title: FACTOR_TITLES.damage, lines: out.lines, computedFrom: inputs.value }
}

/** Behavior lines of a weapon tooltip without its flavor line (schemas `tooltipBehavior`, kept Zod-free here). */
function tooltipBehavior(text: string | undefined): string | undefined {
  if (!text) return undefined
  const lines = text.split('\n').filter((line) => line.trim() !== '' && !/^\s*['‘].*['’]\s*$/.test(line))
  return lines.length > 0 ? lines.join(' ') : undefined
}

// --- F2 Defense & survivability --------------------------------------------------------------------------

export interface DefenseTotal {
  total: number
  unknownPieces: LoadoutEntry[]
}

/** Equipment defense: counted armor pieces' defense (Unknown pieces left out, named) + Σdefense-flat. */
export function defenseTotal(ctx: LoadoutContext, effects: readonly StatEffect[] = ctx.effects): DefenseTotal {
  let total = statTotal(effects, 'defense-flat', 'hybrid')
  const unknownPieces: LoadoutEntry[] = []
  for (const p of ctx.pieces) {
    const d = known<number>(p.piece, 'defense')
    if (d === undefined) unknownPieces.push(p.entry)
    else total += d
  }
  return { total, unknownPieces }
}

function defenseFactor(ctx: LoadoutContext, estimates: ReadinessAnalysis['estimates']): ReadinessFactor {
  const out = new Lines('defense')
  const inputs = new Inputs()
  const { boss, difficulty } = ctx
  const D = DIFFICULTY_WORD[difficulty]
  const f = PLAYER_DEFENSE_FACTOR[difficulty]
  const { total, unknownPieces } = defenseTotal(ctx)
  const rule = [DEFENSE_RULE_SOURCE.url]
  inputs.add(unknownPieces.length === 0, unknownPieces.length === 0 ? 'your armor’s defense' : `${unknownPieces.map((e) => e.name).join(', ')} defense`)
  const blockedAssumptions = [assumptionText.playerDefense(DEFENSE_RULE_SOURCE.url), assumptionText.equipmentOnly()]
  if (total > 0) {
    out.add('defense', 'info', f2.defense(total, num(whole(total * f), 'blocked'), D, f), { sources: rule })
    estimates.blocked = blockedAssumptions
  } else if (unknownPieces.length === 0) {
    out.add('no-defense', 'harder', f2.noDefense())
  }
  for (const entry of unknownPieces) out.add('piece-unknown', 'unknown', f2.pieceDefenseUnknown(ctx.item(entry.id), unknown('defense')))

  const contact = statOf(boss, difficulty, 'contactDamage')
  if (contact.status !== 'not-applicable') {
    inputs.add(isKnown(contact.status), `${possessive(boss.name)} contact damage on ${D}`)
    if (isKnown(contact.status)) {
      const cd = contact.value as number
      const after = Math.max(MIN_DAMAGE_PER_HIT, Math.floor(cd - total * f))
      out.add('contact', 'info', f2.contact(ctx.bossSeg, D, cd, num(whole(after), 'contact')), { sources: [boss.wikiUrl, ...rule] })
      estimates.contact = [...blockedAssumptions, assumptionText.rounding(DEFENSE_RULE_SOURCE.url)]
    } else {
      out.add('contact-unknown', 'unknown', f2.contactUnknown(ctx.bossSeg, D, ctx.data.gameVersion, unknown(`statsByDifficulty.${difficulty}.contactDamage`, boss.wikiUrl)), { sources: [boss.wikiUrl] })
    }
  }
  const dr = statTotal(ctx.effects, 'damage-reduction-pct', 'hybrid')
  if (dr > 0) out.add('damage-reduction', 'info', f2.damageReduction(dr))
  const extras: string[] = []
  const regen = statTotal(ctx.effects, 'life-regen', 'hybrid')
  const life = statTotal(ctx.effects, 'max-life-flat', 'hybrid')
  if (regen !== 0) extras.push(effectPhrase({ kind: 'stat', stat: 'life-regen', value: regen }))
  if (life !== 0) extras.push(effectPhrase({ kind: 'stat', stat: 'max-life-flat', value: life }))
  if (extras.length > 0) out.add('extras', 'info', f2.extras(extras))
  out.add('life', 'info', f2.lifeNotTracked())
  return { id: 'defense', title: FACTOR_TITLES.defense, lines: out.lines, computedFrom: inputs.value }
}

// --- F3 Mobility vs. attack patterns -----------------------------------------------------------------------

export interface Mobility {
  moveSpeed: number
  /** Best verified flight time and the item giving it. */
  flight?: { ticks: number; entry: LoadoutEntry }
  /** Counted accessories whose flight time reads Unknown. */
  flightUnknown: LoadoutEntry[]
  /** A counted source whose verified special names a dash. */
  dash?: Segment
  /** The first uncounted mobility special per need (see UNCOUNTED_MOBILITY). */
  uncounted: { dodge?: UncountedSpecial; flight?: UncountedSpecial; reposition?: UncountedSpecial }
}

export interface UncountedSpecial {
  label: Segment
  text: string
  sourceUrl: string
}

export function mobilityOf(ctx: LoadoutContext): Mobility {
  const moveSpeed = statTotal(ctx.effects, 'move-speed-pct', 'hybrid')
  let flight: Mobility['flight']
  const flightUnknown: LoadoutEntry[] = []
  let dash: Segment | undefined
  const uncounted: Mobility['uncounted'] = {}
  for (const src of ctx.sources) {
    const effectTicks = statTotal(src.effects, 'flight-time-ticks', 'hybrid')
    const ticks = Math.max(src.wingTicks ?? 0, effectTicks)
    if (ticks > 0 && src.entry && (!flight || ticks > flight.ticks)) flight = { ticks, entry: src.entry }
    if (src.wingUnknown && src.entry) flightUnknown.push(src.entry)
    for (const e of src.effects) {
      if (e.kind !== 'special' || INFORMATIONAL.test(e.text)) continue
      if (!dash && DASH_TEXT.test(e.text)) dash = src.label
      const found = { label: src.label, text: e.text, sourceUrl: e.sourceUrl }
      const flightText = UNCOUNTED_MOBILITY.flight.test(e.text) && src.wingTicks === undefined && effectTicks === 0
      if (!uncounted.dodge && UNCOUNTED_MOBILITY.dodge.test(e.text)) uncounted.dodge = found
      if (!uncounted.flight && flightText) uncounted.flight = found
      if (!uncounted.reposition && (UNCOUNTED_MOBILITY.dodge.test(e.text) || flightText || UNCOUNTED_MOBILITY.jump.test(e.text))) uncounted.reposition = found
    }
  }
  return { moveSpeed, ...(flight ? { flight } : {}), flightUnknown, ...(dash ? { dash } : {}), uncounted }
}

function mobilityFactor(ctx: LoadoutContext): ReadinessFactor {
  const out = new Lines('mobility')
  const inputs = new Inputs()
  const { boss } = ctx
  const B = ctx.bossSeg
  const cite = { sources: [boss.wikiUrl], evidence: [bossRef(boss.id)], editorial: true }
  const tagsView = getField(boss, 'attackPatternTags')
  inputs.add(isKnown(tagsView.status) || tagsView.status === 'not-applicable', `${possessive(boss.name)} attack patterns`)
  if (tagsView.status === 'unverified') {
    out.add('tags-unknown', 'unknown', f3.tagsUnknown(B, unknown('attackPatternTags', boss.wikiUrl)), { sources: [boss.wikiUrl] })
    return { id: 'mobility', title: FACTOR_TITLES.mobility, lines: out.lines, computedFrom: inputs.value }
  }
  const tags = isKnown(tagsView.status) ? (tagsView.value as AttackPatternTag[]) : []
  const mob = mobilityOf(ctx)
  for (const e of mob.flightUnknown) inputs.add(false, `${possessive(e.name)} flight time`)
  const flightSecs = (ticks: number) => seconds(ticks)
  const threshold = seconds(FLIGHT_HELPS_TICKS)
  const speedMet = mob.moveSpeed >= MOVE_SPEED_HELPS_PCT
  const flightMet = (mob.flight?.ticks ?? 0) >= FLIGHT_HELPS_TICKS
  for (const tag of tags) {
    const need = TAG_NEEDS[tag]
    switch (need) {
      case 'burst-dodge': {
        const special = mob.uncounted.dodge
        if (mob.dash) out.add(tag, 'easier', f3.dodgeByDash(B, tag, mob.dash), cite)
        else if (speedMet) out.add(tag, 'easier', f3.dodgeBySpeed(B, tag, mob.moveSpeed, MOVE_SPEED_HELPS_PCT), cite)
        else if (special) out.add(tag, 'unknown', f3.dodgeUncounted(B, tag, mob.moveSpeed, special.label, special.text), { ...cite, sources: [boss.wikiUrl, special.sourceUrl] })
        else out.add(tag, 'harder', f3.dodgeShort(B, tag, mob.moveSpeed, MOVE_SPEED_HELPS_PCT), cite)
        break
      }
      case 'flight': {
        const special = mob.uncounted.flight
        if (mob.flight && flightMet) out.add(tag, 'easier', f3.flightMet(B, ctx.item(mob.flight.entry.id), flightSecs(mob.flight.ticks), threshold), cite)
        else if (mob.flightUnknown[0]) out.add(tag, 'unknown', f3.flightUnknown(B, tag, ctx.item(mob.flightUnknown[0].id), unknown('wingStats.flightTimeTicks')), cite)
        else if (special) out.add(tag, 'unknown', f3.flightUncounted(B, special.label, special.text), { ...cite, sources: [boss.wikiUrl, special.sourceUrl] })
        else if (mob.flight) out.add(tag, 'harder', f3.flightShort(B, ctx.item(mob.flight.entry.id), flightSecs(mob.flight.ticks), threshold), cite)
        else out.add(tag, 'harder', f3.flightNone(B), cite)
        break
      }
      case 'repositioning': {
        const means: Segment[][] = []
        if (mob.dash) means.push(f3.meansDash(mob.dash))
        if (speedMet) means.push(f3.meansSpeed(mob.moveSpeed))
        if (mob.flight && flightMet) means.push(f3.meansFlight(ctx.item(mob.flight.entry.id), flightSecs(mob.flight.ticks)))
        const special = mob.uncounted.reposition
        if (means.length > 0) out.add(tag, 'easier', f3.repositionMet(B, tag, means), cite)
        else if (mob.flightUnknown[0]) out.add(tag, 'unknown', f3.flightUnknown(B, tag, ctx.item(mob.flightUnknown[0].id), unknown('wingStats.flightTimeTicks')), cite)
        else if (special) out.add(tag, 'unknown', f3.repositionUncounted(B, tag, mob.moveSpeed, special.label, special.text), { ...cite, sources: [boss.wikiUrl, special.sourceUrl] })
        else out.add(tag, 'harder', f3.repositionShort(B, tag, mob.moveSpeed, MOVE_SPEED_HELPS_PCT, threshold), cite)
        break
      }
      case 'platform':
      case 'open-ground':
      case 'reaction':
        out.add(tag, 'info', f3.noGearStat(B, tag), cite)
        break
      case 'positioning':
        out.add(tag, 'info', f3.despawn(B), cite)
        break
      case 'endurance':
        out.add(tag, 'info', f3.phases(B), cite)
        break
      case 'enrage':
        out.add(tag, 'harder', f3.enrage(B), cite)
        break
      case 'crowd':
        out.add(tag, 'info', f3.adds(B), cite)
        break
      case 'debuffs':
        out.add(tag, 'info', f3.debuffs(B), cite)
        break
      case 'contact':
        out.add(tag, 'info', f3.contact(B), cite)
        break
    }
  }
  return { id: 'mobility', title: FACTOR_TITLES.mobility, lines: out.lines, computedFrom: inputs.value }
}

// --- F4 Synergy ---------------------------------------------------------------------------------------------

export interface SynergyPoints {
  matched: number
  mismatched: number
}

/** §5.1(5): class-relevant vs mismatched numeric points over the counted sources (wing flight included). */
export function synergyPoints(ctx: LoadoutContext): SynergyPoints {
  let matched = 0
  let mismatched = 0
  for (const src of ctx.sources) {
    const effects = src.effects.filter((e) => e.kind === 'stat' && !(e.stat === 'flight-time-ticks' && src.wingTicks !== undefined))
    for (const e of effects) {
      const pts = Math.abs(sumPoints(effectPoints(e, ctx.cls)))
      if (appliesTo(e, ctx.cls)) matched += pts
      else mismatched += pts
    }
    if (src.wingTicks !== undefined) {
      // max of wingStats and the effect (§2.3), unscoped → matched
      matched += 0.1 * Math.max(src.wingTicks, statTotal(src.effects, 'flight-time-ticks', 'hybrid'))
    }
  }
  return { matched, mismatched }
}

function synergyFactor(ctx: LoadoutContext, estimates: ReadinessAnalysis['estimates']): ReadinessFactor {
  const out = new Lines('synergy')
  const inputs = new Inputs()
  const C = ctx.cls
  const classWord = CLASS_WORD[C]
  for (const held of [ctx.main, ctx.alt]) {
    if (!held) continue
    const w = ctx.item(held.weapon.id)
    const wc = known<string>(held.weapon, 'damageClass')
    inputs.add(wc !== undefined, `${possessive(held.weapon.name)} damage class`)
    if (wc === undefined) out.add('weapon-class', 'unknown', f4.weaponClassUnknown(w, unknown('damageClass', held.weapon.wikiUrl)))
    else if (wc === 'other') out.add('weapon-class', 'info', f4.weaponClassless(w))
    else if (C === 'hybrid') out.add('weapon-class', 'info', f4.weaponHybrid(w, CLASS_WORD[wc as ClassChoice]))
    else if (wc === C) out.add('weapon-class', 'info', f4.weaponMatch(w, classWord))
    else out.add('weapon-class', 'harder', f4.weaponMismatch(w, CLASS_WORD[wc as ClassChoice], classWord))
  }
  const set = ctx.set
  if (set.kind === 'active' && set.set && set.variant) {
    const kinds = new Set(set.variant.setBonus.map((e) => e.kind))
    const counted = kinds.has('special') ? (kinds.has('stat') ? 'some' : 'none') : 'all'
    out.add('set', 'easier', f4.setActive({ kind: 'set', id: set.set.id, text: set.set.name }, set.variant.setBonusText.replace(/\n/g, ' · '), counted), { sources: [set.set.wikiUrl] })
  } else if (set.kind === 'inactive' && set.set && set.missing) {
    const missing = set.missing
    out.add('set', 'harder', f4.setInactive({ kind: 'set', id: set.set.id, text: set.set.name }, missingList(missing), missing.length), { sources: [set.set.wikiUrl] })
  } else if (set.kind === 'mixed') {
    out.add('set', 'info', f4.setMixed())
  }
  for (const src of ctx.sources) {
    if (src.kind === 'potion') continue // potions read under Preparation
    inputs.add(!src.effectsUnknown, `${possessive(plain([src.label]))} effects`)
    if (src.effectsUnknown) {
      out.add('effects-unknown', 'unknown', f4.effectsUnknown(src.label, unknown('effects')), { sources: src.urls })
      continue
    }
    if (C !== 'hybrid') {
      const wasted = src.effects.filter((e): e is Extract<StatEffect, { kind: 'stat' }> => e.kind === 'stat' && !appliesTo(e, C))
      if (wasted.length > 0) out.add('mismatch', 'harder', f4.mismatch(src.label, wasted.map((e) => effectPhrase(e)), classWord), { sources: src.urls })
    }
  }
  const pts = synergyPoints(ctx)
  const totalPts = pts.matched + pts.mismatched
  if (totalPts > 0) {
    out.add('points', 'info', f4.points(num(whole(pts.matched), 'synergy'), whole(totalPts), classWord))
    estimates.synergy = [assumptionText.pointWeights(SCORING_CONSTANTS_VERSION), assumptionText.pointsUncounted(), assumptionText.pointsMatching()]
  } else if (ctx.sources.some((src) => src.kind !== 'potion')) {
    out.add('points', 'info', f4.noPoints())
  }
  for (const src of ctx.sources) {
    if (src.kind === 'set') continue // the set line quotes its bonus already
    const specials = src.effects.filter((e): e is Extract<StatEffect, { kind: 'special' }> => e.kind === 'special')
    if (specials.length === 0) continue
    out.add('uncounted', 'info', f4.uncounted(src.label, specials.map((e) => e.text)), { sources: [...new Set(specials.map((e) => e.sourceUrl))] })
  }
  for (const { accessory } of ctx.accessories) {
    const into = known<number[]>(accessory, 'upgradesTo') ?? []
    if (into.length > 0) out.add('upgrades', 'info', f4.upgrades(ctx.item(accessory.id), into.map((id) => [ctx.item(id)])), { sources: [accessory.wikiUrl] })
  }
  return { id: 'synergy', title: FACTOR_TITLES.synergy, lines: out.lines, computedFrom: inputs.value }
}

/** "A, B and C" over pre-built segments. */
function missingList(items: readonly Segment[][]): Segment[] {
  const out: Segment[] = []
  items.forEach((item, i) => {
    if (i > 0) out.push({ kind: 'text', text: i === items.length - 1 ? ' and ' : ', ' })
    out.push(...item)
  })
  return out
}

// --- F5 Preparation -----------------------------------------------------------------------------------------

function preparationFactor(ctx: LoadoutContext): ReadinessFactor {
  const out = new Lines('preparation')
  const inputs = new Inputs()
  const { boss, data } = ctx
  const B = ctx.bossSeg

  // Ammo (harder if a weapon's ammo is missing)
  const usedAmmo = new Set<number>()
  for (const held of [ctx.main, ctx.alt]) {
    if (!held) continue
    const w = ctx.item(held.weapon.id)
    const view = getField(held.weapon, 'ammoClass')
    if (view.status === 'unverified') {
      inputs.add(false, `${possessive(held.weapon.name)} ammo type`)
      out.add('ammo', 'unknown', f5.ammoTypeUnknown(w, unknown('ammoClass', held.weapon.wikiUrl)))
      continue
    }
    if (!isKnown(view.status)) continue
    inputs.add(true, `${possessive(held.weapon.name)} ammo type`)
    const fitting = ctx.ammo.filter((a) => a.ammoClass === view.value)
    fitting.forEach((a) => usedAmmo.add(a.entry.id))
    if (fitting[0]) out.add('ammo', 'info', f5.ammoFits(ctx.item(fitting[0].entry.id), w))
    else out.add('ammo', 'harder', f5.ammoMissing(w, data.ammoTypeName(view.value as string)))
  }
  for (const a of ctx.ammo) if (!usedAmmo.has(a.entry.id)) out.add('ammo-unused', 'info', f5.ammoUnused(ctx.item(a.entry.id)))

  // Buff potions
  const potionSources = new Map(ctx.sources.filter((src) => src.kind === 'potion' && src.entry).map((src) => [src.entry?.id as number, src]))
  const buffPotions = ctx.potions.filter((p) => (known<NonNullable<Item['buffGrants']>>(p.item, 'buffGrants') ?? []).some((g) => !COOLDOWN_BUFFS.has(g.buffId)))
  const unknownBuffs = buffPotions.filter((p) => potionSources.get(p.entry.id)?.effectsUnknown)
  inputs.add(unknownBuffs.length === 0, unknownBuffs.length === 0 ? 'your potions’ buffs' : `${unknownBuffs.map((p) => p.entry.name).join(', ')} buffs`)
  if (buffPotions.length === 0) out.add('buffs', 'harder', f5.noBuffs())
  else {
    const entries = buffPotions
      .filter((p) => !potionSources.get(p.entry.id)?.effectsUnknown)
      .map((p) => {
        const stats = (potionSources.get(p.entry.id)?.effects ?? []).filter((e): e is Extract<StatEffect, { kind: 'stat' }> => e.kind === 'stat')
        return f5.buffEntry(ctx.item(p.entry.id), stats.map((e) => effectPhrase(e)))
      })
    if (entries.length > 0) out.add('buffs', 'easier', f5.buffs(entries), { sources: buffPotions.flatMap((p) => potionSources.get(p.entry.id)?.urls ?? []) })
    for (const p of unknownBuffs) out.add('buffs-unknown', 'unknown', f5.buffEffectsUnknown(ctx.item(p.entry.id), unknown('effects')))
  }

  // Healing
  const healing = ctx.potions.filter((p) => known<number>(p.item, 'healLife') !== undefined)
  const healingUnknown = ctx.potions.filter((p) => unverified(p.item, 'healLife'))
  inputs.add(healingUnknown.length === 0, healingUnknown.length === 0 ? 'your healing potions' : `${healingUnknown.map((p) => p.entry.name).join(', ')} healing`)
  if (healing.length > 0) out.add('healing', 'easier', f5.healing(healing.map((p) => f5.healingEntry(ctx.item(p.entry.id), known<number>(p.item, 'healLife') as number))), { sources: healing.map((p) => p.item.wikiUrl) })
  else if (healingUnknown.length === 0) out.add('healing', 'harder', f5.noHealing())
  for (const p of healingUnknown) out.add('healing-unknown', 'unknown', f5.healingUnknown(ctx.item(p.entry.id), unknown('healLife', p.item.wikiUrl)))
  for (const p of ctx.potions) {
    const mana = known<number>(p.item, 'healMana')
    if (mana !== undefined) out.add('mana', 'info', f5.mana(ctx.item(p.entry.id), mana), { sources: [p.item.wikiUrl] })
  }

  // Summon slot
  if (ctx.summon) out.add('summon-slot', 'info', f5.summonSlot(ctx.item(ctx.summon.weapon.id)))
  else if (ctx.cls === 'summon' && ctx.input.loadout.summon === null) out.add('summon-slot', 'info', f5.summonEmpty())

  // How the boss is summoned (with provenance) and its condition chips
  const summonText = getField(boss, 'summon.text')
  const summonSource = boss.summon.sourceUrl ?? boss.wikiUrl
  if (summonText.status !== 'not-applicable') {
    inputs.add(isKnown(summonText.status), f5.summonInput(B))
    if (isKnown(summonText.status)) {
      out.add('boss-summon', 'info', f5.bossSummon(B, boss.summon.items.map((id) => [ctx.item(id)]), String(summonText.value)), { sources: [summonSource] })
    } else {
      out.add('boss-summon', 'unknown', f5.bossSummonUnknown(B, unknown('summon.text', boss.wikiUrl)), { sources: [boss.wikiUrl] })
    }
  }
  if (boss.summon.conditions.length > 0) {
    const chips: Segment[] = boss.summon.conditions.map((id) => ({ kind: 'cond', id, text: data.conditions.get(id)?.name ?? id }))
    out.add('boss-conditions', 'info', withChipSeparators(f5.bossConditions(B, chips)), { sources: [summonSource] })
  }

  // The boss page's prep checklist
  const prep = getField(boss, 'prepChecklist')
  if (prep.status !== 'not-applicable') {
    inputs.add(isKnown(prep.status), `${possessive(boss.name)} prep checklist`)
    if (isKnown(prep.status)) out.add('prep', 'info', f5.prep(B, (prep.value as unknown[]).length, ctx.input.prepDone), { sources: [boss.wikiUrl] })
    else out.add('prep', 'unknown', f5.prepUnknown(B, unknown('prepChecklist', boss.wikiUrl)), { sources: [boss.wikiUrl] })
  }
  return { id: 'preparation', title: FACTOR_TITLES.preparation, lines: out.lines, computedFrom: inputs.value }
}

/** Condition chips render as their own elements; the text stays readable ("A, B"). */
function withChipSeparators(segments: Segment[]): Segment[] {
  const out: Segment[] = []
  segments.forEach((seg, i) => {
    out.push(seg)
    if (seg.kind === 'cond' && segments[i + 1]?.kind === 'cond') out.push({ kind: 'text', text: ', ' })
  })
  return out
}

// --- owned items whose usual sources are gated (B94(1)) ------------------------------------------------------

/** The factor whose lines first discuss a slot: where its owned-but-gated info line goes. */
const OWNED_LINE_FACTOR: Readonly<Record<SlotRef['kind'], FactorId>> = {
  mainWeapon: 'damage',
  altWeapon: 'synergy',
  helmet: 'defense',
  chest: 'defense',
  legs: 'defense',
  accessory: 'synergy',
  ammo: 'preparation',
  buff: 'preparation',
  summon: 'preparation',
}

/**
 * Info lines for counted items whose verified gating names bosses not marked defeated: one per factor
 * and exact set of bosses, each item named once (its first slot), in loadout order. Honest and
 * non-blocking — never a tone that moves the summary.
 */
function ownedGatedLines(ctx: LoadoutContext): Map<FactorId, ReadinessLine[]> {
  const groups = new Map<string, { factor: FactorId; missing: string[]; entries: LoadoutEntry[] }>()
  const named = new Set<number>()
  for (const entry of ctx.entries) {
    if (!entry.counted || entry.availability.status !== 'gated' || named.has(entry.id)) continue
    named.add(entry.id)
    const factor = OWNED_LINE_FACTOR[entry.slot.kind]
    const key = `${factor}|${entry.availability.missing.join('+')}`
    const group = groups.get(key) ?? { factor, missing: entry.availability.missing, entries: [] }
    group.entries.push(entry)
    groups.set(key, group)
  }
  const out = new Map<FactorId, Lines>()
  for (const { factor, missing, entries } of groups.values()) {
    const lines = out.get(factor) ?? new Lines(factor)
    // the bosses are named in the sentence: the items carry no availability, so no badge repeats them
    const items = entries.map((e) => [{ kind: 'item', id: e.id, text: e.name } as Segment])
    const gates = missing.map((id) => [{ kind: 'boss', id, text: ctx.nodeName(id) } as Segment])
    const urls = entries.flatMap((e) => {
      const record = ctx.data.weapons.get(e.id) ?? ctx.data.armor.get(e.id) ?? ctx.data.accessories.get(e.id) ?? ctx.data.items.get(e.id)
      return record ? [record.wikiUrl] : []
    })
    lines.add('owned-gated', 'info', owned.gated(items, gates), { sources: urls })
    out.set(factor, lines)
  }
  return new Map([...out].map(([factor, lines]) => [factor, lines.lines]))
}

// --- not counted ------------------------------------------------------------------------------------------

function notCountedLine(ctx: LoadoutContext, entry: LoadoutEntry): NotCountedLine | undefined {
  if (entry.counted) return undefined
  const seg = ctx.item(entry.id)
  let segments: Segment[]
  switch (entry.reason) {
    case 'demon-heart':
      segments = notCountedCopy.demonHeart(seg, { kind: 'boss', id: DEMON_HEART_GATE_NODE, text: ctx.nodeName(DEMON_HEART_GATE_NODE) })
      break
    case 'duplicate':
      segments = notCountedCopy.duplicate(seg)
      break
    case 'wrong-slot':
      segments = notCountedCopy.wrongSlot(seg)
      break
    case 'missing-from-dataset':
      segments = notCountedCopy.missingFromData(entry.id)
      break
    default:
      return undefined
  }
  return { entry, segments, text: plain(segments) }
}

// --- analysis -------------------------------------------------------------------------------------------------

/** analyzeReadiness (SCORING_SPEC §7): degrade, never throw on data; no boss → { error: 'no-boss' }. */
export function analyzeReadiness(input: ReadinessInput, data: ReadinessData): ReadinessResult {
  const boss = input.bossId ? data.bosses.get(input.bossId) : undefined
  if (!boss) return { error: 'no-boss' }
  const ctx = buildLoadoutContext(input, data, boss)
  const estimates: ReadinessAnalysis['estimates'] = {}
  const factors = [damageFactor(ctx, estimates), defenseFactor(ctx, estimates), mobilityFactor(ctx), synergyFactor(ctx, estimates), preparationFactor(ctx)]
  const ownedGated = ownedGatedLines(ctx)
  for (const f of factors) f.lines.push(...(ownedGated.get(f.id) ?? []))
  const pick =(tone: Tone) => factors.flatMap((f) => f.lines.filter((l) => l.tone === tone).map((line) => ({ factor: f.id, line })))
  const computedFrom = factors.reduce<ComputedFrom>(
    (acc, f) => ({ used: acc.used + f.computedFrom.used, total: acc.total + f.computedFrom.total, unknownInputs: [...acc.unknownInputs, ...f.computedFrom.unknownInputs] }),
    { used: 0, total: 0, unknownInputs: [] },
  )
  const dhIndex = DEMON_HEART_SLOT_INDEX[input.difficulty]
  const dhGateMet = isNodeSatisfied(data.graph, ctx.ep, DEMON_HEART_GATE_NODE, ctx.memo)
  const dhCounted = dhIndex !== null && ctx.entries.some((e) => e.slot.kind === 'accessory' && e.slot.index === dhIndex && e.counted)
  const assumptions: AssumptionText[] = [analysisAssumption.trackedOnly()]
  if (ctx.entries.some((e) => e.counted && e.availability.status === 'gated')) assumptions.push(analysisAssumption.ownedGated())
  if (ctx.entries.some((e) => e.reason === 'demon-heart')) assumptions.push(analysisAssumption.demonHeartClosed())
  if (ctx.entries.some((e) => e.counted && e.availability.status === 'unknown')) assumptions.push(analysisAssumption.ownedUnknown())
  if (ctx.potions.length > 0) assumptions.push(analysisAssumption.potionsActive())
  if (dhCounted) assumptions.push(analysisAssumption.demonHeart(DEMON_HEART_SOURCE))
  return {
    bossId: boss.id,
    difficulty: input.difficulty,
    cls: input.cls,
    constantsVersion: SCORING_CONSTANTS_VERSION,
    entries: ctx.entries,
    notCounted: ctx.entries.map((e) => notCountedLine(ctx, e)).filter((l): l is NotCountedLine => l !== undefined),
    factors,
    summary: { easier: pick('easier'), harder: pick('harder') },
    computedFrom,
    estimates,
    assumptions,
    ...(dhIndex !== null ? { demonHeart: { slotIndex: dhIndex, gateMet: dhGateMet } } : {}),
    inactiveSlotItems: input.loadout.accessories.slice(SLOT_COUNT[input.difficulty]).filter((id) => id !== null).length,
  }
}
