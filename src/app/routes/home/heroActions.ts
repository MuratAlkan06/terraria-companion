import { Backpack, FlaskConical, Map as MapIcon, type LucideIcon } from 'lucide-react'
import { hasRoute, pathFor } from '../../routes'

/**
 * The homepage hero's primary actions (UX_SPEC §3.2). Each exists only once its target route
 * ships (PRD P1-S2 AC3 — absent, never disabled), read from the route registry like the nav:
 * P3-S1 adds "Test Weapons" → /lab; "Build My Loadout" and "What Should I Do Next?" arrive with
 * /loadout and /bosses.
 */
export interface PrimaryAction {
  routeId: string
  label: string
  icon: LucideIcon
  /** Query string appended to the route path (e.g. "?recommend=1"). */
  search?: string
}

const PRIMARY_ACTIONS: readonly PrimaryAction[] = [
  { routeId: 'loadout', label: 'Build My Loadout', icon: Backpack },
  { routeId: 'lab', label: 'Test Weapons', icon: FlaskConical },
  { routeId: 'bosses', label: 'What Should I Do Next?', icon: MapIcon, search: '?recommend=1' },
]

/** The hero's actions whose target routes are registered, with their link targets. */
export function heroActions(): (PrimaryAction & { to: string })[] {
  return PRIMARY_ACTIONS.filter((action) => hasRoute(action.routeId)).map((action) => ({
    ...action,
    to: `${pathFor(action.routeId)}${action.search ?? ''}`,
  }))
}
