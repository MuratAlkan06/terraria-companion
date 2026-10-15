/**
 * Plan wording helpers and shared class strings (non-component exports of the plan views, kept apart so the
 * component modules stay Fast-Refresh clean).
 */
import { Fish, Hammer, Info, Package, Skull, Store, type LucideIcon } from 'lucide-react'
import type { DropSource, Recipe } from '../../../data-access/types'
import { humanizeSlug } from '../db/weapons/weaponDisplay'
import * as copy from './planCopy'
import type { PlanBase } from './planData'
import type { HeldReason, PlanItemNode, PlanRecord, PlanRoute, RouteMethod } from './planTree'

export const LINK = 'text-link underline decoration-1 underline-offset-4 hover:text-accent-strong'
export const LABEL = 'text-xs font-semibold tracking-wide text-fg-muted uppercase'

export const ROUTE_ICON: Record<RouteMethod, LucideIcon> = { craft: Hammer, drop: Skull, purchase: Store, loot: Package, fishing: Fish, other: Info }

/** An item's display name over the base (search docs, then the names index). */
export function itemName(id: number, base: PlanBase): string {
  return base.docs.get(`i:${id}`)?.name ?? base.acquisition.names?.byId.get(id) ?? `Item #${id}`
}

/** Station names joined with " + " (a group of interchangeable stations is named as the group: "Iron or Lead Anvil"). */
export function stationNames(recipe: Recipe, base: PlanBase): string {
  return recipe.stations
    .map((s) => (s.kind === 'item' ? itemName(s.itemId, base) : s.kind === 'group' ? (base.acquisition.recipes?.groups.get(s.groupId)?.name ?? humanizeSlug(s.groupId)) : s.name))
    .join(' + ')
}

/**
 * A recipe's ingredients in words ("3 Hellstone · 1 Obsidian"), each amount × `crafts` — the chooser passes the
 * crafts this plan needs, so its quantities are the ones the tree shows for the way in use (B118(f)).
 */
export function ingredientWords(recipe: Recipe, base: PlanBase, crafts = 1): string {
  return recipe.ingredients
    // the amount stays with its name (no line break between them)
    .map((i) => `${(i.amount * crafts).toLocaleString('en-US')} ${i.ref.kind === 'item' ? itemName(i.ref.itemId, base) : (base.acquisition.recipes?.groups.get(i.ref.groupId)?.name ?? humanizeSlug(i.ref.groupId))}`)
    .join(' · ')
}

/** One drop source: a boss with its Treasure Bag together, else an enemy / container by name (the checklist's grouping). */
export interface DropSourceGroup {
  key: string
  name: string
  bossId?: string
  drops: DropSource[]
}

/**
 * A drop route's sources, in data order — the ONE grouping the tree's "Drops from N sources", the chooser's
 * source rows and the checklist's "From …" groups all count (B118(f): their counts agree).
 */
export function dropSourceGroups(dropIds: readonly string[], base: PlanBase): DropSourceGroup[] {
  const out = new Map<string, DropSourceGroup>()
  for (const id of dropIds) {
    const d = base.acquisition.drops?.byId.get(id)
    if (!d) continue
    const bossId = d.source.bossId
    const key = bossId ? `boss:${bossId}` : `source:${d.source.npcName}`
    const group = out.get(key) ?? { key, name: bossId ? (base.acquisition.progression?.nodeById.get(bossId)?.name ?? d.source.npcName) : d.source.npcName, ...(bossId ? { bossId } : {}), drops: [] }
    group.drops.push(d)
    out.set(key, group)
  }
  return [...out.values()]
}

/** A short line naming a route (the tree rows): "Craft at Iron or Lead Anvil", "Drops from Queen Bee", "Sold by Merchant", … */
export function routeLine(record: PlanRecord, route: PlanRoute, base: PlanBase): string {
  const acq = record.acquisition[route.acqIndex]
  switch (acq?.method) {
    case 'craft':
      return route.recipe ? (route.recipe.stations.length > 0 ? copy.craftAt(stationNames(route.recipe, base)) : copy.BY_HAND) : copy.ROUTE_KIND.craft
    case 'drop': {
      const groups = dropSourceGroups(acq.dropIds, base)
      return groups.length === 1 ? copy.dropFrom(groups[0].name) : groups.length > 1 ? copy.dropSources(groups.length) : copy.ROUTE_KIND.drop
    }
    case 'purchase':
      return copy.soldBy(acq.npcName)
    case 'loot':
      return copy.foundIn(acq.containers.join(', '))
    case 'fishing':
      return copy.fishedIn(acq.biomes.join(', '))
    case 'other':
      return copy.OTHER_WAY
    default:
      return ''
  }
}

/** A way in words, with its place among the recipes when there are several ("Craft at Furnace · recipe 3 of 3"). */
export function wayLabel(node: PlanItemNode, route: PlanRoute, base: PlanBase): string {
  const crafts = node.routes.filter((r) => r.method === 'craft')
  const line = node.record ? routeLine(node.record, route, base) : copy.ROUTE_KIND[route.method]
  return route.method === 'craft' && crafts.length > 1 ? `${line} · ${copy.recipeOf(crafts.indexOf(route) + 1, crafts.length)}` : line
}

/** Why a way isn't picked for the user, in words — naming the item the way NEEDS (B118(d)), not the item itself. */
export function heldText(held: HeldReason, name: string, ctx: { info: (key: string) => { name: string } }): string {
  if (held.kind === 'shimmer') return copy.SHIMMER_NOTE
  if (held.kind === 'circular') return copy.circular(ctx.info(held.via).name, name)
  return copy.reversal(ctx.info(`i:${held.via}`).name, name)
}

/** The same reason, short, for the tree's inline note on recipes skipped before "recipe N of M" (B118(j)). */
export function heldShort(held: HeldReason, recipeNumber: number, name: string, ctx: { info: (key: string) => { name: string } }): string {
  if (held.kind === 'shimmer') return copy.skippedShimmer(recipeNumber)
  if (held.kind === 'circular') return copy.skippedCircular(recipeNumber, ctx.info(held.via).name)
  return copy.skippedReversal(recipeNumber, ctx.info(`i:${held.via}`).name, name)
}
