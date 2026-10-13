/**
 * Navigation helpers shared by the weapons list and detail pages.
 */

/** Where the weapons list came from (P2-S2 weapon set = wiki weapon-typed items, B21). */
export const WEAPONS_SOURCE_URL = 'https://terraria.wiki.gg/wiki/Category:Weapon_items'

/** Detail route for a weapon id. */
export function weaponHref(id: number): string {
  return `/weapons/${id}`
}

/**
 * The last /weapons query string, so "All weapons" on a detail page returns to the same
 * filtered list (module state: survives in-app navigation, resets on reload).
 */
let lastListSearch = ''
export function rememberListSearch(search: string): void {
  lastListSearch = search
}
export function listHref(): string {
  return `/weapons${lastListSearch}`
}

/** Location state set by list rows, so the detail page's back link can use history (keeps scroll). */
export interface FromListState {
  fromList: true
}
export function cameFromList(state: unknown): boolean {
  return typeof state === 'object' && state !== null && (state as Partial<FromListState>).fromList === true
}
