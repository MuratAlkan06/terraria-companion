/**
 * Accessory page model (PRD P6-S2; DATA_SCHEMA_SPEC §2.5 Accessory). Pure: the browse filters (category / stage /
 * name), which classes an accessory's effects count for (the builder's own rules), and its combination tree. Every
 * verified-or-Unknown field is read through `getField`:
 *
 * - categories are hand-curated (editorial) — the page labels them "curated"; an unverified list is "Category
 *   unknown", never a guessed category;
 * - "counts for" (AC1's loadout notes) applies SCORING_SPEC §2.3's scope rule to each stat effect (its own scope,
 *   else the scope its kind implies — mana → magic, minion slots → summon …) and B108(a)'s curated keyword registry
 *   to each wiki-text effect; text matching no class (or several) counts for every class — the builder's reading;
 * - the combination tree (AC2) follows the RECIPES, not the derived `combinedFrom` union: an accessory with several
 *   Tinkerer's Workshop recipes shows them as alternatives ("or"), never as one list that seems to need them all.
 *   Accessory ingredients expand in turn; any other ingredient is a leaf; a cycle stops at the repeat.
 */
import type { ItemNames } from '../../../../data-access/types'
import type { Accessory, DamageClass, Recipe, RecipeGroup, StatEffect } from '../../../../schemas'
import { getField } from '../../../../schemas/getField'
import { effectScope, specialScope } from '../../../../scoring/proxies'
import { STAGES } from '../../../stages'
import { matchesName } from '../items/itemFilters'
import { CLASS_ORDER, isSpecial, isStat, type SpecialEffectOf, type StatEffectOf } from '../armor/equipmentDisplay'

export const ACCESSORY_CATEGORIES = [
  { id: 'mobility', label: 'Mobility', blurb: 'Movement, flight, jumps' },
  { id: 'defense', label: 'Defense', blurb: 'Defense, immunities, survival' },
  { id: 'offense', label: 'Offense', blurb: 'Damage, crit, attack speed' },
  { id: 'utility', label: 'Utility', blurb: 'Information, building, fishing and more' },
] as const satisfies readonly { id: Accessory['categories'][number]; label: string; blurb: string }[]

export type AccessoryCategory = Accessory['categories'][number]
export const CATEGORY_UNKNOWN = 'unknown'
export const STAGE_UNKNOWN = 'unknown'
export const MAX_QUERY_LENGTH = 60

export const categoryLabel = (c: string): string => ACCESSORY_CATEGORIES.find((x) => x.id === c)?.label ?? 'Unknown'

/** The categories an accessory is filed under, or ["unknown"] when its list is unverified. */
export function categoryBuckets(a: Accessory): string[] {
  const view = getField(a, 'categories')
  if (view.status === 'unverified') return [CATEGORY_UNKNOWN]
  const cats = (view.value as string[] | undefined) ?? []
  return cats.length > 0 ? cats : [CATEGORY_UNKNOWN]
}

/** Verified (or curated) stage, else undefined. */
export function verifiedStage(record: unknown): string | undefined {
  const view = getField(record, 'stage')
  return view.status === 'verified' || view.status === 'editorial' ? (view.value as string) : undefined
}

// --- filters ----------------------------------------------------------------------------------------

export const ACCESSORY_FACET_IDS = ['category', 'stage'] as const
export type AccessoryFacetId = (typeof ACCESSORY_FACET_IDS)[number]
export interface AccessoryFilters {
  category: readonly string[]
  stage: readonly string[]
  q: string
}
export const EMPTY_ACCESSORY_FILTERS: AccessoryFilters = { category: [], stage: [], q: '' }

// the unknown bucket reads "Unknown" under its facet's own "Category" label (chip: "Category: Unknown", never "Category: Category unknown")
const CATEGORY_OPTIONS: readonly { value: string; label: string }[] = [...ACCESSORY_CATEGORIES.map((c) => ({ value: c.id as string, label: c.label })), { value: CATEGORY_UNKNOWN, label: 'Unknown' }]
const STAGE_OPTIONS: readonly { value: string; label: string }[] = [...STAGES.map((s) => ({ value: s.id as string, label: s.label })), { value: STAGE_UNKNOWN, label: 'Stage unknown' }]
const VALID: Record<AccessoryFacetId, readonly string[]> = { category: CATEGORY_OPTIONS.map((o) => o.value), stage: STAGE_OPTIONS.map((o) => o.value) }

