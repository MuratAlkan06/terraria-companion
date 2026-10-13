/**
 * §7b `gatedBy` derivation (DATA_SCHEMA_SPEC §7b, AMENDMENTS-001 A1/A3) — pure + deterministic.
 *
 * Per item: every acquisition route yields a gate set; the item's gate set is the MINIMUM over
 * routes that are fully derivable (any one obtainable route suffices). A route is derivable only
 * when every input in its chain is verified:
 * - craft: the recipe's availability conditions (B9 `Recipe.conditions`) ∪ the gating of every
 *   ingredient and station item, recursively (a group = minimum over its members; crafting
 *   environments such as Water or Shimmer are places, not progression gates). Cycles (shimmer
 *   round-trips) are cut — a route that needs the item itself is not a route. Every result is
 *   memoized, including ones computed while a cycle was cut: cutting only REMOVES routes, so a
 *   memoized result is equal or more conservative (more gated, or not derivable) — never less.
 * - drop: the drop's conditions ∪ the gating of its SOURCE. A boss source gates on the boss's
 *   progression node; an enemy or container source has no verified gating yet (Enemy.stage is
 *   Unknown, containers carry no gating data) ⇒ the route is not derivable.
 * Conditions with `satisfiedByNode` become boss-node gates (hardmode ⇐ wall-of-flesh); the rest
 * stay conditions. Boss gates are transitively reduced against the required-gate DAG and
 * `stage` = max stage of the gating nodes (early-prehm when there are none).
 *
 * Anything unverified anywhere ⇒ NOT derivable: the caller omits gatedBy/stage and lists them in
 * _prov.unverifiedFields, so consumers treat gating as Unknown and never "obtainable now". The
 * blockers explain why (aggregated in the gap report).
 */
import {
  isCoveredBy,
  Stage,
  STAGE_ORDER,
  type Condition,
  type DropSource,
  type GatedBy,
  type ProgressionEdge,
  type ProgressionNode,
  type Recipe,
  type RecipeGroup,
} from '../../src/schemas'

export const GATING_BLOCKERS = {
  'no-known-route': 'an input item has no recipe or drop in the datasets (base materials, vendor/fishing/chest-only items: item corpus P6-S0)',
  'drop-source-ungated': 'a drop comes from an enemy or container whose own gating is not verified (Enemy.stage Unknown; containers carry no gating data)',
  'boss-attribution-pending': 'a boss drop has no verified boss → progression-node attribution yet (source.bossId pending the P2-S6 boss registry)',
  'drop-conditions-unknown': 'a drop lists its conditions as Unknown',
  'vendor-conditions-unknown': 'a purchase route exists but the shop availability conditions are not structured on the wiki',
  'progression-graph-pending': 'a gate maps to a progression node that is not in the dataset yet (P2-S6), so the stage cannot be computed',
  cycle: 'every route needs the item itself (recipe cycle)',
} as const
export type GatingBlocker = keyof typeof GATING_BLOCKERS

export interface GatingContext {
  recipesByResult: ReadonlyMap<number, readonly Recipe[]>
  dropsByItem: ReadonlyMap<number, readonly DropSource[]>
  groups: ReadonlyMap<string, RecipeGroup>
  conditions: ReadonlyMap<string, Condition>
  /** Progression graph; absent while the collection is pending (P2-S6). */
  graph?: {
    nodes: ReadonlyMap<string, ProgressionNode>
    edges: readonly ProgressionEdge[]
    /** Boss slug → its progression node slug. */
    bossNode: ReadonlyMap<string, string>
  }
}

interface Gates {
  bosses: string[]
  conditions: string[]
}

type Derived = { ok: true; gates: Gates; stage: Stage } | { ok: false; blockers: Set<GatingBlocker> }

export type GatingResult = { ok: true; gatedBy: GatedBy } | { ok: false; blockers: GatingBlocker[] }

const fail = (...b: GatingBlocker[]): Derived => ({ ok: false, blockers: new Set(b) })

