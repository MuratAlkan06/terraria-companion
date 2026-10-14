import { describe, expect, it, vi } from 'vitest'
import { ProgressV1 } from '../schemas'
import { loadDomain, storageKey, type StorageBackend } from '../storage'
import { EMPTY_PROGRESS, parseProgress } from '../storage/progress'
import { createProgressStore } from './progressStore'

function memoryBackend(seed: Record<string, string> = {}): StorageBackend & { dump: () => Record<string, string> } {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    dump: () => Object.fromEntries(map),
  }
}

const envelope = (data: unknown) => ({ v: 1, savedAt: '2026-10-13T12:00:00.000Z', gameVersion: '1.4.5.8', data })

describe('tc.v1.progress: world evil (P5-S1 map toggle)', () => {
  it('starts with no world evil chosen and nothing tracked', () => {
    const store = createProgressStore(memoryBackend())
    expect(store.getState().progress).toEqual(EMPTY_PROGRESS)
    expect(store.getState().loadStatus).toBe('empty')
  })

  it('setWorldEvil writes a ProgressV1 envelope under tc.v1.progress and survives a reload', () => {
    const backend = memoryBackend()
    const store = createProgressStore(backend)
    store.getState().setWorldEvil('crimson')
    expect(storageKey('progress')).toBe('tc.v1.progress')
    const stored = JSON.parse(backend.dump()['tc.v1.progress'])
    expect(ProgressV1.safeParse(stored).success).toBe(true)
    expect(stored.data).toEqual({ worldEvil: 'crimson', nodeStates: {} })
    // A fresh store (a reload) hydrates the choice.
    expect(createProgressStore(backend).getState().progress.worldEvil).toBe('crimson')
    store.getState().setWorldEvil(null)
    expect(createProgressStore(backend).getState().progress.worldEvil).toBeNull()
  })

  it('preserves stored node states untouched when the world evil changes', () => {
    const backend = memoryBackend({
      'tc.v1.progress': JSON.stringify(envelope({ worldEvil: null, nodeStates: { 'king-slime': 'defeated', deerclops: 'skipped' } })),
    })
    const store = createProgressStore(backend)
    store.getState().setWorldEvil('corruption')
    const loaded = loadDomain('progress', backend)
    expect(loaded).toEqual({ kind: 'loaded', data: { worldEvil: 'corruption', nodeStates: { 'king-slime': 'defeated', deerclops: 'skipped' } } })
  })

  it('keeps the choice in memory (and says so) when storage is unavailable', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = createProgressStore(null)
    store.getState().setWorldEvil('corruption')
    expect(store.getState()).toMatchObject({ progress: { worldEvil: 'corruption' }, persistError: true })
    warn.mockRestore()
  })

  it('quarantines an unreadable payload (set aside, not deleted) and starts fresh', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const backend = memoryBackend({ 'tc.v1.progress': JSON.stringify(envelope({ worldEvil: 'hallow', nodeStates: {} })) })
    const store = createProgressStore(backend)
    expect(store.getState()).toMatchObject({ progress: EMPTY_PROGRESS, loadStatus: 'quarantined' })
    expect(Object.keys(backend.dump()).some((k) => k.startsWith('tc.quarantine.progress.'))).toBe(true)
    warn.mockRestore()
  })
})

describe('progress domain parser ⇄ Zod ProgressV1 parity', () => {
  const valid: unknown[] = [
    { worldEvil: null, nodeStates: {} },
    { worldEvil: 'corruption', nodeStates: { 'wall-of-flesh': 'defeated' } },
    { worldEvil: 'crimson', nodeStates: { 'queen-bee': 'skipped', plantera: 'defeated' } },
  ]
  const invalid: Array<[string, unknown]> = [
    ['not an object', []],
    ['missing nodeStates', { worldEvil: null }],
    ['missing worldEvil', { nodeStates: {} }],
    ['unknown world evil', { worldEvil: 'hallow', nodeStates: {} }],
    ['extra key', { worldEvil: null, nodeStates: {}, extra: 1 }],
    ['nodeStates array', { worldEvil: null, nodeStates: [] }],
    ['bad state', { worldEvil: null, nodeStates: { plantera: 'attempted' } }],
    ['non-slug key', { worldEvil: null, nodeStates: { 'Wall of Flesh': 'defeated' } }],
  ]

  it.each(valid.map((v) => [JSON.stringify(v), v]))('accepts %s like Zod', (_label, data) => {
    expect(parseProgress(data)).toEqual(data)
    expect(ProgressV1.safeParse(envelope(data)).success).toBe(true)
  })

  it.each(invalid)('rejects %s like Zod', (_label, data) => {
    expect(() => parseProgress(data)).toThrow(TypeError)
    expect(ProgressV1.safeParse(envelope(data)).success).toBe(false)
  })
})
