/**
 * `tc.v1.favorites` domain (DATA_SCHEMA_SPEC §8a `FavoritesV1`): the entities the user starred, as
 * TypedRefs (`i:<itemId>`, `boss:<slug>`, …), most recently starred first, one entry per ref.
 *
 * Hand-written strict validator (same pattern as ./recent.ts) so the storage module never pulls
 * Zod into a bundle; src/app/favorites.test.ts asserts parity with the Zod `FavoritesV1`.
 * Refs that no longer resolve against the shipped dataset are kept as stored (the favorites page
 * skips them silently), so a dataset refresh never deletes a favorite.
 */
import type { DomainDef } from './types'

export interface FavoritesData {
  refs: string[]
}

export const EMPTY_FAVORITES: FavoritesData = { refs: [] }

/** Mirrors `TypedRef` in src/schemas/common.ts. */
const TYPED_REF = /^(i:\d+|(set|boss|node|buff|grp|scn|cond|enemy):[a-z0-9-]+|(rcp|drop):[a-z0-9-]+)$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseFavorites(input: unknown): FavoritesData {
  if (!isRecord(input)) throw new TypeError('favorites: expected an object')
  const unexpected = Object.keys(input).filter((k) => k !== 'refs')
  if (unexpected.length > 0) throw new TypeError(`favorites: unexpected keys ${unexpected.join(', ')}`)
  const { refs } = input
  if (!Array.isArray(refs)) throw new TypeError('favorites.refs: expected an array')
  return {
    refs: refs.map((ref, index) => {
      if (typeof ref !== 'string' || !TYPED_REF.test(ref)) throw new TypeError(`favorites.refs[${index}]: expected a TypedRef`)
      return ref
    }),
  }
}

/** Refs in order, first occurrence kept (the schema allows repeats; the app never shows one twice). */
export function uniqueRefs(refs: readonly string[]): string[] {
  return [...new Set(refs)]
}

/**
 * `data` with `ref` starred (moved to the front, deduped) or unstarred (every occurrence removed).
 * Starring an already-starred ref keeps its place: re-saving it doesn't reorder the page.
 */
export function withFavorite(data: FavoritesData, ref: string, favorited: boolean): FavoritesData {
  const refs = uniqueRefs(data.refs)
  if (!favorited) return { refs: refs.filter((r) => r !== ref) }
  return { refs: refs.includes(ref) ? refs : [ref, ...refs] }
}

export const favoritesDomain: DomainDef<FavoritesData> = {
  version: 1,
  // Index i migrates v(i+1) -> v(i+2) (DATA_SCHEMA_SPEC §8b). v1 is current: none yet.
  migrations: [],
  parse: parseFavorites,
}
