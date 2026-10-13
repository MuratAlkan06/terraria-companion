/**
 * §7a-11 (runs only when the dataset provides search-docs.json): every searchable entity
 * appears exactly once and every SearchDoc ref resolves to an entity of the matching type.
 */
import { SearchDoc, type SearchDocType } from '../../src/schemas'
import { SEARCH_DOCS_FILE, type Dataset } from './dataset'
import { danglingRef, duplicateId, type PipelineError } from './errors'

function searchableRefs(ds: Dataset): Map<string, SearchDocType> {
  const refs = new Map<string, SearchDocType>()
  for (const w of ds.weapons) refs.set(`i:${w.id}`, 'weapon')
  for (const a of ds.armor) refs.set(`i:${a.id}`, 'armor')
  for (const a of ds.accessories) refs.set(`i:${a.id}`, 'accessory')
  for (const i of ds.items) refs.set(`i:${i.id}`, 'item')
  for (const s of ds.armorSets) refs.set(`set:${s.id}`, 'set')
  for (const b of ds.bosses) refs.set(`boss:${b.id}`, 'boss')
  for (const b of ds.buffs) refs.set(`buff:${b.id}`, 'buff')
  for (const e of ds.enemies) refs.set(`enemy:${e.id}`, 'enemy')
  return refs
}

export function checkSearchDocs(raw: unknown, ds: Dataset): PipelineError[] {
  if (!Array.isArray(raw)) {
    return [{ code: 'E_SCHEMA', ref: `file:${SEARCH_DOCS_FILE}`, zodIssues: [], message: `file:${SEARCH_DOCS_FILE}: expected a JSON array` }]
  }
  const errors: PipelineError[] = []
  const expected = searchableRefs(ds)
  const seen = new Set<string>()
  raw.forEach((doc: unknown, index) => {
    const parsed = SearchDoc.safeParse(doc)
    if (!parsed.success) {
      const ref = `${SEARCH_DOCS_FILE}[${index}]`
      errors.push({ code: 'E_SCHEMA', ref, zodIssues: parsed.error.issues, message: `${ref} failed strict schema validation` })
      return
    }
    const { id, type } = parsed.data
    if (seen.has(id)) errors.push(duplicateId('search-docs', id, 'entity appears more than once'))
    seen.add(id)
    const actual = expected.get(id)
    if (actual === undefined) errors.push(danglingRef('search-docs', 'id', id, 'no such searchable entity'))
    else if (actual !== type) errors.push(danglingRef('search-docs', 'type', id, `doc type "${type}" but entity is "${actual}"`))
  })
  for (const ref of expected.keys()) if (!seen.has(ref)) errors.push(danglingRef('search-docs', 'id', ref, 'entity has no search doc'))
  return errors
}
