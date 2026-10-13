/**
 * Cargo Recipes + recipe modules + Iteminfo → Recipe[] and RecipeGroup[] (P2-S2a).
 *
 * Row filter (desktop only, TO-VERIFY verified 2026-10-13): `legacy = 1` rows are old-gen /
 * 3DS registrations (pages "Legacy:Recipes/…") and are dropped; a current row applies to
 * desktop when `version` is empty (= all versions) or contains "desktop".
 *
 * Mapping (documented in the dataset manifest):
 * - result: `resultid` (Cargo) must be an Iteminfo ID whose name matches `result`; else the
 *   row is excluded (source-mismatch gap).
 * - ingredients: Cargo `ings` (`¦Name¦amount^…`, normalized by Module:Recipes). "Any X" names →
 *   RecipeGroup `any-x` from Module:Recipes; other names → Iteminfo IDs (resolveItemName).
 * - stations: `station` split on " and "; each part is (in order) an environment condition from
 *   the curated registry ("Ecto Mist", "Water", "Shimmer"…), a B3 station group when
 *   Module:Recipes/l10n `en.station_cate` names ≥2 interchangeable station items for it
 *   ("Iron Anvil" → "Iron or Lead Anvil"), else a single station item; "By Hand" = [].
 * - result notes (`resulttext` "#note_…", texts in l10n `en.result_note`) are availability
 *   conditions ("After Moon Lord is defeated", moon phases). The Recipe schema has no
 *   conditions field, so they are emitted as `environment` stations referencing the condition.
 * - Anything unresolvable → the row is NOT emitted and a gap entry names the reason.
 */
import { type GapEntry, type ProvSource, type Recipe, type RecipeGroup, type RecipeStation } from '../../src/schemas'
import type { CargoRow } from '../fetch/cargo'
import { wikiPageUrl } from '../fetch/config'
import type { Iteminfo } from '../parse/iteminfo'
import { resolveItemName } from '../parse/iteminfo'
import type { GameRecipeGroup, RecipesL10n, WikiRecipeGroup } from '../parse/recipeModules'
import { fnv1a32hex, slugify, stripMarkup } from '../parse/text'
import type { ConditionMatchers } from './overlays'
import { GapLog, isoDate, makeProv, moduleSource, type ModuleRev } from './prov'

export interface RecipeBuildInput {
  rows: readonly CargoRow[]
  fetchedAt: string
  iteminfo: Iteminfo
  modules: { recipes: ModuleRev; recipeGroups: ModuleRev; l10n: ModuleRev }
  wikiGroups: readonly WikiRecipeGroup[]
  gameGroups: readonly GameRecipeGroup[]
  l10n: RecipesL10n
  conditions: ConditionMatchers
}

export interface RecipeLedger {
  cargoRows: number
  legacyRows: number
  nonDesktopRows: number
  duplicateRows: number
  excludedRows: number
  emitted: number
  byStation: Record<string, number>
  /** AMENDMENTS-003 B9 debt: emitted recipes whose result note is still an environment station. */
  availabilityNoteStations: number
}

export interface RecipeBuild {
  recipes: Recipe[]
  groups: RecipeGroup[]
  gaps: GapEntry[]
  ledger: RecipeLedger
  /** Name references resolved through the wiki's own duplicate-name choice (nameDB). */
  ambiguousNames: Map<string, number[]>
}

const str = (v: CargoRow[string]) => (v === null || v === undefined ? '' : String(v))

type Resolved<T> = { ok: true; value: T } | { ok: false; reason: string }

interface GroupCandidate {
  group: RecipeGroup
  /** Cross-check finding, reported only if the group is emitted. */
  gap?: GapEntry
}

