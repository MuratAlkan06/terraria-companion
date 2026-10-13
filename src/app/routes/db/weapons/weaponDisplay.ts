/**
 * Pure display rules for weapon pages (PRD P2-S3 AC3/AC4). Every verified-or-Unknown field is
 * read through `getField` (DATA_SCHEMA_SPEC §2.1 rule 5): "unverified" renders Unknown,
 * "not-applicable" omits the row, values render formatted.
 *
 * Binding rulings encoded here:
 * - B14: "Use time" displays `useAnimationTicks` (wiki parity); `useTimeTicks` is sim-only.
 * - B17: summon crit is not applicable (row omitted); classless ("other") crit is Unknown;
 *   shown crit = universal 4% base + the weapon's bonus (`critPct`).
 */
import type { Acquisition, DamageClass, DropSource, Weapon } from '../../../../schemas'
import { getField, type FieldView } from '../../../../schemas/getField'
import { getStageInfo, isStage } from '../../../stages'

/** Universal base critical strike chance added to every weapon's bonus (B17 / sim convention). */
export const BASE_CRIT_PCT = 4

export const CLASS_LABELS: Record<DamageClass, string> = {
  melee: 'Melee',
  ranged: 'Ranged',
  magic: 'Magic',
  summon: 'Summon',
  other: 'Other',
}

export interface StatRow {
  key: string
  label: string
  /** Dot-path read through getField (also the data-unknown-field of an Unknown marker). */
  field: string
  view: FieldView
  /** Formatted value; present for verified/editorial views. */
  text?: string
}

/** Formats a plain number without float noise (6.5 → "6.5", 4.75 → "4.75"). */
export function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)))
}

/** Crit view per B17. */
export function critView(w: Weapon): FieldView {
  if (w.damageClass === 'summon') return { status: 'not-applicable' }
  const view = getField(w, 'critPct')
  if (w.damageClass === 'other' && view.status === 'not-applicable') return { status: 'unverified' }
  return view
}

