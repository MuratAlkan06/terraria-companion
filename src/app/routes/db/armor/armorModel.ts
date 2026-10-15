/**
 * Armor page model (PRD P6-S1; DATA_SCHEMA_SPEC §2.5 ArmorPiece / ArmorSet, AMENDMENTS-011 B52 classes[]). Pure:
 * the set's variants (one per wearable combination: per helmet, and per chest for Beetle armor / the Wizard set —
 * schemas/setCombos.ts), its full-set totals, the browse entries and their filters, the two-set comparison and the
 * stage peers. Every verified-or-Unknown field is read through `getField`:
 *
 * - a variant's classes are `classes ?? [class]` (SCORING_SPEC §3) — curated (editorial) in the data, so the page
 *   labels them "curated"; a hybrid variant names every class it counts for;
 * - a full-set total (AC2) = each piece's stated defense and effects + the set bonus's stated effects, added per
 *   stat kind and scope — the set bonus counted ONCE, never a per-piece sum that leaves it out; a piece whose
 *   defense or effects are Unknown makes that total Unknown (it is never treated as 0);
 * - stage peers (AC3) are the sets with the same VERIFIED stage; a set whose stage is Unknown has none — no peer
 *   is ever guessed.
 */
import type { ArmorPiece, ArmorSet, DamageClass, StatEffect, StatKind } from '../../../../schemas'
import { parseItemId } from '../../../../data-access'
import { getField } from '../../../../schemas/getField'
import { comboDistinctIds, setChestIds, setCombos, setPieceIds } from '../../../../schemas/setCombos'
import { STAGES } from '../../../stages'
import { matchesName } from '../items/itemFilters'
import { COMPARE_HELMET_PARAM, COMPARE_SET_PARAM, HELMET_PARAM } from './armorNav'
import { CLASS_ORDER, compareStatLines, isSpecial, isStat, statKey, type SpecialEffectOf } from './equipmentDisplay'

// --- set variants (one per wearable combination) -------------------------------------------------------------

/**
 * One wearable full set: a variant with one of the chests it applies to (`setCombos`). A one-chest set — every set
 * but Beetle armor and the Wizard set — has one per helmet, keyed by the helmet id (so `?helmet=<id>` links keep
 * working); a set with several chests is keyed `<helmet>.<chest>`.
 */
export interface SetVariant {
  key: string
  /** The data variant's position (its classes / set bonus). */
  index: number
  helmetId: number
  helmet: ArmorPiece | undefined
  chestId: number
  chest: ArmorPiece | undefined
  /** Absent when the set has no legs piece (any legs keep the bonus). */
  legsId: number | undefined
  /** What tells it apart from the set's other combinations ("Hallowed Mask", "Beetle Shell", "Wizard Hat + Mystic Robe"); '' when it is the only one. */
  label: string
  /** The piece its set bonus comes with: its chest when the bonus is keyed by the chest (Beetle armor), else its helmet. */
  bonusPieceId: number
  classes: DamageClass[]
  /** The classes are hand-curated (editorial) in the data — shown with the "curated" label. */
  curated: boolean
  /** More than one class (B52 hybrid, e.g. Frost armor: melee + ranged). */
  hybrid: boolean
  setBonus: StatEffect[]
  setBonusText: string
}

const pieceName = (armor: ReadonlyMap<number, ArmorPiece>) => (id: number) => armor.get(id)?.name ?? `#${id}`

