/**
 * Data for the accessory pages (PRD P6-S2). Lazy data chunks, cached for the session by the data-access layer:
 * - list and page: every accessory record (accessories.detail.json, 32 KB gz — the list reads each record's own
 *   `_prov`, so a stage or category shows only where verified; a page's combination tree needs its neighbours)
 *   and the sprite index with its "accessories" manifest part (B104);
 * - below a page's header: the acquisition indexes (recipes + groups + names + item ids — "how to obtain" and the
 *   combination tree read them; drops when it drops; the progression graph for verified gates) and the search docs
 *   (each referenced item's name, sprite and page).
 */
import {
  loadAccessoryDetails,
  loadAcquisitionData,
  loadSearchDocs,
  loadSpriteIndex,
  peekAccessoryDetails,
  peekAcquisitionData,
  peekSearchDocs,
  peekSpriteIndex,
  type AcquisitionData,
  type AcquisitionNeeds,
} from '../../../../data-access'
import type { Accessory, SpriteIndex } from '../../../../data-access/types'
import type { SearchDoc } from '../../../../schemas'
import { getField } from '../../../../schemas/getField'
import { docsByRef } from '../armor/armorData'
import { sortAccessories } from './accessoryModel'

const SPRITE_DIRS = ['accessories'] as const

export interface AccessoryData {
  accessories: ReadonlyMap<number, Accessory>
  /** Every accessory in browse order (by name). */
  list: readonly Accessory[]
  /** null = sprite index unavailable → placeholder art (safe direction for the D3 lever). */
  sprites: SpriteIndex | null
}

let sortedFor: { source: ReadonlyMap<number, Accessory>; list: readonly Accessory[] } | undefined
const listOf = (accessories: ReadonlyMap<number, Accessory>) => {
  if (sortedFor?.source !== accessories) sortedFor = { source: accessories, list: sortAccessories(accessories.values()) }
  return sortedFor.list
}

export async function loadAccessoryData(): Promise<AccessoryData> {
  const [accessories, sprites] = await Promise.all([
    loadAccessoryDetails(),
    loadSpriteIndex(SPRITE_DIRS).catch((error: unknown) => {
      console.warn('[sprites] Manifest unavailable; showing placeholder art.', error)
      return null
    }),
  ])
  return { accessories, list: listOf(accessories), sprites }
}

export function peekAccessoryData(): AccessoryData | undefined {
  const accessories = peekAccessoryDetails()
  return accessories ? { accessories, list: listOf(accessories), sprites: peekSpriteIndex(SPRITE_DIRS) ?? null } : undefined
}

export function accessoryNeeds(a: Accessory): AcquisitionNeeds {
  const gate = getField(a, 'gatedBy')
  return {
    recipes: true,
    drops: a.acquisition.some((r) => r.method === 'drop'),
    gates: gate.status === 'verified' && ((gate.value as Accessory['gatedBy'])?.bosses.length ?? 0) > 0,
  }
}

export interface AccessorySectionsData {
  acquisition: AcquisitionData
  docs: ReadonlyMap<string, SearchDoc>
}

export async function loadAccessorySections(a: Accessory): Promise<AccessorySectionsData> {
  const [acquisition, docs] = await Promise.all([loadAcquisitionData(accessoryNeeds(a)), loadSearchDocs()])
  return { acquisition, docs: docsByRef(docs) }
}

export function peekAccessorySections(a: Accessory): AccessorySectionsData | undefined {
  const acquisition = peekAcquisitionData(accessoryNeeds(a))
  const docs = peekSearchDocs()
  return acquisition && docs ? { acquisition, docs: docsByRef(docs) } : undefined
}
