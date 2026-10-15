/**
 * Pure model of the weapon comparison (PRD P4-S1; UX_SPEC §3.6, §5.3, §8): the URL selection, each
 * column's cells, the damage-rate estimate and the data-derived pros / cons. The table renders exactly
 * these cells, and the column's partially-verified list is built from the same cells, so the Unknown
 * markers on screen and the count beside the source link always agree (compare.test.ts checks it).
 *
 * Binding rules encoded here:
 * - Unknown is the only rendering of an unverified field (REQUIREMENTS §13, UX_SPEC §5.3): never 0,
 *   never a dash, never filled in. A not-applicable field reads as what it means ("None" mana).
 * - Crit is NOT APPLICABLE, not Unknown, for classless damage (AMENDMENTS-015 B85(b)) and for summon
 *   damage (B17 / B64); the row disappears only when no column can crit.
 * - The damage rate is SCORING_SPEC §2.2's sim-free DPP — same formula for every weapon, labeled
 *   "est." with the verbatim §2.2 assumptions plus this weapon's own numbers (decomposable, §1.1).
 *   Summon staffs get no rate (§4.5: cast time isn't the minion's attack rate); a weapon missing a
 *   required field gets none either (§1.3: excluded and disclosed, never defaulted). A weapon without
 *   auto-reuse, used up on use or explosive keeps the same number plus an in-cell qualifier line and a
 *   tip per caveat (AMENDMENTS-016 B101a).
 * - Gating reads TRACKED defeats only (SCORING_SPEC §2.4 scope split: GateBadges), so badges drop as
 *   bosses are marked defeated; Unknown gating is never shown as open (§1.4).
 * - Comparison is descriptive: no cell ranks one weapon over another (copy audit in the tests).
 */
import type { Assumption, Assumptions } from '../../../../components/assumptions'
import type { PartiallyVerifiedItem } from '../../../../components/PartiallyVerifiedBadge'
import { asRarity, rarityLabel, type Rarity } from '../../../../components/rarity'
import { parseItemId } from '../../../../data-access'
import type { Weapon } from '../../../../data-access/types'
import type { DamageClass, GatedBy } from '../../../../schemas'
import { getField } from '../../../../schemas/getField'
import { loadDomain } from '../../../../storage'
import { availabilityOf, type Availability } from '../../../../scoring/candidates'
import { BASE_CRIT_PCT, DPP_ASSUMPTIONS } from '../../../../scoring/constants'
import type { ProgressionGraphLike } from '../../../../scoring/progress'
import { critFactor, damagePotential, isSummonStaff, weaponProfile } from '../../../../scoring/proxies'
import { CLASS_LABELS, ammoTypeLabel, critView, fieldLabel, formatNumber, routeTitle, stageLabel } from '../weapons/weaponDisplay'
import { COMPARE_MAX, compareSearch } from './compareLinks'
import * as copy from './compareCopy'

// --- URL selection ----------------------------------------------------------------------------------

export interface CompareSelection {
  /** Weapon ids in column order: valid, deduplicated, at most COMPARE_MAX. */
  ids: number[]
  /** What the link held that isn't compared (shown as notices, never dropped silently). */
  malformed: number
  duplicates: number
  overflow: number
}

/** Parses `?w=` ("4956,757,1308"). Anything that isn't a positive integer id is counted, not kept. */
export function parseCompareParam(raw: string | null | undefined): CompareSelection {
  const out: CompareSelection = { ids: [], malformed: 0, duplicates: 0, overflow: 0 }
  if (!raw) return out
  for (const part of raw.split(',')) {
    const text = part.trim()
    if (text === '') continue
    const id = parseItemId(text)
    if (id === undefined) out.malformed++
    else if (out.ids.includes(id)) out.duplicates++
    else if (out.ids.length >= COMPARE_MAX) out.overflow++
    else out.ids.push(id)
  }
  return out
}

/** The selection's weapons in column order, and the ids the dataset doesn't have. */
export function resolveSelection(ids: readonly number[], weapons: ReadonlyMap<number, Weapon>): { weapons: Weapon[]; missing: number[] } {
  const found: Weapon[] = []
  const missing: number[] = []
  for (const id of ids) {
    const w = weapons.get(id)
    if (w) found.push(w)
    else missing.push(id)
  }
  return { weapons: found, missing }
}

