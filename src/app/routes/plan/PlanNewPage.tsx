import { CircleAlert, ClipboardList } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { buttonClass } from '../../../components/buttonStyles'
import { PixelPanel } from '../../../components/PixelPanel'
import { ErrorState, SkeletonPanel } from '../../../components/States'
import { parseItemId } from '../../../data-access'
import { useSelectedStage } from '../../settingsStore'
import { useDelayedFlag, useResource } from '../../useResource'
import { useDocumentTitle } from '../../useDocumentTitle'
import NotFoundPage from '../NotFoundPage'
import { loadPlanBase, peekPlanBase, peekPlanGraph, resolvePlanGraph, type PlanBase } from './planData'
import * as copy from './planCopy'
import { PICKED_STATE, PLAN_AMOUNT_PARAM, PLAN_ITEM_PARAM, PLAN_NEW_PATH, planHref } from './planLinks'
import { BackToPlans, BasisNote, GoalIdentity, Notice, PlanNotices } from './PlanDetail'
import { GoalPicker } from './GoalPicker'
import { OwnedQtyInput } from './PlanBits'
import { LINK } from './planText'
import { usePlansStore } from './plansStore'
import { PlanTreeView } from './PlanTreeView'
import { usePlanComputation } from './usePlan'

/**
 * /plan/new (UX_SPEC §1, §4(e); PRD P6-S5 AC1, §9 Feature B AC5): without `?item=` the goal picker; with it the
 * item's plan preview — its availability at the player's progress, the whole tree, the steps it makes — and
 * "Make My Plan", which saves it and opens it. Entry points link here: item and weapon pages ("What Should I
 * Grind For?"), the readiness checker's "Show Me How to Get It", the builder's gated track. An id the dataset
 * doesn't have → the styled 404 with a way to search.
 */
const NO_CHOICES: Readonly<Record<string, string>> = {}
const RECORD_TYPES: ReadonlySet<string> = new Set(['weapon', 'armor', 'accessory', 'item'])
const AMOUNT_MAX = 9999

export default function PlanNewPage() {
  const [params] = useSearchParams()
  const raw = params.get(PLAN_ITEM_PARAM)
  const id = raw === null ? undefined : parseItemId(raw)
  const amount = Math.min(AMOUNT_MAX, Math.max(1, parseItemId(params.get(PLAN_AMOUNT_PARAM) ?? '') ?? 1))
  if (raw === null) return <PickerScreen />
  if (id === undefined) return <ItemNotFound raw={raw} />
  return <PreviewLoader key={id} itemId={id} amount={amount} />
}

function PickerScreen() {
  useDocumentTitle(copy.NEW_DOC_TITLE)
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 md:px-6 md:py-8">
      <BackToPlans />
      <PixelPanel as="section" aria-labelledby="plan-new-title" className="space-y-3">
        <h1 id="plan-new-title" className="font-display text-base leading-relaxed text-accent text-shadow-pixel md:text-xl">
          {copy.NEW_TITLE}
        </h1>
        <p className="text-fg-muted">{copy.NEW_INTRO}</p>
        <GoalPicker />
      </PixelPanel>
    </div>
  )
}

function ItemNotFound({ raw }: { raw: string }) {
  return <NotFoundPage title={copy.NOT_FOUND_TITLE} message={copy.notFoundBody(raw)} action={{ to: PLAN_NEW_PATH, label: copy.EMPTY_CTA }} />
}

