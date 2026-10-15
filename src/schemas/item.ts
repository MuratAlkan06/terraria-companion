/**
 * Shared item core, acquisition, gating, stat effects, and the encyclopedia `Item`
 * (DATA_SCHEMA_SPEC §2.2, §2.3, §2.6).
 *
 * One shared game-item-ID space: an ID appears in exactly one of Weapon / ArmorPiece /
 * Accessory / Item (validated by the pipeline, §3).
 */
import * as z from 'zod'
import {
  AmmoClass,
  ConditionSlug,
  DamageClass,
  ItemId,
  PlainText1,
  Rarity,
  Slug,
  Stage,
  WikiUrl,
} from './common'
import { Prov } from './prov'

export const GatedBy = z.strictObject({
  bosses: z.array(Slug), // node slugs that MUST be defeated first
  conditions: z.array(ConditionSlug), // world conditions not implied by bosses
  stage: Stage, // display tag = max over gates of (node.unlocksStage ?? node.stage) (B22); bosses[] authoritative
})
export type GatedBy = z.infer<typeof GatedBy>
// Derived by pipeline (§7b). If underivable: absent + "gatedBy" in unverifiedFields
// ⇒ consumers treat gating as UNKNOWN and NEVER "obtainable now" (Feature A/B rule).

export const Acquisition = z.discriminatedUnion('method', [
  z.strictObject({ method: z.literal('craft'), recipeIds: z.array(z.string()).min(1) }),
  z.strictObject({ method: z.literal('drop'), dropIds: z.array(z.string()).min(1) }),
  z.strictObject({
    method: z.literal('purchase'),
    npcName: PlainText1,
    priceCopper: z.int().positive().optional(),
    conditions: z.array(ConditionSlug),
  }),
  z.strictObject({
    method: z.literal('loot'),
    containers: z.array(PlainText1).min(1),
    locations: z.array(PlainText1),
    conditions: z.array(ConditionSlug).default([]), // AMENDMENTS-002 B4: chest/ore gating derivable by §7b
  }),
  z.strictObject({
    method: z.literal('fishing'),
    biomes: z.array(PlainText1).min(1),
    conditions: z.array(ConditionSlug),
  }),
  z.strictObject({
    method: z.literal('other'),
    description: PlainText1,
    sourceUrl: WikiUrl,
    conditions: z.array(ConditionSlug).default([]), // AMENDMENTS-002 B4
  }),
])
export type Acquisition = z.infer<typeof Acquisition>

/**
 * AMENDMENTS-002 B5: a buff/debuff duration is a fixed tick count or an inclusive tick range
 * (Wand of Sparking: On Fire! for 1–4 s = 60–240 ticks).
 */
export const DurationTicks = z.union([
  z.int().positive(),
  z
    .strictObject({ minTicks: z.int().positive(), maxTicks: z.int().positive() })
    .refine((d) => d.minTicks <= d.maxTicks, { message: 'minTicks must be <= maxTicks', path: ['maxTicks'] }),
])
export type DurationTicks = z.infer<typeof DurationTicks>

/** Fields shared by Weapon, ArmorPiece, Accessory, Item (spread into each strictObject). */
export const itemCommon = {
  id: ItemId,
  name: PlainText1,
  slug: Slug, // unique across the whole item ID space
  rarity: Rarity.optional(),
  stage: Stage.optional(), // DERIVED from gatedBy else curated (risk A3)
  tags: z.array(Slug),
  wikiUrl: WikiUrl,
  sprite: z.string().optional(), // path under /sprites/…; absent ⇒ placeholder (D3)
  valueCopper: z.int().nonnegative().optional(),
  // AMENDMENTS-002 B7: Cargo `stack` reports 9999 for equipment; never emit it for non-stackable
  // equipment. ArmorPiece/Accessory drop this key entirely (equipment.ts); Weapon keeps it only
  // for genuinely stackable (consumable/thrown) weapons, sourced from Iteminfo maxStack.
  maxStack: z.int().positive().optional(),
  gatedBy: GatedBy.optional(),
  acquisition: z.array(Acquisition), // empty ⇒ "acquisition" ∈ unverifiedFields
  _prov: Prov,
}

