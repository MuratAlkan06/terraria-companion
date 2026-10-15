import { CircleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { buttonClass } from '../../../components/buttonStyles'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { focusedControl } from '../../../components/focusedControl'
import { ErrorState, SkeletonPanel } from '../../../components/States'
import { useDelayedFlag, useResource } from '../../useResource'
import { useDocumentTitle } from '../../useDocumentTitle'
import NotFoundPage from '../NotFoundPage'
import type { SavedPlan } from '../../../storage/plans'
import { choiceAnnouncement, completionAnnouncement } from './planAnnouncements'
import { generateSteps, planView } from './planModel'
import { loadPlanBase, peekPlanBase, peekPlanGraph, planLookup, resolvePlanGraph, stepNames, type PlanBase } from './planData'
import * as copy from './planCopy'
import { PLAN_PATH } from './planLinks'
import { BackToPlans, Notice, PlanDetail } from './PlanDetail'
import { usePlansStore } from './plansStore'
import { RouteChooser } from './RouteChooser'
import { useAnnouncer } from './useAnnouncer'
import { usePlanComputation } from './usePlan'

/**
 * /plan/:planId (UX_SPEC §1, §3.9; PRD P6-S5/S6): a saved plan, rebuilt from today's data with its choices —
 * every check mark and owned quantity saves immediately (no save button). An id this browser hasn't saved →
 * the styled 404 with a way back to the plans; the plan's item missing from today's data → its saved steps,
 * read-only, and delete.
 *
 * Announcements (AMENDMENTS-016 B118(b)(g)), through one polite live region: the plan completing (or
 * reopening), a way picked / "Decide later" (with the new count), the saved steps updated; a delete is said on
 * the plan list it lands on. Focus never drops to the page: after a way is picked it returns to the button that
 * opened the chooser — or, when that row was rebuilt, to the same item's chooser button in the same pane, else
 * the pane's heading; after "Update the saved steps" it moves to the header's progress line.
 */
const NO_CHOICES: Readonly<Record<string, string>> = {}

export default function PlanPage() {
  const { planId = '' } = useParams()
  const plan = usePlansStore((s) => s.plans.find((p) => p.planId === planId))
  // the 404 sets its own title
  if (!plan) return <NotFoundPage title={copy.PLAN_NOT_FOUND_TITLE} message={copy.PLAN_NOT_FOUND_BODY} action={{ to: PLAN_PATH, label: copy.BACK_TO_PLANS }} />
  return <PlanLoader key={plan.planId} plan={plan} />
}

function PlanLoader({ plan }: { plan: SavedPlan }) {
  const amount = plan.targetAmount ?? 1
  const choices = plan.choices ?? NO_CHOICES
  // the first frame waits for every record the saved plan reaches; later choices load what they open
  const resource = useResource(
    `plan:${plan.planId}`,
    async () => {
      const base = await loadPlanBase()
      await resolvePlanGraph(base, plan.targetItemId, amount, choices)
      return base
    },
    () => {
      const base = peekPlanBase()
      return base && peekPlanGraph(base, plan.targetItemId, amount, choices) ? base : undefined
    },
  )
  const showSkeleton = useDelayedFlag(resource.status === 'loading')
  const name = resource.status === 'ready' ? resource.data.docs.get(`i:${plan.targetItemId}`)?.name : undefined
  useDocumentTitle(name ? copy.planFor(name) : copy.DOC_TITLE)
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6 md:px-6 md:py-8">
      {resource.status === 'ready' ? (
        <PlanBody base={resource.data} plan={plan} />
      ) : resource.status === 'error' ? (
        <>
          <BackToPlans />
          <ErrorState title={copy.LOAD_ERROR} error={resource.error} onRetry={resource.retry} />
        </>
      ) : showSkeleton ? (
        <SkeletonPanel label={copy.LOADING} lines={8} />
      ) : (
        <div className="min-h-[50dvh]" aria-hidden="true" />
      )}
    </div>
  )
}

interface Opener {
  el: HTMLElement | null
  key: string
  /** The pane (or "Compare routes" list) it was in: a rebuilt row's replacement is looked for there first. */
  scope: Element | null
}

