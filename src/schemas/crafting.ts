/**
 * Recipe, RecipeGroup, DropSource (DATA_SCHEMA_SPEC §2.7, keys per §3).
 *
 * Recipe id:     `${resultItemId}-${fnv1a32hex(canonical)}` (sorted stations + ingredient pairs)
 * DropSource id: `${itemId}-${npcNameSlug}-${fnv1a32hex(sortedConditions)}`
 * Both are produced by the merge stage; validate enforces uniqueness (E_DUPLICATE_ID).
 */
import * as z from 'zod'
import { ConditionSlug, ItemId, NpcId, PlainText1, Slug } from './common'
import { Prov } from './prov'

/**
 * AMENDMENTS-002 B3: a station is one item, a RecipeGroup of interchangeable station items
 * ("Iron or Lead Anvil" → group, resolved like ingredient groups), or a non-item requirement
 * (environment/condition, e.g. "Ecto Mist", "Water", "Shimmer").
 */
export const RecipeStation = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('item'), itemId: ItemId }),
  z.strictObject({ kind: z.literal('group'), groupId: Slug }),
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
  // AMENDMENTS-003 B9: availability requirements ("after Moon Lord", moon phases, Torch God's
  // Favor). Environment stations remain only for genuine crafting environments (water, Ecto Mist…).
  conditions: z.array(ConditionSlug).default([]),
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

/** Inclusive drop quantity range (min ≤ max). */
export const DropQty = z
  .strictObject({ min: z.int().positive(), max: z.int().positive() })
  .refine((q) => q.min <= q.max, { message: 'quantity min must be <= max', path: ['max'] })
export type DropQty = z.infer<typeof DropQty>

/**
 * AMENDMENTS-002 B1: uniform quantity, or per-difficulty quantities (Creeper → Tissue Sample:
 * 2–5 classic / 1–3 expert / 1–2 master). In the per-difficulty form an absent difficulty is
 * Unknown iff `quantity.<difficulty>` is listed in _prov.unverifiedFields, else not applicable.
 */
export const DropQuantity = z.union([
  DropQty,
  z.strictObject({ classic: DropQty.optional(), expert: DropQty.optional(), master: DropQty.optional() }),
])
export type DropQuantity = z.infer<typeof DropQuantity>

export const DropSource = z.strictObject({
  id: z.string(), // `${itemId}-${npcSlugOrId}-${fnv1a32hex(conditions)}`
  itemId: ItemId,
  source: z.strictObject({
    npcName: PlainText1,
    npcIds: z.array(NpcId).optional(),
    bossId: Slug.optional(),
    treasureBag: z.boolean().optional(),
  }),
  quantity: DropQuantity,
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
