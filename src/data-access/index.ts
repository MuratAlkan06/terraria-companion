/**
 * Data access (DATA_SCHEMA_SPEC §4a). Every data file is a lazy chunk loaded on first use and
 * cached as a singleton for the session; failures are not cached, so Retry re-imports.
 *
 * | Contract                  | Errors                                                     |
 * |---------------------------|------------------------------------------------------------|
 * | loadMeta()                | ChunkLoadError; SchemaVersionError (dataSchemaVersion)     |
 * | loadList(type)            | ChunkLoadError; DataValidationError (dev-only Zod parse)   |
 * | loadDetail(type, id)      | ChunkLoadError; NotFoundError{ref} → styled 404            |
 * | loadProgression()         | ChunkLoadError; DataValidationError (dev)                  |
 * | loadBosses()              | ChunkLoadError; DataValidationError (dev)                  |
 * | loadEnemies()             | ChunkLoadError; DataValidationError (dev)                  |
 * | loadSearchDocs()          | ChunkLoadError → search UI shows its designed error state  |
 * | loadItems() / loadBuffs() | ChunkLoadError; DataValidationError (dev)                  |
 * | load*Index / loadItemNames| ChunkLoadError; DataValidationError (dev)                  |
 * | loadSpriteIndex()         | ChunkLoadError (manifest fetch)                            |
 *
 * Field reads go through `getField` (src/schemas/getField.ts) — never direct property access
 * in UI for verified-or-Unknown fields. `createDataAccess` takes injectable importers so the
 * error paths are unit-testable; the module-level functions use the real data files.
 */
import type { DATA_SCHEMA_VERSION, Enemy, SearchDoc } from '../schemas'
import { ChunkLoadError, NotFoundError, SchemaVersionError } from './errors'
import { memo, type Memo } from './memo'
import { DEFAULT_IMPORTERS, DEFAULT_VALIDATOR, FETCHED_FILES, type DataFile, type Importers, type Validator } from './sources'
import type {
  Boss,
  Buff,
  Condition,
  ConditionIndex,
  DetailRecordMap,
  DropIndex,
  DropSource,
  EntityType,
  Item,
  ItemNames,
  ItemUniverseFile,
  ListRecordMap,
  Meta,
  ProgressionData,
  ProgressionEdge,
  ProgressionNode,
  Recipe,
  RecipeGroup,
  RecipeIndex,
  SpriteIndex,
  SpriteManifest,
} from './types'

export * from './errors'
export type * from './types'
export type { DataFile, Importer, Importers, Validator } from './sources'

/** Type-linked to the shared constant: bumping DATA_SCHEMA_VERSION fails typecheck here. */
const EXPECTED_SCHEMA_VERSION: typeof DATA_SCHEMA_VERSION = 1

/** Lowercase kebab slug — mirrors pipeline/parse/text.ts `slugify` (ammo class slugs). */
export function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Route param → positive integer item id, or undefined for anything else ("abc", "0", "1.5"). */
export function parseItemId(raw: string | number | undefined): number | undefined {
  const text = String(raw ?? '')
  return /^[1-9]\d{0,9}$/.test(text) ? Number(text) : undefined
}

export interface AcquisitionNeeds {
  recipes: boolean
  drops: boolean
  /** Verified gatedBy names progression nodes (bosses) to resolve. */
  gates: boolean
}

export interface AcquisitionData {
  recipes?: RecipeIndex
  names?: ItemNames
  drops?: DropIndex
  progression?: ProgressionData
  conditions: ConditionIndex
}

export interface DataAccessOptions {
  /** Override individual importers (tests). */
  importers?: Partial<Importers>
  /** Dev-only validator; `null` disables it. Defaults to Zod parse in dev, none in production. */
  validate?: Validator | null
}

function byKey<T, K>(records: readonly T[], key: (record: T) => K): Map<K, T> {
  return new Map(records.map((record) => [key(record), record]))
}

