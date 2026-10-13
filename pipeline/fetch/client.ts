/**
 * MediaWiki API client for terraria.wiki.gg with the ADR-001 D2 etiquette baked in.
 *
 * - SERIAL: requests are queued through a single promise chain; never two in flight.
 * - RATE: at most one request start per MIN_REQUEST_INTERVAL_MS (> 1 s).
 * - maxlag=5 on every request; `format=json&formatversion=2`.
 * - Descriptive User-Agent (config.userAgent()).
 * - BACKOFF on HTTP 429 / 5xx / MediaWiki `maxlag` error / network error: Retry-After or
 *   exponential (5, 10, 20, 40 s), capped at MAX_RETRIES; then E_FETCH and the run stops.
 *   HTTP 403 (blocked) and any other API error stop immediately — never hammered.
 * - CACHE: every successful response is written under RAW_DIR (gitignored) keyed by a
 *   readable cache name; a cached entry is reused only if its request params match exactly.
 *   Re-running a fetch is therefore resumable and costs zero requests once complete.
 * - AUDIT: every network attempt is appended to RAW_DIR/requests.log.jsonl and counted.
 * - BINARIES (P2-S2 sprites): `download()` fetches a wiki-hosted file through the SAME queue,
 *   pacing, backoff and audit log; the destination file is the cache, written atomically and
 *   verified against the wiki's imageinfo (exact SHA-1, or the CDN's original size when the CDN
 *   served a re-encoded rendition — see `download`).
 */
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import {
  API_URL,
  BACKOFF_BASE_MS,
  MAX_RETRIES,
  MAXLAG_SECONDS,
  MIN_REQUEST_INTERVAL_MS,
  REQUEST_TIMEOUT_MS,
  userAgent,
  WIKI_ORIGIN,
} from './config'

export type ApiParams = Record<string, string>

export class FetchError extends Error {
  readonly code = 'E_FETCH'
  /** HTTP status of the failed attempt (0 = network error / not an HTTP failure). */
  readonly status: number
  constructor(message: string, status = 0) {
    super(`[E_FETCH] ${message}`)
    this.status = status
  }
}

export const sha1Hex = (data: Uint8Array): string => createHash('sha1').update(data).digest('hex')

type AttemptResult<T> = { ok: true; body: T } | { ok: false; retryable: boolean; reason: string; status: number; retryAfterS?: number }

interface CacheEntry {
  request: ApiParams
  fetchedAt: string // ISO date-time of the network fetch
  response: unknown
}

export interface ClientStats {
  networkRequests: number // successful network responses
  attempts: number // all network attempts incl. retried ones
  retries: number
  cacheHits: number
  networkMs: number // wall time spent waiting on the network (excl. pacing sleeps)
  firstRequestAt?: string
  lastRequestAt?: string
}

export interface WikiClientOptions {
  cacheDir: string
  apiUrl?: string
  minIntervalMs?: number
  maxRetries?: number
  backoffBaseMs?: number
  refresh?: boolean // ignore cache, refetch (still cached afterwards)
  offline?: boolean // never touch the network; a cache miss is E_FETCH
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  log?: (line: string) => void
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** 429 / 5xx are retryable; any other non-200 (403 blocked, 404 …) stops without retrying. */
function httpFailure(status: number, retryAfterS: number | undefined): AttemptResult<never> {
  if (status === 429 || status >= 500) return { ok: false, retryable: true, reason: `HTTP ${status}`, status, retryAfterS }
  return { ok: false, retryable: false, reason: `HTTP ${status}${status === 403 ? ' (blocked?)' : ''}`, status }
}

export class WikiClient {
  readonly stats: ClientStats = { networkRequests: 0, attempts: 0, retries: 0, cacheHits: 0, networkMs: 0 }
  private readonly opts: Required<Omit<WikiClientOptions, 'fetchImpl' | 'sleep' | 'now' | 'log'>> &
    Pick<WikiClientOptions, 'log'> & { fetchImpl: typeof fetch; sleep: (ms: number) => Promise<void>; now: () => number }
  private queue: Promise<unknown> = Promise.resolve()
  private lastStart = Number.NEGATIVE_INFINITY

  constructor(options: WikiClientOptions) {
    this.opts = {
      apiUrl: API_URL,
      minIntervalMs: MIN_REQUEST_INTERVAL_MS,
      maxRetries: MAX_RETRIES,
      backoffBaseMs: BACKOFF_BASE_MS,
      refresh: false,
      offline: false,
      fetchImpl: globalThis.fetch,
      sleep: defaultSleep,
      now: Date.now,
      ...options,
    }
  }

  /** Full request params as sent (format/formatversion/maxlag added). */
  static withDefaults(params: ApiParams): ApiParams {
    return { ...params, format: 'json', formatversion: '2', maxlag: String(MAXLAG_SECONDS) }
  }

