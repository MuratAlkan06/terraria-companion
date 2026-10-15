/**
 * MiniSearch engine over SearchDocs (ADR-001 D4; DATA_SCHEMA_SPEC §2.10). LAZY: only
 * `./buildIndex.ts` imports this module, and only through a dynamic import, so MiniSearch never
 * ships in the shell bundle (ADR D7).
 *
 * Config per §2.10: fields name+tags, storeFields type/class/stage/rarity, idField "id",
 * prefix:true, fuzzy:0.2, boost {name:2}, facet filter over the stored `type`.
 *
 * Entity rows come from `search()`, not `autoSuggest()`: in MiniSearch 7 `autoSuggest` returns
 * completed QUERY STRINGS ({suggestion, terms, score}), not documents, so it cannot carry the
 * sprite/rarity/type a typeahead row shows. Terms are AND-combined (MiniSearch's own autoSuggest
 * default) so every typed word narrows the list instead of widening it.
 *
 * Exact-name boost (AMENDMENTS-016 B104): a doc whose WHOLE name equals the query (case- and
 * space-insensitive) ranks above every partial match. Without it a one-word name drowned under longer
 * names that merely start with it ("Fish" under "Fishing Potion", "Fish Finder" … inside its group's
 * five-row cap; "Bar" likewise). Partial queries are never re-ranked, so type ordering for them is the
 * engine's own (the B84 "empress" note stands).
 */
import MiniSearch, { type SearchOptions } from 'minisearch'
import type { SearchDoc, SearchDocType } from '../schemas'

export const SEARCH_OPTIONS = {
  prefix: true,
  fuzzy: 0.2,
  boost: { name: 2 },
  combineWith: 'AND',
} as const satisfies SearchOptions

/** Name comparison key for the exact-name boost: case-, width- and whitespace-insensitive. */
export function nameKey(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
}

export interface SearchHit {
  doc: SearchDoc
  score: number
}

export interface EngineQueryOptions {
  /** Facet filter: only these entity types (all types when omitted). */
  types?: ReadonlySet<SearchDocType>
}

export interface SearchEngine {
  readonly size: number
  /** Hits by descending score; empty for a blank query. */
  search(query: string, options?: EngineQueryOptions): SearchHit[]
}

export function createSearchEngine(docs: readonly SearchDoc[]): SearchEngine {
  const mini = new MiniSearch<SearchDoc>({
    idField: 'id',
    fields: ['name', 'tags'],
    storeFields: ['type', 'class', 'stage', 'rarity'],
    // Tag slugs ("projectile-melee") are tokenised on the hyphen by the default tokenizer.
    stringifyField: (value: unknown) => (Array.isArray(value) ? value.join(' ') : String(value)),
    searchOptions: SEARCH_OPTIONS,
  })
  // Throws on a duplicate id (pipeline §7a-11 guarantees uniqueness) → the search error state.
  mini.addAll(docs as SearchDoc[])
  const byId = new Map(docs.map((doc) => [doc.id, doc]))

  return {
    size: mini.documentCount,
    search(query, options = {}) {
      if (query.trim() === '') return []
      const { types } = options
      const results = mini.search(query, types ? { filter: (result) => types.has(result.type as SearchDocType) } : undefined)
      const hits: SearchHit[] = []
      for (const result of results) {
        const doc = byId.get(result.id as string)
        if (doc) hits.push({ doc, score: result.score })
      }
      // Exact-name boost: exact matches first (their own order kept), lifted above the best partial score.
      const key = nameKey(query)
      const exact = hits.filter((h) => nameKey(h.doc.name) === key)
      if (exact.length === 0 || exact.length === hits.length) return hits
      const lift = hits[0].score
      return [...exact.map((h) => ({ doc: h.doc, score: h.score + lift })), ...hits.filter((h) => nameKey(h.doc.name) !== key)]
    },
  }
}