function PlanBody({ base, plan }: { base: PlanBase; plan: SavedPlan }) {
  const navigate = useNavigate()
  const { setChecked, setOwned, setChoice, updateSnapshot, setStatus, remove, setFlash, persistError } = usePlansStore()
  const [chooser, setChooser] = useState<string | null>(null)
  const [choiceError, setChoiceError] = useState(false)
  const [announcement, announce] = useAnnouncer()
  const opener = useRef<Opener | null>(null)
  const amount = plan.targetAmount ?? 1
  const choices = plan.choices ?? NO_CHOICES
  const choose = useCallback((key: string, button?: HTMLElement) => {
    const el = button ?? focusedControl()
    opener.current = { el, key, scope: el?.closest('[data-pane], [data-compare-routes]') ?? null }
    setChooser(key)
  }, [])
  const returnFocus = () => {
    const o = opener.current
    if (!o) return null
    if (o.el?.isConnected) return o.el
    const scope = o.scope?.isConnected ? o.scope : document
    return scope.querySelector<HTMLElement>(`[data-choose="${o.key}"], [data-compare-choose="${o.key}"]`) ?? scope.querySelector<HTMLElement>('[data-pane-title]')
  }
  const state = useMemo(() => ({ owned: plan.owned, checkedStepIds: plan.checkedStepIds }), [plan.owned, plan.checkedStepIds])
  const comp = usePlanComputation(base, plan.targetItemId, amount, choices, state, choose)
  const { ctx } = comp

  // §8c: active ↔ done follows the steps (only on a complete plan, never mid-load)
  const status = ctx.view.done ? 'done' : 'active'
  const settled = !comp.loading
  useEffect(() => {
    if (settled && status !== plan.status) setStatus(plan.planId, status)
  }, [settled, status, plan.status, plan.planId, setStatus])

  // B118(b): completing the plan (or reopening it) is announced — not on arrival, and not twice after a pick
  const wasDone = useRef<boolean | null>(null)
  const pickedJustNow = useRef(false)
  useEffect(() => {
    if (!settled) return
    const was = wasDone.current
    wasDone.current = ctx.view.done
    if (pickedJustNow.current) {
      pickedJustNow.current = false
      return
    }
    const message = completionAnnouncement(was, ctx.view)
    if (message) announce(message)
  }, [settled, ctx.view, announce])

  const pick = async (key: string, value: string | null) => {
    const next: Record<string, string> = { ...choices }
    if (value === null) delete next[key]
    else next[key] = value
    try {
      const graph = await resolvePlanGraph(base, plan.targetItemId, amount, next)
      const prog = base.acquisition.progression
      if (prog) {
        const steps = generateSteps(graph, prog, stepNames(base, graph), planLookup(base))
        setChoice(plan.planId, key, value, steps)
        // the pick's own announcement carries the new count (the completion effect stays quiet for it)
        pickedJustNow.current = true
        announce(choiceAnnouncement(base, graph, key, value, planView(graph, steps, state, prog, comp.basis)))
      }
    } catch (error) {
      // a record chunk failed to download: the plan stays as it was (the page's own loads show their error states)
      console.warn('[plans] Couldn’t load the records for that choice; the plan is unchanged.', error)
      setChoiceError(true)
      setChooser(null)
      return
    }
    setChoiceError(false)
    setChooser(null)
  }

  // deleting lands on the plan list, which says (and announces) what was deleted
  const deleteAndLeave = (name: string) => {
    setFlash(copy.deletedNotice(name))
    remove(plan.planId)
    navigate(PLAN_PATH, { replace: true })
  }

  const goal = ctx.graph.nodes.get(ctx.graph.goal)
  if (goal?.kind === 'item' && !goal.record && !goal.pending) {
    return <TargetMissing plan={plan} onDelete={() => deleteAndLeave(copy.MISSING_TARGET_NAME(plan.targetItemId))} />
  }

  return (
    <>
      <PlanDetail
        plan={plan}
        comp={comp}
        persistError={persistError}
        choiceError={choiceError}
        onCheck={(stepId, checked) => setChecked(plan.planId, stepId, checked)}
        onOwned={(key, quantity) => setOwned(plan.planId, key, quantity)}
        onUpdateSnapshot={() => {
          updateSnapshot(plan.planId, comp.steps)
          // the count is today's steps' either way (vanished steps never counted): say it with the update
          announce(copy.updatedAnnounce(ctx.view.complete, ctx.view.total))
        }}
        onDelete={() => deleteAndLeave(ctx.info(ctx.graph.goal).name)}
      />
      <RouteChooser ctx={ctx} nodeKey={chooser} chosen={chooser ? choices[chooser] : undefined} onPick={(key, value) => void pick(key, value)} onClose={() => setChooser(null)} returnFocus={returnFocus} />
      <p role="status" className="sr-only" data-plan-announcer="">
        {announcement}
      </p>
    </>
  )
}

/** The plan's item is gone from today's data: its saved steps as they were (read-only), and delete. */
function TargetMissing({ plan, onDelete }: { plan: SavedPlan; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false)
  const deleteRef = useRef<HTMLButtonElement>(null)
  const name = copy.MISSING_TARGET_NAME(plan.targetItemId)
  return (
    <div className="space-y-4" data-target-missing={plan.targetItemId}>
      <BackToPlans />
      <Notice tone="warn" icon={<CircleAlert className="size-5 text-accent" />} title={copy.TARGET_MISSING_TITLE}>
        <p>{copy.targetMissingBody(plan.targetItemId)}</p>
        <button ref={deleteRef} type="button" onClick={() => setConfirm(true)} className={buttonClass('secondary')} data-delete-plan="">
          {copy.DELETE}
        </button>
      </Notice>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={copy.deleteTitle(name)} description={copy.DELETE_BODY} confirmLabel={copy.DELETE_CONFIRM} onConfirm={onDelete} returnFocus={() => deleteRef.current} />
      <section aria-labelledby="saved-steps" className="space-y-2">
        <h2 id="saved-steps" className="font-display text-sm text-accent">
          {copy.SAVED_STEPS}
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {plan.snapshot.steps.map((s) => (
            <li key={s.stepId}>{s.text}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}
