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
import { getField, isCoveredBy, modelingConventionFor, simRequiredWeaponFields, type Archetype, type Buff, type DamageClass, type Weapon } from '../schemas'
import { APPROXIMATIONS, COMMON_APPROXIMATIONS, CONVENTION_APPROXIMATIONS, type Approximation, type ApproximationId } from './approximations'
import { TICKS_PER_SECOND } from './constants'
import type { Behavior, HitOwner, ModifierRuntime } from './contracts'
import { critChancePct } from './damage'
import { interpreterFor } from './interpreters'
import { prepareModifiers, type ModifierKey } from './modifiers'
import type { InvalidSetup, NotSimulable, SimRefusal, SimulabilityInput, WeaponSummary } from './types'

/** Present (verified/editorial) for every archetype. useAnimationTicks = cadence (AMENDMENTS-004 B14). */
export const COMMON_REQUIRED_FIELDS = ['damageClass', 'damage', 'critPct', 'useTimeTicks', 'useAnimationTicks'] as const

/**
 * AMENDMENTS-013 B64: `critPct` is NOT APPLICABLE to summon weapons — summon damage cannot crit (wiki
 * Critical hit; AMENDMENTS-004 B17), so the pipeline emits it absent (not Unknown) for every whip,
 * minion and sentry weapon. Requiring it would refuse all of them as missing; their crit chance is 0
 * (`critChancePct`) whatever the record says. Every other class still requires it.
 */
export function requiredFieldsFor(weapon: Pick<Weapon, 'damageClass'>): readonly string[] {
  return weapon.damageClass === 'summon' ? COMMON_REQUIRED_FIELDS.filter((f) => f !== 'critPct') : COMMON_REQUIRED_FIELDS
}
/** Absent ⇒ documented default (autoReuse false, no mana cost, no reuse delay); listed unverified ⇒ refuse. */
export const OPTIONAL_SIM_FIELDS = ['autoReuse', 'manaCost', 'reuseDelayTicks'] as const

export type WeaponAssessment =
  | { simulable: true; archetype: Archetype; requiresAmmoClass: string | null; requiresBuffIds: string[] }
  | { simulable: false; refusal: NotSimulable }

