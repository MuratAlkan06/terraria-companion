/**
 * Which weapons the Weapon Lab can equip, and how a `?weapon=` deep link resolves (PRD P3-S1;
 * UX_SPEC §1, §3.4, §8 LimitationCard, §10.11 deep links).
 *
 * Pure: no DOM and no renderer (Node-testable). Lab-only: it imports the sim engine, so pages
 * outside the Lab use ./labLinks.ts instead. The engine decides simulability (`assessWeapon`,
 * src/sim); the Lab UI adds which archetypes it can equip so far — `LAB_ARCHETYPES` grows as the
 * ammo (P3-S4) and mana (P3-S5) tools ship — and what setup it can provide (no ammo picker and no
 * buff registry yet). Nothing here is per-weapon: every decision reads the weapon's data, so a
 * weapon whose record gains params equips with no UI change.
 */
import type { Archetype, Weapon } from '../schemas'
import { getField } from '../schemas/getField'
import { assessWeapon, type NotSimulable } from '../sim'
import { LAB_ARCHETYPES } from './labLinks'

/** What the Lab UI would need before it can equip an engine-simulable weapon. */
export type LabNeed = 'archetype' | 'ammo' | 'debuff-data'

export type LabStatus =
  /** Simulated and equippable in the Lab now. */
  | { kind: 'equippable'; archetype: Archetype }
  /** The engine can simulate it, but the Lab UI can't equip it yet (archetype tool, ammo picker, buff data). */
  | { kind: 'not-in-lab-yet'; archetype: Archetype; needs: LabNeed }
  /** The engine refuses it (limitation card, custom scenario, unimplemented behavior, unverified data). */
  | { kind: 'not-simulable'; refusal: NotSimulable }

export function labStatus(weapon: Weapon): LabStatus {
  const verdict = assessWeapon(weapon)
  if (!verdict.simulable) return { kind: 'not-simulable', refusal: verdict.refusal }
  const { archetype } = verdict
  if (!LAB_ARCHETYPES.includes(archetype)) return { kind: 'not-in-lab-yet', archetype, needs: 'archetype' }
  if (verdict.requiresAmmoClass !== null) return { kind: 'not-in-lab-yet', archetype, needs: 'ammo' }
  if (verdict.requiresBuffIds.length > 0) return { kind: 'not-in-lab-yet', archetype, needs: 'debuff-data' }
  return { kind: 'equippable', archetype }
}

export const isLabEquippable = (weapon: Weapon): boolean => labStatus(weapon).kind === 'equippable'

/** The picker list: every equippable weapon, alphabetical (ties by id, so the order is stable). */
export function labWeapons(weapons: Iterable<Weapon>): Weapon[] {
  return [...weapons].filter(isLabEquippable).sort((a, b) => a.name.localeCompare(b.name, 'en') || a.id - b.id)
}

/**
 * Equipped when the URL names no weapon (or one the Lab can't equip): the weakest equippable
 * weapon — a starter sword — chosen from the data, never a hard-coded id.
 */
export function defaultLabWeapon(list: readonly Weapon[]): Weapon | undefined {
  let best: Weapon | undefined
  for (const w of list) {
    const damage = w.damage ?? Infinity
    const bestDamage = best?.damage ?? Infinity
    if (!best || damage < bestDamage || (damage === bestDamage && w.id < best.id)) best = w
  }
  return best
}

export type LabNotice =
  /** The requested weapon exists but the Lab can't equip it: show its LimitationCard. */
  | { kind: 'not-equippable'; weapon: Weapon; status: Exclude<LabStatus, { kind: 'equippable' }> }
  /** The requested id doesn't name a weapon in the dataset. */
  | { kind: 'not-found'; requested: string }

export interface LabSelection {
  /** Always an equippable weapon. */
  weapon: Weapon
  notice: LabNotice | null
}