/** Appends a weapon (no-op when present or full). */
export function withAdded(ids: readonly number[], id: number): number[] {
  return ids.includes(id) || ids.length >= COMPARE_MAX ? [...ids] : [...ids, id]
}

export function withRemoved(ids: readonly number[], id: number): number[] {
  return ids.filter((x) => x !== id)
}

/** Replaces `from` with `to` in place (column order kept); a `to` already compared is a no-op. */
export function withSwapped(ids: readonly number[], from: number, to: number): number[] {
  if (from === to || ids.includes(to) || !ids.includes(from)) return [...ids]
  return ids.map((x) => (x === from ? to : x))
}

// --- stat cells --------------------------------------------------------------------------------------

export type StatKey = 'class' | 'damage' | 'crit' | 'useTime' | 'knockback' | 'autoReuse' | 'mana' | 'ammo' | 'consumable' | 'stage' | 'rarity'

export type StatCell =
  /** A verified value. `damageClass` / `rarity` let the view draw the class badge / rarity swatch. */
  | { kind: 'value'; field: string; text: string; damageClass?: DamageClass; rarity?: Rarity }
  /** The field doesn't apply and that means "none" (no mana cost, no ammo, not consumable). */
  | { kind: 'none'; field: string; text: string }
  /** The field can't apply to this weapon at all (crit for classless / summon damage). */
  | { kind: 'not-applicable'; field: string; reason: string }
  /** Unverified: rendered "Unknown" (UnknownValue), counted in the column's partially-verified list. */
  | { kind: 'unknown'; field: string }

export type StatGroupId = 'stats' | 'costs' | 'progress'

export const STAT_GROUPS: readonly { id: StatGroupId; label: string; keys: readonly StatKey[] }[] = [
  { id: 'stats', label: copy.GROUP_STATS, keys: ['class', 'damage', 'crit', 'useTime', 'knockback', 'autoReuse'] },
  { id: 'costs', label: copy.GROUP_COSTS, keys: ['mana', 'ammo', 'consumable'] },
  { id: 'progress', label: copy.GROUP_PROGRESS, keys: ['stage', 'rarity'] },
]

/** One weapon's cell for a stat row, read through getField (DATA_SCHEMA_SPEC §2.1 rule 5). */
export function statCell(w: Weapon, key: StatKey): StatCell {
  const read = (field: string, format: (value: unknown) => string, none?: string): StatCell => {
    const view = getField(w, field)
    if (view.status === 'unverified') return { kind: 'unknown', field }
    if (view.status === 'not-applicable' || view.value === undefined) return none !== undefined ? { kind: 'none', field, text: none } : { kind: 'unknown', field }
    return { kind: 'value', field, text: format(view.value) }
  }
  switch (key) {
    case 'class': {
      const cell = read('damageClass', (v) => CLASS_LABELS[v as DamageClass])
      return cell.kind === 'value' ? { ...cell, damageClass: w.damageClass } : cell
    }
    case 'damage':
      return read('damage', (v) => formatNumber(v as number))
    case 'crit': {
      const view = critView(w)
      if (view.status === 'not-applicable') return { kind: 'not-applicable', field: 'critPct', reason: w.damageClass === 'summon' ? copy.CRIT_NA_SUMMON : copy.CRIT_NA_CLASSLESS }
      if (view.status === 'unverified' || view.value === undefined) return { kind: 'unknown', field: 'critPct' }
      return { kind: 'value', field: 'critPct', text: copy.critPercent(BASE_CRIT_PCT + (view.value as number)) }
    }
    case 'useTime':
      return read('useAnimationTicks', (v) => copy.ticks(v as number))
    case 'knockback':
      return read('knockback', (v) => formatNumber(v as number))
    case 'autoReuse':
      return read('autoReuse', (v) => (v ? copy.YES : copy.NO))
    case 'mana':
      return read('manaCost', (v) => String(v), copy.NONE)
    case 'ammo':
      return read('ammoClass', (v) => ammoTypeLabel(v as string), copy.NONE)
    case 'consumable':
      // Iteminfo maxStack is emitted for consumable weapons only (AMENDMENTS-002 B7): absent = not used up.
      return read('maxStack', (v) => copy.consumableYes(v as number), copy.NO)
    case 'stage':
      return read('stage', (v) => stageLabel(v as string))
    case 'rarity': {
      const cell = read('rarity', (v) => {
        const r = asRarity(v as number | string)
        return r === undefined ? String(v) : rarityLabel(r)
      })
      return cell.kind === 'value' ? { ...cell, rarity: asRarity(w.rarity) } : cell
    }
  }
}

