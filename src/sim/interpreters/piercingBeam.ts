/**
 * piercing-beam (PRD P3-S6 AC2–AC3), two modes from params (README "Param semantics"):
 *
 * - `pierce-projectile`: each activation fires one projectile that passes through up to `pierce`
 *   further dummies after the first (B37), hitting each once — so it damages at most 1 + pierce
 *   dummies in one pass; `infinite` = every dummy on its line. Speed = `projectile.velocityTps`
 *   when the params carry a projectile, else the weapon's `shootSpeedTps`; damage × the projectile's
 *   `damageMultiplierPct` (as magic-bolt). A projectile spec stating a different pierce contradicts
 *   the params (`invalid-data`). The params carry no ammo, so a weapon that fires ammo is refused
 *   rather than simulated without its ammo damage.
 * - `channel-beam`: while a use is in progress AND the attack is held (channeled: releasing ends the
 *   beam at once; mana is paid per use by the kernel) a straight beam runs from the player toward the CURRENT aim to the arena's edge, through every
 *   dummy on it; each dummy is hit once per `tickRateTicks` (a per-world hit source that outlives
 *   single uses, so the cadence is continuous across uses). Damage × `projectile.damageMultiplierPct`
 *   when the params carry a projectile. The beam's pose is the render state's `blade` (`kind: 'beam'`).
 *   Homing means nothing to a beam: refused (`modifier-not-implemented`) rather than ignored.
 */
import type { ArchetypeParams, Weapon } from '../../schemas'
import type { ArchetypeInterpreter, Behavior, KernelApi, PrepareResult } from '../contracts'
import { aabbFromCenter, angleTo, rayExitDistance, segmentAabbEntry } from '../geometry'
import type { BladePose, NotSimulable } from '../types'
import { fireVolley, projectileDamage, shapeFromSpec, volleyApproximations, type Volley } from './shared'

type BeamParams = Extract<ArchetypeParams, { archetype: 'piercing-beam' }>

/** The beam's hit source key (`damage` events' `sourceId`). */
export const BEAM_SOURCE_KEY = 'beam'

/** The beam as of this tick: from the player toward the aim, to the arena's edge. */
function beamLine(k: KernelApi): { angle: number; length: number } {
  const angle = angleTo(k.player, k.aim)
  const { minX, maxX, minY, maxY } = k.arena
  const arena = aabbFromCenter((minX + maxX) / 2, (minY + maxY) / 2, maxX - minX, maxY - minY)
  return { angle, length: rayExitDistance(k.player, angle, arena) }
}

export const piercingBeam: ArchetypeInterpreter<'piercing-beam'> = {
  archetype: 'piercing-beam',
  requiredFields: [],
  prepare({ weapon, params }): PrepareResult {
    const refuse = (reason: NotSimulable['reason'], message: string, fields: string[]): PrepareResult => ({
      ok: false,
      refusal: { kind: 'not-simulable', reason, message, weaponId: weapon.id, fields, archetype: 'piercing-beam' },
    })
    return params.mode === 'channel-beam' ? channelBeam(weapon, params, refuse) : pierceProjectile(weapon, params, refuse)
  },
}

type Refuse = (reason: NotSimulable['reason'], message: string, fields: string[]) => PrepareResult

function pierceProjectile(weapon: Weapon, params: BeamParams, refuse: Refuse): PrepareResult {
  const spec = params.projectile
  const pierce = params.pierce as NonNullable<BeamParams['pierce']> // schema: present iff pierce-projectile
  if (spec?.pierce !== undefined && spec.pierce !== pierce) {
    return refuse('invalid-data', `The projectile's pierce (${spec.pierce}) contradicts the weapon's pierce (${pierce}).`, ['labBehavior.params.pierce', 'labBehavior.params.projectile.pierce'])
  }
  if (weapon.ammoClass !== undefined) {
    return refuse('invalid-data', 'This weapon fires ammunition, which piercing-beam parameters do not carry.', ['ammoClass', 'labBehavior.params'])
  }
  const speedTps = spec?.velocityTps ?? weapon.shootSpeedTps
  if (speedTps === undefined) return refuse('missing-required-field', 'Required simulation data is missing: shootSpeedTps.', ['shootSpeedTps'])
  if (!(speedTps > 0)) return refuse('invalid-data', 'The projectile speed is not positive.', ['shootSpeedTps'])
  const damage = projectileDamage(weapon.damage ?? 0, spec)
  const volley: Volley = { count: 1, spreadDegrees: 0, speedTps, damage, shape: shapeFromSpec({ ...(spec ?? { velocityTps: speedTps }), pierce }) }
  const behavior: Behavior = {
    archetype: 'piercing-beam',
    baseHitDamage: damage,
    usesAmmo: false,
    approximations: volleyApproximations(volley),
    activate(k) {
      fireVolley(k, volley)
    },
  }
  return { ok: true, behavior }
}

function channelBeam(weapon: Weapon, params: BeamParams, refuse: Refuse): PrepareResult {
  const lab = weapon.labBehavior
  if (lab.kind === 'archetype' && lab.modifiers?.homing !== undefined) {
    return refuse('modifier-not-implemented', 'A held beam doesn’t home; homing on it isn’t simulated by the Weapon Lab.', ['labBehavior.modifiers.homing'])
  }
  const tickRate = params.tickRateTicks as number // schema: present iff channel-beam
  const damage = projectileDamage(weapon.damage ?? 0, params.projectile)
  const behavior: Behavior = {
    archetype: 'piercing-beam',
    baseHitDamage: damage,
    usesAmmo: false,
    approximations: ['beam-geometry', 'projectile-damage'],
    activate() {},
    tickUse(k) {
      if (!k.attacking) return // channeled: the beam is on only while the attack is held
      const source = k.persistentSource(BEAM_SOURCE_KEY, 'projectile', damage, tickRate)
      const { angle, length } = beamLine(k)
      const { x, y } = k.player
      const tipX = x + Math.cos(angle) * length
      const tipY = y + Math.sin(angle) * length
      const contacts: Array<{ t: number; index: number }> = []
      k.dummies.forEach((dummy, index) => {
        const t = segmentAabbEntry(x, y, tipX, tipY, dummy.box)
        if (t !== null) contacts.push({ t, index })
      })
      contacts.sort((a, b) => a.t - b.t || a.index - b.index)
      for (const { t, index } of contacts) k.strike(source, k.dummies[index], { x: x + (tipX - x) * t, y: y + (tipY - y) * t })
    },
    blade(_use, k): BladePose | null {
      if (!k.attacking) return null
      const { angle, length } = beamLine(k)
      return { kind: 'beam', angle, prevAngle: angle, length, prevLength: length }
    },
  }
  return { ok: true, behavior }
}