export function buildRecipes(input: RecipeBuildInput): RecipeBuild {
  const { iteminfo } = input
  const gaps = new GapLog()
  const ambiguousNames = new Map<string, number[]>()
  const fetchedAt = isoDate(input.fetchedAt)
  const iteminfoSrc = moduleSource('iteminfo', { title: 'Module:Iteminfo/data', rev: iteminfo.rev, fetchedAt: iteminfo.fetchedAt })
  const recipesModuleSrc = moduleSource('wiki-module', input.modules.recipes)
  const groupsModuleSrc = moduleSource('wiki-module', input.modules.recipeGroups)
  const l10nSrc = moduleSource('wiki-module', input.modules.l10n)

  const itemByName = (name: string): Resolved<number> => {
    const r = resolveItemName(iteminfo, name)
    if (!r.ok) return { ok: false, reason: r.reason }
    if (r.ambiguous) ambiguousNames.set(r.normalized ?? name, r.ambiguous)
    return { ok: true, value: r.id }
  }

  // ---- ingredient groups (Module:Recipes), cross-checked against Module:RecipeGroups ----
  const ingredientGroups = new Map<string, Resolved<GroupCandidate>>()
  const gameSets = input.gameGroups.map((g) => ({ g, ids: new Set(g.itemIds) }))
  for (const wg of input.wikiGroups) {
    const ids: number[] = []
    let failure: string | undefined
    for (const member of wg.memberNames) {
      const r = itemByName(member)
      if (!r.ok) failure ??= `member ${r.reason}`
      else if (!ids.includes(r.value)) ids.push(r.value)
    }
    if (failure || ids.length < 2) {
      ingredientGroups.set(wg.name, { ok: false, reason: `group "${wg.name}" (Module:Recipes) does not resolve: ${failure ?? 'fewer than 2 distinct members'}` })
      continue
    }
    const idSet = new Set(ids)
    const best = gameSets
      .map(({ g, ids: gIds }) => ({ g, overlap: [...gIds].filter((id) => idSet.has(id)).length, equal: gIds.size === idSet.size && [...gIds].every((id) => idSet.has(id)) }))
      .sort((a, b) => Number(b.equal) - Number(a.equal) || b.overlap - a.overlap)[0]
    const sources: ProvSource[] = [recipesModuleSrc, iteminfoSrc]
    let gap: GapEntry | undefined
    const ref = `grp:${slugify(wg.name)}`
    const gapSources = [recipesModuleSrc.url, groupsModuleSrc.url]
    if (best?.equal) {
      sources.push(groupsModuleSrc)
    } else if (best && best.overlap > 0) {
      gap = {
        ref,
        field: 'memberItemIds',
        kind: 'source-mismatch',
        detail: `Module:Recipes lists [${ids.join(', ')}] for "${wg.name}" but the closest game recipe group in Module:RecipeGroups (${best.g.internalName}) lists [${best.g.itemIds.join(', ')}]; emitted from Module:Recipes (what the wiki's recipes reference), marked unverified.`,
        sources: gapSources,
      }
    } else {
      gap = {
        ref,
        field: 'memberItemIds',
        kind: 'source-mismatch',
        detail: `"${wg.name}" is defined in Module:Recipes but has no counterpart in Module:RecipeGroups (a transcription of the game's SetupRecipeGroups from 1.4.5.4); members could not be cross-checked, marked unverified.`,
        sources: gapSources,
      }
    }
    ingredientGroups.set(wg.name, {
      ok: true,
      value: { group: { id: slugify(wg.name), name: wg.name, memberItemIds: ids, _prov: makeProv(sources, [], gap !== undefined) }, gap },
    })
  }

  // ---- B3 station groups (Module:Recipes/l10n en.station_cate) ----
  const cateMembers = new Map<string, string[]>()
  for (const [station, cate] of Object.entries(input.l10n.stationCate)) {
    if (station.includes(' and ')) continue
    cateMembers.set(cate, [...(cateMembers.get(cate) ?? []), station])
  }
  const stationGroups = new Map<string, GroupCandidate>()
  const groupsById = new Map<string, RecipeGroup>()
  const stationGroupFor = (token: string): GroupCandidate | undefined => {
    const cate = input.l10n.stationCate[token]
    if (!cate) return undefined
    if (stationGroups.has(cate)) return stationGroups.get(cate)
    const ids: number[] = []
    for (const member of cateMembers.get(cate) ?? []) {
      if (input.conditions.station.has(member)) return undefined // environment alternatives (Water…) are conditions
      const r = resolveItemName(iteminfo, member)
      if (r.ok && !ids.includes(r.id)) ids.push(r.id)
    }
    if (ids.length < 2) return undefined
    const group: RecipeGroup = { id: slugify(cate), name: cate, memberItemIds: ids, _prov: makeProv([l10nSrc, iteminfoSrc]) }
    stationGroups.set(cate, { group })
    groupsById.set(group.id, group)
    return { group }
  }
  const groupGaps = new Map<string, GapEntry>()
  for (const g of ingredientGroups.values()) {
    if (!g.ok) continue
    groupsById.set(g.value.group.id, g.value.group)
    if (g.value.gap) groupGaps.set(g.value.group.id, g.value.gap)
  }

  const stationFor = (token: string): Resolved<RecipeStation> => {
    const env = input.conditions.station.get(token)
    if (env) return { ok: true, value: { kind: 'environment', condition: env.id, name: env.name } }
    const group = stationGroupFor(token)
    if (group) return { ok: true, value: { kind: 'group', groupId: group.group.id } }
    const item = itemByName(token)
    if (item.ok) return { ok: true, value: { kind: 'item', itemId: item.value } }
    return { ok: false, reason: `station part "${token}" is not an item, station group or registered condition (${item.reason})` }
  }

  // ---- rows ----
  const ledger: RecipeLedger = { cargoRows: input.rows.length, legacyRows: 0, nonDesktopRows: 0, duplicateRows: 0, excludedRows: 0, emitted: 0, byStation: {}, availabilityNoteStations: 0 }
  const recipes = new Map<string, Recipe>()
  const usedGroups = new Map<string, RecipeGroup>()

  for (const row of input.rows) {
    if (str(row.legacy) === '1') {
      ledger.legacyRows += 1
      continue
    }
    const version = str(row.version).toLowerCase()
    if (version !== '' && !version.includes('desktop')) {
      ledger.nonDesktopRows += 1
      continue
    }
    const rowRef = `rcp:cargo-row-${str(row._rowid)}`
    const result = stripMarkup(str(row.result))
    const pageUrl = wikiPageUrl(result || str(row._page))
    const exclude = (field: string, kind: GapEntry['kind'], reason: string) => {
      ledger.excludedRows += 1
      gaps.add({ ref: rowRef, field, kind, detail: `Cargo Recipes row ${str(row._rowid)} (${str(row._page)}, result "${result}") not emitted: ${reason}`, sources: [pageUrl] })
    }

    // result
    const resultId = Number(str(row.resultid))
    const resultInfo = iteminfo.items.get(resultId)
    if (!Number.isInteger(resultId) || !resultInfo) {
      exclude('resultItemId', 'source-mismatch', `resultid "${str(row.resultid)}" is not an item ID in Module:Iteminfo/data`)
      continue
    }
    const byName = resolveItemName(iteminfo, result)
    if (resultInfo.name !== result && !(byName.ok && byName.id === resultId)) {
      exclude('resultItemId', 'source-mismatch', `resultid ${resultId} is "${resultInfo.name ?? resultInfo.internalName}" in Module:Iteminfo/data, not "${result}"`)
      continue
    }
    const amount = Number(str(row.amount))
    if (!Number.isInteger(amount) || amount < 1) {
      exclude('resultAmount', 'count-reconciliation', `amount "${str(row.amount)}" is not a positive integer`)
      continue
    }

    // stations (+ result notes as condition stations)
    const stationText = stripMarkup(str(row.station))
    const stations: RecipeStation[] = []
    let failed: string | undefined
    if (stationText !== '' && stationText !== 'By Hand') {
      for (const part of stationText.split(' and ').map((s) => s.trim())) {
        const s = stationFor(part)
        if (!s.ok) failed ??= s.reason
        else stations.push(s.value)
      }
    }
    const note = str(row.resulttext).trim()
    if (note !== '') {
      const cond = input.conditions.recipeNote.get(note)
      if (!cond) failed ??= `result note "${note}" (${stripMarkup(input.l10n.resultNotes[note] ?? 'no l10n text')}) maps to no registered condition`
      else stations.push({ kind: 'environment', condition: cond.id, name: cond.name })
    }
    if (failed) {
      exclude('stations', 'count-reconciliation', failed)
      continue
    }

    // ingredients
    const ingredients: Recipe['ingredients'] = []
    for (const entry of str(row.ings).split('^').filter((e) => e !== '')) {
      const parts = entry.split('¦')
      const amountText = parts.pop() ?? ''
      const names = parts.map((p) => stripMarkup(p)).filter((p) => p !== '')
      const qty = Number(amountText)
      if (!Number.isInteger(qty) || qty < 1) {
        failed ??= `ingredient amount "${amountText}" is not a positive integer`
        continue
      }
      if (names.length !== 1) {
        failed ??= `inline ingredient alternatives "${names.join(' / ')}" have no matching recipe group`
        continue
      }
      const name = names[0]
      if (name.startsWith('Any ')) {
        const g = ingredientGroups.get(name)
        if (!g) failed ??= `group ingredient "${name}" is not defined in Module:Recipes`
        else if (!g.ok) failed ??= g.reason
        else ingredients.push({ amount: qty, ref: { kind: 'group', groupId: g.value.group.id } })
        continue
      }
      const item = itemByName(name)
      if (!item.ok) failed ??= `ingredient ${item.reason}`
      else ingredients.push({ amount: qty, ref: { kind: 'item', itemId: item.value } })
    }
    if (failed || ingredients.length === 0) {
      exclude('ingredients', 'count-reconciliation', failed ?? 'no ingredients')
      continue
    }
    // id (§3; canonicalization reproduces the P2-S1 sample ids)
    const stationRef = (s: RecipeStation) => (s.kind === 'item' ? `i:${s.itemId}` : s.kind === 'group' ? `grp:${s.groupId}` : `cond:${s.condition}`)
    const ingRef = (i: Recipe['ingredients'][number]) => `${i.ref.kind === 'item' ? `i:${i.ref.itemId}` : `grp:${i.ref.groupId}`}*${i.amount}`
    const canonical = JSON.stringify({ s: stations.map(stationRef).sort(), i: ingredients.map(ingRef).sort() })
    const baseId = `${resultId}-${fnv1a32hex(canonical)}`
    const existing = recipes.get(baseId)
    if (existing && existing.resultAmount === amount) {
      ledger.duplicateRows += 1
      continue
    }
    let id = baseId
    for (let n = 2; recipes.has(id); n += 1) id = `${baseId}-${n}`

    const sources: ProvSource[] = [{ kind: 'cargo:Recipes', url: pageUrl, fetchedAt }, iteminfoSrc]
    recipes.set(id, { id, resultItemId: resultId, resultAmount: amount, stations, ingredients, _prov: makeProv(sources) })
    for (const groupId of [...stations.flatMap((s) => (s.kind === 'group' ? [s.groupId] : [])), ...ingredients.flatMap((i) => (i.ref.kind === 'group' ? [i.ref.groupId] : []))]) {
      const group = groupsById.get(groupId)
      if (group) usedGroups.set(groupId, group)
    }
    ledger.emitted += 1
    if (note !== '') ledger.availabilityNoteStations += 1
    ledger.byStation[stationText || 'By Hand'] = (ledger.byStation[stationText || 'By Hand'] ?? 0) + 1
  }

  const recipeList = [...recipes.values()].sort((a, b) => a.resultItemId - b.resultItemId || a.id.localeCompare(b.id))
  const groups = [...usedGroups.values()].sort((a, b) => a.id.localeCompare(b.id))
  for (const g of groups) {
    const gap = groupGaps.get(g.id)
    if (gap) gaps.add(gap)
  }
  return { recipes: recipeList, groups, gaps: gaps.entries, ledger, ambiguousNames }
}
