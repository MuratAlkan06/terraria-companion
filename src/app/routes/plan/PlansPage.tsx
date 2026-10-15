import { CircleAlert, CircleCheck, ClipboardList, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { buttonClass } from '../../../components/buttonStyles'
import { cx } from '../../../components/cx'
import { PixelPanel } from '../../../components/PixelPanel'
import { EmptyState } from '../../../components/States'
import { asRarity } from '../../../components/rarity'
import { RarityText } from '../../../components/RarityText'
import { SpriteImg } from '../../../components/SpriteImg'
import { loadSearchDocs, loadSpriteIndex, peekSearchDocs, peekSpriteIndex } from '../../../data-access'
import type { SpriteIndex } from '../../../data-access/types'
import type { SearchDoc } from '../../../schemas'
import type { SavedPlan } from '../../../storage/plans'
import { useProgressStore } from '../../progressStore'
import { useSelectedStage } from '../../settingsStore'
import { useResource } from '../../useResource'
import { useDocumentTitle } from '../../useDocumentTitle'
import * as copy from './planCopy'
import { loadPlanBase, peekPlanBase, type PlanBase } from './planData'
import { PLAN_NEW_PATH, planHref } from './planLinks'
import { LINK } from './planText'
import { Notice } from './PlanDetail'
import { usePlansStore } from './plansStore'
import { planSummary, resolvePlanSummaries, summariesReady, type PlanSummary } from './planSummary'

/**
 * /plan (UX_SPEC §1, §3.9; PRD P6-S6 AC3 "multiple concurrent plans"; UX_SPEC §5.2 "Plans empty: one-line
 * invitation + single CTA"): every saved plan, newest first — its goal, done or in progress and "N of M steps
 * complete" — and "New plan". Progress is the plan page's own (AMENDMENTS-016 B118(a)): each plan rebuilt
 * from today's data under the player's progress, so "Done" only ever sits beside "M of M"; the stored status
 * follows it (§8c). Names and pictures come from the search docs (lazy; the list paints with ids first, never
 * blank); the counts follow once the planner's data loads. After a plan is deleted, the list says so (a
 * polite live region, B118(g)).
 */
interface ListData {
  docs: ReadonlyMap<string, SearchDoc>
  sprites: SpriteIndex | null
}

let docsFor: { source: readonly SearchDoc[]; data: ListData } | undefined
const listData = (docs: readonly SearchDoc[], sprites: SpriteIndex | null): ListData => {
  if (docsFor?.source !== docs || docsFor.data.sprites !== sprites) docsFor = { source: docs, data: { docs: new Map(docs.map((d) => [d.id, d])), sprites } }
  return docsFor.data
}

/** What each plan's progress depends on (a new plan, a deleted one or a changed choice reloads what it reaches). */
const plansKey = (plans: readonly SavedPlan[]) => plans.map((p) => `${p.targetItemId}×${p.targetAmount ?? 1}:${JSON.stringify(p.choices ?? {})}`).join('|')

function usePlanSummaries(plans: readonly SavedPlan[]): { status: 'loading' | 'error' } | { status: 'ready'; byId: ReadonlyMap<string, PlanSummary | undefined> } {
  const progress = useProgressStore((s) => s.progress)
  const stage = useSelectedStage()
  const setStatus = usePlansStore((s) => s.setStatus)
  const resource = useResource<PlanBase>(
    `plan-list-progress:${plansKey(plans)}`,
    async () => {
      const base = await loadPlanBase()
      await resolvePlanSummaries(base, plans)
      return base
    },
    () => {
      const base = peekPlanBase()
      return base && summariesReady(base, plans) ? base : undefined
    },
  )
  const base = resource.status === 'ready' ? resource.data : undefined
  const byId = useMemo(() => (base ? new Map(plans.map((p) => [p.planId, planSummary(base, p, progress, stage)])) : undefined), [base, plans, progress, stage])
  // §8c: the stored status follows the same count (the page does the same when a plan is open)
  useEffect(() => {
    if (!byId) return
    for (const plan of plans) {
      const s = byId.get(plan.planId)
      if (s?.kind === 'progress' && (s.done ? 'done' : 'active') !== plan.status) setStatus(plan.planId, s.done ? 'done' : 'active')
    }
  }, [byId, plans, setStatus])
  if (resource.status === 'error') return { status: 'error' }
  return byId ? { status: 'ready', byId } : { status: 'loading' }
}

/** The one-time "Deleted the plan for …" from the plan page: shown, announced (set after mount), then cleared from the store. */
function useFlash(): string {
  const [message] = useState(() => usePlansStore.getState().flash)
  const [shown, setShown] = useState('')
  useEffect(() => {
    if (!message) return
    usePlansStore.getState().setFlash(null)
    const timer = window.setTimeout(() => setShown(message), 50)
    return () => window.clearTimeout(timer)
  }, [message])
  return shown
}

export default function PlansPage() {
  useDocumentTitle(copy.DOC_TITLE)
  const plans = usePlansStore((s) => s.plans)
  const loadStatus = usePlansStore((s) => s.loadStatus)
  const persistError = usePlansStore((s) => s.persistError)
  const flash = useFlash()
  const data = useResource(
    'plan-list',
    async () => {
      const [docs, sprites] = await Promise.all([loadSearchDocs(), loadSpriteIndex().catch(() => null)])
      return listData(docs, sprites)
    },
    () => {
      const docs = peekSearchDocs()
      return docs ? listData(docs, peekSpriteIndex() ?? null) : undefined
    },
  )
  const ready = data.status === 'ready' ? data.data : undefined
  const summaries = usePlanSummaries(plans)
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6 md:px-6 md:py-8">
      <PixelPanel as="header" className="space-y-3">
        <h1 className="font-display text-base leading-relaxed text-accent text-shadow-pixel md:text-2xl">{copy.PAGE_TITLE}</h1>
        <p className="max-w-prose text-fg-muted">{copy.PAGE_INTRO}</p>
        {plans.length > 0 ? (
          <Link to={PLAN_NEW_PATH} className={buttonClass('primary')} data-new-plan="">
            <Plus aria-hidden="true" className="size-5" />
            {copy.NEW_PLAN}
          </Link>
        ) : null}
      </PixelPanel>
      {/* rendered (empty) from the first frame so the message set after mount is announced */}
      <div role="status" data-plan-flash="">
        {flash ? (
          <Notice tone="done" icon={<CircleCheck className="size-5 text-success" />}>
            <p>{flash}</p>
          </Notice>
        ) : null}
      </div>
      {loadStatus === 'quarantined' ? (
        <Notice tone="warn" icon={<CircleAlert className="size-5 text-accent" />} data="quarantine">
          <p>{copy.QUARANTINE}</p>
        </Notice>
      ) : null}
      {persistError ? (
        <Notice tone="warn" icon={<CircleAlert className="size-5 text-accent" />} data="persist-error">
          <p>{copy.PERSIST_ERROR}</p>
        </Notice>
      ) : null}
      {plans.length === 0 ? (
        <EmptyState
          titleId="plans-empty"
          art={<ClipboardList className="size-12 text-accent" />}
          title={copy.EMPTY_TITLE}
          actions={
            <Link to={PLAN_NEW_PATH} className={buttonClass('primary')} data-new-plan="">
              {copy.EMPTY_CTA}
            </Link>
          }
        >
          <p>{copy.EMPTY_BODY}</p>
        </EmptyState>
      ) : (
        <section aria-labelledby="plans-list" className="space-y-2">
          <h2 id="plans-list" className="font-display text-sm text-accent text-shadow-pixel">
            {copy.LIST_TITLE}
          </h2>
          <ul className="grid gap-2 md:grid-cols-2">
            {plans.map((plan) => (
              <PlanCard key={plan.planId} plan={plan} data={ready} summary={summaries.status === 'ready' ? summaries.byId.get(plan.planId) : summaries.status} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/** A plan's status and count — the plan page's, or a plain state while it can't be counted (never a stale "Done"). */
export function PlanCardProgress({ summary }: { summary: PlanSummary | 'loading' | 'error' | undefined }) {
  if (summary === undefined || summary === 'loading') return <span data-plan-progress="loading">{copy.COUNTING}</span>
  if (summary === 'error') return <span data-plan-progress="error">{copy.COUNT_UNAVAILABLE}</span>
  if (summary.kind === 'target-missing') return <span data-plan-progress="target-missing">{copy.TARGET_GONE}</span>
  return (
    <>
      {summary.done ? (
        <span className="inline-flex items-center gap-1 font-semibold text-success">
          <CircleCheck aria-hidden="true" className="size-4" />
          {copy.STATUS_DONE}
        </span>
      ) : (
        <span className="font-semibold text-fg">{copy.STATUS_ACTIVE}</span>
      )}
      <span className="tabular-nums" data-plan-progress={`${summary.complete}/${summary.total}`}>
        {copy.progressLine(summary.complete, summary.total)}
      </span>
    </>
  )
}

function PlanCard({ plan, data, summary }: { plan: SavedPlan; data: ListData | undefined; summary: PlanSummary | 'loading' | 'error' | undefined }) {
  const doc = data?.docs.get(`i:${plan.targetItemId}`)
  const name = doc?.name ?? copy.MISSING_TARGET_NAME(plan.targetItemId)
  return (
    <li data-plan-card={plan.planId} className="flex items-center gap-3 border-2 border-panel-border bg-panel p-3">
      <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center border-2 border-slot-border bg-slot">
        {doc?.class ? <SpriteImg src={doc.sprite} sprites={data?.sprites ?? null} damageClass={doc.class} box={32} /> : <SpriteImg src={doc?.sprite} sprites={data?.sprites ?? null} placeholder="material" box={32} />}
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <Link to={planHref(plan.planId)} className={cx('font-semibold', LINK)}>
          <RarityText rarity={asRarity(doc?.rarity)}>{copy.planCardTitle(name, plan.targetAmount ?? 1)}</RarityText>
        </Link>
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-fg-muted">
          <PlanCardProgress summary={summary} />
          <span>{copy.madeOn(DATE.format(new Date(plan.createdAt)))}</span>
        </p>
      </div>
    </li>
  )
}
