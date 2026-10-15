/**
 * Improve My Build (SCORING_SPEC §6 "Improve My Build", §3, §4.6; PRD P5-S7 AC1/AC3; PRD §9 Feature A
 * AC2; AMENDMENTS-014 B69/Q9). Pure TypeScript over the same loadout context as the analysis.
 *
 * - Pools per §3 with EP = TRACKED defeats only. Availability "yes" → obtainable now; "gated" →
 *   grouped under the exact bosses still to defeat (GatedSection); "unknown" → never suggested,
 *   counted in the disclosure. Required stats Unknown → excluded, counted.
 * - Target-boss cap: items gated by the target boss or any required-gate descendant are omitted
 *   entirely (counted).
 * - Other world evil (AMENDMENTS-015 B97a): with a world evil CHOSEN, items still behind the other
 *   world's evil boss are out of the modeled world (the map dims that fork) — omitted, counted with
 *   that boss named. A mark of that boss never counts there (progress `countsInWorld`), so this holds
 *   whether or not it is marked. Under "Both" nothing is omitted for this.
 * - A suggestion must STRICTLY improve its targeted component over what it replaces: the main weapon
 *   on F1's estimated damage against this boss; an armor set on armor defense; an accessory on
 *   class-relevant STAT_POINTS (filling an empty slot, or replacing the counted accessory with the
 *   fewest points — never one whose effects include something unmodeled, since its value isn't fully
 *   counted); a buff potion on class-relevant points; a healing potion (only when none is in the
 *   loadout) on health restored.
 * - Class choice and difficulty apply (P5-S7 AC3): class-eligible pools; accessory slots =
 *   SLOT_COUNT[difficulty], the Demon Heart slot usable only once the Wall of Flesh is marked defeated.
 * - Ranking: §4.6 total order. Gated ones rank first by how far their gate sits from the tracked
 *   frontier, nearest first (AMENDMENTS-015 B94(5); ties keep the §4.6 order), so the cut drops the
 *   farthest gates. Top 3 obtainable-now and top 3 gated per group; the gated ones past the cut are
 *   counted in the disclosure.
 */
import type { Accessory, ArmorPiece, Item, StatEffect, Weapon } from '../schemas'
import { getField } from '../schemas/getField'
import { comboName, setCombos } from '../schemas/setCombos'
import { availabilityOf, compareRankable, gateCount, gateDistance, isCappedByTarget, targetCapNodes, type Availability } from './candidates'
import { DEMON_HEART_GATE_NODE, DEMON_HEART_SLOT_INDEX, DPP_ASSUMPTIONS, DEFENSE_RULE_SOURCE, SCORING_CONSTANTS_VERSION, SLOT_COUNT } from './constants'
import { countsInWorld, isNodeSatisfied } from './progress'
import { applicablePoints, isSummonStaff, statTotal, sumPoints, weaponProfile } from './proxies'
import { buildLoadoutContext, estimateDamage, itemRef, type LoadoutContext, type ReadinessData, type ReadinessInput } from './readiness'
import { assumptionText, CLASS_WORD, effectPhrase, improve as copy, num, oneDecimal, plain, whole, type AssumptionText, type EstimateKey, type Segment } from './readinessCopy'

export const SUGGESTIONS_PER_GROUP = 3

export interface PoolDisclosure {
  /** Candidates of the right kind and class, before availability. */
  considered: number
  unknown: number
  unverified: number
  capped: number
  /** Behind the other world's evil boss, with a world evil chosen (B97a). */
  otherWorld: number
  /** Gated upgrades past the per-group cut (the farther gates; B94(5)). */
  gatedNotListed: number
}

export interface Suggestion {
  /** `i:<id>` or `set:<slug>:<combination key>` (the helmet id; `<helmet>.<chest>` for a set with several chests). */
  key: string
  kind: 'weapon' | 'armor-set' | 'accessory' | 'potion'
  /** The item to open (for a set: its helmet). */
  id: number
  setId?: string
  name: string
  /** A set's pieces (helmet, chest, legs — no legs for a set without a legs piece). */
  pieces?: number[]
  /** The targeted component with this suggestion, and with what it replaces. */
  value: number
  current: number
  availability: Availability
  rationale: Segment[]
  text: string
  replaces?: { id: number; name: string }
}

