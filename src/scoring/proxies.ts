/**
 * Sim-free proxies (SCORING_SPEC §2.2, §2.3, §7 `proxies.ts`): the damage-potential proxy DPP, the
 * stat-effect scope rule, per-class stat totals and STAT_POINTS component points. Pure TypeScript;
 * every record field is read through getField (verified-or-Unknown), never defaulted.
 */
import type { DamageClass, StatEffect, StatKind, Weapon } from '../schemas'
import { getField } from '../schemas/getField'
import { BASE_CRIT_PCT, STAT_POINTS, TICKS_PER_SECOND, type StatPointsRow } from './constants'

/** A loadout class (DATA_SCHEMA_SPEC §8a LoadoutClass); "hybrid" matches every class. */
export type ClassChoice = DamageClass | 'hybrid'

/** A record whose field read is verified or curated — the only values scoring consumes. */
function known<T>(record: unknown, path: string): { ok: true; value: T } | { ok: false; status: 'unverified' | 'not-applicable' } {
  const view = getField(record, path)
  if (view.status === 'verified' || view.status === 'editorial') return { ok: true, value: view.value as T }
  return { ok: false, status: view.status }
}

// --- §2.3 scope rule --------------------------------------------------------------------------------

export const statRow = (stat: StatKind): StatPointsRow => STAT_POINTS[stat]

/** The class an effect is limited to: its own scope, else the kind's implied scope (§2.3), else none (all classes). */
export function effectScope(effect: StatEffect): DamageClass | undefined {
  if (effect.kind !== 'stat') return undefined
  return effect.scope ?? statRow(effect.stat).impliedScope
}

/** §2.3: an effect counts for class C iff it has no scope or its scope is C; hybrid matches every class. */
export function appliesTo(effect: StatEffect, cls: ClassChoice): boolean {
  const scope = effectScope(effect)
  return scope === undefined || cls === 'hybrid' || scope === cls
}

/** Σ value of one stat kind over the effects that count for `cls`. */
export function statTotal(effects: readonly StatEffect[], stat: StatKind, cls: ClassChoice): number {
  let total = 0
  for (const e of effects) if (e.kind === 'stat' && e.stat === stat && appliesTo(e, cls)) total += e.value
  return total
}

// --- §2.3 component points ---------------------------------------------------------------------------

export interface Points {
  off: number
  def: number
  mob: number
  surv: number
}

export const ZERO_POINTS: Points = { off: 0, def: 0, mob: 0, surv: 0 }

export const sumPoints = (p: Points): number => p.off + p.def + p.mob + p.surv
export const addPoints = (a: Points, b: Points): Points => ({ off: a.off + b.off, def: a.def + b.def, mob: a.mob + b.mob, surv: a.surv + b.surv })

/**
 * The points one stat effect is worth for class `cls` (STAT_POINTS v1), whether or not it applies to
 * that class — callers decide matched vs mismatched with `appliesTo`. Specials and uncounted kinds
 * score 0; crit scores 0 for summon (B17); a reduction kind scores per unit of reduction.
 */
export function effectPoints(effect: StatEffect, cls: ClassChoice): Points {
  if (effect.kind !== 'stat') return ZERO_POINTS
  const row = statRow(effect.stat)
  if (row.uncounted) return ZERO_POINTS
  if (effect.stat === 'crit-pct' && cls === 'summon') return ZERO_POINTS
  const units = row.perReduction ? -effect.value : effect.value
  return { off: (row.off ?? 0) * units, def: (row.def ?? 0) * units, mob: (row.mob ?? 0) * units, surv: (row.surv ?? 0) * units }
}

/** The points of the effects that count for `cls` (class-relevant points, §4.4 "componentPts"). */
export function applicablePoints(effects: readonly StatEffect[], cls: ClassChoice): Points {
  let total = ZERO_POINTS
  for (const e of effects) if (appliesTo(e, cls)) total = addPoints(total, effectPoints(e, cls))
  return total
}

// --- §2.2 damage-potential proxy ----------------------------------------------------------------------

