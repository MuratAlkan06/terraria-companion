/**
 * Honesty guard (DATA_SCHEMA_SPEC §2.1 rule 3, defense-in-depth): the engine refuses — with a typed
 * result, never a guess — any weapon whose labBehavior is a limitation / custom scenario, whose
 * archetype or modifiers aren't implemented, or whose required fields are absent or unverified.
 *
 * Field reads go through `getField` (§2.1 rule 5): "verified" and "editorial" values are consumable;
 * "unverified" ⇒ `unverified-required-field`; absent-and-not-listed ⇒ `missing-required-field`.
 * Also mirrors the pipeline's downgrade rule: any `labBehavior.*` path or any
 * `simRequiredWeaponFields(archetype)` path listed as unverified blocks simulation.
 */
import { getField, isCoveredBy, simRequiredWeaponFields, type Archetype, type DamageClass, type Weapon } from '../schemas'
import { APPROXIMATIONS, COMMON_APPROXIMATIONS, type Approximation, type ApproximationId } from './approximations'
import { TICKS_PER_SECOND } from './constants'
import type { Behavior, ModifierRuntime } from './contracts'
import { critChancePct } from './damage'
import { interpreterFor } from './interpreters'
import { prepareModifiers, type ModifierKey } from './modifiers'
import type { NotSimulable, SimRefusal, SimulabilityInput, WeaponSummary } from './types'

/** Present (verified/editorial) for every archetype. useAnimationTicks = cadence (AMENDMENTS-004 B14). */
export const COMMON_REQUIRED_FIELDS = ['damageClass', 'damage', 'critPct', 'useTimeTicks', 'useAnimationTicks'] as const
/** Absent ⇒ documented default (autoReuse false, no mana cost); listed unverified ⇒ refuse. */
export const OPTIONAL_SIM_FIELDS = ['autoReuse', 'manaCost'] as const

export type WeaponAssessment =
  | { simulable: true; archetype: Archetype; requiresAmmoClass: string | null; requiresBuffIds: string[] }
  | { simulable: false; refusal: NotSimulable }

export interface SimPlan {
  weapon: Weapon
  behavior: Behavior
  modifiers: ModifierRuntime[]
  cadenceTicks: number
  activationTicks: number
  critChancePct: number
  manaCost: number
  summary: WeaponSummary
  approximations: Approximation[]
}

const refuse = (weapon: Weapon, reason: NotSimulable['reason'], message: string, extra: Partial<NotSimulable> = {}): NotSimulable => ({
  kind: 'not-simulable',
  reason,
  message,
  weaponId: weapon.id,
  ...extra,
})

const isInt = (v: unknown, min: number, max = Infinity): boolean => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max

/**
 * Effective ticks per attack. B14: the wiki's "use time" is Iteminfo useAnimation and is the attack
 * cadence. VERIFIED refinement (https://terraria.wiki.gg/wiki/Use_time): "the actual use time
 * (useAnimation) of autoswing melee weapons is one tick lower than the useAnimation stated".
 */
export function cadenceTicksFor(weapon: Pick<Weapon, 'damageClass' | 'autoReuse'>, useAnimationTicks: number): number {
  return weapon.damageClass === 'melee' && weapon.autoReuse === true ? Math.max(1, useAnimationTicks - 1) : useAnimationTicks
}