export interface GatedSuggestionGroup {
  /** The exact boss nodes still to defeat (sorted) — the GatedSection's "After you defeat …". */
  missing: string[]
  names: string[]
  items: Suggestion[]
}

export type SuggestionTarget = 'weapon' | 'armor' | 'accessory' | 'potion' | 'healing'

export interface SuggestionGroup {
  target: SuggestionTarget
  title: string
  basis: Segment[]
  obtainable: Suggestion[]
  gated: GatedSuggestionGroup[]
  disclosure: PoolDisclosure
  disclosureText: Segment[]
  /** Why nothing is obtainable now (empty obtainable list). */
  empty?: Segment[]
}

export interface ImproveResult {
  groups: SuggestionGroup[]
  estimates: Partial<Record<EstimateKey, AssumptionText[]>>
}

interface Candidate {
  suggestion: Omit<Suggestion, 'rationale' | 'text'> & { rationale: Segment[] }
  gateCount: number
  rarity: Weapon['rarity']
}

const isKnown = (status: string) => status === 'verified' || status === 'editorial'
function known<T>(record: unknown, path: string): T | undefined {
  const view = getField(record, path)
  return isKnown(view.status) ? (view.value as T) : undefined
}

const COOLDOWN_BUFFS: ReadonlySet<string> = new Set(['potion-sickness', 'mana-sickness'])

/** A node the chosen world evil leaves out — the other world's evil boss (B97a); none under "Both". */
function isOtherWorld(ctx: LoadoutContext, nodeId: string): boolean {
  const worldEvil = ctx.input.progress.worldEvil
  if (worldEvil === null) return false
  const node = ctx.data.graph.nodes.find((n) => n.id === nodeId)
  return node !== undefined && !countsInWorld(node, worldEvil)
}

/** Collects candidates into obtainable / gated, with the disclosure counts. */
class Pool {
  readonly disclosure: PoolDisclosure = { considered: 0, unknown: 0, unverified: 0, capped: 0, otherWorld: 0, gatedNotListed: 0 }
  /** The other world's evil bosses the omitted items need (named in the disclosure). */
  readonly otherWorldBosses = new Set<string>()
  private readonly yes: Candidate[] = []
  private readonly gated: Candidate[] = []
  private readonly cap: ReadonlySet<string>
  constructor(cap: ReadonlySet<string>) {
    this.cap = cap
  }
  /** Availability gate for one candidate (or a set's pieces): returns its availability, or undefined when it can't be suggested. */
  admit(records: readonly { gatedBy?: Item['gatedBy'] }[], ctx: LoadoutContext): Availability | undefined {
    this.disclosure.considered++
    if (records.some((r) => isCappedByTarget(r, this.cap))) {
      this.disclosure.capped++
      return undefined
    }
    const all = records.map((r) => availabilityOf(r, ctx.data.graph, ctx.ep, ctx.memo))
    if (all.some((a) => a.status === 'unknown')) {
      this.disclosure.unknown++
      return undefined
    }
    const missing = [...new Set(all.flatMap((a) => a.missing))].sort()
    const offWorld = missing.filter((id) => isOtherWorld(ctx, id))
    if (offWorld.length > 0) {
      this.disclosure.otherWorld++
      for (const id of offWorld) this.otherWorldBosses.add(id)
      return undefined
    }
    const conditions = [...new Set(all.flatMap((a) => a.conditions))]
    return { status: missing.length > 0 ? 'gated' : 'yes', missing, conditions }
  }
  unverified(): void {
    this.disclosure.unverified++
  }
  add(candidate: Candidate): void {
    ;(candidate.suggestion.availability.status === 'yes' ? this.yes : this.gated).push(candidate)
  }
  /** Ranked and cut; gated ones nearest gate first (B94(5)), then the §4.6 order. */
  ranked(ctx: LoadoutContext): { yes: Suggestion[]; gated: Suggestion[] } {
    const order = (a: Candidate, b: Candidate) =>
      compareRankable({ score: a.suggestion.value, gateCount: a.gateCount, rarity: a.rarity, key: a.suggestion.key }, { score: b.suggestion.value, gateCount: b.gateCount, rarity: b.rarity, key: b.suggestion.key })
    const steps = new Map<string, number>()
    const distance = new Map(this.gated.map((c) => [c, gateDistance(ctx.data.graph, ctx.ep, c.suggestion.availability.missing, ctx.memo, steps)]))
    const nearest = (a: Candidate, b: Candidate) => (distance.get(a) ?? 0) - (distance.get(b) ?? 0) || order(a, b)
    const cut = (list: Candidate[]) => list.slice(0, SUGGESTIONS_PER_GROUP).map((c) => ({ ...c.suggestion, text: plain(c.suggestion.rationale) }))
    this.disclosure.gatedNotListed = Math.max(0, this.gated.length - SUGGESTIONS_PER_GROUP)
    return { yes: cut([...this.yes].sort(order)), gated: cut([...this.gated].sort(nearest)) }
  }
}

