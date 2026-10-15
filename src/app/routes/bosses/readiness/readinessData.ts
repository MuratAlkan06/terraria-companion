import {
  loadAccessoryDetails,
  loadArmorDetails,
  loadArmorSets,
  loadBuffs,
  loadConditionIndex,
  loadDetailIndex,
  loadItemNames,
  loadItems,
  peekAccessoryDetails,
  peekArmorDetails,
  peekArmorSets,
  peekBuffs,
  peekConditionIndex,
  peekDetailIndex,
  peekItemNames,
  peekItems,
} from '../../../../data-access'
import type { Accessory, ArmorPiece, ArmorSet, Boss, Buff, ConditionIndex, Item, ItemNames, SpriteIndex, Weapon } from '../../../../data-access/types'
import { meta } from '../../../../data/meta'
import { buildMapGraph, type MapGraph } from '../../../../components/nodeMap/graph'
import type { ReadinessData } from '../../../../scoring/readiness'
import { STAGE_IDS } from '../../../stages'
import { ammoTypeLabel } from '../../db/weapons/weaponDisplay'
import { loadBossMapData, peekBossMapData, type BossMapData } from '../bossMapData'
import { itemResolver, type ItemInfo } from '../bossPageModel'

/**
 * Data for /readiness (PRD P5-S6): the detail records the engine reads (weapons, armor, accessories,
 * sets, items — ammo + potions — and buffs), the boss records and progression graph, the conditions
 * registry (requirement chips), the Iteminfo name universe (items with no record of their own, e.g. a
 * summoning item) and the sprite manifest. All lazy data chunks, cached for the session. Items resolve
 * like on the boss pages (bossPageModel.itemResolver): weapons, armor pieces, accessories and Item records
 * (ammo, potions) → their page in-app (AMENDMENTS-016 B131(b)); anything else → the article titled with its
 * name, else the wiki's search for it (never a guessed URL).
 */
export interface ReadinessPageData {
  engine: ReadinessData
  graph: MapGraph
  sprites: SpriteIndex | null
  conditions: ConditionIndex
  /** Bosses in progression order (stage, then name) for the picker. */
  bosses: readonly Boss[]
  /** Item id → name, sprite and its page (see above). */
  info: (id: number) => ItemInfo
}

export interface ReadinessDataParts {
  map: BossMapData
  weapons: ReadonlyMap<number, Weapon>
  armor: ReadonlyMap<number, ArmorPiece>
  accessories: ReadonlyMap<number, Accessory>
  sets: ReadonlyMap<string, ArmorSet>
  items: readonly Item[]
  buffs: readonly Buff[]
  conditions: ConditionIndex
  names: ItemNames
}

let cache: { parts: ReadinessDataParts; data: ReadinessPageData } | undefined

/** Builds the page data from loaded parts (memoized on the parts themselves). */
export function assembleReadinessData(parts: ReadinessDataParts): ReadinessPageData {
  if (cache && Object.entries(parts).every(([k, v]) => cache?.parts[k as keyof ReadinessDataParts] === v)) return cache.data
  const { map, weapons, armor, accessories, sets, conditions } = parts
  const items = new Map(parts.items.map((i) => [i.id, i]))
  const stageIndex = (b: Boss) => (STAGE_IDS as readonly string[]).indexOf(b.stage)
  const bosses = [...map.bosses].sort((a, b) => stageIndex(a) - stageIndex(b) || a.name.localeCompare(b.name))
  const engine: ReadinessData = {
    weapons,
    armor,
    accessories,
    sets,
    items,
    buffs: new Map(parts.buffs.map((b) => [b.id, b])),
    bosses: new Map(map.bosses.map((b) => [b.id, b])),
    conditions: conditions.byId,
    graph: map.progression,
    ammoTypeName: ammoTypeLabel,
    gameVersion: meta.gameVersion,
    nameOf: (id) => parts.names.byId.get(id),
  }
  const info = itemResolver({
    names: parts.names,
    weapons: [...weapons.values()].map((w) => ({ ...w, labKind: w.labBehavior.kind })),
    accessories: [...accessories.values()],
    armor: [...armor.values()],
    items: parts.items,
    articles: parts.buffs.map((b) => b.wikiUrl),
  })
  const data: ReadinessPageData = { engine, graph: buildMapGraph(map.progression, map.bosses), sprites: map.sprites, conditions, bosses, info }
  cache = { parts, data }
  return data
}

export async function loadReadinessData(): Promise<ReadinessPageData> {
  const [map, weapons, armor, accessories, sets, items, buffs, conditions, names] = await Promise.all([
    loadBossMapData(),
    loadDetailIndex('weapons'),
    loadArmorDetails(),
    loadAccessoryDetails(),
    loadArmorSets(),
    loadItems(),
    loadBuffs(),
    loadConditionIndex(),
    loadItemNames(),
  ])
  return assembleReadinessData({ map, weapons, armor, accessories, sets, items, buffs, conditions, names })
}

/** Everything already loaded (back navigation renders on the first frame). */
export function peekReadinessData(): ReadinessPageData | undefined {
  const map = peekBossMapData()
  const weapons = peekDetailIndex('weapons')
  const armor = peekArmorDetails()
  const accessories = peekAccessoryDetails()
  const sets = peekArmorSets()
  const items = peekItems()
  const buffs = peekBuffs()
  const conditions = peekConditionIndex()
  const names = peekItemNames()
  if (!map || !weapons || !armor || !accessories || !sets || !items || !buffs || !conditions || !names) return undefined
  return assembleReadinessData({ map, weapons, armor, accessories, sets, items, buffs, conditions, names })
}
