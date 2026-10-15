/**
 * Cross-cutting settings state (ADR D4: Zustand), persisted through the storage
 * module to `tc.v1.settings` (ADR D6). Hydrated synchronously at module load so the
 * persisted stage is visible on the first paint after a reload. Re-reads storage when the domain is
 * changed outside the store (P7-S2: an import, a restore, a clear), so the header chip follows live.
 */
import { create } from 'zustand'
import { loadDomain, saveDomain } from '../storage'
import { onDomainsChanged } from '../storage/events'
import { DEFAULT_SETTINGS, type SettingsData } from '../storage/settings'
import type { Stage } from './stages'

type LoadStatus = 'loaded' | 'empty' | 'quarantined'

interface SettingsState {
  settings: SettingsData
  /** How the persisted payload was read at startup (QuarantineNotice consumes this later). */
  loadStatus: LoadStatus
  /** True when the last save failed; the value is kept in memory for this session. */
  persistError: boolean
  setStage: (stage: Stage | null) => void
}

function hydrate(): Pick<SettingsState, 'settings' | 'loadStatus'> {
  const result = loadDomain('settings')
  if (result.kind === 'loaded') return { settings: result.data, loadStatus: 'loaded' }
  return { settings: DEFAULT_SETTINGS, loadStatus: result.kind }
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  ...hydrate(),
  persistError: false,
  setStage: (stage) => {
    const settings: SettingsData = { ...get().settings, selectedStage: stage }
    let persistError = false
    try {
      saveDomain('settings', settings)
    } catch (error) {
      persistError = true
      console.warn('[settings] Stage kept for this session only.', error)
    }
    set({ settings, persistError })
  },
}))

onDomainsChanged(undefined, ['settings'], () => useSettingsStore.setState({ ...hydrate(), persistError: false }))

export const useSelectedStage = (): Stage | null => useSettingsStore((s) => s.settings.selectedStage)