export function createGatingDeriver(ctx: GatingContext): (itemId: number) => GatingResult {
  const memo = new Map<number, Derived>()

  // required-gate DAG ancestors, for the transitive reduction
  const parents = new Map<string, string[]>()
  for (const e of ctx.graph?.edges ?? []) if (e.type === 'required-gate') parents.set(e.to, [...(parents.get(e.to) ?? []), e.from])
  const ancestors = (node: string): Set<string> => {
    const seen = new Set<string>()
    const stack = [...(parents.get(node) ?? [])]
    while (stack.length > 0) {
      const n = stack.pop() as string
      if (seen.has(n)) continue
      seen.add(n)
      stack.push(...(parents.get(n) ?? []))
    }
    return seen
  }

  /** Normalizes a raw gate set: condition → node mapping, reduction, stage. */
  const finish = (bosses: Iterable<string>, conditions: Iterable<string>): Derived => {
    const nodes = new Set(bosses)
    const conds = new Set<string>()
    for (const slug of conditions) {
      const node = ctx.conditions.get(slug)?.satisfiedByNode
      if (node) nodes.add(node)
      else conds.add(slug)
    }
    if (nodes.size > 0 && !ctx.graph) return fail('progression-graph-pending')
    for (const n of nodes) if (!ctx.graph?.nodes.has(n)) return fail('progression-graph-pending')
    const implied = new Set([...nodes].flatMap((n) => [...ancestors(n)]))
    const reduced = [...nodes].filter((n) => !implied.has(n)).sort()
    let stage: Stage = 'early-prehm'
    for (const n of reduced) {
      const s = ctx.graph?.nodes.get(n)?.stage as Stage
      if (STAGE_ORDER[s] > STAGE_ORDER[stage]) stage = s
    }
    return { ok: true, gates: { bosses: reduced, conditions: [...conds].sort() }, stage }
  }

  const rank = (d: Extract<Derived, { ok: true }>) => [STAGE_ORDER[d.stage], d.gates.bosses.length, d.gates.conditions.length, JSON.stringify(d.gates)] as const
  const better = (a: Extract<Derived, { ok: true }>, b: Extract<Derived, { ok: true }>) => {
    const [ra, rb] = [rank(a), rank(b)]
    for (let i = 0; i < ra.length; i += 1) if (ra[i] !== rb[i]) return ra[i] < rb[i]
    return false
  }
  /** Minimum over alternatives; failures union their blockers. */
  const minOf = (alternatives: Derived[]): Derived => {
    let best: Extract<Derived, { ok: true }> | undefined
    const blockers = new Set<GatingBlocker>()
    for (const a of alternatives) {
      if (a.ok) {
        if (!best || better(a, best)) best = a
      } else for (const b of a.blockers) blockers.add(b)
    }
    return best ?? { ok: false, blockers: blockers.size > 0 ? blockers : new Set(['no-known-route']) }
  }
  /** Union of required parts (all must hold). */
  const allOf = (parts: Derived[], extraConditions: readonly string[] = []): Derived => {
    const bosses: string[] = []
    const conditions: string[] = [...extraConditions]
    const blockers = new Set<GatingBlocker>()
    for (const p of parts) {
      if (!p.ok) for (const b of p.blockers) blockers.add(b)
      else {
        bosses.push(...p.gates.bosses)
        conditions.push(...p.gates.conditions)
      }
    }
    return blockers.size > 0 ? { ok: false, blockers } : finish(bosses, conditions)
  }

  const derive = (itemId: number, visiting: Set<number>): Derived => {
    const cached = memo.get(itemId)
    if (cached) return cached
    if (visiting.has(itemId)) return fail('cycle')
    visiting.add(itemId)
    const of = (id: number) => derive(id, visiting)
    const group = (groupId: string) => minOf((ctx.groups.get(groupId)?.memberItemIds ?? []).map(of))
    const routes: Derived[] = []
    for (const r of ctx.recipesByResult.get(itemId) ?? []) {
      const parts: Derived[] = []
      for (const s of r.stations) {
        if (s.kind === 'item') parts.push(of(s.itemId))
        else if (s.kind === 'group') parts.push(group(s.groupId))
      }
      for (const ing of r.ingredients) parts.push(ing.ref.kind === 'item' ? of(ing.ref.itemId) : group(ing.ref.groupId))
      routes.push(allOf(parts, r.conditions))
    }
    for (const d of ctx.dropsByItem.get(itemId) ?? []) {
      if (isCoveredBy(d._prov.unverifiedFields, 'conditions')) routes.push(fail('drop-conditions-unknown'))
      else if (d.source.bossId !== undefined) {
        const node = ctx.graph?.bossNode.get(d.source.bossId)
        routes.push(node ? finish([node], d.conditions) : fail('progression-graph-pending'))
      } else if (isCoveredBy(d._prov.unverifiedFields, 'source.bossId')) routes.push(fail('boss-attribution-pending'))
      else routes.push(fail('drop-source-ungated'))
    }
    const result = routes.length === 0 ? fail('no-known-route') : minOf(routes)
    visiting.delete(itemId)
    memo.set(itemId, result)
    return result
  }

  return (itemId) => {
    const d = derive(itemId, new Set())
    if (!d.ok) {
      // a cut cycle only explains the failure when nothing else blocked
      const blockers = [...d.blockers].filter((b) => b !== 'cycle' || d.blockers.size === 1).sort()
      return { ok: false, blockers }
    }
    return { ok: true, gatedBy: { bosses: d.gates.bosses, conditions: d.gates.conditions, stage: d.stage } }
  }
}