function groupGated(ctx: LoadoutContext, items: readonly Suggestion[]): GatedSuggestionGroup[] {
  const groups = new Map<string, GatedSuggestionGroup>()
  for (const item of items) {
    const key = item.availability.missing.join('+')
    const group = groups.get(key) ?? { missing: item.availability.missing, names: item.availability.missing.map(ctx.nodeName), items: [] }
    group.items.push(item)
    groups.set(key, group)
  }
  return [...groups.values()]
}

function finish(ctx: LoadoutContext, pool: Pool, target: SuggestionTarget, title: string, basis: Segment[], emptyText: Segment[]): SuggestionGroup {
  const { yes, gated } = pool.ranked(ctx)
  return {
    target,
    title,
    basis,
    obtainable: yes,
    gated: groupGated(ctx, gated),
    disclosure: pool.disclosure,
    disclosureText: copy.disclosure(pool.disclosure.unknown, pool.disclosure.unverified, pool.disclosure.capped, ctx.bossSeg, pool.disclosure.gatedNotListed, gated.length, {
      count: pool.disclosure.otherWorld,
      bosses: [...pool.otherWorldBosses].sort().map((id): Segment => ({ kind: 'boss', id, text: ctx.nodeName(id) })),
    }),
    ...(yes.length === 0 ? { empty: emptyText } : {}),
  }
}

const classEligibleWeapon = (w: Weapon, cls: LoadoutContext['cls']): boolean | undefined => {
  const wc = known<string>(w, 'damageClass')
  if (wc === undefined) return undefined
  if (cls === 'hybrid') return true
  if (cls === 'summon') return w.tags.includes('whips')
  return wc === cls
}

function weaponGroup(ctx: LoadoutContext, cap: ReadonlySet<string>, estimates: ImproveResult['estimates']): SuggestionGroup {
  const pool = new Pool(cap)
  const current = ctx.main && !isSummonStaff(ctx.main.weapon) ? estimateDamage(ctx, ctx.main.weapon) : undefined
  const currentDps = current && !('missing' in current) ? current.estDps : undefined
  const inLoadout = new Set([ctx.input.loadout.mainWeapon, ctx.input.loadout.altWeapon])
  for (const weapon of ctx.data.weapons.values()) {
    if (inLoadout.has(weapon.id) || isSummonStaff(weapon) || weapon.tags.includes('unobtainable')) continue
    const eligible = classEligibleWeapon(weapon, ctx.cls)
    if (eligible === false) continue
    const availability = pool.admit([weapon], ctx)
    if (!availability) continue
    if (eligible === undefined || !weaponProfile(weapon).ok) {
      pool.unverified()
      continue
    }
    const est = estimateDamage(ctx, weapon)
    if ('missing' in est || est.estDps <= (currentDps ?? 0)) continue
    const rationale = [
      ...copy.weapon(num(`${oneDecimal(est.estDps)}/s`, 'dps'), currentDps !== undefined ? num(`${oneDecimal(currentDps)}/s`, 'dps') : undefined),
      ...(est.noAmmo ? [{ kind: 'text' as const, text: ' ' }, ...copy.scoredWithoutAmmo()] : []),
    ]
    pool.add({
      suggestion: { key: itemRef(weapon.id), kind: 'weapon', id: weapon.id, name: weapon.name, value: est.estDps, current: currentDps ?? 0, availability, rationale },
      gateCount: gateCount(weapon),
      rarity: weapon.rarity,
    })
  }
  const defenseKnown = isKnown(getField(ctx.boss, `statsByDifficulty.${ctx.difficulty}.defense`).status)
  estimates.dps = [
    assumptionText.dppBase(DPP_ASSUMPTIONS),
    defenseKnown ? assumptionText.bossDefense(DEFENSE_RULE_SOURCE.url) : assumptionText.bossDefenseUnknown(),
    assumptionText.bonuses(),
  ]
  return finish(ctx, pool, 'weapon', copy.weaponTitle, copy.weaponTarget(ctx.bossSeg), currentDps === undefined ? copy.emptyWeaponNoEstimate() : copy.emptyWeapon())
}

