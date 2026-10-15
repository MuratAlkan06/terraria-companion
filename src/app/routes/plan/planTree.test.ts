/* Feature B engine (PRD P6-S5/S6, §9 Feature B; UX_SPEC §3.9): the plan graph's math on hand-built fixtures
 * (recipe yields, aggregation of duplicates, owned / checked propagation, cycles and reversals, Shimmer
 * transmutations, "Any X" groups, choices and stale choices, depth / size guards, records loading in), then
 * the real dataset (Night's Edge end to end, Zenith complete, every item builds with no record missing and no
 * guard hit, a goal with no known source), the obtainable-now states and the step ids. */
import { describe, expect, it } from 'vitest'
import type { DropSource, Recipe, RecipeGroup } from '../../../data-access/types'
import { availabilityOf } from '../../../scoring/candidates'
import type { TrackedProgress } from '../../../scoring/progress'
import { completionAnnouncement } from './planAnnouncements'
import * as copy from './planCopy'
import { bossGates, coveredSubtrees, generateSteps, planView, progressBasis, snapshotDrift } from './planModel'
import { openButWaysUnknown, routeGate, type RouteGateCtx } from './planRouteGates'
import { heldText } from './planText'
import { buildPlanGraph, computeDemand, itemKey, PLAN_LIMITS, planSteps, stepIdOf, type PlanItemNode, type PlanLookup, type PlanRecord } from './planTree'
import { CONDITIONS, DROPS, GRAPH, idOf, names, RECORDS, realLookup } from './planTestData'

// --- fixtures --------------------------------------------------------------------------------------

const prov = (unverifiedFields: string[] = []) => ({ gameVersion: '1.4.5.8', sources: [], verified: unverifiedFields.length === 0, unverifiedFields, editorialFields: [] })
const url = (n: string) => `https://terraria.wiki.gg/wiki/${n}`

type Ing = [number | string, number]
function recipe(id: string, result: number, ingredients: Ing[], opts: { makes?: number; shimmer?: boolean } = {}): Recipe {
  return {
    id,
    resultItemId: result,
    resultAmount: opts.makes ?? 1,
    stations: opts.shimmer ? [{ kind: 'environment', condition: 'shimmer', name: 'Shimmer' }] : [{ kind: 'item', itemId: 900 }],
    conditions: [],
    ingredients: ingredients.map(([ref, amount]) => ({ amount, ref: typeof ref === 'number' ? { kind: 'item', itemId: ref } : { kind: 'group', groupId: ref } })),
    _prov: prov(),
  } as Recipe
}

function rec(id: number, name: string, acquisition: PlanRecord['acquisition'], extra: Partial<PlanRecord> = {}): PlanRecord {
  return { id, name, wikiUrl: url(name), acquisition, _prov: prov(), ...extra } as PlanRecord
}
const craft = (...recipeIds: string[]) => ({ method: 'craft' as const, recipeIds })
const drop = (...dropIds: string[]) => ({ method: 'drop' as const, dropIds })
const other = (text: string) => ({ method: 'other' as const, description: text, sourceUrl: url(text), conditions: [] })

function fixture(records: PlanRecord[], recipes: Recipe[], groups: RecipeGroup[] = [], drops: DropSource[] = []): PlanLookup & { records: Map<number, PlanRecord> } {
  const r = new Map(records.map((x) => [x.id, x]))
  const rc = new Map(recipes.map((x) => [x.id, x]))
  const g = new Map(groups.map((x) => [x.id, x]))
  const d = new Map(drops.map((x) => [x.id, x]))
  return { records: r, record: (id) => (r.has(id) ? r.get(id) : null), recipe: (id) => rc.get(id), group: (id) => g.get(id), drop: (id) => d.get(id) }
}
const node = (graph: ReturnType<typeof buildPlanGraph>, id: number) => graph.nodes.get(itemKey(id)) as PlanItemNode
const total = (graph: ReturnType<typeof buildPlanGraph>, id: number | string, input = {}) => computeDemand(graph, input).get(typeof id === 'number' ? itemKey(id) : id)

