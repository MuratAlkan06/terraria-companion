/**
 * Readiness checker state (ADR D4: Zustand), persisted through the storage module to
 * `tc.v1.readiness` (ADR D6; DATA_SCHEMA_SPEC §8a ReadinessV1; PRD §9 Feature A AC4). Hydrated
 * synchronously when first imported (only the readiness chunk imports it).
 *
 * - The SETUP (boss, stage, difficulty, class, loadout) saves on every edit — no save button.
 * - "Analyze My Build" records a SNAPSHOT (in memory): the setup and tracked progress the shown
 *   analysis was made from, and stamps `analyzedAt`. The analysis is recomputed from inputs, never
 *   stored (SCORING_SPEC §7 lifecycle: fresh → out-of-date → re-analyzed atomically).
 * - Editing after an analysis keeps the snapshot (the page shows it dimmed, "Out of date", with the
 *   Re-analyze bar — UX_SPEC §6: never silently replaced) and persists `analyzedAt: null`, because the
 *   stored inputs no longer match what was analyzed. Editing back to the analyzed inputs restores it.
 *   The stage is context only (AMENDMENTS-015 B97b): changing it saves, but leaves the analysis current.
 *   After a reload, an analysis is restored only for inputs that were analyzed as stored.
 * - Clearing is an explicit action (AC4): `clear()` (the page asks first).
 * - Unreadable payloads are quarantined by the storage module (set aside, never deleted): the store
 *   starts from the default setup and reports `loadStatus: 'quarantined'` (UX_SPEC §5.6). A failed
 *   save keeps the change for this session and sets `persistError` (DATA_SCHEMA_SPEC §4b).
 */
import { create } from 'zustand'
import { MAX_ACCESSORY_SLOTS } from '../scoring/constants'
import type { TrackedProgress } from '../scoring/progress'
import { loadDomain, saveDomain, type StorageBackend } from '../storage'
import { defaultReadinessSetup, type ReadinessClass, type ReadinessDifficulty, type ReadinessLoadout, type ReadinessSetup } from '../storage/readiness'
import { useSettingsStore } from './settingsStore'
import type { Stage } from './stages'

type LoadStatus = 'loaded' | 'empty' | 'quarantined'

/** The loadout's single slots (the accessory row and the lists have their own actions). */
export type SingleSlot = 'mainWeapon' | 'altWeapon' | 'helmet' | 'chest' | 'legs' | 'summon'
export type ListSlot = 'ammo' | 'buffs'

/** What the shown analysis was made from (memory only). `progress` is unknown after a reload. */
export interface ReadinessSnapshot {
  setup: ReadinessSetup
  progress?: TrackedProgress
  at: string
}

export interface ReadinessState {
  setup: ReadinessSetup
  loadStatus: LoadStatus
  persistError: boolean
  snapshot: ReadinessSnapshot | null
  setBoss: (bossId: string | null) => void
  setStage: (stage: Stage) => void
  setDifficulty: (difficulty: ReadinessDifficulty) => void
  setClass: (cls: ReadinessClass) => void
  setSlot: (slot: SingleSlot, id: number | null) => void
  setAccessory: (index: number, id: number | null) => void
  addToList: (list: ListSlot, id: number) => void
  removeFromList: (list: ListSlot, index: number) => void
  /** Deep-link prefill (`/readiness?boss=&class=&difficulty=`): one save. */
  prefill: (values: { bossId?: string; cls?: ReadinessClass; difficulty?: ReadinessDifficulty }) => void
  /** Records the snapshot for the current setup + tracked progress and stamps analyzedAt. */
  analyze: (progress: TrackedProgress, now?: Date) => void
  /**
   * A restored snapshot (after a reload) doesn't know the progress it was made with: pin the progress
   * it is first shown with, so a later change on the map marks it out of date instead of silently
   * changing it. No-op when the snapshot already has one.
   */
  pinProgress: (progress: TrackedProgress) => void
  /** Explicit clear (AC4): the default setup, no analysis. */
  clear: () => void
}

/**
 * The analysis inputs of a setup, for comparisons: boss, difficulty, class and loadout. Not the stage —
 * it is context only (AMENDMENTS-015 B94(6)/B89; the analysis never reads it), so changing it never
 * marks an analysis out of date (B97b) — nor analyzedAt.
 */
const inputsKey = (setup: ReadinessSetup) => JSON.stringify([setup.bossId, setup.difficulty, setup.class, setup.loadout])
export const sameInputs = (a: ReadinessSetup, b: ReadinessSetup): boolean => inputsKey(a) === inputsKey(b)
export const sameProgress = (a: TrackedProgress, b: TrackedProgress): boolean =>
  a.worldEvil === b.worldEvil && JSON.stringify(Object.entries(a.nodeStates).sort()) === JSON.stringify(Object.entries(b.nodeStates).sort())