/** OR within a facet, AND across facets; an accessory in two categories matches either. */
export function matchesAccessory(a: Accessory, f: AccessoryFilters, skip?: AccessoryFacetId): boolean {
  if (skip !== 'category' && f.category.length > 0 && !categoryBuckets(a).some((c) => f.category.includes(c))) return false
  if (skip !== 'stage' && f.stage.length > 0 && !f.stage.includes(verifiedStage(a) ?? STAGE_UNKNOWN)) return false
  return matchesName(a.name, f.q)
}

export function parseAccessoryFilters(params: URLSearchParams): AccessoryFilters {
  const read = (id: AccessoryFacetId) => {
    const requested = new Set((params.get(id) ?? '').split(',').map((v) => v.trim()).filter(Boolean))
    return VALID[id].filter((v) => requested.has(v))
  }
  return { category: read('category'), stage: read('stage'), q: (params.get('q') ?? '').trim().slice(0, MAX_QUERY_LENGTH) }
}

export function writeAccessoryFilters(params: URLSearchParams, f: AccessoryFilters): URLSearchParams {
  const next = new URLSearchParams(params)
  for (const id of ACCESSORY_FACET_IDS) {
    if (f[id].length > 0) next.set(id, f[id].join(','))
    else next.delete(id)
  }
  if (f.q.trim()) next.set('q', f.q.trim().slice(0, MAX_QUERY_LENGTH))
  else next.delete('q')
  return next
}

export function toggleAccessoryFilter(f: AccessoryFilters, facet: AccessoryFacetId, value: string): AccessoryFilters {
  const nextSet = f[facet].includes(value) ? f[facet].filter((v) => v !== value) : [...f[facet], value]
  return { ...f, [facet]: VALID[facet].filter((v) => nextSet.includes(v)) }
}

export const activeAccessoryFilterCount = (f: AccessoryFilters): number => f.category.length + f.stage.length + (f.q ? 1 : 0)

export function buildAccessoryFacets(list: readonly Accessory[], f: AccessoryFilters) {
  const count = (facet: AccessoryFacetId, value: string) =>
    list.filter((a) => matchesAccessory(a, f, facet) && (facet === 'category' ? categoryBuckets(a).includes(value) : (verifiedStage(a) ?? STAGE_UNKNOWN) === value)).length
  const present = new Set(list.flatMap(categoryBuckets))
  return [
    { id: 'category', label: 'Category', options: CATEGORY_OPTIONS.filter((o) => present.has(o.value)).map((o) => ({ ...o, count: count('category', o.value) })) },
    { id: 'stage', label: 'Game stage', options: STAGE_OPTIONS.map((o) => ({ ...o, count: count('stage', o.value) })) },
  ]
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })
export function sortAccessories(list: Iterable<Accessory>): Accessory[] {
  return [...list].sort((a, b) => collator.compare(a.name, b.name) || a.id - b.id)
}

// --- which classes its effects count for (AC1 loadout notes) ---------------------------------------------

export interface FitGroup {
  /** undefined = every class */
  scope: DamageClass | undefined
  stats: StatEffectOf[]
  /** Wiki-text effects; `curated` = tied to the class by B108(a)'s editorial keyword registry. */
  specials: { effect: SpecialEffectOf; curated: boolean }[]
}

/** The accessory's effects by the class they count for (every class first), or "unknown" when its effects are. */
export function loadoutFit(a: Accessory): { kind: 'unknown' } | { kind: 'known'; groups: FitGroup[] } {
  const view = getField(a, 'effects')
  if (view.status === 'unverified') return { kind: 'unknown' }
  const groups = new Map<string, FitGroup>()
  const group = (scope: DamageClass | undefined) => {
    const key = scope ?? 'all'
    let g = groups.get(key)
    if (!g) groups.set(key, (g = { scope, stats: [], specials: [] }))
    return g
  }
  for (const e of (view.value as StatEffect[] | undefined) ?? []) {
    if (isStat(e)) group(effectScope(e)).stats.push(e)
    else if (isSpecial(e)) {
      const scope = specialScope(e.text)
      group(scope).specials.push({ effect: e, curated: scope !== undefined })
    }
  }
  const order = (g: FitGroup) => (g.scope === undefined ? -1 : CLASS_ORDER.indexOf(g.scope))
  return { kind: 'known', groups: [...groups.values()].sort((x, y) => order(x) - order(y)) }
}

