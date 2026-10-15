/**
 * Group captions of a rendered drop list (P5-S3, AMENDMENTS-015 B82): a boss article's infobox lists
 * its drops as `<ul class="drops items">`, where a captioned group reads
 *
 *   <li class="groupstart caption">Only in Corrupt worlds<sup>…</sup></li>
 *   <li class="m-normal group">…<a href="/wiki/Demonite_Ore" title="Demonite Ore">…</li>
 *   …
 *   <li class="groupend"></li>
 *
 * The Cargo Drops rows of those items carry no trace of the caption (Eye of Cthulhu's Demonite Ore
 * and Crimtane Ore are both plain "100%" rows), so the caption is read here. Pure: HTML in, per item
 * name the captions it is listed under (`null` = listed outside any captioned group).
 */
import { decodeEntities, stripMarkup } from './text'

export interface DropListing {
  /** Item name (the item link's title) → one entry per listing: its group caption, or null. */
  byItem: Map<string, (string | null)[]>
}

const DROP_LIST = /<ul class="drops items">([\s\S]*?)<\/ul>/g
const LIST_ITEM = /<li(?: class="([^"]*)")?>([\s\S]*?)<\/li>/g
const ITEM_LINK = /<a href="\/wiki\/[^"]*" title="([^"]+)"/

/** "Only in Corrupt worlds <sup …>[4]</sup>" → "Only in Corrupt worlds". */
export const captionText = (html: string): string => stripMarkup(html.replace(/<sup\b[\s\S]*?<\/sup>/gi, ''))

export function parseDropListing(html: string): DropListing {
  const byItem = new Map<string, (string | null)[]>()
  for (const [, list] of html.matchAll(DROP_LIST)) {
    let caption: string | null = null
    for (const [, cls = '', body] of list.matchAll(LIST_ITEM)) {
      const classes = cls.split(/\s+/)
      if (classes.includes('groupstart')) {
        caption = classes.includes('caption') ? captionText(body) : null
        continue
      }
      if (classes.includes('groupend')) {
        caption = null
        continue
      }
      const link = ITEM_LINK.exec(body)
      if (!link) continue // the header row, empty markers
      const name = decodeEntities(link[1]).trim()
      // an item outside the group (no "group" class) is never under the open caption
      const listing = classes.includes('group') ? caption : null
      byItem.set(name, [...(byItem.get(name) ?? []), listing])
    }
  }
  return { byItem }
}

/**
 * The conditions a drop list's captions put on each item, through a caption → condition lookup.
 * Only items listed under registered captions in EVERY listing get conditions; an item listed both
 * under a registered caption and elsewhere (or under different ones) is ambiguous — the caller makes
 * its conditions Unknown. Unregistered captions ("One of the following 4 items will always be
 * dropped") state no condition this registry models and count as no caption. Registered ones are
 * world captions ("Only in Corrupt worlds") and the "not present" family ("When the Jungle Temple is
 * not present" on Plantera — its link text is part of the caption).
 */
export function captionConditions(listing: DropListing, conditionFor: (caption: string) => string | undefined): Map<string, { conditions: string[] } | { ambiguous: string[] }> {
  const out = new Map<string, { conditions: string[] } | { ambiguous: string[] }>()
  for (const [name, listings] of listing.byItem) {
    const mapped = listings.map((c) => (c === null ? undefined : conditionFor(c)))
    if (mapped.every((m) => m === undefined)) continue
    const keys = new Set(mapped.map((m) => m ?? ''))
    if (keys.size === 1) out.set(name, { conditions: [mapped[0] as string] })
    else out.set(name, { ambiguous: listings.map((c) => c ?? '(no caption)') })
  }
  return out
}
