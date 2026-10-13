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
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
} from './config'

export type ApiParams = Record<string, string>

export class FetchError extends Error {
  readonly code = 'E_FETCH'
  constructor(message: string) {
    super(`[E_FETCH] ${message}`)
  }
}

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
    for (let attempt = 0; ; attempt += 1) {
      await this.pace()
      const outcome = await this.attempt(url, cacheName)
      if (outcome.ok) {
        const fetchedAt = new Date(this.opts.now()).toISOString()
        const path = this.cachePath(cacheName)
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, `${JSON.stringify({ request, fetchedAt, response: outcome.body } satisfies CacheEntry)}\n`)
        this.stats.networkRequests += 1
        return { response: outcome.body, fetchedAt, fromCache: false }
      }
      if (!outcome.retryable) throw new FetchError(`${cacheName}: ${outcome.reason} (not retried)`)
      if (attempt >= this.opts.maxRetries) {
        throw new FetchError(`${cacheName}: ${outcome.reason} — giving up after ${attempt + 1} attempts (wiki unavailable or throttling; stopping per D2)`)
      }
      const backoff = Math.max(this.opts.backoffBaseMs * 2 ** attempt, (outcome.retryAfterS ?? 0) * 1000)
      this.stats.retries += 1
      this.opts.log?.(`  backoff ${Math.round(backoff / 1000)}s after: ${outcome.reason}`)
      await this.opts.sleep(backoff)
    }
  }

  /** Waits so that consecutive request starts are >= minIntervalMs apart. */
  private async pace() {
    const wait = this.lastStart + this.opts.minIntervalMs - this.opts.now()
    if (wait > 0) await this.opts.sleep(wait)
    this.lastStart = this.opts.now()
  }

  private async attempt(
    url: string,
    cacheName: string,
  ): Promise<{ ok: true; body: unknown } | { ok: false; retryable: boolean; reason: string; retryAfterS?: number }> {
    this.stats.attempts += 1
    const startedAt = this.opts.now()
    const iso = new Date(startedAt).toISOString()
    this.stats.firstRequestAt ??= iso
    this.stats.lastRequestAt = iso
    let status = 0
    let bytes = 0
    let result: Awaited<ReturnType<WikiClient['attempt']>>
    try {
      const res = await this.opts.fetchImpl(url, {
        headers: { 'User-Agent': userAgent(), 'Api-User-Agent': userAgent(), Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      status = res.status
      const text = await res.text()
      bytes = text.length
      const retryAfter = Number(res.headers.get('retry-after'))
      const retryAfterS = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined
      if (status === 429 || status >= 500) result = { ok: false, retryable: true, reason: `HTTP ${status}`, retryAfterS }
      else if (status !== 200) result = { ok: false, retryable: false, reason: `HTTP ${status}${status === 403 ? ' (blocked?)' : ''}` }
      else {
        const body = JSON.parse(text) as { error?: { code?: string; info?: string } }
        if (body.error?.code === 'maxlag') result = { ok: false, retryable: true, reason: `maxlag: ${body.error.info ?? ''}`, retryAfterS: retryAfterS ?? MAXLAG_SECONDS }
        else if (body.error) result = { ok: false, retryable: false, reason: `API error ${body.error.code ?? '?'}: ${body.error.info ?? ''}` }
        else result = { ok: true, body }
      }
    } catch (cause) {
      result = { ok: false, retryable: true, reason: `network error: ${(cause as Error).message}` }
    }
    const ms = this.opts.now() - startedAt
    this.stats.networkMs += ms
    this.audit({ at: iso, cache: cacheName, status, ms, bytes, ok: result.ok, ...(result.ok ? {} : { reason: result.reason }) })
    return result
  }

  private audit(entry: Record<string, unknown>) {
    mkdirSync(this.opts.cacheDir, { recursive: true })
    appendFileSync(join(this.opts.cacheDir, 'requests.log.jsonl'), `${JSON.stringify(entry)}\n`)
    this.opts.log?.(`  GET ${String(entry.cache)} -> ${entry.status || 'ERR'} ${entry.ms}ms ${entry.bytes}B`)
  }
}
