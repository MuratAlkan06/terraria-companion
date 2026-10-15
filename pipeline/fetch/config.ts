/**
 * Fetch-stage constants (ADR-001 D2 etiquette — BINDING).
 *
 * The wiki publishes no rate policy for read clients (ADR "UNVERIFIED"), so the conservative
 * defaults are hard-wired here and NOT overridable from the CLI: serial requests, at most one
 * request per second (start-to-start), `maxlag=5`, a descriptive User-Agent, exponential
 * backoff on 429/5xx/maxlag, and a small retry cap after which the run STOPS (E_FETCH) instead
 * of retrying aggressively.
 */
import { resolve } from 'node:path'

export const WIKI_ORIGIN = 'https://terraria.wiki.gg'
export const API_URL = `${WIKI_ORIGIN}/api.php`
export const WIKI_PAGE_BASE = `${WIKI_ORIGIN}/wiki/`

/** Minimum gap between the starts of two network requests. 1100 ms keeps a margin under 1 req/s. */
export const MIN_REQUEST_INTERVAL_MS = 1100
/** MediaWiki maxlag (seconds): the server refuses the request while replication lag exceeds it. */
export const MAXLAG_SECONDS = 5
/** Retries per request for 429 / 5xx / maxlag / network errors (then E_FETCH, run stops). */
export const MAX_RETRIES = 4
/** First backoff delay; doubles per retry (5 s, 10 s, 20 s, 40 s) unless Retry-After is larger. */
export const BACKOFF_BASE_MS = 5000
/** Per-request network timeout. */
export const REQUEST_TIMEOUT_MS = 60_000

/**
 * Descriptive User-Agent (MediaWiki User-Agent policy). No personal contact data is embedded;
 * set TC_PIPELINE_CONTACT (e.g. the public repo URL) to append a contact pointer.
 */
export function userAgent(): string {
  const contact = process.env.TC_PIPELINE_CONTACT?.trim()
  const base =
    'TerrariaCompanionDataPipeline/0.1 (non-commercial fan project; build-time dataset sync of Cargo tables and Module:Iteminfo/data; serial, <=1 req/s, maxlag=5, cached)'
  return contact ? `${base} ${contact}` : base
}

/** Raw cache root (gitignored). Everything fetched lands here; reruns are served from it. */
export const RAW_DIR = resolve(import.meta.dirname, '..', 'raw')

/** Wiki page URL for a page title ("Iron Bar" → https://terraria.wiki.gg/wiki/Iron_Bar). */
export function wikiPageUrl(title: string): string {
  return WIKI_PAGE_BASE + encodeURIComponent(title.replaceAll(' ', '_')).replaceAll('%2F', '/').replaceAll('%3A', ':')
}
