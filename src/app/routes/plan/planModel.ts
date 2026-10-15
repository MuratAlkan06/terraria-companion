/**
 * Feature B view model (PRD P6-S5 AC2/AC3, P6-S6 AC1–AC4, §9 Feature B AC2; UX_SPEC §3.9, §6 "Plan
 * quantities"): a plan graph + the saved plan's state (owned quantities, checked steps) + the player's progress
 * → every step's status and remaining amount, the checklist groups, the progress count, each item's
 * availability, and the progress basis the page states.
 *
 * Availability (PRD §9 Feature B AC2 — "computed from the user's stated stage + tracked boss defeats"):
 * EffectiveProgress = tracked defeats ∪ the selected stage's virtual defeats (SCORING_SPEC §2.4; the
 * builder's semantics, B69/Q9 — Feature A's tracked-only rule is for its improvement suggestions). Without a
 * selected stage it is tracked defeats only. Per item: src/scoring `availabilityOf` — "yes" only when the
 * verified gating is satisfied; "gated" names the exact bosses still to defeat; Unknown gating stays Unknown
 * (never obtainable, never blocked). Non-node conditions are requirement chips, never a block (B69/Q4).
 *
 * Step status: checked (by the user) · owned (owned quantity covers it) · covered (nothing above needs it any
 * more: something it goes into is checked or owned) · progress (a boss marked defeated, or assumed by the
 * stage) · open. A step is complete unless open; the plan is done when every step is complete.
 */
import type { ProgressionData } from '../../../data-access/types'
import type { GatedBy } from '../../../schemas'
import { getField } from '../../../schemas/getField'
import { availabilityOf, gateBosses, type Availability } from '../../../scoring/candidates'
import { effectiveProgress, isNodeSatisfied, trackedDefeats, type TrackedProgress } from '../../../scoring/progress'
import type { SavedPlan } from '../../../storage/plans'
import { STAGE_IDS, type Stage } from '../../stages'
import { computeDemand, planGateSlugs, planSteps, type NodeDemand, type PlanGraph, type PlanLookup, type PlanNode, type PlanStep, type StepNames } from './planTree'

export interface ProgressBasis {
  stage: Stage | null
  /** Bosses marked defeated that count in this world (boss nodes only — milestones and events aren't bosses). */
  tracked: string[]
  /** Bosses implied by the stage (tracked ones not repeated; the Hardmode milestone and events aren't listed). */
  virtual: string[]
  ep: ReadonlySet<string>
  memo: Map<string, boolean>
}

/** Progression order for lists of bosses: by stage, then the graph's own order. */
function progressionRank(graph: ProgressionData, id: string): number {
  const index = graph.nodes.findIndex((n) => n.id === id)
  const stage = (STAGE_IDS as readonly string[]).indexOf(graph.nodeById.get(id)?.stage ?? '')
  return (stage < 0 ? STAGE_IDS.length : stage) * 1000 + (index < 0 ? 999 : index)
}

export function progressBasis(graph: ProgressionData, progress: TrackedProgress, stage: Stage | null): ProgressBasis {
  const tracked = trackedDefeats(graph, progress)
  const ep = effectiveProgress(graph, progress, stage)
  const byOrder = (a: string, b: string) => progressionRank(graph, a) - progressionRank(graph, b)
  // the basis is said as "bosses" (B118(j)): EP keeps every node, the lists name boss nodes only
  const boss = (id: string) => graph.nodeById.get(id)?.kind === 'boss'
  return { stage, tracked: [...tracked].filter(boss).sort(byOrder), virtual: [...ep].filter((id) => !tracked.has(id) && boss(id)).sort(byOrder), ep, memo: new Map() }
}

export interface BossGate {
  id: string
  name: string
  /** Plan nodes whose verified gating names it (directly or through a milestone). */
  for: string[]
}

/**
 * The bosses the plan's items are gated behind (verified gatedBy, milestones resolved to their bosses with
 * nothing assumed defeated — so the steps don't move with progress), in progression order.
 */
