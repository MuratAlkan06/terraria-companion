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
 * Plan (P2-S6): + every article the bosses / progression / withheld overlays cite (rendered text +
 * revision id: the build checks each curated quote against it) · imageinfo for the infobox images
 * of the registry bosses' Cargo NPCs rows.
 * Plan (P2-S7): + Module:Projectileinfo/data (velocity-multiplier cross-check) · the Category:Ammunition
 * items tree and its pages' existence (count reconciliation) · imageinfo for the ammunition rows'
 * infobox images · the article of every ammunition row (`_page`: per-item infobox, Velocity
 * Multiplier) · the "Buff IDs" article (game buff ID table) and the article of every buff the
 * registry may contain (debuffs inflicted by weapon/ammo rows, ammo-granted buffs, overlays/buffs.json).
 * Plan (P3-S0): + the article of every weapon row in the Weapon Lab family categories (merge/labParams.ts
 * FAMILY_CATEGORIES: the article screen + overlay evidence), the mechanics articles its rules quote
 * (Use Style IDs, Broadswords, Velocity; + Use time for the B48 reuse-delay rule) and every page the
 * lab-params overlay cites.
 * Plan (P2-S8): + Cargo Equipinfo (the wiki's machine transcription of each equipable item's UpdateEquip
 * effects — cross-check of tooltip-derived stat effects; 184 columns → compact field list) · the
 * Category:Armor items and Category:Accessory items trees and their pages' existence (count
 * reconciliation) · imageinfo for the armor-piece and functional-accessory rows' infobox images · the
 * article of every armor SET row (`_page`: the set infobox "Set Bonus" row, per-helmet variants) and
 * the "Wings" article (the wing list table: flight time, hover) · every page the armor-sets overlay cites.
 */
import { buffArticleTitles, BUFF_IDS_PAGE, cargoBuffNames } from '../merge/buffs'
import { bossImageFiles } from '../merge/bosses'
import { accessoryRows, armorPieceRows, armorSetPages, WINGS_PAGE } from '../merge/equipment'
import { LAB_RULE_PAGES, labFamilyPages } from '../merge/labParams'
import {
  armorSetEvidencePages,
  evidencePages,
  labEvidencePages,
  loadArmorSetsOverlay,
  loadBossesOverlay,
  loadBuffsOverlay,
  loadConditionsOverlay,
  loadLabParamsOverlay,
  loadProgressionOverlay,
  loadWithheldOverlay,
} from '../merge/overlays'
import { parseBuffIdTable } from '../parse/infobox'
import { parseIteminfo } from '../parse/iteminfo'
import { type Article, fetchArticles } from './articles'
import { cargoFields, cargoQueryAll, itemTypeIncludes, type CargoTableFetch } from './cargo'
import { type CategoryTree, fetchCategoryTree } from './categories'
import type { WikiClient } from './client'
import { FetchError } from './client'
import { fetchImageInfo, type ImageInfoFetch } from './images'
import { fetchIteminfo, type IteminfoFetch } from './iteminfo'
import { checkPagesExist, fetchModuleRevision, fetchRecipeModules, type ModuleFetch, RECIPE_MODULE_TITLES } from './modules'

/** Cargo tables consumed by the pipeline. All columns are fetched (raw cache = full fidelity). */
export const SYNC_TABLES = ['Recipes', 'Drops', 'NPCs', 'Items', 'Weapon_source'] as const
export type SyncTable = (typeof SYNC_TABLES)[number]

/**
 * Roots of the wiki's weapon category tree (verified 2026-10-13 via prop=categoryinfo:
 * "Weapon items" 600 pages + 2 subcats; "Weapon types" 5 subcats = the per-class trees).
 */
export const WEAPON_CATEGORY_ROOTS = ['Category:Weapon items', 'Category:Weapon types'] as const

