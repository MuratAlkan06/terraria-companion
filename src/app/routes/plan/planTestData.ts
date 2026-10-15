/**
 * Test-only: the planner's lookups over the real dataset (src/data) — every item record (weapons, armor,
 * accessories, the core item file and every ID-range shard), recipes, groups, drops, the progression graph,
 * the conditions and the search docs. Imported by the plan tests alone (eager globs keep the large JSON out of
 * the type checker).
 */
import type { Condition, DropSource, ProgressionData, ProgressionEdge, ProgressionNode, Recipe, RecipeGroup } from '../../../data-access/types'
import type { SearchDoc } from '../../../schemas'
import type { PlanLookup, PlanRecord } from './planTree'

const files = import.meta.glob<unknown>(
  [
    '../../../data/weapons.detail.json',
    '../../../data/armor.detail.json',
    '../../../data/accessories.detail.json',
    '../../../data/items.detail*.json',
    '!../../../data/items.detail.index.json',
    '../../../data/recipes.json',
    '../../../data/recipe-groups.json',
    '../../../data/drops.json',
    '../../../data/progression.json',
    '../../../data/conditions.json',
    '../../../data/search-docs.json',
  ],
  { eager: true, import: 'default' },
)
const file = <T>(name: string): T => {
  const data = files[`../../../data/${name}`]
  if (data === undefined) throw new Error(`test data missing: ${name}`)
  return data as T
}

export const RECORDS = new Map<number, PlanRecord>()
for (const [path, data] of Object.entries(files)) {
  if (!/(weapons|armor|accessories)\.detail\.json$|items\.detail(\.\d+)?\.json$/.test(path)) continue
  for (const r of data as PlanRecord[]) RECORDS.set(r.id, r)
}
export const RECIPES = new Map(file<Recipe[]>('recipes.json').map((r) => [r.id, r]))
export const GROUPS = new Map(file<RecipeGroup[]>('recipe-groups.json').map((g) => [g.id, g]))
export const DROPS = new Map(file<DropSource[]>('drops.json').map((d) => [d.id, d]))
export const CONDITIONS = new Map(file<Condition[]>('conditions.json').map((c) => [c.id, c]))
export const DOCS = new Map(file<SearchDoc[]>('search-docs.json').map((d) => [d.id, d]))
const progression = file<{ nodes: ProgressionNode[]; edges: ProgressionEdge[] }>('progression.json')
export const GRAPH: ProgressionData = { ...progression, nodeById: new Map(progression.nodes.map((n) => [n.id, n])) }

/** The real-data lookup; `records` overrides let a test hide or swap records. */
export function realLookup(records: ReadonlyMap<number, PlanRecord | null> = RECORDS): PlanLookup {
  return {
    record: (id) => (records.has(id) ? records.get(id) : null),
    recipe: (id) => RECIPES.get(id),
    group: (id) => GROUPS.get(id),
    drop: (id) => DROPS.get(id),
  }
}

export const idOf = (name: string): number => {
  for (const r of RECORDS.values()) if (r.name === name) return r.id
  throw new Error(`test item missing: ${name}`)
}

export const names = {
  name: (key: string) => {
    const item = /^i:(\d+)$/.exec(key)
    if (item) return RECORDS.get(Number(item[1]))?.name ?? key
    const group = /^grp:(.+)$/.exec(key)
    return group ? (GROUPS.get(group[1])?.name ?? key) : key
  },
}
