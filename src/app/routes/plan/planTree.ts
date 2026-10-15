/**
 * Feature B — the acquisition-plan engine ("What Should I Grind For?", PRD P6-S5/S6 + §9 Feature B; UX_SPEC
 * §3.9). Pure TypeScript over the recipe / drop / item records (no React, DOM, sim or lab): a goal item and
 * a quantity in, a bill-of-materials graph out — every item reached through the chosen ways to get it, the
 * exact quantities each needs (recipe yields applied, duplicates aggregated), and the checklist steps.
 *
 * Model
 * - Node keys are TypedRefs: `i:<itemId>` for items, `grp:<slug>` for "Any X" recipe groups.
 * - A record's ROUTES are its acquisition entries, a craft entry split into one route per recipe. They are
 *   the data's own, in the data's order; nothing here ranks them.
 * - SELECTION per node: the user's choice (`choices`, keyed by node, so one item is got one way across the
 *   whole plan) when it names a route that still exists; else the only route; else, when every route is a
 *   recipe, the first recipe (data order) that doesn't need an item already being planned on its path —
 *   shown as "recipe 1 of N" with the rest one tap away; else the node stays OPEN: several ways, listed as
 *   choices, none picked for the user. "Any X" groups stay open until a member is chosen.
 * - The graph is walked depth-first from the goal; each item expands ONCE (its first visit) and later uses
 *   reference it — so the tree view lists every distinct item once and quantities aggregate over every use.
 *   An ingredient already on the current path is CIRCULAR (Wood ← Wood Platform ← Wood): flagged, never
 *   expanded, never counted.
 * - Guards: expansion stops at MAX_DEPTH levels or MAX_EXPANDED expanded items; the cut nodes are flagged
 *   `truncated` (the UI says where the plan stops, never pretends it is complete).
 * - Quantities: reverse post-order of the walk is a topological order of the non-circular edges, so each
 *   node's total is final before it hands demand down: crafts = ceil(need / recipe yield), each ingredient
 *   gets crafts × amount. Owned quantities and checked steps reduce a node's need before it hands down
 *   (checking "Craft Night's Edge" covers everything beneath it).
 *
 * Records not loaded yet are reported in `missing` (the caller loads them and builds again) — the walk's items,
 * and every input of every recipe route (ingredients, stations, "Any X" members: the way chooser states each
 * way's gating from them); records the dataset doesn't have are `not-in-dataset` leaves. Nothing is invented: a node with no verified way to get
 * it is a "no known source" leaf (acquisition Unknown), never a guessed route.
 */
import type { Acquisition, DropSource, GatedBy, Item, Recipe, RecipeGroup } from '../../../schemas'
import { getField } from '../../../schemas/getField'

/** The fields of an item record (weapon, armor piece, accessory or Item) the planner reads. */
export type PlanRecord = Pick<Item, 'id' | 'name' | 'wikiUrl' | 'acquisition' | 'gatedBy' | '_prov'> & {
  sprite?: string
  rarity?: Item['rarity']
}

export interface PlanLookup {
  /** The record; `undefined` = not loaded yet (reported in `missing`); `null` = not in the dataset. */
  record(id: number): PlanRecord | null | undefined
  recipe(id: string): Recipe | undefined
  group(id: string): RecipeGroup | undefined
  drop(id: string): DropSource | undefined
}

export type RouteMethod = Acquisition['method']

export interface PlanRoute {
  /** Stable key: `craft:<recipeId>`, `drop:<first drop id>`, `purchase:<vendor>`, `loot:…`, `fishing:…`, `other:…`. */
  key: string
  method: RouteMethod
  /** Index of the acquisition entry on the record. */
  acqIndex: number
  /** Craft routes: the recipe (undefined if the recipe data lacks it). */
  recipe?: Recipe
  recipeId?: string
}

export type SelectionWhy = 'chosen' | 'only' | 'first-recipe'

