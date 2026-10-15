/**
 * Navigation helpers for the armor pages (PRD P6-S1; UX_SPEC §1 `/armor`, `/armor/:id`). Dependency-free and
 * tiny: the search links, the boss pages, the readiness checker and the builder link armor through it without
 * downloading the database chunk (AMENDMENTS-016 B131(b): armor links go in-app).
 *
 * One route, two kinds of id:
 * - a set's slug (`/armor/frost-armor`) — the set page;
 * - an armor piece's item id (`/armor/684`) — a piece IN a set opens its set's page at the piece
 *   (`/armor/frost-armor#piece-684`, replacing the history entry); a piece outside any set has its own page.
 */

/** Where the armor set list comes from (the wiki's armor overview). */
export const ARMOR_SOURCE_URL = 'https://terraria.wiki.gg/wiki/Armor'

/** The armor list route. */
export const ARMOR_PATH = '/armor'

/** A set's page. */
export function armorSetHref(setId: string): string {
  return `${ARMOR_PATH}/${setId}`
}

/** An armor piece: its set's page at the piece, or its own page (see module doc). */
export function armorPieceHref(id: number): string {
  return `${ARMOR_PATH}/${id}`
}

/** The id of a piece's heading on its set page (a hash target, AMENDMENTS-016 B113c). */
export const pieceAnchorId = (id: number): string => `piece-${id}`

/**
 * The "how to obtain" heading on a set / piece page — the same id as AcquisitionView's ACQUISITION_TITLE_ID
 * (`acq-title`), so the readiness checker's "Show Me How to Get It" (`…#acq-title`) lands on it for a set too.
 */
export const ARMOR_ACQUISITION_ID = 'acq-title'
/** The comparison's heading (P6-S1 AC2). */
export const ARMOR_COMPARE_ID = 'armor-compare-title'

/** Query parameters of the set comparison: the other set, and the helmet chosen on each side. */
export const COMPARE_SET_PARAM = 'vs'
export const HELMET_PARAM = 'helmet'
export const COMPARE_HELMET_PARAM = 'vshelmet'

/** A set page comparing it with another (P6-S1 AC2/AC3: "Comparable sets at this stage" link here). */
export function armorCompareHref(setId: string, otherSetId: string): string {
  return `${armorSetHref(setId)}?${COMPARE_SET_PARAM}=${otherSetId}#${ARMOR_COMPARE_ID}`
}

/**
 * The last /armor query string, so "All armor" on a set page returns to the same filtered list (module state:
 * survives in-app navigation, resets on reload).
 */
let lastListSearch = ''
export function rememberArmorListSearch(search: string): void {
  lastListSearch = search
}
export function armorListHref(): string {
  return `${ARMOR_PATH}${lastListSearch}`
}

/** Location state set by list rows, so the page's back link can use history (keeps scroll). */
export interface FromArmorListState {
  fromArmorList: true
}
export function cameFromArmorList(state: unknown): boolean {
  return typeof state === 'object' && state !== null && (state as Partial<FromArmorListState>).fromArmorList === true
}
