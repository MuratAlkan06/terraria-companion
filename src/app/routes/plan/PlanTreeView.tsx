import { ChevronRight, CircleCheck, Repeat } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { cx } from '../../../components/cx'
import { UnknownValue } from '../../../components/UnknownValue'
import type { NodeDemand, PlanGraph, PlanGroupNode, PlanItemNode, PlanNode } from './planTree'
import { edgeQuantity, yieldOf } from './planTree'
import type { NodeInfo, PlanBase } from './planData'
import { coveredSubtrees, type PlanView, type ProgressBasis, type StepState } from './planModel'
import * as copy from './planCopy'
import { planNewHref } from './planLinks'
import { AvailabilityChips, NodeName, NodeSprite } from './PlanBits'
import { heldShort, heldText, LINK, routeLine } from './planText'

/**
 * The plan's tree (PRD P6-S5 AC2, §9 Feature B AC1 "the recursive tree is the same data as the crafting
 * tree"; UX_SPEC §3.9 TreePane, §7 "Tree/Checklist tabs; rows ≥ 44px"): the goal, then what each item is
 * made from, recursively — each distinct item drawn once where it is first needed (later uses point to it),
 * circular ingredients said and never followed, the guard's stop said where it cut. Every row: the item's
 * picture (a 44px expand/collapse button when it has children — named statically, aria-expanded says the
 * state), its linked name, the quantity this use needs (and the total over every use), how it's got (with
 * "Choose a way" / "Change" where there is more than one), its availability at the player's progress and its
 * step's state.
 *
 * Covered subtrees (AMENDMENTS-016 B118(h)): a complete item (checked, owned, or no longer needed) whose every
 * item drawn beneath it is no longer needed starts collapsed with ONE summary note instead of a "not needed"
 * line per descendant; its toggle still opens it. "Expand all" / "Collapse all" and the toggles override it.
 */
export interface PlanCtx {
  base: PlanBase
  graph: PlanGraph
  /** Quantities with nothing owned or checked (what each recipe calls for). */
  structural: Map<string, NodeDemand>
  view: PlanView
  /** The progress basis availability is computed under (stage + tracked defeats). */
  basis: ProgressBasis
  info: (key: string) => NodeInfo
  /** Step state by node key. */
  stepOf: (key: string) => StepState | undefined
  /**
   * Opens the way chooser for a node; absent = read-only (the preview). `opener`: the button pressed — focus
   * returns to it (activeElement can't be trusted: Safari doesn't focus a clicked button).
   */
  choose?: (key: string, opener?: HTMLElement) => void
}

export function PlanTreeView({ ctx, idPrefix }: { ctx: PlanCtx; idPrefix: string }) {
  // the user's own open / closed choices; everything else follows the default (open, or collapsed when covered)
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  const expandable = useMemo(() => [...ctx.graph.nodes.values()].filter((n) => n.edges.some((e) => !e.circular)).map((n) => n.key), [ctx.graph])
  const covered = useMemo(() => coveredSubtrees(ctx.graph, ctx.view, ctx.stepOf), [ctx.graph, ctx.view, ctx.stepOf])
  const uses = useMemo(() => {
    const out = new Map<string, number>()
    for (const n of ctx.graph.nodes.values()) for (const e of n.edges) if (!e.circular) out.set(e.to, (out.get(e.to) ?? 0) + 1)
    return out
  }, [ctx.graph])
  const isOpen = (key: string) => overrides.get(key) ?? !covered.has(key)
  const toggle = (key: string) => setOverrides((prev) => new Map(prev).set(key, !isOpen(key)))
  const allOpen = expandable.every(isOpen)
  const tree: TreeState = { isOpen, toggle, covered, uses }
  return (
    <div className="space-y-3" data-plan-tree="">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-sm text-fg-muted">{copy.TREE_NOTE}</p>
        {expandable.length > 1 ? (
          <button type="button" onClick={() => setOverrides(new Map(expandable.map((k) => [k, !allOpen])))} className={cx('inline-flex min-h-tap items-center text-sm font-semibold', LINK)}>
            {allOpen ? copy.COLLAPSE_ALL : copy.EXPAND_ALL}
          </button>
        ) : null}
      </div>
      <ul className="space-y-1">
        <TreeRow ctx={ctx} nodeKey={ctx.graph.goal} quantity={ctx.graph.goalAmount} tree={tree} idPrefix={idPrefix} />
      </ul>
    </div>
  )
}