  cachePath(cacheName: string): string {
    if (!/^[A-Za-z0-9._/-]+$/.test(cacheName) || cacheName.includes('..')) throw new Error(`invalid cache name "${cacheName}"`)
    return join(this.opts.cacheDir, `${cacheName}.json`)
  }

  /** Reads a cache entry if present and made with identical params. */
  readCache(cacheName: string, params: ApiParams): CacheEntry | undefined {
    const path = this.cachePath(cacheName)
    if (!existsSync(path)) return undefined
    const entry = JSON.parse(readFileSync(path, 'utf8')) as CacheEntry
    return isDeepStrictEqual(entry.request, WikiClient.withDefaults(params)) ? entry : undefined
  }

  /** GET the API (serially, rate-limited, cached). Resolves with the parsed JSON body. */
  get(params: ApiParams, cacheName: string): Promise<{ response: unknown; fetchedAt: string; fromCache: boolean }> {
    const run = () => this.getNow(params, cacheName)
    const next = this.queue.then(run, run)
    this.queue = next.catch(() => undefined)
    return next
  }

  private async getNow(params: ApiParams, cacheName: string) {
    const request = WikiClient.withDefaults(params)
    if (!this.opts.refresh) {
      const cached = this.readCache(cacheName, params)
      if (cached) {
        this.stats.cacheHits += 1
        return { response: cached.response, fetchedAt: cached.fetchedAt, fromCache: true }
      }
    }
    if (this.opts.offline) throw new FetchError(`offline mode: no cache entry for ${cacheName}`)

    const url = `${this.opts.apiUrl}?${new URLSearchParams(request).toString()}`
    const body = await this.withRetries(cacheName, () => this.attempt(url, cacheName))
    const fetchedAt = new Date(this.opts.now()).toISOString()
    const path = this.cachePath(cacheName)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify({ request, fetchedAt, response: body } satisfies CacheEntry)}\n`)
    this.stats.networkRequests += 1
    return { response: body, fetchedAt, fromCache: false }
  }

  /**
   * Downloads a wiki-hosted file (serially, rate-limited, audited) to `dest`. Only
   * terraria.wiki.gg URLs. Verification against the wiki's imageinfo (`expected`):
   * - "exact": the body's SHA-1 equals the wiki's SHA-1 of the uploaded file;
   * - "cdn-optimized": the wiki's CDN (Cloudflare Polish) served a re-encoded rendition — the
   *   response carries `cf-polished: …orig_size=<n>` and n equals the wiki's recorded byte size
   *   of that file version (the URL's `?<sha1 prefix>` key pins the version). Byte identity is
   *   then impossible to check; the served bytes' SHA-1 is returned so callers can cache it.
   * Anything else is rejected (not retried). `dest` is the cache: an existing file whose SHA-1
   * equals the wiki's SHA-1 or the previously served SHA-1 (`knownServedSha1`) is not refetched.
   */
  download(
    url: string,
    dest: string,
    expected: { sha1: string; bytes: number },
    label: string,
    knownServedSha1?: string,
  ): Promise<{ fromCache: boolean; bytes: number; servedSha1: string; verification: 'exact' | 'cdn-optimized' | 'cached' }> {
    const run = () => this.downloadNow(url, dest, expected, label, knownServedSha1)
    const next = this.queue.then(run, run)
    this.queue = next.catch(() => undefined)
    return next
  }

  private async downloadNow(url: string, dest: string, expected: { sha1: string; bytes: number }, label: string, knownServedSha1?: string) {
    if (!this.opts.refresh && existsSync(dest)) {
      const existing = readFileSync(dest)
      const sha = sha1Hex(existing)
      if (sha === expected.sha1 || sha === knownServedSha1) {
        this.stats.cacheHits += 1
        return { fromCache: true, bytes: existing.length, servedSha1: sha, verification: 'cached' as const }
      }
    }
    if (this.opts.offline) throw new FetchError(`offline mode: ${label} not downloaded`)
    if (!url.startsWith(`${WIKI_ORIGIN}/`)) throw new FetchError(`${label}: refusing to download from outside ${WIKI_ORIGIN} (${url})`)
    const { data, polishedOrigSize } = await this.withRetries(label, () => this.attemptBinary(url, label))
    const actual = sha1Hex(data)
    let verification: 'exact' | 'cdn-optimized'
    if (actual === expected.sha1) verification = 'exact'
    else if (polishedOrigSize !== undefined && polishedOrigSize === expected.bytes) verification = 'cdn-optimized'
    else {
      throw new FetchError(
        `${label}: SHA-1 ${actual} does not match the wiki's ${expected.sha1}${polishedOrigSize !== undefined ? ` and the CDN's original size ${polishedOrigSize} is not the wiki's ${expected.bytes}` : ' (no CDN optimization header)'} (not retried)`,
      )
    }
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(`${dest}.part`, data)
    renameSync(`${dest}.part`, dest)
    this.stats.networkRequests += 1
    return { fromCache: false, bytes: data.length, servedSha1: actual, verification }
  }

  /** Paces each attempt; retries retryable failures with backoff; stops per D2. */
  private async withRetries<T>(label: string, attemptOnce: () => Promise<AttemptResult<T>>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      await this.pace()
      const outcome = await attemptOnce()
      if (outcome.ok) return outcome.body
      if (!outcome.retryable) throw new FetchError(`${label}: ${outcome.reason} (not retried)`, outcome.status)
      if (attempt >= this.opts.maxRetries) {
        throw new FetchError(`${label}: ${outcome.reason} — giving up after ${attempt + 1} attempts (wiki unavailable or throttling; stopping per D2)`, outcome.status)
      }
      const backoff = Math.max(this.opts.backoffBaseMs * 2 ** attempt, (outcome.retryAfterS ?? 0) * 1000)
      this.stats.retries += 1
      this.opts.log?.(`  backoff ${Math.round(backoff / 1000)}s after: ${outcome.reason}`)
      await this.opts.sleep(backoff)
    }
  }

  /**
   * Waits so that consecutive request starts are >= minIntervalMs apart. Re-checks the clock after
   * sleeping: timers may fire ~1 ms early relative to Date.now() (observed: 1099 ms gaps).
   */
  private async pace() {
    for (let wait = this.lastStart + this.opts.minIntervalMs - this.opts.now(); wait > 0; wait = this.lastStart + this.opts.minIntervalMs - this.opts.now()) {
      await this.opts.sleep(wait)
    }
    this.lastStart = this.opts.now()
  }

  private attempt(url: string, cacheName: string): Promise<AttemptResult<unknown>> {
    return this.timedAttempt(url, cacheName, 'application/json', async (res, status, retryAfterS) => {
      const text = await res.text()
      const bytes = text.length
      if (status !== 200) return { result: httpFailure(status, retryAfterS), bytes }
      const body = JSON.parse(text) as { error?: { code?: string; info?: string } }
      if (body.error?.code === 'maxlag') return { result: { ok: false, retryable: true, reason: `maxlag: ${body.error.info ?? ''}`, status, retryAfterS: retryAfterS ?? MAXLAG_SECONDS }, bytes }
      if (body.error) return { result: { ok: false, retryable: false, reason: `API error ${body.error.code ?? '?'}: ${body.error.info ?? ''}`, status }, bytes }
      return { result: { ok: true, body }, bytes }
    })
  }

  private attemptBinary(url: string, label: string): Promise<AttemptResult<{ data: Uint8Array; polishedOrigSize?: number }>> {
    return this.timedAttempt(url, label, 'image/*', async (res, status, retryAfterS) => {
      const data = new Uint8Array(await res.arrayBuffer())
      if (status !== 200) return { result: httpFailure(status, retryAfterS), bytes: data.length }
      const type = res.headers.get('content-type') ?? ''
      if (!type.startsWith('image/')) return { result: { ok: false, retryable: false, reason: `unexpected content-type "${type}"`, status }, bytes: data.length }
      const orig = /(?:^|[\s,;])orig_size=(\d+)/.exec(res.headers.get('cf-polished') ?? '')
      return { result: { ok: true, body: { data, ...(orig ? { polishedOrigSize: Number(orig[1]) } : {}) } }, bytes: data.length }
    })
  }

  /** One audited network attempt; `read` turns the response into a result. */
  private async timedAttempt<T>(
    url: string,
    label: string,
    accept: string,
    read: (res: Response, status: number, retryAfterS: number | undefined) => Promise<{ result: AttemptResult<T>; bytes: number }>,
  ): Promise<AttemptResult<T>> {
    this.stats.attempts += 1
    const startedAt = this.opts.now()
    const iso = new Date(startedAt).toISOString()
    this.stats.firstRequestAt ??= iso
    this.stats.lastRequestAt = iso
    let status = 0
    let bytes = 0
    let result: AttemptResult<T>
    try {
      const res = await this.opts.fetchImpl(url, {
        headers: { 'User-Agent': userAgent(), 'Api-User-Agent': userAgent(), Accept: accept },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      status = res.status
      const retryAfter = Number(res.headers.get('retry-after'))
      const outcome = await read(res, status, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined)
      result = outcome.result
      bytes = outcome.bytes
    } catch (cause) {
      result = { ok: false, retryable: true, reason: `network error: ${(cause as Error).message}`, status }
    }
    const ms = this.opts.now() - startedAt
    this.stats.networkMs += ms
    this.audit({ at: iso, cache: label, status, ms, bytes, ok: result.ok, ...(result.ok ? {} : { reason: result.reason }) })
    return result
  }

  private audit(entry: Record<string, unknown>) {
    mkdirSync(this.opts.cacheDir, { recursive: true })
    appendFileSync(join(this.opts.cacheDir, 'requests.log.jsonl'), `${JSON.stringify(entry)}\n`)
    this.opts.log?.(`  GET ${String(entry.cache)} -> ${entry.status || 'ERR'} ${entry.ms}ms ${entry.bytes}B`)
  }
}