export function bossGates(plan: PlanGraph, graph: ProgressionData): BossGate[] {
  const out = new Map<string, BossGate>()
  const none = new Set<string>()
  const memo = new Map<string, boolean>()
  for (const slug of planGateSlugs(plan)) {
    for (const boss of gateBosses(graph, none, slug, memo)) {
      if (!out.has(boss)) out.set(boss, { id: boss, name: graph.nodeById.get(boss)?.name ?? boss, for: [] })
    }
  }
  for (const key of plan.order) {
    const node = plan.nodes.get(key)
    if (node?.kind !== 'item' || !node.record) continue
    const view = getField(node.record, 'gatedBy')
    if (view.status !== 'verified' && view.status !== 'editorial') continue
    for (const slug of (view.value as GatedBy).bosses) for (const boss of gateBosses(graph, none, slug, memo)) out.get(boss)?.for.push(key)
  }
  return [...out.values()].sort((a, b) => progressionRank(graph, a.id) - progressionRank(graph, b.id))
}

/** The plan's steps as generated from today's data and the plan's choices (structural: nothing owned or checked). */
export function generateSteps(plan: PlanGraph, graph: ProgressionData, names: StepNames, lookup: Pick<PlanLookup, 'drop'>): PlanStep[] {
  return planSteps(plan, { boss: (id) => graph.nodeById.get(id)?.name, ...names }, lookup, bossGates(plan, graph))
}

export type StepStatus = 'open' | 'checked' | 'owned' | 'covered' | 'progress'

export interface StepState {
  step: PlanStep
  /** The plan node it stands for (absent for boss steps). */
  node?: PlanNode
  demand?: NodeDemand
  status: StepStatus
  /** Still to get (0 unless open; boss steps: undefined). */
  remaining?: number
  /** Boss steps: how the boss counts as defeated ("tracked" on the boss map, or assumed by the "stage"). */
  bossBasis?: 'tracked' | 'stage'
  /** Boss steps: the plan's items whose verified gating names this boss — the basis the step was derived from (B118(e)). */
  neededFor?: string[]
}

export interface StepGroup {
  key: string
  steps: StepState[]
}

export interface PlanView {
  steps: StepState[]
  groups: StepGroup[]
  complete: number
  total: number
  done: boolean
  demand: Map<string, NodeDemand>
  /** Availability of every item node under the plan's progress basis. */
  availability: Map<string, Availability>
  /** Item nodes by availability status (the goal included). */
  counts: { yes: number; gated: number; unknown: number }
}

/** Group order on the checklist (P6-S6 AC2): bosses, choices, drop sources / vendors / other ways, crafting, the rest. */
const GROUP_RANK = (key: string): number => {
  if (key === 'bosses') return 0
  if (key === 'choose') return 1
  if (key.startsWith('boss:')) return 2
  if (key.startsWith('source:')) return 3
  if (key === 'drops') return 4
  if (key.startsWith('vendor')) return 5
  if (key === 'loot') return 6
  if (key === 'fishing') return 7
  if (key === 'other') return 8
  if (key === 'craft') return 9
  if (key === 'stops') return 10
  return 11 // unknown
}

export interface PlanState {
  owned: Readonly<Record<string, number>>
  checkedStepIds: readonly string[]
}

