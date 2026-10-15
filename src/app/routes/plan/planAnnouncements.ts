/**
 * What the plan page's polite live region says (AMENDMENTS-016 B118(b)(g)) — pure, so the wording and the
 * when are tested without a browser: the plan completing or reopening (never on arrival, never when nothing
 * changed), and a way picked or left for later, with the plan's new count.
 */
import * as copy from './planCopy'
import { makeInfo, type PlanBase } from './planData'
import type { PlanView } from './planModel'
import { wayLabel } from './planText'
import type { PlanGraph } from './planTree'

/** `was`: done before this change (null = the page just arrived). */
export function completionAnnouncement(was: boolean | null, view: Pick<PlanView, 'done' | 'complete' | 'total'>): string | undefined {
  if (was === null || was === view.done) return undefined
  return view.done ? copy.DONE_ANNOUNCE : copy.reopenedAnnounce(view.complete, view.total)
}

/**
 * What a pick did, in words, with the plan's new count. `graph` / `view`: the plan after the pick. "Decide later"
 * (value null) says where the item really went: back to an open choice, or back to its listed way.
 */
export function choiceAnnouncement(base: PlanBase, graph: PlanGraph, key: string, value: string | null, view: Pick<PlanView, 'complete' | 'total'>): string {
  const info = makeInfo(base, graph)
  const node = graph.nodes.get(key)
  const name = info(key).name
  if (!node) return copy.laterAnnounce(name, view.complete, view.total)
  if (node.kind === 'group') return node.member !== undefined ? copy.memberAnnounce(name, info(`i:${node.member}`).name, view.complete, view.total) : copy.laterAnnounce(name, view.complete, view.total)
  if (node.selection.kind !== 'route') return copy.laterAnnounce(name, view.complete, view.total)
  const way = wayLabel(node, node.selection.route, base)
  return value === null ? copy.defaultAnnounce(name, way, view.complete, view.total) : copy.routeAnnounce(name, way, view.complete, view.total)
}
