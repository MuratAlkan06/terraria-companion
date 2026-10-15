/**
 * Checklist state (ADR D4: Zustand) over the shared `tc.v1.checklists` domain (AMENDMENTS-001 A7),
 * through the generic storage API only (loadDomain / saveDomain). Hydrated synchronously when the
 * guides chunk first loads, so checked steps are on screen in the first paint after a reload.
 *
 * Other features keep their own keys in the same domain (`boss:<slug>:prep`), possibly through
 * their own store. Every write therefore re-reads the stored payload and replaces only the key it
 * changes (read-merge-write), so one owner never drops another's checklist.
 *
 * Unreadable payloads are quarantined by the storage module (set aside, never deleted); the store
 * then starts empty and reports `loadStatus: 'quarantined'` for the page's notice (UX_SPEC §5.6).
 * P7-S2: re-reads storage when the domain changes outside the store (an import, a restore, a clear).
 */
import { create } from 'zustand'
import { loadDomain, saveDomain, type StorageBackend } from '../../../storage'
import { onDomainsChanged } from '../../../storage/events'
import { EMPTY_CHECKLISTS, withEntry, type ChecklistsData } from '../../../storage/checklists'
import { checklistKey, type Guide } from './guideModel'

type LoadStatus = 'loaded' | 'empty' | 'quarantined'

export interface ChecklistState {
  byKey: ChecklistsData['byKey']
  /** How the persisted payload was read at startup. */
  loadStatus: LoadStatus
  /** True when the last save failed; the change is kept in memory for this session. */
  persistError: boolean
  /** Sets one entry of one checklist (idempotent). */
  setChecked: (key: string, entryId: string, checked: boolean) => void
}

function hydrate(backend: StorageBackend | null | undefined): Pick<ChecklistState, 'byKey' | 'loadStatus'> {
  const result = loadDomain('checklists', backend)
  if (result.kind === 'loaded') return { byKey: result.data.byKey, loadStatus: 'loaded' }
  return { byKey: EMPTY_CHECKLISTS.byKey, loadStatus: result.kind }
}

/** A checklist store over `backend` (default: localStorage). Tests pass an in-memory backend. */
export function createChecklistStore(backend?: StorageBackend | null) {
  return create<ChecklistState>()((set, get) => {
    onDomainsChanged(backend, ['checklists'], () => set({ ...hydrate(backend), persistError: false }))
    return {
      ...hydrate(backend),
      persistError: false,
      setChecked: (key, entryId, checked) => {
        // Latest stored payload: another owner may have written its own keys since we hydrated.
        const latest = loadDomain('checklists', backend)
        const base: ChecklistsData = latest.kind === 'loaded' ? latest.data : { byKey: get().byKey }
        const { byKey } = withEntry(base, key, entryId, checked)
        let persistError = false
        try {
          saveDomain('checklists', { byKey }, backend)
        } catch (error) {
          persistError = true
          console.warn('[checklists] Change kept for this session only.', error)
        }
        // A payload that turned unreadable since startup was just set aside: say so, like at load.
        set({ byKey, persistError, ...(latest.kind === 'quarantined' ? { loadStatus: 'quarantined' as const } : {}) })
      },
    }
  })
}

export const useChecklistStore = createChecklistStore()

/** Checked entry ids of one checklist, limited to entries that still exist. */
export function checkedIn(byKey: ChecklistsData['byKey'], key: string, entryIds: readonly string[]): Set<string> {
  const stored = new Set(byKey[key] ?? [])
  return new Set(entryIds.filter((id) => stored.has(id)))
}

export interface ChecklistProgress {
  done: number
  total: number
}

/** Progress of a guide's checklist from the store (stored ids of removed entries don't count). */
export function useGuideProgress(guide: Guide): ChecklistProgress {
  const byKey = useChecklistStore((s) => s.byKey)
  const done = checkedIn(
    byKey,
    checklistKey(guide.slug),
    guide.checklist.map((entry) => entry.id),
  ).size
  return { done, total: guide.checklist.length }
}

export function progressLabel({ done, total }: ChecklistProgress): string {
  if (done === 0) return 'Not started'
  return done === total ? `All ${total} done` : `${done} of ${total} done`
}
