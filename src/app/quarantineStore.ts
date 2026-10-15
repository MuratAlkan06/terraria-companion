/**
 * Set-aside copies, app-wide (ADR D4: Zustand; ADR D6 quarantine; UX_SPEC §5.6; P7-S2): the copies in
 * storage (`tc.quarantine.*`, plus any the storage module couldn't copy aside), and the last action's
 * outcome. One store for every QuarantineNotice — the page notices, the shell's, the data page's — so an
 * action anywhere updates every notice at once.
 *
 * The list is read from storage at start and again whenever the storage module reports a change to the
 * copies (a load set one aside, an import set an unreadable part aside, a restore or discard removed one).
 * Where storage can't list its keys (`listable: false` — server rendering, tests), notices fall back to
 * their own store's load status.
 */
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { DomainKey, StorageBackend } from '../storage'
import { resolveBackend } from '../storage/backend'
import { subscribeStorage } from '../storage/events'
import type { MergeMode } from '../storage/merge'
import { discardQuarantine, listQuarantine, restoreQuarantine, type QuarantineRecord, type RestoreResult } from '../storage/quarantine'

export interface QuarantineOutcome {
  /** Increases per outcome (lets a notice react to a new one). */
  id: number
  domains: readonly DomainKey[]
  tone: 'done' | 'warn'
  message: string
  /** The notice whose action produced it (it takes focus there). */
  source: string
}

export interface QuarantineState {
  records: QuarantineRecord[]
  listable: boolean
  outcome: QuarantineOutcome | null
  refresh: () => void
  /** Deletes a copy for good (the notice confirms first). Returns whether it was removed. */
  discard: (key: string) => boolean
  restore: (key: string, mode: MergeMode | null) => RestoreResult
  setOutcome: (outcome: Omit<QuarantineOutcome, 'id'>) => void
  clearOutcome: () => void
}

/** A quarantine store over `backend` (default: localStorage). Tests pass an in-memory backend. */
export function createQuarantineStore(backend?: StorageBackend | null) {
  return create<QuarantineState>()((set, get) => {
    const read = () => {
      const records = listQuarantine(backend)
      return { records: records ?? [], listable: records !== null }
    }
    subscribeStorage((event, at) => {
      if (event.type === 'quarantine' && at === resolveBackend(backend)) set(read())
    })
    let nextId = 1
    return {
      ...read(),
      outcome: null,
      refresh: () => set(read()),
      discard: (key) => {
        const removed = discardQuarantine(key, backend)
        set(read())
        return removed
      },
      restore: (key, mode) => {
        const result = restoreQuarantine(key, mode, backend)
        set(read())
        return result
      },
      setOutcome: (outcome) => set({ outcome: { ...outcome, id: nextId++ } }),
      clearOutcome: () => {
        if (get().outcome) set({ outcome: null })
      },
    }
  })
}

export const useQuarantineStore = createQuarantineStore()

/** The copies of `domains`, oldest first (re-renders only when that list changes). */
export function useQuarantineRecords(domains: readonly DomainKey[]): QuarantineRecord[] {
  return useQuarantineStore(useShallow((s) => s.records.filter((r) => domains.includes(r.domain))))
}

/**
 * Whether a notice for `domains` shows: copies exist, an outcome for them is on screen, or — where
 * storage can't be listed — the owning store says its load was quarantined (`active`).
 */
export function useQuarantineVisible(domains: readonly DomainKey[], active = false): boolean {
  return useQuarantineStore((s) => s.records.some((r) => domains.includes(r.domain)) || (s.outcome !== null && s.outcome.domains.some((d) => domains.includes(d))) || (active && !s.listable))
}