/** A stat row is shown unless no column can have the stat (crit with only classless / summon weapons). */
export function showStatRow(weapons: readonly Weapon[], key: StatKey): boolean {
  return weapons.some((w) => statCell(w, key).kind !== 'not-applicable')
}

// --- damage-rate estimate (SCORING_SPEC §2.2 DPP) ------------------------------------------------------

export type DppCell =
  /** `qualifier`: the in-cell caveat line when the weapon breaks the held-attack rate or is used up (B101a). */
  | { kind: 'estimate'; value: number; text: string; assumptions: Assumptions; qualifier?: string }
  /** A summon staff: its cast rate isn't its minions' attack rate (§4.5) — not estimated. */
  | { kind: 'summon' }
  /** A required input is Unknown (§1.3): not estimated, the missing fields named. */
  | { kind: 'missing'; fields: string[] }

/** Display precision of the estimate (one decimal, like the readiness checker's figures). */
export const formatEstimate = (value: number): string => value.toFixed(1)

/**
 * Where §2.2's uniform number needs a caveat (AMENDMENTS-016 B101a), each read from ONE verified field by the
 * same rules as the pros / cons — nothing from an Unknown field, nothing from the Lab's modeled parameters.
 */
export interface DppCaveats {
  /** autoReuse verified false: holding attack doesn't repeat it, so the "held-attack rate" means a click every use. */
  noAutoReuse: boolean
  /** maxStack verified (emitted for consumable weapons only, B7): each use spends one from the stack. */
  consumed: boolean
  /** The wiki's Explosives category: the blast's area and the fuse's delay aren't in a single-target rate. */
  explosive: boolean
}

export function dppCaveats(w: Weapon): DppCaveats {
  const verified = (field: string) => {
    const view = getField(w, field)
    return view.status === 'verified' || view.status === 'editorial' ? view.value : undefined
  }
  return { noAutoReuse: verified('autoReuse') === false, consumed: typeof verified('maxStack') === 'number', explosive: w.tags.includes('explosives') }
}

