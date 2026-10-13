/**
 * §7a-11 (runs only when the dataset provides search-docs.json): every searchable entity
 * appears exactly once and every SearchDoc ref resolves to an entity of the matching type.
 * AMENDMENTS-007 B31: every doc carries its entity's own `wikiUrl` (exact provenance for rows).
 */
import { SearchDoc, type SearchDocType } from '../../src/schemas'
import { SEARCH_DOCS_FILE, type Dataset } from './dataset'
import { danglingRef, derivedMismatch, duplicateId, type PipelineError } from './errors'

function searchableRefs(ds: Dataset): Map<string, { type: SearchDocType; wikiUrl: string }> {
  const refs = new Map<string, { type: SearchDocType; wikiUrl: string }>()
  const add = (ref: string, type: SearchDocType, wikiUrl: string) => refs.set(ref, { type, wikiUrl })
  for (const w of ds.weapons) add(`i:${w.id}`, 'weapon', w.wikiUrl)
  for (const a of ds.armor) add(`i:${a.id}`, 'armor', a.wikiUrl)
  for (const a of ds.accessories) add(`i:${a.id}`, 'accessory', a.wikiUrl)
  for (const i of ds.items) add(`i:${i.id}`, 'item', i.wikiUrl)
  for (const s of ds.armorSets) add(`set:${s.id}`, 'set', s.wikiUrl)
  for (const b of ds.bosses) add(`boss:${b.id}`, 'boss', b.wikiUrl)
  for (const b of ds.buffs) add(`buff:${b.id}`, 'buff', b.wikiUrl)
  for (const e of ds.enemies) add(`enemy:${e.id}`, 'enemy', e.wikiUrl)
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
    const { id, type, wikiUrl } = parsed.data
    if (seen.has(id)) errors.push(duplicateId('search-docs', id, 'entity appears more than once'))
    seen.add(id)
    const actual = expected.get(id)
    if (actual === undefined) errors.push(danglingRef('search-docs', 'id', id, 'no such searchable entity'))
    else if (actual.type !== type) errors.push(danglingRef('search-docs', 'type', id, `doc type "${type}" but entity is "${actual.type}"`))
    else if (wikiUrl !== actual.wikiUrl) errors.push(derivedMismatch(id, 'wikiUrl', `search doc wikiUrl ${wikiUrl === undefined ? 'absent' : `"${wikiUrl}"`} != entity wikiUrl "${actual.wikiUrl}" (B31)`))
  })
  for (const ref of expected.keys()) if (!seen.has(ref)) errors.push(danglingRef('search-docs', 'id', ref, 'entity has no search doc'))
  return errors
}
