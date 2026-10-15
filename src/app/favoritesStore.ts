/**
 * Favorites state (ADR D4: Zustand), persisted through the storage module to `tc.v1.favorites`
 * (ADR D6; DATA_SCHEMA_SPEC §8a `FavoritesV1`). One store for the whole app: every FavoriteStar
 * (weapon list rows, weapon and boss page headers) and the /favorites page read this state, so
 * starring or unstarring anywhere updates every surface at once, without a reload (PRD P7-S1).
 * Hydrated synchronously when first imported, so stars are right on their first paint.
 *
 * Writes are read-merge-write (like the checklists store): the latest stored list plus this one
 * change, so a list another tab saved meanwhile isn't overwritten. After a failed save the
 * in-memory list is the base instead — it holds changes storage never received.
 *
 * Unreadable payloads are quarantined by the storage module (set aside, never deleted); the store
 * then starts empty and reports `loadStatus: 'quarantined'` for the page's notice (UX_SPEC §5.6).
 * A failed save (full or blocked storage) keeps the change in memory and sets `persistError`
 * (DATA_SCHEMA_SPEC §4b: visible warning, state kept in memory). The first failure after a working
 * save (or at the start) bumps `persistWarnings`: the shell's FavoritesSaveNotice shows ONE notice
 * per failure run, while every star keeps its own warning glyph + tooltip.
 * P7-S2: re-reads storage when the domain changes outside the store (an import, a restore, a clear).
 */
import { create } from 'zustand'
import { loadDomain, saveDomain, type StorageBackend } from '../storage'
import { onDomainsChanged } from '../storage/events'
import { EMPTY_FAVORITES, uniqueRefs, withFavorite, type FavoritesData } from '../storage/favorites'

type LoadStatus = 'loaded' | 'empty' | 'quarantined'

export interface FavoritesState {
  /** Starred TypedRefs, most recently starred first, no repeats. */
  refs: readonly string[]
  /** How the persisted payload was read at startup (or at the last write, if it turned unreadable). */
  loadStatus: LoadStatus
  /** True when the last save failed; the favorites are kept in memory for this session. */
  persistError: boolean
  /** Runs of failed saves so far (a run starts when a save fails after a working one, or first). */
  persistWarnings: number
  /** Stars (true) or unstars (false) `ref` — idempotent. Returns whether the change was saved. */
  setFavorite: (ref: string, favorited: boolean) => boolean
}

function hydrate(backend: StorageBackend | null | undefined): Pick<FavoritesState, 'refs' | 'loadStatus'> {
  const result = loadDomain('favorites', backend)
  if (result.kind === 'loaded') return { refs: uniqueRefs(result.data.refs), loadStatus: 'loaded' }
  return { refs: EMPTY_FAVORITES.refs, loadStatus: result.kind }
}

/** A favorites store over `backend` (default: localStorage). Tests pass an in-memory backend. */
export function createFavoritesStore(backend?: StorageBackend | null) {
  return create<FavoritesState>()((set, get) => {
    onDomainsChanged(backend, ['favorites'], () => set({ ...hydrate(backend), persistError: false }))
    return {
      ...hydrate(backend),
      persistError: false,
      persistWarnings: 0,
      setFavorite: (ref, favorited) => {
        const { refs, persistError: unsaved, persistWarnings } = get()
        // Latest stored list (another tab may have saved since we hydrated) — unless our last save
        // failed, in which case storage is behind and memory is the truth.
        const latest = unsaved ? undefined : loadDomain('favorites', backend)
        const base: FavoritesData = latest?.kind === 'loaded' ? latest.data : { refs: [...refs] }
        const next = withFavorite(base, ref, favorited)
        let saved = true
        try {
          saveDomain('favorites', next, backend)
        } catch (error) {
          saved = false
          console.warn('[favorites] Change kept for this session only.', error)
        }
        // A payload that turned unreadable since startup was just set aside: say so, like at load.
        set({
          refs: next.refs,
          persistError: !saved,
          ...(!saved && !unsaved ? { persistWarnings: persistWarnings + 1 } : {}),
          ...(latest?.kind === 'quarantined' ? { loadStatus: 'quarantined' as const } : {}),
        })
        return saved
      },
    }
  })
}

export const useFavoritesStore = createFavoritesStore()

/** Whether `ref` is starred; re-renders only when that answer changes. */
export function useIsFavorite(ref: string): boolean {
  return useFavoritesStore((s) => s.refs.includes(ref))
}
