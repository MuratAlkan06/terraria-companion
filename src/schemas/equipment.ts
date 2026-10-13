/**
 * Armor, ArmorSet, Accessory (DATA_SCHEMA_SPEC §2.5, amended by AMENDMENTS-001 A1).
 */
import * as z from 'zod'
import { DamageClass, ItemId, PlainText1, Slug, Stage, WikiUrl } from './common'
import { itemCommon, StatEffect } from './item'
import { Prov } from './prov'

export const ArmorPiece = z.strictObject({
  ...itemCommon,
  type: z.literal('armor'),
  slot: z.enum(['head', 'chest', 'legs']),
  defense: z.int().nonnegative().optional(), // A1: optional — absent + listed = Unknown
  effects: z.array(StatEffect), // per-piece (not set bonus)
  setId: Slug.optional(),
})
export type ArmorPiece = z.infer<typeof ArmorPiece>

export const ArmorSet = z.strictObject({
  id: Slug,
  name: PlainText1,
  pieces: z.strictObject({ helmets: z.array(ItemId).min(1), chest: ItemId, legs: ItemId }),
  variants: z
    .array(
      // exactly one per helmet (validated bijection, §7a-6)
      z.strictObject({
        helmetId: ItemId,
        class: DamageClass, // "other" for classless sets
        setBonus: z.array(StatEffect).min(1), // non-stat bonuses use kind:"special"
        setBonusText: PlainText1,
      }),
    )
    .min(1),
  stage: Stage.optional(),
  wikiUrl: WikiUrl,
  _prov: Prov,
})
export type ArmorSet = z.infer<typeof ArmorSet>

export const Accessory = z.strictObject({
  ...itemCommon,
  type: z.literal('accessory'),
  categories: z.array(z.enum(['mobility', 'defense', 'offense', 'utility'])).min(1),
  effects: z.array(StatEffect).min(1),
  combinedFrom: z.array(ItemId), // DERIVED from Tinkerer's-Workshop recipes
  upgradesTo: z.array(ItemId), // DERIVED inverse
  wingStats: z
    .strictObject({
      flightTimeTicks: z.int().positive().optional(),
      verticalSpeedTps: z.number().positive().optional(),
      hover: z.boolean().optional(),
    })
    .optional(),
})
export type Accessory = z.infer<typeof Accessory>
