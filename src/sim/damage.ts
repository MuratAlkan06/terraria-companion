/**
 * Damage math — integer-exact, pure (RNG passed in). Order of operations VERIFIED against
 * https://terraria.wiki.gg/wiki/Damage ("variance → armor penetration → defense → critical strike")
 * and https://terraria.wiki.gg/wiki/Defense ("net damage = ⌊attack damage − defense/2⌋", "always be
 * at least 1", no Expert/Master scaling for enemies). Armor penetration: not modeled (no source of
 * it in this slice). Per-difficulty multipliers: out of scope.
 */
import type { DamageClass } from '../schemas'
import { BASE_CRIT_PCT, CRIT_MULTIPLIER, DAMAGE_VARIANCE_PCT, MIN_DAMAGE } from './constants'
import type { Rng } from './rng'

/**
 * Crit chance (percent) for a weapon. VERIFIED (Critical_hit): 4% base for melee/ranged/magic;
 * "Summon damage type cannot normally deal critical hits"; unclassified damage "can never deal
 * critical hits". Capped at 100.
 */
export function critChancePct(damageClass: DamageClass, weaponCritPct: number): number {
  if (damageClass !== 'melee' && damageClass !== 'ranged' && damageClass !== 'magic') return 0
  return Math.min(100, BASE_CRIT_PCT + weaponCritPct)
}

/** Integer n / 100 rounded half-to-even (exact: no float rounding involved). */
export function divideBy100HalfEven(n: number): number {
  const q = Math.floor(n / 100)
  const r = n - q * 100
  if (r > 50) return q + 1
  if (r < 50) return q
  return q % 2 === 0 ? q : q + 1
}

/** `damage × (100 + pct) / 100`, rounded half-to-even (wiki variance rounding). */
export function applyVariancePct(damage: number, pct: number): number {
  return divideBy100HalfEven(damage * (100 + pct))
}

/** VERIFIED enemy defense: ⌊damage − defense/2⌋, minimum 1. Integer-exact for integer inputs. */
export function applyDefense(damage: number, defense: number): number {
  return Math.max(MIN_DAMAGE, Math.floor((2 * damage - defense) / 2))
}

/**
 * The whole percent of a blast's damage a dummy takes `distance` tiles (from the centre to its nearest
 * hitbox point) into a blast of `radius` tiles (P3-S11; README "Param semantics", explosive-aoe). `none` (every stated
 * explosive: "deals N damage to all … in the radius"): 100 anywhere inside. `linear` — a LAB FORMULA,
 * the wiki states no falloff curve for any explosive (approximation `blast-falloff`): 100 at the centre
 * down to 0 at the edge, in whole percent rounded down. Outside the radius: 0.
 */
export function blastKeptPct(distance: number, radius: number, falloff: 'none' | 'linear'): number {
  if (!(distance <= radius)) return 0
  if (falloff === 'none') return 100
  // (R − d) × 100 ÷ R, rounded down; the 1e-9 keeps an exact whole percent from being lost to binary
  // floating point (8 of 10 tiles must keep 20 %, not 19.999… → 19).
  return Math.max(0, Math.min(100, Math.floor(((radius - distance) * 100) / radius + 1e-9)))
}

/** A blast hit's base damage: `damage` × `keptPct` %, rounded down (integer math; 100 % keeps it whole). */
export const blastDamage = (damage: number, keptPct: number): number => Math.floor((damage * keptPct) / 100)

export interface HitRoll {
  amount: number
  crit: boolean
  /** Variance percent applied (0 when variance is off). */
  variancePct: number
}

/**
 * One direct hit. RNG draw order is fixed (variance if enabled, then crit — always drawn) so the
 * stream stays aligned regardless of crit chance.
 */
export function rollHit(rng: Rng, baseDamage: number, defense: number, critPct: number, variance: boolean): HitRoll {
  const variancePct = variance ? rng.int(-DAMAGE_VARIANCE_PCT, DAMAGE_VARIANCE_PCT) : 0
  const varied = variance ? applyVariancePct(baseDamage, variancePct) : baseDamage
  const defended = applyDefense(varied, defense)
  // Terraria-style integer roll: crit when 1..100 ≤ chance.
  const crit = rng.int(1, 100) <= critPct
  return { amount: crit ? defended * CRIT_MULTIPLIER : defended, crit, variancePct }
}