/** Root of the wiki's ammunition category tree (verified 2026-10-13: 77 pages + 7 family subcats). */
export const AMMO_CATEGORY_ROOTS = ['Category:Ammunition items'] as const

/** P2-S8 reconciliation trees (verified 2026-10-13 via prop=categoryinfo: Armor items 97 pages + 1 subcat; Accessory items 520 pages + 1 subcat "Shield items"). */
export const ARMOR_CATEGORY_ROOTS = ['Category:Armor items'] as const
export const ACCESSORY_CATEGORY_ROOTS = ['Category:Accessory items'] as const

/** P2-S8: Cargo Equipinfo (UpdateEquip transcription; 184 columns, fetched with the compact field list). */
export const EQUIPINFO_TABLE = 'Equipinfo'

export const PROJECTILEINFO_TITLE = 'Module:Projectileinfo/data'

type PageStatus = Map<string, { exists: boolean; resolvedTitle: string }>

export interface SyncResult {
  iteminfo: IteminfoFetch
  modules: Record<(typeof RECIPE_MODULE_TITLES)[number], ModuleFetch>
  overlayPages: Map<string, { exists: boolean; resolvedTitle: string }>
  tables: Record<SyncTable, CargoTableFetch>
  /** Weapon category tree + each member page's existence / redirect target (reconciliation). */
  weaponCategories: CategoryTree & { pageStatus: PageStatus }
  /** Image metadata for the infobox image (`imagefile`) of every Cargo Items row typed "weapon". */
  weaponImages: ImageInfoFetch
  /**
   * Rendered articles (requested title → article): the pages the curated overlays cite, the
   * ammunition rows' articles, "Buff IDs" and the buff articles (P2-S7).
   */
  articles: Map<string, Article>
  /** Image metadata for the infobox image of every boss-typed Cargo NPCs row of the registry. */
  bossImages: ImageInfoFetch
  /** P2-S7: Module:Projectileinfo/data (projectile extraUpdates). */
  projectileinfo: ModuleFetch
  /** P2-S7: Category:Ammunition items tree + each member page's existence / redirect target. */
  ammoCategories: CategoryTree & { pageStatus: PageStatus }
  /** P2-S7: image metadata for the infobox image of every Cargo Items row typed "ammunition". */
  ammoImages: ImageInfoFetch
  /** P2-S8: Cargo Equipinfo (all columns). */
  equipinfo: CargoTableFetch
  /** P2-S8: Category:Armor items tree + each member page's existence / redirect target. */
  armorCategories: CategoryTree & { pageStatus: PageStatus }
  /** P2-S8: Category:Accessory items tree + each member page's existence / redirect target. */
  accessoryCategories: CategoryTree & { pageStatus: PageStatus }
  /** P2-S8: image metadata for the infobox image of every armor-piece and functional-accessory row. */
  equipmentImages: ImageInfoFetch
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
  const bosses = loadBossesOverlay()
  const ammoRows = tables.Items.rows.filter((r) => itemTypeIncludes(r, 'ammunition'))
  log?.('articles: overlay evidence, ammunition rows, Buff IDs')
  const articles = await fetchArticles(client, [...evidencePages(bosses, loadProgressionOverlay(), loadWithheldOverlay()), ...ammoRows.map((r) => String(r._page ?? '')).filter(Boolean), BUFF_IDS_PAGE], 'articles')
  log?.('boss image metadata (imageinfo)')
  const bossImages = await fetchImageInfo(client, bossImageFiles(bosses, tables.NPCs.rows), 'images/bosses')

