/**
 * Persistence schemas, `tc.v1.*` (ADR D6, DATA_SCHEMA_SPEC §8a; AMENDMENTS-001 A4/A6/A7).
 *
 * `null` is legal ONLY here, meaning a deliberately empty slot/selection. Migration
 * convention (§8b): `migrations[domain][i]` migrates v(i+1) → v(i+2); new field with a
 * default = new version + trivial migration (no silent widening).
 *
 * Note: the P1 storage module (`src/storage/`) still uses its hand-written settings parser;
 * swapping it to `SettingsV1` is a storage-slice change (same shape — see schemas test).
 */
import * as z from 'zod'
import { Difficulty, IsoDateTime, ItemId, Slug, Stage, TypedRef, WorldEvil } from './common'

export const DomainKey = z.enum([
  'builds',
  'favorites',
  'progress',
  'plans',
  'recent',
  'settings',
  'readiness', // Feature A AC4
  'checklists', // A7
])
export type DomainKey = z.infer<typeof DomainKey>

export const envelope = <T extends z.ZodType>(data: T) =>
  z.strictObject({
    v: z.int().positive(),
    savedAt: IsoDateTime,
    gameVersion: z.string(), // mismatch ⇒ advisory banner, not an error
    data,
  })

export const LoadoutClass = z.enum(['melee', 'ranged', 'magic', 'summon', 'hybrid'])
export type LoadoutClass = z.infer<typeof LoadoutClass>
export const Goal = z.enum(['max-damage', 'survivability', 'mobility', 'exploration', 'boss', 'balanced'])
export type Goal = z.infer<typeof Goal>

export const LoadoutSlots = z.strictObject({
  // null = deliberately empty (only legal null)
  mainWeapon: ItemId.nullable(),
  altWeapon: ItemId.nullable(),
  helmet: ItemId.nullable(),
  chest: ItemId.nullable(),
  legs: ItemId.nullable(),
  // A4: slot count = f(difficulty, progression) — Classic 5; Expert 5→6 and Master 6→7 after
  // Demon Heart. The schema only bounds the array; the rule lives in recommendation/UI logic.
  accessories: z.array(ItemId.nullable()).min(5).max(7),
  ammo: z.array(ItemId),
  buffs: z.array(ItemId), // buff-granting ITEMS (potions), not buff slugs
  summon: ItemId.nullable(),
})
export type LoadoutSlots = z.infer<typeof LoadoutSlots>

export const SavedBuildV1 = z.strictObject({
  buildId: z.string().min(8),
  name: z.string().min(1),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  stage: Stage,
  class: LoadoutClass,
  difficulty: Difficulty,
  goal: Goal.optional(),
  slots: LoadoutSlots,
  notes: z.string().optional(),
})
export type SavedBuildV1 = z.infer<typeof SavedBuildV1>
export const BuildsV1 = envelope(z.strictObject({ builds: z.array(SavedBuildV1) }))

/**
 * The loadout builder's slots (src/scoring/recommend.ts SLOT_IDS — the parity is pinned in
 * src/app/buildsStore.test.ts): the units a user can empty, including ammo and potion positions that
 * LoadoutSlots' plain lists cannot address.
 */
export const BuildSlotId = z.enum(['main', 'alt', 'armor', 'acc0', 'acc1', 'acc2', 'acc3', 'acc4', 'acc5', 'acc6', 'ammo0', 'ammo1', 'buff0', 'buff1', 'buff2', 'summon'])
export type BuildSlotId = z.infer<typeof BuildSlotId>

/**
 * AMENDMENTS-016 B106: v2 adds the builder's target boss, the items marked owned, and which empty
 * slots the user emptied. Additive: every new field is optional and absent in v1 data, so a v1 build
 * reads as-is (the v1 → v2 migration is the identity). `emptiedSlots` present = v2 semantics (a null
 * slot not listed was left unfilled by the recommendation); absent = a v1 build, whose nulls keep v1's
 * "deliberately empty" meaning.
 */
export const SavedBuildV2 = z.strictObject({
  ...SavedBuildV1.shape,
  targetBoss: Slug.optional(),
  ownedIds: z.array(ItemId).optional(),
  emptiedSlots: z.array(BuildSlotId).optional(),
})
export type SavedBuildV2 = z.infer<typeof SavedBuildV2>
export const BuildsV2 = envelope(z.strictObject({ builds: z.array(SavedBuildV2) }))

export const ProgressV1 = envelope(
  z.strictObject({
    worldEvil: WorldEvil.nullable(),
    nodeStates: z.record(Slug, z.enum(['defeated', 'skipped'])), // absent = not attempted
  }),
)

export const PlanStepV1 = z.strictObject({
  stepId: z.string(), // deterministic: hash of (kind, refs, amount)
  kind: z.enum(['craft', 'gather', 'defeat-boss', 'purchase', 'fish', 'loot', 'event', 'other']),
  text: z.string().min(1),
  itemId: ItemId.optional(),
  amount: z.int().positive().optional(),
  nodeId: Slug.optional(),
  groupKey: z.string(), // biome/enemy/boss/activity grouping (P6-S6 AC2; A5 enemy biomes)
  refs: z.array(TypedRef),
})
export type PlanStepV1 = z.infer<typeof PlanStepV1>

export const PlanV1 = z.strictObject({
  planId: z.string().min(8),
  targetItemId: ItemId,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  status: z.enum(['active', 'done']),
  stageAtCreation: Stage,
  snapshot: z.strictObject({
    generatedAt: IsoDateTime,
    gameVersion: z.string(),
    steps: z.array(PlanStepV1).min(1),
  }), // regenerable snapshot
  owned: z.record(z.string(), z.int().nonnegative()), // itemId(string) → qty
  checkedStepIds: z.array(z.string()),
})
export type PlanV1 = z.infer<typeof PlanV1>
export const PlansV1 = envelope(z.strictObject({ plans: z.array(PlanV1) }))

export const FavoritesV1 = envelope(z.strictObject({ refs: z.array(TypedRef) }))
export const RecentV1 = envelope(
  z.strictObject({
    entries: z.array(z.strictObject({ ref: TypedRef, viewedAt: IsoDateTime })).max(20),
  }),
)
export const SettingsData = z.strictObject({
  selectedStage: Stage.nullable(),
  spriteFallback: z.boolean(),
  labIgnoreManaDefault: z.boolean(),
})
export const SettingsV1 = envelope(SettingsData)

export const ReadinessV1 = envelope(
  z.strictObject({
    // tc.v1.readiness (Feature A AC4)
    bossId: Slug.nullable(),
    stage: Stage, // A6: deterministic restore; never read from mutable settings
    difficulty: Difficulty,
    class: LoadoutClass,
    loadout: LoadoutSlots,
    analyzedAt: IsoDateTime.nullable(), // analysis recomputed deterministically from inputs
  }),
)

/** A7: `tc.v1.checklists` — key = checklist id (`boss:<slug>:prep`, `guide:<slug>`), value = checked entry ids. */
export const ChecklistsV1 = envelope(z.strictObject({ byKey: z.record(z.string(), z.array(z.string())) }))