/** Armor defense of pieces: Σ defense + Σ defense-flat of their effects (+ the set bonus's), or undefined when any piece's numbers are Unknown. */
function armorDefense(pieces: readonly ArmorPiece[], setBonus: readonly StatEffect[] = []): number | undefined {
  let total = statTotal(setBonus, 'defense-flat', 'hybrid')
  for (const piece of pieces) {
    const d = known<number>(piece, 'defense')
    const effects = known<StatEffect[]>(piece, 'effects')
    if (d === undefined || effects === undefined) return undefined
    total += d + statTotal(effects, 'defense-flat', 'hybrid')
  }
  return total
}

function armorGroup(ctx: LoadoutContext, cap: ReadonlySet<string>): SuggestionGroup {
  const pool = new Pool(cap)
  const activeBonus = ctx.set.kind === 'active' && ctx.set.variant ? ctx.set.variant.setBonus : []
  const current = armorDefense(
    ctx.pieces.map((p) => p.piece),
    activeBonus,
  )
  const title = copy.armorTitle
  if (current === undefined) return { target: 'armor', title, basis: copy.armorTarget(), obtainable: [], gated: [], disclosure: pool.disclosure, disclosureText: [], empty: copy.armorPartlyUnknown() }
  const wornKey = ctx.set.kind === 'active' && ctx.set.set && ctx.set.combo ? `${ctx.set.set.id}:${ctx.set.combo.key}` : undefined
  // B136: the set an Unknown-membership piece leaves open isn't offered for completion (whether its bonus is already on is Unknown)
  const unknownBlocked = ctx.set.kind === 'unknown' ? ctx.set.set?.id : undefined
  // a set without a legs piece (Wizard set) keeps whatever legs are worn: they count in its value, as they would in game
  const wornLegs = ctx.pieces.find((p) => p.slot === 'legs')?.piece
  const nameOf = (id: number) => ctx.data.armor.get(id)?.name ?? `#${id}`
  for (const set of ctx.data.sets.values()) {
    for (const combo of setCombos(set)) {
      const { variant } = combo
      if (`${set.id}:${combo.key}` === wornKey) continue
      const classes = variant.classes ?? [variant.class]
      if (!(ctx.cls === 'hybrid' || classes.includes('other') || (ctx.cls !== 'other' && classes.includes(ctx.cls)))) continue
      const ids = [combo.helmetId, combo.chestId, ...(combo.legsId === undefined ? [] : [combo.legsId])]
      const pieces = ids.map((id) => ctx.data.armor.get(id))
      if (pieces.some((p) => p === undefined)) continue
      const availability = pool.admit(pieces as ArmorPiece[], ctx)
      if (!availability) continue
      if (set.id === unknownBlocked) {
        pool.unverified()
        continue
      }
      const value = armorDefense([...(pieces as ArmorPiece[]), ...(combo.legsId === undefined && wornLegs ? [wornLegs] : [])], variant.setBonus)
      if (value === undefined) {
        pool.unverified()
        continue
      }
      if (value <= current) continue
      const helmet = pieces[0] as ArmorPiece
      pool.add({
        suggestion: {
          key: `set:${set.id}:${combo.key}`,
          kind: 'armor-set',
          id: helmet.id,
          setId: set.id,
          name: comboName(set, combo, nameOf),
          pieces: ids,
          value,
          current,
          availability,
          rationale: copy.armor(value, current),
        },
        gateCount: availability.missing.length,
        rarity: helmet.rarity,
      })
    }
  }
  return finish(ctx, pool, 'armor', title, copy.armorTarget(), copy.emptyArmor())
}

