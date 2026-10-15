/**
 * Where a search result goes (PRD P2-S4 AC1; slice scope 3; AMENDMENTS-009 B42b).
 *
 * - Types with a local detail route navigate in-app: weapons → /weapons/:id; bosses with a page
 *   (P5-S2, src/schemas/bossPages.ts) → /bosses/:id; items (every Item record — the P6 encyclopedia,
 *   AMENDMENTS-016) → /items/:id; armor pieces → /armor/:id (their set's page, or their own), armor sets →
 *   /armor/:slug and accessories → /accessories/:id (PRD P6-S1/S2; AMENDMENTS-016 B131(b) — the armor /
 *   accessory "Wiki ↗" rows retire).
 * - Any other doc opens its own terraria.wiki.gg article — the doc's `wikiUrl` (AMENDMENTS-007
 *   B31: the pipeline emits it on every search doc) — in a new tab, with an external-link
 *   indicator on the row. Never a dead local link, never a disabled row. When an entity page
 *   ships (P5 boss pages, A5 `/enemies/:id`, …), register it in LOCAL_ROUTES and its rows switch
 *   to in-app navigation with no UI change.
 * - A doc with neither a page nor a `wikiUrl` opens the wiki's search for its exact name: a live
 *   page, never a guessed article URL.
 */
import { bossPageHref } from '../app/routes/bosses/bossNav'
import { accessoryHref } from '../app/routes/db/accessories/accessoryNav'
import { armorPieceHref, armorSetHref } from '../app/routes/db/armor/armorNav'
import { itemHref } from '../app/routes/db/items/itemNav'
import { weaponHref } from '../app/routes/db/weapons/weaponNav'
import type { SearchDoc, SearchDocType } from '../schemas'

export type SearchTarget = { kind: 'internal'; to: string } | { kind: 'external'; href: string }

const ITEM_REF = /^i:([1-9]\d*)$/
const BOSS_REF = /^boss:([a-z0-9]+(?:-[a-z0-9]+)*)$/
const SET_REF = /^set:([a-z0-9]+(?:-[a-z0-9]+)*)$/

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
  // P6 encyclopedia (AMENDMENTS-016): every Item record has its page — the "Wiki ↗" rows for items retire.
  item: (ref) => {
    const match = ITEM_REF.exec(ref)
    return match ? itemHref(Number(match[1])) : undefined
  },
  // PRD P6-S1/S2 (AMENDMENTS-016 B131(b)): every armor piece, armor set and accessory record has its page. The
  // pipeline emits these docs from the records themselves (search.test pins doc ⇄ record), so none is dead.
  armor: (ref) => {
    const match = ITEM_REF.exec(ref)
    return match ? armorPieceHref(Number(match[1])) : undefined
  },
  set: (ref) => {
    const match = SET_REF.exec(ref)
    return match ? armorSetHref(match[1]) : undefined
  },
  accessory: (ref) => {
    const match = ITEM_REF.exec(ref)
    return match ? accessoryHref(Number(match[1])) : undefined
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