export type Selection =
  | { kind: 'route'; route: PlanRoute; why: SelectionWhy }
  /** Several ways and none chosen: the node lists them as choices. */
  | { kind: 'open' }
  /** No way to get it is known: acquisition Unknown / empty, or the item isn't in the dataset. */
  | { kind: 'none'; reason: 'no-source' | 'not-in-dataset' }

export interface PlanEdge {
  /** Target node key (`i:<id>` or `grp:<slug>`). */
  to: string
  /** Per craft (item parents) — or, from a group, 1 (the group hands its whole need to the chosen member). */
  amount: number
  /** The target is already being planned on this path: never expanded, never counted. */
  circular: boolean
}

interface NodeBase {
  key: string
  /** Depth of the expanded (first) occurrence; the goal is 0. */
  depth: number
  /** The node it was first reached from (the tree view expands it there); undefined for the goal. */
  treeParent?: string
  edges: PlanEdge[]
  /** Reached but not expanded: the depth or size guard cut the plan here. */
  truncated?: 'depth' | 'size'
}

export interface PlanItemNode extends NodeBase {
  kind: 'item'
  id: number
  /** Undefined while loading (`pending`) or when the dataset lacks the item. */
  record?: PlanRecord
  pending?: true
  routes: PlanRoute[]
  selection: Selection
  /** Recipe routes that would need an item already being planned on this node's path (circular here). */
  circularRoutes: string[]
  /**
   * Recipe routes the planner never picks for the user, and why: a Shimmer transmutation, circular on this path
   * (`via` = the node key of the ingredient already being planned on it), or a reversal (`via` = the ingredient
   * made only from this item). They stay choosable.
   */
  heldRoutes: Record<string, HeldReason>
}

export type HeldReason = { kind: 'shimmer' } | { kind: 'circular'; via: string } | { kind: 'reversal'; via: number }

export interface PlanGroupNode extends NodeBase {
  kind: 'group'
  groupId: string
  group?: RecipeGroup
  /** The chosen member item (undefined: open). */
  member?: number
}

export type PlanNode = PlanItemNode | PlanGroupNode

export interface PlanLimits {
  maxDepth: number
  maxExpanded: number
}

/**
 * Real-data scale (src/data, 2026-10-15): with every recipe expanded the deepest chain is 8 levels and the
 * widest goal (Zenith) reaches 41 items, so these limits only bind on pathological data — tested with a
 * synthetic chain.
 */
export const PLAN_LIMITS: PlanLimits = { maxDepth: 16, maxExpanded: 300 }

export interface PlanGraph {
  goal: string
  goalAmount: number
  nodes: Map<string, PlanNode>
  /** Topological order (reverse post-order of the walk): every node after all of its non-circular parents. */
  order: string[]
  /** Item ids whose records must load before the plan is complete. */
  missing: Set<number>
  /** Choices naming a route / member that no longer exists (ignored; the default applies). */
  staleChoices: string[]
  truncated: boolean
}

