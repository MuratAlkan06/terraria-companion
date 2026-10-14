/**
 * Navigation helpers for the boss section (UX_SPEC §3.7). Zod-free: the search links (shell) use them.
 *
 * - Boss pages exist only for the bosses in src/schemas/bossPages.ts (P5-S2: pre-Hardmode); every
 *   other node keeps the map's focus card, so `bossPageHref` is undefined for it (never a dead link).
 * - `bossMapHref(nodeId)` opens the map centred on a node with its focus card open (`?node=`), the
 *   "back into the map at the right position" link of a page's next nodes (PRD P5-S2 AC3).
 */
import { hasBossPage } from '../../../schemas/bossPages'

export const MAP_NODE_PARAM = 'node'

export function bossPageHref(bossId: string): string | undefined {
  return hasBossPage(bossId) ? `/bosses/${bossId}` : undefined
}

export function bossMapHref(nodeId?: string): string {
  return nodeId ? `/bosses?${MAP_NODE_PARAM}=${encodeURIComponent(nodeId)}` : '/bosses'
}
