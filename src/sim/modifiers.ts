/**
 * Cross-cutting modifier layer (DATA_SCHEMA_SPEC §2.4 LabModifiers; PRD P3-S8, P3-S11).
 *
 * Implemented: multiHit (local immunity ticks), homing (steering, toggleable), dot (debuff
 * application; dps resolved from the Buff registry). NOT implemented: bounce, chain — their
 * registry entries THROW `NotImplementedError` (never faked); the guard converts that into a typed
 * `not-simulable` refusal, so no caller ever sees the throw through the public API.
 */
import { getField, type Buff, type LabModifiers } from '../schemas'
import type { ModifierContext, ModifierRuntime } from './contracts'
import { aabbCenter, length } from './geometry'
import type { SimRefusal } from './types'

export class NotImplementedError extends Error {
  readonly feature: string
  constructor(feature: string) {
    super(`Weapon Lab: "${feature}" is not implemented in the simulation core`)
    this.name = 'NotImplementedError'
    this.feature = feature
  }
}

export type ModifierKey = keyof LabModifiers
type ModifierConfig<K extends ModifierKey> = NonNullable<LabModifiers[K]>
type ModifierPrepareResult = { ok: true; runtime: ModifierRuntime } | { ok: false; refusal: SimRefusal }
type ModifierPrepare<K extends ModifierKey> = (config: ModifierConfig<K>, ctx: ModifierContext) => ModifierPrepareResult

/** Fixed application order (determinism): immunity first, steering, then on-hit effects. */
export const MODIFIER_ORDER: readonly ModifierKey[] = ['multiHit', 'homing', 'dot', 'bounce', 'chain']

const multiHit: ModifierPrepare<'multiHit'> = (config) => ({
  ok: true,
  runtime: { key: 'multiHit', approximations: ['multi-hit'], hitCooldownTicks: config.localImmunityTicks },
})

/**
 * Homing: each tick, steer toward the nearest dummy center within `acquisitionRangeTiles`
 * (ties → lower dummy index), blending velocity direction by `strength` (1 = instant turn) and
 * keeping speed. Disabled entirely by `settings.homingEnabled === false` (P3-S8 AC2).
 */
const homing: ModifierPrepare<'homing'> = (config) => {
  const rangeSq = config.acquisitionRangeTiles * config.acquisitionRangeTiles
  return {
    ok: true,
    runtime: {
      key: 'homing',
      approximations: ['homing'],
      steer(k, p) {
        if (!k.settings.homingEnabled) return
        let best: { x: number; y: number } | null = null
        let bestSq = rangeSq
        for (const d of k.dummies) {
          const c = aabbCenter(d.box)
          const dx = c.x - p.x
          const dy = c.y - p.y
          const sq = dx * dx + dy * dy
          if (sq <= bestSq && (best === null || sq < bestSq)) {
            best = c
            bestSq = sq
          }
        }
        if (best === null) return
        const speed = length(p.vx, p.vy)
        const dist = Math.sqrt(bestSq)
        if (speed === 0 || dist === 0) return
        const tx = ((best.x - p.x) / dist) * speed
        const ty = ((best.y - p.y) / dist) * speed
        const nx = p.vx + (tx - p.vx) * config.strength
        const ny = p.vy + (ty - p.vy) * config.strength
        const n = length(nx, ny)
        if (n === 0) {
          p.vx = tx
          p.vy = ty
        } else {
          p.vx = (nx / n) * speed
          p.vy = (ny / n) * speed
        }
      },
    },
  }
}

/** Resolves a buff's verified DoT dps, or explains why it can't. */
export function resolveDotDps(buffId: string, buffs: readonly Buff[]): { ok: true; dps: number } | { ok: false; detail: string } {
  const buff = buffs.find((b) => b.id === buffId)
  if (!buff) return { ok: false, detail: `buff "${buffId}" is not in the provided buff registry` }
  const dps = getField(buff, 'dot.dps')
  if (dps.status === 'unverified') return { ok: false, detail: `buff "${buffId}" damage per second is unverified` }
  if (dps.status === 'not-applicable' || typeof dps.value !== 'number' || !(dps.value > 0)) {
    return { ok: false, detail: `buff "${buffId}" has no damage-over-time data` }
  }
  return { ok: true, dps: dps.value }
}

const dot: ModifierPrepare<'dot'> = (config, ctx) => {
  if (ctx.buffs === undefined) {
    return {
      ok: false,
      refusal: {
        kind: 'invalid-setup',
        reason: 'buff-registry-required',
        message: `This weapon applies the "${config.buffId}" debuff; pass the buff registry to simulate its damage over time.`,
        fields: ['labBehavior.modifiers.dot.buffId'],
      },
    }
  }
  const resolved = resolveDotDps(config.buffId, ctx.buffs)
  if (!resolved.ok) {
    return {
      ok: false,
      refusal: {
        kind: 'not-simulable',
        reason: 'dependency-data-unavailable',
        message: `Damage over time can't be simulated: ${resolved.detail}.`,
        weaponId: ctx.weapon.id,
        fields: [`buff:${config.buffId}.dot.dps`],
      },
    }
  }
  const { dps } = resolved
  const chance = config.chancePct
  const duration = config.durationTicks
  return {
    ok: true,
    runtime: {
      key: 'dot',
      approximations: ['dot'],
      afterStrike(k, _source, dummy) {
        if (chance !== undefined && chance < 100 && k.rng.int(1, 100) > chance) return
        const ticks = typeof duration === 'number' ? duration : k.rng.int(duration.minTicks, duration.maxTicks)
        k.applyDebuff(dummy, config.buffId, dps, ticks)
      },
    },
  }
}

const bounce: ModifierPrepare<'bounce'> = () => {
  throw new NotImplementedError('bounce')
}

const chain: ModifierPrepare<'chain'> = () => {
  throw new NotImplementedError('chain')
}

const REGISTRY: { [K in ModifierKey]: ModifierPrepare<K> } = { multiHit, homing, dot, bounce, chain }

/**
 * Prepares all present modifiers in MODIFIER_ORDER. Unimplemented modifiers surface as a typed
 * `modifier-not-implemented` refusal (the NotImplementedError is caught here, nowhere else).
 */
export function prepareModifiers(
  modifiers: LabModifiers | undefined,
  ctx: ModifierContext,
): { ok: true; runtimes: ModifierRuntime[] } | { ok: false; refusal: SimRefusal } {
  const runtimes: ModifierRuntime[] = []
  if (!modifiers) return { ok: true, runtimes }
  for (const key of MODIFIER_ORDER) {
    const config = modifiers[key]
    if (config === undefined) continue
    let result: ModifierPrepareResult
    try {
      result = (REGISTRY[key] as ModifierPrepare<ModifierKey>)(config as ModifierConfig<ModifierKey>, ctx)
    } catch (err) {
      if (!(err instanceof NotImplementedError)) throw err
      return {
        ok: false,
        refusal: {
          kind: 'not-simulable',
          reason: 'modifier-not-implemented',
          message: `The "${err.feature}" behavior isn't simulated by the Weapon Lab yet.`,
          weaponId: ctx.weapon.id,
          fields: [`labBehavior.modifiers.${key}`],
        },
      }
    }
    if (!result.ok) return result
    runtimes.push(result.runtime)
  }
  return { ok: true, runtimes }
}

/** Exposed for tests: the raw registry entry (bounce/chain throw). */
export function modifierEntry<K extends ModifierKey>(key: K): ModifierPrepare<K> {
  return REGISTRY[key]
}