function PreviewLoader({ itemId, amount }: { itemId: number; amount: number }) {
  const resource = useResource(
    `plan-new:${itemId}:${amount}`,
    async () => {
      const base = await loadPlanBase()
      await resolvePlanGraph(base, itemId, amount, NO_CHOICES)
      return base
    },
    () => {
      const base = peekPlanBase()
      return base && peekPlanGraph(base, itemId, amount, NO_CHOICES) ? base : undefined
    },
  )
  const showSkeleton = useDelayedFlag(resource.status === 'loading')
  const doc = resource.status === 'ready' ? resource.data.docs.get(`i:${itemId}`) : undefined
  const notFound = resource.status === 'ready' && !RECORD_TYPES.has(doc?.type ?? '')
  useDocumentTitle(notFound ? copy.NOT_FOUND_TITLE : doc ? `${copy.NEW_DOC_TITLE}: ${doc.name}` : copy.NEW_DOC_TITLE)
  if (notFound) return <ItemNotFound raw={String(itemId)} />
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6 md:px-6 md:py-8">
      {resource.status === 'ready' ? (
        <Preview base={resource.data} itemId={itemId} amount={amount} />
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

function Preview({ base, itemId, amount: initialAmount }: { base: PlanBase; itemId: number; amount: number }) {
  const navigate = useNavigate()
  const create = usePlansStore((s) => s.create)
  const plans = usePlansStore((s) => s.plans)
  const existing = useMemo(() => plans.filter((p) => p.targetItemId === itemId), [plans, itemId])
  const stage = useSelectedStage()
  const [amount, setAmount] = useState(initialAmount)
  const state = useMemo(() => ({ owned: {}, checkedStepIds: [] as string[] }), [])
  const comp = usePlanComputation(base, itemId, amount, NO_CHOICES, state)
  const { ctx } = comp
  const name = ctx.info(ctx.graph.goal).name
  // picked in the goal picker (same path, so the shell kept focus where the picker was): focus lands here
  const location = useLocation()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const picked = (location.state as Record<string, unknown> | null)?.[PICKED_STATE] === true
  useEffect(() => {
    if (picked) headingRef.current?.focus()
  }, [picked])
  const bosses = comp.steps.filter((s) => s.kind === 'defeat-boss').length
  const make = () => {
    const plan = create({ targetItemId: itemId, targetAmount: amount, stageAtCreation: stage, steps: comp.steps, choices: {} })
    navigate(planHref(plan.planId), { replace: true })
  }
  return (
    <div className="space-y-4" data-plan-preview={itemId}>
      <BackToPlans />
      <PixelPanel as="header" className="space-y-3">
        <GoalIdentity ctx={ctx} title={(n) => n} headingRef={headingRef} />
        <BasisNote comp={comp} />
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-t-2 border-panel-border pt-3">
          <span className="inline-flex flex-col gap-1 text-sm">
            <span className="font-semibold">{copy.AMOUNT_LABEL}</span>
            <OwnedQtyInput id="plan-amount" name={name} value={amount} min={1} labels={copy.amountLabels(name)} onChange={(n) => setAmount(Math.min(AMOUNT_MAX, Math.max(1, n)))} />
          </span>
          <button type="button" onClick={make} disabled={comp.loading} className={buttonClass('primary')} data-make-plan="">
            <ClipboardList aria-hidden="true" className="size-5" />
            {copy.MAKE_PLAN}
          </button>
        </div>
        <p className="text-sm text-fg-muted">
          {copy.MAKE_PLAN_NOTE} <span data-preview-steps={comp.steps.length}>{copy.previewSummary(comp.steps.length, bosses)}</span>
        </p>
        {existing.length > 0 ? (
          <p className="flex flex-wrap items-center gap-x-2 text-sm" data-existing-plans={existing.length}>
            <CircleAlert aria-hidden="true" className="size-4 text-accent" />
            <span>{copy.existingPlans(existing.length)}</span>
            <Link to={planHref(existing[0].planId)} className={`font-semibold ${LINK}`}>
              {copy.OPEN_EXISTING}
            </Link>
          </p>
        ) : null}
      </PixelPanel>
      <PlanNotices ctx={ctx} />
      {comp.error ? (
        <Notice tone="warn" icon={<CircleAlert className="size-5 text-accent" />}>
          <ErrorState error={comp.error} onRetry={comp.retry} />
        </Notice>
      ) : null}
      <PixelPanel as="section" aria-labelledby="plan-preview-title" className="space-y-3">
        <h2 id="plan-preview-title" className="font-display text-sm leading-relaxed text-accent text-shadow-pixel">
          {copy.PREVIEW_TITLE}: {copy.TREE_TITLE}
        </h2>
        <PlanTreeView ctx={ctx} idPrefix="preview" />
      </PixelPanel>
    </div>
  )
}
