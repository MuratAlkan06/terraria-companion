/**
 * Saved builds (ADR D4: Zustand), persisted through the storage module to `tc.v1.builds` (ADR D6;
 * DATA_SCHEMA_SPEC §8a BuildsV1, AMENDMENTS-016 B106 BuildsV2; PRD P4-S2 scope "save/load named builds",
 * UX_SPEC §3.5 Step 4, §6; P4-S4 AC4: saved builds appear on the homepage).
 * Hydrated synchronously when first imported — at app start, since the homepage's saved-builds rail
 * reads it (the builder and the readiness checker's import share the same store).
 *
 * - Every action saves immediately. A failed save keeps the change for this session and sets
 *   `persistError` (DATA_SCHEMA_SPEC §4b) — the page says so.
 * - Unreadable payloads are quarantined by the storage module (set aside, never deleted): the store
 *   starts empty and reports `loadStatus: 'quarantined'` (UX_SPEC §5.6).
 * - A build stores the builder's inputs and its slots as saved; overwriting keeps its id and creation
 *   time ("Save" when editing), "Save as copy" creates a new one (UX_SPEC §6).
 * - Writes are BuildsV2 (AMENDMENTS-016 B106: + target boss, owned items, user-emptied slots); v1 data
 *   reads as-is, its builds without those fields (src/storage/builds.ts).
 * - P7-S2: re-reads storage when the domain changes outside the store (an import, a restore, a clear).
 */
import { create } from 'zustand'
import { loadDomain, saveDomain, type StorageBackend } from '../storage'
import { onDomainsChanged } from '../storage/events'
import { EMPTY_BUILDS, type BuildsData, type SavedBuild } from '../storage/builds'

type LoadStatus = 'loaded' | 'empty' | 'quarantined'

/** What the caller supplies; the store adds the id and the timestamps. */
export type BuildDraft = Omit<SavedBuild, 'buildId' | 'createdAt' | 'updatedAt'>

export interface BuildsState {
  builds: SavedBuild[]
  loadStatus: LoadStatus
  persistError: boolean
  /** Saves a new build (newest first) and returns it. */
  create: (draft: BuildDraft, now?: Date) => SavedBuild
  /** Overwrites a build in place (its id and creation time kept); undefined when it no longer exists. */
  update: (buildId: string, draft: BuildDraft, now?: Date) => SavedBuild | undefined
  /** Deletes a build (the page confirms first). */
  remove: (buildId: string) => void
}

/** A build id: time + randomness, ≥ 8 characters (SavedBuild.buildId). */
export function newBuildId(now: Date = new Date(), random: () => number = Math.random): string {
  const rand = Array.from({ length: 6 }, () => Math.floor(random() * 36).toString(36)).join('')
  return `b${now.getTime().toString(36)}${rand}`
}

function hydrate(backend: StorageBackend | null | undefined): Pick<BuildsState, 'builds' | 'loadStatus'> {
  const result = loadDomain('builds', backend)
  if (result.kind === 'loaded') return { builds: result.data.builds, loadStatus: 'loaded' }
  return { builds: EMPTY_BUILDS.builds, loadStatus: result.kind }
}

/** A builds store over `backend` (default: localStorage). Tests pass an in-memory backend and an id factory. */
export function createBuildsStore(backend?: StorageBackend | null, makeId: (now: Date) => string = newBuildId) {
  return create<BuildsState>()((set, get) => {
    onDomainsChanged(backend, ['builds'], () => set({ ...hydrate(backend), persistError: false }))
    const commit = (builds: SavedBuild[], what: string) => {
      let persistError = false
      try {
        const data: BuildsData = { builds }
        saveDomain('builds', data, backend)
      } catch (error) {
        persistError = true
        console.warn(`[builds] ${what} kept for this session only.`, error)
      }
      set({ builds, persistError })
    }
    return {
      ...hydrate(backend),
      persistError: false,
      create: (draft, now = new Date()) => {
        const at = now.toISOString()
        const existing = new Set(get().builds.map((b) => b.buildId))
        const base = makeId(now)
        let buildId = base
        for (let i = 2; existing.has(buildId); i++) buildId = `${base}-${i}`
        const build: SavedBuild = { ...draft, buildId, createdAt: at, updatedAt: at }
        commit([build, ...get().builds], 'Saved build')
        return build
      },
      update: (buildId, draft, now = new Date()) => {
        const current = get().builds.find((b) => b.buildId === buildId)
        if (!current) return undefined
        const build: SavedBuild = { ...draft, buildId, createdAt: current.createdAt, updatedAt: now.toISOString() }
        commit(
          get().builds.map((b) => (b.buildId === buildId ? build : b)),
          'Saved build',
        )
        return build
      },
      remove: (buildId) => {
        if (!get().builds.some((b) => b.buildId === buildId)) return
        commit(
          get().builds.filter((b) => b.buildId !== buildId),
          'Deleted build',
        )
      },
    }
  })
}

export const useBuildsStore = createBuildsStore()
