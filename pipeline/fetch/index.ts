/**
 * Fetch stage (DATA_SCHEMA_SPEC §7c): SyncPlan → raw cache. The same plan runs ONLINE from
 * `npm run pipeline:fetch` and OFFLINE (cache-only, zero network) from the build stage, so
 * parse never sees anything that was not fetched and cached under the D2 etiquette.
 *
 * Plan (P2-S2a): Module:Iteminfo/data · Module:RecipeGroups + Module:Recipes +
 * Module:Recipes/l10n (one request) · existence of every curated overlay source page ·
 * Cargo Recipes, Drops, NPCs (fields, COUNT(*), all pages).
 * Plan (P2-S2): + Cargo Items and Weapon_source · the weapon category tree and the
 * existence/redirect status of its member pages (count reconciliation) · imageinfo for the
 * weapon infobox images (sprite manifest). Sprite binaries are NOT part of this plan
 * (AMENDMENTS-001 A10: local-only `npm run pipeline:sprites`).
 */
import { loadConditionsOverlay } from '../merge/overlays'
import { cargoFields, cargoQueryAll, itemTypeIncludes, type CargoTableFetch } from './cargo'
import { type CategoryTree, fetchCategoryTree } from './categories'
import type { WikiClient } from './client'
import { fetchImageInfo, type ImageInfoFetch } from './images'
import { fetchIteminfo, type IteminfoFetch } from './iteminfo'
import { checkPagesExist, fetchRecipeModules, type ModuleFetch, RECIPE_MODULE_TITLES } from './modules'

/** Cargo tables consumed by the pipeline. All columns are fetched (raw cache = full fidelity). */
export const SYNC_TABLES = ['Recipes', 'Drops', 'NPCs', 'Items', 'Weapon_source'] as const
export type SyncTable = (typeof SYNC_TABLES)[number]

/**
 * Roots of the wiki's weapon category tree (verified 2026-10-13 via prop=categoryinfo:
 * "Weapon items" 600 pages + 2 subcats; "Weapon types" 5 subcats = the per-class trees).
 */
export const WEAPON_CATEGORY_ROOTS = ['Category:Weapon items', 'Category:Weapon types'] as const

export interface SyncResult {
  iteminfo: IteminfoFetch
  modules: Record<(typeof RECIPE_MODULE_TITLES)[number], ModuleFetch>
  overlayPages: Map<string, { exists: boolean; resolvedTitle: string }>
  tables: Record<SyncTable, CargoTableFetch>
  /** Weapon category tree + each member page's existence / redirect target (reconciliation). */
  weaponCategories: CategoryTree & { pageStatus: Map<string, { exists: boolean; resolvedTitle: string }> }
  /** Image metadata for the infobox image (`imagefile`) of every Cargo Items row typed "weapon". */
  weaponImages: ImageInfoFetch
}

export async function runSyncPlan(client: WikiClient, log?: (line: string) => void): Promise<SyncResult> {
  log?.('Module:Iteminfo/data')
  const iteminfo = await fetchIteminfo(client)
  log?.(RECIPE_MODULE_TITLES.join(', '))
  const modules = await fetchRecipeModules(client)
  log?.('overlay source pages (existence check)')
  const overlayPages = await checkPagesExist(client, loadConditionsOverlay().entries.map((e) => e.wikiTitle), 'pages/conditions-overlay')
  const tables = {} as Record<SyncTable, CargoTableFetch>
  for (const table of SYNC_TABLES) {
    log?.(`Cargo ${table}`)
    const fields = await cargoFields(client, table)
    tables[table] = await cargoQueryAll(client, table, Object.keys(fields), fields, log)
  }
  log?.(`category tree ${WEAPON_CATEGORY_ROOTS.join(', ')}`)
  const weaponCategories = await fetchCategoryTree(client, WEAPON_CATEGORY_ROOTS)
  log?.('weapon category pages (existence / redirects)')
  const weaponCategoryPages = await checkPagesExist(client, weaponCategories.pages, 'pages/weapon-categories')
  log?.('weapon image metadata (imageinfo)')
  const weaponImageFiles = tables.Items.rows.filter((r) => itemTypeIncludes(r, 'weapon')).map((r) => String(r.imagefile ?? ''))
  const weaponImages = await fetchImageInfo(client, weaponImageFiles, 'images/weapons')
  return { iteminfo, modules, overlayPages, tables, weaponCategories: { ...weaponCategories, pageStatus: weaponCategoryPages }, weaponImages }
}

export { WikiClient, FetchError } from './client'
export { RAW_DIR } from './config'
