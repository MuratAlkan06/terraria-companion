/**
 * Progression state (ADR D4: Zustand), persisted through the storage module to `tc.v1.progress`
 * (ADR D6). Hydrated synchronously when first imported, like the settings store, so the map's
 * world-evil choice is in place on its first paint after a reload.
 *
 * P5-S1 changes only `worldEvil` (the boss map's world-evil toggle). `nodeStates` is read and
 * preserved untouched — nothing in this slice marks a defeat.
 */
import { create } from 'zustand'
import { loadDomain, saveDomain, type StorageBackend } from '../storage'
import { EMPTY_PROGRESS, type ProgressData, type WorldEvil } from '../storage/progress'

type LoadStatus = 'loaded' | 'empty' | 'quarantined'

export interface ProgressState {
  progress: ProgressData
  /** How the persisted payload was read at startup (QuarantineNotice consumes this later). */
  loadStatus: LoadStatus
  /** True when the last save failed; the value is kept in memory for this session. */
  persistError: boolean
  setWorldEvil: (worldEvil: WorldEvil | null) => void
}

function hydrate(backend: StorageBackend | null | undefined): Pick<ProgressState, 'progress' | 'loadStatus'> {
  const result = loadDomain('progress', backend)
  if (result.kind === 'loaded') return { progress: result.data, loadStatus: 'loaded' }
  return { progress: EMPTY_PROGRESS, loadStatus: result.kind }
}

/** A progress store over `backend` (default: localStorage). Tests pass an in-memory backend. */
export function createProgressStore(backend?: StorageBackend | null) {
  return create<ProgressState>()((set, get) => ({
    ...hydrate(backend),
    persistError: false,
    setWorldEvil: (worldEvil) => {
      const progress: ProgressData = { ...get().progress, worldEvil }
      let persistError = false
      try {
        saveDomain('progress', progress, backend)
      } catch (error) {
        persistError = true
        console.warn('[progress] World evil kept for this session only.', error)
      }
      set({ progress, persistError })
    },
  }))
}

export const useProgressStore = createProgressStore()
