/**
 * Nav selectors derived from the route registry (data-driven nav, PRD P1-S1 AC2).
 */
import { APP_ROUTES, type AppRoute, type NavMeta, type NavSurface } from './routes'

export interface NavItem extends NavMeta {
  id: string
  to: string
}

/** Max entries in the mobile bottom tab bar, including "More" (UX_SPEC §2, §10.12). */
export const TAB_BAR_MAX = 5

export function navItemsFor(surface: NavSurface, routes: readonly AppRoute[] = APP_ROUTES): NavItem[] {
  return routes
    .filter((r): r is AppRoute & { nav: NavMeta } => r.nav !== undefined && r.nav.surfaces.includes(surface))
    .map((r) => ({ ...r.nav, id: r.id, to: r.path }))
    .sort((a, b) => a.order - b.order)
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
