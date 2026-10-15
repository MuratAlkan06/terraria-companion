/**
 * Candidate filtering primitives (SCORING_SPEC §3, §6 "Improve My Build", §4.6; DATA_SCHEMA_SPEC §4a
 * isObtainableNow; AMENDMENTS-014 B69/Q2, Q4, Q9). Pure TypeScript over records + the progression graph.
 *
 * - Availability (§3.1): gatedBy verified and every gate satisfied under EP → "yes"; a gate unmet →
 *   "gated" with the exact bosses still to defeat; gatedBy absent or Unknown → "unknown" — NEVER "yes".
 *   Non-node conditions (biome / event / time / world) never flip the status; they are always returned
 *   for requirement chips (B69/Q4).
 * - Feature A passes TRACKED-ONLY progress (B69/Q9): `effectiveProgress(graph, progress)` with no stage.
 * - Target-boss cap (§6): items gated by the target boss or any required-gate descendant of it are
 *   omitted from suggestions entirely (mirrors the build-time E_SUGGESTION_GATING rule).
 */
import type { GatedBy, Rarity } from '../schemas'
import { getField } from '../schemas/getField'
import { RARITY_RANK_SPECIAL } from './constants'
import { isNodeSatisfied, requiredAncestors, requiredPredecessors, stepsFromFrontier, type ProgressionGraphLike, type ProgressionNodeLike } from './progress'

export type AvailabilityStatus = 'yes' | 'gated' | 'unknown'

export interface Availability {
  status: AvailabilityStatus
  /** Boss nodes still to defeat (milestones / events resolved to the bosses that open them), sorted. */
  missing: string[]
  /** Condition slugs from gatedBy: requirement chips, never a block (B69/Q4). */
  conditions: string[]
}

export const UNKNOWN_AVAILABILITY: Availability = { status: 'unknown', missing: [], conditions: [] }

const nodeIndexes = new WeakMap<ProgressionGraphLike, ReadonlyMap<string, ProgressionNodeLike>>()
function nodeById(graph: ProgressionGraphLike): ReadonlyMap<string, ProgressionNodeLike> {
  let index = nodeIndexes.get(graph)
  if (!index) {
    index = new Map(graph.nodes.map((n) => [n.id, n]))
    nodeIndexes.set(graph, index)
  }
  return index
}

/**
 * An UNSATISFIED gate node as the bosses to defeat: a boss is itself; a milestone or event resolves
 * through its unmet required-gate predecessors, recursively ("Hardmode" → the Wall of Flesh). A node
 * that resolves to nothing (unknown id, no gates) stays as itself, so it is never dropped silently.
 */
export function gateBosses(graph: ProgressionGraphLike, ep: ReadonlySet<string>, nodeId: string, memo: Map<string, boolean>): string[] {
  const out = new Set<string>()
  const visit = (id: string, path: ReadonlySet<string>) => {
    const node = nodeById(graph).get(id)
    if (!node || node.kind === 'boss') {
      out.add(id)
      return
    }
    const unmet = requiredPredecessors(graph, id).filter((p) => !path.has(p) && !isNodeSatisfied(graph, ep, p, memo))
    if (unmet.length === 0) out.add(id)
    for (const p of unmet) visit(p, new Set(path).add(p))
  }
  visit(nodeId, new Set([nodeId]))
  return [...out]
}

/** isObtainableNow (DATA_SCHEMA_SPEC §4a) under EP — pass tracked-only EP for Feature A. */
export function availabilityOf(
  record: { gatedBy?: GatedBy },
  graph: ProgressionGraphLike,
  ep: ReadonlySet<string>,
  memo: Map<string, boolean> = new Map(),
): Availability {
  const view = getField(record, 'gatedBy')
  if (view.status !== 'verified' && view.status !== 'editorial') return UNKNOWN_AVAILABILITY
  const gatedBy = view.value as GatedBy
  const missing = new Set<string>()
  for (const gate of gatedBy.bosses) {
    if (isNodeSatisfied(graph, ep, gate, memo)) continue
    for (const boss of gateBosses(graph, ep, gate, memo)) missing.add(boss)
  }
  return { status: missing.size > 0 ? 'gated' : 'yes', missing: [...missing].sort(), conditions: [...gatedBy.conditions] }
}

/** The target node and every node it gates along required-gate edges (its required-gate descendants). */
export function targetCapNodes(graph: ProgressionGraphLike, targetNodeId: string): Set<string> {
  const out = new Set([targetNodeId])
  for (const node of graph.nodes) if (requiredAncestors(graph, node.id).has(targetNodeId)) out.add(node.id)
  return out
}

/**
 * How far a gated item's gate sits from the tracked frontier (B94(5)): the farthest of its missing
 * bosses, in sequential boss defeats (stepsFromFrontier). 0 when nothing is missing.
 */
export function gateDistance(
  graph: ProgressionGraphLike,
  ep: ReadonlySet<string>,
  missing: readonly string[],
  memo: Map<string, boolean> = new Map(),
  steps: Map<string, number> = new Map(),
): number {
  return Math.max(0, ...missing.map((id) => stepsFromFrontier(graph, ep, id, memo, steps)))
}

/** §6 target-boss cap: the record is gated by the target or something only the target opens. */
export function isCappedByTarget(record: { gatedBy?: GatedBy }, cap: ReadonlySet<string>): boolean {
  const view = getField(record, 'gatedBy')
  if (view.status !== 'verified' && view.status !== 'editorial') return false
  return (view.value as GatedBy).bosses.some((b) => cap.has(b))
}

// --- §4.6 tie-break total order -----------------------------------------------------------------------

/** rarityRank: numeric tiers as-is, special tiers pinned after 11 (B71), absent last. */
export function rarityRank(rarity: Rarity | undefined): number {
  if (rarity === undefined) return Number.POSITIVE_INFINITY
  return typeof rarity === 'number' ? rarity : RARITY_RANK_SPECIAL[rarity]
}

export interface Rankable {
  score: number
  gateCount: number
  rarity: Rarity | undefined
  /** Item id (number) or set slug — the final total-order key. */
  key: number | string
}

/** §4.6: score desc → gatedBy.bosses.length asc → rarityRank asc → id asc. */
export function compareRankable(a: Rankable, b: Rankable): number {
  return (
    b.score - a.score ||
    a.gateCount - b.gateCount ||
    rarityRank(a.rarity) - rarityRank(b.rarity) ||
    (typeof a.key === 'number' && typeof b.key === 'number' ? a.key - b.key : String(a.key).localeCompare(String(b.key)))
  )
}

/** The number of gates a record names (for the tie-break); Unknown gating counts as none. */
export function gateCount(record: { gatedBy?: GatedBy }): number {
  const view = getField(record, 'gatedBy')
  return view.status === 'verified' || view.status === 'editorial' ? (view.value as GatedBy).bosses.length : 0
}
