/**
 * Weapon list facets (PRD P2-S3 AC2, UX_SPEC §3.3): class, stage, rarity — OR within a facet,
 * AND across facets. Pure functions over list records; the URL query string is the state
 * (`?class=melee,ranged&stage=unknown&rarity=8`), so filters survive back navigation and
 * can be shared.
 *
 * Honesty buckets:
 * - class "unclassified" = damageClass absent (AMENDMENTS-001 A1; offered only when present).
 * - stage "unknown" = stage absent. Stage is derived from gatedBy, which is currently
 *   underivable for every weapon (§2.2 / §7b) — so today every weapon sits in this bucket and
 *   nothing is ever presented as belonging to (or obtainable at) a stage it isn't verified for.
 * - rarity "unknown" = rarity absent (offered only when some record lacks rarity).
 */
import type { DamageClass, Stage } from '../../../../schemas'
import type { WeaponListRecord } from '../../../../data-access/types'
import { rarityColor, rarityLabel, asRarity, type Rarity } from '../../../../components/rarity'
import type { Facet, FacetOption } from '../../../../components/FilterBar'
import { STAGES } from '../../../stages'

export const FACET_IDS = ['class', 'stage', 'rarity'] as const
export type FacetId = (typeof FACET_IDS)[number]
export type WeaponFilters = Record<FacetId, readonly string[]>

export const EMPTY_FILTERS: WeaponFilters = { class: [], stage: [], rarity: [] }

export const UNCLASSIFIED = 'unclassified'
export const STAGE_UNKNOWN = 'unknown'
export const RARITY_UNKNOWN = 'unknown'

export const CLASS_OPTIONS: ReadonlyArray<{ value: DamageClass | typeof UNCLASSIFIED; label: string }> = [
  { value: 'melee', label: 'Melee' },
  { value: 'ranged', label: 'Ranged' },
  { value: 'magic', label: 'Magic' },
  { value: 'summon', label: 'Summon' },
  { value: 'other', label: 'Other' },
  { value: UNCLASSIFIED, label: 'Unclassified' },
]

export const STAGE_OPTIONS: ReadonlyArray<{ value: Stage | typeof STAGE_UNKNOWN; label: string }> = [
  ...STAGES.map((s) => ({ value: s.id, label: s.label })),
  { value: STAGE_UNKNOWN, label: 'Stage unknown' },
]

/** Rarity tiers in game order: Gray (-1) … Purple (11), then the special tiers. */
const RARITY_ORDER: readonly Rarity[] = [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 'rainbow', 'fiery-red', 'amber']

export function classBucket(w: Pick<WeaponListRecord, 'damageClass'>): string {
  return w.damageClass ?? UNCLASSIFIED
}
export function stageBucket(w: Pick<WeaponListRecord, 'stage'>): string {
  return w.stage ?? STAGE_UNKNOWN
}
export function rarityBucket(w: Pick<WeaponListRecord, 'rarity'>): string {
  return w.rarity === undefined ? RARITY_UNKNOWN : String(w.rarity)
}

const BUCKET: Record<FacetId, (w: WeaponListRecord) => string> = {
  class: classBucket,
  stage: stageBucket,
  rarity: rarityBucket,
}

/** True when `w` passes every facet except `skip` (used for facet counts). */
export function matchesFilters(w: WeaponListRecord, filters: WeaponFilters, skip?: FacetId): boolean {
  return FACET_IDS.every((id) => id === skip || filters[id].length === 0 || filters[id].includes(BUCKET[id](w)))
}

export function applyFilters(list: readonly WeaponListRecord[], filters: WeaponFilters): WeaponListRecord[] {
  return list.filter((w) => matchesFilters(w, filters))
}

/** Per option: how many records would match if it were selected, given the OTHER facets. */
export function facetCounts(list: readonly WeaponListRecord[], filters: WeaponFilters, facet: FacetId): Map<string, number> {
  const counts = new Map<string, number>()
  for (const w of list) {
    if (!matchesFilters(w, filters, facet)) continue
    const bucket = BUCKET[facet](w)
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1)
  }
  return counts
}