/** Class-relevant points of an accessory, flight read as max(wingStats, effect) (§2.3), or undefined when its effects are Unknown. */
function accessoryPoints(accessory: Accessory, cls: LoadoutContext['cls']): number | undefined {
  const effects = known<StatEffect[]>(accessory, 'effects')
  if (effects === undefined) return undefined
  const wing = known<number>(accessory, 'wingStats.flightTimeTicks') ?? 0
  const others = effects.filter((e) => !(e.kind === 'stat' && e.stat === 'flight-time-ticks'))
  return sumPoints(applicablePoints(others, cls)) + 0.1 * Math.max(wing, statTotal(effects, 'flight-time-ticks', 'hybrid'))
}

const statPhrases = (effects: readonly StatEffect[], cls: LoadoutContext['cls']) =>
  effects.filter((e): e is Extract<StatEffect, { kind: 'stat' }> => e.kind === 'stat' && sumPoints(applicablePoints([e], cls)) !== 0).map((e) => effectPhrase(e))

function accessoryGroup(ctx: LoadoutContext, cap: ReadonlySet<string>): SuggestionGroup {
  const pool = new Pool(cap)
  const { data, input } = ctx
  const slots = SLOT_COUNT[input.difficulty]
  const dhIndex = DEMON_HEART_SLOT_INDEX[input.difficulty]
  const dhOpen = isNodeSatisfied(data.graph, ctx.ep, DEMON_HEART_GATE_NODE, ctx.memo)
  const freeSlots = input.loadout.accessories.slice(0, slots).filter((id, index) => id === null && !(index === dhIndex && !dhOpen)).length
  const equipped = new Set(input.loadout.accessories.slice(0, slots).filter((id): id is number => id !== null))
  const counted = ctx.accessories
  // Only an accessory whose every effect is counted can be compared fairly (Unknown or special effects: never replaced).
  const fullyCounted = (accessory: Accessory) => known<StatEffect[]>(accessory, 'effects')?.every((e) => e.kind === 'stat') ?? false
  const replaceable = counted
    .filter(({ accessory }) => fullyCounted(accessory))
    .map(({ accessory, entry }) => ({ accessory, entry, points: accessoryPoints(accessory, ctx.cls) ?? 0 }))
    .sort((a, b) => a.points - b.points || b.entry.id - a.entry.id)
  const replaced = freeSlots > 0 ? undefined : replaceable[0]
  const basis = copy.accessoryTarget(CLASS_WORD[ctx.cls])
  if (freeSlots === 0 && !replaced) return { target: 'accessory', title: copy.accessoryTitle, basis, obtainable: [], gated: [], disclosure: pool.disclosure, disclosureText: [], empty: copy.accessoriesFull() }
  const current = replaced?.points ?? 0
  const hasWings = counted.some(({ accessory }) => accessory.wingStats !== undefined && accessory.id !== replaced?.accessory.id)
  const linked = new Set<number>()
  for (const { accessory } of counted) {
    if (accessory.id === replaced?.accessory.id) continue
    for (const id of [...(known<number[]>(accessory, 'combinedFrom') ?? []), ...(known<number[]>(accessory, 'upgradesTo') ?? [])]) linked.add(id)
  }
  for (const accessory of data.accessories.values()) {
    if (equipped.has(accessory.id) || linked.has(accessory.id)) continue
    if (hasWings && accessory.wingStats !== undefined) continue // ≤ 1 wings (§4.4)
    const availability = pool.admit([accessory], ctx)
    if (!availability) continue
    const points = accessoryPoints(accessory, ctx.cls)
    if (points === undefined) {
      pool.unverified()
      continue
    }
    if (points <= current) continue
    const effects = known<StatEffect[]>(accessory, 'effects') ?? []
    const phrases = statPhrases(effects, ctx.cls)
    const wing = known<number>(accessory, 'wingStats.flightTimeTicks')
    if (wing !== undefined) phrases.push(`${oneDecimal(wing / 60)} s of flight`)
    pool.add({
      suggestion: {
        key: itemRef(accessory.id),
        kind: 'accessory',
        id: accessory.id,
        name: accessory.name,
        value: points,
        current,
        availability,
        rationale: copy.accessory(num(whole(points), 'synergy'), phrases, replaced ? ctx.item(replaced.accessory.id) : undefined, whole(current)),
        ...(replaced ? { replaces: { id: replaced.accessory.id, name: replaced.accessory.name } } : {}),
      },
      gateCount: gateCount(accessory),
      rarity: accessory.rarity,
    })
  }
  return finish(ctx, pool, 'accessory', copy.accessoryTitle, basis, copy.emptyAccessory())
}

