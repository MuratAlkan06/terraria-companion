/**
 * Evidence index over the cached wiki articles (fetch/articles.ts): curated overlay quotes are
 * checked VERBATIM against the plain text of the fetched article revision. A quote that is not on
 * its cited page, or a page the sync plan did not fetch, fails the build (E_SCHEMA via
 * OverlayError) — curated text can only repeat the wiki, never extend it.
 */
import type { ProvSource } from '../../src/schemas'
import { articleText, normalizeQuote, type Article } from '../fetch/articles'
import { wikiPageUrl } from '../fetch/config'
import { isoDate } from './prov'
import { OverlayError } from './registry'

export interface EvidencePage {
  title: string
  /** Canonical article URL (redirects resolved). */
  url: string
  rev: number
  fetchedAt: string
}

export class Evidence {
  private readonly pages = new Map<string, EvidencePage & { text: string }>()

  constructor(articles: ReadonlyMap<string, Article>) {
    for (const a of articles.values()) {
      this.pages.set(a.title, { title: a.resolvedTitle, url: wikiPageUrl(a.resolvedTitle), rev: a.revid, fetchedAt: a.fetchedAt, text: normalizeQuote(articleText(a.html)) })
    }
  }

  page(title: string, where: string): EvidencePage {
    const p = this.pages.get(title)
    if (!p) throw new OverlayError(`[E_SCHEMA] ${where}: cited page "${title}" was not fetched by the sync plan (run npm run pipeline:fetch)`)
    return { title: p.title, url: p.url, rev: p.rev, fetchedAt: p.fetchedAt }
  }

  /** The quote must occur verbatim (normalized) in the cited article. Returns the page. */
  quote(title: string, quote: string, where: string): EvidencePage {
    const p = this.page(title, where)
    const text = this.pages.get(title)?.text ?? ''
    if (!text.includes(normalizeQuote(quote))) throw new OverlayError(`[E_SCHEMA] ${where}: quote not found verbatim on "${title}" rev ${p.rev}: "${quote}"`)
    return p
  }

  /** Curated provenance source for a claim backed by this page. */
  static source(overlay: string, p: EvidencePage): ProvSource {
    return { kind: 'curated', overlay, url: p.url, rev: p.rev, fetchedAt: isoDate(p.fetchedAt) }
  }
}
