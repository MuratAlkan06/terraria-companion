/**
 * Nav selectors derived from the route registry (data-driven nav, PRD P1-S1 AC2).
 */
import { matchPath } from 'react-router'
import { APP_ROUTES, type AppRoute, type NavMeta, type NavSurface } from './routes'

export interface NavItem extends NavMeta {
  id: string
  to: string
}

/** Max entries in the mobile bottom tab bar, including "More" (UX_SPEC §2, §10.12). */
export const TAB_BAR_MAX = 5

/**
 * Header links shown inline on desktop; the rest go into the header's "More" menu
 * (AMENDMENTS-007 B29). Holds at every desktop width: measured at 1440, six inline links plus
 * the wordmark and a selected stage chip leave the search under its 240px minimum.
 */
export const HEADER_INLINE_MAX = 3

export function navItemsFor(surface: NavSurface, routes: readonly AppRoute[] = APP_ROUTES): NavItem[] {
  return routes
    .filter((r): r is AppRoute & { nav: NavMeta } => r.nav !== undefined && r.nav.surfaces.includes(surface))
    .map((r) => ({ ...r.nav, id: r.id, to: r.path }))
    .sort((a, b) => a.order - b.order)
}

/** Splits header nav: the first HEADER_INLINE_MAX links inline, the overflow in a "More" menu. */
export function headerNavLayout(routes: readonly AppRoute[] = APP_ROUTES): { inline: NavItem[]; more: NavItem[] } {
  const items = navItemsFor('header', routes)
  return { inline: items.slice(0, HEADER_INLINE_MAX), more: items.slice(HEADER_INLINE_MAX) }
}

/**
 * Splits nav for the mobile tab bar: up to TAB_BAR_MAX tabs; when a "More" sheet is
 * needed it takes the last tab slot and receives any tab overflow first.
 */
export function tabBarLayout(routes: readonly AppRoute[] = APP_ROUTES): { tabs: NavItem[]; more: NavItem[] } {
  const tabCandidates = navItemsFor('tabbar', routes)
  const moreOnly = navItemsFor('more', routes)
  const needsMore = moreOnly.length > 0 || tabCandidates.length > TAB_BAR_MAX
  const tabSlots = needsMore ? TAB_BAR_MAX - 1 : TAB_BAR_MAX
  const tabs = tabCandidates.slice(0, tabSlots)
  const more = [...tabCandidates.slice(tabSlots), ...moreOnly]
  return { tabs, more }
}

/**
 * Whether a nav link is the current section — NavLink's own matching: "/" only exactly, every other
 * link also for its sub-paths (/guides/first-boss-prep is in Guides). The mobile "More" sheet and its
 * trigger use it too (AMENDMENTS-015 B82: guide pages highlighted "More" nowhere).
 */
export function isNavCurrent(to: string, pathname: string): boolean {
  return matchPath({ path: to, end: to === '/' }, pathname) !== null
}
