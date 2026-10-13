/**
 * Weapon + Weapon Lab behavior (DATA_SCHEMA_SPEC §2.4, amended by AMENDMENTS-001 A1).
 *
 * 9 archetype arms; homing is a cross-cutting modifier (`LabModifiers.homing`), not a 10th
 * arm (orchestrator ruling, spec header). Core combat numbers live on the Weapon, NOT in
 * archetype params — the sim reads both; params describe only shape/behavior.
 */
import * as z from 'zod'
import { AmmoClass, DamageClass, ItemId, PlainText, PlainText1, Slug, WikiUrl } from './common'
import { AmmoStats, DurationTicks, itemCommon, ProjectileSpec } from './item'
import { Prov } from './prov'

// Cross-cutting modifiers (bounce, chain, DoT/debuff, multi-hit, homing per P3-S8)
export const LabModifiers = z.strictObject({
  bounce: z
    .strictObject({ count: z.int().positive(), speedRetention: z.number().gt(0).lte(1) })
    .optional(),
  chain: z.strictObject({ maxTargets: z.int().min(2), rangeTiles: z.number().positive() }).optional(),
  dot: z
    .strictObject({
      buffId: Slug,
      chancePct: z.int().min(1).max(100).optional(),
      durationTicks: DurationTicks, // AMENDMENTS-002 B5: fixed or {minTicks, maxTicks}
    })
    .optional(), // dps lives on the Buff
  multiHit: z.strictObject({ localImmunityTicks: z.int().positive() }).optional(),
  homing: z
    .strictObject({
      strength: z.number().gt(0).lte(1),
      acquisitionRangeTiles: z.number().positive(),
    })
    .optional(),
})
export type LabModifiers = z.infer<typeof LabModifiers>

/** §7a-12 conditional refinement message: `field` must be present exactly when `rule` holds. */
const iff = (field: string, rule: string) => ({ message: `§7a-12: ${field} is present iff ${rule}`, path: [field] })

export const ArchetypeParams = z.discriminatedUnion('archetype', [
  z.strictObject({
    archetype: z.literal('swing-melee'),
    arcDegrees: z.number().gt(0).lte(360),
    reachTiles: z.number().positive(),
    emitted: ProjectileSpec.optional(),
  }),
  z.strictObject({ archetype: z.literal('thrust'), reachTiles: z.number().positive() }),
  z.strictObject({
    archetype: z.literal('returning'),
    variant: z.enum(['boomerang', 'flail', 'yoyo']),
    throwRangeTiles: z.number().positive(),
    returnMode: z.enum(['auto-return', 'manual-recall', 'tethered']),
    control: z.enum(['fire-and-forget', 'cursor-follow']),
    hitsPerPass: z.int().positive().optional(),
  }),
  z.strictObject({
    archetype: z.literal('bow-gun'),
    ammoClass: AmmoClass,
    projectilesPerUse: z.int().positive(),
    spreadDegrees: z.number().min(0),
    inheritsAmmoProjectile: z.boolean(),
  }),
  z.strictObject({
    archetype: z.literal('magic-bolt'),
    projectilesPerUse: z.int().positive(),
    spreadDegrees: z.number().min(0),
    projectile: ProjectileSpec,
  }),
  z
    .strictObject({
      archetype: z.literal('piercing-beam'),
      mode: z.enum(['pierce-projectile', 'channel-beam']),
      pierce: z.union([z.int().positive(), z.literal('infinite')]).optional(), // iff pierce-projectile
      tickRateTicks: z.int().positive().optional(), // iff channel-beam
      projectile: ProjectileSpec.optional(),
    })
    .refine((p) => (p.mode === 'pierce-projectile') === (p.pierce !== undefined), iff('pierce', 'mode is "pierce-projectile"'))
    .refine((p) => (p.mode === 'channel-beam') === (p.tickRateTicks !== undefined), iff('tickRateTicks', 'mode is "channel-beam"')),
  z
    .strictObject({
      archetype: z.literal('minion-sentry'),
      variant: z.enum(['minion', 'sentry']),
      slotCost: z.number().positive(),
      aiClass: z.enum(['melee-contact', 'ranged-shot', 'hover-strike', 'ground-melee']),
      attackRateTicks: z.int().positive(),
      projectile: ProjectileSpec.optional(),
      sentryRangeTiles: z.number().positive().optional(), // iff sentry
    })
    .refine((p) => (p.variant === 'sentry') === (p.sentryRangeTiles !== undefined), iff('sentryRangeTiles', 'variant is "sentry"')),
  z.strictObject({
    archetype: z.literal('whip'),
    arcDegrees: z.number().gt(0).lte(360),
    rangeTiles: z.number().positive(),
    tagDamageFlat: z.int().nonnegative(),
    tagCritPct: z.int().min(0).max(100).optional(),
    falloffPerTarget: z.number().min(0).lt(1).optional(),
  }),
  z
    .strictObject({
      archetype: z.literal('explosive-aoe'),
      blastRadiusTiles: z.number().positive(),
      trigger: z.enum(['impact', 'timed']),
      fuseTicks: z.int().positive().optional(), // iff timed
      selfKnockback: z.boolean().optional(),
      falloff: z.enum(['none', 'linear']),
    })
    .refine((p) => (p.trigger === 'timed') === (p.fuseTicks !== undefined), iff('fuseTicks', 'trigger is "timed"')),
])
export type ArchetypeParams = z.infer<typeof ArchetypeParams>
export type Archetype = ArchetypeParams['archetype']

