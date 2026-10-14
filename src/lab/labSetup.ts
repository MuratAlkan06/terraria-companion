/**
 * What the Lab hands the engine besides the weapon (src/sim README "LabSimOptions"): ammo for bows
 * and guns (PRD P3-S4), the buff registry for damage-over-time weapons (AMENDMENTS-012 follow-up:
 * Stylish Scissors, Brand of the Inferno, Frost Staff), and where the target stands. Pure (no DOM,
 * no renderer): Node-tested against the committed data. Nothing here is per weapon — every decision
 * reads the records, so a weapon or ammo that gains data lights up with no UI change.
 *
 * Ammo (PRD P3-S4 AC2): the picker lists ONLY ammo whose `ammoStats.ammoClass` is the weapon's, and
 * of those only what the engine itself fires — each candidate is checked with `createLabSim`, so ammo
 * without verified damage (e.g. Gel) is refused by the engine, never assumed. Order: damage, then id.
 *
 * Default ammo (documented choice): the ammo class's NAMESAKE item — the pipeline names every class
 * after its representative item (src/data-access `ItemNames.bySlug`), and that item is the class's
 * basic tier: Wooden Arrow for arrows, Musket Ball for bullets. If the namesake can't be fired, the
 * weakest usable ammo (the list's first) stands in.
 *
 * Target placement (Lab choice, labeled `target-distance` in src/lab/labAssumptions.ts): melee
 * archetypes keep the engine's point-blank dummy (README "Units and coordinates"); weapons that fire
 * projectiles face the same Infinite Dummy RANGED_TARGET_X_TILES away, so a shot visibly travels
 * before it lands (PRD P3-S4 AC1) — at point-blank a shot crosses the 1-tile gap within its first
 * tick and is never seen. Spread shots can miss at this range, as they would in-game from there.
 */
import type { Archetype, Buff, Item, Weapon } from '../schemas'
import { createLabSim, DEFAULT_DUMMY, type DummySpec, type SimRefusal } from '../sim'

export interface LabSetup {
  /** Every ammo item in the data (Item records that carry `ammoStats`). */
  readonly ammo: readonly Item[]
  /** The buff registry (resolves `modifiers.dot.buffId` → damage per second). */
  readonly buffs: readonly Buff[]
}

/** No ammo, no buffs: weapons that need either can't be equipped (their card says why). */
export const EMPTY_LAB_SETUP: LabSetup = Object.freeze({ ammo: [], buffs: [] })

export function labSetup(items: Iterable<Item>, buffs: readonly Buff[]): LabSetup {
  return { ammo: [...items].filter((item) => item.ammoStats !== undefined), buffs }
}

/** The ammo class a weapon fires (its bow-gun params), or null for weapons that use no ammo. */
export function ammoClassOf(weapon: Weapon): string | null {
  const lab = weapon.labBehavior
  return lab.kind === 'archetype' && lab.params.archetype === 'bow-gun' ? lab.params.ammoClass : null
}

export interface AmmoChoices {
  ammoClass: string
  /** Compatible ammo the engine fires from this weapon, by damage then id. */
  usable: readonly Item[]
  /** Compatible ammo the engine refuses (data it needs isn't verified), with its reason. */
  refused: readonly { item: Item; refusal: SimRefusal }[]
  /** The namesake (basic tier) when usable, else the weakest usable ammo; null when none is. */
  defaultAmmo: Item | null
}

/** Ammo the engine accepts is about the ammo and the weapon's firing data — not its debuff. */
function withoutModifiers(weapon: Weapon): Weapon {
  const lab = weapon.labBehavior
  if (lab.kind !== 'archetype' || lab.modifiers === undefined) return weapon
  return { ...weapon, labBehavior: { kind: 'archetype', params: lab.params } }
}

const ammoCache = new WeakMap<LabSetup, WeakMap<Weapon, AmmoChoices | null>>()

/** The weapon's ammo picker (null for weapons that use no ammo). Cached per setup and weapon. */
export function ammoChoices(weapon: Weapon, setup: LabSetup): AmmoChoices | null {
  let perSetup = ammoCache.get(setup)
  if (!perSetup) ammoCache.set(setup, (perSetup = new WeakMap()))
  if (perSetup.has(weapon)) return perSetup.get(weapon) ?? null
  const ammoClass = ammoClassOf(weapon)
  let choices: AmmoChoices | null = null
  if (ammoClass !== null) {
    const firing = withoutModifiers(weapon)
    const usable: Item[] = []
    const refused: { item: Item; refusal: SimRefusal }[] = []
    for (const item of setup.ammo) {
      if (item.ammoStats?.ammoClass !== ammoClass) continue
      const created = createLabSim({ weapon: firing, ammo: item })
      if (created.ok) usable.push(item)
      else refused.push({ item, refusal: created.refusal })
    }
    usable.sort((a, b) => (a.ammoStats?.damage ?? 0) - (b.ammoStats?.damage ?? 0) || a.id - b.id)
    refused.sort((a, b) => a.item.name.localeCompare(b.item.name, 'en') || a.item.id - b.item.id)
    const namesake = usable.find((item) => item.slug === ammoClass)
    choices = { ammoClass, usable, refused, defaultAmmo: namesake ?? usable[0] ?? null }
  }
  perSetup.set(weapon, choices)
  return choices
}

/** An ammo class's display name: its namesake item's name (the class is named after it), else the slug in words. */
export function ammoClassName(choices: AmmoChoices): string {
  const namesake = [...choices.usable, ...choices.refused.map((r) => r.item)].find((item) => item.slug === choices.ammoClass)
  if (namesake) return namesake.name
  const words = choices.ammoClass.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The ammo to load: the user's choice when it is one of the weapon's usable ammo, else the default. */
export function resolveAmmo(weapon: Weapon, setup: LabSetup, chosenId?: number | null): Item | null {
  const choices = ammoChoices(weapon, setup)
  if (!choices) return null
  return choices.usable.find((item) => item.id === chosenId) ?? choices.defaultAmmo
}

/** Archetypes that attack with the weapon itself (blade pose); everything else fires projectiles. */
const POINT_BLANK_ARCHETYPES: readonly Archetype[] = ['swing-melee', 'thrust']

/** Ranged target: the Infinite Dummy's centre this many tiles in front of the player (face at 5). */
export const RANGED_TARGET_X_TILES = 6

export const firesProjectiles = (archetype: Archetype): boolean => !POINT_BLANK_ARCHETYPES.includes(archetype)

/** The dummies the Lab places for an archetype (undefined = the engine's default point-blank dummy). */
export function labDummiesFor(archetype: Archetype): DummySpec[] | undefined {
  return firesProjectiles(archetype) ? [{ ...DEFAULT_DUMMY, x: RANGED_TARGET_X_TILES }] : undefined
}
