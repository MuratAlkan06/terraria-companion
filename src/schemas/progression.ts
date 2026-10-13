/**
 * Boss, ProgressionNode, ProgressionEdge (DATA_SCHEMA_SPEC §2.8, amended by AMENDMENTS-001 A1).
 *
 * A1 boss curated-field staging: attackPatternTags, suggestedEquipment, prepChecklist and
 * strategies are optional here (absent + listed in unverifiedFields = Unknown). Their
 * curated minimums are enforced by the P5 gate check `E_BOSS_CURATION{bossId,field}`,
 * not by this schema.
 */
import * as z from 'zod'
import {
  ConditionSlug,
  DamageClass,
  Difficulty,
  ItemId,
  NpcId,
  PlainText,
  PlainText1,
  Slug,
  Stage,
  WikiUrl,
  WorldEvil,
} from './common'
import { Prov } from './prov'

export const AttackPatternTag = z.enum([
  'charges',
  'dashes',
  'flies',
  'ground-bound',
  'burrows',
  'teleports',
  'projectile-spam',
  'homing-projectiles',
  'summons-adds',
  'inflicts-debuffs',
  'high-contact-damage',
  'multi-phase',
  'enrage-mechanic',
  'despawn-leash',
]) // curated taxonomy; extend enum explicitly (Feature A mobility analysis keys off these)
export type AttackPatternTag = z.infer<typeof AttackPatternTag>

export const BossStats = z.strictObject({
  hp: z.int().positive(),
  defense: z.int().nonnegative(),
  contactDamage: z.int().positive().optional(),
})
export type BossStats = z.infer<typeof BossStats>

export const SuggestedEquipment = z.strictObject({
  class: DamageClass,
  weapons: z.array(ItemId).min(1),
  armorSetIds: z.array(Slug),
  accessories: z.array(ItemId),
  buffs: z.array(Slug),
  note: PlainText.optional(),
})
export type SuggestedEquipment = z.infer<typeof SuggestedEquipment>

export const Boss = z.strictObject({
  id: Slug,
  name: PlainText1,
  nodeId: Slug, // 1:1 with node (validated symmetric, §7a-4)
  npcIds: z.array(NpcId).optional(), // multi-part bosses
  wikiUrl: WikiUrl,
  sprite: z.string().optional(),
  stage: Stage,
  worldEvil: WorldEvil.optional(), // ONLY on EoW / BoC
  summon: z.strictObject({
    items: z.array(ItemId),
    conditions: z.array(ConditionSlug),
    text: PlainText1.optional(), // A1: optional
    sourceUrl: WikiUrl.optional(), // A1: optional
  }),
  location: z.strictObject({
    biomes: z.array(PlainText1), // A1: min(1) dropped
    // P2-S6 (A1 principle): optional so an unstated time is emittable as Unknown (absent + listed
    // "location.time") — the wiki states no time rule for e.g. Wall of Flesh or Moon Lord.
    time: z.enum(['day', 'night', 'any', 'dusk']).optional(),
    text: PlainText.optional(),
  }),
  statsByDifficulty: z.strictObject({
    classic: BossStats.optional(),
    expert: BossStats.optional(),
    master: BossStats.optional(),
  }),
  attackPatternTags: z.array(AttackPatternTag).optional(), // curated ⇒ editorialFields (A1 staging)
  dropIds: z.array(z.string()), // DERIVED from DropSource.source.bossId
  suggestedEquipment: z.array(SuggestedEquipment).optional(), // curated ⇒ editorialFields (A1 staging)
  prepChecklist: z
    .array(
      z.strictObject({
        text: PlainText1,
        itemIds: z.array(ItemId).optional(),
        sourceUrl: WikiUrl.optional(),
      }),
    )
    .optional(), // curated ⇒ editorialFields (A1 staging)
  strategies: z
    .array(
      z.strictObject({
        class: DamageClass.optional(),
        difficulty: Difficulty.optional(),
        text: PlainText1,
        sourceUrl: WikiUrl,
      }),
    )
    .optional(), // curated ⇒ editorialFields (A1 staging)
  _prov: Prov,
})
export type Boss = z.infer<typeof Boss>

export const ProgressionNode = z
  .strictObject({
    id: Slug,
    kind: z.enum(['boss', 'event', 'milestone']),
    bossId: Slug.optional(), // REQUIRED iff kind==="boss" (§7a-4)
    name: PlainText1,
    stage: Stage,
    worldEvil: WorldEvil.optional(),
    wikiUrl: WikiUrl,
    _prov: Prov,
  })
  .refine((n) => (n.kind === 'boss') === (n.bossId !== undefined), {
    message: '§7a-4: bossId is present iff kind is "boss"',
    path: ['bossId'],
  })
export type ProgressionNode = z.infer<typeof ProgressionNode>

export const EdgeType = z.enum([
  'required-gate',
  'recommended-next',
  'optional',
  'alternative-route',
  'early-challenge-possible',
])
export type EdgeType = z.infer<typeof EdgeType>

export const ProgressionEdge = z.strictObject({
  from: Slug,
  to: Slug,
  type: EdgeType,
  note: PlainText.optional(),
  sourceUrl: WikiUrl, // per-edge provenance (P2-S6 AC2)
  _prov: Prov,
})
export type ProgressionEdge = z.infer<typeof ProgressionEdge>
