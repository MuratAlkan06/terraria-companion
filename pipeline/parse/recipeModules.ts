/**
 * Recipe-related wiki Lua modules (TO-VERIFY-IN-P2 #2 resolution, verified 2026-10-13):
 *
 * - Cargo Recipes encodes a group ingredient as the plain English group name in
 *   `ingredients`/`ings`/`args` (e.g. `¦Any Iron Bar¦` / `Any Iron Bar¦2`); member lists are
 *   NOT in Cargo.
 * - Module:Recipes `initItemGroups()` defines those names: `group('Any Iron Bar', {'Iron Bar',
 *   'Lead Bar'})` — the table the {{recipes}} template uses. PRIMARY source for groups.
 * - Module:RecipeGroups transcribes the game's `Recipe.SetupRecipeGroups` (header: v1.4.5.4)
 *   as `newRecipeGroup(internalName, descriptorKey, {itemIds})`. Used to CROSS-CHECK member IDs.
 * - Module:Recipes/l10n `en.station_cate` maps a station to the wiki's station category
 *   ("Iron Anvil" → "Iron or Lead Anvil") — the wiki-documented station alternatives used for
 *   AMENDMENTS-002 B3 station groups — and `en.result_note` holds the text of recipe notes
 *   (`#note_post_moon_lord` → "(After [[Moon Lord]] is defeated)").
 */
import type { Expression } from 'luaparse'
import { findCalls, LuaParseError, luaValue, parseLua, returnedValue } from './lua'

export interface ModuleRevision {
  title: string
  rev: number
  revTimestamp: string
  content: string
}

export interface GameRecipeGroup {
  internalName: string
  descriptorKey: string
  itemIds: number[]
}

export interface WikiRecipeGroup {
  name: string // e.g. "Any Iron Bar"
  memberNames: string[]
}

export interface RecipesL10n {
  stationCate: Record<string, string>
  resultNotes: Record<string, string>
}

const asStrings = (v: unknown, label: string): string[] => {
  if (!Array.isArray(v) || !v.every((s) => typeof s === 'string')) throw new LuaParseError(`${label}: expected a list of strings`)
  return v
}

const args = (call: Expression[], n: number, label: string) => {
  if (call.length !== n) throw new LuaParseError(`${label}: expected ${n} call arguments, got ${call.length}`)
  return call.map((a) => luaValue(a, label))
}

export function parseGameRecipeGroups(mod: ModuleRevision): GameRecipeGroup[] {
  const calls = findCalls(parseLua(mod.content, mod.title), 'newRecipeGroup').filter((c) => c.length === 3 && c[0].type === 'StringLiteral')
  if (calls.length === 0) throw new LuaParseError(`${mod.title}: no newRecipeGroup(...) data calls found`)
  return calls.map((call) => {
    const [internalName, descriptorKey, ids] = args(call, 3, mod.title)
    if (typeof internalName !== 'string' || typeof descriptorKey !== 'string' || !Array.isArray(ids) || !ids.every((i) => Number.isInteger(i))) {
      throw new LuaParseError(`${mod.title}: unexpected newRecipeGroup arguments`)
    }
    return { internalName, descriptorKey, itemIds: ids as number[] }
  })
}

export function parseWikiRecipeGroups(mod: ModuleRevision): WikiRecipeGroup[] {
  const calls = findCalls(parseLua(mod.content, mod.title), 'group').filter((c) => c.length === 2 && c[0].type === 'StringLiteral')
  if (calls.length === 0) throw new LuaParseError(`${mod.title}: no group(...) definitions found`)
  return calls.map((call) => {
    const [name, members] = args(call, 2, mod.title)
    if (typeof name !== 'string') throw new LuaParseError(`${mod.title}: group name is not a string`)
    return { name, memberNames: asStrings(members, `${mod.title} group "${name}"`) }
  })
}

export function parseRecipesL10n(mod: ModuleRevision): RecipesL10n {
  const top = returnedValue(parseLua(mod.content, mod.title), mod.title)
  const en = (top as Record<string, unknown>)?.en as Record<string, unknown> | undefined
  const stationCate = en?.station_cate
  const resultNotes = en?.result_note
  const isStringMap = (v: unknown): v is Record<string, string> =>
    typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every((s) => typeof s === 'string')
  if (!isStringMap(stationCate) || !isStringMap(resultNotes)) throw new LuaParseError(`${mod.title}: en.station_cate / en.result_note missing or not string maps`)
  return { stationCate, resultNotes }
}
