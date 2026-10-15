import { ArrowUpRight, ChevronDown, CircleCheck, Lock } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { cx } from '../../../components/cx'
import { peekDetailIndex } from '../../../data-access'
import { AcquisitionView } from '../db/weapons/AcquisitionView'
import { refInfoFrom } from '../db/items/itemsData'
import { bossMapHref, bossPageHref } from '../bosses/bossNav'
import type { StepState } from './planModel'
import * as copy from './planCopy'
import { AvailabilityChips, NodeName, NodeSprite, OwnedQtyInput, ProgressBar } from './PlanBits'
import { LABEL, LINK } from './planText'
import { ChooseButton, StepChip, type PlanCtx } from './PlanTreeView'

/**
 * The checklist (PRD P6-S6 AC1–AC4; UX_SPEC §3.9 ChecklistPane, §6 "Plan quantities"): the plan's steps grouped
 * by activity — bosses to defeat, ways still to choose, each drop source / vendor, chests, fishing, other ways,
 * crafting in order, where the plan stops, no known source — each with the owned-quantity stepper (remaining
 * recalculates live and flows down the plan), its availability, "Where do I find this?" (the item's full
 * acquisition, as on its page, with sources) and, for an item with more than one way, the way chooser. Boss
 * steps link the boss page and say which of the plan's items they were derived from (B118(e)).
 *
 * Progress (AMENDMENTS-016 B118(b)): the bar, "N of M steps complete" and — once every step is complete — the
 * completion banner sit in a strip that sticks under the site header while the pane scrolls, so the banner is
 * on screen at the moment of the final check, at 375px as on desktop. The page announces it (live region).
 *
 * Complete by cause (B118(c)) — the honest pattern chosen: a step the user checked, or one still open, is a
 * native check box. A step complete for another reason — owned in full, no longer needed because what it goes
 * into is checked or owned, or a boss marked defeated on the boss map / counted by the stage — is NOT a control
 * (its state is changed where its cause lives: the owned stepper, the step above it, the boss map, the stage).
 * It shows a check-circle glyph in the box's place (decorative, and not box-shaped: it isn't a control), its
 * text starts with a screen-reader "Complete:" and its cause is said in words beside it — so no unchecked box
 * ever sits beside "complete", and nothing pretends to toggle.
 */
export interface ChecklistProps {
  ctx: PlanCtx
  owned: Readonly<Record<string, number>>
  onCheck: (stepId: string, checked: boolean) => void
  onOwned: (key: string, quantity: number) => void
  idPrefix: string
}

export function PlanChecklist({ ctx, owned, onCheck, onOwned, idPrefix }: ChecklistProps) {
  const { view } = ctx
  const graph = ctx.base.acquisition.progression
  return (
    <div className="space-y-4" data-plan-checklist="">
      <div className="sticky top-16 z-(--z-hud) -mx-3 space-y-1.5 border-y-2 border-panel-border bg-panel px-3 py-2 md:-mx-4 md:px-4" data-checklist-progress="">
        <p className="text-sm font-semibold tabular-nums" data-progress={`${view.complete}/${view.total}`}>
          {copy.progressLine(view.complete, view.total)}
        </p>
        <ProgressBar complete={view.complete} total={view.total} />
        {view.done ? (
          <div className="flex gap-2 border-2 border-forest-600 bg-forest-900 p-2 text-sm" data-plan-complete="">
            <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-success" />
            <div className="min-w-0">
              <p className="font-semibold">{copy.DONE_TITLE}</p>
              <p className="text-fg-muted">{copy.DONE_BODY}</p>
            </div>
          </div>
        ) : null}
      </div>
      {view.groups.map((group) => (
        // a plain section under its heading (not a named region: a region named by its own heading reads it twice)
        <section key={group.key} data-step-group={group.key} className="space-y-1">
          <h3 className={cx(LABEL, 'flex items-center gap-1.5')}>
            {group.key === 'bosses' ? <Lock aria-hidden="true" className="size-3.5" /> : null}
            {copy.groupTitle(group.key, (id) => graph?.nodeById.get(id)?.name ?? id)}
          </h3>
          <ul className="divide-y-2 divide-panel-border border-y-2 border-panel-border">
            {group.steps.map((s) => (s.step.kind === 'defeat-boss' ? <BossRow key={s.step.stepId} ctx={ctx} s={s} onCheck={onCheck} idPrefix={idPrefix} /> : <StepRow key={s.step.stepId} ctx={ctx} s={s} owned={owned} onCheck={onCheck} onOwned={onOwned} idPrefix={idPrefix} />))}
          </ul>
        </section>
      ))}
    </div>
  )
}

