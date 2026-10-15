/**
 * swing-melee (PRD P3-S1): a blade line of `reachTiles` sweeps `arcDegrees` over one use, centered
 * on the facing direction, from up-front to down-front (Terraria broadswords swing relative to
 * facing, not the cursor). Hit detection: each tick the swept sector is sampled with sub-steps so
 * the blade tip moves ≤ SWING_MAX_TIP_STEP_TILES between samples; each sample is an exact
 * segment-vs-AABB test. One hit per dummy per swing (use-scoped immunity) unless multiHit.
 * Optional `emitted` projectile fires toward the aim on every activation (e.g. sword beams), dealing
 * the weapon damage × its `damageMultiplierPct` when the wiki states one.
 */
import { SWING_MAX_TIP_STEP_TILES } from '../constants'
import type { ActiveUse, ArchetypeInterpreter, Behavior, KernelApi } from '../contracts'
import { DEG_TO_RAD, segmentAabbEntry } from '../geometry'
import { cos, sin } from '../trig'
import type { BladePose } from '../types'
import { fireVolley, projectileDamage, shapeFromSpec, volleyApproximations, type Volley } from './shared'

/** Blade angle at swing progress p ∈ [0, 1]. Facing right: −arc/2 (up) → +arc/2 (down). */
export function swingAngle(facing: 1 | -1, arcRad: number, p: number): number {
  const center = facing === 1 ? 0 : Math.PI
  return center - (facing * arcRad) / 2 + facing * arcRad * p
}

export const swingMelee: ArchetypeInterpreter<'swing-melee'> = {
  archetype: 'swing-melee',
  requiredFields: [],
  prepare({ weapon, params }) {
    const arcRad = params.arcDegrees * DEG_TO_RAD
    const reach = params.reachTiles
    const damage = weapon.damage ?? 0
    const volley: Volley | null = params.emitted
      ? { count: 1, spreadDegrees: 0, speedTps: params.emitted.velocityTps, damage: projectileDamage(damage, params.emitted), shape: shapeFromSpec(params.emitted) }
      : null

    const pose = (use: ActiveUse): BladePose => ({
      kind: 'swing',
      angle: swingAngle(use.facing, arcRad, (use.elapsed + 1) / use.durationTicks),
      prevAngle: swingAngle(use.facing, arcRad, use.elapsed / use.durationTicks),
      length: reach,
      prevLength: reach,
      arcDegrees: params.arcDegrees,
    })

    const behavior: Behavior = {
      archetype: 'swing-melee',
      baseHitDamage: damage,
      usesAmmo: false,
      approximations: ['melee-once-per-use', 'swing-geometry', ...(volley ? volleyApproximations(volley) : [])],
      activate(k: KernelApi) {
        if (volley) fireVolley(k, volley)
      },
      tickUse(k: KernelApi, use: ActiveUse) {
        const a0 = swingAngle(use.facing, arcRad, use.elapsed / use.durationTicks)
        const a1 = swingAngle(use.facing, arcRad, (use.elapsed + 1) / use.durationTicks)
        const steps = Math.max(1, Math.ceil((Math.abs(a1 - a0) * reach) / SWING_MAX_TIP_STEP_TILES))
        const { x, y } = k.player
        for (let j = 0; j <= steps; j++) {
          const a = a0 + ((a1 - a0) * j) / steps
          const tipX = x + cos(a) * reach
          const tipY = y + sin(a) * reach
          for (const dummy of k.dummies) {
            const t = segmentAabbEntry(x, y, tipX, tipY, dummy.box)
            if (t !== null) k.strike(use.melee, dummy, { x: x + (tipX - x) * t, y: y + (tipY - y) * t })
          }
        }
      },
      blade: pose,
    }
    return { ok: true, behavior }
  },
}
