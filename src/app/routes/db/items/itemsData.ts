/**
 * Data for the item encyclopedia (P6, AMENDMENTS-016). Everything is a lazy data chunk, cached for the
 * session by the data-access layer, so returning to a page renders on its first frame:
 * - /items: the browse list (items.list.json) + the sprite index (rows load the manifest part they draw
 *   from on demand — AMENDMENTS-016 B104).
 * - /items/:id: the record (through items.detail.index.json: only the core file or the ID-range shard
 *   holding it), the part listing its sprite; then, for the sections below the header, the acquisition
 *   indexes (recipes + groups + names + item ids, drops when it drops, the progression graph when gated
 *   or a boss summon), the search docs (every referenced item's name, sprite and page) and the buff
 *   registry (buffs it grants).
 */
import {
  loadAcquisitionData,
  loadBuffs,
  loadItemDetail,
  loadItemList,
  loadSearchDocs,
  loadSpriteIndex,
  peekAcquisitionData,
  peekBuffs,
  peekItemDetail,
  peekItemList,
  peekSearchDocs,
  peekSpriteIndex,
  type AcquisitionData,
  type AcquisitionNeeds,
} from '../../../../data-access'
import type { Buff, Item, ItemListRecord, SpriteIndex } from '../../../../data-access/types'
import type { SearchDoc } from '../../../../schemas'
import { getField } from '../../../../schemas/getField'
import { resolveTarget } from '../../../../search/links'
import type { ItemRefInfo } from '../weapons/AcquisitionView'
import { sortItemsForBrowse } from './itemFilters'

const spritesOrNull = (promise: Promise<SpriteIndex>): Promise<SpriteIndex | null> =>
  promise.catch((error: unknown) => {
    console.warn('[sprites] Manifest unavailable; showing placeholder art.', error)
    return null
  })

// --- /items ----------------------------------------------------------------------------------

export interface ItemListData {
  /** Every Item record, in browse order. */
  list: readonly ItemListRecord[]
  /** null = sprite index unavailable → placeholder art (safe direction for the D3 lever). */
  sprites: SpriteIndex | null
}

let sortedFor: { source: readonly ItemListRecord[]; sorted: readonly ItemListRecord[] } | undefined
const sorted = (list: readonly ItemListRecord[]) => {
  if (sortedFor?.source !== list) sortedFor = { source: list, sorted: sortItemsForBrowse(list) }
  return sortedFor.sorted
}

export async function loadItemListData(): Promise<ItemListData> {
  const [list, sprites] = await Promise.all([loadItemList(), spritesOrNull(loadSpriteIndex())])
  return { list: sorted(list), sprites }
}

export function peekItemListData(): ItemListData | undefined {
  const list = peekItemList()
  return list ? { list: sorted(list), sprites: peekSpriteIndex() ?? null } : undefined
}

// --- /items/:id ------------------------------------------------------------------------------

export interface ItemPageData {
  item: Item
  sprites: SpriteIndex | null
}

export async function loadItemPageData(id: string): Promise<ItemPageData> {
  const [item, sprites] = await Promise.all([loadItemDetail(id), spritesOrNull(loadSpriteIndex())])
  // the part listing its own sprite (the header and the sprite's wiki file page in "Where this data comes from")
  if (item.sprite && sprites?.load) await sprites.load(item.sprite).catch(() => undefined)
  return { item, sprites }
}

export function peekItemPageData(id: string): ItemPageData | undefined {
  const item = peekItemDetail(id)
  const sprites = peekSpriteIndex()
  if (!item || (item.sprite && sprites && !sprites.byPath.has(item.sprite) && sprites.load)) return undefined
  return { item, sprites: sprites ?? null }
}

/** What the sections below the header need (recipes always: "Used in" reads them). */
export function itemNeeds(item: Item): AcquisitionNeeds {
  const gate = getField(item, 'gatedBy')
  return {
    recipes: true,
    drops: item.acquisition.some((a) => a.method === 'drop'),
    gates: (gate.status === 'verified' && ((gate.value as Item['gatedBy'])?.bosses.length ?? 0) > 0) || item.summonsBossNode !== undefined,
  }
}

export interface ItemSectionsData {
  acquisition: AcquisitionData
  /** Every searchable entity by ref ("i:22", "boss:plantera"): names, sprites and pages of referenced items. */
  docs: ReadonlyMap<string, SearchDoc>
  buffs: ReadonlyMap<string, Buff>
}

let docsFor: { source: readonly SearchDoc[]; byRef: ReadonlyMap<string, SearchDoc> } | undefined
const docsByRef = (docs: readonly SearchDoc[]) => {
  if (docsFor?.source !== docs) docsFor = { source: docs, byRef: new Map(docs.map((d) => [d.id, d])) }
  return docsFor.byRef
}
let buffsFor: { source: readonly Buff[]; byId: ReadonlyMap<string, Buff> } | undefined
const buffsById = (buffs: readonly Buff[]) => {
  if (buffsFor?.source !== buffs) buffsFor = { source: buffs, byId: new Map(buffs.map((b) => [b.id, b])) }
  return buffsFor.byId
}

export async function loadItemSections(item: Item): Promise<ItemSectionsData> {
  const [acquisition, docs, buffs] = await Promise.all([loadAcquisitionData(itemNeeds(item)), loadSearchDocs(), loadBuffs()])
  return { acquisition, docs: docsByRef(docs), buffs: buffsById(buffs) }
}

export function peekItemSections(item: Item): ItemSectionsData | undefined {
  const acquisition = peekAcquisitionData(itemNeeds(item))
  const docs = peekSearchDocs()
  const buffs = peekBuffs()
  return acquisition && docs && buffs ? { acquisition, docs: docsByRef(docs), buffs: buffsById(buffs) } : undefined
}

/** A referenced item's sprite and page, from its search doc (weapon / item / armor / accessory → in-app, B131(b); anything else → its wiki article). */
export function refInfoFrom(docs: ReadonlyMap<string, SearchDoc>): (itemId: number) => ItemRefInfo | undefined {
  return (itemId) => {
    const doc = docs.get(`i:${itemId}`)
    if (!doc) return undefined
    return { ...(doc.sprite ? { sprite: doc.sprite } : {}), ...(doc.class ? { damageClass: doc.class } : {}), link: resolveTarget(doc) }
  }
}
