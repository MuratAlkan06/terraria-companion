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
 *   progression node; a container in the reviewed container registry (`containers`, keyed by the
 *   container name AND the article its Cargo Drops rows live on, so seed-page rows never match) gates
 *   on its quoted conditions; an enemy or any other container has no verified gating (Enemy.stage is
 *   Unknown) ⇒ the route is not derivable.
 * - AMENDMENTS-014 B68 / AMENDMENTS-015 B78 extra routes (`extraRoutes`, per item):
 *   · gather: a curated gatherable base material (mined / chopped / harvested / dropped by common
 *     slimes, quote-backed) — its own conditions only (none = gate-free, early pre-Hardmode);
 *   · purchase: a vendor route whose NPC availability and shop row are honestly derivable — the
 *     NPC's quoted conditions ∪ the shop row's mapped conditions ∪, for every "has one of these items"
 *     requirement, the MINIMUM over those items (any one suffices) ∪ the gating of NPCs it needs;
 *   · unknown: a route that exists but is not derivable (a vendor whose availability or shop row is
 *     not structured) — it blocks exactness like any unverified input.
 * Conditions with `satisfiedByNode` become node gates (hardmode ⇐ the Hardmode milestone); the rest
 * stay conditions. Boss gates are transitively reduced against the required-gate DAG and
 * `stage` = max over the gating nodes of (unlocksStage ?? stage) (AMENDMENTS-005 B22; early-prehm
 * when there are none).
 * Either-or conditions: when the least-gated derivable alternatives tie on their boss gates but need
 * different non-node conditions (Shadow Orb in Corruption worlds, Crimson Heart in Crimson worlds),
 * no single condition list is the minimum. If one alternative's conditions are a subset of every
 * other's, it is the minimum; if the differing conditions together form a reviewed EXHAUSTIVE group
 * (every world satisfies one of them — `exhaustive`, quote-backed in overlays/conditions.json), the
 * either-or is always satisfiable and drops out; otherwise the minimum is not expressible
 * (blocker `condition-alternatives`, never a picked side).
 * Sufficient bounds: a route that is not derivable as a whole may still contain a derivable,
 * SUFFICIENT gate set (a chest yields Iron Bars in Iron worlds, even though crates and slime drops
 * of Iron Bars are not derivable). Every failed value carries its best known sufficient set
 * (`bound`, never emitted). A gate-free sufficient set — directly, or as the either-or of bounds over
 * an exhaustive group ("Any Iron Bar": Iron Bars in Iron worlds OR Lead Bars in Lead worlds) — is the
 * exact minimum, since nothing is less gated; any other bound stays Unknown (the minimum is unknown).
 * World-specific container loot (`containerItemConditions`, quote-backed in overlays/containers.json):
 * the chest loot tables state the ore-tier bars per world ("Iron Bar (in worlds with Iron)"), so a
 * registered container's drop of such an item also carries that world-ore condition.
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
  'no-known-route': 'an input item has no recipe, drop, vendor or gatherable route in the datasets (fishing-only or otherwise unmodeled items: item corpus P6-S0)',
  'drop-source-ungated': 'a drop comes from an enemy, an event boss or a container outside the reviewed container registry (Enemy.stage Unknown; event bosses are progression markers, not Boss records; crates / lock boxes / bags are not reviewed)',
  'boss-attribution-pending': 'a boss drop has no verified boss → progression-node attribution (source.bossId Unknown: the row\'s NPC ids disagree with the registry boss)',
  'drop-conditions-unknown': 'a drop lists its conditions as Unknown',
  'vendor-conditions-unknown': 'a purchase route exists but the item\'s row in the NPC shop table is missing or its Availability text is not a reviewed condition (an OR, an item in the inventory, a season, a Bestiary / golf threshold …)',
  'progression-graph-pending': 'a gate maps to a progression node that is not in the dataset, so the stage cannot be computed',
  'acquisition-withheld': 'the item\'s acquisition is withheld because wiki sources conflict (AMENDMENTS-004 B19)',
  'alternative-route-unverified': 'one route is derivable, but another route is not, and it could be the less gated one — the minimum over routes is unknown (§7b)',
  'vendor-availability-unknown': 'a purchase route\'s vendor NPC has no honestly derivable availability (several alternative bosses, a count of other NPCs, a random visit — overlays/vendors.json)',
  'condition-alternatives': 'the least-gated routes need different world / biome / time conditions and no single condition list is their minimum (an either-or GatedBy cannot express)',
  cycle: 'every route needs the item itself (recipe cycle)',
} as const
export type GatingBlocker = keyof typeof GATING_BLOCKERS