describe('plan engine — quantities (fixtures)', () => {
  // Goal 1 = 2×A + 3×B; A = 4×Ore (makes 1); B = 1×Ore + 1×Bullet; Bullet is made 70 at a time from 1 Bar.
  const lookup = fixture(
    [
      rec(1, 'Goal', [craft('r1')]),
      rec(2, 'A', [craft('r2')]),
      rec(3, 'B', [craft('r3')]),
      rec(4, 'Ore', [drop('d4')]),
      rec(5, 'Bullet', [craft('r5')]),
      rec(6, 'Bar', [other('Mined')]),
    ],
    [recipe('r1', 1, [[2, 2], [3, 3]]), recipe('r2', 2, [[4, 4]]), recipe('r3', 3, [[4, 1], [5, 1]]), recipe('r5', 5, [[6, 1]], { makes: 70 })],
  )

  it('multiplies through recipes and aggregates an item used in several places', () => {
    const g = buildPlanGraph(1, 1, {}, lookup)
    expect(g.missing.size).toBe(0)
    // Ore: 2 A × 4 + 3 B × 1 = 11, listed once
    expect(total(g, 4)?.total).toBe(11)
    expect([...g.nodes.keys()].filter((k) => k === 'i:4')).toHaveLength(1)
    // a second goal unit doubles everything
    expect(total(buildPlanGraph(1, 2, {}, lookup), 4)?.total).toBe(22)
  })

  it('applies recipe yields once over the aggregated need (70 bullets per craft: 3 needed → 1 craft → 1 Bar)', () => {
    const g = buildPlanGraph(1, 1, {}, lookup)
    expect(total(g, 5)).toMatchObject({ total: 3, need: 3, crafts: 1, makes: 70 })
    expect(total(g, 6)?.total).toBe(1)
    // 100 goals → 300 bullets → 5 crafts (350 made) → 5 Bars
    expect(total(buildPlanGraph(1, 100, {}, lookup), 6)?.total).toBe(5)
  })

  it('owned quantities reduce the need before it is handed down; a checked step covers everything beneath it', () => {
    const g = buildPlanGraph(1, 1, {}, lookup)
    // own 1 of the 2 A → only 1 A crafted → Ore 1×4 + 3 = 7
    expect(total(g, 4, { owned: { 'i:2': 1 } })?.total).toBe(7)
    expect(total(g, 2, { owned: { 'i:2': 1 } })).toMatchObject({ total: 2, owned: 1, need: 1, crafts: 1 })
    // A checked: its Ore share drops; B still needs its own Ore
    expect(total(g, 4, { done: new Set(['i:2']) })?.total).toBe(3)
    // the goal checked: nothing beneath is needed
    const all = computeDemand(g, { done: new Set(['i:1']) })
    expect([...all.values()].every((d) => d.need === 0)).toBe(true)
    // owning more than needed never goes negative
    expect(total(g, 4, { owned: { 'i:4': 50 } })).toMatchObject({ need: 0, owned: 50 })
  })
})