/** Weapon-only verdict (no ammo/buffs needed) — for the Lab browser and coverage report. */
export function assessWeapon(weapon: Weapon): WeaponAssessment {
  const lab = weapon.labBehavior
  if (lab.kind === 'limitation') {
    return {
      simulable: false,
      refusal: refuse(weapon, 'limitation', lab.reason, {
        limitation: { inGameBehavior: lab.inGameBehavior, reason: lab.reason, sourceUrl: lab.sourceUrl },
      }),
    }
  }
  if (lab.kind === 'custom-scenario') {
    return {
      simulable: false,
      refusal: refuse(weapon, 'custom-scenario', lab.note ?? 'This weapon needs a special test scenario.', { scenarioId: lab.scenarioId }),
    }
  }
  const archetype = lab.params.archetype
  const interpreter = interpreterFor(archetype)
  if (!interpreter) {
    return {
      simulable: false,
      refusal: refuse(weapon, 'archetype-not-implemented', `The "${archetype}" behavior isn't simulated by the Weapon Lab yet.`, { archetype }),
    }
  }

  const unverified = weapon._prov.unverifiedFields
  const required = [...COMMON_REQUIRED_FIELDS, ...interpreter.requiredFields]
  const blocking = new Set<string>()
  for (const path of unverified) {
    if (path === 'labBehavior' || path.startsWith('labBehavior.')) blocking.add(path)
  }
  for (const field of new Set([...simRequiredWeaponFields(archetype), ...required, ...OPTIONAL_SIM_FIELDS])) {
    // Listed path is the field, an ancestor of it, or (pipeline rule) a descendant of it.
    const listed = isCoveredBy(unverified, field) || unverified.some((path) => isCoveredBy([field], path))
    if (listed || getField(weapon, field).status === 'unverified') blocking.add(field)
  }
  if (blocking.size > 0) {
    const fields = [...blocking].sort()
    return {
      simulable: false,
      refusal: refuse(weapon, 'unverified-required-field', `Required simulation data is unverified: ${fields.join(', ')}.`, { fields, archetype }),
    }
  }
  const missing = required.filter((f) => getField(weapon, f).status === 'not-applicable')
  if (missing.length > 0) {
    return {
      simulable: false,
      refusal: refuse(weapon, 'missing-required-field', `Required simulation data is missing: ${missing.join(', ')}.`, { fields: missing, archetype }),
    }
  }

  const invalid: string[] = []
  if (!isInt(weapon.damage, 0)) invalid.push('damage')
  if (!isInt(weapon.critPct, 0, 100)) invalid.push('critPct')
  if (!isInt(weapon.useTimeTicks, 1)) invalid.push('useTimeTicks')
  if (!isInt(weapon.useAnimationTicks, 1)) invalid.push('useAnimationTicks')
  if (weapon.manaCost !== undefined && !isInt(weapon.manaCost, 1)) invalid.push('manaCost')
  if (invalid.length > 0) {
    return {
      simulable: false,
      refusal: refuse(weapon, 'invalid-data', `Malformed simulation data: ${invalid.join(', ')}.`, { fields: invalid, archetype }),
    }
  }

  // Each modifier on its own, so a setup-level gap (buff registry) never masks a not-implemented one.
  const mods = lab.modifiers ?? {}
  for (const key of Object.keys(mods) as ModifierKey[]) {
    if (mods[key] === undefined) continue
    const probe = prepareModifiers({ [key]: mods[key] }, { weapon })
    if (!probe.ok && probe.refusal.kind === 'not-simulable') return { simulable: false, refusal: probe.refusal }
  }

  return {
    simulable: true,
    archetype,
    requiresAmmoClass: lab.params.archetype === 'bow-gun' ? lab.params.ammoClass : null,
    requiresBuffIds: mods.dot ? [mods.dot.buffId] : [],
  }
}

const MANA_APPROXIMATIONS: readonly ApproximationId[] = ['mana-cost', 'mana-regen', 'insufficient-mana']

/** Full preparation: weapon verdict + modifiers (buffs) + interpreter (ammo) → a runnable plan. */
export function prepareSimulation(input: SimulabilityInput): { ok: true; plan: SimPlan } | { ok: false; refusal: SimRefusal } {
  const { weapon } = input
  const verdict = assessWeapon(weapon)
  if (!verdict.simulable) return { ok: false, refusal: verdict.refusal }
  const lab = weapon.labBehavior
  if (lab.kind !== 'archetype') throw new Error('unreachable: assessWeapon accepted a non-archetype weapon')

  const modifiers = prepareModifiers(lab.modifiers, { weapon, ...(input.buffs ? { buffs: input.buffs } : {}) })
  if (!modifiers.ok) return modifiers

  const interpreter = interpreterFor(lab.params.archetype)
  if (!interpreter) throw new Error('unreachable: assessWeapon accepted an unimplemented archetype')
  const prepared = interpreter.prepare({ weapon, params: lab.params, ...(input.ammo ? { ammo: input.ammo } : {}) })
  if (!prepared.ok) return prepared
  const { behavior } = prepared

  // assessWeapon proved these present and well-formed.
  const damageClass = weapon.damageClass as DamageClass
  const useAnimationTicks = weapon.useAnimationTicks as number
  const activationTicks = weapon.useTimeTicks as number
  const cadenceTicks = cadenceTicksFor(weapon, useAnimationTicks)
  const crit = critChancePct(damageClass, weapon.critPct as number)
  const manaCost = weapon.manaCost ?? 0

  const ids: ApproximationId[] = [
    ...COMMON_APPROXIMATIONS,
    ...behavior.approximations,
    ...modifiers.runtimes.flatMap((m) => m.approximations),
    ...(manaCost > 0 ? MANA_APPROXIMATIONS : []),
  ]
  const approximations = [...new Set(ids)].map((id) => APPROXIMATIONS[id])

  const summary: WeaponSummary = {
    id: weapon.id,
    name: weapon.name,
    archetype: lab.params.archetype,
    damage: weapon.damage as number,
    cadenceTicks,
    activationTicks,
    activationsPerUse: Math.ceil(cadenceTicks / activationTicks),
    nominalAttacksPerSec: TICKS_PER_SECOND / cadenceTicks,
    critChancePct: crit,
    manaCostPerUse: manaCost,
    usesAmmo: behavior.usesAmmo,
    baseHitDamage: behavior.baseHitDamage,
  }

  return {
    ok: true,
    plan: { weapon, behavior, modifiers: modifiers.runtimes, cadenceTicks, activationTicks, critChancePct: crit, manaCost, summary, approximations },
  }
}