export function dppCell(w: Weapon): DppCell {
  if (isSummonStaff(w)) return { kind: 'summon' }
  const profile = weaponProfile(w)
  if (!profile.ok) return { kind: 'missing', fields: profile.missing.map((f) => compareFieldLabel(f, w)) }
  const value = damagePotential(profile)
  const factor = critFactor(profile)
  const useAnimation = getField(w, 'useAnimationTicks').value as number
  const delay = (getField(w, 'reuseDelayTicks').value as number | undefined) ?? 0
  // §2.2 cadence: melee auto-reuse swings one tick sooner (B14 + autoswing).
  const autoswing = profile.damageClass === 'melee' && getField(w, 'autoReuse').value === true
  const hps = formatNumber(Number(profile.hitsPerSec.toFixed(2)))
  // B101a caveats. A used-up weapon spends one item per shot, so its usage rate is its shots per second.
  const caveats = dppCaveats(w)
  const qualifierParts = [
    ...(caveats.noAutoReuse ? [caveats.consumed ? copy.QUALIFIER_CLICK_THROW : copy.QUALIFIER_CLICK_ATTACK] : []),
    ...(caveats.consumed ? [copy.qualifierUsage(hps)] : []),
    ...(caveats.explosive ? [copy.QUALIFIER_EXPLOSIVE] : []),
  ]
  const caveatTips: Assumption[] = [
    ...(caveats.noAutoReuse ? [{ id: 'dpp-clicks', title: copy.ASSUMPTION_CLICKS_TITLE, detail: copy.assumptionClicks(profile.cadenceTicks) }] : []),
    ...(caveats.consumed ? [{ id: 'dpp-usage', title: copy.ASSUMPTION_USAGE_TITLE, detail: copy.assumptionUsage(hps) }] : []),
    ...(caveats.explosive ? [{ id: 'dpp-explosive', title: copy.ASSUMPTION_EXPLOSIVE_TITLE, detail: copy.ASSUMPTION_EXPLOSIVE }] : []),
  ]
  const crit: Assumption = {
    id: 'dpp-crit',
    title: copy.ASSUMPTION_CRIT_TITLE,
    detail: profile.critApplies ? copy.assumptionCrit(BASE_CRIT_PCT + profile.critPct) : profile.damageClass === 'summon' ? copy.ASSUMPTION_CRIT_SUMMON : copy.ASSUMPTION_CRIT_CLASSLESS,
    ...(profile.critApplies || profile.damageClass === 'summon' ? {} : { sourceUrl: CRIT_RULE_SOURCE }),
  }
  const assumptions: Assumptions = [
    // SCORING_SPEC §2.2: verbatim in every DPP-derived AssumptionsTip.
    { id: 'dpp-base', title: copy.ASSUMPTION_BASE_TITLE, detail: DPP_ASSUMPTIONS },
    {
      id: 'dpp-formula',
      title: copy.ASSUMPTION_FORMULA_TITLE,
      detail: copy.assumptionFormula(formatNumber(profile.damage), hps, formatNumber(Number(factor.toFixed(2))), formatEstimate(value)),
    },
    { id: 'dpp-rate', title: copy.ASSUMPTION_RATE_TITLE, detail: copy.assumptionRate(copy.cadenceText(useAnimation, autoswing, delay), profile.cadenceTicks, profile.activationsPerUse, hps) },
    ...caveatTips,
    crit,
    ...(profile.ammoClass ? [{ id: 'dpp-ammo', title: copy.ASSUMPTION_AMMO_TITLE, detail: copy.ASSUMPTION_AMMO }] : []),
    { id: 'dpp-proxy', title: copy.ASSUMPTION_PROXY_TITLE, detail: copy.ASSUMPTION_PROXY },
  ]
  return { kind: 'estimate', value, text: formatEstimate(value), assumptions, ...(qualifierParts.length > 0 ? { qualifier: copy.dppQualifier(qualifierParts) } : {}) }
}

/** The wiki rule behind "classless damage never crits" (AMENDMENTS-015 B85(b): the Critical hit page). */
export const CRIT_RULE_SOURCE = 'https://terraria.wiki.gg/wiki/Critical_hit'

// --- gating (tracked progress) ---------------------------------------------------------------------------

export type GatingCell =
  /** gatedBy unverified / absent: Unknown — never "open" (SCORING_SPEC §1.4). */
  | { kind: 'unknown' }
  /** No boss gates it. Conditions (biome / event / world) are chips, never a block (B69/Q4). */
  | { kind: 'none'; conditions: string[] }
  /** Every boss gate is satisfied by the bosses the player marked defeated. */
  | { kind: 'met'; bosses: string[]; conditions: string[] }
  /** Bosses still to defeat (milestones resolved to their bosses: "Hardmode" → Wall of Flesh). */
  | { kind: 'gated'; missing: string[]; conditions: string[] }

/** `ep` is TRACKED-only effective progress (effectiveProgress(graph, progress) with no stage). */
export function gatingCell(w: Weapon, graph: ProgressionGraphLike, ep: ReadonlySet<string>, memo: Map<string, boolean> = new Map()): GatingCell {
  const availability: Availability = availabilityOf(w, graph, ep, memo)
  if (availability.status === 'unknown') return { kind: 'unknown' }
  if (availability.status === 'gated') return { kind: 'gated', missing: availability.missing, conditions: availability.conditions }
  const bosses = (getField(w, 'gatedBy').value as GatedBy).bosses
  return bosses.length === 0 ? { kind: 'none', conditions: availability.conditions } : { kind: 'met', bosses: [...bosses], conditions: availability.conditions }
}