describe('plan engine — routes, cycles, groups, guards (fixtures)', () => {
  it('several kinds of route = a choice left open; one route is taken; recipe-only items show the first usable recipe', () => {
    const lookup = fixture(
      [rec(1, 'Goal', [craft('r1a', 'r1b')]), rec(2, 'X', [craft('r2'), drop('d2')]), rec(3, 'Y', [other('Found')]), rec(4, 'Z', [other('Found')])],
      [recipe('r1a', 1, [[2, 1]]), recipe('r1b', 1, [[3, 1]]), recipe('r2', 2, [[4, 1]])],
    )
    const g = buildPlanGraph(1, 1, {}, lookup)
    expect(node(g, 1).selection).toMatchObject({ kind: 'route', why: 'first-recipe', route: { key: 'craft:r1a' } })
    expect(node(g, 2).selection).toEqual({ kind: 'open' })
    expect(node(g, 2).edges).toEqual([])
    // the user's choice wins everywhere the item appears
    const chosen = buildPlanGraph(1, 1, { 'i:1': 'craft:r1b' }, lookup)
    expect(node(chosen, 1).selection).toMatchObject({ why: 'chosen', route: { key: 'craft:r1b' } })
    expect(chosen.nodes.has('i:3')).toBe(true)
    expect(chosen.nodes.has('i:2')).toBe(false)
    const openX = buildPlanGraph(1, 1, { 'i:2': 'craft:r2' }, lookup)
    expect(node(openX, 2).selection).toMatchObject({ kind: 'route', why: 'chosen' })
    expect(openX.nodes.has('i:4')).toBe(true)
  })

  it('a choice naming a route that no longer exists is ignored and reported', () => {
    const lookup = fixture([rec(1, 'Goal', [craft('r1')]), rec(2, 'X', [other('Found')])], [recipe('r1', 1, [[2, 1]])])
    const g = buildPlanGraph(1, 1, { 'i:1': 'craft:gone' }, lookup)
    expect(g.staleChoices).toEqual(['i:1'])
    expect(node(g, 1).selection).toMatchObject({ why: 'only' })
  })

  it('cycles never loop: an ingredient already on the path is flagged circular and never counted', () => {
    // Wood (1) ← 2 Platforms (2) ← 1 Wood … chosen explicitly; plus a 3-cycle 3 → 4 → 5 → 3
    const lookup = fixture(
      [rec(1, 'Wood', [craft('r1'), other('Trees')]), rec(2, 'Platform', [craft('r2')]), rec(3, 'P', [craft('r3')]), rec(4, 'Q', [craft('r4')]), rec(5, 'R', [craft('r5'), other('Found')])],
      [recipe('r1', 1, [[2, 2]]), recipe('r2', 2, [[1, 1]], { makes: 2 }), recipe('r3', 3, [[4, 1]]), recipe('r4', 4, [[5, 1]]), recipe('r5', 5, [[3, 1]])],
    )
    const wood = buildPlanGraph(1, 10, { 'i:1': 'craft:r1' }, lookup)
    // Platform's only recipe needs Wood (on the path) — circular, so it isn't picked for the user; the reason
    // names the ingredient it NEEDS (Wood), not Platform itself (B118(d))
    expect(node(wood, 2).selection).toEqual({ kind: 'open' })
    expect(node(wood, 2).circularRoutes).toEqual(['craft:r2'])
    expect(node(wood, 2).heldRoutes).toEqual({ 'craft:r2': { kind: 'circular', via: 'i:1' } })
    // chosen anyway: the edge back to Wood is flagged and hands nothing down
    const forced = buildPlanGraph(1, 10, { 'i:1': 'craft:r1', 'i:2': 'craft:r2' }, lookup)
    expect(node(forced, 2).edges).toEqual([{ to: 'i:1', amount: 1, circular: true }])
    expect(total(forced, 1)?.total).toBe(10)
    const cyc = buildPlanGraph(3, 1, { 'i:5': 'craft:r5' }, lookup)
    expect(node(cyc, 5).edges[0]).toMatchObject({ to: 'i:3', circular: true })
    expect(cyc.nodes.size).toBe(3)
  })

  it('a reversal recipe (Obsidian ← Obsidian Wall ← Obsidian) and a Shimmer transmutation are never picked for the user', () => {
    const lookup = fixture(
      [rec(1, 'Shield', [craft('r1')]), rec(2, 'Obsidian', [craft('r2')]), rec(3, 'Obsidian Wall', [craft('r3')]), rec(4, 'Ore', [craft('r4')]), rec(5, 'Luminite', [other('Moon Lord')])],
      [recipe('r1', 1, [[2, 20], [4, 1]]), recipe('r2', 2, [[3, 4]]), recipe('r3', 3, [[2, 1]], { makes: 4 }), recipe('r4', 4, [[5, 1]], { shimmer: true })],
    )
    const g = buildPlanGraph(1, 1, {}, lookup)
    expect(node(g, 2).selection).toEqual({ kind: 'open' })
    expect(node(g, 2).heldRoutes).toEqual({ 'craft:r2': { kind: 'reversal', via: 3 } })
    expect(g.nodes.has('i:3')).toBe(false)
    expect(node(g, 4).selection).toEqual({ kind: 'open' })
    expect(node(g, 4).heldRoutes).toEqual({ 'craft:r4': { kind: 'shimmer' } })
    expect(g.nodes.has('i:5')).toBe(false)
    // both stay one tap away
    expect(node(buildPlanGraph(1, 1, { 'i:4': 'craft:r4' }, lookup), 4).edges).toEqual([{ to: 'i:5', amount: 1, circular: false }])
  })

  it('"Any X" groups stay open until a member is chosen; the chosen member carries the group’s whole need', () => {
    const groups = [{ id: 'any-iron-bar', name: 'Any Iron Bar', memberItemIds: [22, 704], _prov: prov() }] as RecipeGroup[]
    const lookup = fixture(
      [rec(1, 'Bucket', [craft('r1')]), rec(22, 'Iron Bar', [craft('r22')]), rec(704, 'Lead Bar', [other('Found')]), rec(11, 'Iron Ore', [other('Mined')])],
      [recipe('r1', 1, [['any-iron-bar', 2], [22, 1]]), recipe('r22', 22, [[11, 3]])],
      groups,
    )
    const open = buildPlanGraph(1, 3, {}, lookup)
    expect(open.nodes.get('grp:any-iron-bar')).toMatchObject({ kind: 'group', edges: [] })
    expect(total(open, 'grp:any-iron-bar')?.total).toBe(6)
    expect(total(open, 22)?.total).toBe(3)
    const iron = buildPlanGraph(1, 3, { 'grp:any-iron-bar': 'i:22' }, lookup)
    // 6 via the group + 3 direct = 9 Iron Bars → 27 ore
    expect(total(iron, 22)?.total).toBe(9)
    expect(total(iron, 11)?.total).toBe(27)
    const stale = buildPlanGraph(1, 3, { 'grp:any-iron-bar': 'i:9999' }, lookup)
    expect(stale.staleChoices).toEqual(['grp:any-iron-bar'])
  })

  it('depth and size guards cut a pathological plan honestly (flagged, never silently complete)', () => {
    // a 40-deep chain, and a goal with 400 distinct craftable ingredients
    const chain = Array.from({ length: 40 }, (_, i) => rec(i + 1, `C${i + 1}`, [craft(`c${i + 1}`)]))
    const chainRecipes = Array.from({ length: 40 }, (_, i) => recipe(`c${i + 1}`, i + 1, [[i + 2, 1]]))
    const deep = buildPlanGraph(1, 1, {}, fixture([...chain, rec(41, 'End', [other('Found')])], chainRecipes))
    expect(deep.truncated).toBe(true)
    const cut = [...deep.nodes.values()].filter((n) => n.truncated)
    expect(cut).toHaveLength(1)
    expect(cut[0]).toMatchObject({ depth: PLAN_LIMITS.maxDepth, truncated: 'depth', edges: [] })
    expect(deep.nodes.size).toBe(PLAN_LIMITS.maxDepth + 1)

    const wideRecs = Array.from({ length: 400 }, (_, i) => rec(1000 + i, `W${i}`, [craft(`w${i}`)]))
    const wideRecipes = Array.from({ length: 400 }, (_, i) => recipe(`w${i}`, 1000 + i, [[5000 + i, 1]]))
    const leaves = Array.from({ length: 400 }, (_, i) => rec(5000 + i, `L${i}`, [other('Found')]))
    const goal = rec(1, 'Wide', [craft('wide')])
    const wide = buildPlanGraph(1, 1, {}, fixture([goal, ...wideRecs, ...leaves], [recipe('wide', 1, wideRecs.map((r) => [r.id, 1] as Ing)), ...wideRecipes]))
    expect(wide.truncated).toBe(true)
    expect([...wide.nodes.values()].filter((n) => n.truncated === 'size').length).toBeGreaterThan(0)
    expect([...wide.nodes.values()].filter((n) => n.edges.length > 0)).toHaveLength(PLAN_LIMITS.maxExpanded)
  })

  it('records not loaded yet are reported as missing — ingredients and every recipe route’s station items; supplied, the plan completes', () => {
    const records = new Map<number, PlanRecord | null | undefined>([[1, rec(1, 'Goal', [craft('r1')])]])
    const lookup: PlanLookup = { record: (id) => records.get(id), recipe: (id) => (id === 'r1' ? recipe('r1', 1, [[2, 1]]) : undefined), group: () => undefined, drop: () => undefined }
    const first = buildPlanGraph(1, 1, {}, lookup)
    // 900 = the fixture recipe's station (the chooser states each way's gating, stations included — B118(f))
    expect([...first.missing].sort((a, b) => a - b)).toEqual([2, 900])
    expect(node(first, 2).pending).toBe(true)
    records.set(2, rec(2, 'X', [other('Found')]))
    records.set(900, rec(900, 'Bench', [other('Crafted')]))
    expect(buildPlanGraph(1, 1, {}, lookup).missing.size).toBe(0)
    // an id the dataset doesn't have is a leaf, never a guess
    records.set(2, null)
    expect(node(buildPlanGraph(1, 1, {}, lookup), 2).selection).toEqual({ kind: 'none', reason: 'not-in-dataset' })
  })

  it('a held way’s inputs are requested too: a Shimmer recipe’s ingredient (never reached by the held-route checks)', () => {
    const records = new Map<number, PlanRecord | null | undefined>([
      [1, rec(1, 'Charm', [craft('r1')])],
      [900, null],
    ])
    const lookup: PlanLookup = { record: (id) => records.get(id), recipe: (id) => (id === 'r1' ? recipe('r1', 1, [[7, 1]], { shimmer: true }) : undefined), group: () => undefined, drop: () => undefined }
    const g = buildPlanGraph(1, 1, {}, lookup)
    expect(node(g, 1).heldRoutes).toEqual({ 'craft:r1': { kind: 'shimmer' } })
    expect([...g.missing]).toEqual([7])
  })

  it('an "Any X" group’s members are requested (the chooser states each member’s availability)', () => {
    const groups = [{ id: 'any-bar', name: 'Any Bar', memberItemIds: [22, 704], _prov: prov() }] as RecipeGroup[]
    const records = new Map<number, PlanRecord | null | undefined>([
      [1, rec(1, 'Bucket', [craft('r1')])],
      [900, null],
    ])
    const lookup: PlanLookup = { record: (id) => records.get(id), recipe: (id) => (id === 'r1' ? recipe('r1', 1, [['any-bar', 2]]) : undefined), group: (id) => groups.find((g) => g.id === id), drop: () => undefined }
    expect([...buildPlanGraph(1, 1, {}, lookup).missing].sort((a, b) => a - b)).toEqual([22, 704])
  })

  it('an item whose acquisition is Unknown is a "no known source" leaf', () => {
    const lookup = fixture([rec(1, 'Mystery', [], { _prov: prov(['acquisition']) } as Partial<PlanRecord>)], [])
    expect(node(buildPlanGraph(1, 1, {}, lookup), 1).selection).toEqual({ kind: 'none', reason: 'no-source' })
  })
})