/** Open or checked by the user: a check box. Complete for another reason: see the module note (B118(c)). */
const byCause = (s: StepState) => s.status === 'owned' || s.status === 'covered' || s.status === 'progress'

function CheckCell({ id, s, onCheck }: { id: string; s: StepState; onCheck: (stepId: string, checked: boolean) => void }) {
  return (
    <span className="grid min-h-tap min-w-tap shrink-0 place-items-center self-start">
      {byCause(s) ? (
        // a check mark, not a box: it isn't a control (and doesn't look like one)
        <CircleCheck aria-hidden="true" strokeWidth={2.5} className="size-6 text-success" data-step-done={s.status} />
      ) : (
        <input id={id} type="checkbox" checked={s.status === 'checked'} onChange={(e) => onCheck(s.step.stepId, e.target.checked)} className="size-6 cursor-pointer accent-forest-500" data-step-check={s.step.stepId} />
      )}
    </span>
  )
}

/** The step's words: the check box's label, or (complete by cause) plain text that starts with "Complete:" for screen readers. */
function StepText({ s, checkId, className }: { s: StepState; checkId: string; className?: string }) {
  if (byCause(s)) {
    return (
      <p className={cx('font-semibold', className)} data-step-text="">
        <span className="sr-only">{copy.COMPLETE_SR}</span>
        {s.step.text}
      </p>
    )
  }
  return (
    <label htmlFor={checkId} className={cx('cursor-pointer font-semibold', s.status === 'checked' && 'line-through decoration-2', className)}>
      {s.step.text}
    </label>
  )
}

