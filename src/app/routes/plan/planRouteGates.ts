/**
 * Per-way gating for the way chooser (AMENDMENTS-016 B118(f); PRD §9 Feature B AC3 "alternative methods are
 * compared with stated tradeoffs"; DATA_SCHEMA_SPEC §7b): what each listed way to get an item needs from the
 * player's progress — verified data only, under the plan's progress basis (stage + tracked defeats, the same
 * EffectiveProgress as the tree's availability chips).
 *
 * - An item with ONE way: that way's gate IS the item's verified gatedBy (§7b: the minimum over one route), so
 *   the chooser and the tree agree by construction.
 * - A recipe (one of several ways): every input is needed, so its gate is the union (§7b's craft rule) of the
 *   recipe's node-mapped availability conditions and the verified gating of each ingredient and station item;
 *   an "Any X" group (ingredient or station) counts as its least-gated member. Crafting environments (Water,
 *   Shimmer, …) are places, not gates. Any input whose gating is Unknown makes the way Unknown — the bosses
 *   that ARE known are still named.
 * - A drop (one of several ways): any one drop record suffices. A boss's drop (or its Treasure Bag's) is open
 *   once that boss is defeated; any other source's gating isn't in the data (Unknown). One record open → open;
 *   else one Unknown → Unknown; else the bosses — "one of" when the records need different ones.
 * - A vendor, chest, fishing spot or wiki-described way (one of several): its node-mapped conditions are named,
 *   but whether the vendor / place itself is open isn't in the data → Unknown.
 * Non-node conditions of the INPUTS come back as requirement chips (never a block, B69/Q4); the way's own
 * conditions are already shown with its facts.
 */
import type { ConditionIndex, ProgressionData } from '../../../data-access/types'
import { availabilityOf, gateBosses, UNKNOWN_AVAILABILITY, type Availability } from '../../../scoring/candidates'
import { isNodeSatisfied } from '../../../scoring/progress'
import type { PlanLookup, PlanRecord, PlanRoute } from './planTree'

export type RouteGate =
  /** Every listed boss is needed (status yes / gated / unknown; unknown may still name known bosses). */
  | { kind: 'all'; availability: Availability }
  /** Any one of these boss sets opens the way (drop sources that need different bosses). */
  | { kind: 'any'; options: string[][] }

export interface RouteGateCtx {
  lookup: Pick<PlanLookup, 'record' | 'group' | 'drop'>
  graph: ProgressionData
  conditions: ConditionIndex
  ep: ReadonlySet<string>
  memo: Map<string, boolean>
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x))

/** The bosses still to defeat before a progression node counts (none when it already does). */
function nodeMissing(ctx: RouteGateCtx, nodeId: string): string[] {
  return isNodeSatisfied(ctx.graph, ctx.ep, nodeId, ctx.memo) ? [] : gateBosses(ctx.graph, ctx.ep, nodeId, ctx.memo)
}

/** An item's availability (its record's verified gatedBy); a record that isn't there is Unknown. */
export function itemAvailability(ctx: RouteGateCtx, id: number): Availability {
  const record = ctx.lookup.record(id)
  return record ? availabilityOf(record, ctx.graph, ctx.ep, ctx.memo) : UNKNOWN_AVAILABILITY
}

/**
 * An "Any X" group as its least-gated member: one member open → open; else one Unknown → Unknown (it could be
 * less gated); else the member needing the fewest bosses — Unknown when several need different ones (a single
 * gate can't say "either").
 */
function groupAvailability(ctx: RouteGateCtx, memberIds: readonly number[]): Availability {
  const all = memberIds.map((id) => itemAvailability(ctx, id))
  const open = all.find((a) => a.status === 'yes')
  if (open) return open
  if (all.length === 0 || all.some((a) => a.status === 'unknown')) return UNKNOWN_AVAILABILITY
  const fewest = Math.min(...all.map((a) => a.missing.length))
  const best = all.filter((a) => a.missing.length === fewest)
  return best.every((a) => sameSet(a.missing, best[0].missing)) ? best[0] : UNKNOWN_AVAILABILITY
}

