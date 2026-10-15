/**
 * Navigation helpers for the accessory pages (PRD P6-S2; UX_SPEC §1 `/accessories`, `/accessories/:id`).
 * Dependency-free and tiny: the search links, the boss pages, the readiness checker and the builder link
 * accessories through it without downloading the database chunk (AMENDMENTS-016 B131(b): links go in-app).
 */

/** Where the accessory list comes from (the wiki's accessories overview). */
export const ACCESSORIES_SOURCE_URL = 'https://terraria.wiki.gg/wiki/Accessories'

/** The accessory list route. */
export const ACCESSORIES_PATH = '/accessories'

/** An accessory's page. */
export function accessoryHref(id: number): string {
  return `${ACCESSORIES_PATH}/${id}`
}

/**
 * Section headings a link may name as its hash (AMENDMENTS-016 B113c). `acq-title` is AcquisitionView's
 * ACQUISITION_TITLE_ID, kept a literal so this module stays tiny.
 */
export const ACCESSORY_ACQUISITION_ID = 'acq-title'
export const ACCESSORY_EFFECTS_ID = 'accessory-effects-title'
export const ACCESSORY_TREE_ID = 'accessory-tree-title'
export const ACCESSORY_SECTION_IDS: readonly string[] = [ACCESSORY_ACQUISITION_ID, ACCESSORY_EFFECTS_ID, ACCESSORY_TREE_ID]

/** The last /accessories query string, so "All accessories" returns to the same filtered list. */
let lastListSearch = ''
export function rememberAccessoryListSearch(search: string): void {
  lastListSearch = search
}
export function accessoryListHref(): string {
  return `${ACCESSORIES_PATH}${lastListSearch}`
}

/** Location state set by list rows, so the detail page's back link can use history (keeps scroll). */
export interface FromAccessoryListState {
  fromAccessoryList: true
}
export function cameFromAccessoryList(state: unknown): boolean {
  return typeof state === 'object' && state !== null && (state as Partial<FromAccessoryListState>).fromAccessoryList === true
}
