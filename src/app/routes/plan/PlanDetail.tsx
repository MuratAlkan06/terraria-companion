import { ArrowLeft, ChevronDown, CircleAlert, CircleCheck, CircleHelp, ListChecks, Network, RefreshCw, Scissors, Trash2 } from 'lucide-react'
import { useId, useRef, useState, type ReactNode, type Ref } from 'react'
import { Link } from 'react-router'
import { buttonClass } from '../../../components/buttonStyles'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { cx } from '../../../components/cx'
import { useBreakpoint } from '../../../components/useMediaQuery'
import { PixelPanel } from '../../../components/PixelPanel'
import { ProvenanceLink } from '../../../components/ProvenanceLink'
import { meta } from '../../../data/meta'
import type { SavedPlan } from '../../../storage/plans'
import { getStageInfo } from '../../stages'
import { snapshotDrift, type PlanView } from './planModel'
import * as copy from './planCopy'
import { PLAN_PATH } from './planLinks'
import { branchNodes } from './planTree'
import { AvailabilityChips, NodeName, NodeSprite } from './PlanBits'
import { LINK, routeLine } from './planText'
import { PlanChecklist } from './PlanChecklist'
import { PlanTreeView, type PlanCtx } from './PlanTreeView'
import type { PlanComputation } from './usePlan'

/**
 * The plan page body (UX_SPEC §3.9 PlanPage): PlanHeader (goal, its availability at the player's progress,
 * progress in words, the basis of "obtainable now", "Compare routes", delete with confirmation), the notices
 * (data changed, stale choices, guard cut, Unknown-heavy, unsaved), then Tree | Checklist — tabs below 768px,
 * side by side from md (UX_SPEC §7). The progress bar and the completion banner live in the checklist pane
 * (UX_SPEC §3.9 ChecklistPane; AMENDMENTS-016 B118(b)) — one bar on the page.
 */
export function BackToPlans() {
  return (
    <Link to={PLAN_PATH} className={cx('inline-flex min-h-tap items-center gap-2 font-semibold', LINK)}>
      <ArrowLeft aria-hidden="true" className="size-5" />
      {copy.BACK_TO_PLANS}
    </Link>
  )
}

export function Notice({ tone = 'info', icon, title, children, data }: { tone?: 'info' | 'done' | 'warn'; icon: ReactNode; title?: string; children: ReactNode; data?: string }) {
  return (
    <PixelPanel role={tone === 'warn' ? 'alert' : undefined} tone={tone === 'done' ? 'forest' : tone === 'warn' ? 'earth' : 'night'} padded={false} className="flex gap-3 p-3 md:p-4" data-notice={data}>
      <span className="mt-0.5 shrink-0" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0 space-y-1 text-sm">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className="space-y-2 text-fg-muted">{children}</div>
      </div>
    </PixelPanel>
  )
}

/** "What obtainable now is based on" (PRD §9 Feature B AC2): stage + tracked defeats, said in words. */
export function BasisNote({ comp }: { comp: PlanComputation }) {
  const { basis, ctx } = comp
  const name = (id: string) => ctx.base.acquisition.progression?.nodeById.get(id)?.name ?? id
  return (
    <details className="group text-sm" data-basis="">
      <summary className={cx('inline-flex min-h-tap cursor-pointer items-center gap-1.5 font-semibold [&::-webkit-details-marker]:hidden', LINK)}>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 group-open:rotate-180" />
        {copy.BASIS_TITLE}
      </summary>
      <p className="mt-1 text-fg-muted">{copy.basisText(basis.stage ? getStageInfo(basis.stage).label : null, basis.virtual.map(name), basis.tracked.length)}</p>
    </details>
  )
}

