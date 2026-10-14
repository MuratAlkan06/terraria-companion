import type { NodeState } from '../../../components/nodeMap/graph'

/** Progress-state wording in the map's focus card (display only in P5-S1: nothing marks a defeat). */
export const STATE_LABEL: Readonly<Record<'not-attempted' | NodeState, string>> = {
  'not-attempted': 'Not attempted',
  defeated: 'Defeated',
  skipped: 'Skipped',
}

/** States plainly that the map tracks nothing — no promise of a later feature. */
export const DISPLAY_ONLY_NOTE = 'Display only: defeats can’t be marked on this map.'

/** The boss page's progress line, same rule (P5-S2: display only). */
export const PAGE_DISPLAY_ONLY_NOTE = 'Display only: defeats can’t be marked on this page.'

/** The focus card's link to a boss page (pre-Hardmode bosses, P5-S2). */
export const OPEN_PAGE_LABEL = (name: string) => `Open the ${name} page`
