import { useEffect, useMemo, useState } from 'react'
import { useProgressStore } from '../../progressStore'
import { useSelectedStage } from '../../settingsStore'
import { generateSteps, planView, progressBasis, type PlanState, type StepState } from './planModel'
import { loadPlanRecords, makeInfo, planLookup, stepNames, type PlanBase } from './planData'
import { buildPlanGraph, computeDemand } from './planTree'
import type { PlanCtx } from './PlanTreeView'

/**
 * The plan for a goal under the user's choices: built synchronously from the records loaded so far; when the
 * walk reaches records not loaded (a new choice opened a new branch), they load and the plan rebuilds.
 */
export function usePlanGraph(base: PlanBase, goalId: number, amount: number, choices: Readonly<Record<string, string>>) {
  const [version, setVersion] = useState(0)
  const [error, setError] = useState<unknown>(undefined)
  const choicesKey = JSON.stringify(choices)
  const graph = useMemo(
    () => buildPlanGraph(goalId, amount, JSON.parse(choicesKey) as Record<string, string>, planLookup(base)),
    // `version` rebuilds once records arrive
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [base, goalId, amount, choicesKey, version],
  )
  useEffect(() => {
    if (graph.missing.size === 0) return
    let cancelled = false
    loadPlanRecords(base, graph.missing).then(
      () => !cancelled && setVersion((v) => v + 1),
      (e: unknown) => !cancelled && setError(e),
    )
    return () => {
      cancelled = true
    }
  }, [graph, base])
  return {
    graph,
    loading: graph.missing.size > 0 && error === undefined,
    error,
    retry: () => {
      setError(undefined)
      setVersion((v) => v + 1)
    },
  }
}

export interface PlanComputation {
  ctx: PlanCtx
  steps: ReturnType<typeof generateSteps>
  basis: ReturnType<typeof progressBasis>
  loading: boolean
  error: unknown
  retry: () => void
}

/** Everything a plan view shows: the graph, its steps, their states under the user's progress, names and pictures. */
export function usePlanComputation(base: PlanBase, goalId: number, amount: number, choices: Readonly<Record<string, string>>, state: PlanState, choose?: (key: string) => void): PlanComputation {
  const progress = useProgressStore((s) => s.progress)
  const stage = useSelectedStage()
  const { graph, loading, error, retry } = usePlanGraph(base, goalId, amount, choices)
  const prog = base.acquisition.progression ?? EMPTY_GRAPH
  const basis = useMemo(() => progressBasis(prog, progress, stage), [prog, progress, stage])
  const steps = useMemo(() => generateSteps(graph, prog, stepNames(base, graph), planLookup(base)), [graph, prog, base])
  const structural = useMemo(() => computeDemand(graph), [graph])
  const { owned, checkedStepIds } = state
  const view = useMemo(() => planView(graph, steps, { owned, checkedStepIds }, prog, basis), [graph, steps, owned, checkedStepIds, prog, basis])
  const info = useMemo(() => makeInfo(base, graph), [base, graph])
  const stepOf = useMemo(() => {
    const byKey = new Map<string, StepState>()
    for (const s of view.steps) if (s.step.kind !== 'defeat-boss') byKey.set(s.step.refs[0], s)
    return (key: string) => byKey.get(key)
  }, [view])
  const ctx = useMemo<PlanCtx>(() => ({ base, graph, structural, view, basis, info, stepOf, ...(choose ? { choose } : {}) }), [base, graph, structural, view, basis, info, stepOf, choose])
  return { ctx, steps, basis, loading, error, retry }
}

const EMPTY_GRAPH = { nodes: [], edges: [], nodeById: new Map() }
