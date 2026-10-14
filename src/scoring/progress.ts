/**
 * EffectiveProgress and gate satisfaction (SCORING_SPEC §2.4 + §7 `progress.ts`; AMENDMENTS-006 B24;
 * AMENDMENTS-014 B69/Q6, Q9). Pure TypeScript over the progression graph — no React, DOM, sim or lab
 * (SCORING_SPEC §8.3 boundary) — shared by the boss map and boss pages (P5-S4), the recommender
 * (P5-S5), the loadout builder (P4) and Feature A.
 *
 *   EffectiveProgress(progress, stage, worldEvil) = trackedDefeated ∪ VirtualDefeats(stage, worldEvil)
 *   VirtualDefeats(S, evil) = { n | STAGE_ORDER[n.stage] < STAGE_ORDER[S]
 *                                   ∧ n is a required-gate ancestor of ≥ 1 node with stage ≥ S }
 *
 * - Required-gate DAG only. Optional bosses are never required-gate ancestors, so a stage never
 *   assumes them defeated (under-recommend).
 * - World evil (B69/Q6): the Eater of Worlds / Brain of Cthulhu count only through a TRACKED defeat of
 *   the node matching the chosen world evil; with no world evil chosen, neither counts (conservative).
 *   They are never virtual.
 * - Milestone / event gates are satisfied iff all their required-gate predecessors are (recursive,
 *   memoized) — B24: Hardmode is reached once the Wall of Flesh is defeated. A node listed in EP
 *   (tracked or virtual) is satisfied as listed.
 * - Scope split (binding, B69/Q9): omit `stage` for TRACKED-ONLY progress (Feature A improvements,
 *   the boss map, GateBadges); pass the user's stage for tracked ∪ virtual (the loadout builder).
 */
import { STAGE_IDS } from '../app/stages'

export type WorldEvil = 'corruption' | 'crimson'
export type TrackedNodeState = 'defeated' | 'skipped'

/** The fields of a ProgressionNode this module reads (src/schemas/progression.ts). */
export interface ProgressionNodeLike {
  id: string
  kind: 'boss' | 'event' | 'milestone'
  stage: string
  worldEvil?: WorldEvil
}

/** The fields of a ProgressionEdge this module reads. */
export interface ProgressionEdgeLike {
  from: string
  to: string
  type: string
}

export interface ProgressionGraphLike {
  nodes: readonly ProgressionNodeLike[]
  edges: readonly ProgressionEdgeLike[]
}

/** tc.v1.progress data (DATA_SCHEMA_SPEC §8a ProgressV1): absent node = not attempted. */
export interface TrackedProgress {
  worldEvil: WorldEvil | null
  nodeStates: Readonly<Record<string, TrackedNodeState>>
}

/** Per-graph runtime index (SCORING_SPEC §7 "requiredGateAncestors"), built once per graph object. */
interface ProgressionIndex {
  nodeById: ReadonlyMap<string, ProgressionNodeLike>
  requiredPredecessors: ReadonlyMap<string, readonly string[]>
  ancestors: Map<string, ReadonlySet<string>>
}

const indexes = new WeakMap<ProgressionGraphLike, ProgressionIndex>()

function indexOf(graph: ProgressionGraphLike): ProgressionIndex {
  const cached = indexes.get(graph)
  if (cached) return cached
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]))
  const requiredPredecessors = new Map<string, string[]>()
  for (const e of graph.edges) {
    if (e.type !== 'required-gate' || !nodeById.has(e.from) || !nodeById.has(e.to)) continue
    const list = requiredPredecessors.get(e.to) ?? []
    if (!list.includes(e.from)) list.push(e.from)
    requiredPredecessors.set(e.to, list)
  }
  const index: ProgressionIndex = { nodeById, requiredPredecessors, ancestors: new Map() }
  indexes.set(graph, index)
  return index
}

/** A node's direct required-gate predecessors (its gates), in data order. */
export function requiredPredecessors(graph: ProgressionGraphLike, nodeId: string): readonly string[] {
  return indexOf(graph).requiredPredecessors.get(nodeId) ?? []
}

/** Every node upstream of `nodeId` along required-gate edges (memoized per graph). */
export function requiredAncestors(graph: ProgressionGraphLike, nodeId: string): ReadonlySet<string> {
  const index = indexOf(graph)
  const visit = (id: string, path: Set<string>): ReadonlySet<string> => {
    const known = index.ancestors.get(id)
    if (known) return known
    const out = new Set<string>()
    for (const p of index.requiredPredecessors.get(id) ?? []) {
      if (path.has(p)) continue // never on a DAG; a malformed cycle must not recurse forever
      out.add(p)
      for (const a of visit(p, new Set(path).add(p))) out.add(a)
    }
    index.ancestors.set(id, out)
    return out
  }
  return visit(nodeId, new Set([nodeId]))
}