export const LabBehavior = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('archetype'),
    params: ArchetypeParams,
    modifiers: LabModifiers.optional(),
  }),
  z.strictObject({ kind: z.literal('custom-scenario'), scenarioId: Slug, note: PlainText.optional() }),
  z.strictObject({
    kind: z.literal('limitation'), // P3-S13 AC3 shape
    inGameBehavior: PlainText1,
    reason: PlainText1,
    sourceUrl: WikiUrl,
  }),
])
export type LabBehavior = z.infer<typeof LabBehavior>

export const Weapon = z.strictObject({
  ...itemCommon,
  type: z.literal('weapon'),
  // A1: extracted combat stats are OPTIONAL — absent + listed in _prov.unverifiedFields = Unknown.
  // Unknown damageClass ⇒ "unclassified" filter bucket, excluded from class-based recommendations.
  damageClass: DamageClass.optional(),
  damage: z.int().nonnegative().optional(),
  critPct: z.int().min(0).max(100).optional(), // weapon bonus; sim adds universal base 4% (sim-core constant, labeled)
  useTimeTicks: z.int().positive().optional(),
  useAnimationTicks: z.int().positive().optional(), // attacksPerSec = 60/useAnimationTicks — TO-VERIFY-IN-P2
  // AMENDMENTS-010 B48(a): Iteminfo `reuseDelay` — a cooldown after each use (wiki Use time: "reuseDelay
  // is applied after the itemAnimation counter turns to zero"); absent = no cooldown.
  reuseDelayTicks: z.int().positive().optional(),
  knockback: z.number().nonnegative().optional(),
  autoReuse: z.boolean().optional(),
  manaCost: z.int().positive().optional(),
  ammoClass: AmmoClass.optional(),
  shootSpeedTps: z.number().positive().optional(),
  // P2-S7: a weapon that is also ammo (Snowball → Snowball Cannon) carries its ammo stats here; one
  // game item ID lives in exactly one collection (§3), so it cannot also be an Item record.
  ammoStats: AmmoStats.optional(),
  behaviorText: PlainText.optional(),
  labBehavior: LabBehavior, // MANDATORY — zero unhandled weapons (P3-S13)
})
export type Weapon = z.infer<typeof Weapon>

export const CustomScenario = z.strictObject({
  // overlay → lab-scenarios.json
  id: Slug,
  name: PlainText1,
  description: PlainText1, // explains the special setup in-UI (P3-S13 AC2)
  weaponIds: z.array(ItemId).min(1),
  sourceUrl: WikiUrl,
  _prov: Prov,
})
export type CustomScenario = z.infer<typeof CustomScenario>

