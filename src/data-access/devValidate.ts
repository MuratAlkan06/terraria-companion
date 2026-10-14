/**
 * Dev-only Zod parse of loaded data files (DATA_SCHEMA_SPEC §4a "DataValidationError (dev-only
 * Zod parse)"). Imported ONLY behind `import.meta.env.DEV` (see ./sources.ts), so neither this
 * module nor Zod ships in production bundles. Tests import it directly.
 */
import * as z from 'zod'
import {
  Boss,
  Buff,
  Condition,
  DropSource,
  Enemy,
  Item,
  ItemId,
  Meta,
  ProgressionEdge,
  ProgressionNode,
  Recipe,
  RecipeGroup,
  SearchDoc,
  SpriteManifest,
  Weapon,
} from '../schemas'
import { DataValidationError } from './errors'
import type { DataFile } from './sources'

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

const SCHEMAS: Record<DataFile, z.ZodType> = {
  'weapons.list': z.array(WeaponListRecordSchema),
  'weapons.detail': z.array(Weapon),
  'items.detail': z.array(Item),
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
  'sprite-manifest': SpriteManifest,
}

/** Throws DataValidationError when `data` does not match the file's schema. */
export function validateDataFile(file: DataFile, data: unknown): void {
  const result = SCHEMAS[file].safeParse(data)
  if (!result.success) throw new DataValidationError(file, result.error.issues)
}