/** Every wearable combination, in class order (melee, ranged, magic, summon, classless), then the data's order. */
export function variantsOf(set: ArmorSet, armor: ReadonlyMap<number, ArmorPiece>): SetVariant[] {
  const name = pieceName(armor)
  return setCombos(set)
    .map((c, order) => {
      const v = c.variant
      const index = c.variantIndex
      const classes = sortClasses(v.classes ?? [v.class])
      const view = getField(set, `variants.${index}.classes`)
      const curated = view.status === 'editorial' || getField(set, `variants.${index}.class`).status === 'editorial'
      const variant: SetVariant = {
        key: c.key,
        index,
        helmetId: c.helmetId,
        helmet: armor.get(c.helmetId),
        chestId: c.chestId,
        chest: armor.get(c.chestId),
        legsId: c.legsId,
        label: comboDistinctIds(set, c).map(name).join(' + '),
        bonusPieceId: v.chestId ?? c.helmetId,
        classes,
        curated,
        hybrid: classes.length > 1,
        setBonus: v.setBonus,
        setBonusText: v.setBonusText,
      }
      return { variant, order }
    })
    .sort((a, b) => CLASS_ORDER.indexOf(a.variant.classes[0]) - CLASS_ORDER.indexOf(b.variant.classes[0]) || a.order - b.order)
    .map((x) => x.variant)
}

export const sortClasses = (classes: readonly DamageClass[]): DamageClass[] => [...new Set(classes)].sort((a, b) => CLASS_ORDER.indexOf(a) - CLASS_ORDER.indexOf(b))

/** Every class any variant counts for (the set's facet buckets, header). */
export function setClasses(set: ArmorSet): DamageClass[] {
  return sortClasses(set.variants.flatMap((v) => v.classes ?? [v.class]))
}

/** The set's pieces in wearing order: its helmets, then its chest(s), then legs (when it has a legs piece). */
export { setChestIds, setPieceIds }

/** How a set is put together beyond "helmet + chest + legs": alternative chests, no legs piece (the page says so). */
export function setShape(set: ArmorSet): { chests: number; legsAny: boolean; chestKeyed: boolean } {
  return { chests: setChestIds(set).length, legsAny: set.pieces.legs === undefined, chestKeyed: set.variants.some((v) => v.chestId !== undefined) }
}

/**
 * Combinations that share one set-bonus text, in variant order (Ancient Hallowed armor: one text, three helmets),
 * each naming the pieces the bonus comes with — a helmet, or the chest for a bonus keyed by the chest — once.
 */
export function bonusGroups(variants: readonly SetVariant[]): { text: string; variants: SetVariant[]; pieces: SetVariant[] }[] {
  const groups: { text: string; variants: SetVariant[]; pieces: SetVariant[] }[] = []
  for (const v of variants) {
    const g = groups.find((x) => x.text === v.setBonusText)
    if (!g) groups.push({ text: v.setBonusText, variants: [v], pieces: [v] })
    else {
      g.variants.push(v)
      if (!g.pieces.some((p) => p.bonusPieceId === v.bonusPieceId)) g.pieces.push(v)
    }
  }
  return groups
}

/** How many pieces a set bonus can come with (helmets, or chests when it is keyed by the chest) — labels show when > 1. */
export const bonusPieceCount = (variants: readonly SetVariant[]): number => new Set(variants.map((v) => v.bonusPieceId)).size

// --- full-set totals (AC1 / AC2) ------------------------------------------------------------------------

export interface TotalLine {
  key: string
  stat: StatKind
  scope?: DamageClass
  /** pieces + bonus */
  total: number
  pieces: number
  bonus: number
}

export interface SetTotals {
  variant: SetVariant
  /** The pieces worn: helmet, chest and legs (no legs for a set without a legs piece). */
  pieceIds: number[]
  /** Total defense = the pieces' defense + any "+N defense" effect (set bonus included); Unknown when a piece's defense is. */
  defense: { kind: 'known'; total: number; pieces: number; bonus: number } | { kind: 'unknown'; pieceIds: number[] }
  /** Every other stat kind (and scope), pieces + set bonus. */
  lines: TotalLine[]
  /** Pieces whose effects list is Unknown: the lines then leave them out, and say so. */
  effectsUnknown: number[]
  /** The effects the data keeps as wiki text: per piece, then the set bonus's. */
  specials: { from: 'bonus' | number; effect: SpecialEffectOf }[]
}