export interface SimPlan {
  weapon: Weapon
  behavior: Behavior
  modifiers: ModifierRuntime[]
  /** Ticks per attack: useTicks + reuseDelayTicks. */
  cadenceTicks: number
  /** Ticks one use (the attack animation) lasts; activations happen inside it. */
  useTicks: number
  /** Cooldown after each use before the next may start (0 = none). */
  reuseDelayTicks: number
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
 * Ticks one use lasts. B14: the wiki's "use time" is Iteminfo useAnimation and is the attack
 * cadence. VERIFIED refinement (https://terraria.wiki.gg/wiki/Use_time): "the actual use time
 * (useAnimation) of autoswing melee weapons is one tick lower than the useAnimation stated".
 */
export function animationTicksFor(weapon: Pick<Weapon, 'damageClass' | 'autoReuse'>, useAnimationTicks: number): number {
  return weapon.damageClass === 'melee' && weapon.autoReuse === true ? Math.max(1, useAnimationTicks - 1) : useAnimationTicks
}

/**
 * Effective ticks per attack = the use (above) + the weapon's reuse delay. VERIFIED
 * (https://terraria.wiki.gg/wiki/Use_time): "reuseDelay is applied after the itemAnimation counter
 * turns to zero" — e.g. the Clockwork Assault Rifle's reuseDelay 14 adds a 14-tick interval between its
 * 12-tick three-round bursts (AMENDMENTS-010 B48(a)).
 */
export function cadenceTicksFor(weapon: Pick<Weapon, 'damageClass' | 'autoReuse' | 'reuseDelayTicks'>, useAnimationTicks: number): number {
  return animationTicksFor(weapon, useAnimationTicks) + (weapon.reuseDelayTicks ?? 0)
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
  const required = [...requiredFieldsFor(weapon), ...interpreter.requiredFields]
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
  if ((weapon.damageClass !== 'summon' || weapon.critPct !== undefined) && !isInt(weapon.critPct, 0, 100)) invalid.push('critPct')
  if (!isInt(weapon.useTimeTicks, 1)) invalid.push('useTimeTicks')
  if (!isInt(weapon.useAnimationTicks, 1)) invalid.push('useAnimationTicks')
  if (weapon.reuseDelayTicks !== undefined && !isInt(weapon.reuseDelayTicks, 1)) invalid.push('reuseDelayTicks')
  if (weapon.manaCost !== undefined && !isInt(weapon.manaCost, 1)) invalid.push('manaCost')
  if (invalid.length > 0) {
    return {
      simulable: false,
      refusal: refuse(weapon, 'invalid-data', `Malformed simulation data: ${invalid.join(', ')}.`, { fields: invalid, archetype }),
    }
  }

  // B49: a modeled value must resolve to a ratified convention (whose label the Lab shows) — never silent.
  const unlabeled = (weapon._prov.modeledFields ?? []).filter((path) => !modelingConventionFor(archetype, path))
  if (unlabeled.length > 0) {
    return {
      simulable: false,
      refusal: refuse(weapon, 'invalid-data', `Modeled values without a ratified modeling convention: ${unlabeled.join(', ')}.`, { fields: unlabeled, archetype }),
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
/** AMENDMENTS-012 B57(e): Lab choices the wiki does not document, for a weapon with both a mana cost and a reuse delay. */
const COOLDOWN_MANA_APPROXIMATIONS: readonly ApproximationId[] = ['slow-cast-cooldown', 'cooldown-mana-regen']

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
  const useTicks = animationTicksFor(weapon, useAnimationTicks)
  const reuseDelayTicks = weapon.reuseDelayTicks ?? 0
  const cadenceTicks = cadenceTicksFor(weapon, useAnimationTicks)
  // B64: a summon weapon has no critPct (summon damage never crits; critChancePct gives it 0).
  const crit = critChancePct(damageClass, weapon.critPct ?? 0)
  const manaCost = weapon.manaCost ?? 0
  // B49: every modeled param the weapon lists → its convention's engine label (assessWeapon checked they resolve).
  const conventions = (weapon._prov.modeledFields ?? []).flatMap((path) => {
    const convention = modelingConventionFor(lab.params.archetype, path)
    const id = convention ? CONVENTION_APPROXIMATIONS[convention.id] : undefined
    return id ? [id] : []
  })

  const ids: ApproximationId[] = [
    ...COMMON_APPROXIMATIONS,
    ...(reuseDelayTicks > 0 ? (['reuse-delay'] as const) : []),
    ...behavior.approximations,
    ...conventions,
    ...modifiers.runtimes.flatMap((m) => m.approximations),
    ...(manaCost > 0 ? MANA_APPROXIMATIONS : []),
    ...(manaCost > 0 && reuseDelayTicks > 0 ? COOLDOWN_MANA_APPROXIMATIONS : []),
  ]
  const approximations = [...new Set(ids)].map((id) => APPROXIMATIONS[id])

  const summary: WeaponSummary = {
    id: weapon.id,
    name: weapon.name,
    archetype: lab.params.archetype,
    damage: weapon.damage as number,
    cadenceTicks,
    reuseDelayTicks,
    activationTicks,
    activationsPerUse: Math.ceil(useTicks / activationTicks),
    nominalAttacksPerSec: TICKS_PER_SECOND / cadenceTicks,
    critChancePct: crit,
    manaCostPerUse: manaCost,
    usesAmmo: behavior.usesAmmo,
    baseHitDamage: behavior.baseHitDamage,
    returnsToHand: behavior.returnsToHand === true,
  }

  return {
    ok: true,
    plan: { weapon, behavior, modifiers: modifiers.runtimes, cadenceTicks, useTicks, reuseDelayTicks, activationTicks, critChancePct: crit, manaCost, summary, approximations },
  }
}

/** The minion loadout, prepared (LabSimOptions.minionLoadout): what fills the slots, and whose hits they are. */
export interface LoadoutPlan {
  behavior: Behavior
  /** The loadout weapon's crit chance (0: summon damage) and its on-hit modifiers (its DoT). */
  owner: HitOwner
  summary: WeaponSummary
  approximations: Approximation[]
}

/**
 * Prepares a minion loadout beside the equipped weapon's plan: the loadout weapon must be simulable on
 * its own (same guard) and summon minions; the equipped weapon must not summon its own. Any failure is
 * an `invalid-loadout` setup refusal naming why.
 */
export function prepareLoadout(weapon: Weapon, equipped: SimPlan, buffs?: readonly Buff[]): { ok: true; loadout: LoadoutPlan } | { ok: false; refusal: InvalidSetup } {
  const invalid = (message: string) => ({ ok: false as const, refusal: { kind: 'invalid-setup' as const, reason: 'invalid-loadout' as const, message, fields: ['minionLoadout'] } })
  if (equipped.behavior.archetype === 'minion-sentry') return invalid('The equipped weapon summons its own minions or sentries; a minion loadout goes alongside a weapon that does not.')
  const prepared = prepareSimulation({ weapon, ...(buffs ? { buffs } : {}) })
  if (!prepared.ok) return invalid(`${weapon.name} can't be the minion loadout: ${prepared.refusal.message}`)
  const { plan } = prepared
  if (!plan.behavior.fillSlots) return invalid(`${weapon.name} can't be the minion loadout: it doesn't summon minions.`)
  return {
    ok: true,
    loadout: { behavior: plan.behavior, owner: { critChancePct: plan.critChancePct, modifiers: plan.modifiers }, summary: plan.summary, approximations: plan.approximations },
  }
}