interface TreeState {
  isOpen: (key: string) => boolean
  toggle: (key: string) => void
  /** Covered subtrees → items drawn beneath. */
  covered: ReadonlyMap<string, number>
  uses: ReadonlyMap<string, number>
}

interface RowProps {
  ctx: PlanCtx
  nodeKey: string
  /** What this use needs (structural). */
  quantity: number
  parentKey?: string
  circular?: boolean
  tree: TreeState
  idPrefix: string
}

function TreeRow({ ctx, nodeKey, quantity, parentKey, circular = false, tree, idPrefix }: RowProps) {
  const node = ctx.graph.nodes.get(nodeKey)
  if (!node) return null
  const info = ctx.info(nodeKey)
  // a later use of an item drawn elsewhere, or an ingredient already being made on this path
  const reference = circular || (parentKey !== undefined && node.treeParent !== parentKey)
  const children = reference ? [] : node.edges
  const open = tree.isOpen(nodeKey)
  const childListId = `${idPrefix}-${nodeKey.replace(/[^a-z0-9]/gi, '-')}`
  const total = ctx.structural.get(nodeKey)?.total ?? quantity
  const count = tree.uses.get(nodeKey) ?? 0
  const beneath = children.length > 0 && !open ? tree.covered.get(nodeKey) : undefined
  const status = ctx.stepOf(nodeKey)?.status
  const sprite = <NodeSprite info={info} sprites={ctx.base.sprites} />
  return (
    <li data-plan-node={nodeKey} data-reference={reference ? (circular ? 'circular' : 'listed') : undefined} data-open={children.length > 0 ? String(open) : undefined}>
      <div className="flex items-start gap-2 py-1">
        {children.length > 0 ? (
          <button type="button" aria-expanded={open} aria-controls={childListId} aria-label={copy.toggleLabel(info.name)} onClick={() => tree.toggle(nodeKey)} className="relative min-h-tap min-w-tap shrink-0 hover:brightness-110">
            {sprite}
            <ChevronRight aria-hidden="true" className={cx('absolute -right-1 -bottom-1 size-4 border border-panel-border bg-night-900 text-accent transition-transform duration-(--dur-ui)', open && 'rotate-90')} />
          </button>
        ) : (
          sprite
        )}
        <div className="min-w-0 flex-1 space-y-0.5 pt-0.5">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <NodeName info={info} />
            <span className="font-semibold tabular-nums">{copy.quantity(quantity)}</span>
            {!reference && count > 1 && total !== quantity ? <span className="text-xs text-fg-muted tabular-nums">{copy.inAll(total, count)}</span> : null}
          </p>
          {circular ? (
            <p className="flex items-start gap-1.5 text-sm text-fg-muted" data-circular="">
              <Repeat aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {copy.circular(info.name, parentKey ? ctx.info(parentKey).name : info.name)}
            </p>
          ) : reference ? (
            <p className="text-sm text-fg-muted">{node.treeParent ? copy.listedUnder(ctx.info(node.treeParent).name) : copy.listedAbove}</p>
          ) : (
            <NodeDetail ctx={ctx} node={node} info={info} />
          )}
          {beneath !== undefined && status && status !== 'open' && status !== 'progress' ? (
            <p className="flex items-start gap-1.5 text-sm text-success" data-covered-beneath={beneath}>
              <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {copy.coveredBeneath(status, beneath)}
            </p>
          ) : null}
        </div>
      </div>
      {children.length > 0 && open ? (
        <ul id={childListId} className="ml-3 space-y-1 border-l-2 border-panel-border pl-1 md:ml-5 md:pl-3">
          {children.map((edge) => (
            <TreeRow
              key={edge.to}
              ctx={ctx}
              nodeKey={edge.to}
              quantity={edgeQuantity(node, ctx.structural.get(nodeKey), edge) || edge.amount * Math.max(1, ctx.structural.get(nodeKey)?.crafts ?? 1)}
              parentKey={nodeKey}
              circular={edge.circular}
              tree={tree}
              idPrefix={idPrefix}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

/** How a node is got, its availability, its step's state and the way chooser. */
function NodeDetail({ ctx, node, info }: { ctx: PlanCtx; node: PlanNode; info: NodeInfo }) {
  const step = ctx.stepOf(node.key)
  return (
    <>
      {node.kind === 'group' ? <GroupLine ctx={ctx} node={node} /> : <ItemLine ctx={ctx} node={node} info={info} />}
      <div className="flex flex-wrap items-center gap-1.5">
        {node.kind === 'item' && !node.truncated ? <AvailabilityChips availability={ctx.view.availability.get(node.key)} base={ctx.base} record={node.record} /> : null}
        <StepChip step={step} />
      </div>
    </>
  )
}

/** "Choose a way" (several ways, none picked) / "Change" (one in use): opens the way chooser; one accessible name. */
export function ChooseButton({ ctx, nodeKey, name, chosen, className }: { ctx: PlanCtx; nodeKey: string; name: string; chosen: boolean; className?: string }) {
  if (!ctx.choose) return null
  return (
    <button type="button" onClick={(e) => ctx.choose?.(nodeKey, e.currentTarget)} data-choose={nodeKey} className={cx('inline-flex min-h-tap items-center font-semibold', LINK, className)}>
      {chosen ? copy.CHANGE : copy.CHOOSE}
      <span className="sr-only">{chosen ? copy.changeFor(name) : copy.chooseFor(name)}</span>
    </button>
  )
}

function ItemLine({ ctx, node, info }: { ctx: PlanCtx; node: PlanItemNode; info: NodeInfo }) {
  if (node.pending) return <p className="text-sm text-fg-muted">{copy.LOADING_MORE}</p>
  if (node.truncated) {
    return (
      <p className="text-sm" data-truncated={node.truncated}>
        {copy.stopsHere(info.name)}{' '}
        <Link to={planNewHref(node.id)} className={cx('font-semibold', LINK)}>
          {copy.planOnItsOwn(info.name)}
        </Link>
      </p>
    )
  }
  const sel = node.selection
  if (sel.kind === 'none') {
    return sel.reason === 'no-source' ? (
      <div className="space-y-0.5 text-sm" data-no-source="">
        <p className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="text-fg-muted">{copy.NO_SOURCE}</span>
          <UnknownValue field="acquisition" sourceUrl={node.record?.wikiUrl} />
        </p>
        <p className="text-fg-muted">{copy.NO_SOURCE_NOTE}</p>
      </div>
    ) : (
      <p className="text-sm text-fg-muted">{copy.NOT_IN_DATASET}</p>
    )
  }
  if (sel.kind === 'open') {
    const only = node.routes.length === 1 ? node.routes[0] : undefined
    const held = only ? node.heldRoutes[only.key] : undefined
    if (only && held && node.record) {
      return (
        <div className="space-y-0.5 text-sm" data-open-choice="held">
          <p>
            <span className="text-fg-muted">{copy.ONE_WAY_HELD}</span> {routeLine(node.record, only, ctx.base)}
          </p>
          <p className="flex flex-wrap items-baseline gap-x-2 text-fg-muted">
            <span data-held-text={held.kind}>{heldText(held, info.name, ctx)}</span>
            <ChooseButton ctx={ctx} nodeKey={node.key} name={info.name} chosen={false} />
          </p>
        </div>
      )
    }
    return (
      <p className="flex flex-wrap items-baseline gap-x-2 text-sm" data-open-choice="">
        <span>{copy.severalWays(node.routes.length, ctx.choose !== undefined)}</span>
        <ChooseButton ctx={ctx} nodeKey={node.key} name={info.name} chosen={false} />
      </p>
    )
  }
  const record = node.record
  if (!record) return null
  const craftRoutes = node.routes.filter((r) => r.method === 'craft')
  const index = craftRoutes.indexOf(sel.route)
  const tags = [
    sel.why === 'first-recipe' ? copy.recipeOf(index + 1, craftRoutes.length) : sel.why === 'chosen' ? copy.YOUR_CHOICE : '',
    yieldOf(node) > 1 ? copy.makesPerCraft(yieldOf(node)) : '',
  ].filter(Boolean)
  // "recipe 3 of 3": say inline why the earlier recipes weren't picked (B118(j))
  const skipped =
    sel.why === 'first-recipe'
      ? craftRoutes
          .slice(0, Math.max(0, index))
          .map((r, i) => (node.heldRoutes[r.key] ? heldShort(node.heldRoutes[r.key], i + 1, info.name, ctx) : ''))
          .filter(Boolean)
      : []
  const acq = record.acquisition[sel.route.acqIndex]
  const choose = node.routes.length > 1 ? <ChooseButton ctx={ctx} nodeKey={node.key} name={info.name} chosen /> : null
  if (acq?.method === 'other') {
    // the wiki's own words for a described way (A15: plain text) — not a vague "another way" (B118(j))
    return (
      <div className="space-y-0.5 text-sm" data-route-other="">
        <p className="text-fg-muted">{copy.FROM_THE_WIKI}</p>
        <p data-wiki-text="" className="whitespace-pre-line">
          {acq.description}
        </p>
        {tags.length > 0 || choose ? (
          <p className="flex flex-wrap items-baseline gap-x-2">
            {tags.length > 0 ? <span className="text-fg-muted">{tags.join(' · ')}</span> : null}
            {choose}
          </p>
        ) : null}
      </div>
    )
  }
  return (
    <div className="space-y-0.5 text-sm">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span>
          {routeLine(record, sel.route, ctx.base)}
          {tags.length > 0 ? <span className="text-fg-muted"> · {tags.join(' · ')}</span> : null}
        </span>
        {choose}
      </p>
      {skipped.length > 0 ? (
        <p className="text-xs text-fg-muted" data-skipped-recipes={skipped.length}>
          {copy.skippedNote(skipped)}
        </p>
      ) : null}
    </div>
  )
}

function GroupLine({ ctx, node }: { ctx: PlanCtx; node: PlanGroupNode }) {
  const members = (node.group?.memberItemIds ?? []).map((id) => ctx.info(`i:${id}`).name)
  const name = ctx.info(node.key).name
  return (
    <div className="space-y-0.5 text-sm">
      <p className="text-fg-muted">{copy.anyOf(members)}</p>
      <p className="flex flex-wrap items-baseline gap-x-2">
        {node.member !== undefined ? <span>{copy.usingMember(ctx.info(`i:${node.member}`).name)}</span> : null}
        <ChooseButton ctx={ctx} nodeKey={node.key} name={name} chosen={node.member !== undefined} />
      </p>
    </div>
  )
}

/** The node's checklist state, in words (never colour alone). */
export function StepChip({ step }: { step: StepState | undefined }) {
  if (!step) return null
  if (step.status === 'open') {
    if (step.remaining !== undefined && step.demand && step.remaining < step.demand.total) {
      return <span className="text-xs font-semibold text-fg tabular-nums">{copy.toGet(step.remaining)}</span>
    }
    return null
  }
  return (
    <span data-step-status={step.status} className="inline-flex items-center gap-1 text-xs font-semibold text-success">
      <CircleCheck aria-hidden="true" className="size-3.5 shrink-0" />
      {copy.STATUS_TEXT[step.status]}
    </span>
  )
}
