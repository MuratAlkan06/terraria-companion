/**
 * LabBrowserPanel model (PRD P3-S2 AC1/AC2, UX_SPEC §3.4): every weapon in the dataset, searchable
 * and filterable without leaving the arena. Pure functions (Node-tested against the real data).
 *
 * Search: a local, case- and accent-insensitive match on weapon names — every word typed must
 * appear in the name ("night edge" finds Night's Edge; "sdmg" finds S.D.M.G.). Deliberately not the
 * site's MiniSearch index: that index spans every entity type and loads with OmniSearch, while the
 * Lab already holds every weapon record, and a substring filter over ~500 names is instant and
 * predictable (no fuzzy surprises in a list the user is scanning).
 *
 * Facets — OR within a facet, AND across facets; each option's count assumes the OTHER facets and
 * the search (as on /weapons):
 * - class / stage (incl. "Stage unknown") / rarity: the /weapons buckets (../db/weapons/weaponFilters.ts);
 *   a stage no weapon is in is not offered.
 * - source: how the weapon is obtained (crafted, dropped, bought, …). A weapon with several routes
 *   is in each of their buckets; no verified route = "Source unknown" (never guessed).
 * - damage: base-damage bands; unverified damage = "Damage unknown".
 *
 * Simulated or not comes from `labStatus` — the engine's verdict on the record plus what the Lab
 * can equip — never a per-weapon list: a weapon whose data gains archetype params lights up as
 * equippable on its own, with no UI change.
 */
import type { Facet, FacetOption } from '../../../components/FilterBar'
import { asRarity, rarityColor } from '../../../components/rarity'
import { slugify } from '../../../data-access'
import type { Weapon } from '../../../data-access/types'
import { labStatus, type LabStatus } from '../../../lab/labWeapons'
import type { Acquisition } from '../../../schemas'
import { CLASS_OPTIONS, classBucket, facetValues, RARITY_UNKNOWN, rarityBucket, rarityOptionLabel, STAGE_OPTIONS, stageBucket } from '../db/weapons/weaponFilters'

export const LAB_FACET_IDS = ['class', 'stage', 'rarity', 'source', 'damage'] as const
export type LabFacetId = (typeof LAB_FACET_IDS)[number]
export type LabFilters = Readonly<Record<LabFacetId, readonly string[]>>

export const EMPTY_LAB_FILTERS: LabFilters = { class: [], stage: [], rarity: [], source: [], damage: [] }

/** What the browser shows: its search text and filters (kept by the Lab page across panel/sheet remounts). */
export interface LabBrowserState {
  query: string
  filters: LabFilters
}

export const INITIAL_BROWSER_STATE: LabBrowserState = { query: '', filters: EMPTY_LAB_FILTERS }

/** The browser's search box (focus returns there when a requested row is filtered out). */
export const searchInputId = (name: string) => `${name}-search`

export const SOURCE_UNKNOWN = 'unknown'
export const DAMAGE_UNKNOWN = 'unknown'

/** Acquisition methods in display order (schema `Acquisition.method`), then the honest Unknown. */
export const SOURCE_OPTIONS: ReadonlyArray<{ value: Acquisition['method'] | typeof SOURCE_UNKNOWN; label: string }> = [
  { value: 'craft', label: 'Crafted' },
  { value: 'drop', label: 'Dropped' },
  { value: 'purchase', label: 'Bought' },
  { value: 'loot', label: 'Found in containers' },
  { value: 'fishing', label: 'Fished' },
  { value: 'other', label: 'Other' },
  { value: SOURCE_UNKNOWN, label: 'Source unknown' },
]

/** Base-damage bands (inclusive), low to high. */
export const DAMAGE_BANDS: ReadonlyArray<{ value: string; label: string; min: number; max: number }> = [
  { value: '0-19', label: 'Under 20', min: 0, max: 19 },
  { value: '20-39', label: '20–39', min: 20, max: 39 },
  { value: '40-59', label: '40–59', min: 40, max: 59 },
  { value: '60-99', label: '60–99', min: 60, max: 99 },
  { value: '100+', label: '100 and up', min: 100, max: Infinity },
]

export interface LabBrowserRow {
  weapon: Weapon
  status: LabStatus
  /** Choosing it equips it; otherwise choosing it shows its LimitationCard. */
  simulated: boolean
  /** Normalized name for the search (accent-free, lowercase, words joined by "-"). */
  key: string
  /** The bucket(s) the weapon sits in, per facet. */
  buckets: Readonly<Record<LabFacetId, readonly string[]>>
}

export function sourceBuckets(weapon: Pick<Weapon, 'acquisition'>): string[] {
  const methods = new Set(weapon.acquisition.map((route) => route.method))
  const present = SOURCE_OPTIONS.map((o) => o.value).filter((value) => methods.has(value as Acquisition['method']))
  return present.length > 0 ? present : [SOURCE_UNKNOWN]
}

