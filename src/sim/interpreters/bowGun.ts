/**
 * bow-gun (PRD P3-S4): each activation consumes one ammo and fires `projectilesPerUse` projectiles
 * (even fan across `spreadDegrees`). VERIFIED (wiki Damage): final damage = weapon damage + ammo
 * damage. Speed = (weapon shootSpeedTps + ammo velocityBonusTps) × ammo velocityMultiplier — the
 * order of bonus vs multiplier is a labeled approximation (`ammo`). With `inheritsAmmoProjectile`,
 * the ammo's ProjectileSpec supplies gravity/pierce/lifetime (its `velocityTps` is NOT used for
 * speed — ammo speed enters only through the ammo bonus/multiplier fields).
 */
import { getField, type Item } from '../../schemas'
import type { ArchetypeInterpreter, Behavior, KernelApi } from '../contracts'
import type { SimRefusal } from '../types'
import { fireVolley, shapeFromSpec, volleyApproximations, type Volley } from './shared'

type AmmoResolution =
  | { ok: true; damage: number; velocityBonusTps: number; velocityMultiplier: number; stats: NonNullable<Item['ammoStats']> }
  | { ok: false; refusal: SimRefusal }

export function resolveAmmo(weaponId: number, ammoClass: string, ammo: Item | undefined, needsProjectile: boolean): AmmoResolution {
  if (!ammo) {
    return { ok: false, refusal: { kind: 'invalid-setup', reason: 'ammo-required', message: `Choose ${ammoClass} ammo to fire this weapon.` } }
  }
  const unavailable = (field: string, what: string, state = 'unverified'): AmmoResolution => ({
    ok: false,
    refusal: {
      kind: 'not-simulable',
      reason: 'dependency-data-unavailable',
      message: `${ammo.name}: ${what} is ${state}, so this ammo can't be simulated.`,
      weaponId,
      fields: [`ammo.${field}`],
    },
  })
  const statsField = getField(ammo, 'ammoStats')
  if (statsField.status === 'unverified') return unavailable('ammoStats', 'its ammo data')
  const stats = ammo.ammoStats
  if (!stats) {
    return { ok: false, refusal: { kind: 'invalid-setup', reason: 'ammo-incompatible', message: `${ammo.name} is not ammunition.`, fields: ['ammo'] } }
  }
  if (stats.ammoClass !== ammoClass) {
    return {
      ok: false,
      refusal: {
        kind: 'invalid-setup',
        reason: 'ammo-incompatible',
        message: `${ammo.name} (${stats.ammoClass}) doesn't fit this weapon (needs ${ammoClass}).`,
        fields: ['ammo.ammoStats.ammoClass'],
      },
    }
  }
  for (const field of ['damage', 'velocityBonusTps', 'velocityMultiplier', ...(needsProjectile ? ['projectile'] : [])]) {
    if (getField(ammo, `ammoStats.${field}`).status === 'unverified') return unavailable(`ammoStats.${field}`, `its ${field}`)
  }
  // P2-S7 made ammo damage optional (e.g. Gel carries none): never assume 0 — refuse.
  if (stats.damage === undefined) return unavailable('ammoStats.damage', 'its damage', 'missing')
  return { ok: true, damage: stats.damage, velocityBonusTps: stats.velocityBonusTps ?? 0, velocityMultiplier: stats.velocityMultiplier ?? 1, stats }
}

export const bowGun: ArchetypeInterpreter<'bow-gun'> = {
  archetype: 'bow-gun',
  requiredFields: ['shootSpeedTps'],
  prepare({ weapon, params, ammo }) {
    if (weapon.ammoClass !== undefined && weapon.ammoClass !== params.ammoClass) {
      return {
        ok: false,
        refusal: {
          kind: 'not-simulable',
          reason: 'invalid-data',
          message: `Weapon ammo class "${weapon.ammoClass}" contradicts its Lab ammo class "${params.ammoClass}".`,
          weaponId: weapon.id,
          fields: ['ammoClass', 'labBehavior.params.ammoClass'],
        },
      }
    }
    const resolved = resolveAmmo(weapon.id, params.ammoClass, ammo, params.inheritsAmmoProjectile)
    if (!resolved.ok) return resolved
    const speedTps = ((weapon.shootSpeedTps ?? 0) + resolved.velocityBonusTps) * resolved.velocityMultiplier
    if (!(speedTps > 0)) {
      return {
        ok: false,
        refusal: {
          kind: 'not-simulable',
          reason: 'invalid-data',
          message: 'Weapon + ammo projectile speed is not positive.',
          weaponId: weapon.id,
          fields: ['shootSpeedTps', 'ammo.ammoStats.velocityBonusTps', 'ammo.ammoStats.velocityMultiplier'],
        },
      }
    }
    const damage = (weapon.damage ?? 0) + resolved.damage
    const volley: Volley = {
      count: params.projectilesPerUse,
      spreadDegrees: params.spreadDegrees,
      speedTps,
      damage,
      shape: shapeFromSpec(params.inheritsAmmoProjectile ? resolved.stats.projectile : undefined),
    }
    const behavior: Behavior = {
      archetype: 'bow-gun',
      baseHitDamage: damage,
      usesAmmo: true,
      approximations: ['ammo', ...volleyApproximations(volley)],
      activate(k: KernelApi) {
        k.consumeAmmo(1)
        fireVolley(k, volley)
      },
    }
    return { ok: true, behavior }
  },
}
