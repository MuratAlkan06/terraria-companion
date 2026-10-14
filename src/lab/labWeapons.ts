/**
 * Which weapons the Weapon Lab can equip, and how a `?weapon=` deep link resolves (PRD P3-S1;
 * UX_SPEC §1, §3.4, §8 LimitationCard, §10.11 deep links).
 *
 * Pure: no DOM and no renderer (Node-testable). Lab-only: it imports the sim engine, so pages
 * outside the Lab use ./labLinks.ts instead. The engine decides: `assessWeapon` for the record, then
 * `createLabSim` with the setup the Lab provides (./labSetup.ts — the weapon's default ammo and the
 * buff registry). The Lab UI adds only which archetypes it can draw (`LAB_ARCHETYPES`). Nothing here
 * is per-weapon: every decision reads the data, so a weapon whose record gains params — or whose
 * ammo or debuff gains verified data — equips with no UI change.
 */
import type { Archetype, Weapon } from '../schemas'
import { getField } from '../schemas/getField'
import { assessWeapon, createLabSim, type NotSimulable, type SimRefusal } from '../sim'
import { LAB_ARCHETYPES } from './labLinks'
import { ammoChoices, type LabSetup } from './labSetup'

/** What the Lab would need before it can equip an engine-simulable weapon. */
export type LabNeed = 'archetype' | 'ammo' | 'debuff-data'

export type LabStatus =
  /** Simulated and equippable in the Lab now. */
  | { kind: 'equippable'; archetype: Archetype }
  /** The engine can simulate it, but not with what the Lab has (archetype tool, usable ammo, verified debuff). */
  | { kind: 'not-in-lab-yet'; archetype: Archetype; needs: LabNeed }
  /** The engine refuses it (limitation card, custom scenario, unimplemented behavior, unverified data). */
  | { kind: 'not-simulable'; refusal: NotSimulable }

/** A setup refusal → what's missing: ammo the engine can fire, or a debuff it can resolve. */
function statusFromRefusal(refusal: SimRefusal, archetype: Archetype): LabStatus {
  const fields = refusal.fields ?? []
  const about = (prefix: string) => fields.some((f) => f.startsWith(prefix))
  if (refusal.kind === 'invalid-setup') {
    if (refusal.reason === 'buff-registry-required') return { kind: 'not-in-lab-yet', archetype, needs: 'debuff-data' }
    return { kind: 'not-in-lab-yet', archetype, needs: refusal.reason.startsWith('ammo') ? 'ammo' : 'archetype' }
  }
  if (refusal.reason === 'dependency-data-unavailable' && about('buff:')) return { kind: 'not-in-lab-yet', archetype, needs: 'debuff-data' }
  if (refusal.reason === 'dependency-data-unavailable' && about('ammo')) return { kind: 'not-in-lab-yet', archetype, needs: 'ammo' }
  return { kind: 'not-simulable', refusal }
}

const statusCache = new WeakMap<LabSetup, WeakMap<Weapon, LabStatus>>()

/** The Lab's verdict on a weapon with its setup (cached per setup and weapon record). */
export function labStatus(weapon: Weapon, setup: LabSetup): LabStatus {
  let perSetup = statusCache.get(setup)
  if (!perSetup) statusCache.set(setup, (perSetup = new WeakMap()))
  let status = perSetup.get(weapon)
  if (!status) {
    status = computeStatus(weapon, setup)
    perSetup.set(weapon, status)
  }
  return status
}

function computeStatus(weapon: Weapon, setup: LabSetup): LabStatus {
  const verdict = assessWeapon(weapon)
  if (!verdict.simulable) return { kind: 'not-simulable', refusal: verdict.refusal }
  const { archetype } = verdict
  if (!LAB_ARCHETYPES.includes(archetype)) return { kind: 'not-in-lab-yet', archetype, needs: 'archetype' }
  const ammo = verdict.requiresAmmoClass === null ? undefined : (ammoChoices(weapon, setup)?.defaultAmmo ?? undefined)
  if (verdict.requiresAmmoClass !== null && !ammo) return { kind: 'not-in-lab-yet', archetype, needs: 'ammo' }
  const created = createLabSim({ weapon, buffs: setup.buffs, ...(ammo ? { ammo } : {}) })
  return created.ok ? { kind: 'equippable', archetype } : statusFromRefusal(created.refusal, archetype)
}

