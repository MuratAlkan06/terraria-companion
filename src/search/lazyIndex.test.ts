import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchIndex } from './types'

/** Stand-in for the lazy chunk: counts evaluations so the test sees exactly when it loads. */
const chunk = vi.hoisted(() => ({ evaluated: 0, build: vi.fn() }))

vi.mock('./buildIndex', () => {
  chunk.evaluated += 1
  return { buildSearchIndex: chunk.build }
})

const fakeIndex = { docCount: 840 } as unknown as SearchIndex

beforeEach(() => {
  vi.resetModules()
  chunk.build.mockReset()
})

describe('loadSearchIndex — lazy, once per session (ADR D7)', () => {
  it('importing the shell entry loads nothing; the first request builds once; later ones reuse it', async () => {
    chunk.build.mockResolvedValue(fakeIndex)
    const search = await import('./index')
    expect(chunk.evaluated).toBe(0)
    expect(search.peekSearchIndex()).toBeUndefined()

    const [a, b] = await Promise.all([search.loadSearchIndex(), search.loadSearchIndex()])
    await search.loadSearchIndex()
    expect([a, b]).toEqual([fakeIndex, fakeIndex])
    expect(chunk.evaluated).toBe(1)
    expect(chunk.build).toHaveBeenCalledTimes(1)
    expect(typeof chunk.build.mock.calls[0][0]).toBe('number') // start time for the init measurement
    expect(search.peekSearchIndex()).toBe(fakeIndex)
  })

  it('a failed build is not cached: Retry rebuilds', async () => {
    chunk.build.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(fakeIndex)
    const search = await import('./index')
    await expect(search.loadSearchIndex()).rejects.toThrow('boom')
    expect(search.peekSearchIndex()).toBeUndefined()
    await expect(search.loadSearchIndex()).resolves.toBe(fakeIndex)
  })

  it('a chunk that fails to download is a ChunkLoadError needing a reload (moduleImport)', async () => {
    vi.doMock('./buildIndex', () => {
      throw new Error('Failed to fetch dynamically imported module')
    })
    try {
      const search = await import('./index')
      // Same (fresh) module graph as ./index after resetModules, so instanceof is meaningful.
      const { ChunkLoadError } = await import('../data-access/errors')
      const error = await search.loadSearchIndex().catch((e: unknown) => e)
      expect(error).toBeInstanceOf(ChunkLoadError)
      expect(error).toMatchObject({ file: 'search-index', moduleImport: true })
    } finally {
      vi.doUnmock('./buildIndex')
    }
  })
})
