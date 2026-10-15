/**
 * Groups scored search rows by entity type (PRD P2-S4 AC2). Generic over whatever types the
 * index contains (AC5): groups come from the data, labels from the ENTITY_TYPES registry.
 *
 * Order: the group holding the best match comes first (registry order breaks ties), and rows keep
 * score order within a group — so the first option, which Enter activates, is the best match
 * overall ("zenith" + Enter → Zenith).
 */
import type { SearchDocType } from '../schemas'
import { ENTITY_TYPES } from './entityTypes'

export const DEFAULT_PER_GROUP = 5

export interface Scored<T> {
  item: T
  score: number
}

export interface Grouped<T> {
  type: SearchDocType
  label: string
  items: T[]
  total: number
}

/** `hits` must be sorted by descending score (MiniSearch order). */
export function groupByType<T extends { type: SearchDocType }>(hits: readonly Scored<T>[], perGroup = DEFAULT_PER_GROUP): Grouped<T>[] {
  const groups = new Map<SearchDocType, { best: number; group: Grouped<T> }>()
  for (const { item, score } of hits) {
    let entry = groups.get(item.type)
    if (!entry) {
      entry = { best: score, group: { type: item.type, label: ENTITY_TYPES[item.type].plural, items: [], total: 0 } }
      groups.set(item.type, entry)
    }
    entry.group.total += 1
    if (entry.group.items.length < perGroup) entry.group.items.push(item)
  }
  return [...groups.values()]
    .sort((a, b) => b.best - a.best || ENTITY_TYPES[a.group.type].order - ENTITY_TYPES[b.group.type].order)
    .map((entry) => entry.group)
}