describe('plan steps (DATA_SCHEMA_SPEC §8a PlanStepV1)', () => {
  it('ids are deterministic from (kind, refs, amount) and change when the amount does', () => {
    expect(stepIdOf('craft', ['i:1', 'rcp:x'], 2)).toBe(stepIdOf('craft', ['i:1', 'rcp:x'], 2))
    expect(stepIdOf('craft', ['i:1', 'rcp:x'], 2)).not.toBe(stepIdOf('craft', ['i:1', 'rcp:x'], 3))
    expect(stepIdOf('craft', ['i:1'], 2)).toMatch(/^craft-[0-9a-f]{8}$/)
  })
})

// --- the real dataset --------------------------------------------------------------------------------

const lookup = realLookup()
const dropLookup = { drop: (id: string) => DROPS.get(id) }
const NONE: TrackedProgress = { worldEvil: null, nodeStates: {} }

describe("plan engine — real data: Night's Edge end to end", () => {
  const ne = idOf("Night's Edge")
  const g = buildPlanGraph(ne, 1, {}, lookup)
  const d = computeDemand(g)
  const q = (name: string) => d.get(itemKey(idOf(name)))?.total

  it('the full tree: its four swords, their materials and quantities through every recipe', () => {
    expect(g.missing.size).toBe(0)
    expect(g.truncated).toBe(false)
    const root = node(g, ne)
    // two recipes (Light's Bane or Blood Butcherer): recipe 1 shown, the other one tap away
    expect(root.routes.filter((r) => r.method === 'craft')).toHaveLength(2)
    expect(root.selection).toMatchObject({ kind: 'route', why: 'first-recipe' })
    expect(root.edges.map((e) => names.name(e.to)).sort()).toEqual(['Blade of Grass', "Light's Bane", 'Muramasa', 'Volcano'])
    expect(q('Demonite Bar')).toBe(10)
    expect(q('Demonite Ore')).toBe(30)
    expect(q('Hellstone Bar')).toBe(20)
    expect(q('Stinger')).toBe(12)
    expect(q('Jungle Spores')).toBe(15)
    // the other recipe, chosen: Blood Butcherer and Crimtane instead
    const crimson = buildPlanGraph(ne, 1, { [itemKey(ne)]: root.routes[1].key }, lookup)
    expect([...crimson.nodes.keys()].map((k) => names.name(k))).toContain('Blood Butcherer')
    expect([...crimson.nodes.keys()].map((k) => names.name(k))).not.toContain("Light's Bane")
  })

  it('steps: every node once, crafting after its materials, open choices and sources grouped', () => {
    const steps = generateSteps(g, GRAPH, names, dropLookup)
    expect(steps.map((s) => s.text)).toContain("Craft 1 Night's Edge")
    expect(steps.map((s) => s.text)).toContain('Craft 10 Demonite Bar')
    const order = steps.map((s) => s.text)
    expect(order.indexOf('Craft 10 Demonite Bar')).toBeLessThan(order.indexOf("Craft 1 Light's Bane"))
    expect(order.indexOf("Craft 1 Light's Bane")).toBeLessThan(order.indexOf("Craft 1 Night's Edge"))
    expect(steps.find((s) => s.text === 'Get 20 Hellstone Bar')).toMatchObject({ kind: 'gather', groupKey: 'choose' })
    expect(new Set(steps.map((s) => s.stepId)).size).toBe(steps.length)
    // deterministic: the same plan twice → the same ids
    expect(generateSteps(buildPlanGraph(ne, 1, {}, lookup), GRAPH, names, dropLookup).map((s) => s.stepId)).toEqual(steps.map((s) => s.stepId))
  })
})

