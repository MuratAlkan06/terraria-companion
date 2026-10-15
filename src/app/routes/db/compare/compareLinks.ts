/**
 * The weapon comparison's deep link (PRD P4-S1 AC5; UX_SPEC §1, §10.11): `/compare?w=4956,757,1308`.
 * Dependency-free on purpose: weapon pages link here without downloading the compare chunk.
 */

/** The query parameter holding the compared weapon ids, comma-separated, in column order. */
export const COMPARE_PARAM = 'w'

/** PRD P4-S1 AC1 / UX_SPEC §1, §3.6: two or three weapons side by side. */
export const COMPARE_MAX = 3

/** The comparison route's path (registered in src/app/routes.tsx as id "compare"). */
export const COMPARE_PATH = '/compare'

/**
 * Query string for a comparison of `ids` ("" for none). Commas stay literal (not %2C) so a shared link
 * reads like the UX_SPEC example; URLSearchParams decodes either form.
 */
export function compareSearch(ids: readonly number[]): string {
  return ids.length > 0 ? `?${COMPARE_PARAM}=${ids.join(',')}` : ''
}

/** Link to the comparison with `ids` in it (a weapon page's "Compare" passes its own id). */
export function compareHref(ids: readonly number[]): string {
  return `${COMPARE_PATH}${compareSearch(ids)}`
}