function StepRow({ ctx, s, owned, onCheck, onOwned, idPrefix }: { ctx: PlanCtx; s: StepState; owned: Readonly<Record<string, number>>; onCheck: ChecklistProps['onCheck']; onOwned: ChecklistProps['onOwned']; idPrefix: string }) {
  const key = s.step.refs[0]
  const info = ctx.info(key)
  const node = s.node
  const checkId = `${idPrefix}-c-${s.step.stepId}`
  const whereId = `${idPrefix}-w-${s.step.stepId}`
  const complete = s.status !== 'open'
  const [where, setWhere] = useState(false)
  const record = node?.kind === 'item' ? node.record : undefined
  // the way chooser wherever the item has more than one way (as in the tree), or one held way still to choose
  const ways = node?.kind === 'group' ? (node.group?.memberItemIds.length ?? 0) : (node?.routes.length ?? 0)
  const choosable = node !== undefined && ctx.choose !== undefined && (ways > 1 || (node.kind === 'item' && node.selection.kind === 'open' && ways > 0))
  const chosen = node?.kind === 'group' ? node.member !== undefined : node?.selection.kind === 'route'
  return (
    <li data-step={s.step.stepId} data-step-kind={s.step.kind} data-status={s.status} data-node-key={key} className={cx('flex gap-2 py-1.5', complete && 'bg-night-900')}>
      <CheckCell id={checkId} s={s} onCheck={onCheck} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-start gap-2">
          <NodeSprite info={info} sprites={ctx.base.sprites} size="sm" />
          <StepText s={s} checkId={checkId} className="min-w-0 flex-1 pt-1.5" />
        </div>
        {node?.kind === 'group' ? <p className="text-sm text-fg-muted">{copy.groupMembers((node.group?.memberItemIds ?? []).map((id) => ctx.info(`i:${id}`).name))}</p> : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {info.link ? <NodeName info={info} className="text-sm" /> : null}
          <StepChip step={s} />
          {s.status === 'open' && s.remaining !== undefined && (!s.demand || s.remaining === s.demand.total) ? <span className="text-xs font-semibold tabular-nums">{copy.toGet(s.remaining)}</span> : null}
          {node?.kind === 'item' && !node.truncated ? <AvailabilityChips availability={ctx.view.availability.get(key)} base={ctx.base} record={node.record} /> : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-2 text-sm">
            <span className="text-fg-muted">{copy.OWNED_LABEL}</span>
            <OwnedQtyInput id={`${idPrefix}-o-${s.step.stepId}`} name={info.name} value={owned[key] ?? 0} onChange={(n) => onOwned(key, n)} />
          </span>
          {choosable ? <ChooseButton ctx={ctx} nodeKey={key} name={info.name} chosen={chosen} className="text-sm" /> : null}
          {record ? (
            <button type="button" aria-expanded={where} aria-controls={whereId} onClick={() => setWhere((v) => !v)} className={cx('inline-flex min-h-tap items-center gap-1.5 text-sm font-semibold', LINK)} data-where={key}>
              <ChevronDown aria-hidden="true" className={cx('size-4 shrink-0', where && 'rotate-180')} />
              {copy.WHERE}
              <span className="sr-only"> ({info.name})</span>
            </button>
          ) : null}
        </div>
        {/* "Where Do I Find This?" (PRD P6-S5 AC4): every way to get it, as on its page — sources, verified chances or Unknown, provenance */}
        {record && where ? (
          <div id={whereId} className="border-2 border-panel-border bg-surface p-3">
            <AcquisitionView weapon={record} noun="item" data={ctx.base.acquisition} weaponsById={peekDetailIndex('weapons')} sprites={ctx.base.sprites} refInfo={refInfoFrom(ctx.base.docs)} />
          </div>
        ) : null}
      </div>
    </li>
  )
}

/** How many plan items a boss step names before "and N more". */
const NEEDED_FOR_SHOWN = 4

function BossRow({ ctx, s, onCheck, idPrefix }: { ctx: PlanCtx; s: StepState; onCheck: ChecklistProps['onCheck']; idPrefix: string }) {
  const bossId = s.step.nodeId ?? ''
  const page = bossPageHref(bossId)
  const name = ctx.base.acquisition.progression?.nodeById.get(bossId)?.name ?? bossId
  const checkId = `${idPrefix}-c-${s.step.stepId}`
  const neededFor = (s.neededFor ?? []).map((k) => ctx.info(k).name)
  return (
    <li data-step={s.step.stepId} data-step-kind="defeat-boss" data-status={s.status} className={cx('flex gap-2 py-2', s.status !== 'open' && 'bg-night-900')}>
      <CheckCell id={checkId} s={s} onCheck={onCheck} />
      <div className="min-w-0 flex-1 space-y-1 pt-1">
        <StepText s={s} checkId={checkId} className="block" />
        {s.status === 'progress' || s.status === 'covered' ? (
          <p className="inline-flex items-center gap-1 text-xs font-semibold text-success" data-boss-cause={s.status === 'covered' ? 'covered' : s.bossBasis}>
            <CircleCheck aria-hidden="true" className="size-3.5 shrink-0" />
            {s.status === 'covered' ? copy.BOSS_COVERED : s.bossBasis === 'tracked' ? copy.BOSS_TRACKED : copy.BOSS_STAGE}
          </p>
        ) : null}
        {neededFor.length > 0 ? (
          <p className="text-sm text-fg-muted" data-boss-for="">
            {copy.bossFor(neededFor.slice(0, NEEDED_FOR_SHOWN), Math.max(0, neededFor.length - NEEDED_FOR_SHOWN))}
          </p>
        ) : null}
        <p className="flex flex-wrap gap-x-4 text-sm">
          {page ? (
            <Link to={page} className={cx('inline-flex min-h-tap items-center gap-1 font-semibold', LINK)}>
              {name}
              <ArrowUpRight aria-hidden="true" className="size-4" />
            </Link>
          ) : null}
          {s.status !== 'progress' ? (
            <Link to={bossMapHref(bossId)} className={cx('inline-flex min-h-tap items-center font-semibold', LINK)}>
              {copy.MARK_ON_MAP}
            </Link>
          ) : null}
        </p>
      </div>
    </li>
  )
}
