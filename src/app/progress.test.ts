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

describe('tc.v1.progress: defeat tracking (P5-S4 AC1, AC3)', () => {
  const stored = (backend: ReturnType<typeof memoryBackend>) => JSON.parse(backend.dump()['tc.v1.progress'])

  it('three states, any → any: not attempted (absent) → defeated → skipped → not attempted, each saved at once and reloaded', () => {
    const backend = memoryBackend()
    const store = createProgressStore(backend)
    expect(store.getState().setNodeState('queen-bee', 'defeated')).toBe(true)
    expect(stored(backend).data.nodeStates).toEqual({ 'queen-bee': 'defeated' })
    expect(ProgressV1.safeParse(stored(backend)).success).toBe(true)
    expect(createProgressStore(backend).getState().progress.nodeStates).toEqual({ 'queen-bee': 'defeated' })

    store.getState().setNodeState('queen-bee', 'skipped')
    expect(createProgressStore(backend).getState().progress.nodeStates).toEqual({ 'queen-bee': 'skipped' })
    store.getState().setNodeState('queen-bee', null)
    // not attempted = absent, never a stored value
    expect(stored(backend).data.nodeStates).toEqual({})
    expect(createProgressStore(backend).getState().progress.nodeStates).toEqual({})
  })

  it('marks are per node and leave the world evil alone; a no-op change writes nothing new', () => {
    const backend = memoryBackend()
    const store = createProgressStore(backend)
    store.getState().setWorldEvil('crimson')
    store.getState().setNodeState('wall-of-flesh', 'defeated')
    store.getState().setNodeState('brain-of-cthulhu', 'defeated')
    const before = backend.dump()['tc.v1.progress']
    store.getState().setNodeState('wall-of-flesh', 'defeated')
    expect(backend.dump()['tc.v1.progress']).toBe(before)
    expect(stored(backend).data).toEqual({ worldEvil: 'crimson', nodeStates: { 'wall-of-flesh': 'defeated', 'brain-of-cthulhu': 'defeated' } })
  })

  it('refuses a key the payload could not store (never poisons later saves)', () => {
    const backend = memoryBackend()
    const store = createProgressStore(backend)
    expect(store.getState().setNodeState('Wall of Flesh', 'defeated')).toBe(false)
    expect(store.getState().progress.nodeStates).toEqual({})
    expect(store.getState().setNodeState('wall-of-flesh', 'defeated')).toBe(true)
  })

  it('keeps a mark in memory (and says so) when storage fails', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = createProgressStore(null)
    expect(store.getState().setNodeState('plantera', 'defeated')).toBe(false)
    expect(store.getState()).toMatchObject({ progress: { nodeStates: { plantera: 'defeated' } }, persistError: true })
    warn.mockRestore()
  })

  it('a quarantined payload is set aside; the next mark writes a fresh valid envelope and the quarantined copy stays', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const backend = memoryBackend({ 'tc.v1.progress': JSON.stringify(envelope({ worldEvil: null, nodeStates: { plantera: 'attempted' } })) })
    const store = createProgressStore(backend)
    expect(store.getState()).toMatchObject({ progress: EMPTY_PROGRESS, loadStatus: 'quarantined' })
    store.getState().setNodeState('plantera', 'defeated')
    expect(ProgressV1.safeParse(stored(backend)).success).toBe(true)
    expect(stored(backend).data.nodeStates).toEqual({ plantera: 'defeated' })
    expect(Object.keys(backend.dump()).filter((k) => k.startsWith('tc.quarantine.progress.'))).toHaveLength(1)
    warn.mockRestore()
  })

  it('reset clears nodeStates ONLY (world evil kept), returns what it cleared; the one-shot restore puts it back (later marks win)', () => {
    const backend = memoryBackend()
    const store = createProgressStore(backend)
    store.getState().setWorldEvil('corruption')
    store.getState().setNodeState('wall-of-flesh', 'defeated')
    store.getState().setNodeState('queen-slime', 'skipped')
    const cleared = store.getState().resetNodeStates()
    expect(cleared).toEqual({ 'wall-of-flesh': 'defeated', 'queen-slime': 'skipped' })
    expect(stored(backend).data).toEqual({ worldEvil: 'corruption', nodeStates: {} })
    // a mark made between the reset and the undo is kept over the restored one
    store.getState().setNodeState('queen-slime', 'defeated')
    expect(store.getState().restoreNodeStates(cleared)).toBe(true)
    expect(createProgressStore(backend).getState().progress).toEqual({ worldEvil: 'corruption', nodeStates: { 'wall-of-flesh': 'defeated', 'queen-slime': 'defeated' } })
  })

  it('the map’s cascade baseline starts as loaded, is never persisted, and catches up when the map has shown the change', () => {
    const backend = memoryBackend({ 'tc.v1.progress': JSON.stringify(envelope({ worldEvil: null, nodeStates: { 'king-slime': 'defeated' } })) })
    const store = createProgressStore(backend)
    expect(store.getState().shownNodeStates).toEqual({ 'king-slime': 'defeated' })
    store.getState().setNodeState('wall-of-flesh', 'defeated') // e.g. on the boss page
    expect(store.getState().shownNodeStates).toEqual({ 'king-slime': 'defeated' })
    store.getState().markNodeStatesShown()
    expect(store.getState().shownNodeStates).toBe(store.getState().progress.nodeStates)
    expect(Object.keys(stored(backend).data)).toEqual(['worldEvil', 'nodeStates'])
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
