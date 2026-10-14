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
import { tooltipBehavior, type Archetype, type Weapon } from '../schemas'
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
 * The minion loadout's choices (PRD P3-S10, beside a whip): every equippable MINION staff (the engine's
 * `minionLoadout` takes minions, not sentries), in picker order. From the data — a staff that gains
 * params joins the list with no UI change.
 */
export function loadoutChoices(list: readonly Weapon[]): Weapon[] {
  return list.filter((w) => w.labBehavior.kind === 'archetype' && w.labBehavior.params.archetype === 'minion-sentry' && w.labBehavior.params.variant === 'minion')
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
 * "What it does in-game" for a LimitationCard — verified BEHAVIOR text (UX_SPEC §8): the limitation's
 * text (a reviewed article sentence, or the tooltip's behavior lines — pipeline labDowngrade
 * `limitation`), else the tooltip's behavior lines. Never the tooltip's flavor-text quote
 * ("'Greetings, programs!'", schemas `tooltipBehavior`). A limitation whose text is only the
 * pipeline's pointer to the wiki ("See the … wiki page for its in-game behavior.") is not a
 * description — the card's wiki link says that already.
 */
export function inGameDescription(weapon: Weapon): string | undefined {
  const lab = weapon.labBehavior
  const pointer = `See the ${weapon.name} wiki page for its in-game behavior.`
  if (lab.kind === 'limitation' && lab.inGameBehavior !== pointer) return tooltipBehavior(lab.inGameBehavior)
  const tooltip = getField(weapon, 'behaviorText')
  return tooltip.status === 'verified' || tooltip.status === 'editorial' ? tooltipBehavior(tooltip.value as string) : undefined
}

const ARCHETYPE_NOUNS: Partial<Record<Archetype, string>> = {
  'swing-melee': 'swung melee weapons',
  thrust: 'thrusting weapons',
  'bow-gun': 'bows and guns',
  'magic-bolt': 'bolt-casting magic weapons',
  returning: 'boomerangs, launched flails and yoyos',
  'piercing-beam': 'piercing shots and held beams',
  'minion-sentry': 'minion and sentry staves',
  whip: 'whips',
}

/**
 * The default limitation card's reason — the pipeline emits it verbatim (pipeline/merge/weapons.ts
 * `LAB_DEFAULT_REASON`; AMENDMENTS-014 B72(a): the design-reviewed string). Every reason is written
 * for players and shown as is.
 */
export const UNASSIGNED_LIMITATION_PLAIN = 'This weapon’s unique behavior isn’t modeled in the Lab.'

const ATTACK_VERBS: Partial<Record<Archetype, string>> = {
  'swing-melee': 'swing',
  thrust: 'thrust',
  'bow-gun': 'shoot',
  'magic-bolt': 'cast',
  returning: 'throw',
  'piercing-beam': 'fire',
  'minion-sentry': 'summon',
  whip: 'whip',
}

/** The verb the Lab's instructions use for the equipped weapon's attack ("Hold Space to swing"). */
export function attackVerb(archetype: Archetype): string {
  return ATTACK_VERBS[archetype] ?? 'attack'
}

/**
 * "swung melee weapons, thrusting weapons, bows and guns, …, and piercing shots and held beams" — what
 * the Lab equips today, from LAB_ARCHETYPES (a serial comma once there are three or more: a noun may
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
  if (refusal.reason === 'limitation' && refusal.limitation) return refusal.limitation.reason
  return refusal.message
}

/** One behavior stat the EquippedBar shows beside damage, use time and crit (from the archetype params). */
export interface BehaviorFact {
  key: 'range' | 'flight' | 'hit-rate' | 'pierce' | 'slots' | 'tag'
  label: string
  /** Compact HUD label. */
  short: string
  value: string
  /** Compact HUD value (default `value`). */
  shortValue?: string
}

/** Tiles with at most two decimals (13.64, 8.13, 12). */
const tiles = (n: number) => String(Number(n.toFixed(2)))

const FLIGHT: Record<'boomerang' | 'flail' | 'yoyo', { value: string; shortValue: string }> = {
  boomerang: { value: 'out & back', shortValue: 'out & back' },
  flail: { value: 'out & back on a chain', shortValue: 'chain' },
  yoyo: { value: 'held out on a string', shortValue: 'held' },
}

/**
 * The equipped weapon's behavior stats from its params (PRD P3-S7 AC2 "projectile count/behavior";
 * P3-S6 pierce count and beam tick rate): a returning weapon's throw range and flight, a held beam's
 * hit interval, a projectile's pierce (extra dummies after the first, B37); a summon's slot cost,
 * attack interval and (sentry) range (P3-S9); a whip's range and tag (P3-S10). Nothing per weapon.
 */
export function behaviorFacts(weapon: Pick<Weapon, 'labBehavior'>): BehaviorFact[] {
  const lab = weapon.labBehavior
  if (lab.kind !== 'archetype') return []
  const p = lab.params
  const pierce = (n: number | 'infinite' | undefined): BehaviorFact[] =>
    n === undefined || n === 0 ? [] : [{ key: 'pierce', label: 'Pierce', short: 'Pierce', value: n === 'infinite' ? 'every dummy' : `+${n} ${n === 1 ? 'dummy' : 'dummies'}`, shortValue: n === 'infinite' ? '∞' : `+${n}` }]
  switch (p.archetype) {
    case 'returning':
      return [
        { key: 'range', label: 'Range', short: 'Rng', value: `${tiles(p.throwRangeTiles)} tiles`, shortValue: `${tiles(p.throwRangeTiles)}t` },
        { key: 'flight', label: 'Flight', short: 'Flight', ...FLIGHT[p.variant] },
      ]
    case 'piercing-beam':
      return p.mode === 'channel-beam'
        ? [{ key: 'hit-rate', label: 'Hits every', short: 'Hit', value: `${p.tickRateTicks} ticks`, shortValue: `${p.tickRateTicks}t` }]
        : pierce(p.pierce)
    case 'magic-bolt':
      return pierce(p.projectile.pierce)
    case 'swing-melee':
      return pierce(p.emitted?.pierce)
    case 'minion-sentry':
      return [
        { key: 'slots', label: 'Slots', short: 'Slot', value: `${tiles(p.slotCost)} ${p.variant} slot${p.slotCost === 1 ? '' : 's'}`, shortValue: tiles(p.slotCost) },
        { key: 'hit-rate', label: 'Attacks every', short: 'Atk', value: `${p.attackRateTicks} ticks`, shortValue: `${p.attackRateTicks}t` },
        ...(p.sentryRangeTiles === undefined ? [] : [{ key: 'range' as const, label: 'Range', short: 'Rng', value: `${tiles(p.sentryRangeTiles)} tiles`, shortValue: `${tiles(p.sentryRangeTiles)}t` }]),
      ]
    case 'whip':
      return [
        { key: 'range', label: 'Range', short: 'Rng', value: `${tiles(p.rangeTiles)} tiles`, shortValue: `${tiles(p.rangeTiles)}t` },
        {
          key: 'tag',
          label: 'Tag',
          short: 'Tag',
          value: `+${p.tagDamageFlat} damage${p.tagCritPct ? `, ${p.tagCritPct}% crit` : ''}`,
          shortValue: `+${p.tagDamageFlat}${p.tagCritPct ? ` ${p.tagCritPct}%` : ''}`,
        },
      ]
    default:
      return []
  }
}

/** Where the card's "how it behaves" link points: the limitation's source, else the weapon page. */
export function behaviorSourceUrl(weapon: Weapon): string {
  return weapon.labBehavior.kind === 'limitation' ? weapon.labBehavior.sourceUrl : weapon.wikiUrl
}
