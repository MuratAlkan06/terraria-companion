import type { SearchDoc } from '../../../schemas'
import { resolveTarget } from '../../../search/links'
import { hasRoute, pathFor } from '../../routes'
import { guideBySlug } from './content'
import { guideHref, wikiUrl, type Mention } from './guideModel'

/**
 * Where a guide mention links (PRD P6-S8 AC2). Every mention resolves to a real page or to nothing:
 * - dataset entities go through global search's resolver — their in-app page where one exists,
 *   else the record's own wiki article — so they move in-app automatically when an entity page ships;
 * - wiki citations open the cited article; guide and route links resolve only for registered
 *   targets. `none` (e.g. a record missing after a data regeneration) renders as plain text.
 */
export type MentionTarget = { kind: 'internal'; to: string } | { kind: 'external'; href: string } | { kind: 'none' }

export function mentionTarget(mention: Mention, docs: ReadonlyMap<string, SearchDoc>): MentionTarget {
  switch (mention.kind) {
    case 'entity': {
      const doc = docs.get(mention.ref)
      return doc ? resolveTarget(doc) : { kind: 'none' }
    }
    case 'wiki':
      return { kind: 'external', href: wikiUrl(mention.page) }
    case 'guide':
      return guideBySlug(mention.slug) ? { kind: 'internal', to: guideHref(mention.slug) } : { kind: 'none' }
    case 'route':
      return hasRoute(mention.routeId) ? { kind: 'internal', to: pathFor(mention.routeId) } : { kind: 'none' }
  }
}

/** Visible words of a mention: an entity reads as the dataset's name unless the prose overrides it. */
export function mentionText(mention: Mention, docs: ReadonlyMap<string, SearchDoc>): string {
  if (mention.kind !== 'entity') return mention.text
  return mention.text ?? docs.get(mention.ref)?.name ?? mention.name
}
