/**
 * Boss prep-checklist state (ADR D4: Zustand) over the shared `tc.v1.checklists` domain
 * (AMENDMENTS-001 A7), key `boss:<slug>:prep`, value = the checked entry ids. Hydrated synchronously
 * when the bosses chunk first loads, so check-offs are on screen in the first paint after a reload.
 *
 * The guides feature keeps its own `guide:<slug>` keys in the same domain through its own store, so
 * every write re-reads the stored payload and replaces only the key it changes (read-merge-write):
 * neither owner can drop the other's checklists.
 *
 * Entry ids derive from the checklist line's text (FNV-1a 32), so reordering the overlay keeps every
 * check; rewording a line starts that line unchecked (the safe direction).
 * P7-S2: re-reads storage when the domain changes outside the store (an import, a restore, a clear).
 */
import { create } from 'zustand'
import { loadDomain, saveDomain, type StorageBackend } from '../../../storage'
import { onDomainsChanged } from '../../../storage/events'
import { EMPTY_CHECKLISTS, withEntry, type ChecklistsData } from '../../../storage/checklists'

export const prepChecklistKey = (bossId: string): string => `boss:${bossId}:prep`

/** Stable id of a checklist line: `p-` + FNV-1a 32 (hex) of its whitespace-collapsed, lower-cased text. */
export function prepEntryId(text: string): string {
  let hash = 0x811c9dc5
  for (const ch of text.trim().replace(/\s+/g, ' ').toLowerCase()) {
    hash ^= ch.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `p-${hash.toString(16).padStart(8, '0')}`
}

type LoadStatus = 'loaded' | 'empty' | 'quarantined'

export interface PrepChecklistState {
  byKey: ChecklistsData['byKey']
  /** How the persisted payload was read at startup. */
  loadStatus: LoadStatus
  /** True when the last save failed; the change is kept in memory for this session. */
  persistError: boolean
  /** Checks or unchecks one entry of one checklist (idempotent). */
  setChecked: (key: string, entryId: string, checked: boolean) => void
}

function hydrate(backend: StorageBackend | null | undefined): Pick<PrepChecklistState, 'byKey' | 'loadStatus'> {
  const result = loadDomain('checklists', backend)
  if (result.kind === 'loaded') return { byKey: result.data.byKey, loadStatus: 'loaded' }
  return { byKey: EMPTY_CHECKLISTS.byKey, loadStatus: result.kind }
}

/** A prep-checklist store over `backend` (default: localStorage). Tests pass an in-memory backend. */
export function createPrepChecklistStore(backend?: StorageBackend | null) {
  return create<PrepChecklistState>()((set, get) => {
    onDomainsChanged(backend, ['checklists'], () => set({ ...hydrate(backend), persistError: false }))
    return {
      ...hydrate(backend),
      persistError: false,
      setChecked: (key, entryId, checked) => {
        // Latest stored payload: the guides store may have written its own keys since we hydrated.
        const latest = loadDomain('checklists', backend)
        const base: ChecklistsData = latest.kind === 'loaded' ? latest.data : { byKey: get().byKey }
        const next = withEntry(base, key, entryId, checked)
        let persistError = false
        try {
          saveDomain('checklists', next, backend)
        } catch (error) {
          persistError = true
          console.warn('[checklists] Change kept for this session only.', error)
        }
        set({ byKey: next.byKey, persistError, ...(latest.kind === 'quarantined' ? { loadStatus: 'quarantined' as const } : {}) })
      },
    }
  })
}

export const usePrepChecklistStore = createPrepChecklistStore()
