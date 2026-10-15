/**
 * Dev-only Zod parse of loaded data files (DATA_SCHEMA_SPEC §4a "DataValidationError (dev-only
 * Zod parse)"). Imported ONLY behind `import.meta.env.DEV` (see ./sources.ts), so neither this
 * module nor Zod ships in production bundles. Tests import it directly.
 */
import * as z from 'zod'
import {
  Accessory,
  ArmorPiece,
  ArmorSet,
  Boss,
  Buff,
  Condition,
  DropSource,
  Enemy,
  GapEntry,
  Item,
  ItemDetailIndex,
  ItemId,
  Meta,
  ProgressionEdge,
  ProgressionNode,
  Recipe,
  RecipeGroup,
  SearchDoc,
  SpriteManifest,
  SpriteManifestIndex,
  SpriteManifestPart,
  Weapon,
} from '../schemas'
import { DataValidationError } from './errors'
import type { DataFile, ShardKind } from './sources'

const LAB_KINDS = ['archetype', 'custom-scenario', 'limitation'] as const

/** weapons.list.json record = Weapon projection onto the list fields (+ labKind). Strict. */
export const WeaponListRecordSchema = Weapon.pick({
  id: true,
  name: true,
  slug: true,
  type: true,
  stage: true,
  rarity: true,
  sprite: true,
  tags: true,
  wikiUrl: true, // AMENDMENTS-007 B31 (P2-S7): rows/cards link the weapon's own wiki page
  damageClass: true,
  damage: true,
  useTimeTicks: true,
  useAnimationTicks: true,
}).extend({ labKind: z.enum(LAB_KINDS) })

/** List records of the equipment collections (pipeline LIST_FIELDS: base fields + the type's own). Strict. */
const LIST_BASE = { id: true, name: true, slug: true, type: true, stage: true, rarity: true, sprite: true, tags: true, wikiUrl: true } as const
export const AccessoryListRecordSchema = Accessory.pick({ ...LIST_BASE, categories: true })
export const ArmorListRecordSchema = ArmorPiece.pick({ ...LIST_BASE, slot: true, defense: true, setId: true })
/** items.list.json record (P6 encyclopedia browse): base list fields + category. Strict. */
export const ItemListRecordSchema = Item.pick({ ...LIST_BASE, category: true })

/** App-side view of the pipeline's item-universe.json (only the fields the app reads are strict). */
const ItemUniverseSchema = z.object({
  items: z.array(
    z.strictObject({
      id: ItemId,
      internalName: z.string().min(1),
      name: z.string().min(1).optional(),
    }),
  ),
})

const SCHEMAS: Record<DataFile | ShardKind, z.ZodType> = {
  'weapons.list': z.array(WeaponListRecordSchema),
  'weapons.detail': z.array(Weapon),
  'accessories.list': z.array(AccessoryListRecordSchema),
  'accessories.detail': z.array(Accessory),
  'armor.list': z.array(ArmorListRecordSchema),
  'armor.detail': z.array(ArmorPiece),
  'armor-sets': z.array(ArmorSet),
  'stage-gaps': z.array(GapEntry),
  'items.detail': z.array(Item),
  'items.detail.index': ItemDetailIndex,
  'items.list': z.array(ItemListRecordSchema),
  'items.detail-shard': z.array(Item),
  buffs: z.array(Buff),
  recipes: z.array(Recipe),
  'recipe-groups': z.array(RecipeGroup),
  drops: z.array(DropSource),
  conditions: z.array(Condition),
  'item-universe': ItemUniverseSchema,
  progression: z.strictObject({ nodes: z.array(ProgressionNode), edges: z.array(ProgressionEdge) }),
  bosses: z.array(Boss),
  enemies: z.array(Enemy),
  'search-docs': z.array(SearchDoc),
  meta: Meta,
  // AMENDMENTS-016 B104: the runtime index (or, in tests, the complete provenance manifest)
  'sprite-manifest': z.union([SpriteManifestIndex, SpriteManifest]),
  'sprite-part': SpriteManifestPart,
}

/** Throws DataValidationError when `data` does not match the file's schema. */
export function validateDataFile(file: DataFile | ShardKind, data: unknown): void {
  const result = SCHEMAS[file].safeParse(data)
  if (!result.success) throw new DataValidationError(file, result.error.issues)
}