/** `/lab?weapon=:id` → the weapon to equip, plus a notice when the request fell back. */
export function resolveLabSelection(
  param: string | null,
  byId: ReadonlyMap<number, Weapon>,
  list: readonly Weapon[],
): LabSelection | null {
  const fallback = defaultLabWeapon(list)
  if (!fallback) return null
  if (param === null || param.trim() === '') return { weapon: fallback, notice: null }
  const id = /^[1-9]\d{0,9}$/.test(param.trim()) ? Number(param.trim()) : undefined
  const requested = id === undefined ? undefined : byId.get(id)
  if (!requested) return { weapon: fallback, notice: { kind: 'not-found', requested: param } }
  const status = labStatus(requested)
  if (status.kind === 'equippable') return { weapon: requested, notice: null }
  return { weapon: fallback, notice: { kind: 'not-equippable', weapon: requested, status } }
}

/**
 * "What it does in-game" for a LimitationCard: the limitation's verified text, else the item
 * tooltip. A limitation whose text is only the pipeline's pointer to the wiki ("See the … wiki page
 * for its in-game behavior.") is not a description — the card's wiki link says that already.
 */
export function inGameDescription(weapon: Weapon): string | undefined {
  const lab = weapon.labBehavior
  const pointer = `See the ${weapon.name} wiki page for its in-game behavior.`
  if (lab.kind === 'limitation' && lab.inGameBehavior !== pointer) return lab.inGameBehavior
  const tooltip = getField(weapon, 'behaviorText')
  return tooltip.status === 'verified' || tooltip.status === 'editorial' ? (tooltip.value as string) : undefined
}

const ARCHETYPE_NOUNS: Partial<Record<Archetype, string>> = {
  'swing-melee': 'swung melee weapons',
  thrust: 'thrusting weapons',
  'bow-gun': 'bows and guns',
  'magic-bolt': 'magic weapons',
}

/**
 * The pipeline's default limitation reason (pipeline/merge/weapons.ts `LAB_DEFAULT_REASON`) speaks
 * in its own bookkeeping terms; the card says the same thing in plain language (design review M4).
 * Every curated reason is already written for players and is shown verbatim.
 */
export const UNASSIGNED_LIMITATION_REASON = 'Not simulated yet: Weapon Lab behavior parameters have not been assigned to this weapon.'
export const UNASSIGNED_LIMITATION_PLAIN = 'This weapon’s unique behavior isn’t modeled in the Lab.'

const ATTACK_VERBS: Partial<Record<Archetype, string>> = { 'swing-melee': 'swing', thrust: 'thrust' }

/** The verb the Lab's instructions use for the equipped weapon's attack ("Hold Space to swing"). */
export function attackVerb(archetype: Archetype): string {
  return ATTACK_VERBS[archetype] ?? 'attack'
}

/** "swung melee weapons and thrusting weapons" — what the Lab equips today, from LAB_ARCHETYPES. */
export function labScopeNouns(archetypes: readonly Archetype[] = LAB_ARCHETYPES): string {
  const nouns = archetypes.map((a) => ARCHETYPE_NOUNS[a] ?? a)
  return nouns.length <= 1 ? (nouns[0] ?? '') : `${nouns.slice(0, -1).join(', ')} and ${nouns.at(-1)}`
}

/** Plain-language "Why it isn't simulated" for a LimitationCard (UX_SPEC §8). */
export function notSimulatedReason(status: Exclude<LabStatus, { kind: 'equippable' }>): string {
  if (status.kind === 'not-in-lab-yet') {
    const scope = `so far it simulates ${labScopeNouns()} only`
    if (status.needs === 'ammo') return `The Lab can't equip weapons that use ammo yet — ${scope}.`
    if (status.needs === 'debuff-data') return `The Lab can't simulate this weapon's damage-over-time effect yet, so it isn't equipped.`
    const noun = ARCHETYPE_NOUNS[status.archetype] ?? 'weapons like this'
    return `The Lab can't equip ${noun} yet — ${scope}.`
  }
  const { refusal } = status
  if (refusal.reason === 'limitation' && refusal.limitation) {
    return refusal.limitation.reason === UNASSIGNED_LIMITATION_REASON ? UNASSIGNED_LIMITATION_PLAIN : refusal.limitation.reason
  }
  return refusal.message
}

/** Where the card's "how it behaves" link points: the limitation's source, else the weapon page. */
export function behaviorSourceUrl(weapon: Weapon): string {
  return weapon.labBehavior.kind === 'limitation' ? weapon.labBehavior.sourceUrl : weapon.wikiUrl
}
