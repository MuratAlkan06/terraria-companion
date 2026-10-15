/**
 * Module:Iteminfo/data → canonical item-ID universe (ADR-001 D2 source #1).
 *
 * Verified module shape (rev 1023241): `return { ["data"] = [=====[<json>]=====],
 * ["nameDB"] = [=====[<json>]=====] }` — luaparse reads the Lua table; both long strings are
 * JSON. `data["0"]` holds the default stat values, every other numeric key is an item whose
 * object lists only the stats that differ from the defaults (so full stats = defaults ∪ item),
 * plus `_generated` / `_terrariaversion` metadata. `nameDB` holds the wiki's own lookup tables
 * (itemIdFromName, itemNameFromId, itemInternalNameFromId, itemIdFromInternalName).
 *
 * P2-S2a needs ids + names (reference resolution); the numeric stat fields are parsed here and
 * kept on each record for P2-S2's full stat mapping.
 */
import type { IteminfoFetch } from '../fetch/iteminfo'
import { LuaParseError, parseLua, returnedValue } from './lua'

export interface IteminfoItem {
  id: number
  internalName: string
  /** In-game English display name; absent for the few unnamed (unused) IDs. */
  name?: string
  /** Defaults ∪ overrides — every stat the module records for this item. */
  stats: Readonly<Record<string, unknown>>
}

export interface Iteminfo {
  rev: number
  revTimestamp: string
  fetchedAt: string
  generated: string
  terrariaVersion: string
  items: Map<number, IteminfoItem>
  /** Display name → every item ID carrying that exact name (duplicates are real: e.g. "Seaweed"). */
  idsByName: Map<string, number[]>
  /** The wiki's own name→ID choice (`nameDB.itemIdFromName`), used for duplicate display names. */
  wikiIdFromName: Map<string, number>
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function parseIteminfo(fetched: IteminfoFetch): Iteminfo {
  const label = fetched.title
  const top = returnedValue(parseLua(fetched.content, label), label)
  if (!isRecord(top) || typeof top.data !== 'string' || typeof top.nameDB !== 'string') {
    throw new LuaParseError(`${label}: expected { data = <json string>, nameDB = <json string> }`)
  }
  let data: unknown
  let nameDB: unknown
  try {
    data = JSON.parse(top.data)
    nameDB = JSON.parse(top.nameDB)
  } catch (cause) {
    throw new LuaParseError(`${label}: embedded JSON did not parse (${(cause as Error).message})`)
  }
  if (!isRecord(data) || !isRecord(data['0']) || !isRecord(nameDB) || !isRecord(nameDB.itemIdFromName)) {
    throw new LuaParseError(`${label}: unexpected data/nameDB structure`)
  }
  const defaults = data['0']
  const items = new Map<number, IteminfoItem>()
  const idsByName = new Map<string, number[]>()
  for (const [key, value] of Object.entries(data)) {
    if (!/^\d+$/.test(key) || key === '0' || !isRecord(value)) continue
    const id = Number(key)
    const internalName = value.internalName
    if (typeof internalName !== 'string' || internalName.length === 0) throw new LuaParseError(`${label}: item ${id} has no internalName`)
    const name = typeof value.name === 'string' && value.name.length > 0 ? value.name : undefined
    items.set(id, { id, internalName, ...(name ? { name } : {}), stats: { ...defaults, ...value } })
    if (name) idsByName.set(name, [...(idsByName.get(name) ?? []), id])
  }
  const wikiIdFromName = new Map<string, number>()
  for (const [name, id] of Object.entries(nameDB.itemIdFromName)) {
    const n = Number(id)
    if (Number.isInteger(n) && items.has(n)) wikiIdFromName.set(name, n)
  }
  return {
    rev: fetched.rev,
    revTimestamp: fetched.revTimestamp,
    fetchedAt: fetched.fetchedAt,
    generated: String(data._generated ?? ''),
    terrariaVersion: String(data._terrariaversion ?? ''),
    items,
    idsByName,
    wikiIdFromName,
  }
}

export type NameResolution =
  | { ok: true; id: number; ambiguous?: number[]; normalized?: string }
  | { ok: false; reason: string }

/** Wiki page disambiguators that name the item itself ("Shadow Orb (item)", "Blue Jellyfish (bait)"). */
const ITEM_DISAMBIGUATOR = /^(.*) \((?:item|bait)\)$/

/**
 * Item display name (as used in Cargo Recipes/Drops) → item ID.
 * - exact unique Iteminfo name → that ID;
 * - duplicate display name → the wiki's own nameDB.itemIdFromName choice, reported as `ambiguous`;
 * - "<name> (item)" / "<name> (bait)" page disambiguators → retried without the suffix;
 * - otherwise unresolved (caller excludes the row and records a gap — never guessed).
 */
export function resolveItemName(info: Iteminfo, rawName: string): NameResolution {
  const name = rawName.trim()
  const ids = info.idsByName.get(name)
  if (ids && ids.length === 1) return { ok: true, id: ids[0] }
  if (ids && ids.length > 1) {
    const chosen = info.wikiIdFromName.get(name)
    return chosen !== undefined ? { ok: true, id: chosen, ambiguous: ids } : { ok: false, reason: `ambiguous item name "${name}" (ids ${ids.join(', ')})` }
  }
  const m = ITEM_DISAMBIGUATOR.exec(name)
  if (m) {
    const inner = resolveItemName(info, m[1])
    return inner.ok ? { ...inner, normalized: m[1] } : inner
  }
  return { ok: false, reason: `"${name}" is not an item name in Module:Iteminfo/data (rev ${info.rev})` }
}
