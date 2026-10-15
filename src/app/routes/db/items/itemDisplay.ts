/**
 * Pure display rules for the item encyclopedia (P6, AMENDMENTS-016; DATA_SCHEMA_SPEC §2.6 Item). Every
 * verified-or-Unknown field is read through `getField` (§2.1 rule 5): "unverified" renders Unknown,
 * "not-applicable" omits the row, values render formatted. No value is inferred: a stat row exists only
 * where the record carries the field or lists it as Unknown.
 */
import type { Item, ItemCategory, Recipe, RecipeGroup } from '../../../../schemas'
import { getField, type FieldView } from '../../../../schemas/getField'
import { ammoTypeLabel, formatCoins, formatNumber, routeTitle, type StatRow } from '../weapons/weaponDisplay'
import { asGroup, CONSUMED_PLACEABLE, USED_AS_STATION, usesAmount } from './itemCopy'

export interface CategoryInfo {
  id: ItemCategory
  /** Plural label (tiles, filter options, headings). */
  label: string
  /** Singular badge label. */
  badge: string
  /** One line for the category tile. */
  blurb: string
}

/**
 * Category registry, in tile order: REQUIREMENTS §7's encyclopedia list first (materials, potions,
 * summoning items, mounts, hooks, tools, ammo, crafting stations, exploration / utility, event + boss
 * drops live under their own kinds), then the rest of the corpus. Keyed by every ItemCategory, so a new
 * category fails typecheck until it has a label.
 */
const CATEGORY_TABLE: Readonly<Record<ItemCategory, Omit<CategoryInfo, 'id'>>> = {
  material: { label: 'Materials', badge: 'Material', blurb: 'Ores, bars, gems and drops used in recipes' },
  potion: { label: 'Potions', badge: 'Potion', blurb: 'Healing, mana and buff potions' },
  summoning: { label: 'Summoning items', badge: 'Summoning item', blurb: 'Items that summon a boss or start an event' },
  mount: { label: 'Mounts', badge: 'Mount', blurb: 'Mount summons, minecarts included' },
  hook: { label: 'Hooks', badge: 'Hook', blurb: 'Grappling hooks' },
  tool: { label: 'Tools', badge: 'Tool', blurb: 'Pickaxes, axes, hammers, fishing poles and more' },
  ammo: { label: 'Ammo', badge: 'Ammo', blurb: 'Arrows, bullets, rockets and other ammunition' },
  station: { label: 'Crafting stations', badge: 'Crafting station', blurb: 'Workbenches, anvils, furnaces and other stations' },
  'exploration-utility': { label: 'Exploration & utility', badge: 'Utility', blurb: 'Teleport and recall potions, keys, utility summons' },
  food: { label: 'Food', badge: 'Food', blurb: 'Food and drinks (Well Fed and its tiers)' },
  fishing: { label: 'Fishing', badge: 'Fishing', blurb: 'Fish, quest fish, crates and bait' },
  'grab-bag': { label: 'Grab bags', badge: 'Grab bag', blurb: 'Treasure bags, presents and other containers' },
  'permanent-booster': { label: 'Permanent boosters', badge: 'Permanent booster', blurb: 'Life Crystals, Demon Heart and other lasting upgrades' },
  pet: { label: 'Pets', badge: 'Pet', blurb: 'Pet and light pet summons' },
  vanity: { label: 'Vanity', badge: 'Vanity', blurb: 'Cosmetic clothing, vanity accessories, music boxes' },
  dye: { label: 'Dyes', badge: 'Dye', blurb: 'Dyes and hair dyes' },
  furniture: { label: 'Furniture', badge: 'Furniture', blurb: 'Furniture, lights, storage and mechanisms' },
  block: { label: 'Blocks', badge: 'Block', blurb: 'Placeable blocks, bricks and walls' },
  other: { label: 'Other', badge: 'Other', blurb: 'Seeds, paints, coatings and everything else' },
}

export const ITEM_CATEGORIES: readonly CategoryInfo[] = (Object.keys(CATEGORY_TABLE) as ItemCategory[]).map((id) => ({ id, ...CATEGORY_TABLE[id] }))

export function categoryInfo(id: ItemCategory): CategoryInfo {
  return { id, ...CATEGORY_TABLE[id] }
}

export const isItemCategory = (value: string): value is ItemCategory => Object.hasOwn(CATEGORY_TABLE, value)

