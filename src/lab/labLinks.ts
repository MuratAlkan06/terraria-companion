/**
 * The Weapon Lab's entry points from other pages (weapon detail "Test in Weapon Lab"; later the
 * Compare page): the deep-link format and a data-only "does the Lab equip this?" check.
 *
 * Deliberately NO runtime imports (types only): pages outside the Lab must not download the sim
 * engine or the Zod schemas it pulls in (ADR-001 D7 — measured at +42 KB gz on /weapons/:id). The
 * engine's full verdict (`labStatus` in ./labWeapons.ts) runs when the Lab opens, and
 * labWeapons.test.ts proves both checks agree on every weapon in the dataset; if they ever
 * diverged, the Lab would show its LimitationCard — a designed state, never a broken equip.
 */
import type { Archetype, Weapon } from '../schemas'

/**
 * Archetypes the Lab UI equips today: the ones whose attack the arena draws from the engine's blade
 * pose — swing-melee (P3-S1) and thrust (AMENDMENTS-010 B47; spears and shortswords light up as soon
 * as the data gives them params, with no UI change). Grows with the ammo (P3-S4) and
 * projectile/mana (P3-S5) tools.
 */
export const LAB_ARCHETYPES: readonly Archetype[] = ['swing-melee', 'thrust']

/** The Lab's deep-link query parameter (`/lab?weapon=:id`, UX_SPEC §10.11). */
export const LAB_WEAPON_PARAM = 'weapon'

/** Query string that equips a weapon in the Lab (append to the Lab route's path). */
export function labWeaponSearch(weaponId: number): string {
  return `?${new URLSearchParams({ [LAB_WEAPON_PARAM]: String(weaponId) })}`
}

/**
 * True when the weapon's record gives the Lab an archetype it can equip (pipeline-authored params)
 * and needs nothing the Lab doesn't load yet: a damage-over-time modifier needs the buff registry.
 */
export function offersLab(weapon: Weapon): boolean {
  const lab = weapon.labBehavior
  return lab.kind === 'archetype' && LAB_ARCHETYPES.includes(lab.params.archetype) && lab.modifiers?.dot === undefined
}