// --- combination tree (AC2) ---------------------------------------------------------------------------

export type ComboIngredient =
  | { kind: 'accessory'; amount: number; node: ComboNode }
  | { kind: 'item'; id: number; amount: number }
  | { kind: 'group'; groupId: string; amount: number; members: number[] }

export interface ComboRecipe {
  recipeId: string
  ingredients: ComboIngredient[]
}

export interface ComboNode {
  id: number
  /** Combination recipes (alternatives); empty = not combined from other accessories. */
  recipes: ComboRecipe[]
  /** The accessory is already higher up this branch: shown, not expanded again. */
  repeat?: boolean
}

export interface ComboSources {
  accessories: ReadonlyMap<number, Accessory>
  recipes: ReadonlyMap<string, Recipe>
}

/**
 * The accessory's combination recipes: its craft recipes using an accessory of its `combinedFrom` (DERIVED from the
 * Tinkerer's Workshop recipes, DATA_SCHEMA_SPEC §2.5) — directly or through an "Any …" group. A Shimmer
 * transmutation (Armor Polish ⇄ Vitamins) is a way to obtain, listed under "How to obtain", not a combination.
 */
export function combinationRecipes(a: Accessory, src: ComboSources & { groups: ReadonlyMap<string, RecipeGroup> }): Recipe[] {
  const from = new Set(a.combinedFrom)
  const isAccessoryRef = (ref: Recipe['ingredients'][number]['ref']) =>
    ref.kind === 'item' ? from.has(ref.itemId) : (src.groups.get(ref.groupId)?.memberItemIds ?? []).some((m) => from.has(m))
  return a.acquisition
    .filter((r) => r.method === 'craft')
    .flatMap((r) => r.recipeIds)
    .map((id) => src.recipes.get(id))
    .filter((r): r is Recipe => r !== undefined && r.ingredients.some((i) => isAccessoryRef(i.ref)))
}

export function combinationTree(id: number, src: ComboSources & { groups: ReadonlyMap<string, RecipeGroup> }, path: ReadonlySet<number> = new Set()): ComboNode {
  const a = src.accessories.get(id)
  if (!a) return { id, recipes: [] }
  if (path.has(id)) return { id, recipes: [], repeat: true }
  const below = new Set(path).add(id)
  return {
    id,
    recipes: combinationRecipes(a, src).map((r) => ({
      recipeId: r.id,
      ingredients: r.ingredients.map((ing): ComboIngredient => {
        if (ing.ref.kind === 'group') return { kind: 'group', groupId: ing.ref.groupId, amount: ing.amount, members: [...(src.groups.get(ing.ref.groupId)?.memberItemIds ?? [])] }
        if (src.accessories.has(ing.ref.itemId)) return { kind: 'accessory', amount: ing.amount, node: combinationTree(ing.ref.itemId, src, below) }
        return { kind: 'item', id: ing.ref.itemId, amount: ing.amount }
      }),
    })),
  }
}

/** Every node of a tree (tests; the "N accessories" count). */
export function comboNodeCount(node: ComboNode): number {
  return 1 + node.recipes.reduce((n, r) => n + r.ingredients.reduce((m, i) => m + (i.kind === 'accessory' ? comboNodeCount(i.node) : 1), 0), 0)
}

export interface UpgradeNode {
  id: number
  into: UpgradeNode[]
  repeat?: boolean
}

/** What the accessory is combined into, and what those go into, to the top (upgradesTo, derived from the same recipes). */
export function upgradeTree(id: number, accessories: ReadonlyMap<number, Accessory>, path: ReadonlySet<number> = new Set()): UpgradeNode {
  if (path.has(id)) return { id, into: [], repeat: true }
  const below = new Set(path).add(id)
  const a = accessories.get(id)
  return { id, into: (a?.upgradesTo ?? []).filter((x) => accessories.has(x)).map((x) => upgradeTree(x, accessories, below)) }
}

/** Display name of any item id (accessory record, else the item-universe name). */
export function nameOf(id: number, accessories: ReadonlyMap<number, Accessory>, names: ItemNames | undefined): string {
  return accessories.get(id)?.name ?? names?.byId.get(id) ?? `Item #${id}`
}
