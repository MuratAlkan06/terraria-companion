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
 * Archetypes the Lab UI equips: swing-melee (P3-S1) and thrust (AMENDMENTS-010 B47) draw the
 * engine's blade pose; bow-gun (P3-S4, with its ammo picker) and magic-bolt (P3-S5, with mana) draw
 * the engine's projectiles. Weapons light up as soon as their data gives them params, with no UI change.
 */
export const LAB_ARCHETYPES: readonly Archetype[] = ['swing-melee', 'thrust', 'bow-gun', 'magic-bolt']

/** The Lab's deep-link query parameter (`/lab?weapon=:id`, UX_SPEC §10.11). */
export const LAB_WEAPON_PARAM = 'weapon'

/** Query string that equips a weapon in the Lab (append to the Lab route's path). */
export function labWeaponSearch(weaponId: number): string {
  return `?${new URLSearchParams({ [LAB_WEAPON_PARAM]: String(weaponId) })}`
}

/**
 * True when the weapon's record gives the Lab an archetype it can equip (pipeline-authored params).
 * The Lab loads the ammo and the buff registry itself; whether the data offers usable ammo or a
 * verified debuff is the engine's call (`labStatus`), which agrees with this on the whole dataset.
 */
export function offersLab(weapon: Weapon): boolean {
  const lab = weapon.labBehavior
  return lab.kind === 'archetype' && LAB_ARCHETYPES.includes(lab.params.archetype)
}
