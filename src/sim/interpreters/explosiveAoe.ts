/**
 * explosive-aoe (PRD P3-S11 AC1): a thrown explosive — the weapon item itself, used up by each throw
 * (`Behavior.consumable`: one item per activation, `stats.consumablesUsed`) — that goes off ONCE and
 * damages every dummy in its blast (README "Param semantics", explosive-aoe).
 *
 * - Throw (`explosive-throw`, a Lab model): from the player's centre toward the aim, at the weapon's
 *   throw speed (`weapon.shootSpeedTps`, required) horizontally, in an arc under the Lab's generic
 *   gravity (GRAVITY_TILES_PER_TICK2, `gravity`) that lands on the ground (GROUND_Y_TILES) below the aim
 *   point, resting THROWN_REST_HEIGHT_TILES above it — no bounce, roll or stick. The arc is solved per
 *   throw (`throwArc`): horizontal distance D, flight time T = max(1, D ÷ speed) ticks, vertical launch
 *   speed Δy ÷ T − g·T ÷ 2, so it lands exactly there after T ticks. A guided projectile (contracts
 *   `ProjectileGuide`), stepped in the fixed projectile step: deterministic at any frame rate.
 * - Trigger: `timed` — goes off `fuseTicks` after the throw (the projectile's age; wiki: "explodes N
 *   seconds after being thrown"), wherever it is then; on the way it passes through dummies without a
 *   hit (`touch` does nothing; `explosive-fuse`). `impact` — goes off at its first dummy contact (at the
 *   touch point) or when it lands, whichever is first; the touch deals no hit of its own
 *   (`explosive-impact`).
 * - Blast (`KernelApi.explode`, `blast-area`): ONE hit per dummy whose hitbox reaches into the circle of
 *   `blastRadiusTiles` (stated, or B63 P-5's inscribed circle — labeled `square-blast-radius` through
 *   modeledFields), at the hitbox point nearest the centre; `falloff` none = full damage, linear = the
 *   Lab formula (`blastKeptPct`, `blast-falloff`). Variance, defense and crit as for any hit — a
 *   classless explosive never crits (wiki Critical hit; the guard's `classless-crit`). One explosion
 *   per throw: the projectile is gone after it (despawn `detonated`).
 * - Not modeled (labeled in `blast-area`): knockback, the thrower's self-damage and `selfKnockback` (the
 *   Lab player is stationary and takes no damage), terrain; stack size (`explosive-consumable`).
 * Refused, never ignored: an explosive that fires ammunition (a launcher — its blast is the ammo's, and
 * the explosive params carry no ammo: AMENDMENTS-013 B66 / gap report S-3) is `invalid-data`; homing (the
 * thrown arc ignores steering) and multiHit (one explosion hits each dummy once) are
 * `modifier-not-implemented`.
 */
import type { ArchetypeParams } from '../../schemas'
import type { ApproximationId } from '../approximations'
import { GRAVITY_TILES_PER_TICK2, GROUND_Y_TILES, THROWN_REST_HEIGHT_TILES } from '../constants'
import type { ArchetypeInterpreter, Behavior, BlastFalloff, KernelApi, ProjectileGuide, ProjectileState, PrepareResult } from '../contracts'
import type { ArenaBounds, NotSimulable, Vec2 } from '../types'
import { tilesPerTick } from './shared'

type ExplosiveParams = Extract<ArchetypeParams, { archetype: 'explosive-aoe' }>

/** One throw's arc: from the hand to the landing point in `ticks` (≥ 1, may be fractional) ticks. */
export interface ThrowArc {
  readonly from: Vec2
  readonly to: Vec2
  readonly ticks: number
  /** Vertical launch speed (tiles/tick; negative = upward) that lands it exactly at `to` after `ticks`. */
  readonly vy0: number
  /** Tiles/tick² (the Lab's generic gravity). */
  readonly gravity: number
}

/** The Lab's thrown arc from `from` to `to` at `speed` tiles/tick horizontally (see the header). */
export function throwArc(from: Readonly<Vec2>, to: Readonly<Vec2>, speed: number, gravity: number = GRAVITY_TILES_PER_TICK2): ThrowArc {
  const ticks = Math.max(1, Math.abs(to.x - from.x) / speed)
  return { from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, ticks, vy0: (to.y - from.y) / ticks - (gravity * ticks) / 2, gravity }
}

/** Where the arc is `t` ticks after the throw; the landing point from `ticks` on. */
export function arcPoint(arc: ThrowArc, t: number): Vec2 {
  if (t >= arc.ticks) return { x: arc.to.x, y: arc.to.y }
  return { x: arc.from.x + ((arc.to.x - arc.from.x) * t) / arc.ticks, y: arc.from.y + arc.vy0 * t + (arc.gravity * t * t) / 2 }
}

/** Where a throw at `aim` comes to rest: on the ground below the aim point, inside the arena. */
export function landingPoint(aim: Readonly<Vec2>, arena: Readonly<ArenaBounds>): Vec2 {
  return { x: Math.min(arena.maxX, Math.max(arena.minX, aim.x)), y: GROUND_Y_TILES - THROWN_REST_HEIGHT_TILES }
}

