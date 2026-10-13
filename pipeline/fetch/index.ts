/**
 * Fetch stage (DATA_SCHEMA_SPEC §7c): SyncPlan → raw cache. The same plan runs ONLINE from
 * `npm run pipeline:fetch` and OFFLINE (cache-only, zero network) from the build stage, so
 * parse never sees anything that was not fetched and cached under the D2 etiquette.
 *
 * Plan (P2-S2a): Module:Iteminfo/data · Module:RecipeGroups + Module:Recipes +
 * Module:Recipes/l10n (one request) · existence of every curated overlay source page ·
 * Cargo Recipes, Drops, NPCs (fields, COUNT(*), all pages).
 */
import { loadConditionsOverlay } from '../merge/overlays'
import { cargoFields, cargoQueryAll, type CargoTableFetch } from './cargo'
import type { WikiClient } from './client'
import { fetchIteminfo, type IteminfoFetch } from './iteminfo'
import { checkPagesExist, fetchRecipeModules, type ModuleFetch, RECIPE_MODULE_TITLES } from './modules'

/** Cargo tables consumed by P2-S2a. All columns are fetched (raw cache = full fidelity). */
export const SYNC_TABLES = ['Recipes', 'Drops', 'NPCs'] as const
export type SyncTable = (typeof SYNC_TABLES)[number]

export interface SyncResult {
  iteminfo: IteminfoFetch
  modules: Record<(typeof RECIPE_MODULE_TITLES)[number], ModuleFetch>
  overlayPages: Map<string, { exists: boolean; resolvedTitle: string }>
  tables: Record<SyncTable, CargoTableFetch>
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
  return { iteminfo, modules, overlayPages, tables }
}

export { WikiClient, FetchError } from './client'
export { RAW_DIR } from './config'
