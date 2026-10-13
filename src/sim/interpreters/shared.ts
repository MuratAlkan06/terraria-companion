/** Helpers shared by projectile-emitting interpreters. */
import type { ProjectileSpec } from '../../schemas'
import type { ApproximationId } from '../approximations'
import { DEFAULT_PROJECTILE_LIFETIME_TICKS, TICKS_PER_SECOND } from '../constants'
import type { KernelApi, ProjectileShape } from '../contracts'
import { angleTo, DEG_TO_RAD } from '../geometry'

/** ProjectileSpec → kernel shape. `pierce` = extra dummies passed through (absent ⇒ 0). */
export function shapeFromSpec(spec: ProjectileSpec | undefined): ProjectileShape {
  return {
    gravity: spec?.gravity ?? false,
    lifetimeTicks: spec?.lifetimeTicks ?? DEFAULT_PROJECTILE_LIFETIME_TICKS,
    pierce: spec?.pierce === 'infinite' ? Infinity : (spec?.pierce ?? 0),
    ...(spec?.spriteKey === undefined ? {} : { spriteKey: spec.spriteKey }),
  }
}

export const tilesPerTick = (tps: number): number => tps / TICKS_PER_SECOND

/**
 * Base damage of a projectile shaped by `spec`: `damage` × `damageMultiplierPct` %, rounded DOWN
 * (AMENDMENTS-010 B48(b)). Rounding down matches the wiki's own figures, e.g. Sapphire Staff "60% of
 * the weapon's damage (10 base damage)" for 18 damage (10.8), Amber Staff "80% … (16 base damage)"
 * for 21 (16.8). Integer math, so no float drift: ⌊damage × pct / 100⌋.
 */
export function projectileDamage(damage: number, spec: ProjectileSpec | undefined): number {
  const pct = spec?.damageMultiplierPct
  return pct === undefined ? damage : Math.floor((damage * pct) / 100)
}

export interface Volley {
  count: number
  spreadDegrees: number
  speedTps: number
  damage: number
  shape: ProjectileShape
}

/**
 * Fires `count` projectiles from the player toward the current aim. count > 1: an even fan across
 * `spreadDegrees`. count === 1 with spread: one seeded random angle within ±spread/2. (`spread`)
 */
export function fireVolley(k: KernelApi, v: Volley): void {
  const base = angleTo(k.player, k.aim)
  const spread = v.spreadDegrees * DEG_TO_RAD
  const speed = tilesPerTick(v.speedTps)
  for (let i = 0; i < v.count; i++) {
    let angle = base
    if (v.count > 1) angle = base - spread / 2 + (spread * i) / (v.count - 1)
    else if (spread > 0) angle = base + (k.rng.next() - 0.5) * spread
    k.spawnProjectile({ x: k.player.x, y: k.player.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, damage: v.damage, ...v.shape })
  }
}

export function volleyApproximations(v: Volley): ApproximationId[] {
  const ids: ApproximationId[] = ['projectile-point', 'projectile-damage', 'projectile-lifetime', 'no-shared-immunity']
  if (v.count > 1 || v.spreadDegrees > 0) ids.push('spread')
  if (v.shape.gravity) ids.push('gravity')
  return ids
}