interface BlastConfig {
  radiusTiles: number
  falloff: BlastFalloff
  /** Timed trigger: ticks from the throw to the explosion; undefined = impact. */
  fuseTicks: number | undefined
}

/** One throw's flight (per launch, so per world): the arc, then at rest; the fuse or the impact sets it off. */
function throwGuide(arc: ThrowArc, blast: BlastConfig): ProjectileGuide {
  const goOff = (k: KernelApi, p: ProjectileState, at: Vec2) => {
    k.explode(p, at, blast.radiusTiles, blast.falloff)
    return 'detonated' as const
  }
  return {
    steer(k, p) {
      // Timed: the fuse counts from the throw (age 0 on the tick it leaves the hand), wherever it is.
      if (blast.fuseTicks !== undefined && p.age >= blast.fuseTicks) return goOff(k, p, { x: p.x, y: p.y })
      if (p.age >= arc.ticks) {
        // Landed — exactly on its landing point (no float drift from the per-tick steps): an impact
        // explosive goes off there; a timed one rests there until its fuse runs out.
        p.x = arc.to.x
        p.y = arc.to.y
        if (blast.fuseTicks === undefined) return goOff(k, p, { x: p.x, y: p.y })
        p.vx = 0
        p.vy = 0
        return
      }
      const next = arcPoint(arc, p.age + 1)
      p.vx = next.x - p.x
      p.vy = next.y - p.y
    },
    // No contact hit: an impact explosive goes off at the touch, a timed one flies on through the dummy.
    touch(k, p, _dummy, at) {
      if (blast.fuseTicks === undefined) return goOff(k, p, at)
    },
  }
}

export const explosiveAoe: ArchetypeInterpreter<'explosive-aoe'> = {
  archetype: 'explosive-aoe',
  requiredFields: ['shootSpeedTps'],
  prepare({ weapon, params }): PrepareResult {
    const refuse = (reason: NotSimulable['reason'], message: string, fields: string[]): PrepareResult => ({
      ok: false,
      refusal: { kind: 'not-simulable', reason, message, weaponId: weapon.id, fields, archetype: 'explosive-aoe' },
    })
    const modifiers = weapon.labBehavior.kind === 'archetype' ? weapon.labBehavior.modifiers : undefined
    if (modifiers?.homing) return refuse('modifier-not-implemented', 'A thrown explosive’s arc doesn’t home; homing on it isn’t simulated by the Weapon Lab.', ['labBehavior.modifiers.homing'])
    if (modifiers?.multiHit) return refuse('modifier-not-implemented', 'An explosion hits each dummy once; a multi-hit interval on it isn’t simulated by the Weapon Lab.', ['labBehavior.modifiers.multiHit'])
    if (weapon.ammoClass !== undefined) {
      return refuse('invalid-data', 'The explosive parameters describe a thrown explosive, but this weapon fires ammunition (its blast would be the ammo’s).', ['ammoClass', 'labBehavior.params'])
    }
    const speed = tilesPerTick(weapon.shootSpeedTps ?? 0)
    if (!(speed > 0)) return refuse('invalid-data', 'The weapon’s throw speed is not positive.', ['shootSpeedTps'])
    const fuseTicks = params.trigger === 'timed' ? params.fuseTicks : undefined
    if (params.trigger === 'timed' && fuseTicks === undefined) return refuse('invalid-data', 'A timed explosive needs its fuse.', ['labBehavior.params.fuseTicks'])
    const blast: BlastConfig = { radiusTiles: params.blastRadiusTiles, falloff: params.falloff, fuseTicks }
    const damage = weapon.damage ?? 0
    const behavior: Behavior = {
      archetype: 'explosive-aoe',
      baseHitDamage: damage,
      usesAmmo: false,
      consumable: true,
      approximations: explosiveApproximations(params),
      activate(k: KernelApi) {
        // One explosive per throw (activation), used up as it leaves the hand.
        k.consumeItem(1)
        const arc = throwArc(k.player, landingPoint(k.aim, k.arena), speed)
        const first = arcPoint(arc, 1)
        k.spawnProjectile({
          x: k.player.x,
          y: k.player.y,
          vx: first.x - k.player.x,
          vy: first.y - k.player.y,
          damage,
          gravity: false, // the arc is the guide's (it applies the gravity itself)
          lifetimeTicks: Infinity, // it ends when it goes off
          pierce: Infinity, // no contact hits: the guide takes every touch
          guide: throwGuide(arc, blast),
        })
      },
    }
    return { ok: true, behavior }
  },
}

/** The labels an explosive's numbers depend on (its trigger's, and the falloff formula only where used). */
function explosiveApproximations(params: ExplosiveParams): ApproximationId[] {
  return [
    'explosive-throw',
    'gravity',
    params.trigger === 'timed' ? 'explosive-fuse' : 'explosive-impact',
    'blast-area',
    ...(params.falloff === 'linear' ? (['blast-falloff'] as const) : []),
    'explosive-consumable',
    ...(params.trigger === 'impact' ? (['projectile-point'] as const) : []),
    'no-shared-immunity',
  ]
}
