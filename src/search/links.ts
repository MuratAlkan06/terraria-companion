/**
 * Where a search result goes (PRD P2-S4 AC1; slice scope 3; AMENDMENTS-009 B42b).
 *
 * - Types with a local detail route navigate in-app: weapons → /weapons/:id; bosses with a page
 *   (P5-S2, src/schemas/bossPages.ts) → /bosses/:id.
 * - Any other doc opens its own terraria.wiki.gg article — the doc's `wikiUrl` (AMENDMENTS-007
 *   B31: the pipeline emits it on every search doc) — in a new tab, with an external-link
 *   indicator on the row. Never a dead local link, never a disabled row. When an entity page
 *   ships (P5 boss pages, A5 `/enemies/:id`, …), register it in LOCAL_ROUTES and its rows switch
 *   to in-app navigation with no UI change.
 * - A doc with neither a page nor a `wikiUrl` opens the wiki's search for its exact name: a live
 *   page, never a guessed article URL.
 */
import { bossPageHref } from '../app/routes/bosses/bossNav'
import { weaponHref } from '../app/routes/db/weapons/weaponNav'
import type { SearchDoc, SearchDocType } from '../schemas'

export type SearchTarget = { kind: 'internal'; to: string } | { kind: 'external'; href: string }

const ITEM_REF = /^i:([1-9]\d*)$/
const BOSS_REF = /^boss:([a-z0-9]+(?:-[a-z0-9]+)*)$/

/** Local detail routes by entity type (extend as entity pages ship). */
const LOCAL_ROUTES: Partial<Record<SearchDocType, (ref: string) => string | undefined>> = {
  weapon: (ref) => {
    const match = ITEM_REF.exec(ref)
    return match ? weaponHref(Number(match[1])) : undefined
  },
  // P5-S2: bosses with a page (src/schemas/bossPages.ts) navigate in-app; the rest keep their wiki article.
  boss: (ref) => {
    const match = BOSS_REF.exec(ref)
    return match ? bossPageHref(match[1]) : undefined
  },
}

export const WIKI_ORIGIN = 'https://terraria.wiki.gg'

/** terraria.wiki.gg search for an exact entity name (generic fallback; see module doc). */
export function wikiSearchUrl(name: string): string {
  return `${WIKI_ORIGIN}/wiki/Special:Search?search=${encodeURIComponent(name)}`
}

export function resolveTarget(doc: Pick<SearchDoc, 'id' | 'type' | 'name' | 'wikiUrl'>): SearchTarget {
  const local = LOCAL_ROUTES[doc.type]?.(doc.id)
  if (local !== undefined) return { kind: 'internal', to: local }
  return { kind: 'external', href: doc.wikiUrl ?? wikiSearchUrl(doc.name) }
}