/** Several inputs that are ALL needed → one availability (union of bosses and input conditions). */
function union(parts: readonly Availability[], extraMissing: Iterable<string> = [], unknown = false): Availability {
  const missing = new Set(extraMissing)
  const conditions = new Set<string>()
  for (const p of parts) {
    for (const b of p.missing) missing.add(b)
    for (const c of p.conditions) conditions.add(c)
  }
  const status = unknown || parts.some((p) => p.status === 'unknown') ? 'unknown' : missing.size > 0 ? 'gated' : 'yes'
  return { status, missing: [...missing].sort(), conditions: [...conditions].sort() }
}

/** The bosses behind a way's own node-mapped conditions ("hardmode" ⇐ the Hardmode milestone ⇒ the Wall of Flesh). */
function conditionMissing(ctx: RouteGateCtx, slugs: readonly string[]): string[] {
  const out = new Set<string>()
  for (const slug of slugs) {
    const node = ctx.conditions.byId.get(slug)?.satisfiedByNode
    if (node) for (const b of nodeMissing(ctx, node)) out.add(b)
  }
  return [...out]
}

/**
 * The item is obtainable now by its own verified gating (the tree's badge) while no listed way can be confirmed
 * open on its own (every way Unknown under the per-way rules above) — e.g. Stinger, AMENDMENTS-016 B120. Both
 * readings are honest; the chooser footnotes how they fit together.
 */
export function openButWaysUnknown(item: Availability, gates: readonly RouteGate[]): boolean {
  return item.status === 'yes' && gates.length > 1 && gates.every((g) => g.kind === 'all' && g.availability.status === 'unknown')
}

export function routeGate(ctx: RouteGateCtx, record: PlanRecord, route: PlanRoute, routeCount: number): RouteGate {
  // one way: the item's own verified gating is exactly this way's
  if (routeCount === 1) return { kind: 'all', availability: availabilityOf(record, ctx.graph, ctx.ep, ctx.memo) }
  const acq = record.acquisition[route.acqIndex]
  if (!acq) return { kind: 'all', availability: UNKNOWN_AVAILABILITY }
  switch (acq.method) {
    case 'craft': {
      const recipe = route.recipe
      if (!recipe) return { kind: 'all', availability: UNKNOWN_AVAILABILITY }
      const parts: Availability[] = []
      for (const ing of recipe.ingredients) {
        parts.push(ing.ref.kind === 'item' ? itemAvailability(ctx, ing.ref.itemId) : groupAvailability(ctx, ctx.lookup.group(ing.ref.groupId)?.memberItemIds ?? []))
      }
      for (const s of recipe.stations) {
        if (s.kind === 'item') parts.push(itemAvailability(ctx, s.itemId))
        else if (s.kind === 'group') parts.push(groupAvailability(ctx, ctx.lookup.group(s.groupId)?.memberItemIds ?? []))
      }
      return { kind: 'all', availability: union(parts, conditionMissing(ctx, recipe.conditions)) }
    }
    case 'drop': {
      const options: Availability[] = acq.dropIds.map((id) => {
        const drop = ctx.lookup.drop(id)
        const boss = drop?.source.bossId
        if (!drop || !boss) return UNKNOWN_AVAILABILITY
        return union([], [...nodeMissing(ctx, boss), ...conditionMissing(ctx, drop.conditions)])
      })
      const open = options.find((o) => o.status === 'yes')
      if (open) return { kind: 'all', availability: open }
      if (options.length === 0 || options.some((o) => o.status === 'unknown')) return { kind: 'all', availability: UNKNOWN_AVAILABILITY }
      const distinct: string[][] = []
      for (const o of options) if (!distinct.some((d) => sameSet(d, o.missing))) distinct.push(o.missing)
      return distinct.length === 1 ? { kind: 'all', availability: options[0] } : { kind: 'any', options: distinct }
    }
    default:
      // the vendor / chest / fishing spot / described way itself: not in the data
      return { kind: 'all', availability: union([], conditionMissing(ctx, acq.conditions), true) }
  }
}
