import { Check, Repeat, X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { useMemo } from 'react'
import { buttonClass } from '../../../components/buttonStyles'
import { cx } from '../../../components/cx'
import { defaultSelection, type PlanGroupNode, type PlanItemNode, type PlanNode, type PlanRoute } from './planTree'
import * as copy from './planCopy'
import { planLookup } from './planData'
import { AvailabilityChips, NodeName, NodeSprite, RouteFacts, RouteGateChips } from './PlanBits'
import { itemAvailability, routeGate, type RouteGateCtx } from './planRouteGates'
import { heldText, LABEL, ROUTE_ICON, wayLabel } from './planText'
import type { PlanCtx } from './PlanTreeView'

/**
 * The way chooser (PRD P6-S5 AC4 "Find an Easier Route … alternative method … with the tradeoff explained";
 * §9 Feature B AC3 "alternative methods are compared with stated tradeoffs, never a bare best"; UX_SPEC §3.9
 * "alternative recipes show 'or' branches"): every way the data lists to get one item, in the data's order,
 * each with what it needs — nothing ranked, nothing recommended. Each way states its gating at the player's
 * progress (B118(f), planRouteGates.ts), its stations and boss sources link their pages, and a recipe's needs
 * are this plan's quantities (the tree's numbers for the way in use; drop sources counted as the tree counts
 * them). Picking one applies it everywhere the item is needed; "Decide later" leaves it a choice. For an
 * "Any X" group: its members, each with its availability. A Radix modal dialog (focus trap, Esc), full-screen
 * on phones, focus handed back by the page.
 */
export interface RouteChooserProps {
  ctx: PlanCtx
  nodeKey: string | null
  /** The current choice for the node (absent: the default applies). */
  chosen: string | undefined
  onPick: (nodeKey: string, value: string | null) => void
  onClose: () => void
  returnFocus: () => HTMLElement | null | undefined
}

export function RouteChooser({ ctx, nodeKey, chosen, onPick, onClose, returnFocus }: RouteChooserProps) {
  const node = nodeKey ? ctx.graph.nodes.get(nodeKey) : undefined
  return (
    <Dialog.Root open={node !== undefined} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-(--z-dialog) bg-night-950/75 data-[state=open]:animate-fade-in" />
        <Dialog.Content
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            returnFocus()?.focus()
          }}
          data-route-chooser={nodeKey ?? ''}
          className={cx(
            'fixed z-(--z-dialog) flex flex-col bg-surface text-fg shadow-pixel-drop',
            'inset-0 md:inset-auto md:top-1/2 md:left-1/2 md:max-h-[85dvh] md:w-[min(40rem,calc(100vw-2rem))] md:-translate-1/2 md:border-2 md:border-panel-border',
          )}
        >
          {node ? <ChooserBody ctx={ctx} node={node} chosen={chosen} onPick={onPick} /> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function useGateCtx(ctx: PlanCtx): RouteGateCtx | undefined {
  return useMemo(() => {
    const graph = ctx.base.acquisition.progression
    return graph ? { lookup: planLookup(ctx.base), graph, conditions: ctx.base.acquisition.conditions, ep: ctx.basis.ep, memo: ctx.basis.memo } : undefined
  }, [ctx.base, ctx.basis])
}

function ChooserBody({ ctx, node, chosen, onPick }: { ctx: PlanCtx; node: PlanNode; chosen: string | undefined; onPick: RouteChooserProps['onPick'] }) {
  const info = ctx.info(node.key)
  // where "Decide later" really takes the item: an open choice, or the way the planner lists by default
  const fallback = node.kind === 'item' ? defaultSelection(node.routes, node.heldRoutes) : ({ kind: 'open' } as const)
  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b-2 border-panel-border px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
        <Dialog.Title className="flex min-w-0 items-center gap-2 font-display text-sm leading-relaxed text-accent md:text-base">
          <NodeSprite info={info} sprites={ctx.base.sprites} size="sm" />
          <span className="min-w-0">{copy.chooserTitle(info.name)}</span>
        </Dialog.Title>
        <Dialog.Close aria-label={copy.CLOSE} className="grid min-h-tap min-w-tap shrink-0 place-items-center border-2 border-panel-border bg-panel text-fg hover:bg-night-700">
          <X aria-hidden="true" className="size-5" />
        </Dialog.Close>
      </div>
      <Dialog.Description className="px-3 pt-2 text-sm text-fg-muted">{node.kind === 'group' ? copy.MEMBERS_INTRO : copy.CHOOSER_INTRO}</Dialog.Description>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 pb-safe">
        {node.kind === 'group' ? <Members ctx={ctx} node={node} onPick={onPick} /> : <Routes ctx={ctx} node={node} onPick={onPick} />}
        {chosen !== undefined ? (
          <div className="mt-4 space-y-1 border-t-2 border-panel-border pt-3">
            <button type="button" onClick={() => onPick(node.key, null)} className={buttonClass('secondary')} data-decide-later="">
              {copy.DECIDE_LATER}
            </button>
            <p className="text-xs text-fg-muted" data-decide-later-note="">
              {fallback.kind === 'route' && node.kind === 'item' ? copy.decideLaterDefault(wayLabel(node, fallback.route, ctx.base)) : copy.DECIDE_LATER_NOTE}
            </p>
          </div>
        ) : null}
      </div>
    </>
  )
}

function inUse(node: PlanItemNode, route: PlanRoute): boolean {
  return node.selection.kind === 'route' && node.selection.route.key === route.key
}

function Routes({ ctx, node, onPick }: { ctx: PlanCtx; node: PlanItemNode; onPick: RouteChooserProps['onPick'] }) {
  const gateCtx = useGateCtx(ctx)
  const record = node.record
  if (!record) return null
  const craftCount = node.routes.filter((r) => r.method === 'craft').length
  // this plan's demand for the item (structural, as the tree shows it)
  const scale = { amount: ctx.structural.get(node.key)?.total ?? 0, name: ctx.info(node.key).name }
  let craftIndex = 0
  return (
    <ol className="space-y-3">
      {node.routes.map((route) => {
        const Icon = ROUTE_ICON[route.method]
        const using = inUse(node, route)
        if (route.method === 'craft') craftIndex++
        const gate = gateCtx ? routeGate(gateCtx, record, route, node.routes.length) : undefined
        return (
          <li key={route.key} data-route={route.key} className={cx('space-y-2 border-2 p-3', using ? 'border-gold-500 bg-night-800' : 'border-panel-border bg-night-900')}>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold">
              <Icon aria-hidden="true" className="size-5 shrink-0 text-accent" />
              <span>
                {copy.ROUTE_KIND[route.method]}
                {route.method === 'craft' && craftCount > 1 ? <span className="font-normal text-fg-muted"> · {copy.recipeOf(craftIndex, craftCount)}</span> : null}
              </span>
            </p>
            <RouteFacts record={record} route={route} base={ctx.base} scale={scale} />
            {gate ? (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" data-route-gate-line={route.key}>
                <span className="text-fg-muted">{copy.ROUTE_GATE}:</span>
                <RouteGateChips gate={gate} base={ctx.base} record={record} />
              </p>
            ) : null}
            {node.heldRoutes[route.key] && node.heldRoutes[route.key].kind !== 'shimmer' ? (
              <p className="flex items-start gap-1.5 text-sm text-fg-muted" data-held={node.heldRoutes[route.key].kind}>
                <Repeat aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <span>
                  <span className="font-semibold text-fg">{copy.NOT_PICKED_NOTE}:</span> {heldText(node.heldRoutes[route.key], ctx.info(node.key).name, ctx)}
                </span>
              </p>
            ) : null}
            {using ? (
              <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-success" data-in-use="">
                <Check aria-hidden="true" className="size-4" />
                {copy.IN_USE}
              </p>
            ) : (
              <button type="button" onClick={() => onPick(node.key, route.key)} className={buttonClass('secondary')} data-use-route={route.key}>
                {copy.USE_THIS}
              </button>
            )}
          </li>
        )
      })}
    </ol>
  )
}

function Members({ ctx, node, onPick }: { ctx: PlanCtx; node: PlanGroupNode; onPick: RouteChooserProps['onPick'] }) {
  const gateCtx = useGateCtx(ctx)
  return (
    <ul className="space-y-2">
      {(node.group?.memberItemIds ?? []).map((id) => {
        const key = `i:${id}`
        const info = ctx.info(key)
        const using = node.member === id
        const record = gateCtx?.lookup.record(id) ?? undefined
        return (
          <li key={id} data-member={id} className={cx('flex flex-wrap items-center gap-3 border-2 p-2', using ? 'border-gold-500 bg-night-800' : 'border-panel-border bg-night-900')}>
            <NodeSprite info={info} sprites={ctx.base.sprites} size="sm" />
            <div className="min-w-0 flex-1 space-y-1">
              <NodeName info={info} />
              {gateCtx ? (
                <p className="flex flex-wrap items-center gap-1.5 text-sm" data-member-gate={id}>
                  <span className="sr-only">{copy.MEMBER_GATE}: </span>
                  <AvailabilityChips availability={itemAvailability(gateCtx, id)} base={ctx.base} record={record} />
                </p>
              ) : null}
            </div>
            {using ? (
              <span className={cx(LABEL, 'text-success')}>{copy.IN_USE}</span>
            ) : (
              <button type="button" onClick={() => onPick(node.key, key)} className={buttonClass('secondary')} data-use-member={id}>
                {copy.useMember(info.name)}
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
