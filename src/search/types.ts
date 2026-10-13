/**
 * Global-search result types shared by the lazy index (./buildIndex.ts) and the shell's
 * OmniSearch. Type-only: importing this file adds nothing to any bundle.
 */
import type { SpriteIndex } from '../data-access/types'
import type { DamageClass, Rarity, SearchDocType, Stage } from '../schemas'
import type { SearchTarget } from './links'

export type { SearchTarget }

export interface SearchResultItem {
  /** TypedRef, e.g. "i:4956", "boss:plantera" — unique across the index. */
  ref: string
  name: string
  type: SearchDocType
  damageClass?: DamageClass
  stage?: Stage
  rarity?: Rarity
  /** Secondary line from the doc's own fields, e.g. "Melee · Red (10)" (may be empty). */
  detail: string
  /** Sprite path from the manifest (by ref); absent ⇒ placeholder art. */
  sprite?: string
  target: SearchTarget
}

export interface SearchResultGroup {
  type: SearchDocType
  /** Group heading, e.g. "Weapons". */
  label: string
  /** The top matches shown (at most `perGroup`). */
  items: SearchResultItem[]
  /** All matches of this type. */
  total: number
}

export interface SearchSuggestions {
  query: string
  /** Most relevant group first (best score), rows by score within a group. */
  groups: SearchResultGroup[]
  /** `groups` flattened in display order — the keyboard-navigable options. */
  options: SearchResultItem[]
}

export interface SuggestOptions {
  /** Facet filter by entity type (all types when omitted). */
  types?: ReadonlySet<SearchDocType>
  /** Rows shown per group (default 5). */
  perGroup?: number
}

/** ADR D7 init budget evidence (≤500 ms on a mid-range phone). Also emitted as user timings. */
export interface SearchIndexTiming {
  /** Downloading/evaluating the lazy chunks (engine + data files). */
  loadMs: number
  /** Building the MiniSearch index + resolving row targets/sprites. */
  buildMs: number
  totalMs: number
}

export interface SearchIndex {
  docCount: number
  /** null = manifest unavailable → placeholder art (safe direction for the D3 lever). */
  sprites: SpriteIndex | null
  timing: SearchIndexTiming
  suggest(query: string, options?: SuggestOptions): SearchSuggestions
}
