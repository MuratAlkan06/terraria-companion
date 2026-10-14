/**
 * Progression state (ADR D4: Zustand), persisted through the storage module to `tc.v1.progress`
 * (ADR D6). Hydrated synchronously when first imported, like the settings store, so the map's
 * world-evil choice and tracked defeats are in place on its first paint after a reload.
 *
 * - P5-S1: `worldEvil` (the boss map's world-evil toggle).
 * - P5-S4: per-node tracking (DATA_SCHEMA_SPEC §8a/§8c): not attempted (absent) → defeated | skipped,
 *   any → any; a confirmed global reset clears `nodeStates` only (the world evil stays), with a
 *   one-shot restore for the undo toast.
 *
 * Every write saves immediately (no save button). If the browser can't save, the change is kept for
 * this session and `persistError` says so (DATA_SCHEMA_SPEC §4b). Other features read tracking from
 * this one store (PRD P5-S4 AC4), through src/scoring/progress.ts for gate satisfaction.
 */
import { create } from 'zustand'
import { loadDomain, saveDomain, type StorageBackend } from '../storage'
import { EMPTY_PROGRESS, isNodeSlug, type NodeState, type ProgressData, type WorldEvil } from '../storage/progress'

type LoadStatus = 'loaded' | 'empty' | 'quarantined'

export interface ProgressState {
  progress: ProgressData
  /** How the persisted payload was read at startup (QuarantineNotice consumes this later). */
  loadStatus: LoadStatus
  /** True when the last save failed; the value is kept in memory for this session. */
  persistError: boolean
  /**
   * Node states as the boss map last showed them — in memory only, never persisted. Starts as loaded;
   * the map plays the unlock cascade (UX_SPEC §12) for whatever changed since — a defeat marked on a
   * boss page included — then catches this up (`markNodeStatesShown`).
   */
  shownNodeStates: Readonly<Record<string, NodeState>>
  setWorldEvil: (worldEvil: WorldEvil | null) => void
  /** Marks a node defeated or skipped, or (null) not attempted. Returns false if it couldn't be saved. */
  setNodeState: (nodeId: string, state: NodeState | null) => boolean
  /** Clears every node's state — nothing else — and returns what was cleared (for a one-shot undo). */
  resetNodeStates: () => Record<string, NodeState>
  /** Puts cleared states back; a state set since the reset wins. Returns false if it couldn't be saved. */
  restoreNodeStates: (states: Readonly<Record<string, NodeState>>) => boolean
  /** The map has shown the current node states. */
  markNodeStatesShown: () => void
}

function hydrate(backend: StorageBackend | null | undefined): Pick<ProgressState, 'progress' | 'loadStatus'> {
  const result = loadDomain('progress', backend)
  if (result.kind === 'loaded') return { progress: result.data, loadStatus: 'loaded' }
  return { progress: EMPTY_PROGRESS, loadStatus: result.kind }
}

/** A progress store over `backend` (default: localStorage). Tests pass an in-memory backend. */
export function createProgressStore(backend?: StorageBackend | null) {
  return create<ProgressState>()((set, get) => {
    /** Saves and applies `progress`; on a failed save keeps it in memory and flags it. */
    const commit = (progress: ProgressData, what: string): boolean => {
      let persistError = false
      try {
        saveDomain('progress', progress, backend)
      } catch (error) {
        persistError = true
        console.warn(`[progress] ${what} kept for this session only.`, error)
      }
      set({ progress, persistError })
      return !persistError
    }
    const initial = hydrate(backend)
    return {
      ...initial,
      persistError: false,
      shownNodeStates: initial.progress.nodeStates,
      setWorldEvil: (worldEvil) => {
        commit({ ...get().progress, worldEvil }, 'World evil')
      },
      setNodeState: (nodeId, state) => {
        // Never hold a key the payload can't store (every later save would fail on it).
        if (!isNodeSlug(nodeId)) return false
        const { [nodeId]: current, ...others } = get().progress.nodeStates
        if ((current ?? null) === state) return !get().persistError
        const nodeStates = state === null ? others : { ...others, [nodeId]: state }
        return commit({ ...get().progress, nodeStates }, 'Boss progress')
      },
      resetNodeStates: () => {
        const cleared = get().progress.nodeStates
        commit({ ...get().progress, nodeStates: {} }, 'Progress reset')
        return { ...cleared }
      },
      restoreNodeStates: (states) => commit({ ...get().progress, nodeStates: { ...states, ...get().progress.nodeStates } }, 'Restored progress'),
      markNodeStatesShown: () => {
        if (get().shownNodeStates !== get().progress.nodeStates) set({ shownNodeStates: get().progress.nodeStates })
      },
    }
  })
}

export const useProgressStore = createProgressStore()