export function createDataAccess(options: DataAccessOptions = {}) {
  const importers: Importers = { ...DEFAULT_IMPORTERS, ...options.importers }
  const validate = options.validate === undefined ? DEFAULT_VALIDATOR : (options.validate ?? undefined)

  async function loadFile<T>(file: DataFile): Promise<T> {
    let data: unknown
    try {
      data = await importers[file]()
    } catch (cause) {
      throw new ChunkLoadError(file, cause, !FETCHED_FILES.has(file))
    }
    if (validate) await validate(file, data)
    return data as T
  }

  const lists: { [T in EntityType]: Memo<ListRecordMap[T][]> } = {
    weapons: memo(() => loadFile<ListRecordMap['weapons'][]>('weapons.list')),
  }
  const details: { [T in EntityType]: Memo<ReadonlyMap<number, DetailRecordMap[T]>> } = {
    weapons: memo(async () => byKey(await loadFile<DetailRecordMap['weapons'][]>('weapons.detail'), (w) => w.id)),
  }

  const meta = memo(async () => {
    const data = await loadFile<Meta>('meta')
    if (data.dataSchemaVersion !== EXPECTED_SCHEMA_VERSION) {
      throw new SchemaVersionError(EXPECTED_SCHEMA_VERSION, data.dataSchemaVersion)
    }
    return data
  })

  const recipeIndex = memo(async (): Promise<RecipeIndex> => {
    const [recipes, groups] = await Promise.all([loadFile<Recipe[]>('recipes'), loadFile<RecipeGroup[]>('recipe-groups')])
    return { byId: byKey(recipes, (r) => r.id), groups: byKey(groups, (g) => g.id) }
  })
  const dropIndex = memo(async (): Promise<DropIndex> => ({
    byId: byKey(await loadFile<DropSource[]>('drops'), (d) => d.id),
  }))
  const conditionIndex = memo(async (): Promise<ConditionIndex> => ({
    byId: byKey(await loadFile<Condition[]>('conditions'), (c) => c.id),
  }))
  const itemNames = memo(async (): Promise<ItemNames> => {
    const universe = await loadFile<ItemUniverseFile>('item-universe')
    const byId = new Map<number, string>()
    const bySlug = new Map<string, string>()
    for (const item of universe.items) {
      if (item.name === undefined) continue
      byId.set(item.id, item.name)
      const slug = slugify(item.name)
      if (slug && !bySlug.has(slug)) bySlug.set(slug, item.name)
    }
    return { byId, bySlug }
  })
  const progression = memo(async (): Promise<ProgressionData> => {
    const data = await loadFile<{ nodes: ProgressionNode[]; edges: ProgressionEdge[] }>('progression')
    return { nodes: data.nodes, edges: data.edges, nodeById: byKey(data.nodes, (n) => n.id) }
  })
  const bosses = memo(() => loadFile<Boss[]>('bosses'))
  const enemies = memo(() => loadFile<Enemy[]>('enemies'))
  const searchDocs = memo(() => loadFile<SearchDoc[]>('search-docs'))
  const items = memo(() => loadFile<Item[]>('items.detail'))
  const buffs = memo(() => loadFile<Buff[]>('buffs'))
  const spriteIndex = memo(async (): Promise<SpriteIndex> => {
    const manifest = await loadFile<SpriteManifest>('sprite-manifest')
    return { fallbackMode: manifest.fallbackMode, byPath: byKey(manifest.files, (f) => f.path) }
  })

  function detailRef(id: unknown): string {
    return `i:${String(id)}`
  }

  return {
    loadMeta: (): Promise<Meta> => meta.get(),

    loadList: <T extends EntityType>(type: T): Promise<ListRecordMap[T][]> => lists[type].get(),
    peekList: <T extends EntityType>(type: T): ListRecordMap[T][] | undefined => lists[type].peek(),

    /** Resolves the record or rejects with NotFoundError (unknown or malformed id). */
    async loadDetail<T extends EntityType>(type: T, id: string | number): Promise<DetailRecordMap[T]> {
      const itemId = parseItemId(id)
      if (itemId === undefined) throw new NotFoundError(detailRef(id))
      const record = (await details[type].get()).get(itemId)
      if (!record) throw new NotFoundError(detailRef(itemId))
      return record
    },
    /** The record when the detail chunk is already loaded; undefined otherwise (or not found). */
    peekDetail<T extends EntityType>(type: T, id: string | number): DetailRecordMap[T] | undefined {
      const itemId = parseItemId(id)
      return itemId === undefined ? undefined : details[type].peek()?.get(itemId)
    },
    /** All detail records by id (e.g. to link recipe ingredients that are themselves weapons). */
    loadDetailIndex: <T extends EntityType>(type: T): Promise<ReadonlyMap<number, DetailRecordMap[T]>> =>
      details[type].get(),
    peekDetailIndex: <T extends EntityType>(type: T): ReadonlyMap<number, DetailRecordMap[T]> | undefined =>
      details[type].peek(),

    /** Progression graph (nodes + typed edges) with a node lookup (§4a "Load graph"). */
    loadProgression: () => progression.get(),
    /** Boss records (P2-S6, emitted as an array per B11). Empty when the dataset has none. */
    loadBosses: (): Promise<Boss[]> => bosses.get(),
    peekBosses: (): Boss[] | undefined => bosses.peek(),
    /** Enemy records (A5, produced in P2-S2a). */
    loadEnemies: (): Promise<Enemy[]> => enemies.get(),
    /** Compact SearchDocs (§2.10) — the MiniSearch input; loaded on the first search interaction. */
    loadSearchDocs: (): Promise<SearchDoc[]> => searchDocs.get(),
    /** Encyclopedia item records (§2.6) — ammo with its `ammoStats` for the Lab's ammo picker. */
    loadItems: (): Promise<Item[]> => items.get(),
    peekItems: (): Item[] | undefined => items.peek(),
    /** Buff/debuff registry (§2.9) — the Lab resolves a weapon's damage-over-time debuff here. */
    loadBuffs: (): Promise<Buff[]> => buffs.get(),
    peekBuffs: (): Buff[] | undefined => buffs.peek(),
    loadRecipeIndex: () => recipeIndex.get(),
    loadDropIndex: () => dropIndex.get(),
    loadConditionIndex: () => conditionIndex.get(),
    loadItemNames: () => itemNames.get(),
    peekItemNames: () => itemNames.peek(),
    loadSpriteIndex: () => spriteIndex.get(),
    peekSpriteIndex: () => spriteIndex.peek(),

    /** Loads only the indexes an acquisition section needs (recipes + names for craft, drops for drop). */
    async loadAcquisitionData(needs: AcquisitionNeeds): Promise<AcquisitionData> {
      const [recipes, names, drops, graph, conditions] = await Promise.all([
        needs.recipes ? recipeIndex.get() : undefined,
        needs.recipes ? itemNames.get() : undefined,
        needs.drops ? dropIndex.get() : undefined,
        needs.gates ? progression.get() : undefined,
        conditionIndex.get(),
      ])
      return { recipes, names, drops, progression: graph, conditions }
    },
    peekAcquisitionData(needs: AcquisitionNeeds): AcquisitionData | undefined {
      const conditions = conditionIndex.peek()
      const recipes = needs.recipes ? recipeIndex.peek() : undefined
      const names = needs.recipes ? itemNames.peek() : undefined
      const drops = needs.drops ? dropIndex.peek() : undefined
      const graph = needs.gates ? progression.peek() : undefined
      if (!conditions || (needs.recipes && (!recipes || !names)) || (needs.drops && !drops) || (needs.gates && !graph)) {
        return undefined
      }
      return { recipes, names, drops, progression: graph, conditions }
    },
  }
}

export type DataAccess = ReturnType<typeof createDataAccess>

const dataAccess: DataAccess = createDataAccess()

export const {
  loadMeta,
  loadList,
  peekList,
  loadDetail,
  peekDetail,
  loadDetailIndex,
  peekDetailIndex,
  loadProgression,
  loadBosses,
  peekBosses,
  loadEnemies,
  loadSearchDocs,
  loadItems,
  peekItems,
  loadBuffs,
  peekBuffs,
  loadRecipeIndex,
  loadDropIndex,
  loadConditionIndex,
  loadItemNames,
  peekItemNames,
  loadSpriteIndex,
  peekSpriteIndex,
  loadAcquisitionData,
  peekAcquisitionData,
} = dataAccess
