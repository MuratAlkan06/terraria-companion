import { Backpack, FlaskConical, Map as MapIcon, type LucideIcon } from 'lucide-react'
import { APP_ROUTES, hasRoute, pathFor } from '../../routes'
import { RECOMMEND_PARAM } from '../bosses/bossNav'

/**
 * The homepage hero's primary actions (UX_SPEC §3.2). Each exists only once its target ships
 * (PRD P1-S2 AC3 — absent, never disabled), read from the route registry like the nav:
 * P3-S1 added "Test Weapons" → /lab; "Build My Loadout" arrives with /loadout. "What Should I Do
 * Next?" targets the recommender panel ON /bosses (`?recommend=1`), so it needs that route's
 * `recommend` feature (shipped with P5-S5), not just the route (the map, P5-S1).
 */
export interface PrimaryAction {
  routeId: string
  label: string
  icon: LucideIcon
  /** Query string appended to the route path (e.g. "?recommend=1"). */
  search?: string
  /** In-page capability the action opens; it must be listed in the route's `features`. */
  feature?: string
}

const PRIMARY_ACTIONS: readonly PrimaryAction[] = [
  { routeId: 'loadout', label: 'Build My Loadout', icon: Backpack },
  { routeId: 'lab', label: 'Test Weapons', icon: FlaskConical },
  { routeId: 'bosses', label: 'What Should I Do Next?', icon: MapIcon, search: `?${RECOMMEND_PARAM}=1`, feature: 'recommend' },
]

function ships(action: PrimaryAction): boolean {
  if (!hasRoute(action.routeId)) return false
  if (action.feature === undefined) return true
  return APP_ROUTES.find((r) => r.id === action.routeId)?.features?.includes(action.feature) ?? false
}

/** The hero's actions whose targets ship, with their link targets. */
export function heroActions(): (PrimaryAction & { to: string })[] {
  return PRIMARY_ACTIONS.filter(ships).map((action) => ({
    ...action,
    to: `${pathFor(action.routeId)}${action.search ?? ''}`,
  }))
}