// --- acquisition, tooltip, Lab -----------------------------------------------------------------------------

export type AcquisitionCell = { kind: 'unknown' } | { kind: 'none' } | { kind: 'routes'; titles: string[] }

/** How to obtain, summarized as the detail page's route headings (no difficulty score is invented). */
export function acquisitionCell(w: Weapon): AcquisitionCell {
  const view = getField(w, 'acquisition')
  if (view.status === 'unverified') return { kind: 'unknown' }
  return w.acquisition.length === 0 ? { kind: 'none' } : { kind: 'routes', titles: w.acquisition.map(routeTitle) }
}

export type TooltipCell = { kind: 'unknown' } | { kind: 'none' } | { kind: 'text'; text: string }

export function tooltipCell(w: Weapon): TooltipCell {
  const view = getField(w, 'behaviorText')
  if (view.status === 'unverified') return { kind: 'unknown' }
  return view.value === undefined || view.value === '' ? { kind: 'none' } : { kind: 'text', text: view.value as string }
}

// --- pros / cons -------------------------------------------------------------------------------------------

export interface ProsCons {
  pros: string[]
  cons: string[]
}

/**
 * Data-derived pros / cons (PRD P4-S1 AC3), each read from ONE verified field of this weapon by a fixed
 * rule — nothing relative to the other columns, nothing from an Unknown field (that cell already says
 * Unknown), nothing from the Lab's modeled parameters.
 */
export function prosCons(w: Weapon): ProsCons {
  const pros: string[] = []
  const cons: string[] = []
  const verified = (field: string) => {
    const view = getField(w, field)
    return view.status === 'verified' || view.status === 'editorial' ? view.value : undefined
  }
  const absent = (field: string) => getField(w, field).status === 'not-applicable'

  const autoReuse = verified('autoReuse')
  if (autoReuse === true) pros.push(copy.PRO_AUTO_REUSE)
  if (autoReuse === false) cons.push(copy.CON_NO_AUTO_REUSE)
  if (absent('manaCost') && absent('ammoClass') && absent('maxStack')) pros.push(copy.PRO_NO_RESOURCE)
  // Wiki "Explosives" category (weapon tags are the article's weapon-type categories).
  if (w.tags.includes('explosives')) pros.push(copy.PRO_EXPLOSIVE)

  const mana = verified('manaCost')
  if (typeof mana === 'number') cons.push(copy.conMana(mana))
  const ammo = verified('ammoClass')
  if (typeof ammo === 'string') cons.push(copy.conAmmo(ammoTypeLabel(ammo)))
  const stack = verified('maxStack')
  if (typeof stack === 'number') cons.push(copy.conConsumable(stack))
  if (verified('damageClass') === 'other') cons.push(copy.CON_CLASSLESS)
  if (w.tags.includes('unobtainable')) cons.push(copy.CON_UNOBTAINABLE)
  return { pros, cons }
}

/** Field labels the detail page has no row for, worded like this table's rows. */
const COMPARE_FIELD_LABELS: Readonly<Record<string, string>> = {
  behaviorText: copy.ROW_LABELS.tooltip,
  maxStack: copy.ROW_LABELS.consumable,
  reuseDelayTicks: 'Reuse delay',
}

/** A field's human label (the detail page's wording, else this table's row name). */
export function compareFieldLabel(field: string, w?: Pick<Weapon, 'acquisition'>): string {
  return COMPARE_FIELD_LABELS[field] ?? fieldLabel(field, w)
}

// --- column-level --------------------------------------------------------------------------------------------

/** Distinct verified damage classes, in column order (more than one = the mixed-class note). */
export function knownClasses(weapons: readonly Weapon[]): DamageClass[] {
  const out: DamageClass[] = []
  for (const w of weapons) {
    const view = getField(w, 'damageClass')
    if (view.status !== 'verified' && view.status !== 'editorial') continue
    const cls = view.value as DamageClass
    if (!out.includes(cls)) out.push(cls)
  }
  return out
}