/** Ticks → "8 minutes", "30 seconds", "1 minute 30 seconds" (60 ticks = 1 second; the wiki's units). */
export function formatDurationTicks(ticks: number): string {
  const seconds = ticks / 60
  if (!Number.isInteger(seconds)) return `${formatNumber(seconds)} seconds`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  const part = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`
  if (minutes === 0) return part(seconds, 'second')
  return rest === 0 ? part(minutes, 'minute') : `${part(minutes, 'minute')} ${part(rest, 'second')}`
}

/** A buff duration: fixed ticks or a range (AMENDMENTS-002 B5). */
export function formatDuration(d: NonNullable<NonNullable<Item['buffGrants']>[number]['durationTicks']>): string {
  return typeof d === 'number' ? formatDurationTicks(d) : `${formatDurationTicks(d.minTicks)} – ${formatDurationTicks(d.maxTicks)}`
}

/**
 * Stat rows for the item page's StatsPanel, in display order, not-applicable rows removed. Category-specific
 * rows appear wherever the record carries the field (a fishing pole is a tool with fishing power, bait is a
 * fishing item with bait power) or lists it as Unknown (hooks: hookStats, mounts: mountStats).
 */
export function itemStatRows(item: Item): StatRow[] {
  const rows: StatRow[] = []
  const add = (key: string, label: string, field: string, view: FieldView, format: (value: unknown) => string) => {
    if (view.status === 'not-applicable') return
    rows.push({ key, label, field, view, text: view.status === 'unverified' || view.value === undefined ? undefined : format(view.value) })
  }
  const field = (path: string) => getField(item, path)
  const pct = (v: unknown) => `${v as number}%`
  // tools / fishing
  add('pickaxe', 'Pickaxe power', 'toolStats.pickaxePowerPct', field('toolStats.pickaxePowerPct'), pct)
  add('axe', 'Axe power', 'toolStats.axePowerPct', field('toolStats.axePowerPct'), pct)
  add('hammer', 'Hammer power', 'toolStats.hammerPowerPct', field('toolStats.hammerPowerPct'), pct)
  add('fishingPower', 'Fishing power', 'toolStats.fishingPowerPct', field('toolStats.fishingPowerPct'), pct)
  add('bait', 'Bait power', 'baitPowerPct', field('baitPowerPct'), pct)
  // ammo
  add('ammoType', 'Ammo type', 'ammoStats.ammoClass', field('ammoStats.ammoClass'), (v) => ammoTypeLabel(v as string))
  add('ammoDamage', 'Damage', 'ammoStats.damage', field('ammoStats.damage'), (v) => formatNumber(v as number))
  add('ammoKnockback', 'Knockback', 'ammoStats.knockback', field('ammoStats.knockback'), (v) => formatNumber(v as number))
  add('ammoVelocity', 'Velocity bonus', 'ammoStats.velocityBonusTps', field('ammoStats.velocityBonusTps'), (v) => `+${formatNumber(v as number)} tiles/s`)
  add('ammoMultiplier', 'Velocity multiplier', 'ammoStats.velocityMultiplier', field('ammoStats.velocityMultiplier'), (v) => `${formatNumber(v as number)}×`)
  // consumables
  add('healLife', 'Restores health', 'healLife', field('healLife'), (v) => `${v as number} HP`)
  add('healMana', 'Restores mana', 'healMana', field('healMana'), (v) => `${v as number} mana`)
  // not extracted for this corpus (always listed Unknown on hooks / mounts — never claimed not applicable)
  add('hookStats', 'Hook reach and hooks', 'hookStats', field('hookStats'), () => '')
  add('mountStats', 'Mount details', 'mountStats', field('mountStats'), () => '')
  // shared
  // B113(e): a placeable (station, furniture, block) is "consumed" by placing it — said so, not a bare "Yes"
  add('consumable', 'Consumed on use', 'consumable', field('consumable'), (v) => (v ? (isPlaceable(item) ? CONSUMED_PLACEABLE : 'Yes') : 'No'))
  add('maxStack', 'Max stack', 'maxStack', field('maxStack'), (v) => String(v))
  add('value', 'Value', 'valueCopper', field('valueCopper'), (v) => ((v as number) === 0 ? 'None' : formatCoins(v as number)))
  // a row whose value only says "carried" never renders as a bare empty cell
  return rows.filter((r) => r.text !== '' || r.view.status === 'unverified')
}

/** Human labels for item dot-paths (partially-verified badge details). */
const FIELD_LABELS: Record<string, string> = {
  rarity: 'Rarity',
  stage: 'Game stage',
  gatedBy: 'Required progress',
  acquisition: 'How to obtain',
  buffGrants: 'Buffs granted',
  'buffGrants.0.durationTicks': 'Buff duration',
  hookStats: 'Hook reach and hooks',
  mountStats: 'Mount details',
  healLife: 'Restores health',
  healMana: 'Restores mana',
  'ammoStats.damage': 'Damage',
  'ammoStats.knockback': 'Knockback',
  'ammoStats.velocityBonusTps': 'Velocity bonus',
  'ammoStats.velocityMultiplier': 'Velocity multiplier',
  'toolStats.pickaxePowerPct': 'Pickaxe power',
  'toolStats.axePowerPct': 'Axe power',
  'toolStats.hammerPowerPct': 'Hammer power',
  'toolStats.fishingPowerPct': 'Fishing power',
  baitPowerPct: 'Bait power',
  consumable: 'Consumed on use',
  maxStack: 'Max stack',
  valueCopper: 'Value',
  summonsBossNode: 'Summons',
}

/** Label for an unverified item dot-path, worded like the section it sits in ("Sold by Merchant — price"). */
export function itemFieldLabel(path: string, item?: Pick<Item, 'acquisition'>): string {
  const match = /^acquisition\.(\d+)\.(\w+)$/.exec(path)
  if (match) {
    const route = item?.acquisition[Number(match[1])]
    const where = route ? routeTitle(route) : `Way to obtain #${Number(match[1]) + 1}`
    return `${where} — ${match[2] === 'priceCopper' ? 'price' : match[2]}`
  }
  return FIELD_LABELS[path] ?? path
}

