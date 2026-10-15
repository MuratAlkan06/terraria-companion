/**
 * Armor, ArmorSet, Accessory (DATA_SCHEMA_SPEC §2.5, amended by AMENDMENTS-001 A1).
 */
import * as z from 'zod'
import { DamageClass, ItemId, PlainText1, Slug, Stage, WikiUrl } from './common'
import { itemCommon, StatEffect } from './item'
import { Prov } from './prov'

/**
 * AMENDMENTS-002 B7 (binding): armor pieces and accessories never stack, and Cargo `stack`
 * reports a bogus 9999 for them — so `maxStack` is not a key of these entities at all
 * (strictObject rejects it; the merge stage must omit it).
 */
const { maxStack: _nonStackable, ...equipmentCommon } = itemCommon

export const ArmorPiece = z.strictObject({
  ...equipmentCommon,
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
  pieces: z.strictObject({
    helmets: z.array(ItemId).min(1),
    chest: ItemId,
    // P6 fix round (additive, read like B52's `classes ?? [class]`): a set completed by ONE OF several chests (Beetle
    // armor: Scale Mail or Shell; Wizard set: eight robes) lists every such chest here, `chest` first. Absent =
    // [chest]. Read through `setChestIds`.
    chests: z.array(ItemId).min(2).optional(),
    // Absent = the set has no legs piece; any legs keep its bonus (Wizard set, quote-backed in the overlay).
    legs: ItemId.optional(),
  }),
  variants: z
    .array(
      // one per helmet — or, for a set whose bonus is keyed by its chest, one per helmet × chest (validated, §7a-6)
      z.strictObject({
        helmetId: ItemId,
        // P6 fix round: the bonus this variant states holds only with this chest (Beetle armor). Absent = with any
        // of the set's chests.
        chestId: ItemId.optional(),
        class: DamageClass, // "other" for classless and hybrid sets (kept one release beside `classes`, B52)
        // AMENDMENTS-011 B52 (landed by the B70 P4-prep slice): the variant's damage classes. One class →
        // [class]; classless → ["other"]; hybrid (quote-evidenced, e.g. "melee/ranged") → the classes,
        // with `class` "other". Optional for backward compatibility — consumers read
        // `variant.classes ?? [variant.class]` (SCORING_SPEC §3); the pipeline always emits it.
        classes: z
          .array(DamageClass)
          .min(1)
          .refine((cs) => new Set(cs).size === cs.length, { message: 'B52: classes must not repeat' })
          .optional(),
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
export type ArmorSetVariant = ArmorSet['variants'][number]

/**
 * P2-S8 (A1 principle, AMENDMENTS-001): `categories` / `effects` drop `.min(1)` — an accessory whose
 * game text states no effect (new 1.4.5 items the wiki has not transcribed yet, e.g. Razortip) is
 * Unknown, encoded as the empty list + the field in `_prov.unverifiedFields` (the pipeline's validate
 * stage rejects an empty, unlisted list), never an invented effect.
 */
export const Accessory = z.strictObject({
  ...equipmentCommon,
  type: z.literal('accessory'),
  categories: z.array(z.enum(['mobility', 'defense', 'offense', 'utility'])),
  effects: z.array(StatEffect),
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
