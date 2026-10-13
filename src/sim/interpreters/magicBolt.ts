/**
 * magic-bolt (PRD P3-S5): each activation fires `projectilesPerUse` projectiles shaped by the
 * archetype's ProjectileSpec (speed = `projectile.velocityTps`). Mana is a kernel concern: the
 * cost (`weapon.manaCost`, required here) is paid at use start and gates casting per settings.
 */
import type { ArchetypeInterpreter, Behavior, KernelApi } from '../contracts'
import { fireVolley, shapeFromSpec, volleyApproximations, type Volley } from './shared'

export const magicBolt: ArchetypeInterpreter<'magic-bolt'> = {
  archetype: 'magic-bolt',
  requiredFields: ['manaCost'],
  prepare({ weapon, params }) {
    const damage = weapon.damage ?? 0
    const volley: Volley = {
      count: params.projectilesPerUse,
      spreadDegrees: params.spreadDegrees,
      speedTps: params.projectile.velocityTps,
      damage,
      shape: shapeFromSpec(params.projectile),
    }
    const behavior: Behavior = {
      archetype: 'magic-bolt',
      baseHitDamage: damage,
      usesAmmo: false,
      approximations: volleyApproximations(volley),
      activate(k: KernelApi) {
        fireVolley(k, volley)
      },
    }
    return { ok: true, behavior }
  },
}
