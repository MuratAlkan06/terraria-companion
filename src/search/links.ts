/**
 * Where a search result goes (PRD P2-S4 AC1; slice scope 3).
 *
 * - Types with a local detail route navigate in-app: weapons → /weapons/:id.
 * - INTERIM — until the P5 boss pages and the A5 `/enemies/:id` pages ship: bosses and enemies
 *   have no local page yet, so their rows open the record's own terraria.wiki.gg page (its
 *   `wikiUrl`) in a new tab, with an external-link indicator on the row. Never a dead local
 *   link, never a disabled row. When those routes ship, register them in LOCAL_ROUTES and the
 *   rows switch to in-app navigation with no UI change.
 * - Any other type (a future dataset with neither a page nor a URL source) opens the wiki's
 *   search for its exact name: a live page, never a guessed article URL.
 */
import { weaponHref } from '../app/routes/db/weapons/weaponNav'
import type { SearchDoc, SearchDocType } from '../schemas'

export type SearchTarget = { kind: 'internal'; to: string } | { kind: 'external'; href: string }

const ITEM_REF = /^i:([1-9]\d*)$/

/** Local detail routes by entity type (extend as entity pages ship). */
const LOCAL_ROUTES: Partial<Record<SearchDocType, (ref: string) => string | undefined>> = {
  weapon: (ref) => {
    const match = ITEM_REF.exec(ref)
    return match ? weaponHref(Number(match[1])) : undefined
  },
}

export const WIKI_ORIGIN = 'https://terraria.wiki.gg'

/** terraria.wiki.gg search for an exact entity name (generic fallback; see module doc). */
export function wikiSearchUrl(name: string): string {
  return `${WIKI_ORIGIN}/wiki/Special:Search?search=${encodeURIComponent(name)}`
}

export function resolveTarget(
  doc: Pick<SearchDoc, 'id' | 'type' | 'name'>,
  wikiUrls: ReadonlyMap<string, string>,
): SearchTarget {
  const local = LOCAL_ROUTES[doc.type]?.(doc.id)
  if (local !== undefined) return { kind: 'internal', to: local }
  return { kind: 'external', href: wikiUrls.get(doc.id) ?? wikiSearchUrl(doc.name) }
}
