/**
 * Builds the global search index (ADR-001 D4/D7). LAZY chunk: `./index.ts` imports this module
 * dynamically on the first search interaction, so MiniSearch and the search docs stay out of the
 * shell bundle. Row targets come from the docs themselves (`wikiUrl`, B31/B42b) and so do row sprite paths
 * (`sprite`, AMENDMENTS-016 B104), so no other entity data is loaded for search: the sprite index starts
 * with the weapon and boss manifest parts, and each row's SpriteImg loads any other part on demand.
 *
 * Everything shown in a row is resolved once here (target, sprite, detail line), so the shell UI
 * renders any entity type generically (P2-S4 AC5).
 */
import { CLASS_LABELS } from '../app/routes/db/weapons/weaponDisplay'
import { getStageInfo, isStage } from '../app/stages'
import { asRarity, rarityLabel } from '../components/rarity'
import { loadSearchDocs, loadSpriteIndex } from '../data-access'
import type { SpriteIndex } from '../data-access/types'
import type { SearchDoc } from '../schemas'
import { createSearchEngine } from './engine'
import { DEFAULT_PER_GROUP, groupByType } from './group'
import { resolveTarget } from './links'
import type { SearchIndex, SearchResultItem, SearchSuggestions, SuggestOptions } from './types'

export interface BuildDeps {
  loadDocs: () => Promise<SearchDoc[]>
  loadSprites: () => Promise<SpriteIndex>
  now: () => number
}

/** Manifest parts loaded with the index: the two types that most often lead a result list. */
const SEARCH_SPRITE_DIRS = ['weapons', 'bosses'] as const

export const DEFAULT_DEPS: BuildDeps = {
  loadDocs: loadSearchDocs,
  loadSprites: () => loadSpriteIndex(SEARCH_SPRITE_DIRS),
  now: () => performance.now(),
}

/** "Melee · Red (10)", "Early Pre-Hardmode" — only fields the doc actually carries. */
export function detailLine(doc: SearchDoc): string {
  const parts: string[] = []
  if (doc.class) parts.push(CLASS_LABELS[doc.class])
  const rarity = asRarity(doc.rarity)
  if (rarity !== undefined) parts.push(rarityLabel(rarity))
  if (doc.stage && isStage(doc.stage)) parts.push(getStageInfo(doc.stage).label)
  return parts.join(' · ')
}

function measure(name: string, start: number, end: number): void {
  try {
    performance.measure(name, { start, end })
  } catch {
    // User timings are evidence only; never let them break search.
  }
}

/**
 * @param startedAt `deps.now()` when the first search interaction asked for the index (before the
 *   lazy chunk downloaded), so `timing.loadMs` covers the whole wait.
 */
export async function buildSearchIndex(startedAt: number, deps: BuildDeps = DEFAULT_DEPS): Promise<SearchIndex> {
  const [docs, sprites] = await Promise.all([
    deps.loadDocs(),
    deps.loadSprites().catch((error: unknown) => {
      console.warn('[search] Sprite manifest unavailable; showing placeholder art.', error)
      return null
    }),
  ])
  const loadedAt = deps.now()

  const engine = createSearchEngine(docs)
  const items = new Map<string, SearchResultItem>()
  for (const doc of docs) {
    items.set(doc.id, {
      ref: doc.id,
      name: doc.name,
      type: doc.type,
      damageClass: doc.class,
      stage: doc.stage,
      rarity: doc.rarity,
      detail: detailLine(doc),
      // the doc's own record sprite path (B104); absent — or no sprite index at all — ⇒ placeholder art
      sprite: sprites ? doc.sprite : undefined,
      target: resolveTarget(doc),
    })
  }
  const builtAt = deps.now()

  const timing = { loadMs: loadedAt - startedAt, buildMs: builtAt - loadedAt, totalMs: builtAt - startedAt }
  measure('tc:search-index', startedAt, builtAt)
  measure('tc:search-index-build', loadedAt, builtAt)

  return {
    docCount: engine.size,
    sprites,
    timing,
    suggest(query: string, options: SuggestOptions = {}): SearchSuggestions {
      const hits = engine.search(query, { types: options.types })
      const scored = hits.flatMap(({ doc, score }) => {
        const item = items.get(doc.id)
        return item ? [{ item, score }] : []
      })
      const groups = groupByType(scored, options.perGroup ?? DEFAULT_PER_GROUP)
      return { query, groups, options: groups.flatMap((group) => group.items) }
    },
  }
}