function potionGroup(ctx: LoadoutContext, cap: ReadonlySet<string>): SuggestionGroup {
  const pool = new Pool(cap)
  const have = new Set(ctx.input.loadout.buffs)
  const haveBuffs = new Set(ctx.potions.flatMap((p) => (known<NonNullable<Item['buffGrants']>>(p.item, 'buffGrants') ?? []).map((g) => g.buffId)))
  for (const potion of ctx.data.items.values()) {
    if (potion.category !== 'potion' || have.has(potion.id)) continue
    const grants = (known<NonNullable<Item['buffGrants']>>(potion, 'buffGrants') ?? []).filter((g) => !COOLDOWN_BUFFS.has(g.buffId))
    if (grants.length === 0 || grants.every((g) => haveBuffs.has(g.buffId))) continue
    const availability = pool.admit([potion], ctx)
    if (!availability) continue
    const effects: StatEffect[] = []
    let unverifiedEffects = false
    for (const g of grants) {
      const buff = ctx.data.buffs.get(g.buffId)
      const buffEffects = buff ? known<StatEffect[]>(buff, 'effects') : undefined
      if (buffEffects === undefined) unverifiedEffects = true
      else effects.push(...buffEffects)
    }
    if (unverifiedEffects) {
      pool.unverified()
      continue
    }
    const points = sumPoints(applicablePoints(effects, ctx.cls))
    if (points <= 0) continue
    pool.add({
      suggestion: { key: itemRef(potion.id), kind: 'potion', id: potion.id, name: potion.name, value: points, current: 0, availability, rationale: copy.potion(num(whole(points), 'synergy'), statPhrases(effects, ctx.cls)) },
      gateCount: gateCount(potion),
      rarity: potion.rarity,
    })
  }
  return finish(ctx, pool, 'potion', copy.potionTitle, copy.potionTarget(CLASS_WORD[ctx.cls]), copy.emptyPotion())
}

function healingGroup(ctx: LoadoutContext, cap: ReadonlySet<string>): SuggestionGroup | undefined {
  if (ctx.potions.some((p) => getField(p.item, 'healLife').status !== 'not-applicable')) return undefined
  const pool = new Pool(cap)
  for (const potion of ctx.data.items.values()) {
    if (potion.category !== 'potion') continue
    const view = getField(potion, 'healLife')
    if (view.status === 'not-applicable') continue
    const availability = pool.admit([potion], ctx)
    if (!availability) continue
    if (!isKnown(view.status)) {
      pool.unverified()
      continue
    }
    const amount = view.value as number
    pool.add({
      suggestion: { key: itemRef(potion.id), kind: 'potion', id: potion.id, name: potion.name, value: amount, current: 0, availability, rationale: copy.healing(amount) },
      gateCount: gateCount(potion),
      rarity: potion.rarity,
    })
  }
  return finish(ctx, pool, 'healing', copy.healingTitle, copy.healingTarget(), copy.emptyHealing())
}

/** improveSuggestions (SCORING_SPEC §7): suggestions per targeted component; no boss → { error: 'no-boss' }. */
export function improveSuggestions(input: ReadinessInput, data: ReadinessData): ImproveResult | { error: 'no-boss' } {
  const boss = input.bossId ? data.bosses.get(input.bossId) : undefined
  if (!boss) return { error: 'no-boss' }
  const ctx = buildLoadoutContext(input, data, boss)
  const cap = targetCapNodes(data.graph, boss.nodeId)
  // Accessory and potion suggestions show points with this tip; always set (UX_SPEC §8 pairing).
  const estimates: ImproveResult['estimates'] = {
    synergy: [assumptionText.pointWeights(SCORING_CONSTANTS_VERSION), assumptionText.pointsUncounted(), assumptionText.pointsMatching()],
  }
  const groups = [weaponGroup(ctx, cap, estimates), armorGroup(ctx, cap), accessoryGroup(ctx, cap), potionGroup(ctx, cap)]
  const healing = healingGroup(ctx, cap)
  if (healing) groups.push(healing)
  return { groups, estimates }
}
