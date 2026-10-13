/**
 * Global search entry point (PRD P2-S4; ADR-001 D4/D7). This module is in the shell bundle and
 * stays tiny: the index is NOT built at app start. The first search interaction (focus, keystroke,
 * "/" shortcut) calls `loadSearchIndex()`, which dynamically imports `./buildIndex` (MiniSearch +
 * the search docs as lazy chunks) and builds the index once per session.
 * Failures are not cached (data-access memo), so the search error state's Retry rebuilds.
 */
import { ChunkLoadError } from '../data-access/errors'
import { memo } from '../data-access/memo'
import type { SearchIndex } from './types'

export type * from './types'

const index = memo(async (): Promise<SearchIndex> => {
  const startedAt = performance.now()
  let build: typeof import('./buildIndex')
  try {
    build = await import('./buildIndex')
  } catch (cause) {
    throw new ChunkLoadError('search-index', cause)
  }
  return build.buildSearchIndex(startedAt)
})

/** Builds (once) and returns the global search index. Call on a search interaction only. */
export const loadSearchIndex = (): Promise<SearchIndex> => index.get()

/** The index if it has already been built (synchronous; for a ready first frame). */
export const peekSearchIndex = (): SearchIndex | undefined => index.peek()
