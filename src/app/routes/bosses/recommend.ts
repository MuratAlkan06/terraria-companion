/**
 * "What Should I Do Next?" (PRD P5-S5; UX_SPEC §3.7, §4d; AMENDMENTS-014 B69/Q6). Pure: the
 * progression graph + tracked progress + world evil (+ the selected stage as context) → two lists.
 *
 * PROGRESS is TRACKED ONLY (src/scoring/progress.ts effectiveProgress without a stage, the map's own
 * view — B69/Q6, Q9): the panel explains the map beside it, so both agree on what is done and open.
 * The selected stage never assumes defeats here; it is display context (`stageNote`).
 *
 * REQUIRED BEFORE YOU CAN PROGRESS — the GOAL is the next milestone not yet reached (flow order), or,
 * past the last one, the map's final node (the node with the most required-gate ancestors: Moon
 * Lord). Its unsatisfied required-gate ancestors that are bosses in play (milestones and events are
 * derived, B86a), plus the goal itself when it is a boss, in flow order. Reason: what the fight is
 * needed for on that path — through a milestone that opens a single fight, that fight (the
 * mechanical bosses → Plantera); the wiki sentence behind the link as evidence.
 *
 * RECOMMENDED ORDER — open, unmarked bosses in play, outside the required list, placed by a link from
 * something done (the map's `done`: satisfied — a mark counts where countsInWorld says, AMENDMENTS-016 B128):
 * - the usual next steps: a recommended-next link (or a bare required-gate link). One the player has
 *   evidently moved past — a fight further along the main path is already marked — is left out.
 * - optional fights: an `optional` link, no later than the next main-path step's stage (Queen Bee and
 *   Deerclops wait until Skeletron, a Late Pre-Hardmode fight, is next); those from a stage before the
 *   progress stage come last, said to be still open from it.
 * Links that are only an early challenge (Hardmode → Duke Fishron, Plantera → Empress of Light) never
 * recommend a fight: those come in through their later, optional links (after Golem).
 * World evil: only the chosen world's boss; with none chosen ("Both") the pair is ONE fork-choice
 * item; once either is marked, the pair is settled.
 *
 * PROGRESS STAGE — the furthest stage of what is done (reached milestones, marked main-path bosses).
 * The selected stage gets a note only when it is outside the span from there to the next main-path
 * step. FRONTIER — the nodes the map opens framed on when anything is tracked (B86d): the usual next
 * steps, else the open required fights at the next step's stage; once the required path is done, its
 * end.
 */
import { STAGE_IDS, type Stage } from '../../stages'
import { groupOf, isNodeActive, stageName, WORLD_EVIL_LABEL, type MapGraph, type MapLink, type MapNode, type NodeState, type WorldEvil } from '../../../components/nodeMap/graph'
import { bossesToMark, canSkip, flowIncoming, flowOrder, mapProgress, type NodeStatus } from '../../../components/nodeMap/progressView'
import { effectiveProgress, isNodeSatisfied, requiredAncestors } from '../../../scoring/progress'
import { quoteLead, quoteTrail } from './bossPageModel'
import * as copy from './recommendCopy'

export interface RecommendEvidence {
  /** The edge's note: a verbatim wiki sentence. */
  text: string
  sourceUrl: string
  /** Display only, before a sentence cut mid-way: its subject in brackets, or an ellipsis (bossPageModel.quoteLead). */
  lead?: string
  /** Display only, after a sentence pinned as cut at the end: an ellipsis (bossPageModel.quoteTrail). */
  trail?: string
}

/** required: on the required path · next: the usual next step · optional: a side fight. */
export type RecommendKind = 'required' | 'next' | 'optional'

export interface RecommendItem {
  /** Node id, or the fork members' ids joined with "|". */
  key: string
  kind: RecommendKind
  /** One node — or, for the world-evil fork with no world evil chosen, every member. */
  nodes: readonly MapNode[]
  /** The map status of the (first) node (progressView). */
  status: NodeStatus
  /** A locked fight: the bosses still to mark before it opens (names, the map's own list). */
  needs: readonly string[]
  /** One line, from the graph (recommendCopy). */
  reason: string
  /** The wiki sentence behind the link that places this fight here. */
  evidence?: RecommendEvidence
  /** An optional fight from a stage before the progress stage. */
  earlier: boolean
}