/**
 * Weapon fields the Lab sim reads for an archetype (§2.1 rule 3; spec note "the sim reads
 * both" core numbers and params). If any of these — or any `labBehavior.*` path — is listed
 * in `_prov.unverifiedFields`, the pipeline downgrades `labBehavior` to a limitation so the
 * sim never consumes an unknown.
 * AMENDMENTS-008 B36: `useAnimationTicks` is the attack cadence (AMENDMENTS-004 B14), and
 * `autoReuse` changes the cadence of melee-class weapons (autoswing melee attacks one tick
 * sooner — src/sim/README.md "Cadence"), so it is required for the melee archetypes.
 * AMENDMENTS-010 B48(a): `reuseDelayTicks` is part of the cadence too (a cooldown after each use).
 */
const SIM_FIELDS_ALL_ARCHETYPES = ['damageClass', 'damage', 'critPct', 'useTimeTicks', 'useAnimationTicks', 'reuseDelayTicks', 'knockback', 'manaCost'] as const
const SIM_FIELDS_BY_ARCHETYPE: Partial<Record<Archetype, readonly string[]>> = {
  'swing-melee': ['autoReuse'],
  thrust: ['autoReuse'],
  returning: ['autoReuse'],
  'bow-gun': ['ammoClass', 'shootSpeedTps'],
}
export function simRequiredWeaponFields(archetype: Archetype): readonly string[] {
  return [...SIM_FIELDS_ALL_ARCHETYPES, ...(SIM_FIELDS_BY_ARCHETYPE[archetype] ?? [])]
}

/**
 * Lab MODELING CONVENTIONS (AMENDMENTS-010 B44 / B46 / B47; record marker B49). Archetype params the
 * wiki does not state, derived by a ratified rule and always labeled as modeled — never presented as
 * game data. A weapon lists every param it took from a convention in `_prov.modeledFields`; each listed
 * path resolves here (archetype + path) to exactly one convention and its ruling. `always`: the
 * archetype has no other source for these paths, so every record of that archetype lists them
 * (not thrust since AMENDMENTS-012 B56: a range the article states is used as the reach).
 * The derivations live in pipeline/merge/labParams.ts; the user-facing labels in the sim's
 * approximations registry (src/sim/approximations.ts) and the Lab UI.
 */
export interface ModelingConvention {
  id: 'swing-geometry' | 'thrust-reach' | 'slight-spread'
  /** The binding ruling that ratified the convention. */
  ruling: 'AMENDMENTS-010 B44' | 'AMENDMENTS-010 B46' | 'AMENDMENTS-010 B47'
  archetype: Archetype
  paths: readonly string[]
  always: boolean
  /** Plain-language rule (reports). */
  rule: string
}

export const MODELING_CONVENTIONS: readonly ModelingConvention[] = [
  {
    id: 'swing-geometry',
    ruling: 'AMENDMENTS-010 B44',
    archetype: 'swing-melee',
    paths: ['labBehavior.params.arcDegrees', 'labBehavior.params.reachTiles'],
    always: true,
    rule: 'arc 180° (broadswords are swung over the head); reach = item sprite diagonal × item scale ÷ 16 px',
  },
  {
    id: 'thrust-reach',
    ruling: 'AMENDMENTS-010 B46',
    archetype: 'thrust',
    paths: ['labBehavior.params.reachTiles'],
    // AMENDMENTS-012 B56: a range the article states is the reach (wiki data, not modeled); B46 only where none is stated
    always: false,
    rule: 'reach = item sprite diagonal × item scale ÷ 16 px + 1 tile arm extension, only where the article states no range (AMENDMENTS-012 B56)',
  },
  {
    id: 'slight-spread',
    ruling: 'AMENDMENTS-010 B47',
    archetype: 'bow-gun',
    paths: ['labBehavior.params.spreadDegrees'],
    always: false,
    rule: 'a gun whose article says it fires at a "slight" / "small" spread without an angle uses a 10° spread',
  },
]

/** The convention governing `path` for an archetype, if any (B49 modeledFields resolution). */
export function modelingConventionFor(archetype: Archetype, path: string): ModelingConvention | undefined {
  return MODELING_CONVENTIONS.find((c) => c.archetype === archetype && c.paths.includes(path))
}
