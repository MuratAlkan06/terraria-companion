/**
 * Rendered wiki articles via `action=parse` (prop=text|revid, redirects followed) — the evidence
 * base for curated overlay claims (P2-S6). Every quote an overlay cites (boss summon text,
 * progression-edge notes, attack-pattern evidence, withheld-conflict evidence) must occur verbatim
 * in the plain text of the cached article revision; the build fails otherwise, so no curated
 * sentence can drift from (or be invented beyond) its cited page. One request per article, cached
 * under the D2 etiquette like every other request.
 */
import type { WikiClient } from './client'
import { FetchError } from './client'
import { stripMarkup } from '../parse/text'

export interface Article {
  /** Title as requested by the overlay. */
  title: string
  /** Title after redirects (the cited page's canonical name). */
  resolvedTitle: string
  revid: number
  html: string
  fetchedAt: string
}

type ParseResponse = { parse?: { title?: string; revid?: number; text?: string } }

export const articleCacheName = (prefix: string, title: string) => `${prefix}/${title.replace(/[^A-Za-z0-9._-]/g, '_')}`

export async function fetchArticles(client: WikiClient, titles: readonly string[], cachePrefix: string): Promise<Map<string, Article>> {
  const out = new Map<string, Article>()
  for (const title of [...new Set(titles)].sort()) {
    const { response, fetchedAt } = await client.get({ action: 'parse', page: title, prop: 'text|revid', redirects: '1' }, articleCacheName(cachePrefix, title))
    const p = (response as ParseResponse).parse
    if (!p || typeof p.text !== 'string' || typeof p.revid !== 'number' || typeof p.title !== 'string') throw new FetchError(`parse ${title}: unexpected response shape`)
    out.set(title, { title, resolvedTitle: p.title, revid: p.revid, html: p.text, fetchedAt })
  }
  return out
}

/** Plain text of a rendered article (A15): style blocks dropped, markup stripped, whitespace collapsed. */
export function articleText(html: string): string {
  return stripMarkup(html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<(?:p|div|li|tr|td|th|h[1-6])\b/gi, ' $&'))
}

/** Normalized form used for verbatim-quote checks (typographic quotes/dashes folded, whitespace collapsed). */
export const normalizeQuote = (s: string): string => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim()