const stageOrder = (stage: string) => (STAGE_IDS as readonly string[]).indexOf(stage)

/** World-evil nodes count only when they match the chosen world evil (none when nothing is chosen). */
function countsInWorld(node: ProgressionNodeLike, worldEvil: WorldEvil | null): boolean {
  return node.worldEvil === undefined || (worldEvil !== null && node.worldEvil === worldEvil)
}

/** The nodes the player has marked defeated (skipped never counts), filtered by the world-evil rule. */
export function trackedDefeats(graph: ProgressionGraphLike, progress: TrackedProgress): Set<string> {
  const { nodeById } = indexOf(graph)
  const out = new Set<string>()
  for (const [id, state] of Object.entries(progress.nodeStates)) {
    const node = nodeById.get(id)
    if (state === 'defeated' && node && countsInWorld(node, progress.worldEvil)) out.add(id)
  }
  return out
}

/**
 * VirtualDefeats(S, evil): what a hypothetical stage implies was defeated. A world-evil node is never
 * virtual — whatever the world evil, it counts only through a tracked defeat (B69/Q6) — so `evil`
 * never adds a node; it stays in the signature to match the spec's formula.
 */
export function virtualDefeats(graph: ProgressionGraphLike, stage: string, _worldEvil: WorldEvil | null): Set<string> {
  const { nodeById } = indexOf(graph)
  const target = stageOrder(stage)
  const out = new Set<string>()
  if (target < 0) return out
  for (const node of graph.nodes) {
    if (stageOrder(node.stage) < target) continue
    for (const id of requiredAncestors(graph, node.id)) {
      const ancestor = nodeById.get(id)
      if (ancestor && ancestor.worldEvil === undefined && stageOrder(ancestor.stage) < target) out.add(id)
    }
  }
  return out
}

/**
 * EffectiveProgress: tracked defeats, plus the stage's virtual defeats when a stage is given. Omit the
 * stage (or pass null) for tracked-only progress (B69/Q9 scope split).
 */
export function effectiveProgress(graph: ProgressionGraphLike, progress: TrackedProgress, stage?: string | null): Set<string> {
  const ep = trackedDefeats(graph, progress)
  if (stage) for (const id of virtualDefeats(graph, stage, progress.worldEvil)) ep.add(id)
  return ep
}

/**
 * Is a gate node satisfied under EP? A boss: iff in EP. A milestone or event: iff in EP, or all its
 * required-gate predecessors are satisfied (recursive; a milestone with no gates is reached from the
 * start). `memo` caches every node evaluated on the way — pass one Map per EP to share the work across
 * calls (SCORING_SPEC §7 "satisfiedNodeCache"). Unknown ids are never satisfied.
 */
export function isNodeSatisfied(
  graph: ProgressionGraphLike,
  ep: ReadonlySet<string>,
  nodeId: string,
  memo: Map<string, boolean> = new Map(),
): boolean {
  const index = indexOf(graph)
  const visit = (id: string, path: ReadonlySet<string>): boolean => {
    const known = memo.get(id)
    if (known !== undefined) return known
    const node = index.nodeById.get(id)
    let satisfied: boolean
    if (!node) satisfied = false
    else if (ep.has(id)) satisfied = true
    else if (node.kind === 'boss') satisfied = false
    else {
      satisfied = (index.requiredPredecessors.get(id) ?? []).every((p) => !path.has(p) && visit(p, new Set(path).add(p)))
    }
    memo.set(id, satisfied)
    return satisfied
  }
  return visit(nodeId, new Set([nodeId]))
}

/** Every satisfied node of the graph under EP (one shared memo). */
export function satisfiedNodes(graph: ProgressionGraphLike, ep: ReadonlySet<string>): Set<string> {
  const memo = new Map<string, boolean>()
  return new Set(graph.nodes.filter((n) => isNodeSatisfied(graph, ep, n.id, memo)).map((n) => n.id))
}

/** A node's gates that are not satisfied under EP (what must be done before it). */
export function unmetGates(graph: ProgressionGraphLike, ep: ReadonlySet<string>, nodeId: string, memo: Map<string, boolean> = new Map()): string[] {
  return requiredPredecessors(graph, nodeId).filter((p) => !isNodeSatisfied(graph, ep, p, memo))
}