  // P2-S7
  log?.(PROJECTILEINFO_TITLE)
  const projectileinfo = await fetchModuleRevision(client, PROJECTILEINFO_TITLE, 'modules/projectileinfo-data')
  log?.(`category tree ${AMMO_CATEGORY_ROOTS.join(', ')}`)
  const ammoCategories = await fetchCategoryTree(client, AMMO_CATEGORY_ROOTS)
  log?.('ammunition category pages (existence / redirects)')
  const ammoCategoryPages = await checkPagesExist(client, ammoCategories.pages, 'pages/ammo-categories')
  log?.('ammunition image metadata (imageinfo)')
  const ammoImages = await fetchImageInfo(client, ammoRows.map((r) => String(r.imagefile ?? '')), 'images/ammo')
  log?.('buff articles (Buff IDs links of the registry candidates)')
  const buffIds = articles.get(BUFF_IDS_PAGE)
  if (!buffIds) throw new FetchError(`${BUFF_IDS_PAGE}: article missing from the sync`)
  // a superset of the build's registry: every weapon/ammo row (incl. rows the build later excludes)
  const weaponOrAmmo = tables.Items.rows.filter((r) => itemTypeIncludes(r, 'weapon') || itemTypeIncludes(r, 'ammunition'))
  const candidates = [...cargoBuffNames(weaponOrAmmo, 'debuffs').keys(), ...cargoBuffNames(ammoRows, 'buffs').keys(), ...loadBuffsOverlay().entries.map((e) => e.name)]
  for (const [title, article] of await fetchArticles(client, buffArticleTitles(parseBuffIdTable(buffIds.html), candidates), 'articles')) articles.set(title, article)

  // P3-S0
  log?.('articles: Weapon Lab family weapons, mechanics rule pages, lab-params overlay evidence')
  const labTitles = [...labFamilyPages(weaponCategories, tables.Items.rows, parseIteminfo(iteminfo)), ...LAB_RULE_PAGES, ...labEvidencePages(loadLabParamsOverlay())]
  for (const [title, article] of await fetchArticles(client, labTitles, 'articles')) articles.set(title, article)

  // P2-S8
  log?.(`Cargo ${EQUIPINFO_TABLE}`)
  const equipFields = await cargoFields(client, EQUIPINFO_TABLE)
  const equipinfo = await cargoQueryAll(client, EQUIPINFO_TABLE, Object.keys(equipFields), equipFields, log, { compact: true })
  log?.(`category trees ${[...ARMOR_CATEGORY_ROOTS, ...ACCESSORY_CATEGORY_ROOTS].join(', ')}`)
  const armorCategories = await fetchCategoryTree(client, ARMOR_CATEGORY_ROOTS)
  const armorCategoryPages = await checkPagesExist(client, armorCategories.pages, 'pages/armor-categories')
  const accessoryCategories = await fetchCategoryTree(client, ACCESSORY_CATEGORY_ROOTS)
  const accessoryCategoryPages = await checkPagesExist(client, accessoryCategories.pages, 'pages/accessory-categories')
  log?.('armor-piece + accessory image metadata (imageinfo)')
  const equipmentImages = await fetchImageInfo(client, [...armorPieceRows(tables.Items.rows), ...accessoryRows(tables.Items.rows).functional].map((r) => String(r.imagefile ?? '')), 'images/equipment')
  log?.('articles: armor set pages, Wings, armor-sets overlay evidence')
  const equipmentTitles = [...armorSetPages(tables.Items.rows), WINGS_PAGE, ...armorSetEvidencePages(loadArmorSetsOverlay())]
  for (const [title, article] of await fetchArticles(client, equipmentTitles, 'articles')) articles.set(title, article)

  return {
    iteminfo,
    modules,
    overlayPages,
    tables,
    weaponCategories: { ...weaponCategories, pageStatus: weaponCategoryPages },
    weaponImages,
    articles,
    bossImages,
    projectileinfo,
    ammoCategories: { ...ammoCategories, pageStatus: ammoCategoryPages },
    ammoImages,
    equipinfo,
    armorCategories: { ...armorCategories, pageStatus: armorCategoryPages },
    accessoryCategories: { ...accessoryCategories, pageStatus: accessoryCategoryPages },
    equipmentImages,
  }
}

export { WikiClient, FetchError } from './client'
export { RAW_DIR } from './config'
