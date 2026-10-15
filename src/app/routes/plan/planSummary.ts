/**
 * A saved plan's progress as ONE semantics everywhere (AMENDMENTS-016 B118(a)): the plan page's "N of M
 * complete" — the plan rebuilt from today's data with its choices, every step's status under the player's
 * progress (checked, owned, no longer needed, boss counted as defeated). The plan list shows exactly this, so
 * it can never say "Done" beside a partial count.
 */
import type { Stage } from '../../stages'
import type { TrackedProgress } from '../../../scoring/progress'
import type { SavedPlan } from '../../../storage/plans'
import { generateSteps, planView, progressBasis } from './planModel'
import { peekPlanGraph, planLookup, resolvePlanGraph, stepNames, type PlanBase } from './planData'

export type PlanSummary =
  | { kind: 'progress'; complete: number; total: number; done: boolean }
  /** The plan's item isn't in today's data (its page lists the saved steps read-only). */
  | { kind: 'target-missing' }

const choicesOf = (plan: SavedPlan) => plan.choices ?? {}

/** Loads every record the plans reach (each plan's graph resolved), so `planSummary` is synchronous after. */
export async function resolvePlanSummaries(base: PlanBase, plans: readonly SavedPlan[]): Promise<void> {
  await Promise.all(plans.map((p) => resolvePlanGraph(base, p.targetItemId, p.targetAmount ?? 1, choicesOf(p))))
}

/** Whether every plan's records are loaded (the list's first frame can count without waiting). */
export function summariesReady(base: PlanBase, plans: readonly SavedPlan[]): boolean {
  return plans.every((p) => peekPlanGraph(base, p.targetItemId, p.targetAmount ?? 1, choicesOf(p)) !== undefined)
}

/** The plan's progress (undefined while a record it reaches isn't loaded). */
export function planSummary(base: PlanBase, plan: SavedPlan, progress: TrackedProgress, stage: Stage | null): PlanSummary | undefined {
  const graph = peekPlanGraph(base, plan.targetItemId, plan.targetAmount ?? 1, choicesOf(plan))
  const prog = base.acquisition.progression
  if (!graph || !prog) return undefined
  const goal = graph.nodes.get(graph.goal)
  if (goal?.kind === 'item' && !goal.record) return { kind: 'target-missing' }
  const steps = generateSteps(graph, prog, stepNames(base, graph), planLookup(base))
  const view = planView(graph, steps, { owned: plan.owned, checkedStepIds: plan.checkedStepIds }, prog, progressBasis(prog, progress, stage))
  return { kind: 'progress', complete: view.complete, total: view.total, done: view.done }
}
