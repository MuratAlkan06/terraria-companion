/**
 * whip (PRD P3-S10 AC1–AC3). A line of `rangeTiles` (the wiki Whips list table "Range (tiles)")
 * sweeps `arcDegrees` once per use, centred in front of the player like a broadsword (B63 P-1: 180°
 * forward, the B44 "swung overhead" basis — `swingAngle`), sampled as the swing-melee sweep is. Each
 * dummy is hit at most once per swing.
 *
 * - Multihit penalty — VERIFIED (wiki Whips, rev 1033416): "damage dealt will be reduced by a fixed
 *   percentage on each consecutive hit, with this percentage being based on the current damage of the
 *   whip rather than its initial damage. The damage dealt after all calculations is rounded down,
 *   meaning a whip will deal no damage after piercing enough enemies." The n-th dummy a swing hits
 *   (0-based) takes the base damage kept n times, each step rounded down (`whipHitDamage`, integer
 *   basis points — the penalties are whole percentages); a dummy it would deal 0 to is not hit (and
 *   not tagged). Order within one sample: dummy index (nearest first).
 * - Tag — VERIFIED (same page): "All whips inflict a special tag effect on struck enemies for 4
 *   seconds"; tag damage is "added to the damage dealt" by minions and sentries; tag critical strike
 *   chance is "the only way summons can deal critical hits"; "The last enemy hit by a whip will be
 *   targeted by the player's minions and sentries". Each landed hit tags the dummy for
 *   WHIP_TAG_DURATION_TICKS (`KernelApi.tagDummy`, which also sets the summons' focus); the kernel adds
 *   the tag to summon hits (world.ts `strike`). One whip, one tag: whip stacking is not modeled.
 * - Whip hits are the weapon's own (`melee`, `use:<n>`) and never crit: whips are summon damage (B17).
 *   Homing means nothing to a whip: refused (`modifier-not-implemented`), never ignored.
 */
import { SWING_MAX_TIP_STEP_TILES, WHIP_TAG_DURATION_TICKS } from '../constants'
import type { ActiveUse, ArchetypeInterpreter, Behavior, KernelApi, PrepareResult, WhipTag } from '../contracts'
import { DEG_TO_RAD, segmentAabbEntry } from '../geometry'
import { cos, sin } from '../trig'
import type { BladePose } from '../types'
import { swingAngle } from './swingMelee'

const BASIS = 10_000

/**
 * Base damage of the `n`-th dummy (0-based) one swing hits: `damage` reduced by `falloffPerTarget`
 * n times, each step rounded down (wiki Whips "Multihit penalty"). Integer math in basis points, so
 * a 0.05 penalty is exactly 95% kept (no float drift).
 */
export function whipHitDamage(damage: number, falloffPerTarget: number | undefined, n: number): number {
  if (!falloffPerTarget) return damage
  const kept = Math.round((1 - falloffPerTarget) * BASIS)
  let d = damage
  for (let i = 0; i < n; i++) d = Math.floor((d * kept) / BASIS)
  return d
}

export const whip: ArchetypeInterpreter<'whip'> = {
  archetype: 'whip',
  requiredFields: [],
  prepare({ weapon, params }): PrepareResult {
    const modifiers = weapon.labBehavior.kind === 'archetype' ? weapon.labBehavior.modifiers : undefined
    if (modifiers?.homing) {
      return {
        ok: false,
        refusal: { kind: 'not-simulable', reason: 'modifier-not-implemented', message: 'A whip doesn’t home; homing on it isn’t simulated by the Weapon Lab.', weaponId: weapon.id, fields: ['labBehavior.modifiers.homing'], archetype: 'whip' },
      }
    }
    const arcRad = params.arcDegrees * DEG_TO_RAD
    const range = params.rangeTiles
    const damage = weapon.damage ?? 0
    const tag: WhipTag = { damageFlat: params.tagDamageFlat, critPct: params.tagCritPct ?? null, durationTicks: WHIP_TAG_DURATION_TICKS }
    // Hits landed by each swing so far (keyed by the use: per-world, per-use state; never shared).
    const landed = new WeakMap<ActiveUse, number>()

    const pose = (use: ActiveUse): BladePose => ({
      kind: 'whip',
      angle: swingAngle(use.facing, arcRad, (use.elapsed + 1) / use.durationTicks),
      prevAngle: swingAngle(use.facing, arcRad, use.elapsed / use.durationTicks),
      length: range,
      prevLength: range,
      arcDegrees: params.arcDegrees,
    })

    const behavior: Behavior = {
      archetype: 'whip',
      baseHitDamage: damage,
      usesAmmo: false,
      approximations: ['whip-swing', 'whip-tag'],
      activate() {},
      tickUse(k: KernelApi, use: ActiveUse) {
        const a0 = swingAngle(use.facing, arcRad, use.elapsed / use.durationTicks)
        const a1 = swingAngle(use.facing, arcRad, (use.elapsed + 1) / use.durationTicks)
        const steps = Math.max(1, Math.ceil((Math.abs(a1 - a0) * range) / SWING_MAX_TIP_STEP_TILES))
        const { x, y } = k.player
        for (let j = 0; j <= steps; j++) {
          const a = a0 + ((a1 - a0) * j) / steps
          const tipX = x + cos(a) * range
          const tipY = y + sin(a) * range
          for (const dummy of k.dummies) {
            const t = segmentAabbEntry(x, y, tipX, tipY, dummy.box)
            if (t === null) continue
            const n = landed.get(use) ?? 0
            const hit = whipHitDamage(damage, params.falloffPerTarget, n)
            if (hit <= 0) continue // "a whip will deal no damage after piercing enough enemies"
            if (!k.strike(use.melee, dummy, { x: x + (tipX - x) * t, y: y + (tipY - y) * t }, hit)) continue
            landed.set(use, n + 1)
            k.tagDummy(dummy, tag)
          }
        }
      },
      blade: pose,
    }
    return { ok: true, behavior }
  },
}