export interface WeaponProfile {
  ok: true
  damageClass: DamageClass
  damage: number
  /** The weapon's own crit bonus; 0 where crit doesn't apply (summon, classless — B17/B85(b)). */
  critPct: number
  /** Crit can't happen for this class (summon, classless): critFactor is 1. */
  critApplies: boolean
  cadenceTicks: number
  activationsPerUse: number
  hitsPerSec: number
  ammoClass?: string
}

export interface WeaponProfileMissing {
  ok: false
  /** Required (or blocking optional) fields that read Unknown, in §2.2 order. */
  missing: string[]
}

/**
 * The fields DPP needs (§2.2): damageClass, damage, useTimeTicks, useAnimationTicks, plus critPct for
 * melee / ranged / magic. Optional: autoReuse (absent = false), reuseDelayTicks (absent = 0),
 * ammoClass — any of them Unknown blocks the weapon (never defaulted).
 */
export function weaponProfile(w: Weapon): WeaponProfile | WeaponProfileMissing {
  const missing: string[] = []
  const damageClass = known<DamageClass>(w, 'damageClass')
  const damage = known<number>(w, 'damage')
  const useTime = known<number>(w, 'useTimeTicks')
  const useAnimation = known<number>(w, 'useAnimationTicks')
  if (!damageClass.ok) missing.push('damageClass')
  if (!damage.ok) missing.push('damage')
  if (!useTime.ok) missing.push('useTimeTicks')
  if (!useAnimation.ok) missing.push('useAnimationTicks')
  const cls = damageClass.ok ? damageClass.value : undefined
  const critApplies = cls === 'melee' || cls === 'ranged' || cls === 'magic'
  const crit = critApplies ? known<number>(w, 'critPct') : undefined
  if (crit && !crit.ok) missing.push('critPct')
  const autoReuse = getField(w, 'autoReuse')
  const reuseDelay = getField(w, 'reuseDelayTicks')
  const ammoClass = getField(w, 'ammoClass')
  if (autoReuse.status === 'unverified') missing.push('autoReuse')
  if (reuseDelay.status === 'unverified') missing.push('reuseDelayTicks')
  if (ammoClass.status === 'unverified') missing.push('ammoClass')
  if (missing.length > 0 || !damageClass.ok || !damage.ok || !useTime.ok || !useAnimation.ok) return { ok: false, missing }

  const melee = damageClass.value === 'melee'
  const auto = autoReuse.status === 'verified' || autoReuse.status === 'editorial' ? autoReuse.value === true : false
  const delay = reuseDelay.status === 'verified' || reuseDelay.status === 'editorial' ? (reuseDelay.value as number) : 0
  // §2.2 + B14 + autoswing + B48(a)
  const cadenceTicks = useAnimation.value - (melee && auto ? 1 : 0) + delay
  const multiShot = (damageClass.value === 'ranged' || damageClass.value === 'magic') && useTime.value < useAnimation.value
  const activationsPerUse = multiShot ? Math.ceil(useAnimation.value / useTime.value) : 1
  return {
    ok: true,
    damageClass: damageClass.value,
    damage: damage.value,
    critPct: crit?.ok ? crit.value : 0,
    critApplies,
    cadenceTicks,
    activationsPerUse,
    hitsPerSec: (activationsPerUse * TICKS_PER_SECOND) / cadenceTicks,
    ...(ammoClass.status === 'verified' || ammoClass.status === 'editorial' ? { ammoClass: ammoClass.value as string } : {}),
  }
}

/** §2.2 critFactor = 1 + (4 + critPct)/100 for classes that crit; 1 for summon and classless. */
export const critFactor = (profile: WeaponProfile): number => (profile.critApplies ? 1 + (BASE_CRIT_PCT + profile.critPct) / 100 : 1)

/** §2.2 DPP = perHit × hitsPerSec × critFactor (unrounded, labeled "est."). `ammoDamage` only when ammo is in context. */
export function damagePotential(profile: WeaponProfile, ammoDamage = 0): number {
  return (profile.damage + ammoDamage) * profile.hitsPerSec * critFactor(profile)
}

/** A weapon that summons minions or sentries: its cast rate is not its damage rate (§4.5 — not estimated). */
export const isSummonStaff = (w: Pick<Weapon, 'tags'>): boolean => w.tags.includes('minion-summon-items') || w.tags.includes('sentry-summon-items')
