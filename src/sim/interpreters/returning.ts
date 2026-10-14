/**
 * returning (PRD P3-S7 AC2–AC4): the weapon itself is thrown and comes back — ONE archetype whose
 * variant params decide the flight (README "Param semantics"). The weapon flies at its velocity
 * (`weapon.shootSpeedTps`, required) and is a guided projectile (contracts `ProjectileGuide`):
 *
 * - boomerang (auto-return + fire-and-forget; wiki Boomerangs: "thrown when used, returning to the
 *   player after a short amount of time"): straight toward the aim (latched at the throw) until its
 *   first hit — VERIFIED, wiki Combat Wrench: "Unlike most other boomerangs which instantly turn
 *   around after hitting enemies" — or the end of `throwRangeTiles`, then straight back to the player
 *   (`boomerang-flight`). Two passes: the way back may hit every dummy on it (the wiki's boomerang
 *   notes: once it slows to turn "it gains infinite piercing") except the one that turned it — with a
 *   stationary player the way back retraces the way out, so in the Lab it meets nothing new.
 * - flail, launched (auto-return + fire-and-forget; wiki Flails: "a launched flail will extend at a
 *   fixed speed until it strikes a block or enemy or reaches its maximum length, and then retract"):
 *   the same flight on a chain (`flail-launch`).
 * - yoyo (tethered + cursor-follow; wiki Yoyos: "seeking the player's cursor", "attached to the
 *   player via string"): follows the aim point — clamped to `throwRangeTiles` from the player —
 *   while attack is held, dwelling there; released, it comes back. Re-hits a dummy every
 *   YOYO_HIT_COOLDOWN_TICKS (wiki-verified 10 ticks; `yoyo-control`).
 *
 * Passes and hits: `hitsPerPass` caps the hits on each dummy per pass (out, back; a yoyo's time out
 * is one pass). Absent: once per dummy per pass, except that a yoyo re-hits at its interval; a weapon
 * `multiHit` modifier (data) sets the re-hit interval instead. hitsPerPass > 1 without any re-hit
 * interval can't be honored and is refused (`invalid-data`).
 *
 * One weapon out at a time: `ready` holds the next use until it is caught (`projectile-despawn`
 * reason `returned`), so an attack lasts until the weapon is back (WeaponSummary.returnsToHand).
 * Each variant's documented return mode / control is required — any other combination contradicts
 * the family rule the params were derived from and is refused (`invalid-data`). Homing returning
 * weapons are not modeled (`modifier-not-implemented`): guided flight ignores modifier steering.
 */
import type { ArchetypeParams } from '../../schemas'
import { ARRIVE_EPSILON_TILES, YOYO_HIT_COOLDOWN_TICKS } from '../constants'
import type { ActiveUse, ArchetypeInterpreter, Behavior, KernelApi, ProjectileGuide, ProjectileState, PrepareResult } from '../contracts'
import type { ApproximationId } from '../approximations'
import type { NotSimulable, Vec2 } from '../types'
import { PROJECTILE_APPROXIMATIONS } from '../approximations'
import { tilesPerTick } from './shared'

type ReturningParams = Extract<ArchetypeParams, { archetype: 'returning' }>
type Variant = ReturningParams['variant']

/** Each variant's flight as its wiki family article documents it (pipeline/merge/labFamilies.ts derives the same). */
export const VARIANT_FLIGHT: Readonly<Record<Variant, { returnMode: ReturningParams['returnMode']; control: ReturningParams['control'] }>> = {
  boomerang: { returnMode: 'auto-return', control: 'fire-and-forget' },
  flail: { returnMode: 'auto-return', control: 'fire-and-forget' },
  yoyo: { returnMode: 'tethered', control: 'cursor-follow' },
}

const VARIANT_APPROXIMATION: Readonly<Record<Variant, ApproximationId>> = {
  boomerang: 'boomerang-flight',
  flail: 'flail-launch',
  yoyo: 'yoyo-control',
}

/** Sets the velocity to reach `target` at `speed` tiles/tick without overshooting it. */
function headFor(p: ProjectileState, target: Readonly<Vec2>, speed: number): void {
  const dx = target.x - p.x
  const dy = target.y - p.y
  const d = Math.sqrt(dx * dx + dy * dy)
  if (d <= ARRIVE_EPSILON_TILES) {
    p.vx = 0
    p.vy = 0
    return
  }
  const step = Math.min(speed, d)
  p.vx = (dx / d) * step
  p.vy = (dy / d) * step
}

const distance = (a: Readonly<Vec2>, b: Readonly<Vec2>): number => Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y))

/** `aim`, pulled in to at most `reach` tiles from `from`. */
export function clampToReach(from: Readonly<Vec2>, aim: Readonly<Vec2>, reach: number): Vec2 {
  const d = distance(from, aim)
  if (d <= reach) return { x: aim.x, y: aim.y }
  return { x: from.x + ((aim.x - from.x) / d) * reach, y: from.y + ((aim.y - from.y) / d) * reach }
}

interface FlightConfig {
  rangeTiles: number
  /** tiles / tick, out and back. */
  speed: number
  cursor: boolean
  turnOnStrike: boolean
  hitsPerPass: number | undefined
}

