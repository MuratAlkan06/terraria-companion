import { describe, expect, it } from 'vitest'
import { RecentV1 } from '../schemas'
import { loadDomain, storageKey, type StorageBackend } from '../storage'
import { parseRecent, RECENT_MAX, withVisit } from '../storage/recent'
import { recordRecentVisit } from './recent'

function memoryBackend(seed: Record<string, string> = {}): StorageBackend & { dump: () => Record<string, string> } {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    dump: () => Object.fromEntries(map),
  }
}

const at = (minute: number) => new Date(Date.UTC(2026, 9, 12, 12, minute))

describe('tc.v1.recent recording (P2-S3: detail visits)', () => {
  it('writes a RecentV1 envelope under tc.v1.recent', () => {
    const backend = memoryBackend()
    const result = recordRecentVisit('i:4956', backend, at(0))
    expect(result.saved).toBe(true)
    expect(storageKey('recent')).toBe('tc.v1.recent')
    const stored = JSON.parse(backend.dump()['tc.v1.recent'])
    expect(RecentV1.safeParse(stored).success).toBe(true)
    expect(stored.data).toEqual({ entries: [{ ref: 'i:4956', viewedAt: at(0).toISOString() }] })
  })

  it('keeps most-recent-first order and de-duplicates a revisit (moves it to the front)', () => {
    const backend = memoryBackend()
    recordRecentVisit('i:1', backend, at(1))
    recordRecentVisit('i:2', backend, at(2))
    recordRecentVisit('i:1', backend, at(3))
    const loaded = loadDomain('recent', backend)
    expect(loaded.kind === 'loaded' && loaded.data.entries).toEqual([
      { ref: 'i:1', viewedAt: at(3).toISOString() },
      { ref: 'i:2', viewedAt: at(2).toISOString() },
    ])
  })

  it(`caps the list at ${RECENT_MAX} entries, dropping the oldest`, () => {
    const backend = memoryBackend()
    for (let i = 1; i <= RECENT_MAX + 5; i++) recordRecentVisit(`i:${i}`, backend, at(i))
    const loaded = loadDomain('recent', backend)
    if (loaded.kind !== 'loaded') throw new Error('expected loaded')
    expect(loaded.data.entries).toHaveLength(RECENT_MAX)
    expect(loaded.data.entries[0].ref).toBe(`i:${RECENT_MAX + 5}`)
    expect(loaded.data.entries.at(-1)?.ref).toBe('i:6')
  })

  it('quarantines an unreadable stored list (set aside, not deleted) and starts fresh', () => {
    const backend = memoryBackend({ 'tc.v1.recent': '{not json' })
    const result = recordRecentVisit('i:4956', backend, at(0))
    expect(result.saved).toBe(true)
    const dump = backend.dump()
    const quarantined = Object.keys(dump).filter((k) => k.startsWith('tc.quarantine.recent.'))
    expect(quarantined).toHaveLength(1)
    expect(dump[quarantined[0]]).toBe('{not json')
    expect(JSON.parse(dump['tc.v1.recent']).data.entries).toHaveLength(1)
  })

  it('never throws when storage is unavailable or full', () => {
    expect(recordRecentVisit('i:1', null, at(0))).toMatchObject({ saved: false })
    const full: StorageBackend = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError')
      },
      removeItem: () => {},
    }
    expect(recordRecentVisit('i:1', full, at(0))).toMatchObject({ saved: false })
  })
})

describe('recent domain parser ⇄ Zod RecentV1 parity', () => {
  const envelope = (data: unknown) => ({ v: 1, savedAt: at(0).toISOString(), gameVersion: '1.4.5.8', data })
  const valid = { entries: [{ ref: 'i:4956', viewedAt: '2026-10-12T12:00:00.000Z' }, { ref: 'boss:plantera', viewedAt: '2026-10-12T12:00:00Z' }] }
  const invalid: Array<[string, unknown]> = [
    ['not an object', []],
    ['extra key', { entries: [], extra: 1 }],
    ['bad ref', { entries: [{ ref: 'weapon:4956', viewedAt: '2026-10-12T12:00:00Z' }] }],
    ['bad date', { entries: [{ ref: 'i:1', viewedAt: 'yesterday' }] }],
    ['offset date', { entries: [{ ref: 'i:1', viewedAt: '2026-10-12T12:00:00+02:00' }] }],
    ['extra entry key', { entries: [{ ref: 'i:1', viewedAt: '2026-10-12T12:00:00Z', x: 1 }] }],
    ['too many', { entries: Array.from({ length: RECENT_MAX + 1 }, (_, i) => ({ ref: `i:${i + 1}`, viewedAt: '2026-10-12T12:00:00Z' })) }],
  ]

  it('accepts what Zod accepts', () => {
    expect(RecentV1.safeParse(envelope(valid)).success).toBe(true)
    expect(parseRecent(valid)).toEqual(valid)
  })

  for (const [name, data] of invalid) {
    it(`rejects what Zod rejects: ${name}`, () => {
      expect(RecentV1.safeParse(envelope(data)).success).toBe(false)
      expect(() => parseRecent(data)).toThrow(TypeError)
    })
  }

  it('withVisit is pure', () => {
    const before = { entries: [{ ref: 'i:2', viewedAt: at(1).toISOString() }] }
    const after = withVisit(before, 'i:3', at(2))
    expect(before.entries).toHaveLength(1)
    expect(after.entries.map((e) => e.ref)).toEqual(['i:3', 'i:2'])
  })
})
