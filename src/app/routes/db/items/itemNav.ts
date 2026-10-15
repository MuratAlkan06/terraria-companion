/**
 * Navigation helpers shared by the item encyclopedia's list and detail pages (and every surface that
 * links an Item record: search rows, boss-page drop rows, recipe materials). Zod-free and tiny: the shell's
 * search links import it.
 */

/** Where the encyclopedia's item set comes from (the wiki's item infobox table; P6-S0 corpus). */
export const ITEMS_SOURCE_URL = 'https://terraria.wiki.gg/wiki/Items'

/** Detail route for an Item record id. */
export function itemHref(id: number): string {
  return `/items/${id}`
}

/** The encyclopedia route. */
export const ITEMS_PATH = '/items'

/**
 * Section headings of /items/:id a link may name as its hash (AMENDMENTS-016 B113c: `/items/188#acq-title`
 * from the readiness checker). `acq-title` is AcquisitionView's ACQUISITION_TITLE_ID, kept a literal so
 * this module stays tiny (src/app/useHashTarget.test.ts pins the parity).
 */
export const ITEM_ACQUISITION_ID = 'acq-title'
export const ITEM_STATS_TITLE_ID = 'item-stats-title'
export const ITEM_USED_TITLE_ID = 'item-used-title'
export const ITEM_SECTION_IDS: readonly string[] = [ITEM_ACQUISITION_ID, ITEM_USED_TITLE_ID, ITEM_STATS_TITLE_ID]

/**
 * The last /items query string, so "All items" on a detail page returns to the same filtered list
 * (module state: survives in-app navigation, resets on reload).
 */
let lastListSearch = ''
export function rememberItemListSearch(search: string): void {
  lastListSearch = search
}
export function itemListHref(): string {
  return `${ITEMS_PATH}${lastListSearch}`
}

/** Location state set by list rows, so the detail page's back link can use history (keeps scroll). */
export interface FromItemListState {
  fromItemList: true
}
export function cameFromItemList(state: unknown): boolean {
  return typeof state === 'object' && state !== null && (state as Partial<FromItemListState>).fromItemList === true
}