/** One throw's flight (per launch, so per world): out → back → caught. */
function flightGuide(k: KernelApi, use: ActiveUse, cfg: FlightConfig): ProjectileGuide {
  let back = false
  const passHits = new Map<number, number>()
  const fixedTarget: Vec2 = { x: k.player.x + Math.cos(use.aimAngle) * cfg.rangeTiles, y: k.player.y + Math.sin(use.aimAngle) * cfg.rangeTiles }
  /**
   * A new pass: the pass-scoped blocks (once per pass, the hitsPerPass cap) lift, so every dummy may
   * be hit again — except one the flight just struck to turn (a flail retracting from it). A re-hit
   * interval still running (a yoyo's 10 ticks, multiHit) is a cooldown, not a pass budget: it stays.
   */
  const turn = (p: ProjectileState, struck?: number) => {
    back = true
    passHits.clear()
    for (const [index, until] of p.source.immuneUntil) if (until === Infinity) p.source.immuneUntil.delete(index)
    if (struck !== undefined) p.source.immuneUntil.set(struck, Infinity)
  }
  return {
    steer(kernel, p) {
      if (!back) {
        if (cfg.cursor) {
          if (!kernel.attacking) turn(p)
          else headFor(p, clampToReach(kernel.player, kernel.aim, cfg.rangeTiles), cfg.speed)
        } else if (distance(p, fixedTarget) <= ARRIVE_EPSILON_TILES) {
          turn(p)
        } else {
          headFor(p, fixedTarget, cfg.speed)
        }
      }
      if (back) {
        if (distance(p, kernel.player) <= ARRIVE_EPSILON_TILES) return 'caught'
        headFor(p, kernel.player, cfg.speed)
      }
    },
    afterHit(_kernel, p, dummy) {
      const hits = (passHits.get(dummy.index) ?? 0) + 1
      passHits.set(dummy.index, hits)
      if (cfg.hitsPerPass !== undefined && hits >= cfg.hitsPerPass) p.source.immuneUntil.set(dummy.index, Infinity)
      if (cfg.turnOnStrike && !back) {
        turn(p, dummy.index)
        return 'stop'
      }
    },
  }
}

/** A returning weapon of this world is still out (the only guided projectiles are returning weapons). */
const weaponOut = (k: KernelApi): boolean => k.activeProjectiles.some((p) => p.guide !== undefined)

export const returning: ArchetypeInterpreter<'returning'> = {
  archetype: 'returning',
  requiredFields: ['shootSpeedTps'],
  prepare({ weapon, params }): PrepareResult {
    const refuse = (reason: NotSimulable['reason'], message: string, fields: string[]): PrepareResult => ({
      ok: false,
      refusal: { kind: 'not-simulable', reason, message, weaponId: weapon.id, fields, archetype: 'returning' },
    })
    const documented = VARIANT_FLIGHT[params.variant]
    if (params.returnMode !== documented.returnMode || params.control !== documented.control) {
      return refuse(
        'invalid-data',
        `A ${params.variant} returns "${documented.returnMode}" under "${documented.control}" control; "${params.returnMode}" / "${params.control}" contradicts it.`,
        ['labBehavior.params.returnMode', 'labBehavior.params.control'],
      )
    }
    const modifiers = weapon.labBehavior.kind === 'archetype' ? weapon.labBehavior.modifiers : undefined
    if (modifiers?.homing) return refuse('modifier-not-implemented', 'Homing returning weapons aren’t simulated by the Weapon Lab.', ['labBehavior.modifiers.homing'])
    const speedTps = weapon.shootSpeedTps ?? 0
    if (!(speedTps > 0)) return refuse('invalid-data', 'The weapon’s velocity is not positive.', ['shootSpeedTps'])
    const rehitTicks = params.variant === 'yoyo' ? YOYO_HIT_COOLDOWN_TICKS : undefined
    if (params.hitsPerPass !== undefined && params.hitsPerPass > 1 && rehitTicks === undefined && modifiers?.multiHit === undefined) {
      return refuse('invalid-data', `${params.hitsPerPass} hits per pass need a re-hit interval (multiHit), which this weapon has none of.`, ['labBehavior.params.hitsPerPass'])
    }
    const damage = weapon.damage ?? 0
    const cfg: FlightConfig = {
      rangeTiles: params.throwRangeTiles,
      speed: tilesPerTick(speedTps),
      cursor: params.control === 'cursor-follow',
      turnOnStrike: params.control === 'fire-and-forget', // boomerangs and launched flails turn back at their first hit
      hitsPerPass: params.hitsPerPass,
    }
    const behavior: Behavior = {
      archetype: 'returning',
      baseHitDamage: damage,
      usesAmmo: false,
      returnsToHand: true,
      approximations: [VARIANT_APPROXIMATION[params.variant], ...PROJECTILE_APPROXIMATIONS.filter((id) => id !== 'projectile-lifetime')],
      ready: (k) => !weaponOut(k),
      activate(k, use) {
        if (weaponOut(k)) return // one weapon out at a time (a use's later activations throw nothing)
        k.spawnProjectile({
          x: k.player.x,
          y: k.player.y,
          vx: Math.cos(use.aimAngle) * cfg.speed,
          vy: Math.sin(use.aimAngle) * cfg.speed,
          damage,
          gravity: false,
          lifetimeTicks: Infinity, // it ends when caught
          pierce: Infinity, // passes are budgeted by the guide, never by a pierce count
          ...(rehitTicks === undefined ? {} : { hitCooldownTicks: rehitTicks }),
          guide: flightGuide(k, use, cfg),
        })
      },
    }
    return { ok: true, behavior }
  },
}