/** "melee and magic" / "melee, ranged and magic" — lower-case class names for the mixed-class note. */
export function classList(classes: readonly DamageClass[]): string {
  return copy.andList(classes.map((c) => (c === 'other' ? 'classless' : CLASS_LABELS[c].toLowerCase())))
}

/** A weapon with at least this many Unknown cells gets the page-level Unknown-heavy notice. */
export const UNKNOWN_HEAVY_MIN = 3

/**
 * Every Unknown marker the weapon's column renders, in table order, labeled like the detail page's
 * partially-verified list. `statKeys` = the stat rows shown (a hidden crit row renders no cell).
 */
export function columnUnknowns(w: Weapon, statKeys: readonly StatKey[], gating: GatingCell): PartiallyVerifiedItem[] {
  const out: PartiallyVerifiedItem[] = []
  const add = (field: string) => out.push({ key: field, label: compareFieldLabel(field, w) })
  for (const key of statKeys) {
    const cell = statCell(w, key)
    if (cell.kind === 'unknown') add(cell.field)
  }
  if (gating.kind === 'unknown') add('gatedBy')
  if (acquisitionCell(w).kind === 'unknown') add('acquisition')
  if (tooltipCell(w).kind === 'unknown') add('behaviorText')
  return out
}

/** The stat rows the table shows for these weapons, in table order. */
export function shownStatKeys(weapons: readonly Weapon[]): StatKey[] {
  return STAT_GROUPS.flatMap((g) => g.keys.filter((k) => showStatRow(weapons, k)))
}

/** What the link held that isn't compared — said, never dropped silently. */
export function linkNotices(selection: CompareSelection, missing: readonly number[]): string[] {
  const out: string[] = []
  if (missing.length > 0) out.push(copy.missingIds(missing))
  if (selection.overflow > 0) out.push(copy.overflowIds(COMPARE_MAX))
  if (selection.duplicates > 0) out.push(copy.DUPLICATE_IDS)
  if (selection.malformed > 0) out.push(copy.MALFORMED_IDS)
  return out
}

/**
 * AMENDMENTS-016 B101d: a link naming what isn't compared shows (and announces) its notices once, then is
 * rewritten in place to the canonical link of what IS compared. undefined: the link is already canonical.
 */
export function linkCleanup(selection: CompareSelection, resolved: { weapons: readonly Weapon[]; missing: readonly number[] }): { notices: string[]; search: string } | undefined {
  const notices = linkNotices(selection, resolved.missing)
  return notices.length === 0 ? undefined : { notices, search: compareSearch(resolved.weapons.map((w) => w.id)) }
}

// --- picker + focus ------------------------------------------------------------------------------------------

/** How many recently viewed weapons the picker lists before typing. */
export const RECENT_MAX = 8

/** "i:1327" → 1327 (SearchDoc / recent refs); undefined for any other ref. */
export const refWeaponId = (ref: string): number | undefined => (/^i:\d+$/.test(ref) ? Number(ref.slice(2)) : undefined)

/** Recently viewed weapons (tc.v1.recent refs, newest first), at most RECENT_MAX; [] when none or storage is unavailable. */
export function recentWeaponIds(weapons: ReadonlyMap<number, Weapon>, readRefs: () => readonly string[] = readRecentRefs): number[] {
  const out: number[] = []
  for (const ref of readRefs()) {
    const id = refWeaponId(ref)
    if (id === undefined || out.includes(id) || !weapons.has(id)) continue
    out.push(id)
    if (out.length >= RECENT_MAX) break
  }
  return out
}

function readRecentRefs(): string[] {
  try {
    const result = loadDomain('recent')
    return result.kind === 'loaded' ? result.data.entries.map((e) => e.ref) : []
  } catch {
    return []
  }
}

/** The add button's DOM id (one at a time: empty state, one-weapon prompt or toolbar). Focus lands here after a removal. */
export const ADD_BUTTON_ID = 'compare-add'
/** DOM ids of each column's controls (focus returns to a column's Change button after the picker closes). */
export const changeButtonId = (weaponId: number) => `compare-change-${weaponId}`
export const removeButtonId = (weaponId: number) => `compare-remove-${weaponId}`
