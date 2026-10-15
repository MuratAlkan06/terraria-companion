/** Conditions registry (curated overlay → Condition[]) and the Iteminfo item universe. */
import type { Condition, ProvSource } from '../../src/schemas'
import { wikiPageUrl } from '../fetch/config'
import type { Iteminfo } from '../parse/iteminfo'
import type { ItemUniverse } from '../validate/dataset'
import type { Evidence } from './evidence'
import type { ConditionsOverlay } from './overlays'
import { isoDate, makeProv } from './prov'

export class OverlayError extends Error {
  readonly code = 'E_SCHEMA'
}

/**
 * Each overlay entry's wikiUrl is its cited page, resolved through redirects as checked by the
 * fetch stage ("Full Moon" → "Moon phase"); a missing page fails the build. An entry's `evidence`
 * quotes (AMENDMENTS-016 B140(a)/B141) must occur verbatim on their cached articles (`evidence`
 * absent = no entry may carry quotes); each quoted revision becomes a source of the condition.
 */
export function buildConditions(overlay: ConditionsOverlay, pages: ReadonlyMap<string, { exists: boolean; resolvedTitle: string }>, evidence?: Evidence): Condition[] {
  return overlay.entries
    .map((e) => {
      const page = pages.get(e.wikiTitle)
      if (!page?.exists) throw new OverlayError(`[E_SCHEMA] overlay conditions/${e.id}: cited page "${e.wikiTitle}" does not exist on the wiki`)
      const wikiUrl = wikiPageUrl(page.resolvedTitle)
      const quoted = new Map<string, ProvSource>()
      for (const [i, x] of (e.evidence ?? []).entries()) {
        if (!evidence) throw new OverlayError(`[E_SCHEMA] overlay conditions/${e.id}: evidence quotes need the fetched articles to be checked`)
        const p = evidence.quote(x.page, x.quote, `overlay conditions/${e.id} evidence ${i}`)
        quoted.set(p.url, { kind: 'curated', overlay: 'conditions', url: p.url, rev: p.rev, fetchedAt: isoDate(p.fetchedAt) }) // = Evidence.source
      }
      const base: ProvSource = { kind: 'curated', overlay: 'conditions', url: wikiUrl, fetchedAt: overlay.authoredAt }
      const condition: Condition = {
        id: e.id,
        name: e.name,
        kind: e.kind,
        ...(e.satisfiedByNode ? { satisfiedByNode: e.satisfiedByNode } : {}),
        description: e.description,
        wikiUrl,
        // a quoted revision of the cited page itself replaces its revision-less entry
        _prov: makeProv([...(quoted.has(wikiUrl) ? [] : [base]), ...[...quoted.values()].sort((a, b) => a.url.localeCompare(b.url))]),
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
