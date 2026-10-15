/**
 * Test fixtures for the storage module (P7-S2 tests; never imported by app code): an in-memory backend
 * that can list its keys like localStorage, and one valid payload per domain.
 */
import { defaultReadinessSetup } from '../readiness'
import type { DomainData, DomainKey } from '../index'
import type { StorageBackend } from '../types'

export type MemoryBackend = StorageBackend & { dump: () => Record<string, string>; failWrites: (fail: boolean) => void }

/** localStorage-like: getItem/setItem/removeItem plus key()/length; `failWrites(true)` makes setItem throw (quota). */
export function memoryBackend(seed: Record<string, string> = {}): MemoryBackend {
  const map = new Map(Object.entries(seed))
  let failing = false
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      if (failing) throw new DOMException('full', 'QuotaExceededError')
      map.set(k, String(v))
    },
    removeItem: (k) => void map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
    dump: () => Object.fromEntries(map),
    failWrites: (fail) => {
      failing = fail
    },
  }
}

export const AT = '2026-10-14T10:00:00.000Z'
export const LATER = '2026-10-15T08:30:00.000Z'

const loadout = (main: number | null) => ({ ...defaultReadinessSetup().loadout, mainWeapon: main })

export const DATA: { [K in DomainKey]: DomainData<K> } = {
  settings: { selectedStage: 'early-hm', spriteFallback: false, labIgnoreManaDefault: false },
  recent: { entries: [{ ref: 'i:4956', viewedAt: AT }] },
  progress: { worldEvil: 'crimson', nodeStates: { 'eye-of-cthulhu': 'defeated', skeletron: 'skipped' } },
  checklists: { byKey: { 'guide:new-world': ['a', 'b'], 'boss:king-slime:prep': ['p-00000001'] } },
  favorites: { refs: ['i:4956', 'boss:plantera'] },
  readiness: { ...defaultReadinessSetup('mid-hm'), bossId: 'plantera', loadout: loadout(4956) },
  builds: {
    builds: [
      { buildId: 'bfixture01', name: 'Melee test', createdAt: AT, updatedAt: AT, stage: 'early-hm', class: 'melee', difficulty: 'expert', goal: 'boss', slots: loadout(4956), targetBoss: 'plantera', ownedIds: [4956], emptiedSlots: ['alt'] },
    ],
  },
  plans: {
    plans: [
      {
        planId: 'pfixture01',
        targetItemId: 1613,
        createdAt: AT,
        updatedAt: AT,
        status: 'active',
        stageAtCreation: 'early-hm',
        snapshot: { generatedAt: AT, gameVersion: '1.4.5.8', steps: [{ stepId: 's1', kind: 'craft', text: 'Craft it', itemId: 1613, amount: 1, groupKey: 'craft', refs: ['i:1613'] }] },
        owned: { 'i:22': 3 },
        checkedStepIds: ['s1'],
      },
    ],
  },
}

/** `data` stored as this app writes it: the envelope at `v` (default: current). */
export const envelopeText = (data: unknown, v = 1, savedAt = AT, gameVersion = '1.4.5.8'): string => JSON.stringify({ v, savedAt, gameVersion, data })
