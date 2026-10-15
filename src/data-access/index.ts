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
 * | load{Accessory,Armor}List / …Details / loadArmorSets / loadStageGaps | same            |
 * | load*Index / loadItemNames| ChunkLoadError; DataValidationError (dev)                  |
 * | loadSpriteIndex(dirs?)    | ChunkLoadError (index / part fetch); parts load lazily     |
 * | loadItemList()            | ChunkLoadError; DataValidationError (dev)                  |
 * | loadItemDetail(id)        | ChunkLoadError (index / shard); NotFoundError{ref}         |
 *
 * Field reads go through `getField` (src/schemas/getField.ts) — never direct property access
 * in UI for verified-or-Unknown fields. `createDataAccess` takes injectable importers so the
 * error paths are unit-testable; the module-level functions use the real data files.
 */
import type { DATA_SCHEMA_VERSION, Enemy, SearchDoc, SpriteManifestIndex, SpriteManifestPart } from '../schemas'
import { spritePartFor, type SpritePartRef } from '../schemas/spriteParts'
import { ChunkLoadError, NotFoundError, SchemaVersionError } from './errors'
import { memo, type Memo } from './memo'
import {
  DEFAULT_IMPORTERS,
  DEFAULT_SHARD_IMPORTERS,
  DEFAULT_VALIDATOR,
  FETCHED_FILES,
  FETCHED_SHARDS,
  type DataFile,
  type Importers,
  type ShardImporters,
  type ShardKind,
  type Validator,
} from './sources'
import type {
  Accessory,
  AccessoryListRecord,
  ArmorListRecord,
  ArmorPiece,
  ArmorSet,
  Boss,
  Buff,
  Condition,
  ConditionIndex,
  DetailRecordMap,
  DropIndex,
  DropSource,
  EntityType,
  GapEntry,
  Item,
  ItemDetailIndexFile,
  ItemIndex,
  ItemListRecord,
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
  SpriteEntry,
  SpriteIndex,
  SpriteManifest,
} from './types'

export * from './errors'
export type * from './types'
export type { DataFile, Importer, Importers, ShardImporter, ShardImporters, ShardKind, Validator } from './sources'

/** The core item-detail file (src/schemas ITEM_DETAIL_CORE_FILE; loaded through `loadItems`). */
const ITEM_DETAIL_CORE_FILE = 'items.detail.json'

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
  /** Which ids are Item records (each has an encyclopedia page); loaded with the recipes. */
  items?: ItemIndex
  drops?: DropIndex
  progression?: ProgressionData
  conditions: ConditionIndex
}

export interface DataAccessOptions {
  /** Override individual importers (tests). */
  importers?: Partial<Importers>
  /** Dev-only validator; `null` disables it. Defaults to Zod parse in dev, none in production. */
  validate?: Validator | null
  /** Override the sharded-file loaders (tests). */
  shardImporters?: Partial<ShardImporters>
}

function byKey<T, K>(records: readonly T[], key: (record: T) => K): Map<K, T> {
  return new Map(records.map((record) => [key(record), record]))
}