// §2.3 StatEffect (armor/sets/accessories/buffs — powers P3-S14 + loadout math)
export const StatKind = z.enum([
  'damage-pct',
  'damage-flat',
  'crit-pct',
  'melee-speed-pct',
  'attack-speed-pct',
  'defense-flat',
  'damage-reduction-pct',
  'move-speed-pct',
  'jump-boost',
  'flight-time-ticks',
  'max-mana-flat',
  'mana-cost-pct',
  'mana-regen',
  'minion-slots',
  'sentry-slots',
  'whip-range-pct',
  'life-regen',
  'max-life-flat',
  'mining-speed-pct',
  'aggro-flat',
  // AMENDMENTS-011 B54 (pre-approved; landed by the AMENDMENTS-014 B70 P4-prep slice). Units follow the
  // §2 conventions: *-pct = integer percent (signed: reductions negative), *-ticks = ticks (60/s),
  // *-flat = the game's own unit (fishing power points, tiles of reach, armor penetration points,
  // summon tag effect slots). Rows without a stated value stay kind:"special" (B54: "no value/unit").
  'fishing-power-flat',
  'ammo-save-pct', // chance not to consume ammo (all ammo kinds; ammo-scoped lines stay specials)
  'knockback-pct',
  'tag-effect-slots',
  'lava-immunity-ticks',
  'melee-scale-pct',
  'tile-reach-flat',
  'potion-cooldown-pct', // healing-potion cooldown (Potion Sickness duration); reductions negative
  'armor-penetration-flat',
  'minion-knockback',
  'whip-speed-pct',
]) // CLOSED enum: pipeline FAILS on unclassifiable effect → explicit extension, never silent text
export type StatKind = z.infer<typeof StatKind>

export const StatEffect = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('stat'),
    stat: StatKind,
    value: z.number(), // signed: reductions are negative (e.g. mana-cost-pct -14)
    scope: DamageClass.optional(), // absent = all classes
  }),
  z.strictObject({
    kind: z.literal('special'), // real but unmodeled — Lab lists "not simulated"
    text: PlainText1,
    simulated: z.literal(false),
    sourceUrl: WikiUrl,
  }),
])
export type StatEffect = z.infer<typeof StatEffect>

/** Projectile shape shared by Lab archetypes and ammo (§2.4). Velocities in tiles/second. */
export const ProjectileSpec = z.strictObject({
  velocityTps: z.number().positive(),
  gravity: z.boolean().optional(), // simplified: arcing vs straight (v1 fidelity)
  lifetimeTicks: z.int().positive().optional(),
  pierce: z.union([z.int().nonnegative(), z.literal('infinite')]).optional(),
  spriteKey: z.string().optional(),
  // AMENDMENTS-010 B48(b): the projectile deals this percentage of the damage it would otherwise deal
  // (weapon damage, + ammo damage for bows/guns), rounded down — e.g. "deals 50% of the weapon's
  // damage" (gem staffs). Wiki-sourced per weapon (quote-checked); absent = 100%.
  damageMultiplierPct: z.int().positive().optional(),
})
export type ProjectileSpec = z.infer<typeof ProjectileSpec>

// §2.6 Item (encyclopedia superset)
export const ItemCategory = z.enum([
  'material',
  'potion',
  'food',
  'ammo',
  'tool',
  'hook',
  'mount',
  'station',
  'summoning',
  'exploration-utility',
  'other',
  // P6-S0 item corpus (additive): the remaining wiki infobox item types the encyclopedia browses
  // (pipeline/merge/corpus.ts maps each Cargo Items `type` list onto exactly one category; the full
  // type list stays in `tags`).
  'vanity', // cosmetic armor pieces and vanity accessories (music boxes, …)
  'dye', // dyes and hair dyes
  'pet', // pet and light pet summons
  'furniture', // placeable furniture, light sources, storage, mechanisms, background objects
  'block', // placeable blocks, bricks and walls
  'fishing', // fish, quest fish, crates and bait (AMENDMENTS-004 B20)
  'grab-bag', // treasure bags, presents, goodie bags and other opened containers
  'permanent-booster', // consumables with a permanent effect (Life Crystal, Demon Heart, …)
])
export type ItemCategory = z.infer<typeof ItemCategory>