/**
 * A non-recipe, non-drop acquisition route the deriver takes into account (B68/B78, see header).
 * `requiresAnyOf`: each inner list is one "has one of these items" requirement (minimum over the list);
 * `requiresNpcs`: vendor NPCs that must be present (their own availability gating).
 */
export type ExtraRoute =
  | { kind: 'gather' | 'purchase'; conditions: readonly string[]; requiresAnyOf?: readonly (readonly number[])[]; requiresNpcs?: readonly string[] }
  | { kind: 'unknown'; blocker: GatingBlocker }

/** A vendor NPC's availability (the gate of "this NPC is present"), same shape as a purchase route's NPC part. */
export interface NpcAvailability {
  conditions: readonly string[]
  requiresAnyOf?: readonly (readonly number[])[]
  requiresNpcs?: readonly string[]
}

export interface GatingContext {
  recipesByResult: ReadonlyMap<number, readonly Recipe[]>
  dropsByItem: ReadonlyMap<number, readonly DropSource[]>
  groups: ReadonlyMap<string, RecipeGroup>
  conditions: ReadonlyMap<string, Condition>
  /** B68/B78: gather / purchase / unknown routes per item (absent = none). */
  extraRoutes?: ReadonlyMap<number, readonly ExtraRoute[]>
  /** Vendor NPC availability by NPC name (purchase routes' `requiresNpcs`). */
  npcs?: ReadonlyMap<string, NpcAvailability>
  /**
   * Reviewed container registry: the gate of a drop whose source is this container on this article
   * (key `${npcName}|${article url}`) — its conditions (node-mapped ones become boss gates).
   */
  containers?: ReadonlyMap<string, { conditions: readonly string[] }>
  /** Exhaustive non-node condition groups (every world satisfies one member): either-or over a group is always satisfiable. */
  exhaustive?: readonly (readonly string[])[]
  /** World-specific loot: item → conditions added to every registered-container drop of it (see header). */
  containerItemConditions?: ReadonlyMap<number, readonly string[]>
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

type Exact = { ok: true; gates: Gates; stage: Stage }
/** `bound`: the best known SUFFICIENT gate set (header "Sufficient bounds") — internal, never emitted. */
type Derived = Exact | { ok: false; blockers: Set<GatingBlocker>; bound?: Exact }

export type GatingResult = { ok: true; gatedBy: GatedBy } | { ok: false; blockers: GatingBlocker[] }

/**
 * The deriver: item → its exact §7b gating, or why not. `sufficient(item)` = for an underived item, its
 * best known SUFFICIENT gate set (header "Sufficient bounds") — report evidence only, never emitted.
 */
export type GatingDeriver = ((itemId: number) => GatingResult) & { sufficient: (itemId: number) => GatedBy | undefined }

const fail = (...b: GatingBlocker[]): Derived => ({ ok: false, blockers: new Set(b) })

/** Container-registry key of a drop: source name + the article its Cargo Drops row lives on. */
export const containerKey = (npcName: string, articleUrl: string): string => `${npcName}|${articleUrl}`

/** The article (canonical URL) a drop record was extracted from (its cargo:Drops source). */
export const dropArticleUrl = (d: Pick<DropSource, '_prov'>): string | undefined => d._prov.sources.find((s) => s.kind === 'cargo:Drops')?.url

export function createGatingDeriver(ctx: GatingContext): GatingDeriver {

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
      // B22: a stage-transition gate contributes the stage it opens (defeating the Wall of Flesh
      // makes its drops Early Hardmode content), every other gate its own stage
      const node = ctx.graph?.nodes.get(n)
      const s = (node?.unlocksStage ?? node?.stage) as Stage
      if (STAGE_ORDER[s] > STAGE_ORDER[stage]) stage = s
    }
    return { ok: true, gates: { bosses: reduced, conditions: [...conds].sort() }, stage }
  }

  const rank = (d: Exact) => [STAGE_ORDER[d.stage], d.gates.bosses.length, d.gates.conditions.length, JSON.stringify(d.gates)] as const
  const better = (a: Exact, b: Exact) => {
    const [ra, rb] = [rank(a), rank(b)]
    for (let i = 0; i < ra.length; i += 1) if (ra[i] !== rb[i]) return ra[i] < rb[i]
    return false
  }
  const ungated = (d: Exact) => d.gates.bosses.length === 0 && d.gates.conditions.length === 0

  // ---- global fixed point (DATA_SCHEMA_SPEC §7b; see the header) --------------------------------
  // `undefined` = no derivation established yet (a route through an item not yet derived).
  type Val = Derived | undefined

  /**
   * Minimum over alternatives (routes of an item, members of a group). Exact only when every
   * alternative is derivable — or the best one is gate-free, which nothing can beat. Pending
   * alternatives are ignored while iterating (phase 1) and are failures afterwards (phase 2).
   */
  const exhaustive = (ctx.exhaustive ?? []).map((g) => new Set(g))
  /**
   * The least-gated derivable alternatives: those tying the best on stage and boss gates. Their
   * condition lists may differ (header "Either-or conditions"): a subset of all others is the minimum;
   * differences forming one exhaustive group drop out; anything else is not expressible.
   */
  const conditionMinimum = (best: Exact, derived: readonly Exact[]): Derived => {
    const bossKey = (d: Exact) => `${d.stage}|${d.gates.bosses.join(',')}`
    const tied = derived.filter((d) => bossKey(d) === bossKey(best))
    const sets = tied.map((d) => new Set(d.gates.conditions))
    const subsetOfAll = tied.find((_, i) => sets.every((other) => [...sets[i]].every((c) => other.has(c))))
    if (subsetOfAll) return subsetOfAll
    const common = [...sets[0]].filter((c) => sets.every((x) => x.has(c)))
    const differing = new Set(sets.flatMap((x) => [...x].filter((c) => !common.includes(c))))
    // every tied alternative contributes exactly one differing condition, all from one exhaustive group
    const group = exhaustive.find((g) => [...differing].every((c) => g.has(c)))
    const coversGroup = group && sets.every((x) => [...x].filter((c) => !common.includes(c)).length === 1) && [...group].every((c) => differing.has(c))
    if (coversGroup) return { ok: true, gates: { bosses: best.gates.bosses, conditions: common.sort() }, stage: best.stage }
    return fail('condition-alternatives')
  }

  const bestOf = (list: readonly Exact[]): Exact | undefined => list.reduce<Exact | undefined>((b, a) => (!b || better(a, b) ? a : b), undefined)
  const minOf = (alternatives: readonly Val[]): Val => {
    const derived: Exact[] = []
    const bounds: Exact[] = []
    const blockers = new Set<GatingBlocker>()
    let pending = false
    for (const a of alternatives) {
      if (a === undefined) pending = true
      else if (a.ok) derived.push(a)
      else {
        for (const b of a.blockers) blockers.add(b)
        if (a.bound) bounds.push(a.bound)
      }
    }
    // a gate-free sufficient set — exact, or the either-or of exact routes and sufficient bounds — is the minimum
    const candidates = [...derived, ...bounds]
    const bestCandidate = bestOf(candidates)
    const merged = bestCandidate ? conditionMinimum(bestCandidate, candidates) : undefined
    if (merged?.ok && ungated(merged)) return merged
    const best = bestOf(derived)
    if (blockers.size > 0) {
      if (best) blockers.add('alternative-route-unverified')
      const bound = merged?.ok ? merged : bestCandidate
      return { ok: false, blockers, ...(bound ? { bound } : {}) }
    }
    if (best) {
      const m = conditionMinimum(best, derived)
      return m.ok ? m : { ...m, bound: best }
    }
    return pending ? undefined : fail('no-known-route')
  }
  /** Union of required parts (all must hold); pending while any part is. */
  const allOf = (parts: readonly Val[], extraConditions: readonly string[] = []): Val => {
    const bosses: string[] = []
    const conditions: string[] = [...extraConditions]
    const blockers = new Set<GatingBlocker>()
    let pending = false
    let bounded = true
    for (const p of parts) {
      if (p === undefined) pending = true
      else {
        const gates = p.ok ? p.gates : p.bound?.gates
        if (!p.ok) for (const b of p.blockers) blockers.add(b)
        if (gates) {
          bosses.push(...gates.bosses)
          conditions.push(...gates.conditions)
        } else bounded = false
      }
    }
    if (blockers.size > 0) {
      // every part has a sufficient set ⇒ their union is a sufficient set for the whole route
      const bound = bounded && !pending ? finish(bosses, conditions) : undefined
      return { ok: false, blockers, ...(bound?.ok ? { bound } : {}) }
    }
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
  for (const [id, routes] of ctx.extraRoutes ?? []) {
    ids.add(id)
    for (const r of routes) if (r.kind !== 'unknown') for (const list of r.requiresAnyOf ?? []) for (const m of list) ids.add(m)
  }
  for (const n of ctx.npcs?.values() ?? []) for (const list of n.requiresAnyOf ?? []) for (const m of list) ids.add(m)
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
        if (isCoveredBy(d._prov.unverifiedFields, 'source.bossId')) return fail('boss-attribution-pending')
        const url = dropArticleUrl(d)
        const container = url ? ctx.containers?.get(containerKey(d.source.npcName, url)) : undefined
        return container ? finish([], [...container.conditions, ...(ctx.containerItemConditions?.get(id) ?? []), ...d.conditions]) : fail('drop-source-ungated')
      }),
    )
  }

  const values = new Map<number, Val>()
  const of = (id: number): Val => (ids.has(id) ? values.get(id) : fail('no-known-route'))
  const group = (groupId: string): Val => minOf((ctx.groups.get(groupId)?.memberItemIds ?? []).map(of))
  /** "Has one of these items" / "these NPCs are present" + conditions (NPC availability and purchase routes). */
  const requirement = (r: NpcAvailability, seen: ReadonlySet<string>): Val => {
    const parts: Val[] = (r.requiresAnyOf ?? []).map((list) => minOf(list.map(of)))
    for (const npc of r.requiresNpcs ?? []) parts.push(npcGate(npc, seen))
    return allOf(parts, r.conditions)
  }
  const npcGate = (name: string, seen: ReadonlySet<string> = new Set()): Val => {
    const n = ctx.npcs?.get(name)
    if (!n) return fail('vendor-availability-unknown')
    if (seen.has(name)) return fail('cycle')
    return requirement(n, new Set([...seen, name]))
  }
  const evaluate = (id: number): Val => {
    const routes: Val[] = [...(dropRoutes.get(id) ?? [])]
    for (const r of ctx.extraRoutes?.get(id) ?? []) routes.push(r.kind === 'unknown' ? fail(r.blocker) : requirement(r, new Set()))
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
  const key = (v: Val) => (v === undefined ? '' : v.ok ? JSON.stringify([v.gates, v.stage]) : `!${[...v.blockers].sort().join('+')}${v.bound ? JSON.stringify([v.bound.gates, v.bound.stage]) : ''}`)
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

  const toGatedBy = (d: Exact): GatedBy => ({ bosses: d.gates.bosses, conditions: d.gates.conditions, stage: d.stage })
  const derive = (itemId: number): GatingResult => {
    const d = of(itemId) ?? fail('cycle')
    if (!d.ok) {
      // a cut cycle only explains the failure when nothing else blocked
      const blockers = [...d.blockers].filter((b) => b !== 'cycle' || d.blockers.size === 1).sort()
      return { ok: false, blockers }
    }
    return { ok: true, gatedBy: toGatedBy(d) }
  }
  const sufficient = (itemId: number): GatedBy | undefined => {
    const d = of(itemId)
    return d && !d.ok && d.bound ? toGatedBy(d.bound) : undefined
  }
  return Object.assign(derive, { sufficient })
}