/** A stored loadout with fewer than 7 accessory slots (valid schema) padded to 7 (lossless difficulty switches). */
function normalize(setup: ReadinessSetup): ReadinessSetup {
  const acc = setup.loadout.accessories
  if (acc.length === MAX_ACCESSORY_SLOTS) return setup
  const accessories = [...acc, ...Array(MAX_ACCESSORY_SLOTS).fill(null)].slice(0, MAX_ACCESSORY_SLOTS)
  return { ...setup, loadout: { ...setup.loadout, accessories } }
}

function hydrate(backend: StorageBackend | null | undefined, defaultStage: Stage): Pick<ReadinessState, 'setup' | 'loadStatus' | 'snapshot'> {
  const result = loadDomain('readiness', backend)
  if (result.kind !== 'loaded') return { setup: defaultReadinessSetup(defaultStage), loadStatus: result.kind, snapshot: null }
  const setup = normalize(result.data)
  return { setup, loadStatus: 'loaded', snapshot: setup.analyzedAt ? { setup, at: setup.analyzedAt } : null }
}

/** A readiness store over `backend` (default: localStorage). Tests pass an in-memory backend. */
export function createReadinessStore(backend?: StorageBackend | null, defaultStage: Stage = 'early-prehm') {
  return create<ReadinessState>()((set, get) => {
    const commit = (setup: ReadinessSetup, snapshot: ReadinessSnapshot | null, what: string) => {
      let persistError = false
      try {
        saveDomain('readiness', setup, backend)
      } catch (error) {
        persistError = true
        console.warn(`[readiness] ${what} kept for this session only.`, error)
      }
      set({ setup, snapshot, persistError })
    }
    /** Applies a setup edit: analyzedAt follows whether the analysis inputs still match the snapshot (a stage change keeps it). */
    const edit = (change: (setup: ReadinessSetup) => ReadinessSetup, what: string) => {
      const { setup, snapshot } = get()
      const next = change(setup)
      if (sameInputs(next, setup) && next.stage === setup.stage) return
      const matches = snapshot !== null && sameInputs(next, snapshot.setup)
      commit({ ...next, analyzedAt: matches ? snapshot.at : null }, snapshot, what)
    }
    const withLoadout = (change: (loadout: ReadinessLoadout) => ReadinessLoadout) => (setup: ReadinessSetup) => ({ ...setup, loadout: change(setup.loadout) })
    return {
      ...hydrate(backend, defaultStage),
      persistError: false,
      setBoss: (bossId) => edit((s) => ({ ...s, bossId }), 'Boss choice'),
      setStage: (stage) => edit((s) => ({ ...s, stage }), 'Stage'),
      setDifficulty: (difficulty) => edit((s) => ({ ...s, difficulty }), 'Difficulty'),
      setClass: (cls) => edit((s) => ({ ...s, class: cls }), 'Class'),
      setSlot: (slot, id) => edit(withLoadout((l) => ({ ...l, [slot]: id })), 'Loadout'),
      setAccessory: (index, id) => {
        if (!Number.isInteger(index) || index < 0 || index >= MAX_ACCESSORY_SLOTS) return
        edit(withLoadout((l) => ({ ...l, accessories: l.accessories.map((x, i) => (i === index ? id : x)) })), 'Loadout')
      },
      addToList: (list, id) => edit(withLoadout((l) => (l[list].includes(id) ? l : { ...l, [list]: [...l[list], id] })), 'Loadout'),
      removeFromList: (list, index) => edit(withLoadout((l) => ({ ...l, [list]: l[list].filter((_, i) => i !== index) })), 'Loadout'),
      prefill: ({ bossId, cls, difficulty }) =>
        edit((s) => ({ ...s, ...(bossId !== undefined ? { bossId } : {}), ...(cls ? { class: cls } : {}), ...(difficulty ? { difficulty } : {}) }), 'Boss choice'),
      analyze: (progress, now = new Date()) => {
        const at = now.toISOString()
        const setup = { ...get().setup, analyzedAt: at }
        commit(setup, { setup, progress, at }, 'Analysis')
      },
      pinProgress: (progress) => {
        const { snapshot } = get()
        if (snapshot && !snapshot.progress) set({ snapshot: { ...snapshot, progress } })
      },
      clear: () => commit(defaultReadinessSetup(get().setup.stage), null, 'Clear'),
    }
  })
}

export const useReadinessStore = createReadinessStore(undefined, useSettingsStore.getState().settings.selectedStage ?? 'early-prehm')