describe('plan engine — real data: Zenith and the whole corpus', () => {
  it('Zenith builds a complete tree: ten swords, every record resolved, no guard hit, Moon Lord among the gates', () => {
    const z = idOf('Zenith')
    const g = buildPlanGraph(z, 1, {}, lookup)
    expect(g.missing.size).toBe(0)
    expect(g.truncated).toBe(false)
    expect(node(g, z).edges).toHaveLength(10)
    // every non-circular edge leads to a node of the graph
    for (const n of g.nodes.values()) for (const e of n.edges) if (!e.circular) expect(g.nodes.has(e.to)).toBe(true)
    expect(g.nodes.size).toBeGreaterThan(25)
    const steps = generateSteps(g, GRAPH, names, dropLookup)
    expect(steps.filter((s) => s.kind === 'defeat-boss').map((s) => s.nodeId)).toContain('moon-lord')
    // Chlorophyte Ore's only listed way is a Shimmer transmutation of Luminite: left as a choice, never assumed
    expect(node(g, idOf('Chlorophyte Ore')).selection).toEqual({ kind: 'open' })
  })

  it('every item in the dataset builds a plan: no record missing (closure), no guard hit, no cycle followed', () => {
    let largest = 0
    for (const id of RECORDS.keys()) {
      const g = buildPlanGraph(id, 1, {}, lookup)
      expect(g.missing.size, String(id)).toBe(0)
      expect(g.truncated, String(id)).toBe(false)
      largest = Math.max(largest, g.nodes.size)
    }
    expect(largest).toBeLessThan(PLAN_LIMITS.maxExpanded)
  })

  it('a goal with no known source is one honest Unknown step, never a guessed route', () => {
    const noSource = [...RECORDS.values()].find((r) => r._prov.unverifiedFields.includes('acquisition'))
    if (!noSource) throw new Error('fixture: no item without a known source')
    const g = buildPlanGraph(noSource.id, 1, {}, lookup)
    expect(node(g, noSource.id).selection).toEqual({ kind: 'none', reason: 'no-source' })
    expect(planSteps(g, names, dropLookup)).toMatchObject([{ kind: 'other', groupKey: 'unknown', text: `Get 1 ${noSource.name}` }])
  })
})

describe('obtainable now (PRD §9 Feature B AC2: stated stage + tracked defeats)', () => {
  const lum = idOf('Luminite')
  const g = buildPlanGraph(lum, 1, {}, lookup)
  const steps = generateSteps(g, GRAPH, names, dropLookup)
  const view = (progress: TrackedProgress, stage: Parameters<typeof progressBasis>[2]) => planView(g, steps, { owned: {}, checkedStepIds: [] }, GRAPH, progressBasis(GRAPH, progress, stage))

  it('a boss-gated item is gated with the exact boss — never obtainable — and its boss is an explicit step', () => {
    const v = view(NONE, null)
    expect(v.availability.get(itemKey(lum))).toMatchObject({ status: 'gated', missing: ['moon-lord'] })
    expect(steps.find((s) => s.kind === 'defeat-boss')).toMatchObject({ nodeId: 'moon-lord', text: 'Defeat Moon Lord', groupKey: 'bosses' })
    expect(v.steps.find((s) => s.step.kind === 'defeat-boss')?.status).toBe('open')
  })

  it('a tracked defeat makes it obtainable and completes the boss step', () => {
    const v = view({ worldEvil: null, nodeStates: { 'moon-lord': 'defeated' } }, null)
    expect(v.availability.get(itemKey(lum))?.status).toBe('yes')
    expect(v.steps.find((s) => s.step.kind === 'defeat-boss')).toMatchObject({ status: 'progress', bossBasis: 'tracked' })
  })

  it('the stated stage counts its implied bosses (virtual defeats); without a stage, tracked only', () => {
    const hm = [...RECORDS.values()].find((r) => r.gatedBy?.bosses.length === 1 && r.gatedBy.bosses[0] === 'hardmode' && r._prov.unverifiedFields.length === 0)
    if (!hm) throw new Error('fixture: no Hardmode-gated item')
    const hg = buildPlanGraph(hm.id, 1, {}, lookup)
    const hs = generateSteps(hg, GRAPH, names, dropLookup)
    const at = (stage: Parameters<typeof progressBasis>[2]) => planView(hg, hs, { owned: {}, checkedStepIds: [] }, GRAPH, progressBasis(GRAPH, NONE, stage))
    expect(at(null).availability.get(itemKey(hm.id))).toMatchObject({ status: 'gated', missing: ['wall-of-flesh'] })
    expect(at('early-hm').availability.get(itemKey(hm.id))?.status).toBe('yes')
    expect(at('early-hm').steps.find((s) => s.step.kind === 'defeat-boss')).toMatchObject({ status: 'progress', bossBasis: 'stage' })
    expect(progressBasis(GRAPH, NONE, 'early-hm').virtual).toEqual(expect.arrayContaining(['wall-of-flesh']))
  })

  it('Unknown gating stays Unknown — never obtainable, never blocked', () => {
    const z = buildPlanGraph(idOf('Zenith'), 1, {}, lookup)
    const v = planView(z, generateSteps(z, GRAPH, names, dropLookup), { owned: {}, checkedStepIds: [] }, GRAPH, progressBasis(GRAPH, { worldEvil: null, nodeStates: Object.fromEntries(GRAPH.nodes.filter((n) => n.kind === 'boss').map((n) => [n.id, 'defeated' as const])) }, 'endgame'))
    expect(v.availability.get(itemKey(idOf('Zenith')))?.status).toBe('unknown')
    expect(v.counts.unknown).toBeGreaterThan(0)
  })
})

