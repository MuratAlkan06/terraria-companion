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

/** Rendered footnote markers ("[6]", "[note 1]") — citation links, not part of the article's prose. */
const CITATION_MARKER = /\[(?:\d+|note \d+)\]/g

export class Evidence {
  private readonly pages = new Map<string, EvidencePage & { text: string }>()
  private readonly prose = new Map<string, string>()

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

  /**
   * A sentence the pipeline EXTRACTED from the article's own prose (labParams.behaviorText drops the
   * rendered footnote markers): it must occur verbatim in the article once those markers ("[6]") are
   * removed — "18 ticks[6] of local invincibility frames" reads "18 ticks of local invincibility frames".
   * Curated overlay quotes keep the strict `quote` check.
   */
  sentence(title: string, sentence: string, where: string): EvidencePage {
    const p = this.page(title, where)
    let prose = this.prose.get(title)
    if (prose === undefined) {
      prose = normalizeQuote((this.pages.get(title)?.text ?? '').replace(CITATION_MARKER, ''))
      this.prose.set(title, prose)
    }
    if (!prose.includes(normalizeQuote(sentence))) throw new OverlayError(`[E_SCHEMA] ${where}: sentence not found verbatim (footnote markers aside) on "${title}" rev ${p.rev}: "${sentence}"`)
    return p
  }

  /** Curated provenance source for a claim backed by this page. */
  static source(overlay: string, p: EvidencePage): ProvSource {
    return { kind: 'curated', overlay, url: p.url, rev: p.rev, fetchedAt: isoDate(p.fetchedAt) }
  }
}