export function setTotals(_set: ArmorSet, variant: SetVariant, armor: ReadonlyMap<number, ArmorPiece>): SetTotals {
  const pieceIds = [variant.helmetId, variant.chestId, ...(variant.legsId === undefined ? [] : [variant.legsId])]
  const lines = new Map<string, TotalLine>()
  const add = (e: Extract<StatEffect, { kind: 'stat' }>, from: 'pieces' | 'bonus') => {
    const key = statKey(e.stat, e.scope)
    const line = lines.get(key) ?? { key, stat: e.stat, ...(e.scope ? { scope: e.scope } : {}), total: 0, pieces: 0, bonus: 0 }
    line.total += e.value
    line[from] += e.value
    lines.set(key, line)
  }
  let defense = 0
  const unknownDefense: number[] = []
  const effectsUnknown: number[] = []
  const specials: SetTotals['specials'] = []
  for (const id of pieceIds) {
    const piece = armor.get(id)
    const d = piece ? getField(piece, 'defense') : { status: 'unverified' as const }
    if (d.status === 'unverified') unknownDefense.push(id)
    else if (d.status !== 'not-applicable') defense += d.value as number
    const effects = piece ? getField(piece, 'effects') : { status: 'unverified' as const }
    if (effects.status === 'unverified') {
      effectsUnknown.push(id)
      continue
    }
    for (const e of (effects.value as StatEffect[] | undefined) ?? []) {
      if (isStat(e)) add(e, 'pieces')
      else if (isSpecial(e)) specials.push({ from: id, effect: e })
    }
  }
  for (const e of variant.setBonus) {
    if (isStat(e)) add(e, 'bonus')
    else if (isSpecial(e)) specials.push({ from: 'bonus', effect: e })
  }
  // "+N defense" effects belong to the defense total, not a line of their own
  const flat = lines.get('defense-flat')
  lines.delete('defense-flat')
  return {
    variant,
    pieceIds,
    defense:
      unknownDefense.length > 0
        ? { kind: 'unknown', pieceIds: unknownDefense }
        : { kind: 'known', total: defense + (flat?.total ?? 0), pieces: defense + (flat?.pieces ?? 0), bonus: flat?.bonus ?? 0 },
    lines: [...lines.values()].filter((l) => l.total !== 0 || l.bonus !== 0 || l.pieces !== 0).sort(compareStatLines),
    effectsUnknown,
    specials,
  }
}

/** Defense range over a set's combinations (list rows): "16" or "16–20"; undefined when any is Unknown. */
export function defenseRange(set: ArmorSet, armor: ReadonlyMap<number, ArmorPiece>): { min: number; max: number } | undefined {
  let min = Infinity
  let max = -Infinity
  for (const v of variantsOf(set, armor)) {
    const t = setTotals(set, v, armor).defense
    if (t.kind === 'unknown') return undefined
    min = Math.min(min, t.total)
    max = Math.max(max, t.total)
  }
  return Number.isFinite(min) ? { min, max } : undefined
}

// --- comparison (AC2) -------------------------------------------------------------------------------------

export type CompareCell = { kind: 'value'; total: number; pieces: number; bonus: number } | { kind: 'none' } | { kind: 'unknown' }

export interface CompareRow {
  key: string
  stat: StatKind | 'defense'
  scope?: DamageClass
  a: CompareCell
  b: CompareCell
  /**
   * The set bonuses change which side has more of this stat (or make an even split uneven) — the case a naive
   * per-piece sum gets wrong (AC2). Only between two known values.
   */
  bonusChangesOrder: boolean
}

const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0)

function cellOf(t: SetTotals, key: string): CompareCell {
  if (key === 'defense') return t.defense.kind === 'unknown' ? { kind: 'unknown' } : { kind: 'value', total: t.defense.total, pieces: t.defense.pieces, bonus: t.defense.bonus }
  const line = t.lines.find((l) => l.key === key)
  if (line) return { kind: 'value', total: line.total, pieces: line.pieces, bonus: line.bonus }
  // absent from a side whose effects are all known = it gives none; with an Unknown effects list it is Unknown
  return t.effectsUnknown.length > 0 ? { kind: 'unknown' } : { kind: 'none' }
}