/**
 * Item-level paths the detail page can render as Unknown. A test asserts the shipped dataset lists no
 * other path, so no Unknown is ever silently dropped (the weapon pages' AC4 rule).
 */
export const ITEM_UNKNOWN_CAPABLE_PATHS: readonly RegExp[] = [
  /^(rarity|stage|gatedBy|acquisition|buffGrants|hookStats|mountStats|healLife|healMana|consumable|maxStack|valueCopper|summonsBossNode|baitPowerPct)$/,
  /^ammoStats\.(damage|knockback|velocityBonusTps|velocityMultiplier)$/,
  /^toolStats\.(pickaxePowerPct|axePowerPct|hammerPowerPct|fishingPowerPct)$/,
  /^buffGrants\.\d+\.durationTicks$/,
  /^acquisition\.\d+\.(priceCopper|conditions)$/,
]

// --- "Used in": recipes that consume the item (directly or as a member of an "Any …" group) or need it as a station

export interface ItemUse {
  recipe: Recipe
  /** How the item takes part: an ingredient (with amount; `via` = the "Any …" group it counts for) or the station. */
  role: { kind: 'ingredient'; amount: number; via?: RecipeGroup } | { kind: 'station'; via?: RecipeGroup }
}

/**
 * Every recipe that uses `itemId`, deduplicated per recipe (one role each: ingredient before station), in
 * result-id order. Group membership comes from the recipe groups (Module:Recipes), never guessed.
 */
export function itemUses(itemId: number, recipes: Iterable<Recipe>, groups: ReadonlyMap<string, RecipeGroup>): ItemUse[] {
  const memberOf = [...groups.values()].filter((g) => g.memberItemIds.includes(itemId))
  const groupIds = new Map(memberOf.map((g) => [g.id, g]))
  const uses: ItemUse[] = []
  for (const recipe of recipes) {
    const ingredient = recipe.ingredients.find((g) => (g.ref.kind === 'item' ? g.ref.itemId === itemId : groupIds.has(g.ref.groupId)))
    if (ingredient) {
      const via = ingredient.ref.kind === 'group' ? groupIds.get(ingredient.ref.groupId) : undefined
      uses.push({ recipe, role: { kind: 'ingredient', amount: ingredient.amount, ...(via ? { via } : {}) } })
      continue
    }
    const station = recipe.stations.find((s) => (s.kind === 'item' ? s.itemId === itemId : s.kind === 'group' ? groupIds.has(s.groupId) : false))
    if (station) {
      const via = station.kind === 'group' ? groupIds.get(station.groupId) : undefined
      uses.push({ recipe, role: { kind: 'station', ...(via ? { via } : {}) } })
    }
  }
  return uses.sort((a, b) => a.recipe.resultItemId - b.recipe.resultItemId || a.recipe.id.localeCompare(b.recipe.id))
}

/** Results shown before "Show all". */
export const USED_IN_PREVIEW = 24

export interface UsedInEntry {
  resultId: number
  uses: ItemUse[]
}

/** One entry per result item (alternative recipes of the same result merge), in result-id order. */
export function usedInEntries(uses: readonly ItemUse[]): UsedInEntry[] {
  const byResult = new Map<number, ItemUse[]>()
  for (const u of uses) byResult.set(u.recipe.resultItemId, [...(byResult.get(u.recipe.resultItemId) ?? []), u])
  return [...byResult].map(([resultId, list]) => ({ resultId, uses: list }))
}

/**
 * What the recipe takes of this item (B113(e) M2, the "How to obtain" form): "uses 7 × Silk", "uses 2 ×
 * Any Iron Bar" (a group the item counts for), "crafting station (as Iron or Lead Anvil)"; several recipes
 * joined with " or ". Never a bare "× 2", which reads as the recipe's yield.
 */
export function usedInLine(entry: UsedInEntry, itemName: string): string {
  const parts = entry.uses.map((u) =>
    u.role.kind === 'ingredient' ? usesAmount(u.role.amount, u.role.via?.name ?? itemName) : u.role.via ? `${USED_AS_STATION} ${asGroup(u.role.via.name)}` : USED_AS_STATION,
  )
  return [...new Set(parts)].join(' or ')
}

/** Categories whose items are placed in the world (using one = placing it). */
const PLACEABLE: ReadonlySet<ItemCategory> = new Set(['station', 'furniture', 'block'])
export const isPlaceable = (item: Pick<Item, 'category' | 'isStation'>): boolean => item.isStation || PLACEABLE.has(item.category)
