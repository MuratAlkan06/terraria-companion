/**
 * Item encyclopedia facets (P6, AMENDMENTS-016; UX_SPEC §3.10 category list): category and game stage —
 * OR within a facet, AND across facets — plus a name filter. Pure functions over list records; the URL
 * query string is the state (`?category=tool,hook&stage=unknown&q=pick`), so filters survive back
 * navigation and can be shared.
 *
 * Honesty bucket: stage "unknown" = stage absent (list records carry no `_prov`; a stage is derived from
 * verified gating, so most items have none). Nothing is ever presented as belonging to a stage it isn't
 * verified for.
 */
import type { Facet, FacetOption } from '../../../../components/FilterBar'
import type { ItemListRecord } from '../../../../data-access/types'
import type { ItemCategory } from '../../../../schemas'
import { STAGES } from '../../../stages'
import { ITEM_CATEGORIES } from './itemDisplay'

export const ITEM_FACET_IDS = ['category', 'stage'] as const
export type ItemFacetId = (typeof ITEM_FACET_IDS)[number]
export interface ItemFilters {
  category: readonly string[]
  stage: readonly string[]
  /** Name filter (trimmed; '' = none). */
  q: string
}

export const EMPTY_ITEM_FILTERS: ItemFilters = { category: [], stage: [], q: '' }
export const STAGE_UNKNOWN = 'unknown'
/** Longest name filter kept in the URL (the longest item name is far shorter). */
export const MAX_QUERY_LENGTH = 60

const STAGE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [...STAGES.map((s) => ({ value: s.id, label: s.label })), { value: STAGE_UNKNOWN, label: 'Stage unknown' }]

const BUCKET: Record<ItemFacetId, (i: ItemListRecord) => string> = {
  category: (i) => i.category,
  stage: (i) => i.stage ?? STAGE_UNKNOWN,
}

/** Case- and accent-insensitive words of a name or query. */
export function nameWords(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter(Boolean)
}

/** Every query word is the start of some word of the name ("pick cop" matches "Copper Pickaxe"). */
export function matchesName(name: string, query: string): boolean {
  const q = nameWords(query)
  if (q.length === 0) return true
  const words = nameWords(name)
  return q.every((w) => words.some((n) => n.startsWith(w)))
}

export function matchesItemFilters(i: ItemListRecord, filters: ItemFilters, skip?: ItemFacetId): boolean {
  return ITEM_FACET_IDS.every((id) => id === skip || filters[id].length === 0 || filters[id].includes(BUCKET[id](i))) && matchesName(i.name, filters.q)
}

export function applyItemFilters(list: readonly ItemListRecord[], filters: ItemFilters): ItemListRecord[] {
  return list.filter((i) => matchesItemFilters(i, filters))
}

/** Valid values per facet (unknown URL values are dropped, never guessed). */
export function itemFacetValues(): Record<ItemFacetId, readonly string[]> {
  return { category: ITEM_CATEGORIES.map((c) => c.id), stage: STAGE_OPTIONS.map((o) => o.value) }
}

export function parseItemFilters(params: URLSearchParams): ItemFilters {
  const valid = itemFacetValues()
  const read = (id: ItemFacetId) => {
    const requested = new Set((params.get(id) ?? '').split(',').map((v) => v.trim()).filter(Boolean))
    return valid[id].filter((v) => requested.has(v))
  }
  return { category: read('category'), stage: read('stage'), q: (params.get('q') ?? '').trim().slice(0, MAX_QUERY_LENGTH) }
}

/** Writes the filters into `params` (other params kept); empty facets / query are removed. */
export function writeItemFilters(params: URLSearchParams, filters: ItemFilters): URLSearchParams {
  const next = new URLSearchParams(params)
  for (const id of ITEM_FACET_IDS) {
    if (filters[id].length > 0) next.set(id, filters[id].join(','))
    else next.delete(id)
  }
  if (filters.q.trim()) next.set('q', filters.q.trim().slice(0, MAX_QUERY_LENGTH))
  else next.delete('q')
  return next
}

export function toggleItemFilter(filters: ItemFilters, facet: ItemFacetId, value: string): ItemFilters {
  const order = itemFacetValues()[facet]
  const current = filters[facet]
  const nextSet = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
  return { ...filters, [facet]: order.filter((v) => nextSet.includes(v)) }
}

export function activeItemFilterCount(filters: ItemFilters): number {
  return filters.category.length + filters.stage.length + (filters.q ? 1 : 0)
}

/** Per option: records that would match if it were selected, given the other facets and the name filter. */
function counts(list: readonly ItemListRecord[], filters: ItemFilters, facet: ItemFacetId): Map<string, number> {
  const out = new Map<string, number>()
  for (const i of list) {
    if (!matchesItemFilters(i, filters, facet)) continue
    const b = BUCKET[facet](i)
    out.set(b, (out.get(b) ?? 0) + 1)
  }
  return out
}

/** FilterBar facets with counts. Categories with no record at all are left out (an option that can only count 0 is noise). */
export function buildItemFacets(list: readonly ItemListRecord[], filters: ItemFilters): Facet[] {
  const present = new Set(list.map((i) => i.category))
  const withCounts = (facet: ItemFacetId, options: ReadonlyArray<Omit<FacetOption, 'count'>>): FacetOption[] => {
    const c = counts(list, filters, facet)
    return options.map((o) => ({ ...o, count: c.get(o.value) ?? 0 }))
  }
  return [
    { id: 'category', label: 'Category', options: withCounts('category', ITEM_CATEGORIES.filter((c) => present.has(c.id)).map((c) => ({ value: c.id, label: c.label }))) },
    { id: 'stage', label: 'Game stage', options: withCounts('stage', STAGE_OPTIONS) },
  ]
}

/** Items per category (the hub tiles). */
export function categoryCounts(list: readonly ItemListRecord[]): Map<ItemCategory, number> {
  const out = new Map<ItemCategory, number>()
  for (const i of list) out.set(i.category, (out.get(i.category) ?? 0) + 1)
  return out
}

/** Stable browse order: by name (locale-aware), then id. */
export function sortItemsForBrowse(list: readonly ItemListRecord[]): ItemListRecord[] {
  const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })
  return [...list].sort((a, b) => collator.compare(a.name, b.name) || a.id - b.id)
}
