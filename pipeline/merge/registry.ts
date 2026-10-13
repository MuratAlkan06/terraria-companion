/** Conditions registry (curated overlay → Condition[]) and the Iteminfo item universe. */
import type { Condition } from '../../src/schemas'
import { wikiPageUrl } from '../fetch/config'
import type { Iteminfo } from '../parse/iteminfo'
import type { ItemUniverse } from '../validate/dataset'
import type { ConditionsOverlay } from './overlays'
import { isoDate, makeProv } from './prov'

export class OverlayError extends Error {
  readonly code = 'E_SCHEMA'
}

/**
 * Each overlay entry's wikiUrl is its cited page, resolved through redirects as checked by the
 * fetch stage ("Full Moon" → "Moon phase"); a missing page fails the build.
 */
export function buildConditions(overlay: ConditionsOverlay, pages: ReadonlyMap<string, { exists: boolean; resolvedTitle: string }>): Condition[] {
  return overlay.entries
    .map((e) => {
      const page = pages.get(e.wikiTitle)
      if (!page?.exists) throw new OverlayError(`[E_SCHEMA] overlay conditions/${e.id}: cited page "${e.wikiTitle}" does not exist on the wiki`)
      const wikiUrl = wikiPageUrl(page.resolvedTitle)
      const condition: Condition = {
        id: e.id,
        name: e.name,
        kind: e.kind,
        ...(e.satisfiedByNode ? { satisfiedByNode: e.satisfiedByNode } : {}),
        description: e.description,
        wikiUrl,
        _prov: makeProv([{ kind: 'curated', overlay: 'conditions', url: wikiUrl, fetchedAt: overlay.authoredAt }]),
      }
      return condition
    })
    .sort((a, b) => a.id.localeCompare(b.id))
}

export function buildItemUniverse(info: Iteminfo): ItemUniverse {
  return {
    source: { kind: 'iteminfo', url: wikiPageUrl('Module:Iteminfo/data'), rev: info.rev, syncedTo: info.terrariaVersion, fetchedAt: isoDate(info.fetchedAt) },
    items: [...info.items.values()]
      .sort((a, b) => a.id - b.id)
      .map((i) => ({ id: i.id, internalName: i.internalName, ...(i.name ? { name: i.name } : {}) })),
  }
}