/** Set-bonus-aware comparison of two full sets (each with its chosen helmet): one row per stat either gives. */
export function compareSets(a: SetTotals, b: SetTotals): CompareRow[] {
  const keys = new Map<string, { stat: StatKind; scope?: DamageClass }>()
  for (const l of [...a.lines, ...b.lines]) keys.set(l.key, { stat: l.stat, ...(l.scope ? { scope: l.scope } : {}) })
  const ordered = [...keys.entries()].sort(([, x], [, y]) => compareStatLines(x, y))
  const rows: CompareRow[] = [{ key: 'defense', stat: 'defense', a: cellOf(a, 'defense'), b: cellOf(b, 'defense'), bonusChangesOrder: false }]
  for (const [key, s] of ordered) rows.push({ key, stat: s.stat, ...(s.scope ? { scope: s.scope } : {}), a: cellOf(a, key), b: cellOf(b, key), bonusChangesOrder: false })
  for (const row of rows) {
    const value = (c: CompareCell) => (c.kind === 'value' ? c : c.kind === 'none' ? { total: 0, pieces: 0, bonus: 0 } : undefined)
    const x = value(row.a)
    const y = value(row.b)
    row.bonusChangesOrder = x !== undefined && y !== undefined && (x.bonus !== 0 || y.bonus !== 0) && sign(x.pieces - y.pieces) !== sign(x.total - y.total)
  }
  return rows
}

/** The other side's default helmet: the first whose classes overlap the chosen one's, else its first. */
export function matchingVariant(chosen: SetVariant, variants: readonly SetVariant[]): SetVariant | undefined {
  return variants.find((v) => v.classes.some((c) => chosen.classes.includes(c))) ?? variants[0]
}

// --- stage peers (AC3) ---------------------------------------------------------------------------------

/** The set's verified stage, or undefined (Unknown / absent). */
export function verifiedStage(record: unknown): string | undefined {
  const view = getField(record, 'stage')
  return view.status === 'verified' || view.status === 'editorial' ? (view.value as string) : undefined
}

/** Other sets with the same verified stage, by name. None when this set's stage isn't verified. */
export function stagePeers(set: ArmorSet, sets: Iterable<ArmorSet>): ArmorSet[] {
  const stage = verifiedStage(set)
  if (stage === undefined) return []
  return [...sets].filter((s) => s.id !== set.id && verifiedStage(s) === stage).sort((a, b) => collator.compare(a.name, b.name))
}

// --- browse entries + filters ---------------------------------------------------------------------------

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

export interface SetEntry {
  kind: 'set'
  id: string
  name: string
  set: ArmorSet
  classes: DamageClass[]
  /** Verified stage, or undefined (Unknown). */
  stage: string | undefined
  defense: { min: number; max: number } | undefined
  helmets: number
  /** Alternative chests (Beetle armor 2, Wizard set 8); 1 for every other set. */
  chests: number
  /** No legs piece: any legs keep the bonus (Wizard set). */
  legsAny: boolean
  sprite: string | undefined
}

export interface PieceEntry {
  kind: 'piece'
  id: number
  name: string
  piece: ArmorPiece
  stage: string | undefined
}

export function setEntries(sets: Iterable<ArmorSet>, armor: ReadonlyMap<number, ArmorPiece>): SetEntry[] {
  return [...sets]
    .map((set) => ({
      kind: 'set' as const,
      id: set.id,
      name: set.name,
      set,
      classes: setClasses(set),
      stage: verifiedStage(set),
      defense: defenseRange(set, armor),
      helmets: set.pieces.helmets.length,
      chests: setChestIds(set).length,
      legsAny: set.pieces.legs === undefined,
      // the (first) chest piece: the most recognisable picture of a set
      sprite: armor.get(set.pieces.chest)?.sprite,
    }))
    .sort((a, b) => collator.compare(a.name, b.name))
}

