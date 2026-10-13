/**
 * SearchDoc — MiniSearch input (DATA_SCHEMA_SPEC §2.10; A5 adds type "enemy").
 *
 * MiniSearch: fields ["name","tags"]; storeFields ["type","class","stage","rarity"];
 * idField "id"; prefix:true, fuzzy:0.2, boost {name:2}; facet filters over storeFields.
 */
import * as z from 'zod'
import { DamageClass, PlainText1, Rarity, Slug, Stage, TypedRef } from './common'

export const SearchDocType = z.enum(['weapon', 'armor', 'accessory', 'item', 'boss', 'set', 'buff', 'enemy'])
export type SearchDocType = z.infer<typeof SearchDocType>

export const SearchDoc = z.strictObject({
  id: TypedRef,
  name: PlainText1,
  type: SearchDocType,
  class: DamageClass.optional(),
  stage: Stage.optional(),
  rarity: Rarity.optional(),
  tags: z.array(Slug),
})
export type SearchDoc = z.infer<typeof SearchDoc>
