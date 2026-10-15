/**
 * NPC shop tables (AMENDMENTS-014 B68 / AMENDMENTS-015 B78 gating expansion): a vendor NPC's article
 * renders its stock as one or more `table.terraria` tables whose header row is "Item · Cost ·
 * Availability" (verified on the 2026-10-14 sync of all 24 vendor articles; the Traveling Merchant and
 * the Painter split their stock over several such tables). Each row names one item (its display text)
 * and states WHEN the NPC sells it in the Availability cell ("Always available.", "In Hardmode.",
 * "When Skeletron has been defeated.", …).
 *
 * Only the parse happens here: which availability texts become which condition slugs is a curated,
 * reviewed decision (overlays/vendors.json); an unmapped text keeps the route's conditions Unknown.
 */
import { findAll, hasClass, parseHtml, rawText, type HNode } from './html'
import { stripMarkup } from './text'

const kids = (n: HNode | undefined): HNode[] => (n && n.type === 'el' ? n.children : [])
const text = (nodes: readonly HNode[]): string => stripMarkup(rawText(nodes))

export interface ShopRow {
  /** Display name of the sold item (plain text of the Item cell). */
  item: string
  /** Plain text of the Availability cell, whitespace collapsed ("" when the cell is empty). */
  availability: string
}

/** Normalizes an availability cell: space before punctuation (link boundaries) removed, zero-width marks dropped. */
export function normalizeAvailability(s: string): string {
  return s
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+([.,:;])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Every row of every "Item · Cost · Availability" table of an NPC article, in document order. */
export function parseShopTables(html: string): ShopRow[] {
  const out: ShopRow[] = []
  for (const table of findAll(parseHtml(html), (n) => n.type === 'el' && n.tag === 'table' && hasClass(n, 'terraria'))) {
    const rows = findAll(kids(table), (n) => n.type === 'el' && n.tag === 'tr')
    const head = rows.find((tr) => kids(tr).some((c) => c.type === 'el' && c.tag === 'th'))
    if (!head) continue
    const columns = kids(head)
      .filter((c) => c.type === 'el' && c.tag === 'th')
      .map((th) => text(kids(th)))
    if (columns.length !== 3 || columns[0] !== 'Item' || columns[1] !== 'Cost' || columns[2] !== 'Availability') continue
    for (const tr of rows) {
      const cells = kids(tr).filter((c) => c.type === 'el' && c.tag === 'td')
      if (cells.length !== 3) continue
      const item = text(kids(cells[0]))
      if (item === '') continue
      out.push({ item, availability: normalizeAvailability(text(kids(cells[2]))) })
    }
  }
  return out
}