export const itemKey = (id: number): string => `i:${id}`
export const groupKey = (id: string): string => `grp:${id}`
export function parseNodeKey(key: string): { kind: 'item'; id: number } | { kind: 'group'; id: string } | undefined {
  const item = /^i:([1-9]\d*)$/.exec(key)
  if (item) return { kind: 'item', id: Number(item[1]) }
  const group = /^grp:([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(key)
  return group ? { kind: 'group', id: group[1] } : undefined
}

// --- routes -----------------------------------------------------------------------------------------

/** The record's routes in data order (none when its acquisition is Unknown). */
export function routesOf(record: PlanRecord, lookup: Pick<PlanLookup, 'recipe'>): PlanRoute[] {
  if (getField(record, 'acquisition').status === 'unverified') return []
  const out: PlanRoute[] = []
  const seen = new Map<string, number>()
  const push = (base: string, route: Omit<PlanRoute, 'key'>) => {
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    out.push({ ...route, key: n === 1 ? base : `${base}#${n}` })
  }
  record.acquisition.forEach((a, acqIndex) => {
    switch (a.method) {
      case 'craft':
        for (const recipeId of a.recipeIds) push(`craft:${recipeId}`, { method: 'craft', acqIndex, recipeId, recipe: lookup.recipe(recipeId) })
        return
      case 'drop':
        return push(`drop:${a.dropIds[0]}`, { method: 'drop', acqIndex })
      case 'purchase':
        return push(`purchase:${a.npcName}`, { method: 'purchase', acqIndex })
      case 'loot':
        return push(`loot:${a.containers.join('+')}`, { method: 'loot', acqIndex })
      case 'fishing':
        return push(`fishing:${a.biomes.join('+')}`, { method: 'fishing', acqIndex })
      case 'other':
        return push(`other:${a.sourceUrl}`, { method: 'other', acqIndex })
    }
  })
  return out
}

/** A Shimmer transmutation (the `shimmer` environment station): it converts an item already held. */
export function isShimmer(recipe: Recipe): boolean {
  return recipe.stations.some((s) => s.kind === 'environment' && s.condition === 'shimmer')
}

/**
 * The selection with no choice of the user's (module note "SELECTION"): the only route; else, every route a
 * recipe, the first one the planner may pick (not held back); else open. Also what "Decide later" returns to.
 */
export function defaultSelection(routes: readonly PlanRoute[], heldRoutes: Readonly<Record<string, HeldReason>>): Selection {
  const autoEligible = (route: PlanRoute) => route.recipe !== undefined && heldRoutes[route.key] === undefined
  if (routes.length === 1 && (routes[0].method !== 'craft' || autoEligible(routes[0]))) return { kind: 'route', route: routes[0], why: 'only' }
  if (routes.length > 1 && routes.every((r) => r.method === 'craft')) {
    const first = routes.find(autoEligible)
    if (first) return { kind: 'route', route: first, why: 'first-recipe' }
  }
  return { kind: 'open' }
}

/** The ingredient node keys of a recipe (a group ingredient is its group node). */
function ingredientKey(ref: Recipe['ingredients'][number]['ref']): string {
  return ref.kind === 'item' ? itemKey(ref.itemId) : groupKey(ref.groupId)
}

// --- the walk ---------------------------------------------------------------------------------------

export function buildPlanGraph(
  goalId: number,
  goalAmount: number,
  choices: Readonly<Record<string, string>>,
  lookup: PlanLookup,
  limits: PlanLimits = PLAN_LIMITS,
): PlanGraph {
  const nodes = new Map<string, PlanNode>()
  const post: string[] = []
  const missing = new Set<number>()
  const staleChoices = new Set<string>()
  const stack = new Set<string>()
  let expanded = 0
  let truncated = false

  /** The ingredient this recipe needs that is already on the path (or the item itself), if any: its node key. */
  const recipeCircular = (recipe: Recipe, self: string): string | undefined => {
    for (const ing of recipe.ingredients) {
      const key = ingredientKey(ing.ref)
      if (key === self || stack.has(key)) return key
      if (ing.ref.kind !== 'group') continue
      const member = choices[key]
      if (member !== undefined && (member === self || stack.has(member))) return member
    }
    return undefined
  }

  /**
   * Records the views read beyond the walk (B118(f) per-way gates in the chooser): every input of every recipe
   * route — its ingredients and station items, an "Any X" group as its members — including the routes the
   * planner holds back (Shimmer, circular), whose inputs the held-route checks never reach. Not loaded yet →
   * reported missing, like an ingredient on the path.
   */
  const wantInputs = (routes: readonly PlanRoute[]) => {
    const want = (ids: Iterable<number>) => {
      for (const id of ids) if (lookup.record(id) === undefined) missing.add(id)
    }
    const members = (groupId: string) => lookup.group(groupId)?.memberItemIds ?? []
    for (const r of routes) {
      for (const s of r.recipe?.stations ?? []) want(s.kind === 'item' ? [s.itemId] : s.kind === 'group' ? members(s.groupId) : [])
      for (const ing of r.recipe?.ingredients ?? []) want(ing.ref.kind === 'item' ? [ing.ref.itemId] : members(ing.ref.groupId))
    }
  }

  /**
   * A reversal recipe: an ingredient whose every way to get it is a recipe made from this very item (Obsidian
   * from Obsidian Walls, which are made from Obsidian) — following it only leads back. An ingredient not
   * loaded yet is reported as missing; the caller loads it and builds again, so the result is deterministic.
   */
  const reversalVia = (recipe: Recipe, self: string, selfId: number): number | undefined => {
    for (const ing of recipe.ingredients) {
      if (ing.ref.kind !== 'item' || itemKey(ing.ref.itemId) === self) continue
      const rec = lookup.record(ing.ref.itemId)
      if (rec === undefined) {
        missing.add(ing.ref.itemId)
        continue
      }
      if (rec === null) continue
      const routes = routesOf(rec, lookup)
      if (routes.length > 0 && routes.every((r) => r.recipe?.ingredients.some((i) => i.ref.kind === 'item' && i.ref.itemId === selfId))) return ing.ref.itemId
    }
    return undefined
  }

  /**
   * Why the planner won't pick this recipe for the user, if it won't: a Shimmer transmutation (it converts an
   * item you already hold — not a source), a circular recipe, a reversal.
   */
  const heldReason = (recipe: Recipe, self: string, selfId: number): HeldReason | undefined => {
    if (isShimmer(recipe)) return { kind: 'shimmer' }
    const circularVia = recipeCircular(recipe, self)
    if (circularVia !== undefined) return { kind: 'circular', via: circularVia }
    const via = reversalVia(recipe, self, selfId)
    return via === undefined ? undefined : { kind: 'reversal', via }
  }

  const selectFor = (key: string, id: number, routes: PlanRoute[]): { selection: Selection; circularRoutes: string[]; heldRoutes: Record<string, HeldReason> } => {
    const circularRoutes = routes.filter((r) => r.recipe && recipeCircular(r.recipe, key) !== undefined).map((r) => r.key)
    const heldRoutes: Record<string, HeldReason> = {}
    for (const r of routes) {
      const reason = r.recipe ? heldReason(r.recipe, key, id) : undefined
      if (reason) heldRoutes[r.key] = reason
    }
    const chosenKey = choices[key]
    if (chosenKey !== undefined) {
      const chosen = routes.find((r) => r.key === chosenKey)
      if (chosen) return { selection: { kind: 'route', route: chosen, why: 'chosen' }, circularRoutes, heldRoutes }
      staleChoices.add(key)
    }
    return { selection: defaultSelection(routes, heldRoutes), circularRoutes, heldRoutes }
  }

  /** Expand guard: may this node hand demand down to its children? */
  const guard = (depth: number): 'depth' | 'size' | undefined => {
    if (depth >= limits.maxDepth) return 'depth'
    if (expanded >= limits.maxExpanded) return 'size'
    return undefined
  }

  const visitChildren = (node: PlanNode) => {
    stack.add(node.key)
    for (const edge of node.edges) {
      if (edge.circular || nodes.has(edge.to)) continue
      visit(edge.to, node.depth + 1, node.key)
    }
    stack.delete(node.key)
  }

  const visit = (key: string, depth: number, parent: string | undefined) => {
    if (nodes.has(key)) return
    const parsed = parseNodeKey(key)
    if (!parsed) return
    if (parsed.kind === 'group') {
      const group = lookup.group(parsed.id)
      const chosen = choices[key]
      const memberId = chosen !== undefined ? parseNodeKey(chosen) : undefined
      const member = memberId?.kind === 'item' && group?.memberItemIds.includes(memberId.id) ? memberId.id : undefined
      if (chosen !== undefined && member === undefined) staleChoices.add(key)
      const node: PlanGroupNode = { kind: 'group', key, groupId: parsed.id, depth, edges: [], ...(group ? { group } : {}), ...(parent ? { treeParent: parent } : {}) }
      nodes.set(key, node)
      // the chooser states each member's availability (B118(f)), so every member's record is wanted
      for (const id of group?.memberItemIds ?? []) if (lookup.record(id) === undefined) missing.add(id)
      if (member !== undefined) {
        const cut = guard(depth)
        if (cut) {
          node.truncated = cut
          truncated = true
        } else {
          const to = itemKey(member)
          node.member = member
          node.edges = [{ to, amount: 1, circular: stack.has(to) }]
          expanded++
          visitChildren(node)
        }
      }
      post.push(key)
      return
    }

    const record = lookup.record(parsed.id)
    const node: PlanItemNode = {
      kind: 'item',
      key,
      id: parsed.id,
      depth,
      edges: [],
      routes: [],
      selection: { kind: 'none', reason: 'not-in-dataset' },
      circularRoutes: [],
      heldRoutes: {},
      ...(parent ? { treeParent: parent } : {}),
    }
    nodes.set(key, node)
    if (record === undefined) {
      node.pending = true
      missing.add(parsed.id)
      post.push(key)
      return
    }
    if (record !== null) {
      node.record = record
      node.routes = routesOf(record, lookup)
      wantInputs(node.routes)
      if (node.routes.length === 0) node.selection = { kind: 'none', reason: 'no-source' }
      else Object.assign(node, selectFor(key, parsed.id, node.routes))
    }
    const recipe = node.selection.kind === 'route' ? node.selection.route.recipe : undefined
    if (recipe) {
      const cut = guard(depth)
      if (cut) {
        node.truncated = cut
        truncated = true
      } else {
        node.edges = recipe.ingredients.map((ing) => {
          const to = ingredientKey(ing.ref)
          return { to, amount: ing.amount, circular: to === key || stack.has(to) }
        })
        expanded++
        visitChildren(node)
      }
    }
    post.push(key)
  }

  const goal = itemKey(goalId)
  visit(goal, 0, undefined)
  return { goal, goalAmount: Math.max(1, Math.floor(goalAmount)), nodes, order: post.reverse(), missing, staleChoices: [...staleChoices], truncated }
}

// --- quantities -------------------------------------------------------------------------------------

export interface DemandInput {
  /** Owned quantities by node key (an item, or an "Any X" group). */
  owned?: Readonly<Record<string, number>>
  /** Node keys whose step is checked: satisfied in full, nothing handed down. */
  done?: ReadonlySet<string>
}

export interface NodeDemand {
  /** Everything every use asks for (before owned / checked). */
  total: number
  owned: number
  /** Still to get: 0 when checked, owned in full, or nothing above needs it any more. */
  need: number
  /** Crafts still to make (craft selections): ceil(need / yield). */
  crafts: number
  /** Items those crafts produce (≥ need: a recipe may make several). */
  makes: number
  checked: boolean
}

/** Recipe yield of a node's selected craft route (1 for a group or a non-craft node). */
export function yieldOf(node: PlanNode): number {
  return node.kind === 'item' && node.selection.kind === 'route' ? (node.selection.route.recipe?.resultAmount ?? 1) : 1
}

/** What `node` hands to one of its edges given its demand. */
export function edgeQuantity(node: PlanNode, demand: NodeDemand | undefined, edge: PlanEdge): number {
  if (!demand || edge.circular) return 0
  return node.kind === 'group' ? demand.need : demand.crafts * edge.amount
}

export function computeDemand(graph: PlanGraph, input: DemandInput = {}): Map<string, NodeDemand> {
  const incoming = new Map<string, number>([[graph.goal, graph.goalAmount]])
  const out = new Map<string, NodeDemand>()
  for (const key of graph.order) {
    const node = graph.nodes.get(key)
    if (!node) continue
    const total = incoming.get(key) ?? 0
    const checked = input.done?.has(key) ?? false
    const owned = Math.max(0, Math.floor(input.owned?.[key] ?? 0))
    const need = checked ? 0 : Math.max(0, total - owned)
    const expands = node.edges.length > 0
    const crafts = node.kind === 'item' && expands ? Math.ceil(need / yieldOf(node)) : 0
    const demand: NodeDemand = { total, owned, need, crafts, makes: node.kind === 'item' && expands ? crafts * yieldOf(node) : need, checked }
    out.set(key, demand)
    for (const edge of node.edges) incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + edgeQuantity(node, demand, edge))
  }
  return out
}

// --- steps ------------------------------------------------------------------------------------------

/** DATA_SCHEMA_SPEC §8a PlanStepV1 kinds. */
export type PlanStepKind = 'craft' | 'gather' | 'defeat-boss' | 'purchase' | 'fish' | 'loot' | 'event' | 'other'

export interface PlanStep {
  /** Deterministic: kind + refs + amount (§8a), so a step keeps its check mark while the plan is unchanged. */
  stepId: string
  kind: PlanStepKind
  text: string
  itemId?: number
  amount?: number
  nodeId?: string
  /** Checklist grouping (P6-S6 AC2): the activity, vendor, drop source, … (see `stepGroupKey`). */
  groupKey: string
  refs: string[]
}

/** 32-bit FNV-1a, hex — the pipeline's id hash family (DATA_SCHEMA_SPEC §3). */
export function fnv1a32hex(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export const stepIdOf = (kind: PlanStepKind, refs: readonly string[], amount: number | undefined): string =>
  `${kind}-${fnv1a32hex(`${kind}|${refs.join(',')}|${amount ?? ''}`)}`

const METHOD_KIND: Record<RouteMethod, PlanStepKind> = { craft: 'craft', drop: 'gather', purchase: 'purchase', loot: 'loot', fishing: 'fish', other: 'other' }

/** The step kind of a node (groups: gather). */
export function stepKindOf(node: PlanNode): PlanStepKind {
  if (node.kind === 'group') return 'gather'
  if (node.selection.kind === 'route') return node.truncated ? 'gather' : METHOD_KIND[node.selection.route.method]
  return node.selection.kind === 'open' ? 'gather' : 'other'
}

/**
 * The checklist group of a node's step (P6-S6 AC2 "biome / enemy / boss / activity"): bosses to defeat;
 * ways still to choose; one drop source (a boss and its Treasure Bag together, else the source by name) or
 * several; a vendor; fishing; chest loot; other ways; crafting (one activity, listed in order); no known
 * source; and where the plan stops (a guard cut it).
 */
export function stepGroupKey(node: PlanNode, lookup: Pick<PlanLookup, 'drop'>): string {
  if (node.kind === 'group') return node.member === undefined ? 'choose' : 'craft'
  if (node.truncated) return 'stops'
  const sel = node.selection
  if (sel.kind === 'open') return 'choose'
  if (sel.kind === 'none') return 'unknown'
  const route = sel.route
  const acq = node.record?.acquisition[route.acqIndex]
  switch (route.method) {
    case 'craft':
      return 'craft'
    case 'drop': {
      const ids = acq?.method === 'drop' ? acq.dropIds : []
      const sources = new Set(ids.map((id) => lookup.drop(id)).map((d) => (d?.source.bossId ? `boss:${d.source.bossId}` : d ? `source:${d.source.npcName}` : '?')))
      return sources.size === 1 && !sources.has('?') ? [...sources][0] : 'drops'
    }
    case 'purchase':
      return acq?.method === 'purchase' ? `vendor:${acq.npcName}` : 'vendor'
    case 'fishing':
      return 'fishing'
    case 'loot':
      return 'loot'
    case 'other':
      return 'other'
  }
}

export interface StepNames {
  /** Display name of a node (item or group). */
  name(key: string): string
  /** Display name of a progression node (a boss), when known. */
  boss?(id: string): string | undefined
}

function stepText(node: PlanNode, kind: PlanStepKind, amount: number, names: StepNames, lookup: Pick<PlanLookup, 'drop'>): string {
  const name = names.name(node.key)
  const q = `${amount.toLocaleString('en-US')} ${name}`
  if (node.kind === 'group') return `Get ${q}`
  if (kind === 'craft') return `Craft ${q}`
  if (node.selection.kind === 'route') {
    const acq = node.record?.acquisition[node.selection.route.acqIndex]
    if (acq?.method === 'purchase') return `Buy ${q} from ${acq.npcName}`
    if (acq?.method === 'fishing') return `Fish up ${q}`
    if (acq?.method === 'loot') return `Find ${q} in ${acq.containers.join(' or ')}`
    if (acq?.method === 'drop') {
      const group = stepGroupKey(node, lookup)
      const drop = acq.dropIds.map((id) => lookup.drop(id)).find((d) => d !== undefined)
      if (group.startsWith('boss:') && drop?.source.bossId) return `Get ${q} from ${names.boss?.(drop.source.bossId) ?? drop.source.npcName}`
      if (group.startsWith('source:') && drop) return `Get ${q} from ${drop.source.npcName}`
    }
  }
  return `Get ${q}`
}

/**
 * The plan's steps from its STRUCTURAL quantities (nothing owned or checked — so a step's id and amount
 * don't move while the user checks things off): one per node (craft steps in order, deepest first), plus
 * one per boss to defeat. `bosses` are the gate bosses of the plan's items (src/scoring candidates, resolved
 * through milestones), with their display names.
 */
export function planSteps(
  graph: PlanGraph,
  names: StepNames,
  lookup: Pick<PlanLookup, 'drop'>,
  bosses: readonly { id: string; name: string }[] = [],
): PlanStep[] {
  const demand = computeDemand(graph)
  const steps: PlanStep[] = []
  for (const { id, name } of bosses) {
    const refs = [`node:${id}`]
    steps.push({ stepId: stepIdOf('defeat-boss', refs, undefined), kind: 'defeat-boss', text: `Defeat ${name}`, nodeId: id, groupKey: 'bosses', refs })
  }
  // deepest first: an ingredient is listed before what it's crafted into
  const nodes = [...graph.order].reverse().map((k) => graph.nodes.get(k)).filter((n): n is PlanNode => n !== undefined)
  for (const node of nodes) {
    if (node.kind === 'group' && node.member !== undefined) continue // its member carries the step
    const amount = demand.get(node.key)?.total ?? 0
    if (amount <= 0) continue
    const kind = stepKindOf(node)
    const refs = [node.key]
    if (node.kind === 'item' && node.selection.kind === 'route' && node.selection.route.recipeId && !node.truncated) refs.push(`rcp:${node.selection.route.recipeId}`)
    steps.push({
      stepId: stepIdOf(kind, refs, amount),
      kind,
      text: stepText(node, kind, amount, names, lookup),
      ...(node.kind === 'item' ? { itemId: node.id } : {}),
      amount,
      groupKey: stepGroupKey(node, lookup),
      refs,
    })
  }
  return steps
}

/** The gate slugs (verified gatedBy.bosses) of every item in the plan, in walk order, deduplicated. */
export function planGateSlugs(graph: PlanGraph): string[] {
  const out = new Set<string>()
  for (const key of graph.order) {
    const node = graph.nodes.get(key)
    if (node?.kind !== 'item' || !node.record) continue
    const view = getField(node.record, 'gatedBy')
    if (view.status !== 'verified' && view.status !== 'editorial') continue
    for (const slug of (view.value as GatedBy).bosses) out.add(slug)
  }
  return [...out]
}

/** Every node with more than one way to get it (the "Other routes" list): open nodes, chosen-among and recipe-1-of-N ones. */
export function branchNodes(graph: PlanGraph): PlanNode[] {
  return graph.order
    .map((k) => graph.nodes.get(k))
    .filter((n): n is PlanNode => n !== undefined)
    .filter((n) => (n.kind === 'item' ? n.routes.length > 1 : (n.group?.memberItemIds.length ?? 0) > 1))
}
