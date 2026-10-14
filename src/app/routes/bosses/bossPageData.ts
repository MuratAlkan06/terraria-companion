import {
  loadAccessoryDetails,
  loadAccessoryList,
  loadArmorDetails,
  loadArmorList,
  loadArmorSets,
  loadBuffs,
  loadConditionIndex,
  loadDetailIndex,
  loadDropIndex,
  loadItemNames,
  loadItems,
  loadList,
  loadStageGaps,
  NotFoundError,
  peekAccessoryDetails,
  peekAccessoryList,
  peekArmorDetails,
  peekArmorList,
  peekArmorSets,
  peekBuffs,
  peekConditionIndex,
  peekDetailIndex,
  peekDropIndex,
  peekItemNames,
  peekItems,
  peekList,
  peekStageGaps,
} from '../../../data-access'
import type { Accessory, ArmorPiece, ArmorSet, Boss, Buff, ConditionIndex, DropIndex, GapEntry, SpriteIndex, Weapon } from '../../../data-access/types'
import { buildMapGraph, type MapGraph } from '../../../components/nodeMap/graph'
import { hasBossPage } from '../../../schemas/bossPages'
import { loadBossMapData, peekBossMapData } from './bossMapData'
import { itemResolver, tipLinker, type ItemInfo, type ItemSources, type TipSegment } from './bossPageModel'

/**
 * Data for /bosses/:id (PRD P5-S2). The map data (graph, boss records, sprite manifest) plus what the
 * page's sections read: the boss's drop records, item names/sprites/links (weapon, accessory, armor
 * and ammo lists + the Iteminfo name universe; the buff registry's article URLs for items with no
 * record of their own, e.g. potions), the conditions registry and the stage gap log (the stated
 * reasons behind declared Unknowns). The stage gap log is optional: without it a declared Unknown
 * still renders Unknown, just without its reason.
 *
 * Only bosses listed in src/schemas/bossPages.ts have a page; any other id is a NotFoundError.
 */
export interface BossPageData {
  boss: Boss
  graph: MapGraph
  sprites: SpriteIndex | null
  drops: DropIndex
  itemOf: (id: number) => ItemInfo
  /** Splits a quoted tip into text and the real weapons it names (linked; the quote stays verbatim). */
  linkTip: (text: string) => TipSegment[]
  conditions: ConditionIndex
  /** undefined = the gap log failed to load (reasons not shown; Unknowns still are). */
  gaps: readonly GapEntry[] | undefined
}

const bossRef = (id: string) => `boss:${id}`

type PageItemSources = Omit<ItemSources, 'articles'> & { buffs: readonly Buff[] }

let resolver: { sources: PageItemSources; itemOf: (id: number) => ItemInfo; linkTip: (text: string) => TipSegment[] } | undefined
function resolverFor(sources: PageItemSources) {
  if (resolver?.sources.weapons !== sources.weapons || resolver.sources.names !== sources.names || resolver.sources.buffs !== sources.buffs) {
    const itemOf = itemResolver({ ...sources, articles: sources.buffs.map((b) => b.wikiUrl) })
    resolver = { sources, itemOf, linkTip: tipLinker(sources.weapons, itemOf) }
  }
  return resolver
}

let graphCache: { bosses: readonly Boss[]; graph: MapGraph } | undefined
function graphFor(map: { progression: Parameters<typeof buildMapGraph>[0]; bosses: readonly Boss[] }) {
  if (graphCache?.bosses !== map.bosses) graphCache = { bosses: map.bosses, graph: buildMapGraph(map.progression, map.bosses) }
  return graphCache.graph
}

function assemble(
  id: string,
  map: NonNullable<ReturnType<typeof peekBossMapData>>,
  rest: { drops: DropIndex; conditions: ConditionIndex; gaps: readonly GapEntry[] | undefined; sources: PageItemSources },
): BossPageData {
  const boss = map.bosses.find((b) => b.id === id)
  if (!boss) throw new NotFoundError(bossRef(id))
  const { itemOf, linkTip } = resolverFor(rest.sources)
  return { boss, graph: graphFor(map), sprites: map.sprites, drops: rest.drops, conditions: rest.conditions, gaps: rest.gaps, itemOf, linkTip }
}

export async function loadBossPageData(id: string): Promise<BossPageData> {
  if (!hasBossPage(id)) throw new NotFoundError(bossRef(id))
  const [map, drops, names, weapons, accessories, armor, items, buffs, conditions, gaps] = await Promise.all([
    loadBossMapData(),
    loadDropIndex(),
    loadItemNames(),
    loadList('weapons'),
    loadAccessoryList(),
    loadArmorList(),
    loadItems(),
    loadBuffs(),
    loadConditionIndex(),
    loadStageGaps().catch((error: unknown) => {
      console.warn('[gaps] Stage gap log unavailable; declared Unknowns render without their reason.', error)
      return undefined
    }),
  ])
  return assemble(id, map, { drops, conditions, gaps, sources: { names, weapons, accessories, armor, items, buffs } })
}

/** The page data when everything is already loaded (back navigation renders on the first frame). */
export function peekBossPageData(id: string): BossPageData | undefined {
  if (!hasBossPage(id)) return undefined
  const map = peekBossMapData()
  const drops = peekDropIndex()
  const conditions = peekConditionIndex()
  const names = peekItemNames()
  const weapons = peekList('weapons')
  const accessories = peekAccessoryList()
  const armor = peekArmorList()
  const items = peekItems()
  const buffs = peekBuffs()
  if (!map || !drops || !conditions || !names || !weapons || !accessories || !armor || !items || !buffs) return undefined
  try {
    return assemble(id, map, { drops, conditions, gaps: peekStageGaps(), sources: { names, weapons, accessories, armor, items, buffs } })
  } catch {
    return undefined
  }
}

// --- suggested gear (loaded only for a boss with gear entries) -------------------------------

/** What the gear panel needs beyond the page data: gating (detail records), armor sets, buffs. */
export interface GearData {
  weapons: ReadonlyMap<number, Weapon>
  accessories: ReadonlyMap<number, Accessory>
  armor: ReadonlyMap<number, ArmorPiece>
  sets: ReadonlyMap<string, ArmorSet>
  buffs: ReadonlyMap<string, Buff>
}

export async function loadGearData(): Promise<GearData> {
  const [weapons, accessories, armor, sets, buffs] = await Promise.all([loadDetailIndex('weapons'), loadAccessoryDetails(), loadArmorDetails(), loadArmorSets(), loadBuffs()])
  return { weapons, accessories, armor, sets, buffs: new Map(buffs.map((b) => [b.id, b])) }
}

export function peekGearData(): GearData | undefined {
  const [weapons, accessories, armor, sets, buffs] = [peekDetailIndex('weapons'), peekAccessoryDetails(), peekArmorDetails(), peekArmorSets(), peekBuffs()]
  return weapons && accessories && armor && sets && buffs ? { weapons, accessories, armor, sets, buffs: new Map(buffs.map((b) => [b.id, b])) } : undefined
}
