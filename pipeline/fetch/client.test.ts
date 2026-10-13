/* ADR-001 D2 etiquette is enforced by the client itself: pacing, maxlag, UA, cache, backoff, stop. */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FetchError, sha1Hex, WikiClient } from './client'

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

  it('never starts early when a timer fires before the requested delay has elapsed', async () => {
    let clock = 1_000_000
    const sleeps: number[] = []
    const starts: number[] = []
    const fetchImpl = (async () => {
      starts.push(clock)
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    // the first sleep of each wait returns 1 ms early (as real timers can)
    let early = true
    const client = new WikiClient({ cacheDir: dir, fetchImpl, now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += early ? ms - 1 : ms; early = !early }, minIntervalMs: 1100 })
    await client.get({ a: '1' }, 'x/1')
    await client.get({ a: '2' }, 'x/2')
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1100)
    expect(sleeps).toEqual([1100, 1])
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

describe('WikiClient.download (P2-S2 sprites)', () => {
  const ORIGINAL = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4, 5, 6])
  const POLISHED = new Uint8Array([137, 80, 78, 71, 9, 9])
  const URL_ = 'https://terraria.wiki.gg/images/Zenith.png?6d467f'
  function binHarness(replies: { status: number; body: Uint8Array; headers?: Record<string, string> }[]) {
    let clock = 1_000_000
    const sleeps: number[] = []
    const calls: string[] = []
    const fetchImpl = (async (url: string) => {
      calls.push(url)
      clock += 50
      const r = replies.shift() ?? { status: 404, body: new Uint8Array() }
      return new Response(r.body, { status: r.status, headers: { 'content-type': 'image/png', ...r.headers } })
    }) as unknown as typeof fetch
    const client = new WikiClient({ cacheDir: dir, fetchImpl, now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms }, minIntervalMs: 1100, backoffBaseMs: 5000, maxRetries: 2 })
    return { client, calls, sleeps }
  }
  const expected = { sha1: sha1Hex(ORIGINAL), bytes: ORIGINAL.length }

  it('writes a byte-exact file and serves it from the cache afterwards (resumable)', async () => {
    const h = binHarness([{ status: 200, body: ORIGINAL }])
    const dest = join(dir, 'sprites/4956.png')
    expect(await h.client.download(URL_, dest, expected, 'sprite:4956')).toMatchObject({ fromCache: false, verification: 'exact' })
    expect(new Uint8Array(readFileSync(dest))).toEqual(ORIGINAL)
    expect(await h.client.download(URL_, dest, expected, 'sprite:4956')).toMatchObject({ fromCache: true })
    expect(h.calls).toHaveLength(1)
  })

  it('accepts a CDN-optimized rendition only when cf-polished orig_size equals the wiki size; caches it by its served SHA-1', async () => {
    const h = binHarness([
      { status: 200, body: POLISHED, headers: { 'cf-polished': `ok, orig_size=${ORIGINAL.length}` } },
      { status: 200, body: POLISHED, headers: { 'cf-polished': 'ok, orig_size=999' } },
      { status: 200, body: POLISHED },
    ])
    const dest = join(dir, 'sprites/1.png')
    const ok = await h.client.download(URL_, dest, expected, 'sprite:1')
    expect(ok).toMatchObject({ verification: 'cdn-optimized', servedSha1: sha1Hex(POLISHED) })
    expect(await h.client.download(URL_, dest, expected, 'sprite:1', ok.servedSha1)).toMatchObject({ fromCache: true })
    await expect(h.client.download(URL_, join(dir, 'sprites/2.png'), expected, 'sprite:2')).rejects.toThrow(/original size 999/)
    await expect(h.client.download(URL_, join(dir, 'sprites/3.png'), expected, 'sprite:3')).rejects.toThrow(/no CDN optimization header/)
    expect(existsSync(join(dir, 'sprites/2.png'))).toBe(false)
  })

  it('paces downloads like API requests and never downloads from outside the wiki', async () => {
    const h = binHarness([{ status: 200, body: ORIGINAL }, { status: 200, body: ORIGINAL }])
    await Promise.all([h.client.download(URL_, join(dir, 'a.png'), expected, 'a'), h.client.download(URL_, join(dir, 'b.png'), expected, 'b')])
    expect(h.sleeps).toEqual([1050])
    await expect(h.client.download('https://example.com/x.png', join(dir, 'c.png'), expected, 'c')).rejects.toThrow(/refusing/)
    const missing = binHarness([{ status: 404, body: new Uint8Array() }])
    await expect(missing.client.download(URL_, join(dir, 'd.png'), expected, 'd')).rejects.toMatchObject({ status: 404 })
  })
})