export interface Recommendation {
  /** fresh: nothing marked · complete: nothing left in either list. */
  state: 'fresh' | 'progress' | 'complete'
  required: RecommendItem[]
  recommended: RecommendItem[]
  /** Where the required list leads (a milestone, or the final node); absent only without data. */
  goal?: MapNode
  /** The goal is reached (the required list is empty). */
  goalDone: boolean
  /** The furthest stage of what is marked done. */
  progressStage: Stage
  /** The selected stage, when it is behind what's done or ahead of what's next (display context). */
  stageNote?: { selected: Stage; relation: 'ahead' | 'behind' }
  /** Every in-play boss is marked (defeated or skipped). */
  allMarked: boolean
  /** Node ids the map opens framed on (B86d); undefined when nothing is marked (the usual opening). */
  frontier?: readonly string[]
}

const stageIndex = (stage: string) => Math.max(0, (STAGE_IDS as readonly string[]).indexOf(stage))

/** Types that put a fight on the main path once their source is done. */
const isMainLink = (link: MapLink) => link.types.includes('recommended-next') || link.types.includes('required-gate')

/** The map's final node: the one with the most required-gate ancestors (ties: later in flow order). */
export function finalNode(graph: MapGraph): string | undefined {
  let best: { id: string; count: number } | undefined
  for (const id of flowOrder(graph)) {
    const count = requiredAncestors(graph.progression, id).size
    if (!best || count >= best.count) best = { id, count }
  }
  return best?.id
}

