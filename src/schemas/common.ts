/**
 * Shared primitives (DATA_SCHEMA_SPEC §2.0, amended by AMENDMENTS-001 A5/A15/A17).
 *
 * Single source of truth for IDs, refs, units, and enums used by both `pipeline/`
 * and the app. Zod 4 (`zod@^4`).
 */
import * as z from 'zod'

export const ItemId = z.int().positive()
export const Slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const IsoDateTime = z.iso.datetime()
export const WikiUrl = z.url().startsWith('https://terraria.wiki.gg/')

/** Cross-type reference. A5 adds `enemy:<slug>`. */
export const TypedRef = z
  .string()
  .regex(/^(i:\d+|(set|boss|node|buff|grp|scn|cond|enemy):[a-z0-9-]+|(rcp|drop):[a-z0-9-]+)$/)
export type TypedRef = z.infer<typeof TypedRef>

export const GAME_VERSION = '1.4.5.8' as const
export const DATA_SCHEMA_VERSION = 1 as const

export const Stage = z.enum(['early-prehm', 'late-prehm', 'early-hm', 'mid-hm', 'endgame'])
export type Stage = z.infer<typeof Stage>
export const STAGE_ORDER: Record<Stage, number> = {
  'early-prehm': 0,
  'late-prehm': 1,
  'early-hm': 2,
  'mid-hm': 3,
  endgame: 4,
}

export const DamageClass = z.enum(['melee', 'ranged', 'magic', 'summon', 'other'])
export type DamageClass = z.infer<typeof DamageClass>
export const Difficulty = z.enum(['classic', 'expert', 'master'])
export type Difficulty = z.infer<typeof Difficulty>
export const WorldEvil = z.enum(['corruption', 'crimson'])
export type WorldEvil = z.infer<typeof WorldEvil>
/** Validated against the conditions.json registry (pipeline validate, §7a-9). */
export const ConditionSlug = Slug
/** Validated against the set of `Item.ammoStats.ammoClass` values (§7a-10, demoted by A1). */
export const AmmoClass = Slug

/** Rarity tiers -1..11 plus special tiers (§2.2; tokens per A17). */
export const Rarity = z.union([z.int().min(-1).max(11), z.enum(['rainbow', 'fiery-red', 'amber'])])
export type Rarity = z.infer<typeof Rarity>

/**
 * A15 plain-text rule: wiki-derived strings carry no markup. The pipeline strips markup
 * before validate; this refinement makes any leak a build-failing E_SCHEMA and lets the
 * app's dev parse catch it too. Detects HTML tags, wikilinks/templates, wiki bold/italic
 * quote runs, and HTML entities.
 */
const MARKUP = /<\/?[a-z][^>]*>|\[\[|\]\]|\{\{|\}\}|''|&(?:[a-z][a-z0-9]*|#\d+|#x[0-9a-f]+);/i
export const isPlainText = (value: string): boolean => !MARKUP.test(value)
export const PlainText = z
  .string()
  .refine(isPlainText, { message: 'A15: wiki-derived text must be plain text (markup found)' })
/** Non-empty plain text. */
export const PlainText1 = PlainText.min(1)