/** Valid values per facet for this dataset (unknown URL values are dropped, never guessed). */
export function facetValues(list: readonly WeaponListRecord[]): Record<FacetId, readonly string[]> {
  const present = new Set(list.map(rarityBucket))
  const rarity = RARITY_ORDER.map(String).filter((r) => present.has(r))
  // Keep any tier the data has that the order above doesn't know yet, then Unknown last.
  for (const r of present) if (r !== RARITY_UNKNOWN && !rarity.includes(r)) rarity.push(r)
  if (present.has(RARITY_UNKNOWN)) rarity.push(RARITY_UNKNOWN)
  // Like "Rarity unknown": "Unclassified" is offered only when some weapon has no class
  // (an option that can only ever count 0 is noise).
  const hasUnclassified = list.some((w) => classBucket(w) === UNCLASSIFIED)
  return {
    class: CLASS_OPTIONS.map((o) => o.value).filter((v) => v !== UNCLASSIFIED || hasUnclassified),
    stage: STAGE_OPTIONS.map((o) => o.value),
    rarity,
  }
}

export function parseFilters(params: URLSearchParams, valid: Record<FacetId, readonly string[]>): WeaponFilters {
  const read = (id: FacetId) => {
    const requested = new Set((params.get(id) ?? '').split(',').map((v) => v.trim()).filter(Boolean))
    // Canonical order = option order, so equal selections serialize identically.
    return valid[id].filter((v) => requested.has(v))
  }
  return { class: read('class'), stage: read('stage'), rarity: read('rarity') }
}

/** Writes the facets into `params` (other params are preserved); empty facets are removed. */
export function writeFilters(params: URLSearchParams, filters: WeaponFilters): URLSearchParams {
  const next = new URLSearchParams(params)
  for (const id of FACET_IDS) {
    if (filters[id].length > 0) next.set(id, filters[id].join(','))
    else next.delete(id)
  }
  return next
}

export function toggleFilter(filters: WeaponFilters, facet: FacetId, value: string, order: readonly string[]): WeaponFilters {
  const current = filters[facet]
  const nextSet = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
  return { ...filters, [facet]: order.filter((v) => nextSet.includes(v)) }
}

export function activeFilterCount(filters: WeaponFilters): number {
  return FACET_IDS.reduce((n, id) => n + filters[id].length, 0)
}

export function rarityOptionLabel(value: string): string {
  if (value === RARITY_UNKNOWN) return 'Rarity unknown'
  const rarity = asRarity(/^-?\d+$/.test(value) ? Number(value) : value)
  return rarity === undefined ? value : rarityLabel(rarity)
}

/** Facet definitions with counts for the FilterBar. */
export function buildFacets(list: readonly WeaponListRecord[], filters: WeaponFilters): Facet[] {
  const valid = facetValues(list)
  const withCounts = (facet: FacetId, options: ReadonlyArray<Omit<FacetOption, 'count'>>): FacetOption[] => {
    const counts = facetCounts(list, filters, facet)
    return options.map((o) => ({ ...o, count: counts.get(o.value) ?? 0 }))
  }
  return [
    { id: 'class', label: 'Class', options: withCounts('class', CLASS_OPTIONS.filter((o) => valid.class.includes(o.value))) },
    { id: 'stage', label: 'Game stage', options: withCounts('stage', STAGE_OPTIONS) },
    {
      id: 'rarity',
      label: 'Rarity',
      options: withCounts(
        'rarity',
        valid.rarity.map((value) => {
          const rarity = value === RARITY_UNKNOWN ? undefined : asRarity(/^-?\d+$/.test(value) ? Number(value) : value)
          return { value, label: rarityOptionLabel(value), color: rarity === undefined ? undefined : rarityColor(rarity) }
        }),
      ),
    },
  ]
}

/** Stable browse order: by name (locale-aware), then id. */
export function sortForBrowse(list: readonly WeaponListRecord[]): WeaponListRecord[] {
  const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })
  return [...list].sort((a, b) => collator.compare(a.name, b.name) || a.id - b.id)
}
