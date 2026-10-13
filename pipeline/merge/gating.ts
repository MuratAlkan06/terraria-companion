/**
 * §7b `gatedBy` derivation (DATA_SCHEMA_SPEC §7b, AMENDMENTS-001 A1/A3) — pure + deterministic.
 *
 * Per item: every acquisition route yields a gate set; the item's gate set is the MINIMUM over its
 * routes (any one obtainable route suffices). The minimum is only known when EVERY route is
 * derivable (§7b "any unverified input in the chain → omit gatedBy"): an underivable route might
 * be the less gated one (Mud Ball is crafted from a Mud Block by hand AND dropped by the Moon Lord;
 * Slime Staff drops from common slimes AND King Slime), so taking the best derivable route would
 * state a false gate. Exception: a derivable route with no gate at all is already the minimum.
 * The same rule applies to a recipe group (minimum over its members). A route is derivable only
 * when every input in its chain is verified:
 * - craft: the recipe's availability conditions (B9 `Recipe.conditions`) ∪ the gating of every
 *   ingredient and station item, recursively (crafting environments such as Water or Shimmer are
 *   places, not progression gates).
 * - cycles (Shimmer round-trips, mutual recipes): every item is evaluated as one global fixed point
 *   (Gauss-Seidel in item-ID order, so deterministic). Phase 1 ignores routes through items not
 *   derived yet, so a cycle grounded elsewhere takes the grounded value (A ⇄ B by Shimmer with A
 *   dropped by a boss → B gated like A). Phase 2 turns whatever is still underived — cycles with no
 *   grounded route anywhere, i.e. items the datasets cannot acquire — into a failing input, so no
 *   item that could come through them gets an exact gate.
 * - drop: the drop's conditions ∪ the gating of its SOURCE. A boss source gates on the boss's
 *   progression node; an enemy or container source has no verified gating yet (Enemy.stage is
 *   Unknown, containers carry no gating data) ⇒ the route is not derivable.
 * Conditions with `satisfiedByNode` become node gates (hardmode ⇐ the Hardmode milestone); the rest
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
  'drop-source-ungated': 'a drop comes from an enemy, an event boss or a container whose own gating is not verified (Enemy.stage Unknown; event bosses are progression markers, not Boss records; containers carry no gating data)',
  'boss-attribution-pending': 'a boss drop has no verified boss → progression-node attribution (source.bossId Unknown: the row\'s NPC ids disagree with the registry boss)',
  'drop-conditions-unknown': 'a drop lists its conditions as Unknown',
  'vendor-conditions-unknown': 'a purchase route exists but the shop availability conditions are not structured on the wiki',
  'progression-graph-pending': 'a gate maps to a progression node that is not in the dataset, so the stage cannot be computed',
  'acquisition-withheld': 'the item\'s acquisition is withheld because wiki sources conflict (AMENDMENTS-004 B19)',
  'alternative-route-unverified': 'one route is derivable, but another route is not, and it could be the less gated one — the minimum over routes is unknown (§7b)',
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
  const ungated = (d: Extract<Derived, { ok: true }>) => d.gates.bosses.length === 0 && d.gates.conditions.length === 0

  // ---- global fixed point (DATA_SCHEMA_SPEC §7b; see the header) --------------------------------
  // `undefined` = no derivation established yet (a route through an item not yet derived).
  type Val = Derived | undefined

  /**
   * Minimum over alternatives (routes of an item, members of a group). Exact only when every
   * alternative is derivable — or the best one is gate-free, which nothing can beat. Pending
   * alternatives are ignored while iterating (phase 1) and are failures afterwards (phase 2).
   */
  const minOf = (alternatives: readonly Val[]): Val => {
    let best: Extract<Derived, { ok: true }> | undefined
    const blockers = new Set<GatingBlocker>()
    let pending = false
    for (const a of alternatives) {
      if (a === undefined) pending = true
      else if (a.ok) {
        if (!best || better(a, best)) best = a
      } else for (const b of a.blockers) blockers.add(b)
    }
    if (best && ungated(best)) return best
    if (blockers.size > 0) {
      if (best) blockers.add('alternative-route-unverified')
      return { ok: false, blockers }
    }
    if (best) return best
    return pending ? undefined : fail('no-known-route')
  }
  /** Union of required parts (all must hold); pending while any part is. */
  const allOf = (parts: readonly Val[], extraConditions: readonly string[] = []): Val => {
    const bosses: string[] = []
    const conditions: string[] = [...extraConditions]
    const blockers = new Set<GatingBlocker>()
    let pending = false
    for (const p of parts) {
      if (p === undefined) pending = true
      else if (!p.ok) for (const b of p.blockers) blockers.add(b)
      else {
        bosses.push(...p.gates.bosses)
        conditions.push(...p.gates.conditions)
      }
    }
    if (blockers.size > 0) return { ok: false, blockers }
    return pending ? undefined : finish(bosses, conditions)
  }

  // every item any route mentions; drop routes are fixed leaves
  const ids = new Set<number>([...ctx.recipesByResult.keys(), ...ctx.dropsByItem.keys()])
  for (const rs of ctx.recipesByResult.values()) {
    for (const r of rs) {
      for (const st of r.stations) if (st.kind === 'item') ids.add(st.itemId)
      for (const ing of r.ingredients) if (ing.ref.kind === 'item') ids.add(ing.ref.itemId)
    }
  }
  for (const g of ctx.groups.values()) for (const m of g.memberItemIds) ids.add(m)
  const order = [...ids].sort((x, y) => x - y)
  const dropRoutes = new Map<number, Derived[]>()
  for (const id of order) {
    dropRoutes.set(
      id,
      (ctx.dropsByItem.get(id) ?? []).map((d) => {
        if (isCoveredBy(d._prov.unverifiedFields, 'conditions')) return fail('drop-conditions-unknown')
        if (d.source.bossId !== undefined) {
          const node = ctx.graph?.bossNode.get(d.source.bossId)
          return node ? finish([node], d.conditions) : fail('progression-graph-pending')
        }
        return isCoveredBy(d._prov.unverifiedFields, 'source.bossId') ? fail('boss-attribution-pending') : fail('drop-source-ungated')
      }),
    )
  }

  const values = new Map<number, Val>()
  const of = (id: number): Val => (ids.has(id) ? values.get(id) : fail('no-known-route'))
  const group = (groupId: string): Val => minOf((ctx.groups.get(groupId)?.memberItemIds ?? []).map(of))
  const evaluate = (id: number): Val => {
    const routes: Val[] = [...(dropRoutes.get(id) ?? [])]
    for (const r of ctx.recipesByResult.get(id) ?? []) {
      const parts: Val[] = []
      for (const st of r.stations) {
        if (st.kind === 'item') parts.push(of(st.itemId))
        else if (st.kind === 'group') parts.push(group(st.groupId))
      }
      for (const ing of r.ingredients) parts.push(ing.ref.kind === 'item' ? of(ing.ref.itemId) : group(ing.ref.groupId))
      routes.push(allOf(parts, r.conditions))
    }
    return minOf(routes)
  }
  const key = (v: Val) => (v === undefined ? '' : v.ok ? JSON.stringify([v.gates, v.stage]) : `!${[...v.blockers].sort().join('+')}`)
  const settle = (phase: string) => {
    for (let pass = 0; ; pass += 1) {
      if (pass > 10_000) throw new Error(`gating fixed point did not converge (${phase})`)
      let changed = false
      for (const id of order) {
        const next = evaluate(id)
        if (key(next) !== key(values.get(id))) {
          values.set(id, next)
          changed = true
        }
      }
      if (!changed) return
    }
  }
  // phase 1: a route through a not-yet-derived item is not counted, so a cycle that is grounded
  // elsewhere resolves to the grounded value (A ⇄ B by Shimmer, A dropped by a boss → B = A).
  settle('phase 1')
  // phase 2: what is still underived depends only on cycles with no grounded route — the data has
  // no acquisition for it, so it is a failing (unverified) input from here on.
  for (const id of order) if (values.get(id) === undefined) values.set(id, fail('cycle'))
  settle('phase 2')

  return (itemId) => {
    const d = of(itemId) ?? fail('cycle')
    if (!d.ok) {
      // a cut cycle only explains the failure when nothing else blocked
      const blockers = [...d.blockers].filter((b) => b !== 'cycle' || d.blockers.size === 1).sort()
      return { ok: false, blockers }
    }
    return { ok: true, gatedBy: { bosses: d.gates.bosses, conditions: d.gates.conditions, stage: d.stage } }
  }
}