export function recommend(
  graph: MapGraph,
  nodeStates: Readonly<Record<string, NodeState>>,
  worldEvil: WorldEvil | null,
  selectedStage: Stage | null = null,
): Recommendation {
  const progression = graph.progression
  const progress = mapProgress(graph, nodeStates, worldEvil)
  // Tracked only (B69/Q6): no stage passed, so nothing is assumed defeated.
  const ep = effectiveProgress(progression, { worldEvil, nodeStates })
  const memo = new Map<string, boolean>()
  const satisfied = (id: string) => isNodeSatisfied(progression, ep, id, memo)
  const marked = (id: string) => nodeStates[id] !== undefined
  // The map's `done` (B128): satisfied — a mark of the other world's evil boss places nothing.
  const done = satisfied
  const order = flowOrder(graph)
  const rank = new Map(order.map((id, i) => [id, i]))
  const byFlow = (a: string, b: string) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0)
  const nodeOf = (id: string) => graph.nodeById.get(id)
  const nameOf = (id: string) => nodeOf(id)?.name ?? id
  const inPlay = (id: string) => {
    const node = nodeOf(id)
    return !!node && isNodeActive(node, worldEvil)
  }
  const isBoss = (id: string) => nodeOf(id)?.kind === 'boss'
  const statusOf = (id: string): NodeStatus => progress.nodes.get(id) ?? 'available'
  const quoted = (edge: { from: string; to: string; note?: string; sourceUrl: string } | undefined): RecommendEvidence | undefined => {
    if (!edge?.note) return undefined
    const lead = quoteLead(edge.note, edge.sourceUrl, [nameOf(edge.from), nameOf(edge.to)])
    const trail = quoteTrail(edge.note, edge.sourceUrl)
    return { text: edge.note, sourceUrl: edge.sourceUrl, ...(lead ? { lead } : {}), ...(trail ? { trail } : {}) }
  }
  const evidenceOf = (from: string, to: string, type: string): RecommendEvidence | undefined =>
    quoted(progression.edges.find((e) => e.from === from && e.to === to && e.type === type))

  /* --- Required before you can progress ------------------------------------------------------ */

  const goalId = order.find((id) => nodeOf(id)?.kind === 'milestone' && !satisfied(id)) ?? finalNode(graph)
  const goalDone = goalId === undefined || satisfied(goalId)
  const path = new Set(goalId && !goalDone ? [...requiredAncestors(progression, goalId), goalId] : [])
  const requiredIds = [...path].filter((id) => isBoss(id) && inPlay(id) && !satisfied(id)).sort(byFlow)
  const requiredSet = new Set(requiredIds)

  /** The fights still to mark before `target` opens, other than `self`. */
  const partnersFor = (target: string, self: string) => bossesToMark(graph, progress, target).filter((id) => id !== self).map(nameOf)

  const requiredReason = (id: string): { reason: string; evidence?: RecommendEvidence } => {
    if (id === goalId) {
      const into = progression.edges.filter((e) => e.to === id && e.type === 'required-gate').sort((a, b) => byFlow(a.from, b.from))[0]
      return { reason: copy.LAST_REQUIRED, evidence: into ? evidenceOf(into.from, id, 'required-gate') : undefined }
    }
    const next = progression.edges
      .filter((e) => e.from === id && e.type === 'required-gate' && path.has(e.to))
      .map((e) => e.to)
      .sort(byFlow)[0]
    if (!next) return { reason: copy.LAST_REQUIRED }
    const partners = partnersFor(next, id)
    if (nodeOf(next)?.kind === 'milestone') {
      // A milestone that opens a single fight is that fight's gate (All mechanical bosses → Plantera).
      const onward = progression.edges.filter((e) => e.from === next && e.type === 'required-gate' && isBoss(e.to))
      if (onward.length === 1) return { reason: copy.neededFor(nameOf(onward[0].to), partners), evidence: evidenceOf(next, onward[0].to, 'required-gate') }
      return { reason: copy.neededToReach(nameOf(next), partners), evidence: evidenceOf(id, next, 'required-gate') }
    }
    return { reason: copy.neededFor(nameOf(next), partners), evidence: evidenceOf(id, next, 'required-gate') }
  }

  /** Names in flow order, either/or partners joined into one "A or B" entry. */
  const namesOf = (ids: readonly string[]): string[] => {
    const out: string[] = []
    const seen = new Set<string>()
    for (const id of [...ids].sort(byFlow)) {
      if (seen.has(id)) continue
      const pair = (groupOf(graph, id) ?? [id]).filter((m) => ids.includes(m))
      pair.forEach((m) => seen.add(m))
      out.push(pair.map(nameOf).join(` ${copy.OR} `))
    }
    return out
  }

  const required: RecommendItem[] = requiredIds.map((id) => {
    const status = statusOf(id)
    const { reason, evidence } = requiredReason(id)
    // The map's recommended order may put it after fights not done (the Wall of Flesh after Skeletron).
    const before = namesOf(
      flowIncoming(graph, id)
        .filter((l) => l.types.includes('recommended-next') && !done(l.from) && isBoss(l.from) && inPlay(l.from))
        .map((l) => l.from),
    )
    return {
      key: id,
      kind: 'required',
      nodes: [nodeOf(id)!],
      status,
      needs: status === 'locked' ? bossesToMark(graph, progress, id).map(nameOf) : [],
      reason: before.length > 0 ? `${reason} ${copy.usuallyAfterHint(before)}` : reason,
      evidence,
      earlier: false,
    }
  })

  /* --- Recommended order ---------------------------------------------------------------------- */

  /** Every node further along the main path (required-gate / recommended-next links; a fork reaches all its members). */
  const mainDescendants = (id: string): Set<string> => {
    const seen = new Set<string>()
    const stack = [id]
    while (stack.length > 0) {
      const from = stack.pop()!
      for (const link of graph.links) {
        if (link.from !== from || !isMainLink(link)) continue
        const group = groupOf(graph, link.to)
        for (const to of group && group[0] === link.to ? group : [link.to]) {
          if (!seen.has(to)) {
            seen.add(to)
            stack.push(to)
          }
        }
      }
    }
    return seen
  }
  // Moved past: a defeat further along that counts in this world (ep: tracked, countsInWorld — B128).
  const passed = (id: string) => [...mainDescendants(id)].some((d) => ep.has(d))
  /** A world-evil pair is settled once either fight in play is marked. */
  const settledFork = (id: string) => (groupOf(graph, id) ?? []).some((m) => m !== id && inPlay(m) && marked(m))

  interface Candidate {
    id: string
    link: MapLink
  }
  const next: Candidate[] = []
  const optional: Candidate[] = []
  for (const id of order) {
    if (!isBoss(id) || marked(id) || !inPlay(id) || requiredSet.has(id)) continue
    const status = statusOf(id)
    if (status !== 'recommended' && status !== 'available') continue
    if (settledFork(id)) continue
    const links = flowIncoming(graph, id).filter((l) => done(l.from) && !l.types.includes('early-challenge-possible'))
    const main = links.find((l) => l.types.includes('recommended-next')) ?? links.find((l) => l.types.includes('required-gate') && !l.types.includes('optional'))
    const side = links.find((l) => l.types.includes('optional'))
    if (main) {
      if (!passed(id)) next.push({ id, link: main })
    } else if (side) optional.push({ id, link: side })
  }

  // Progress stage: what is done, and the earliest next main-path step.
  let doneStage = 0
  for (const node of graph.nodes) {
    const reached = node.kind === 'milestone' && satisfied(node.id)
    const fought = node.kind === 'boss' && nodeStates[node.id] === 'defeated' && inPlay(node.id) && !canSkip(graph, node.id)
    if (reached || fought) doneStage = Math.max(doneStage, stageIndex(node.stage))
  }
  const openRequired = requiredIds.filter((id) => statusOf(id) !== 'locked')
  const nextSteps = [...next.map((c) => c.id), ...openRequired]
  const stageNow = nextSteps.length > 0 ? Math.max(doneStage, Math.min(...nextSteps.map((id) => stageIndex(nodeOf(id)!.stage)))) : doneStage

  const nextItems: RecommendItem[] = []
  const forked = new Set<string>()
  for (const { id, link } of next) {
    if (forked.has(id)) continue
    const node = nodeOf(id)!
    const source = nodeOf(link.from)!
    const group = groupOf(graph, id)
    const members = group ? group.filter((m) => next.some((c) => c.id === m)) : [id]
    const viaNext = link.types.includes('recommended-next')
    const lead = viaNext ? (source.kind === 'milestone' ? copy.firstOf(source.name) : copy.usuallyNext(source.name)) : copy.openedBy(source.name)
    // The pair's either/or link, between the fork's root and a member.
    const forkEvidence = (member: string) => {
      const alt = graph.altLinks.find((l) => (l.from === group?.[0] && l.to === member) || (l.to === group?.[0] && l.from === member))
      return quoted(alt?.edges[0])
    }
    if (members.length > 1) {
      members.forEach((m) => forked.add(m))
      const nodes = members.map((m) => nodeOf(m)!)
      nextItems.push({
        key: members.join('|'),
        kind: 'next',
        nodes,
        status: statusOf(members[0]),
        needs: [],
        reason: viaNext
          ? copy.forkChoice(
              source.name,
              nodes.map((n) => ({ name: n.name, world: n.worldEvil ? WORLD_EVIL_LABEL[n.worldEvil] : '' })),
            )
          : lead,
        evidence: forkEvidence(members.find((m) => m !== group?.[0]) ?? members[0]),
        earlier: false,
      })
      continue
    }
    const type = viaNext ? 'recommended-next' : 'required-gate'
    // A fork member reached through its pair's root: the either/or sentence, not the root's own.
    const evidence = link.to === id ? evidenceOf(link.from, id, type) : forkEvidence(id)
    nextItems.push({
      key: id,
      kind: 'next',
      nodes: [node],
      status: statusOf(id),
      needs: [],
      reason: node.worldEvil && worldEvil ? `${lead} ${copy.inWorld(WORLD_EVIL_LABEL[node.worldEvil])}` : lead,
      evidence,
      earlier: false,
    })
  }

  const optionalItems: RecommendItem[] = optional
    .filter(({ id }) => stageIndex(nodeOf(id)!.stage) <= stageNow)
    .map(({ id, link }) => {
      const node = nodeOf(id)!
      const earlier = stageIndex(node.stage) < doneStage
      return {
        key: id,
        kind: 'optional' as const,
        nodes: [node],
        status: statusOf(id),
        needs: [],
        reason: earlier ? copy.optionalEarlier(stageName(node.stage)) : copy.OPTIONAL,
        evidence: evidenceOf(link.from, id, 'optional'),
        earlier,
      }
    })
    // At the progress stage first (in stage order); then the earlier ones, the most recent stage first.
    .sort((a, b) => {
      const stages = stageIndex(a.nodes[0].stage) - stageIndex(b.nodes[0].stage)
      return Number(a.earlier) - Number(b.earlier) || (a.earlier ? -stages : stages) || byFlow(a.key, b.key)
    })

  const recommended = [...nextItems, ...optionalItems]

  /* --- Context and the map's opening frame ---------------------------------------------------- */

  const fresh = Object.keys(nodeStates).every((id) => !nodeOf(id))
  const allMarked = graph.nodes.every((n) => n.kind !== 'boss' || !inPlay(n.id) || marked(n.id))
  const atStage = openRequired.filter((id) => stageIndex(nodeOf(id)!.stage) >= stageNow)
  const frontierIds =
    nextItems.length > 0
      ? nextItems.flatMap((item) => item.nodes.map((n) => n.id))
      : atStage.length > 0
        ? atStage
        : openRequired.length > 0
          ? openRequired
          : goalDone && goalId // the required path is done: open on its end
            ? [goalId]
            : []
  // The selected stage agrees with the progress anywhere from what's done to what's next.
  const selected = selectedStage ? stageIndex(selectedStage) : undefined
  const relation = selected === undefined ? undefined : selected < doneStage ? 'behind' : selected > stageNow ? 'ahead' : undefined
  return {
    state: fresh ? 'fresh' : required.length === 0 && recommended.length === 0 ? 'complete' : 'progress',
    required,
    recommended,
    goal: goalId ? nodeOf(goalId) : undefined,
    goalDone,
    progressStage: STAGE_IDS[doneStage] ?? STAGE_IDS[0],
    stageNote: selectedStage && relation ? { selected: selectedStage, relation } : undefined,
    allMarked,
    frontier: fresh || frontierIds.length === 0 ? undefined : frontierIds,
  }
}
