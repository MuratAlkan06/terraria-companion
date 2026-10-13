/**
 * Buff, Condition registry (DATA_SCHEMA_SPEC §2.9) and Enemy (AMENDMENTS-001 A5).
 */
import * as z from 'zod'
import { PlainText1, Slug, Stage, WikiUrl } from './common'
import { StatEffect } from './item'
import { Prov } from './prov'

export const Buff = z.strictObject({
  id: Slug,
  gameBuffId: z.int().positive().optional(), // TO-VERIFY-IN-P2
  name: PlainText1,
  isDebuff: z.boolean(),
  effects: z.array(StatEffect),
  dot: z.strictObject({ dps: z.number().positive() }).optional(), // iff damaging debuff
  sprite: z.string().optional(),
  wikiUrl: WikiUrl,
  _prov: Prov,
})
export type Buff = z.infer<typeof Buff>

export const Condition = z.strictObject({
  // conditions.json registry
  id: Slug, // "hardmode", "post-plantera", "blood-moon", "near-water"…
  name: PlainText1,
  kind: z.enum(['world-state', 'event', 'biome', 'environment', 'time']),
  satisfiedByNode: Slug.optional(), // hardmode ⇐ node "wall-of-flesh" — makes gating derivation pure
  description: PlainText1,
  wikiUrl: WikiUrl,
  _prov: Prov,
})
export type Condition = z.infer<typeof Condition>

/** A5: minimal Enemy entity — route `/enemies/:id`, SearchDoc type "enemy", TypedRef `enemy:<slug>`. */
export const Enemy = z.strictObject({
  id: Slug,
  npcIds: z.array(z.int().positive()).optional(),
  name: PlainText1,
  sprite: z.string().optional(),
  biomes: z.array(PlainText1).optional(), // unverified if unstructured on wiki
  stage: Stage.optional(),
  dropIds: z.array(z.string()), // DERIVED from DropSource
  wikiUrl: WikiUrl,
  _prov: Prov,
})
export type Enemy = z.infer<typeof Enemy>