describe('plan view: check-offs, owned, done', () => {
  const ne = idOf("Night's Edge")
  const g = buildPlanGraph(ne, 1, {}, lookup)
  const steps = generateSteps(g, GRAPH, names, dropLookup)
  const basis = progressBasis(GRAPH, NONE, null)
  const goalStep = steps.find((s) => s.refs[0] === itemKey(ne))
  const oreStep = steps.find((s) => s.refs[0] === itemKey(idOf('Demonite Ore')))
  if (!goalStep || !oreStep) throw new Error('fixture steps missing')

  it('progress counts complete steps; owning materials completes their step and lowers what is handed down', () => {
    const fresh = planView(g, steps, { owned: {}, checkedStepIds: [] }, GRAPH, basis)
    expect(fresh).toMatchObject({ complete: 0, total: steps.length, done: false })
    const owned = planView(g, steps, { owned: { [itemKey(idOf('Demonite Bar'))]: 10 }, checkedStepIds: [] }, GRAPH, basis)
    expect(owned.steps.find((s) => s.step.stepId === oreStep.stepId)).toMatchObject({ status: 'covered', remaining: 0 })
    expect(owned.complete).toBe(2)
  })

  it('checking the goal completes the plan; un-checking reopens it (P6-S6 AC4)', () => {
    const done = planView(g, steps, { owned: {}, checkedStepIds: [goalStep.stepId] }, GRAPH, basis)
    expect(done.done).toBe(true)
    expect(done.complete).toBe(done.total)
    expect(planView(g, steps, { owned: {}, checkedStepIds: [] }, GRAPH, basis).done).toBe(false)
  })

  it('snapshot drift: a changed step set or game version is reported, an unchanged plan is not', () => {
    const snap = { generatedAt: '2026-10-15T00:00:00.000Z', gameVersion: '1.4.5.8', steps }
    expect(snapshotDrift(snap, steps, '1.4.5.8')).toBeUndefined()
    expect(snapshotDrift(snap, steps.slice(1), '1.4.5.8')).toEqual({ added: 0, removed: 1, versionChanged: false })
    expect(snapshotDrift(snap, steps, '1.4.5.9')).toMatchObject({ versionChanged: true })
  })

  it('boss gates resolve milestones to their bosses (Hardmode → the Wall of Flesh)', () => {
    const hm = [...RECORDS.values()].find((r) => r.gatedBy?.bosses[0] === 'hardmode' && r._prov.unverifiedFields.length === 0)
    if (!hm) throw new Error('fixture: no Hardmode-gated item')
    expect(bossGates(buildPlanGraph(hm.id, 1, {}, lookup), GRAPH).map((b) => b.id)).toEqual(['wall-of-flesh'])
  })
})

// --- AMENDMENTS-016 B118 ------------------------------------------------------------------------------

describe('B118(d): a circular way names the item it NEEDS', () => {
  it('Glass via its Glass Wall recipe: Glass Wall’s only recipe needs Glass — said as Glass, never “needs Glass Wall”', () => {
    const glass = idOf('Glass')
    const wall = idOf('Glass Wall')
    const first = node(buildPlanGraph(glass, 1, {}, lookup), glass).routes[0]
    const g = buildPlanGraph(glass, 1, { [itemKey(glass)]: first.key }, lookup)
    const held = Object.values(node(g, wall).heldRoutes)
    expect(held).toEqual([{ kind: 'circular', via: itemKey(glass) }])
    const said = heldText(held[0], 'Glass Wall', { info: (k) => ({ name: names.name(k) }) })
    expect(said).toBe(copy.circular('Glass', 'Glass Wall'))
    expect(said).toContain('Glass Wall needs Glass,')
    expect(said).not.toMatch(/needs Glass Wall/)
  })
})

