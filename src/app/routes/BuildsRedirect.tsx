import { Navigate } from 'react-router'
import { BUILDS_VIEW_HREF } from './loadout/loadoutLinks'

/**
 * `/builds` (UX_SPEC §1) — the saved-builds list ships as the builder's `?view=builds` sub-view (P4-S4), so the
 * route is a redirect there: the More sheet's "Builds" entry (UX_SPEC §2; AMENDMENTS-016 B111 R5) needs a
 * registered path. Eager and tiny (no builder code).
 */
export default function BuildsRedirect() {
  return <Navigate to={BUILDS_VIEW_HREF} replace />
}