/** Notices about the plan's availability picture and guard cuts (shared by the preview). */
export function PlanNotices({ ctx }: { ctx: PlanCtx }) {
  const { counts } = ctx.view
  const items = counts.yes + counts.gated + counts.unknown
  const goal = ctx.graph.nodes.get(ctx.graph.goal)
  const noSource = goal?.kind === 'item' && goal.selection.kind === 'none' && goal.selection.reason === 'no-source'
  const name = ctx.info(ctx.graph.goal).name
  return (
    <>
      {noSource ? (
        <Notice icon={<CircleHelp className="size-5 text-unknown" />} title={copy.noSourceTitle(name)} data="no-source">
          <p>{copy.noSourceBody(name)}</p>
          {goal.record ? <ProvenanceLink href={goal.record.wikiUrl} srContext={`for ${name}`} /> : null}
        </Notice>
      ) : null}
      {ctx.graph.truncated ? (
        <Notice icon={<Scissors className="size-5 text-accent" />} title={copy.TRUNCATED_TITLE} data="truncated">
          <p>{copy.TRUNCATED_BODY}</p>
        </Notice>
      ) : null}
      {items > 1 && counts.unknown * 2 >= items ? (
        <Notice icon={<CircleHelp className="size-5 text-unknown" />} title={copy.UNKNOWN_HEAVY_TITLE} data="unknown-heavy">
          <p>{copy.unknownCountLine(counts.unknown, items)}</p>
        </Notice>
      ) : null}
    </>
  )
}

/** The goal's picture, name, quantity and availability (the header's identity row). */
export function GoalIdentity({ ctx, title, headingRef }: { ctx: PlanCtx; title: (name: string) => string; headingRef?: Ref<HTMLHeadingElement> }) {
  const goal = ctx.graph.nodes.get(ctx.graph.goal)
  const info = ctx.info(ctx.graph.goal)
  return (
    <div className="flex items-start gap-3">
      <NodeSprite info={info} sprites={ctx.base.sprites} />
      <div className="min-w-0 flex-1 space-y-2">
        <h1 ref={headingRef} tabIndex={-1} className="font-display text-base leading-relaxed text-accent text-shadow-pixel focus:outline-none md:text-xl">
          {title(info.name)}
          {ctx.graph.goalAmount > 1 ? <span className="ml-2 font-sans text-lg text-fg tabular-nums">{copy.quantity(ctx.graph.goalAmount)}</span> : null}
        </h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <NodeName info={info} className="text-sm" />
          {goal?.kind === 'item' ? <AvailabilityChips availability={ctx.view.availability.get(ctx.graph.goal)} base={ctx.base} record={goal.record} /> : null}
        </div>
      </div>
    </div>
  )
}

