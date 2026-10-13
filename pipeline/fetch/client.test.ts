/* ADR-001 D2 etiquette is enforced by the client itself: pacing, maxlag, UA, cache, backoff, stop. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FetchError, WikiClient } from './client'

type Reply = { status: number; body?: unknown; headers?: Record<string, string> }

function harness(replies: Reply[], opts: { refresh?: boolean; offline?: boolean } = {}) {
  let clock = 1_000_000
  const sleeps: number[] = []
  const calls: { url: string; headers: Record<string, string> }[] = []
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: init?.headers as Record<string, string> })
    clock += 200 // network time
    const r = replies.shift() ?? { status: 200, body: { ok: true } }
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: r.headers })
  }) as unknown as typeof fetch
  const client = new WikiClient({
    cacheDir: dir,
    fetchImpl,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms)
      clock += ms
    },
    minIntervalMs: 1100,
    backoffBaseMs: 5000,
    maxRetries: 2,
    ...opts,
  })
  return { client, sleeps, calls, starts: () => calls.length }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tc-client-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('WikiClient etiquette', () => {
  it('sends maxlag=5, JSON format and a descriptive User-Agent', async () => {
    const h = harness([{ status: 200, body: { query: {} } }])
    await h.client.get({ action: 'query', meta: 'siteinfo' }, 'x/a')
    const url = new URL(h.calls[0].url)
    expect(url.origin + url.pathname).toBe('https://terraria.wiki.gg/api.php')
    expect(url.searchParams.get('maxlag')).toBe('5')
    expect(url.searchParams.get('format')).toBe('json')
    expect(h.calls[0].headers['User-Agent']).toMatch(/^TerrariaCompanionDataPipeline\/.*<=1 req\/s/)
  })

  it('paces request starts at least minIntervalMs apart, serially, even when called concurrently', async () => {
    const h = harness([])
    await Promise.all([h.client.get({ a: '1' }, 'x/1'), h.client.get({ a: '2' }, 'x/2'), h.client.get({ a: '3' }, 'x/3')])
    expect(h.calls).toHaveLength(3)
    // after the first request (200 ms of network time) the client waits the remaining 900 ms, twice
    expect(h.sleeps).toEqual([900, 900])
  })

  it('serves identical requests from the cache (resumable) and refetches when params change', async () => {
    const h = harness([{ status: 200, body: { v: 1 } }, { status: 200, body: { v: 2 } }])
    expect((await h.client.get({ a: '1' }, 'x/a')).response).toEqual({ v: 1 })
    expect(await h.client.get({ a: '1' }, 'x/a')).toMatchObject({ response: { v: 1 }, fromCache: true })
    expect(h.calls).toHaveLength(1)
    expect((await h.client.get({ a: '2' }, 'x/a')).response).toEqual({ v: 2 })
    expect(h.client.stats).toMatchObject({ networkRequests: 2, cacheHits: 1 })
  })

  it('backs off exponentially on 429/5xx and honours Retry-After', async () => {
    const h = harness([{ status: 429, headers: { 'retry-after': '30' } }, { status: 503 }, { status: 200, body: { ok: 1 } }])
    expect((await h.client.get({ a: '1' }, 'x/a')).response).toEqual({ ok: 1 })
    expect(h.sleeps.filter((ms) => ms >= 5000)).toEqual([30_000, 10_000])
    expect(h.client.stats.retries).toBe(2)
  })

  it('retries a MediaWiki maxlag error', async () => {
    const h = harness([{ status: 200, body: { error: { code: 'maxlag', info: 'Waiting for db: 7 seconds lagged' } } }, { status: 200, body: { ok: 1 } }])
    expect((await h.client.get({ a: '1' }, 'x/a')).response).toEqual({ ok: 1 })
    expect(h.client.stats.retries).toBe(1)
  })

  it('STOPS (E_FETCH) after maxRetries on a persistent error instead of hammering', async () => {
    const h = harness([{ status: 503 }, { status: 503 }, { status: 503 }, { status: 200 }])
    await expect(h.client.get({ a: '1' }, 'x/a')).rejects.toThrow(/giving up after 3 attempts/)
    expect(h.calls).toHaveLength(3)
  })

  it('does not retry 403 (blocked) or other API errors', async () => {
    const blocked = harness([{ status: 403 }])
    await expect(blocked.client.get({ a: '1' }, 'x/a')).rejects.toBeInstanceOf(FetchError)
    expect(blocked.calls).toHaveLength(1)
    const apiError = harness([{ status: 200, body: { error: { code: 'badvalue', info: 'nope' } } }])
    await expect(apiError.client.get({ a: '1' }, 'x/b')).rejects.toThrow(/API error badvalue/)
    expect(apiError.calls).toHaveLength(1)
  })

  it('offline mode never touches the network', async () => {
    const h = harness([], { offline: true })
    await expect(h.client.get({ a: '1' }, 'x/a')).rejects.toThrow(/offline mode/)
    expect(h.calls).toHaveLength(0)
  })

  it('rejects cache names that could escape the cache directory', () => {
    const h = harness([])
    expect(() => h.client.cachePath('../etc/passwd')).toThrow(/invalid cache name/)
  })
})