export function damageBucket(weapon: Pick<Weapon, 'damage'>): string {
  const { damage } = weapon
  if (damage === undefined) return DAMAGE_UNKNOWN
  return DAMAGE_BANDS.find((band) => damage >= band.min && damage <= band.max)?.value ?? DAMAGE_UNKNOWN
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

/** Every weapon as a browser row, in browse order (by name, then id). */
export function browserRows(weapons: Iterable<Weapon>): LabBrowserRow[] {
  return [...weapons]
    .map((weapon): LabBrowserRow => {
      const status = labStatus(weapon)
      return {
        weapon,
        status,
        simulated: status.kind === 'equippable',
        key: slugify(weapon.name),
        buckets: {
          class: [classBucket(weapon)],
          stage: [stageBucket(weapon)],
          rarity: [rarityBucket(weapon)],
          source: sourceBuckets(weapon),
          damage: [damageBucket(weapon)],
        },
      }
    })
    .sort((a, b) => collator.compare(a.weapon.name, b.weapon.name) || a.weapon.id - b.weapon.id)
}

/** The words of a search, normalized like row keys ("Night's  Edge" → ["nights", "edge"]). */
export function queryWords(query: string): string[] {
  return slugify(query).split('-').filter(Boolean)
}

export function matchesQuery(row: Pick<LabBrowserRow, 'key'>, words: readonly string[]): boolean {
  if (words.length === 0) return true
  const compact = row.key.replaceAll('-', '')
  return words.every((word) => row.key.includes(word) || compact.includes(word))
}

/** True when `row` passes the search and every facet except `skip` (facet counts skip their own). */
export function matchesLabFilters(row: LabBrowserRow, filters: LabFilters, words: readonly string[], skip?: LabFacetId): boolean {
  if (!matchesQuery(row, words)) return false
  return LAB_FACET_IDS.every((id) => id === skip || filters[id].length === 0 || row.buckets[id].some((bucket) => filters[id].includes(bucket)))
}

export function filterRows(rows: readonly LabBrowserRow[], filters: LabFilters, query: string): LabBrowserRow[] {
  const words = queryWords(query)
  return rows.filter((row) => matchesLabFilters(row, filters, words))
}

/**
 * Options each facet offers for this dataset (Unknown buckets only when some weapon is in them).
 * A stage no weapon is in isn't offered either, like "Unclassified": an option that can only ever
 * count 0 is noise (design review P3-S2/S3).
 */
export function labFacetValues(rows: readonly LabBrowserRow[]): Record<LabFacetId, readonly string[]> {
  const base = facetValues(rows.map((r) => r.weapon))
  const present = (id: LabFacetId) => new Set(rows.flatMap((r) => r.buckets[id]))
  const stages = present('stage')
  const sources = present('source')
  const damage = present('damage')
  return {
    class: base.class,
    stage: base.stage.filter((value) => stages.has(value)),
    rarity: base.rarity,
    source: SOURCE_OPTIONS.map((o) => o.value).filter((value) => sources.has(value)),
    damage: [...DAMAGE_BANDS.map((b) => b.value), ...(damage.has(DAMAGE_UNKNOWN) ? [DAMAGE_UNKNOWN] : [])],
  }
}

function optionLabel(id: LabFacetId, value: string): Omit<FacetOption, 'count'> {
  switch (id) {
    case 'class':
      return { value, label: CLASS_OPTIONS.find((o) => o.value === value)?.label ?? value }
    case 'stage':
      return { value, label: STAGE_OPTIONS.find((o) => o.value === value)?.label ?? value }
    case 'rarity': {
      const rarity = value === RARITY_UNKNOWN ? undefined : asRarity(/^-?\d+$/.test(value) ? Number(value) : value)
      return { value, label: rarityOptionLabel(value), color: rarity === undefined ? undefined : rarityColor(rarity) }
    }
    case 'source':
      return { value, label: SOURCE_OPTIONS.find((o) => o.value === value)?.label ?? value }
    case 'damage':
      return { value, label: value === DAMAGE_UNKNOWN ? 'Damage unknown' : (DAMAGE_BANDS.find((b) => b.value === value)?.label ?? value) }
  }
}

const FACET_LABELS: Record<LabFacetId, string> = {
  class: 'Class',
  stage: 'Game stage',
  rarity: 'Rarity',
  source: 'Source',
  damage: 'Base damage',
}

/** FilterBar facets with counts (given the other facets and the search). */
export function buildLabFacets(rows: readonly LabBrowserRow[], filters: LabFilters, query: string): Facet[] {
  const valid = labFacetValues(rows)
  const words = queryWords(query)
  return LAB_FACET_IDS.map((id) => {
    const counts = new Map<string, number>()
    for (const row of rows) {
      if (!matchesLabFilters(row, filters, words, id)) continue
      for (const bucket of row.buckets[id]) counts.set(bucket, (counts.get(bucket) ?? 0) + 1)
    }
    return { id, label: FACET_LABELS[id], options: valid[id].map((value) => ({ ...optionLabel(id, value), count: counts.get(value) ?? 0 })) }
  })
}

/** Adds or removes one option, keeping the facet's canonical order. */
export function toggleLabFilter(filters: LabFilters, facet: LabFacetId, value: string, order: readonly string[]): LabFilters {
  const current = filters[facet]
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
  return { ...filters, [facet]: order.filter((v) => next.includes(v)) }
}

export function activeLabFilterCount(filters: LabFilters): number {
  return LAB_FACET_IDS.reduce((n, id) => n + filters[id].length, 0)
}

export function isLabFacetId(id: string): id is LabFacetId {
  return (LAB_FACET_IDS as readonly string[]).includes(id)
}

/** How many of `rows` the Lab simulates. */
export function simulatedCount(rows: readonly LabBrowserRow[]): number {
  return rows.reduce((n, row) => n + (row.simulated ? 1 : 0), 0)
}