export const isLabEquippable = (weapon: Weapon, setup: LabSetup): boolean => labStatus(weapon, setup).kind === 'equippable'

/** The picker list: every equippable weapon, alphabetical (ties by id, so the order is stable). */
export function labWeapons(weapons: Iterable<Weapon>, setup: LabSetup): Weapon[] {
  return [...weapons].filter((w) => isLabEquippable(w, setup)).sort((a, b) => a.name.localeCompare(b.name, 'en') || a.id - b.id)
}

/**
 * Equipped when the URL names no weapon (or one the Lab can't equip): the weakest equippable
 * weapon by base damage — a starter weapon of whatever archetype the data makes weakest (since
 * bows equip, the Wooden Bow) — chosen from the data, never a hard-coded id.
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
  setup: LabSetup,
): LabSelection | null {
  const fallback = defaultLabWeapon(list)
  if (!fallback) return null
  if (param === null || param.trim() === '') return { weapon: fallback, notice: null }
  const id = /^[1-9]\d{0,9}$/.test(param.trim()) ? Number(param.trim()) : undefined
  const requested = id === undefined ? undefined : byId.get(id)
  if (!requested) return { weapon: fallback, notice: { kind: 'not-found', requested: param } }
  const status = labStatus(requested, setup)
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
  'magic-bolt': 'bolt-casting magic weapons',
}

/**
 * The pipeline's default limitation reason (pipeline/merge/weapons.ts `LAB_DEFAULT_REASON`) speaks
 * in its own bookkeeping terms; the card says the same thing in plain language (design review M4).
 * Every curated reason is already written for players and is shown verbatim.
 */
export const UNASSIGNED_LIMITATION_REASON = 'Not simulated yet: Weapon Lab behavior parameters have not been assigned to this weapon.'
export const UNASSIGNED_LIMITATION_PLAIN = 'This weapon’s unique behavior isn’t modeled in the Lab.'

const ATTACK_VERBS: Partial<Record<Archetype, string>> = { 'swing-melee': 'swing', thrust: 'thrust', 'bow-gun': 'shoot', 'magic-bolt': 'cast' }

/** The verb the Lab's instructions use for the equipped weapon's attack ("Hold Space to swing"). */
export function attackVerb(archetype: Archetype): string {
  return ATTACK_VERBS[archetype] ?? 'attack'
}

/**
 * "swung melee weapons, thrusting weapons, bows and guns, and bolt-casting magic weapons" — what the
 * Lab equips today, from LAB_ARCHETYPES (a serial comma once there are three or more: a noun may
 * itself contain "and").
 */
export function labScopeNouns(archetypes: readonly Archetype[] = LAB_ARCHETYPES): string {
  const nouns = archetypes.map((a) => ARCHETYPE_NOUNS[a] ?? a)
  if (nouns.length <= 1) return nouns[0] ?? ''
  if (nouns.length === 2) return `${nouns[0]} and ${nouns[1]}`
  return `${nouns.slice(0, -1).join(', ')}, and ${nouns.at(-1)}`
}

/** Plain-language "Why it isn't simulated" for a LimitationCard (UX_SPEC §8). */
export function notSimulatedReason(status: Exclude<LabStatus, { kind: 'equippable' }>): string {
  if (status.kind === 'not-in-lab-yet') {
    const scope = `so far it simulates ${labScopeNouns()} only`
    if (status.needs === 'ammo') return `None of the ammo this weapon fires has the verified data the Lab needs (such as its damage), so it can't be fired here.`
    if (status.needs === 'debuff-data') return `The debuff this weapon inflicts has no verified damage-over-time data, so the Lab can't simulate it and doesn't equip it.`
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
