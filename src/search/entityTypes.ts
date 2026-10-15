/**
 * Entity-type registry for global search (PRD P2-S4 AC2/AC5; DATA_SCHEMA_SPEC §2.10 + A5).
 *
 * Keyed by EVERY `SearchDocType`, so the compiler forces a label for each type the schema can
 * emit: when a later dataset (armor, items, buffs…) lands in search-docs.json its entities are
 * grouped, labelled and badged with no UI change. Type-only schema imports keep Zod out of the
 * shell bundle.
 */
import type { SearchDocType } from '../schemas'
import type { SpritePlaceholderVariant } from '../components/art/placeholderSprites'

export interface EntityTypeInfo {
  /** Row type badge (singular). */
  label: string
  /** Group heading and placeholder copy (plural). */
  plural: string
  /** Tie-break order for groups with equal best scores; also the placeholder's type order. */
  order: number
  /** Placeholder art when the entity has no sprite; "by-class" = the weapon damage-class silhouette. */
  placeholder: SpritePlaceholderVariant | 'by-class'
  /** meta.json `counts` key for this type's dataset (drives the placeholder / overlay copy). */
  countKey: string
}

export const ENTITY_TYPES: Readonly<Record<SearchDocType, EntityTypeInfo>> = {
  weapon: { label: 'Weapon', plural: 'Weapons', order: 0, placeholder: 'by-class', countKey: 'weapons' },
  boss: { label: 'Boss', plural: 'Bosses', order: 1, placeholder: 'creature', countKey: 'bosses' },
  item: { label: 'Item', plural: 'Items', order: 2, placeholder: 'material', countKey: 'items' },
  armor: { label: 'Armor', plural: 'Armor', order: 3, placeholder: 'material', countKey: 'armor' },
  accessory: { label: 'Accessory', plural: 'Accessories', order: 4, placeholder: 'material', countKey: 'accessories' },
  set: { label: 'Armor set', plural: 'Armor sets', order: 5, placeholder: 'material', countKey: 'armorSets' },
  enemy: { label: 'Enemy', plural: 'Enemies', order: 6, placeholder: 'creature', countKey: 'enemies' },
  buff: { label: 'Buff', plural: 'Buffs', order: 7, placeholder: 'material', countKey: 'buffs' },
}

export const SEARCH_DOC_TYPES = (Object.keys(ENTITY_TYPES) as SearchDocType[]).sort(
  (a, b) => ENTITY_TYPES[a].order - ENTITY_TYPES[b].order,
)

export interface SearchableCount {
  type: SearchDocType
  count: number
}

/** Shipped (count > 0) searchable types in registry order, from meta.json-style `counts`. */
export function searchableCounts(counts: Readonly<Record<string, number | undefined>>): SearchableCount[] {
  return SEARCH_DOC_TYPES.map((type) => ({ type, count: counts[ENTITY_TYPES[type].countKey] ?? 0 })).filter((c) => c.count > 0)
}

/** "Search weapons, bosses, enemies…" — names only datasets that have shipped (max 3). */
export function searchPlaceholder(shipped: readonly SearchableCount[]): string {
  const names = shipped.slice(0, 3).map((c) => ENTITY_TYPES[c.type].plural.toLowerCase())
  return names.length > 0 ? `Search ${names.join(', ')}…` : 'Search…'
}

/** "488 weapons, 18 bosses and 334 enemies" (empty string when nothing has shipped). */
export function searchScopeSummary(shipped: readonly SearchableCount[]): string {
  const parts = shipped.map((c) => `${c.count.toLocaleString('en-US')} ${ENTITY_TYPES[c.type].plural.toLowerCase()}`)
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}