/**
 * What an ammo item contributes when fired (§2.6 + AMENDMENTS-002 B2). P2-S7 (A1 principle,
 * AMENDMENTS-001 A2 "verified damage or Unknown"): `damage` is optional — absent + listed
 * `ammoStats.damage` = Unknown (e.g. Gel, whose game data carries no damage of its own).
 * Shared by Item and by dual-role Weapons (Snowball is both a thrown weapon and Snowball Cannon ammo).
 */
export const AmmoStats = z.strictObject({
  ammoClass: AmmoClass,
  damage: z.int().nonnegative().optional(),
  velocityBonusTps: z.number().optional(), // added to the firing weapon's shoot speed (tiles/s)
  velocityMultiplier: z.number().positive().optional(), // AMENDMENTS-002 B2 (Musket Ball: 2x)
  knockback: z.number().nonnegative().optional(),
  projectile: ProjectileSpec.optional(),
})
export type AmmoStats = z.infer<typeof AmmoStats>

export const Item = z.strictObject({
  ...itemCommon,
  type: z.literal('item'),
  category: ItemCategory,
  consumable: z.boolean().optional(),
  isStation: z.boolean(), // DERIVED: referenced as station by ≥1 recipe
  ammoStats: AmmoStats.optional(),
  toolStats: z
    .strictObject({
      pickaxePowerPct: z.int().positive().optional(),
      axePowerPct: z.int().positive().optional(),
      hammerPowerPct: z.int().positive().optional(),
      // P6-S0 (additive, AMENDMENTS-004 B20 fishing items): a fishing pole's fishing power in percent
      // (Module:Iteminfo/data fishingPole, cross-checked with the wiki infobox).
      fishingPowerPct: z.int().positive().optional(),
    })
    .optional(),
  // P6-S0 (additive, B20): bait power in percent (Module:Iteminfo/data bait, cross-checked with the
  // wiki infobox). Absent + not listed = not bait.
  baitPowerPct: z.int().positive().optional(),
  hookStats: z
    .strictObject({
      reachTiles: z.number().positive().optional(),
      hookCount: z.int().positive().optional(),
      simultaneousLatches: z.int().positive().optional(),
    })
    .optional(),
  mountStats: z.strictObject({ description: PlainText1, sourceUrl: WikiUrl }).optional(),
  // AMENDMENTS-014 B70 potion corpus (additive): health / mana a consumable restores instantly
  // (Module:Iteminfo/data healLife / healMana, cross-checked with the wiki infobox). Absent + not
  // listed = not applicable (restores nothing); absent + listed = Unknown.
  healLife: z.int().positive().optional(),
  healMana: z.int().positive().optional(),
  buffGrants: z
    .array(
      z.strictObject({
        buffId: Slug,
        durationTicks: DurationTicks.optional(), // B5: fixed or range
      }),
    )
    .optional(),
  summonsBossNode: Slug.optional(),
})
export type Item = z.infer<typeof Item>

/** P6-S0 item-detail shard file names: the core file and the ID-range shards (`items.detail.<n>.json`). */
export const ITEM_DETAIL_CORE_FILE = 'items.detail.json'
export const ITEM_DETAIL_INDEX_FILE = 'items.detail.index.json'
export const ItemDetailFile = z.string().regex(/^items\.detail(?:\.\d+)?\.json$/)

/**
 * P6-S0 (DATA_SCHEMA_SPEC §5 "items.detail.<n>.json by ID ranges + items.detail.index.json"):
 * `items.detail.index.json` names the data file holding each Item record. `items.detail.json` (the
 * core file) keeps exactly the records the shipped Lab / boss pages / readiness checker load — the
 * ammo, the potion corpus and every item a boss record references (summon items, prep-checklist
 * items); every other item lives in the ID-range shard `items.detail.<n>.json` holding ids
 * n×shardSize … (n+1)×shardSize − 1. Every emitted Item id is listed in exactly one file (validated).
 */
export const ItemDetailIndex = z.strictObject({
  shardSize: z.int().positive(),
  files: z.array(z.strictObject({ file: ItemDetailFile, ids: z.array(ItemId) })).min(1),
})
export type ItemDetailIndex = z.infer<typeof ItemDetailIndex>