export function planView(plan: PlanGraph, steps: readonly PlanStep[], state: PlanState, graph: ProgressionData, basis: ProgressBasis): PlanView {
  const checked = new Set(state.checkedStepIds)
  const done = new Set<string>()
  for (const step of steps) if (step.kind !== 'defeat-boss' && checked.has(step.stepId)) done.add(step.refs[0])
  const demand = computeDemand(plan, { owned: state.owned, done })

  const availability = new Map<string, Availability>()
  const counts = { yes: 0, gated: 0, unknown: 0 }
  for (const key of plan.order) {
    const node = plan.nodes.get(key)
    if (node?.kind !== 'item') continue
    const a = node.record ? availabilityOf(node.record, graph, basis.ep, basis.memo) : { status: 'unknown' as const, missing: [], conditions: [] }
    availability.set(key, a)
    counts[a.status]++
  }

  const gates = new Map(bossGates(plan, graph).map((g) => [g.id, g]))
  const states: StepState[] = steps.map((step) => {
    if (step.kind === 'defeat-boss' && step.nodeId) {
      const gate = gates.get(step.nodeId)
      const satisfied = isNodeSatisfied(graph, basis.ep, step.nodeId, basis.memo)
      const neededBy = gate?.for.filter((k) => (demand.get(k)?.need ?? 0) > 0) ?? []
      const status: StepStatus = checked.has(step.stepId) ? 'checked' : satisfied ? 'progress' : gate && neededBy.length === 0 ? 'covered' : 'open'
      return {
        step,
        status,
        neededFor: [...new Set(gate?.for ?? [])],
        ...(satisfied ? { bossBasis: basis.tracked.includes(step.nodeId) ? ('tracked' as const) : ('stage' as const) } : {}),
      }
    }
    const key = step.refs[0]
    const node = plan.nodes.get(key)
    const d = demand.get(key)
    if (!node || !d) return { step, status: checked.has(step.stepId) ? 'checked' : 'open', remaining: step.amount }
    const status: StepStatus = d.checked ? 'checked' : d.need > 0 ? 'open' : d.total === 0 ? 'covered' : d.owned >= d.total ? 'owned' : 'covered'
    return { step, node, demand: d, status, remaining: d.need }
  })

  const byGroup = new Map<string, StepState[]>()
  for (const s of states) {
    const list = byGroup.get(s.step.groupKey) ?? []
    list.push(s)
    byGroup.set(s.step.groupKey, list)
  }
  const groups = [...byGroup.entries()]
    .map(([key, list]) => ({ key, steps: list }))
    .sort((a, b) => GROUP_RANK(a.key) - GROUP_RANK(b.key) || (GROUP_RANK(a.key) === 9 ? 0 : a.key.localeCompare(b.key)))

  const complete = states.filter((s) => s.status !== 'open').length
  return { steps: states, groups, complete, total: states.length, done: states.length > 0 && complete === states.length, demand, availability, counts }
}

/** The non-reference children drawn under a node in the tree (each item is drawn once, where first reached). */
function drawnChildren(plan: PlanGraph, node: PlanNode): PlanNode[] {
  return node.edges.filter((e) => !e.circular).map((e) => plan.nodes.get(e.to)).filter((n): n is PlanNode => n !== undefined && n.treeParent === node.key)
}

/**
 * The tree's covered subtrees (AMENDMENTS-016 B118(h)): items complete themselves (checked, owned, or no longer
 * needed) with items drawn beneath them, every one of which — recursively — is no longer needed (need 0). The
 * tree collapses each to ONE summary note. Value: how many items are drawn beneath. A subtree holding an item
 * still needed elsewhere (drawn here, used by another branch too) never collapses: nothing needed is hidden.
 */
export function coveredSubtrees(plan: PlanGraph, view: Pick<PlanView, 'demand'>, stepOf: (key: string) => StepState | undefined): Map<string, number> {
  const out = new Map<string, number>()
  const memo = new Map<string, { covered: boolean; count: number }>()
  const walk = (node: PlanNode): { covered: boolean; count: number } => {
    const seen = memo.get(node.key)
    if (seen) return seen
    let covered = true
    let count = 0
    for (const child of drawnChildren(plan, node)) {
      const sub = walk(child)
      count += 1 + sub.count
      if ((view.demand.get(child.key)?.need ?? 0) > 0 || !sub.covered) covered = false
    }
    const result = { covered, count }
    memo.set(node.key, result)
    return result
  }
  for (const node of plan.nodes.values()) {
    const { covered, count } = walk(node)
    const status = stepOf(node.key)?.status
    if (count > 0 && covered && status !== undefined && status !== 'open' && status !== 'progress') out.set(node.key, count)
  }
  return out
}

/** Snapshot drift: today's steps vs the saved ones (ids), and a game-version change. */
export interface SnapshotDrift {
  added: number
  removed: number
  versionChanged: boolean
}

export function snapshotDrift(saved: SavedPlan['snapshot'], current: readonly PlanStep[], gameVersion: string): SnapshotDrift | undefined {
  const before = new Set(saved.steps.map((s) => s.stepId))
  const now = new Set(current.map((s) => s.stepId))
  const added = [...now].filter((id) => !before.has(id)).length
  const removed = [...before].filter((id) => !now.has(id)).length
  const versionChanged = saved.gameVersion !== gameVersion
  return added > 0 || removed > 0 || versionChanged ? { added, removed, versionChanged } : undefined
}
