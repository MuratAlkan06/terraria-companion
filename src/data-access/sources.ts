/**
 * Data file importers (ADR D7: per-entity JSON chunks, lazy-loaded per route via dynamic
 * import — Vite code-splits and content-hashes each file). Each importer resolves the parsed
 * JSON payload. The sprite manifest lives in `public/` (A10: sprites are not bundled), so it is
 * fetched instead of imported.
 */
import rawMeta from '../data/meta.json'

export type DataFile =
  | 'weapons.list'
  | 'weapons.detail'
  | 'accessories.list'
  | 'accessories.detail'
  | 'armor.list'
  | 'armor.detail'
  | 'armor-sets'
  | 'stage-gaps'
  | 'items.detail'
  | 'buffs'
  | 'recipes'
  | 'recipe-groups'
  | 'drops'
  | 'conditions'
  | 'item-universe'
  | 'progression'
  | 'bosses'
  | 'enemies'
  | 'search-docs'
  | 'meta'
  | 'sprite-manifest'

/** Files loaded with fetch() rather than a dynamic import (see ChunkLoadError.moduleImport). */
export const FETCHED_FILES: ReadonlySet<DataFile> = new Set<DataFile>(['sprite-manifest'])

export type Importer = () => Promise<unknown>
export type Importers = Record<DataFile, Importer>
/** Throws DataValidationError on a schema mismatch. */
export type Validator = (file: DataFile, data: unknown) => void | Promise<void>

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
  return response.json()
}

export const DEFAULT_IMPORTERS: Importers = {
  'weapons.list': () => import('../data/weapons.list.json').then((m) => m.default),
  'weapons.detail': () => import('../data/weapons.detail.json').then((m) => m.default),
  'accessories.list': () => import('../data/accessories.list.json').then((m) => m.default),
  'accessories.detail': () => import('../data/accessories.detail.json').then((m) => m.default),
  'armor.list': () => import('../data/armor.list.json').then((m) => m.default),
  'armor.detail': () => import('../data/armor.detail.json').then((m) => m.default),
  'armor-sets': () => import('../data/armor-sets.json').then((m) => m.default),
  // Stage gap entries (the reasons behind declared Unknowns, e.g. a boss page's gear gap); small.
  'stage-gaps': () => import('../data/stage-gaps.json').then((m) => m.default),
  'items.detail': () => import('../data/items.detail.json').then((m) => m.default),
  buffs: () => import('../data/buffs.json').then((m) => m.default),
  recipes: () => import('../data/recipes.json').then((m) => m.default),
  'recipe-groups': () => import('../data/recipe-groups.json').then((m) => m.default),
  drops: () => import('../data/drops.json').then((m) => m.default),
  conditions: () => import('../data/conditions.json').then((m) => m.default),
  'item-universe': () => import('../data/item-universe.json').then((m) => m.default),
  progression: () => import('../data/progression.json').then((m) => m.default),
  bosses: () => import('../data/bosses.json').then((m) => m.default),
  enemies: () => import('../data/enemies.json').then((m) => m.default),
  'search-docs': () => import('../data/search-docs.json').then((m) => m.default),
  // meta.json is already in the shell bundle (footer version pin), so it is not re-split.
  meta: async () => rawMeta,
  'sprite-manifest': () => fetchJson(`${import.meta.env.BASE_URL}sprites/manifest.json`),
}

/**
 * Dev-only Zod parse. In production `import.meta.env.DEV` is statically false, so this
 * branch — and the dynamic import of Zod + the schemas — is removed from the bundle.
 */
export const DEFAULT_VALIDATOR: Validator | undefined = import.meta.env.DEV
  ? (file, data) => import('./devValidate').then((m) => m.validateDataFile(file, data))
  : undefined