/** Armor pieces outside the recorded sets (Goggles, Gi, Viking Helmet …): each has its own page. */
export function loosePieceEntries(armor: ReadonlyMap<number, ArmorPiece>, sets: Iterable<ArmorSet>): PieceEntry[] {
  const inSet = new Set([...sets].flatMap(setPieceIds))
  return [...armor.values()]
    .filter((p) => !inSet.has(p.id))
    .map((piece) => ({ kind: 'piece' as const, id: piece.id, name: piece.name, piece, stage: verifiedStage(piece) }))
    .sort((a, b) => collator.compare(a.name, b.name) || a.id - b.id)
}

export const ARMOR_FACET_IDS = ['class', 'stage'] as const
export type ArmorFacetId = (typeof ARMOR_FACET_IDS)[number]
export interface ArmorFilters {
  class: readonly string[]
  stage: readonly string[]
  q: string
}
export const EMPTY_ARMOR_FILTERS: ArmorFilters = { class: [], stage: [], q: '' }
export const STAGE_UNKNOWN = 'unknown'
export const MAX_QUERY_LENGTH = 60

export const CLASS_FILTER_OPTIONS: readonly { value: DamageClass; label: string }[] = [
  { value: 'melee', label: 'Melee' },
  { value: 'ranged', label: 'Ranged' },
  { value: 'magic', label: 'Magic' },
  { value: 'summon', label: 'Summon' },
  { value: 'other', label: 'Classless' },
]
export const STAGE_FILTER_OPTIONS: readonly { value: string; label: string }[] = [...STAGES.map((s) => ({ value: s.id as string, label: s.label })), { value: STAGE_UNKNOWN, label: 'Stage unknown' }]

const VALID: Record<ArmorFacetId, readonly string[]> = { class: CLASS_FILTER_OPTIONS.map((o) => o.value), stage: STAGE_FILTER_OPTIONS.map((o) => o.value) }

const stageBucket = (stage: string | undefined) => stage ?? STAGE_UNKNOWN

/**
 * A set matches a class filter when ANY of its variants counts for a selected class (OR within a facet, AND across
 * facets). A piece outside a set has no class of its own: any class filter leaves it out (the page says so).
 */
export function matchesArmor(entry: SetEntry | PieceEntry, f: ArmorFilters, skip?: ArmorFacetId): boolean {
  if (skip !== 'class' && f.class.length > 0 && (entry.kind === 'piece' || !entry.classes.some((c) => f.class.includes(c)))) return false
  if (skip !== 'stage' && f.stage.length > 0 && !f.stage.includes(stageBucket(entry.stage))) return false
  return matchesName(entry.name, f.q)
}

export function parseArmorFilters(params: URLSearchParams): ArmorFilters {
  const read = (id: ArmorFacetId) => {
    const requested = new Set((params.get(id) ?? '').split(',').map((v) => v.trim()).filter(Boolean))
    return VALID[id].filter((v) => requested.has(v))
  }
  return { class: read('class'), stage: read('stage'), q: (params.get('q') ?? '').trim().slice(0, MAX_QUERY_LENGTH) }
}

export function writeArmorFilters(params: URLSearchParams, f: ArmorFilters): URLSearchParams {
  const next = new URLSearchParams(params)
  for (const id of ARMOR_FACET_IDS) {
    if (f[id].length > 0) next.set(id, f[id].join(','))
    else next.delete(id)
  }
  if (f.q.trim()) next.set('q', f.q.trim().slice(0, MAX_QUERY_LENGTH))
  else next.delete('q')
  return next
}

export function toggleArmorFilter(f: ArmorFilters, facet: ArmorFacetId, value: string): ArmorFilters {
  const nextSet = f[facet].includes(value) ? f[facet].filter((v) => v !== value) : [...f[facet], value]
  return { ...f, [facet]: VALID[facet].filter((v) => nextSet.includes(v)) }
}

