/**
 * Data file importers (ADR D7: per-entity JSON chunks, lazy-loaded per route via dynamic
 * import — Vite code-splits and content-hashes each file). Each importer resolves the parsed
 * JSON payload. The sprite manifest lives in `public/` (A10: sprites are not bundled), so it is
 * fetched instead of imported.
 *
 * Sharded files (P6 encyclopedia, AMENDMENTS-016 B104) load by file name through `ShardImporters`: an
 * item-detail shard (`items.detail.<n>.json`, a lazy chunk each via import.meta.glob) and a sprite-manifest
 * part (`public/sprites/manifest.<part>.json`, fetched). The 'sprite-manifest' file is the runtime index
 * (`manifest.index.json`: the D3 fallbackMode lever + the part list), not the whole provenance manifest.
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
  | 'items.detail.index'
  | 'items.list'
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

/** Sharded file families, loaded by file name (see the header). */
export type ShardKind = 'items.detail-shard' | 'sprite-part'
export type ShardImporter = (file: string) => Promise<unknown>
export type ShardImporters = Record<ShardKind, ShardImporter>
/** Shard kinds loaded with fetch() (retryable in place) rather than a dynamic import. */
export const FETCHED_SHARDS: ReadonlySet<ShardKind> = new Set<ShardKind>(['sprite-part'])

/** Throws DataValidationError on a schema mismatch. */
export type Validator = (file: DataFile | ShardKind, data: unknown) => void | Promise<void>

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
  // P6 encyclopedia: which file holds each item record (12 KB gz) and the browse list of every item
  'items.detail.index': () => import('../data/items.detail.index.json').then((m) => m.default),
  'items.list': () => import('../data/items.list.json').then((m) => m.default),
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
  // AMENDMENTS-016 B104: the runtime index (fallbackMode + part list); parts load on demand (sprite-part)
  'sprite-manifest': () => fetchJson(`${import.meta.env.BASE_URL}sprites/manifest.index.json`),
}

/**
 * The ID-range item shards, one lazy chunk each (the core file and the index have their own importers).
 * Keys are module paths ("../data/items.detail.3.json").
 */
const ITEM_SHARDS = import.meta.glob<unknown>(['../data/items.detail.*.json', '!../data/items.detail.index.json'], { import: 'default' })

export const DEFAULT_SHARD_IMPORTERS: ShardImporters = {
  'items.detail-shard': (file) => {
    const load = ITEM_SHARDS[`../data/${file}`]
    return load ? load() : Promise.reject(new Error(`no item shard ${file} in this build`))
  },
  'sprite-part': (file) => fetchJson(`${import.meta.env.BASE_URL}sprites/${file}`),
}

/**
 * Dev-only Zod parse. In production `import.meta.env.DEV` is statically false, so this
 * branch — and the dynamic import of Zod + the schemas — is removed from the bundle.
 */
export const DEFAULT_VALIDATOR: Validator | undefined = import.meta.env.DEV
  ? (file, data) => import('./devValidate').then((m) => m.validateDataFile(file, data))
  : undefined