export function createDataAccess(options: DataAccessOptions = {}) {
  const importers: Importers = { ...DEFAULT_IMPORTERS, ...options.importers }
  const shardImporters: ShardImporters = { ...DEFAULT_SHARD_IMPORTERS, ...options.shardImporters }
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

  async function loadShard<T>(kind: ShardKind, file: string): Promise<T> {
    let data: unknown
    try {
      data = await shardImporters[kind](file)
    } catch (cause) {
      throw new ChunkLoadError(file, cause, !FETCHED_SHARDS.has(kind))
    }
    if (validate) await validate(kind, data)
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
  const accessoryList = memo(() => loadFile<AccessoryListRecord[]>('accessories.list'))
  const armorList = memo(() => loadFile<ArmorListRecord[]>('armor.list'))
  const accessoryDetails = memo(async () => byKey(await loadFile<Accessory[]>('accessories.detail'), (a) => a.id))
  const armorDetails = memo(async () => byKey(await loadFile<ArmorPiece[]>('armor.detail'), (a) => a.id))
  const armorSets = memo(async () => byKey(await loadFile<ArmorSet[]>('armor-sets'), (s) => s.id))
  const stageGaps = memo(() => loadFile<GapEntry[]>('stage-gaps'))

  // --- items (P6 encyclopedia): the browse list + the detail record behind items.detail.index.json ----------
  const itemList = memo(() => loadFile<ItemListRecord[]>('items.list'))
  const itemIndex = memo(async (): Promise<ItemIndex> => {
    const raw = await loadFile<ItemDetailIndexFile>('items.detail.index')
    const fileOf = new Map<number, string>()
    for (const entry of raw.files) for (const id of entry.ids) fileOf.set(id, entry.file)
    return { fileOf, ids: new Set(fileOf.keys()) }
  })
  /** One memo per item-detail file: the core file reuses `loadItems`, a shard is its own lazy chunk. */
  const itemFiles = new Map<string, Memo<ReadonlyMap<number, Item>>>()
  function itemFile(file: string): Memo<ReadonlyMap<number, Item>> {
    let file$ = itemFiles.get(file)
    if (!file$) {
      file$ =
        file === ITEM_DETAIL_CORE_FILE
          ? memo(async () => byKey(await items.get(), (i) => i.id))
          : memo(async () => byKey(await loadShard<Item[]>('items.detail-shard', file), (i) => i.id))
      itemFiles.set(file, file$)
    }
    return file$
  }

  // --- sprites (AMENDMENTS-016 B104): the index, then only the parts a page draws from ---------------------
  /** Every entry of every part loaded so far (shared by all SpriteIndex views; grows, never shrinks). */
  const spriteByPath = new Map<string, SpriteEntry>()
  /** `parts` undefined = the importer delivered the complete manifest (every entry is already loaded). */
  const spriteRoot = memo(async (): Promise<{ fallbackMode: boolean; parts?: readonly SpritePartRef[] }> => {
    const data = await loadFile<SpriteManifestIndex | SpriteManifest>('sprite-manifest')
    if ('files' in data) {
      for (const f of data.files) spriteByPath.set(f.path, f)
      return { fallbackMode: data.fallbackMode }
    }
    return { fallbackMode: data.fallbackMode, parts: data.parts }
  })
  const spriteParts = new Map<string, Memo<true>>()
  function spritePart(ref: SpritePartRef): Memo<true> {
    let part$ = spriteParts.get(ref.file)
    if (!part$) {
      part$ = memo(async () => {
        const part = await loadShard<SpriteManifestPart>('sprite-part', ref.file)
        for (const f of part.files) spriteByPath.set(f.path, f)
        return true as const
      })
      spriteParts.set(ref.file, part$)
    }
    return part$
  }
  /** The parts of `dirs` ("weapons", "items" = every item part, …); none when the whole manifest is loaded. */
  const partsOf = (root: { parts?: readonly SpritePartRef[] }, dirs: readonly string[]) => (root.parts ?? []).filter((p) => dirs.includes(p.dir) || dirs.includes(p.part))
  async function loadSpriteEntry(path: string): Promise<SpriteEntry | undefined> {
    const root = await spriteRoot.get()
    const known = spriteByPath.get(path)
    if (known || !root.parts) return known
    const ref = spritePartFor(root.parts, path)
    if (!ref) return undefined
    await spritePart(ref).get()
    return spriteByPath.get(path)
  }
  let spriteView: SpriteIndex | undefined
  const spriteIndexOf = (root: { fallbackMode: boolean }): SpriteIndex =>
    (spriteView ??= { fallbackMode: root.fallbackMode, byPath: spriteByPath, load: loadSpriteEntry })

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
    peekSearchDocs: (): SearchDoc[] | undefined => searchDocs.peek(),
    /** Encyclopedia item records (§2.6) — ammo with its `ammoStats` for the Lab's ammo picker. */
    loadItems: (): Promise<Item[]> => items.get(),
    peekItems: (): Item[] | undefined => items.peek(),
    /** Buff/debuff registry (§2.9) — the Lab resolves a weapon's damage-over-time debuff here. */
    loadBuffs: (): Promise<Buff[]> => buffs.get(),
    peekBuffs: (): Buff[] | undefined => buffs.peek(),
    /** Accessory / armor list records (P2-S8): names, sprites and wiki links for item rows. */
    loadAccessoryList: (): Promise<AccessoryListRecord[]> => accessoryList.get(),
    peekAccessoryList: (): AccessoryListRecord[] | undefined => accessoryList.peek(),
    loadArmorList: (): Promise<ArmorListRecord[]> => armorList.get(),
    peekArmorList: (): ArmorListRecord[] | undefined => armorList.peek(),
    /** Accessory / armor detail records by id and armor sets by slug (gating for suggested gear). */
    loadAccessoryDetails: (): Promise<ReadonlyMap<number, Accessory>> => accessoryDetails.get(),
    peekAccessoryDetails: (): ReadonlyMap<number, Accessory> | undefined => accessoryDetails.peek(),
    loadArmorDetails: (): Promise<ReadonlyMap<number, ArmorPiece>> => armorDetails.get(),
    peekArmorDetails: (): ReadonlyMap<number, ArmorPiece> | undefined => armorDetails.peek(),
    loadArmorSets: (): Promise<ReadonlyMap<string, ArmorSet>> => armorSets.get(),
    peekArmorSets: (): ReadonlyMap<string, ArmorSet> | undefined => armorSets.peek(),
    /** Stage gap entries: the stated reasons behind declared Unknowns (e.g. a boss page's gear gap). */
    loadStageGaps: (): Promise<GapEntry[]> => stageGaps.get(),
    peekStageGaps: (): GapEntry[] | undefined => stageGaps.peek(),
    loadRecipeIndex: () => recipeIndex.get(),
    loadDropIndex: () => dropIndex.get(),
    peekDropIndex: () => dropIndex.peek(),
    loadConditionIndex: () => conditionIndex.get(),
    peekConditionIndex: () => conditionIndex.peek(),
    loadItemNames: () => itemNames.get(),
    peekItemNames: () => itemNames.peek(),
    /**
     * The sprite index (D3 fallbackMode + the entries loaded so far), after loading the manifest parts of
     * `dirs` ("weapons", "bosses", "armor", "accessories", "items" = every item part, or a part id such as
     * "items.3"). Sprites outside them load on demand through `index.load(path)` (SpriteImg does).
     */
    async loadSpriteIndex(dirs: readonly string[] = []): Promise<SpriteIndex> {
      const root = await spriteRoot.get()
      await Promise.all(partsOf(root, dirs).map((p) => spritePart(p).get()))
      return spriteIndexOf(root)
    },
    /** The sprite index when the index and the parts of `dirs` are already loaded; undefined otherwise. */
    peekSpriteIndex(dirs: readonly string[] = []): SpriteIndex | undefined {
      const root = spriteRoot.peek()
      if (!root || partsOf(root, dirs).some((p) => spritePart(p).peek() === undefined)) return undefined
      return spriteIndexOf(root)
    },
    /** Loads the part listing `path` (if any) and resolves its entry. */
    loadSpriteEntry,

    /** Every Item record as a browse list record (items.list.json; the encyclopedia's /items). */
    loadItemList: (): Promise<ItemListRecord[]> => itemList.get(),
    peekItemList: (): ItemListRecord[] | undefined => itemList.peek(),
    /** Which file holds each Item record; the set of Item ids (each has an encyclopedia page). */
    loadItemIndex: (): Promise<ItemIndex> => itemIndex.get(),
    peekItemIndex: (): ItemIndex | undefined => itemIndex.peek(),
    /**
     * One Item record: resolves its file through items.detail.index.json and loads only that file (the core
     * file or one ID-range shard, cached per file). Rejects with NotFoundError for an unknown / malformed id.
     */
    async loadItemDetail(id: string | number): Promise<Item> {
      const itemId = parseItemId(id)
      if (itemId === undefined) throw new NotFoundError(detailRef(id))
      const file = (await itemIndex.get()).fileOf.get(itemId)
      if (file === undefined) throw new NotFoundError(detailRef(itemId))
      const record = (await itemFile(file).get()).get(itemId)
      if (!record) throw new NotFoundError(detailRef(itemId))
      return record
    },
    /** The Item record when its file is already loaded; undefined otherwise (or not found). */
    peekItemDetail(id: string | number): Item | undefined {
      const itemId = parseItemId(id)
      const file = itemId === undefined ? undefined : itemIndex.peek()?.fileOf.get(itemId)
      return file === undefined || itemId === undefined ? undefined : itemFile(file).peek()?.get(itemId)
    },

    /** Loads only the indexes an acquisition section needs (recipes + names for craft, drops for drop). */
    async loadAcquisitionData(needs: AcquisitionNeeds): Promise<AcquisitionData> {
      const [recipes, names, itemIds, drops, graph, conditions] = await Promise.all([
        needs.recipes ? recipeIndex.get() : undefined,
        needs.recipes ? itemNames.get() : undefined,
        needs.recipes ? itemIndex.get() : undefined,
        needs.drops ? dropIndex.get() : undefined,
        needs.gates ? progression.get() : undefined,
        conditionIndex.get(),
      ])
      return { recipes, names, items: itemIds, drops, progression: graph, conditions }
    },
    peekAcquisitionData(needs: AcquisitionNeeds): AcquisitionData | undefined {
      const conditions = conditionIndex.peek()
      const recipes = needs.recipes ? recipeIndex.peek() : undefined
      const names = needs.recipes ? itemNames.peek() : undefined
      const itemIds = needs.recipes ? itemIndex.peek() : undefined
      const drops = needs.drops ? dropIndex.peek() : undefined
      const graph = needs.gates ? progression.peek() : undefined
      if (!conditions || (needs.recipes && (!recipes || !names || !itemIds)) || (needs.drops && !drops) || (needs.gates && !graph)) {
        return undefined
      }
      return { recipes, names, items: itemIds, drops, progression: graph, conditions }
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
  peekSearchDocs,
  loadItems,
  peekItems,
  loadBuffs,
  peekBuffs,
  loadAccessoryList,
  peekAccessoryList,
  loadArmorList,
  peekArmorList,
  loadAccessoryDetails,
  peekAccessoryDetails,
  loadArmorDetails,
  peekArmorDetails,
  loadArmorSets,
  peekArmorSets,
  loadStageGaps,
  peekStageGaps,
  loadRecipeIndex,
  loadDropIndex,
  peekDropIndex,
  loadConditionIndex,
  peekConditionIndex,
  loadItemNames,
  peekItemNames,
  loadSpriteIndex,
  peekSpriteIndex,
  loadSpriteEntry,
  loadItemList,
  peekItemList,
  loadItemIndex,
  peekItemIndex,
  loadItemDetail,
  peekItemDetail,
  loadAcquisitionData,
  peekAcquisitionData,
} = dataAccess