export const activeArmorFilterCount = (f: ArmorFilters): number => f.class.length + f.stage.length + (f.q ? 1 : 0)

/** FilterBar facets with per-option counts of SETS (given the other facets and the name filter). */
export function buildArmorFacets(entries: readonly SetEntry[], f: ArmorFilters) {
  const count = (facet: ArmorFacetId, value: string) =>
    entries.filter((e) => matchesArmor(e, f, facet) && (facet === 'class' ? e.classes.includes(value as DamageClass) : stageBucket(e.stage) === value)).length
  return [
    { id: 'class', label: 'Class', options: CLASS_FILTER_OPTIONS.map((o) => ({ ...o, count: count('class', o.value) })) },
    { id: 'stage', label: 'Game stage', options: STAGE_FILTER_OPTIONS.map((o) => ({ ...o, count: count('stage', o.value) })) },
  ]
}

// --- the comparison's state (URL: ?vs=<set>&helmet=<id>&vshelmet=<id>) --------------------------------------

export interface CompareState {
  /** The other set, when one is chosen (and exists). */
  other: ArmorSet | undefined
  aVariants: SetVariant[]
  bVariants: SetVariant[]
  aVariant: SetVariant
  bVariant: SetVariant | undefined
  a: SetTotals
  b: SetTotals | undefined
  rows: CompareRow[] | undefined
}

/** `?helmet=` / `?vshelmet=` name a combination by its key — the helmet id for a one-chest set (older links keep working). */
const helmetIn = (variants: readonly SetVariant[], raw: string | null) => variants.find((v) => raw !== null && v.key === raw)

/** Reads the comparison from the URL; an unknown set or helmet id falls back (never a guessed pick). */
export function compareState(set: ArmorSet, sets: ReadonlyMap<string, ArmorSet>, armor: ReadonlyMap<number, ArmorPiece>, params: URLSearchParams): CompareState {
  const aVariants = variantsOf(set, armor)
  const aVariant = helmetIn(aVariants, params.get(HELMET_PARAM)) ?? aVariants[0]
  const otherId = params.get(COMPARE_SET_PARAM)
  const other = otherId !== null && otherId !== set.id ? sets.get(otherId) : undefined
  const bVariants = other ? variantsOf(other, armor) : []
  const bVariant = other ? (helmetIn(bVariants, params.get(COMPARE_HELMET_PARAM)) ?? matchingVariant(aVariant, bVariants)) : undefined
  const a = setTotals(set, aVariant, armor)
  const b = other && bVariant ? setTotals(other, bVariant, armor) : undefined
  return { other, aVariants, bVariants, aVariant, bVariant, a, b, rows: b ? compareSets(a, b) : undefined }
}

// --- the route id ------------------------------------------------------------------------------------------

export type ArmorRoute = { kind: 'set'; set: ArmorSet } | { kind: 'in-set'; set: ArmorSet; pieceId: number } | { kind: 'piece'; piece: ArmorPiece } | { kind: 'none' }

/**
 * What an `/armor/:id` id names: a set (its slug), a piece in a set (its id — the page sends it to the set, at the
 * piece), a piece outside any set (its own page), or nothing (styled 404).
 */
export function resolveArmorId(id: string, data: { sets: ReadonlyMap<string, ArmorSet>; armor: ReadonlyMap<number, ArmorPiece> }): ArmorRoute {
  const pieceId = parseItemId(id)
  if (pieceId !== undefined) {
    const piece = data.armor.get(pieceId)
    if (!piece) return { kind: 'none' }
    const set = (piece.setId ? data.sets.get(piece.setId) : undefined) ?? [...data.sets.values()].find((s) => setPieceIds(s).includes(pieceId))
    return set ? { kind: 'in-set', set, pieceId } : { kind: 'piece', piece }
  }
  const set = data.sets.get(id)
  return set ? { kind: 'set', set } : { kind: 'none' }
}