describe('B118(j): the progress basis names bosses only', () => {
  it('milestones and events marked on the map (Hardmode) or implied by the stage (All Mechanical Bosses) are never listed as bosses', () => {
    const marked = { worldEvil: null, nodeStates: { hardmode: 'defeated', 'goblin-army': 'defeated', 'eye-of-cthulhu': 'defeated' } } as unknown as TrackedProgress
    const basis = progressBasis(GRAPH, marked, 'endgame')
    expect(basis.tracked).toEqual(['eye-of-cthulhu'])
    expect(basis.virtual).toContain('wall-of-flesh')
    expect(basis.virtual).not.toContain('all-mechanical-bosses')
    expect([...basis.tracked, ...basis.virtual].every((id) => GRAPH.nodeById.get(id)?.kind === 'boss')).toBe(true)
    // EP itself is unchanged: the milestones still count for availability
    expect(basis.ep.has('hardmode') && basis.ep.has('all-mechanical-bosses')).toBe(true)
  })
})

describe('B118(e): a boss step carries the items it was derived from', () => {
  it('Luminite: "Defeat Moon Lord" is needed for Luminite', () => {
    const lum = idOf('Luminite')
    const g = buildPlanGraph(lum, 1, {}, lookup)
    const v = planView(g, generateSteps(g, GRAPH, names, dropLookup), { owned: {}, checkedStepIds: [] }, GRAPH, progressBasis(GRAPH, NONE, null))
    expect(v.steps.find((s) => s.step.kind === 'defeat-boss')?.neededFor).toEqual([itemKey(lum)])
  })
})

describe('B118(h): covered subtrees collapse', () => {
  // Goal 1 = A + B; A = 2 Ore; B = 1 Ore + 1 Gem (Ore is drawn under A, referenced under B)
  const fx = fixture(
    [rec(1, 'Goal', [craft('r1')]), rec(2, 'A', [craft('r2')]), rec(3, 'B', [craft('r3')]), rec(4, 'Ore', [other('Mined')]), rec(5, 'Gem', [other('Mined')])],
    [recipe('r1', 1, [[2, 1], [3, 1]]), recipe('r2', 2, [[4, 2]]), recipe('r3', 3, [[4, 1], [5, 1]])],
  )
  const g = buildPlanGraph(1, 1, {}, fx)
  const steps = planSteps(g, names, { drop: () => undefined })
  const stepFor = (id: number) => steps.find((s) => s.refs[0] === itemKey(id))?.stepId ?? ''
  const covered = (state: { owned?: Record<string, number>; checked?: number[] }) => {
    const v = planView(g, steps, { owned: state.owned ?? {}, checkedStepIds: (state.checked ?? []).map(stepFor) }, GRAPH, progressBasis(GRAPH, NONE, null))
    return coveredSubtrees(g, v, (k) => v.steps.find((s) => s.step.refs[0] === k))
  }

  it('the goal checked: its whole subtree collapses under one note counting the items beneath', () => {
    // the goal's note counts all 4; A and B (hidden inside it) would collapse with their own note if opened
    expect(covered({ checked: [1] })).toEqual(new Map([[itemKey(1), 4], [itemKey(2), 1], [itemKey(3), 1]]))
  })

  it('never hides an item still needed elsewhere: A checked, but its Ore is still needed by B', () => {
    expect(covered({ checked: [2] }).has(itemKey(2))).toBe(false)
  })

  it('owned counts too (B owned: its Gem is no longer needed); nothing complete → nothing collapses', () => {
    expect(covered({ owned: { [itemKey(3)]: 1 } })).toEqual(new Map([[itemKey(3), 1]]))
    expect(covered({}).size).toBe(0)
  })
})