/** "Compare routes" (PRD P6-S5 AC4 "Find an Easier Route", worded without a ranking): every item with more than one way to get it. */
function CompareRoutes({ ctx }: { ctx: PlanCtx }) {
  const nodes = branchNodes(ctx.graph)
  if (nodes.length === 0 || !ctx.choose) return null
  return (
    <details className="group" data-compare-routes="">
      <summary className={cx('inline-flex min-h-tap cursor-pointer items-center gap-1.5 text-sm font-semibold [&::-webkit-details-marker]:hidden', LINK)}>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 group-open:rotate-180" />
        {copy.COMPARE_ROUTES} ({nodes.length})
      </summary>
      <p className="mt-1 text-sm text-fg-muted">{copy.compareRoutesCount(nodes.length)}. {copy.CHOOSER_INTRO}</p>
      <ul className="mt-2 divide-y-2 divide-panel-border border-y-2 border-panel-border">
        {nodes.map((n) => {
          const info = ctx.info(n.key)
          const line = n.kind === 'group' ? (n.member !== undefined ? copy.usingMember(ctx.info(`i:${n.member}`).name) : copy.anyOf((n.group?.memberItemIds ?? []).map((id) => ctx.info(`i:${id}`).name))) : n.selection.kind === 'route' && n.record ? routeLine(n.record, n.selection.route, ctx.base) : copy.severalWays(n.routes.length)
          const chosen = n.kind === 'group' ? n.member !== undefined : n.selection.kind === 'route'
          return (
            <li key={n.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm">
              <NodeName info={info} />
              <span className="min-w-0 flex-1 text-fg-muted">{line}</span>
              <button type="button" onClick={(e) => ctx.choose?.(n.key, e.currentTarget)} className={cx('inline-flex min-h-tap items-center font-semibold', LINK)} data-compare-choose={n.key}>
                {chosen ? copy.CHANGE : copy.CHOOSE}
                <span className="sr-only">{chosen ? copy.changeFor(info.name) : copy.chooseFor(info.name)}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </details>
  )
}

function progressCounts(view: PlanView) {
  const by = (status: string) => view.steps.filter((s) => s.status === status).length
  return copy.progressBreakdown(by('checked'), by('owned'), by('covered'), by('progress'))
}

export interface PlanDetailProps {
  plan: SavedPlan
  comp: PlanComputation
  persistError: boolean
  /** The last way picked couldn't load its records (the plan is unchanged). */
  choiceError?: boolean
  onCheck: (stepId: string, checked: boolean) => void
  onOwned: (key: string, quantity: number) => void
  onUpdateSnapshot: () => void
  onDelete: () => void
}

export function PlanDetail({ plan, comp, persistError, choiceError = false, onCheck, onOwned, onUpdateSnapshot, onDelete }: PlanDetailProps) {
  const id = useId()
  const { ctx } = comp
  const { view } = ctx
  const [tab, setTab] = useState<'tree' | 'checklist'>('tree')
  // Tabs below md only (UX_SPEC §7); side by side the panes are plain sections
  const tabs = !useBreakpoint('md')
  const panel = (t: 'tree' | 'checklist') => (tabs ? { role: 'tabpanel', 'aria-labelledby': `${id}-tab-${t}` } : { 'aria-labelledby': `${id}-${t}-title` })
  const [confirm, setConfirm] = useState(false)
  const deleteRef = useRef<HTMLButtonElement>(null)
  const info = ctx.info(ctx.graph.goal)
  const drift = comp.loading ? undefined : snapshotDrift(plan.snapshot, comp.steps, meta.gameVersion)
  const goalLink = info.link
  // "Update the saved steps" removes its own notice: focus moves to the progress line it may have changed (B118(g))
  const progressRef = useRef<HTMLParagraphElement>(null)
  const update = () => {
    onUpdateSnapshot()
    window.requestAnimationFrame(() => progressRef.current?.focus())
  }
  return (
    <div className="space-y-4">
      <BackToPlans />
      <PixelPanel as="header" className="space-y-3" data-plan-header={plan.planId}>
        <GoalIdentity ctx={ctx} title={copy.planFor} />
        <p ref={progressRef} tabIndex={-1} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm focus:outline-2 focus:outline-offset-2 focus:outline-ring" data-header-progress-line="">
          <span>
            <span className="font-semibold tabular-nums" data-header-progress={`${view.complete}/${view.total}`}>
              {copy.progressLine(view.complete, view.total)}
            </span>{' '}
            <span className="text-fg-muted">{progressCounts(view)}</span>
          </span>
          {view.done ? (
            <span className="inline-flex items-center gap-1 font-semibold text-success" data-header-done="">
              <CircleCheck aria-hidden="true" className="size-4 shrink-0" />
              {copy.DONE_TITLE}
            </span>
          ) : null}
        </p>
        <BasisNote comp={comp} />
        <CompareRoutes ctx={ctx} />
        <div className="flex flex-wrap gap-2 border-t-2 border-panel-border pt-3">
          {goalLink?.kind === 'internal' ? (
            <Link to={goalLink.to} className={buttonClass('secondary')}>
              {copy.ITEM_PAGE}
              <span className="sr-only">{copy.itemPageFor(info.name)}</span>
            </Link>
          ) : null}
          <button ref={deleteRef} type="button" onClick={() => setConfirm(true)} className={buttonClass('secondary')} data-delete-plan="">
            <Trash2 aria-hidden="true" className="size-5" />
            {copy.DELETE}
          </button>
        </div>
      </PixelPanel>

      {persistError ? (
        <Notice tone="warn" icon={<CircleAlert className="size-5 text-accent" />} data="persist-error">
          <p>{copy.PERSIST_ERROR}</p>
        </Notice>
      ) : null}
      {choiceError ? (
        <Notice tone="warn" icon={<CircleAlert className="size-5 text-accent" />} data="choice-error">
          <p>{copy.CHOICE_ERROR}</p>
        </Notice>
      ) : null}
      {drift ? (
        <Notice icon={<RefreshCw className="size-5 text-accent" />} title={copy.driftTitle} data="drift">
          <p>{copy.driftBody(drift.added, drift.removed, drift.versionChanged, plan.snapshot.gameVersion, meta.gameVersion)}</p>
          <button type="button" onClick={update} className={buttonClass('secondary')} data-update-snapshot="">
            {copy.UPDATE_PLAN}
          </button>
        </Notice>
      ) : null}
      {ctx.graph.staleChoices.length > 0 ? (
        <Notice icon={<CircleAlert className="size-5 text-accent" />} data="stale-choices">
          <p>{copy.STALE_CHOICES}</p>
        </Notice>
      ) : null}
      <PlanNotices ctx={ctx} />
      {comp.loading ? (
        <p role="status" className="text-sm text-fg-muted">
          {copy.LOADING_MORE}
        </p>
      ) : null}

      <div role="tablist" aria-label={copy.VIEWS_LABEL} hidden={!tabs} className="grid grid-cols-2 border-2 border-panel-border md:hidden">
        {(['tree', 'checklist'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`${id}-tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`${id}-panel-${t}`}
            onClick={() => setTab(t)}
            className={cx('inline-flex min-h-tap items-center justify-center gap-2 font-semibold', tab === t ? 'bg-night-700 text-accent' : 'bg-surface text-fg-muted hover:text-fg')}
          >
            {t === 'tree' ? <Network aria-hidden="true" className="size-4" /> : <ListChecks aria-hidden="true" className="size-4" />}
            {t === 'tree' ? copy.TAB_TREE : copy.TAB_CHECKLIST}
          </button>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2 md:items-start">
        <PixelPanel as="section" id={`${id}-panel-tree`} {...panel('tree')} className={cx('space-y-3', tab !== 'tree' && 'hidden md:block')} padded={false} data-pane="tree">
          <div className="space-y-3 p-3 md:p-4">
            <h2 id={`${id}-tree-title`} tabIndex={-1} data-pane-title="" className="scroll-mt-24 font-display text-sm leading-relaxed text-accent text-shadow-pixel focus:outline-none">
              {copy.TREE_TITLE}
            </h2>
            <PlanTreeView ctx={ctx} idPrefix={`${id}-tree`} />
          </div>
        </PixelPanel>
        <PixelPanel as="section" id={`${id}-panel-checklist`} {...panel('checklist')} className={cx(tab !== 'checklist' && 'hidden md:block')} padded={false} data-pane="checklist">
          <div className="space-y-3 p-3 md:p-4">
            <h2 id={`${id}-checklist-title`} tabIndex={-1} data-pane-title="" className="scroll-mt-24 font-display text-sm leading-relaxed text-accent text-shadow-pixel focus:outline-none">
              {copy.CHECKLIST_TITLE}
            </h2>
            <PlanChecklist ctx={ctx} owned={plan.owned} onCheck={onCheck} onOwned={onOwned} idPrefix={`${id}-list`} />
          </div>
        </PixelPanel>
      </div>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={copy.deleteTitle(info.name)}
        description={copy.DELETE_BODY}
        confirmLabel={copy.DELETE_CONFIRM}
        onConfirm={onDelete}
        returnFocus={() => deleteRef.current}
      />
    </div>
  )
}