/** Lowercase kebab slug → "Title Case" (fallback label when no name index is loaded). */
export function humanizeSlug(slug: string): string {
  return slug
    .split('-')
    .map((part) => (/^[ivx]+$/.test(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ')
}

/**
 * Ammo TYPE per `ammoClass` slug (design review P2-S3 #2). The slug names the class's
 * representative item (every bullet gun is "musket-ball"), so printing that item would imply it
 * is the only ammo accepted. Labels follow the wiki's Ammunition page: its section headings
 * (Arrows, Bullets, Rockets, Darts, Flares — Seeds are listed under Darts: "Seeds are
 * technically a type of dart") and its "Other types" entries, pluralised where the type covers
 * several items or is countable — https://terraria.wiki.gg/wiki/Ammunition (checked 2026-10-12).
 * Acorns (1.4.5, not yet on that page): https://terraria.wiki.gg/wiki/Acorn_Slingshot.
 */
export const AMMO_TYPE_LABELS: Readonly<Record<string, string>> = {
  'wooden-arrow': 'Arrows',
  'musket-ball': 'Bullets',
  'rocket-i': 'Rockets',
  seed: 'Darts',
  flare: 'Flares',
  'fallen-star': 'Fallen Stars',
  gel: 'Gel',
  'sand-block': 'Sand',
  'stynger-bolt': 'Stynger Bolts',
  'candy-corn': 'Candy Corn',
  'explosive-jack-o-lantern': "Explosive Jack 'O Lanterns",
  stake: 'Stakes',
  ale: 'Ale',
  snowball: 'Snowballs',
  nail: 'Nails',
  'copper-coin': 'Coins',
  acorn: 'Acorns',
}

/**
 * Ammo-type label for a slug. An unmapped class (new game version) never claims a single item:
 * it names the representative item as an example of a wider type. A test keeps every shipped
 * slug mapped.
 */
export function ammoTypeLabel(slug: string): string {
  return AMMO_TYPE_LABELS[slug] ?? `${humanizeSlug(slug)} and compatible ammo`
}

/** Stat rows for the StatsPanel, in display order, with not-applicable rows removed. */
export function weaponStatRows(w: Weapon): StatRow[] {
  const rows: StatRow[] = []
  const add = (key: string, label: string, field: string, view: FieldView, format: (value: unknown) => string) => {
    if (view.status === 'not-applicable') return
    rows.push({
      key,
      label,
      field,
      view,
      text: view.status === 'unverified' || view.value === undefined ? undefined : format(view.value),
    })
  }
  add('damage', 'Damage', 'damage', getField(w, 'damage'), (v) => formatNumber(v as number))
  add('crit', 'Critical chance', 'critPct', critView(w), (v) => `${BASE_CRIT_PCT + (v as number)}%`)
  add('useTime', 'Use time', 'useAnimationTicks', getField(w, 'useAnimationTicks'), (v) => `${v as number} ticks`)
  add('knockback', 'Knockback', 'knockback', getField(w, 'knockback'), (v) => formatNumber(v as number))
  add('mana', 'Mana cost', 'manaCost', getField(w, 'manaCost'), (v) => String(v))
  add('ammo', 'Ammo', 'ammoClass', getField(w, 'ammoClass'), (v) => ammoTypeLabel(v as string))
  add('autoReuse', 'Auto-reuse', 'autoReuse', getField(w, 'autoReuse'), (v) => (v ? 'Yes' : 'No'))
  return rows
}

const FIELD_LABELS: Record<string, string> = {
  damage: 'Damage',
  critPct: 'Critical chance',
  useAnimationTicks: 'Use time',
  useTimeTicks: 'Use time (raw)',
  knockback: 'Knockback',
  manaCost: 'Mana cost',
  ammoClass: 'Ammo',
  autoReuse: 'Auto-reuse',
  damageClass: 'Class',
  rarity: 'Rarity',
  stage: 'Game stage',
  gatedBy: 'Required progress',
  acquisition: 'How to obtain',
}

/** Per-route field labels, as the route block words them ("Price:", "Conditions:"). */
const ROUTE_FIELD_LABELS: Record<string, string> = {
  priceCopper: 'price',
  conditions: 'conditions',
}

/** The heading a route block shows (also names the route in the partially-verified details). */
export function routeTitle(route: Acquisition): string {
  switch (route.method) {
    case 'craft':
      return route.recipeIds.length > 1 ? `Crafted (${route.recipeIds.length} recipes)` : 'Crafted'
    case 'drop':
      return `Dropped by or found in ${route.dropIds.length} ${route.dropIds.length === 1 ? 'source' : 'sources'}`
    case 'purchase':
      return `Sold by ${route.npcName}`
    case 'loot':
      return `Found in ${route.containers.join(', ')}`
    case 'fishing':
      return 'Fished up'
    case 'other':
      return 'Other'
  }
}

/**
 * Human label for an unverified weapon dot-path, worded like the on-page section it sits in
 * ("Sold by Demolitionist — price"), for the partially-verified badge details.
 */
export function fieldLabel(path: string, weapon?: Pick<Weapon, 'acquisition'>): string {
  const match = /^acquisition\.(\d+)\.(\w+)$/.exec(path)
  if (match) {
    const route = weapon?.acquisition[Number(match[1])]
    const where = route ? routeTitle(route) : `Way to obtain #${Number(match[1]) + 1}`
    return `${where} — ${ROUTE_FIELD_LABELS[match[2]] ?? match[2]}`
  }
  return FIELD_LABELS[path] ?? path
}

/**
 * Weapon-level paths the detail page can render as Unknown. Any unverified path outside this
 * set would be silently dropped, so a test asserts the dataset never lists one (AC4).
 */
export const UNKNOWN_CAPABLE_PATHS: readonly RegExp[] = [
  /^(damage|critPct|useAnimationTicks|knockback|manaCost|ammoClass|autoReuse)$/,
  /^(damageClass|rarity|stage|gatedBy|acquisition)$/,
  /^acquisition\.\d+\.(priceCopper|conditions)$/,
]

// ---------------------------------------------------------------------------------------------
// Acquisition formatting

/** Copper → "1 platinum 5 gold 20 silver 3 copper" (zero denominations omitted). */
export function formatCoins(copper: number): string {
  const parts: Array<[number, string]> = [
    [Math.floor(copper / 1_000_000), 'platinum'],
    [Math.floor((copper % 1_000_000) / 10_000), 'gold'],
    [Math.floor((copper % 10_000) / 100), 'silver'],
    [copper % 100, 'copper'],
  ]
  const text = parts
    .filter(([n]) => n > 0)
    .map(([n, unit]) => `${n} ${unit}`)
    .join(' ')
  return text || '0 copper'
}

const PERCENT = new Intl.NumberFormat('en', { style: 'percent', maximumSignificantDigits: 3 })

/** Drop rate fraction (0,1] → "3.33%" (3 significant digits; 1 → "100%"). */
export function formatRate(rate: number): string {
  return PERCENT.format(rate)
}

export function formatQuantity(q: { min: number; max: number }): string {
  return q.min === q.max ? String(q.min) : `${q.min}–${q.max}`
}

export const DIFFICULTIES = ['classic', 'expert', 'master'] as const
export type DifficultyKey = (typeof DIFFICULTIES)[number]
export const DIFFICULTY_LABELS: Record<DifficultyKey, string> = { classic: 'Classic', expert: 'Expert', master: 'Master' }

/** True when the drop uses the uniform `{min,max}` quantity form (AMENDMENTS-002 B1). */
export function isUniformQuantity(q: DropSource['quantity']): q is { min: number; max: number } {
  return 'min' in q && 'max' in q
}

/** The wiki page a drop record was read from (Cargo Drops source first). */
export function dropSourceUrl(drop: DropSource): string | undefined {
  return (drop._prov.sources.find((s) => s.kind === 'cargo:Drops') ?? drop._prov.sources[0])?.url
}

export interface DropCell {
  /** Dot-path on the DROP record (read through getField with the drop's own _prov). */
  field: string
  view: FieldView
}

export interface DropTableRow {
  difficulty: DifficultyKey
  rate: DropCell
  quantity: DropCell
}

/**
 * The cells a drop table shows, one row per difficulty: the single source of truth for the
 * table renderer, for grouping identical tables and for counting the page's Unknowns.
 */
export function dropTableRows(drop: DropSource): DropTableRow[] {
  const uniform = isUniformQuantity(drop.quantity)
  return DIFFICULTIES.map((difficulty) => {
    const rateField = `rates.${difficulty}`
    const quantityField = uniform ? 'quantity' : `quantity.${difficulty}`
    return {
      difficulty,
      rate: { field: rateField, view: getField(drop, rateField) },
      quantity: { field: quantityField, view: getField(drop, quantityField) },
    }
  })
}

/**
 * Identity of everything a drop card displays besides the source name. Undefined when any shown
 * value is Unknown: those cards stay one-per-record so every Unknown names its own source.
 */
function dropDisplayKey(drop: DropSource): string | undefined {
  const conditions = getField(drop, 'conditions')
  const views = [...dropTableRows(drop).flatMap((row) => [row.rate.view, row.quantity.view]), conditions]
  if (views.some((view) => view.status === 'unverified')) return undefined
  return JSON.stringify([views.map((view) => [view.status, view.value]), drop.source.treasureBag === true])
}

/**
 * Groups drop sources whose cards would be identical (same rates, quantities, conditions and
 * Treasure Bag flag), keeping first-appearance order: Bomb's eight slimes with the same 0.313%
 * bonus drop render as one table listing all eight instead of eight copies.
 */
export function groupDropSources(drops: readonly DropSource[]): DropSource[][] {
  const groups: DropSource[][] = []
  const byKey = new Map<string, DropSource[]>()
  for (const drop of drops) {
    const key = dropDisplayKey(drop)
    const existing = key === undefined ? undefined : byKey.get(key)
    if (existing) {
      existing.push(drop)
    } else {
      const group = [drop]
      groups.push(group)
      if (key !== undefined) byKey.set(key, group)
    }
  }
  return groups
}

export type AcquisitionNeedsOf = { recipes: boolean; drops: boolean; gates: boolean }

/** Which lazily loaded indexes the acquisition section needs for this weapon. */
export function acquisitionNeeds(w: Weapon): AcquisitionNeedsOf {
  const gate = getField(w, 'gatedBy')
  return {
    recipes: w.acquisition.some((a) => a.method === 'craft'),
    drops: w.acquisition.some((a) => a.method === 'drop'),
    gates: gate.status === 'verified' && ((gate.value as Weapon['gatedBy'])?.bosses.length ?? 0) > 0,
  }
}

/** Stage label for a known stage (callers render UnknownValue when the stage is unverified). */
export function stageLabel(stage: string, short = false): string {
  if (!isStage(stage)) return stage
  const info = getStageInfo(stage)
  return short ? info.shortLabel : info.label
}