describe('B118(f): each way’s gating, for the chooser (planRouteGates)', () => {
  const gate = (bosses: string[]) => ({ bosses, conditions: [], stage: 'early-prehm' as const })
  const bossDrop = (id: string, bossId: string, name: string) =>
    ({ id, itemId: 10, source: { npcName: name, bossId }, quantity: { min: 1, max: 1 }, rates: { classic: 1 }, conditions: [], _prov: prov() }) as DropSource
  const fx = fixture(
    [
      rec(10, 'Thing', [craft('rc', 'rc2', 'rc3'), drop('d-twins', 'd-destroyer'), { method: 'purchase', npcName: 'Merchant', conditions: ['hardmode'] }]),
      rec(11, 'Part', [other('Found')], { gatedBy: gate(['skeletron']) }),
      rec(12, 'Odd Part', [other('Found')], { _prov: prov(['gatedBy']) } as Partial<PlanRecord>),
      rec(13, 'Free Part', [other('Found')], { gatedBy: gate([]) }),
      rec(14, 'Eye Part', [other('Found')], { gatedBy: gate(['eye-of-cthulhu']) }),
      rec(20, 'Single', [craft('rs')]),
      rec(900, 'Bench', [other('Crafted')], { gatedBy: gate([]) }),
    ],
    [recipe('rc', 10, [[11, 2]]), recipe('rc2', 10, [[12, 1]]), recipe('rc3', 10, [['any-part', 1], ['any-eye', 1]]), recipe('rs', 20, [[11, 1]])],
    [
      { id: 'any-part', name: 'Any Part', memberItemIds: [11, 13], _prov: prov() },
      { id: 'any-eye', name: 'Any Eye', memberItemIds: [11, 14], _prov: prov() },
    ] as RecipeGroup[],
    [bossDrop('d-twins', 'the-twins', 'The Twins'), bossDrop('d-destroyer', 'the-destroyer', 'The Destroyer')],
  )
  const thing = fx.records.get(10) as PlanRecord
  const routes = buildPlanGraph(10, 1, {}, fx).nodes.get('i:10') as PlanItemNode
  const at = (nodeStates: Record<string, 'defeated'> = {}): RouteGateCtx => {
    const basis = progressBasis(GRAPH, { worldEvil: null, nodeStates }, null)
    return { lookup: fx, graph: GRAPH, conditions: { byId: CONDITIONS }, ep: basis.ep, memo: basis.memo }
  }
  const of = (key: string, ctx = at()) => routeGate(ctx, thing, routes.routes.find((r) => r.key === key) ?? routes.routes[0], routes.routes.length)

  it('a recipe needs every input: the union of its ingredients’ and station’s verified gates', () => {
    expect(of('craft:rc')).toEqual({ kind: 'all', availability: { status: 'gated', missing: ['skeletron'], conditions: [] } })
    expect(of('craft:rc', at({ skeletron: 'defeated' }))).toMatchObject({ kind: 'all', availability: { status: 'yes' } })
    // one input with Unknown gating → Unknown (never "obtainable now")
    expect(of('craft:rc2')).toMatchObject({ kind: 'all', availability: { status: 'unknown' } })
  })

  it('an "Any X" input counts as its least-gated member; two members needing different bosses can’t be one gate → Unknown', () => {
    // any-part has a gate-free member (open); any-eye's members need Skeletron or the Eye — either-or → Unknown
    expect(of('craft:rc3')).toMatchObject({ kind: 'all', availability: { status: 'unknown' } })
  })

  it('a drop from bosses needing different bosses is "one of" them; one source open opens the way', () => {
    expect(of('drop:d-twins')).toEqual({ kind: 'any', options: [['the-twins'], ['the-destroyer']] })
    expect(of('drop:d-twins', at({ 'the-twins': 'defeated' }))).toMatchObject({ kind: 'all', availability: { status: 'yes' } })
  })

  it('a vendor among several ways: its own node-mapped conditions named, the vendor itself Unknown', () => {
    const v = of('purchase:Merchant')
    expect(v).toMatchObject({ kind: 'all', availability: { status: 'unknown' } })
    expect(v.kind === 'all' ? v.availability.missing : []).toContain('wall-of-flesh')
  })

  it('an item with one way: that way IS the item’s verified gating (the tree and the chooser agree)', () => {
    const single = fx.records.get(20) as PlanRecord
    const route = (buildPlanGraph(20, 1, {}, fx).nodes.get('i:20') as PlanItemNode).routes[0]
    expect(routeGate(at(), single, route, 1)).toEqual({ kind: 'all', availability: availabilityOf(single, GRAPH, at().ep) })
  })

  it('B120: an item open by its own gating with every way Unknown is flagged for the chooser’s footnote — only then', () => {
    const open = { status: 'yes' as const, missing: [], conditions: [] }
    const unknownWay = { kind: 'all' as const, availability: { status: 'unknown' as const, missing: [], conditions: [] } }
    const openWay = { kind: 'all' as const, availability: open }
    expect(openButWaysUnknown(open, [unknownWay, unknownWay])).toBe(true)
    expect(openButWaysUnknown(open, [unknownWay, openWay])).toBe(false) // one way confirmed open: no tension
    expect(openButWaysUnknown(open, [unknownWay, { kind: 'any', options: [['the-twins'], ['the-destroyer']] }])).toBe(false)
    expect(openButWaysUnknown({ ...open, status: 'unknown' }, [unknownWay, unknownWay])).toBe(false) // the tree says Unknown too
    expect(openButWaysUnknown(open, [unknownWay])).toBe(false) // one way IS the item's gating (they agree by construction)
  })

  it('B120 on the real data: Stinger is “Obtainable now” in the tree while its drop and its described way are each Unknown', () => {
    const lookup = realLookup()
    const stinger = RECORDS.get(idOf('Stinger'))!
    const node = buildPlanGraph(stinger.id, 1, {}, lookup).nodes.get(itemKey(stinger.id)) as PlanItemNode
    const basis = progressBasis(GRAPH, { worldEvil: null, nodeStates: {} }, null)
    const ctx: RouteGateCtx = { lookup, graph: GRAPH, conditions: { byId: CONDITIONS }, ep: basis.ep, memo: basis.memo }
    const gates = node.routes.map((r) => routeGate(ctx, stinger, r, node.routes.length))
    expect(node.routes.length).toBeGreaterThan(1)
    expect(openButWaysUnknown(availabilityOf(stinger, GRAPH, basis.ep, basis.memo), gates)).toBe(true)
  })
})

describe('B118(b): the completion announcement', () => {
  it('said when the plan completes or reopens — never on arrival, never when nothing changed', () => {
    expect(completionAnnouncement(null, { done: true, complete: 3, total: 3 })).toBeUndefined()
    expect(completionAnnouncement(false, { done: true, complete: 3, total: 3 })).toBe(copy.DONE_ANNOUNCE)
    expect(completionAnnouncement(true, { done: false, complete: 2, total: 3 })).toBe(copy.reopenedAnnounce(2, 3))
    expect(completionAnnouncement(true, { done: true, complete: 3, total: 3 })).toBeUndefined()
    expect(completionAnnouncement(false, { done: false, complete: 1, total: 3 })).toBeUndefined()
  })
})
