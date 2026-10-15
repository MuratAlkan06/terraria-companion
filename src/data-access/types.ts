/**
 * Record + index types returned by the data-access layer. Type-only imports from the shared
 * schemas keep Zod out of the runtime bundle (validation is dev-only, see ./devValidate.ts).
 */
import type {
  Accessory,
  ArmorPiece,
  ArmorSet,
  Boss,
  Buff,
  Condition,
  DropSource,
  GapEntry,
  Item,
  LabBehavior,
  Meta,
  ProgressionEdge,
  ProgressionNode,
  Recipe,
  RecipeGroup,
  SpriteEntry,
  SpriteManifest,
  SpriteManifestFile,
  Weapon,
} from '../schemas'

/** Collections with a list/detail split (§5). Extend as armor/accessories/items ship. */
export type EntityType = 'weapons'

/**
 * weapons.list.json record: the projection of a detail record onto the list fields
 * (DATA_SCHEMA_SPEC §5; pipeline LIST_FIELDS) plus `labKind` = labBehavior.kind.
 * List records carry no `_prov`, so an absent always-applicable field (damage, stage…) reads
 * as Unknown in list UI; exact per-field status lives on the detail record.
 */
export type WeaponListRecord = Pick<
  Weapon,
  | 'id'
  | 'name'
  | 'slug'
  | 'type'
  | 'stage'
  | 'rarity'
  | 'sprite'
  | 'tags'
  | 'wikiUrl'
  | 'damageClass'
  | 'damage'
  | 'useTimeTicks'
  | 'useAnimationTicks'
> & { labKind: LabBehavior['kind'] }

export interface ListRecordMap {
  weapons: WeaponListRecord
}

/** Base list fields shared by every item collection (pipeline LIST_FIELDS BASE_FIELDS). */
type ListBase = 'id' | 'name' | 'slug' | 'type' | 'stage' | 'rarity' | 'sprite' | 'tags' | 'wikiUrl'
/** accessories.list.json record (projection of the detail record; no `_prov`). */
export type AccessoryListRecord = Pick<Accessory, ListBase | 'categories'>
/** armor.list.json record (projection of the detail record; no `_prov`). */
export type ArmorListRecord = Pick<ArmorPiece, ListBase | 'slot' | 'defense' | 'setId'>
/** items.list.json record (P6 encyclopedia browse; projection of the Item detail record; no `_prov`). */
export type ItemListRecord = Pick<Item, ListBase | 'category'>

/** items.detail.index.json as emitted (src/schemas ItemDetailIndex): the file holding each Item record. */
export interface ItemDetailIndexFile {
  shardSize: number
  files: ReadonlyArray<{ file: string; ids: readonly number[] }>
}

/** The item index as the loader uses it. */
export interface ItemIndex {
  /** Data file holding each Item id ("items.detail.json" = the core file, else an ID-range shard). */
  fileOf: ReadonlyMap<number, string>
  /** Every Item record id (the encyclopedia's pages). */
  ids: ReadonlySet<number>
}
export interface DetailRecordMap {
  weapons: Weapon
}
export type ListRecord<T extends EntityType = EntityType> = ListRecordMap[T]
export type DetailRecord<T extends EntityType = EntityType> = DetailRecordMap[T]

/** item-universe.json (Module:Iteminfo/data id → name), used to name recipe ingredients/stations. */
export interface ItemUniverseFile {
  items: ReadonlyArray<{ id: number; internalName: string; name?: string }>
}

export interface ItemNames {
  /** Display name by game item id. Absent for the few unnamed (unused) ids. */
  byId: ReadonlyMap<number, string>
  /** Display name by name slug (ammo classes are slugs of their representative item's name). */
  bySlug: ReadonlyMap<string, string>
}

export interface RecipeIndex {
  byId: ReadonlyMap<string, Recipe>
  groups: ReadonlyMap<string, RecipeGroup>
}

export interface DropIndex {
  byId: ReadonlyMap<string, DropSource>
}

export interface ConditionIndex {
  byId: ReadonlyMap<string, Condition>
}

/** progression.json (P2-S6): typed boss/event/milestone graph. */
export interface ProgressionData {
  nodes: readonly ProgressionNode[]
  edges: readonly ProgressionEdge[]
  nodeById: ReadonlyMap<string, ProgressionNode>
}

export interface SpriteIndex {
  /** D3 takedown lever: when true every sprite renders as placeholder art. */
  fallbackMode: boolean
  /**
   * Entries of the manifest parts loaded so far (AMENDMENTS-016 B104: the app loads only the parts it
   * draws from). Live: it grows as parts load — read a sprite that may not be loaded through `load`.
   */
  byPath: ReadonlyMap<string, SpriteEntry>
  /**
   * Loads (once per session) the manifest part that lists `path` and resolves its entry; undefined when no
   * part lists it. Absent on a complete static index (e.g. one built from the whole manifest in tests).
   */
  load?: (path: string) => Promise<SpriteEntry | undefined>
}

export type {
  Accessory,
  ArmorPiece,
  ArmorSet,
  Boss,
  Buff,
  Condition,
  DropSource,
  GapEntry,
  Item,
  Meta,
  ProgressionEdge,
  ProgressionNode,
  Recipe,
  RecipeGroup,
  SpriteEntry,
  SpriteManifest,
  SpriteManifestFile,
  Weapon,
}
