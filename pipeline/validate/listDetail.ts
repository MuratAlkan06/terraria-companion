/**
 * List ⊂ detail projection (DATA_SCHEMA_SPEC §5 "List vs detail rule"): a list record MUST be
 * exactly the projection of its detail record onto the list fields, and every detail record
 * has exactly one list record. Violations are E_LIST_DETAIL_DRIFT. `projectList` is the single
 * definition of the projection, for the emit stage to reuse.
 */
import { isDeepStrictEqual } from 'node:util'
import { LIST_FILES, type Dataset, type ItemCollectionKey } from './dataset'
import type { PipelineError } from './errors'

// wikiUrl added in P2-S7 (AMENDMENTS-007 B31): rows and cards link the record's exact wiki page
const BASE_FIELDS = ['id', 'name', 'slug', 'type', 'stage', 'rarity', 'sprite', 'tags', 'wikiUrl'] as const

export const LIST_FIELDS: Record<ItemCollectionKey, readonly string[]> = {
  // useAnimationTicks added in P2-S2: TO-VERIFY #10 showed the wiki's "Use time" is the game's
  // useAnimation (487/487 weapons), so lists need it to show use time with wiki parity.
  weapons: [...BASE_FIELDS, 'damageClass', 'damage', 'useTimeTicks', 'useAnimationTicks', 'labKind'],
  armor: [...BASE_FIELDS, 'slot', 'defense', 'setId'],
  accessories: [...BASE_FIELDS, 'categories'],
  items: [...BASE_FIELDS, 'category'],
}

/** Projection of a detail record onto its list fields (`labKind` = labBehavior.kind). Absent stays absent. */
export function projectList(key: ItemCollectionKey, detail: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of LIST_FIELDS[key]) {
    const value = field === 'labKind' ? (detail.labBehavior as { kind?: unknown } | undefined)?.kind : detail[field]
    if (value !== undefined) out[field] = value
  }
  return out
}

export function checkListDetail(lists: Partial<Record<ItemCollectionKey, unknown>>, ds: Dataset): PipelineError[] {
  const errors: PipelineError[] = []
  for (const key of Object.keys(lists) as ItemCollectionKey[]) {
    const file = LIST_FILES[key]
    const drift = (ref: string, detail: string, field?: string) =>
      errors.push({ code: 'E_LIST_DETAIL_DRIFT', file, ref, field, message: `${file} ${ref}${field ? ` ${field}` : ''}: ${detail}` })
    const list = lists[key]
    if (!Array.isArray(list)) {
      drift('(file)', 'expected a JSON array of list records')
      continue
    }
    const details = new Map((ds[key] as readonly { id: number }[]).map((d) => [d.id, d as unknown as Record<string, unknown>]))
    const seen = new Set<number>()
    list.forEach((entry: unknown, index) => {
      if (typeof entry !== 'object' || entry === null || typeof (entry as { id?: unknown }).id !== 'number') {
        return drift(`[${index}]`, 'list record has no numeric id')
      }
      const record = entry as Record<string, unknown>
      const id = record.id as number
      const ref = `i:${id}`
      if (seen.has(id)) return drift(ref, 'duplicate list record')
      seen.add(id)
      const detail = details.get(id)
      if (!detail) return drift(ref, 'list record has no detail record')
      const expected = projectList(key, detail)
      for (const field of Object.keys(record)) {
        if (!LIST_FIELDS[key].includes(field)) drift(ref, 'field is not a list field', field)
      }
      for (const field of LIST_FIELDS[key]) {
        if (!isDeepStrictEqual(record[field], expected[field])) {
          drift(ref, `list value ${JSON.stringify(record[field])} != detail projection ${JSON.stringify(expected[field])}`, field)
        }
      }
    })
    for (const id of details.keys()) if (!seen.has(id)) drift(`i:${id}`, 'detail record has no list record')
  }
  return errors
}
