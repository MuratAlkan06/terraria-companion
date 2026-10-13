import { describe, expect, it } from 'vitest'
import { loadDomain, saveDomain, StorageQuotaError, storageKey } from './index'
import { DEFAULT_SETTINGS } from './settings'
import type { StorageBackend } from './types'
import { meta } from '../data/meta'

function memoryBackend(seed: Record<string, string> = {}): StorageBackend & { dump: () => Record<string, string> } {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    dump: () => Object.fromEntries(map),
  }
}

const NOW = new Date('2026-10-12T12:00:00.000Z')

describe('storage: settings domain', () => {
  it('uses the tc.v1.settings key', () => {
    expect(storageKey('settings')).toBe('tc.v1.settings')
  })

  it('returns empty when nothing is stored', () => {
    expect(loadDomain('settings', memoryBackend())).toEqual({ kind: 'empty' })
  })

  it('returns empty when no backend is available', () => {
    expect(loadDomain('settings', null)).toEqual({ kind: 'empty' })
  })

  it('writes the versioned envelope { v, savedAt, gameVersion, data } and reads it back', () => {
    const backend = memoryBackend()
    const data = { ...DEFAULT_SETTINGS, selectedStage: 'early-hm' as const }
    saveDomain('settings', data, backend, NOW)

    const stored = JSON.parse(backend.dump()['tc.v1.settings'])
    expect(stored).toEqual({ v: 1, savedAt: NOW.toISOString(), gameVersion: meta.gameVersion, data })
    expect(stored.gameVersion).toBe('1.4.5.8')

    expect(loadDomain('settings', backend)).toEqual({ kind: 'loaded', data })
  })

  it('refuses to persist invalid data', () => {
    const backend = memoryBackend()
    const bad = { ...DEFAULT_SETTINGS, selectedStage: 'hardmode' } as unknown as typeof DEFAULT_SETTINGS
    expect(() => saveDomain('settings', bad, backend, NOW)).toThrow(TypeError)
    expect(backend.dump()).toEqual({})
  })

  it('throws StorageQuotaError when the write fails', () => {
    const backend: StorageBackend = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError')
      },
      removeItem: () => {},
    }
    expect(() => saveDomain('settings', DEFAULT_SETTINGS, backend, NOW)).toThrow(StorageQuotaError)
  })

  it('treats a throwing getItem (blocked storage) as empty', () => {
    const backend: StorageBackend = {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError')
      },
      setItem: () => {},
      removeItem: () => {},
    }
    expect(loadDomain('settings', backend)).toEqual({ kind: 'empty' })
  })

  const corruptCases: Array<[string, string]> = [
    ['malformed JSON', '{not json'],
    ['bare data without envelope', JSON.stringify(DEFAULT_SETTINGS)],
    ['unknown stage id', JSON.stringify({ v: 1, savedAt: NOW.toISOString(), gameVersion: '1.4.5.8', data: { ...DEFAULT_SETTINGS, selectedStage: 'hardmode' } })],
    ['extra data key', JSON.stringify({ v: 1, savedAt: NOW.toISOString(), gameVersion: '1.4.5.8', data: { ...DEFAULT_SETTINGS, extra: 1 } })],
    ['extra envelope key', JSON.stringify({ v: 1, savedAt: NOW.toISOString(), gameVersion: '1.4.5.8', data: DEFAULT_SETTINGS, x: 1 })],
    ['future version', JSON.stringify({ v: 2, savedAt: NOW.toISOString(), gameVersion: '1.4.5.8', data: DEFAULT_SETTINGS })],
    ['non-integer version', JSON.stringify({ v: 1.5, savedAt: NOW.toISOString(), gameVersion: '1.4.5.8', data: DEFAULT_SETTINGS })],
  ]

  it.each(corruptCases)('quarantines (never deletes) a payload with %s', (_label, raw) => {
    const backend = memoryBackend({ 'tc.v1.settings': raw })
    const result = loadDomain('settings', backend, NOW)

    const expectedKey = `tc.quarantine.settings.${NOW.toISOString()}`
    expect(result).toEqual({ kind: 'quarantined', key: expectedKey })
    expect(backend.dump()).toEqual({ [expectedKey]: raw })
  })

  it('leaves the original in place if the quarantine copy cannot be written', () => {
    const map = new Map([['tc.v1.settings', '{broken']])
    const backend: StorageBackend = {
      getItem: (k) => map.get(k) ?? null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError')
      },
      removeItem: (k) => void map.delete(k),
    }
    expect(loadDomain('settings', backend, NOW)).toEqual({ kind: 'quarantined', key: 'tc.v1.settings' })
    expect(map.get('tc.v1.settings')).toBe('{broken')
  })

  it('keeps an envelope from a different game version (advisory only)', () => {
    const raw = JSON.stringify({ v: 1, savedAt: NOW.toISOString(), gameVersion: '1.4.4.9', data: DEFAULT_SETTINGS })
    expect(loadDomain('settings', memoryBackend({ 'tc.v1.settings': raw }))).toEqual({
      kind: 'loaded',
      data: DEFAULT_SETTINGS,
    })
  })
})
