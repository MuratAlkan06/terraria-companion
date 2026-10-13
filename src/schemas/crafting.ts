/**
 * Recipe, RecipeGroup, DropSource (DATA_SCHEMA_SPEC §2.7, keys per §3).
 *
 * Recipe id:     `${resultItemId}-${fnv1a32hex(canonical)}` (sorted stations + ingredient pairs)
 * DropSource id: `${itemId}-${npcNameSlug}-${fnv1a32hex(sortedConditions)}`
 * Both are produced by the merge stage; validate enforces uniqueness (E_DUPLICATE_ID).
 */
import * as z from 'zod'
import { ConditionSlug, ItemId, PlainText1, Slug } from './common'
import { Prov } from './prov'

export const RecipeStation = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('item'), itemId: ItemId }),
  z.strictObject({ kind: z.literal('environment'), condition: ConditionSlug, name: PlainText1 }),
])
export type RecipeStation = z.infer<typeof RecipeStation>

export const RecipeIngredientRef = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('item'), itemId: ItemId }),
  z.strictObject({ kind: z.literal('group'), groupId: Slug }), // "Any Iron Bar"
])

export const Recipe = z.strictObject({
  id: z.string(), // `${resultItemId}-${fnv1a32hex(canonicalJson)}` — stable across runs
  resultItemId: ItemId,
  resultAmount: z.int().positive(),
  stations: z.array(RecipeStation), // empty = by-hand (explicit, not unknown)
  ingredients: z
    .array(
      z.strictObject({
        amount: z.int().positive(),
        ref: RecipeIngredientRef,
      }),
    )
    .min(1),
  _prov: Prov,
})
export type Recipe = z.infer<typeof Recipe>

export const RecipeGroup = z.strictObject({
  id: Slug,
  name: PlainText1,
  memberItemIds: z.array(ItemId).min(2),
  _prov: Prov,
})
export type RecipeGroup = z.infer<typeof RecipeGroup>

const DropRate = z.number().gt(0).lte(1)
export const DropSource = z.strictObject({
  id: z.string(), // `${itemId}-${npcSlugOrId}-${fnv1a32hex(conditions)}`
  itemId: ItemId,
  source: z.strictObject({
    npcName: PlainText1,
    npcIds: z.array(z.int().positive()).optional(), // TO-VERIFY-IN-P2
    bossId: Slug.optional(),
    treasureBag: z.boolean().optional(),
  }),
  quantity: z.strictObject({ min: z.int().positive(), max: z.int().positive() }),
  rates: z.strictObject({
    // absent + listed = Unknown
    classic: DropRate.optional(),
    expert: DropRate.optional(),
    master: DropRate.optional(),
  }),
  conditions: z.array(ConditionSlug),
  _prov: Prov,
})
export type DropSource = z.infer<typeof DropSource>
