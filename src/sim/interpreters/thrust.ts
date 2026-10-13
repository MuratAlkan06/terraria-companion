/**
 * thrust (PRD P3-S7 AC1): a line toward the aim (latched at use start) that extends to `reachTiles`
 * at mid-use and retracts by the end (triangle profile). Each tick tests the longest extension
 * reached during that tick, so full reach is always tested once per thrust regardless of use time.
 * One hit per dummy per thrust unless multiHit.
 */
import type { ActiveUse, ArchetypeInterpreter, Behavior, KernelApi } from '../contracts'
import { segmentAabbEntry } from '../geometry'

/** Extension fraction at progress p: 0 → 1 (p = 0.5) → 0. */
export const thrustProfile = (p: number): number => 1 - Math.abs(2 * p - 1)

/** Max extension fraction over the progress interval [p0, p1]. */
export function maxExtension(p0: number, p1: number): number {
  return p0 <= 0.5 && p1 >= 0.5 ? 1 : Math.max(thrustProfile(p0), thrustProfile(p1))
}

export const thrust: ArchetypeInterpreter<'thrust'> = {
  archetype: 'thrust',
  requiredFields: [],
  prepare({ weapon, params }) {
    const reach = params.reachTiles
    const behavior: Behavior = {
      archetype: 'thrust',
      baseHitDamage: weapon.damage ?? 0,
      usesAmmo: false,
      approximations: ['melee-once-per-use', 'thrust-geometry'],
      activate() {},
      tickUse(k: KernelApi, use: ActiveUse) {
        const p0 = use.elapsed / use.durationTicks
        const p1 = (use.elapsed + 1) / use.durationTicks
        const len = maxExtension(p0, p1) * reach
        const { x, y } = k.player
        const tipX = x + Math.cos(use.aimAngle) * len
        const tipY = y + Math.sin(use.aimAngle) * len
        for (const dummy of k.dummies) {
          const t = segmentAabbEntry(x, y, tipX, tipY, dummy.box)
          if (t !== null) k.strike(use.melee, dummy, { x: x + (tipX - x) * t, y: y + (tipY - y) * t })
        }
      },
      blade: (use) => ({
        kind: 'thrust',
        angle: use.aimAngle,
        prevAngle: use.aimAngle,
        length: thrustProfile((use.elapsed + 1) / use.durationTicks) * reach,
        prevLength: thrustProfile(use.elapsed / use.durationTicks) * reach,
      }),
    }
    return { ok: true, behavior }
  },
}
