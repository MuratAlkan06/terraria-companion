/**
 * `npm run pipeline:build` — parse → merge → cross-check → validate → emit, OFFLINE from the raw
 * cache written by `npm run pipeline:fetch` (zero network; a cache miss is E_FETCH).
 *
 *   tsx pipeline/cli/build.ts [--out <dir>] [--report <file>] [--sprite-manifest <file>]
 *
 * Defaults: --out src/data, --report pipeline/reports/gap-report.md, --sprite-manifest
 * public/sprites/manifest.json. Nothing is written unless validation and the 300 KB gz budgets
 * pass. Output is deterministic for a given cache + overlays (generatedAt = newest fetch
 * timestamp, not the wall clock). Sprite BINARIES are not touched here (local-only
 * `npm run pipeline:sprites`, AMENDMENTS-001 A10); the manifest is derived from the cached
 * imageinfo metadata, so it does not depend on which binaries happen to be downloaded.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { isCoveredBy, SpriteManifest, STAGE_ORDER, StatKind, type Condition, type DropSource, type Recipe, type Weapon } from '../../src/schemas'
import { assessWeapon } from '../../src/sim'
import { RAW_DIR, runSyncPlan, WikiClient } from '../fetch'
import { itemTypeIncludes } from '../fetch/cargo'
import { wikiPageUrl } from '../fetch/config'
import { renderGapReport } from '../emit/gapReport'
import { THUMBNAIL_MIN_BYTES, thumbnailFor } from '../emit/thumbnail'
import { checkBudgets, gzSize, serializeObject, serializeRecords, type EmittedFile } from '../emit/write'
import { writeFiles } from '../emit/write'
import { buildAccessories } from '../merge/accessories'
import { buildAmmo, identifyAmmo } from '../merge/ammo'
import { buildArmor } from '../merge/armor'
import { EFFECT_CATEGORIES, EFFECT_RULES, tooltipEffectLines } from '../merge/effects'
import { armorSetRows, iteminfoArmorSlot } from '../merge/equipment'
import { bossAttribution, buildBosses, buildProgression } from '../merge/bosses'
import { BUFF_IDS_PAGE, buildBuffs, cargoBuffNames } from '../merge/buffs'
import { buildDrops, indexNpcs } from '../merge/drops'
import { buildEnemies } from '../merge/enemies'
import { Evidence } from '../merge/evidence'
import { createGatingDeriver, GATING_BLOCKERS, type GatingBlocker } from '../merge/gating'
import { buildLabParams, coverageByFamily, FAMILY_CATEGORIES, SCREEN_RULES } from '../merge/labParams'
import { conditionMatchers, loadArmorSetsOverlay, loadBossesOverlay, loadBuffsOverlay, loadConditionsOverlay, loadLabParamsOverlay, loadProgressionOverlay, loadWithheldOverlay } from '../merge/overlays'
import { makeProv } from '../merge/prov'
import { buildRecipes } from '../merge/recipes'
import { PAGE_BUCKET_LABEL, reconcileCategories, reconcileWeaponLists, type PageBucket } from '../merge/reconcile'
import { buildConditions, buildItemUniverse } from '../merge/registry'
import { buildSearchDocs } from '../merge/search'
import { buildWeapons, type WithheldField } from '../merge/weapons'
import { parseBuffIdTable } from '../parse/infobox'
import { parseIteminfo } from '../parse/iteminfo'
import { parseProjectileinfo } from '../parse/projectileinfo'
import { parseGameRecipeGroups, parseRecipesL10n, parseWikiRecipeGroups } from '../parse/recipeModules'
import { formatError, formatWarning, validateDataset } from '../validate'
import { stationItemUses, TINKERERS_WORKSHOP_ITEM_ID } from '../validate/integrity'
import {
  COLLECTION_KEYS,
  COLLECTIONS,
  ITEM_UNIVERSE_FILE,
  LIST_FILES,
  MANIFEST_FILE,
  OUTPUT_FILES,
  SEARCH_DOCS_FILE,
  STAGE_GAPS_FILE,
  type CollectionKey,
  type Dataset,
  type DatasetManifest,
  type RawDataset,
} from '../validate/dataset'
import { projectList } from '../validate/listDetail'

const repoRoot = resolve(import.meta.dirname, '..', '..')

// P2-S6: bosses / nodes / edges are produced — references into them are hard checks now (B12).
// P2-S7: items (ammo) and buffs are produced — §7a-10 ammo classes and buff refs are hard checks.
// P2-S8: armor, accessories and armor sets are produced — §7a-6 set bijection / back-refs and §7a-7
// tinkering symmetry are hard checks. The item CORPUS stays partial (item-universe.json) until P6-S0.
const PENDING: CollectionKey[] = ['scenarios']

const SPRITE_RIGHTS_NOTE =
  'Item sprites are Terraria content © Re-Logic, downloaded from terraria.wiki.gg (each file links its wiki file page). They are not covered by the wiki text license (CC BY-NC-SA 4.0), are never committed to the repository (AMENDMENTS-001 A10) and are replaced by original placeholder art when fallbackMode is true (ADR-001 D3).'

const STATIC_RESOLUTIONS = [
  {
    id: '#2 recipe-group encoding',
    text: 'Cargo Recipes stores a group ingredient as its plain English name ("¦Any Iron Bar¦" in `ingredients`, "Any Iron Bar¦2" in `args`, "¦Any Iron Bar¦2" in `ings`); members are not in Cargo. Members come from Module:Recipes `group("Any …", {names})` (what the {{recipes}} template uses), resolved to IDs via Module:Iteminfo/data and cross-checked against Module:RecipeGroups (the game\'s SetupRecipeGroups, v1.4.5.4 transcription). Station alternatives (B3) come from Module:Recipes/l10n `en.station_cate` ("Iron Anvil" → "Iron or Lead Anvil").',
  },
  {
    id: '#3 drop NPC ids / multi-part bosses',
    text: 'Cargo Drops `id` carries NPC ids for most NPC rows (single, comma lists, ranges, per-variant notes, negative variant netIDs); container rows (crates, chests, treasure bags) carry none or the boss id. Ids are cross-checked against Cargo NPCs by name (mismatches withheld + gap); empty ids are filled from NPCs. Multi-part bosses: every part/segment NPC is typed `boss Part` and lives on the boss article (`_page`), so drops attribute to that boss. P2-S6: the boss registry resolves each boss-typed / treasure-bag row by its article (bossId, cross-checked against the boss\'s NPC ids); rows on event-boss articles get no bossId (not applicable — events are markers, A3).',
  },
  {
    id: '#8 Imageinfo → sprite file resolution',
    text: 'Cargo Items `imagefile` names the infobox image ("Zenith.png"); `prop=imageinfo&iiprop=url|size|sha1|mime` on "File:<imagefile>" (50 titles per request) returns the original file URL on terraria.wiki.gg/images/, its SHA-1, size and dimensions; the URL\'s ?<6 hex> key is the SHA-1 prefix (pins the file version). The wiki\'s CDN (Cloudflare Polish, `cf-polished: ok, orig_size=N`) serves most PNGs re-encoded, so a byte-exact SHA-1 match is only possible for some files; downloads are accepted when the SHA-1 matches exactly OR the CDN-reported original size equals the wiki\'s recorded size of that version (pipeline:sprites reports both counts).',
  },
  {
    id: '#13 Cargo paging',
    text: 'limit=5000 requested; the server returned at most 500 rows per page for every table (Recipes 9 pages, Drops 7, NPCs 2, Items 13, Weapon_source 3). Pagination is by offset ordered by _ID until COUNT(*) is reached.',
  },
]

function countUnknownFields(ds: Dataset): Map<string, number> {
  const counts = new Map<string, number>()
  for (const key of COLLECTION_KEYS) {
    for (const r of ds[key] as readonly { _prov: { unverifiedFields: string[] } }[]) {
      for (const f of r._prov.unverifiedFields) {
        const k = `${key} · ${f.replace(/\.\d+\./g, '.N.')}`
        counts.set(k, (counts.get(k) ?? 0) + 1)
      }
    }
  }
  return counts
}

const collectionFile = (key: CollectionKey): string => COLLECTIONS[key].file

async function main(): Promise<number> {
  const { values } = parseArgs({ options: { out: { type: 'string' }, report: { type: 'string' }, 'sprite-manifest': { type: 'string' } }, strict: true })
  const outDir = resolve(values.out ?? join(repoRoot, 'src/data'))
  const reportPath = resolve(values.report ?? join(repoRoot, 'pipeline/reports/gap-report.md'))
  const spriteManifestPath = resolve(values['sprite-manifest'] ?? join(repoRoot, 'public/sprites/manifest.json'))

  // fetch stage, offline: everything must already be cached
  const client = new WikiClient({ cacheDir: RAW_DIR, offline: true })
  const sync = await runSyncPlan(client)
  if (client.stats.networkRequests !== 0) throw new Error('offline build touched the network')

  // parse
  const iteminfo = parseIteminfo(sync.iteminfo)
  const mods = sync.modules
  const moduleRev = (m: (typeof mods)[keyof typeof mods]) => ({ title: m.title, rev: m.rev, fetchedAt: m.fetchedAt })
  const overlay = loadConditionsOverlay()
  const matchers = conditionMatchers(overlay)

  // merge + cross-check
  const conditions = buildConditions(overlay, sync.overlayPages)
  const recipes = buildRecipes({
    rows: sync.tables.Recipes.rows,
    fetchedAt: sync.tables.Recipes.fetchedAt,
    iteminfo,
    modules: { recipes: moduleRev(mods['Module:Recipes']), recipeGroups: moduleRev(mods['Module:RecipeGroups']), l10n: moduleRev(mods['Module:Recipes/l10n']) },
    wikiGroups: parseWikiRecipeGroups(mods['Module:Recipes']),
    gameGroups: parseGameRecipeGroups(mods['Module:RecipeGroups']),
    l10n: parseRecipesL10n(mods['Module:Recipes/l10n']),
    conditions: matchers,
  })
  const npcIndex = indexNpcs(sync.tables.NPCs.rows)
  // P2-S6 curated overlays; every quote they cite is checked against the cached article revision
  const bossesOverlay = loadBossesOverlay()
  const progressionOverlay = loadProgressionOverlay()
  const withheldOverlay = loadWithheldOverlay()
  const evidence = new Evidence(sync.articles)
  const drops = buildDrops({
    rows: sync.tables.Drops.rows,
    fetchedAt: sync.tables.Drops.fetchedAt,
    npcs: npcIndex,
    npcsFetchedAt: sync.tables.NPCs.fetchedAt,
    iteminfo,
    conditions: matchers,
    bosses: { byPage: bossAttribution(bossesOverlay, sync.tables.NPCs.rows), authoredAt: bossesOverlay.authoredAt },
  })
  const enemies = buildEnemies(sync.tables.NPCs.rows, drops.drops, sync.tables.NPCs.fetchedAt, sync.tables.Drops.fetchedAt)
  const universe = buildItemUniverse(iteminfo)
  const progression = buildProgression({ overlay: progressionOverlay, bosses: bossesOverlay, evidence })
  const bosses = buildBosses({
    overlay: bossesOverlay,
    npcRows: sync.tables.NPCs.rows,
    npcsFetchedAt: sync.tables.NPCs.fetchedAt,
    dropsFetchedAt: sync.tables.Drops.fetchedAt,
    drops: drops.drops,
    evidence,
    iteminfo,
    images: sync.bossImages,
  })
  // B19: wiki self-conflicts (quoted evidence) → withheld weapon fields
  const withheld = new Map<number, WithheldField>(
    withheldOverlay.entries.map((e) => [
      e.itemId,
      { field: e.field, detail: e.detail, cargoTag: e.cargoTag, sources: e.evidence.map((x, i) => evidence.quote(x.page, x.quote, `overlay withheld/i:${e.itemId} evidence ${i}`).url) },
    ]),
  )

  // §7b gating over the recipes/drops/conditions and the progression graph
  const byKey = <T, K>(list: readonly T[], key: (t: T) => K) => {
    const m = new Map<K, T[]>()
    for (const t of list) m.set(key(t), [...(m.get(key(t)) ?? []), t])
    return m
  }
  const derive = createGatingDeriver({
    recipesByResult: byKey<Recipe, number>(recipes.recipes, (r) => r.resultItemId),
    dropsByItem: byKey<DropSource, number>(drops.drops, (d) => d.itemId),
    groups: new Map(recipes.groups.map((g) => [g.id, g])),
    conditions: new Map<string, Condition>(conditions.map((c) => [c.id, c])),
    graph: {
      nodes: new Map(progression.nodes.map((n) => [n.id, n])),
      edges: progression.edges,
      bossNode: new Map(bosses.bosses.map((b) => [b.id, b.nodeId])),
    },
  })
  const weapons = buildWeapons({
    itemRows: sync.tables.Items.rows,
    itemsFetchedAt: sync.tables.Items.fetchedAt,
    iteminfo,
    recipes: recipes.recipes,
    drops: drops.drops,
    categories: sync.weaponCategories,
    images: sync.weaponImages,
    gating: derive,
    withheld,
  })

  // P2-S7 buff registry (A4 bound): debuffs inflicted by emitted weapons / ammo, ammo-granted buffs,
  // the curated combat buff potions — resolved through the wiki's Buff IDs table
  const projectileinfo = parseProjectileinfo(sync.projectileinfo)
  const buffIdsArticle = sync.articles.get(BUFF_IDS_PAGE)
  if (!buffIdsArticle) throw new Error(`${BUFF_IDS_PAGE} article missing from the sync`)
  const buffTable = { rows: parseBuffIdTable(buffIdsArticle.html), url: wikiPageUrl(buffIdsArticle.resolvedTitle), rev: buffIdsArticle.revid, fetchedAt: buffIdsArticle.fetchedAt }
  const buffsOverlay = loadBuffsOverlay()
  const ammoIdn = identifyAmmo(sync.tables.Items.rows, iteminfo)
  const members = new Map<string, string[]>()
  const addMember = (name: string, why: string) => members.set(name, [...(members.get(name) ?? []), why])
  const listed = (names: readonly string[]) => `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3} more` : ''}`
  for (const [name, by] of cargoBuffNames([...weapons.identification.included.map((c) => c.row), ...ammoIdn.included.map((c) => c.row)], 'debuffs')) addMember(name, `inflicted by ${listed(by)}`)
  for (const c of ammoIdn.included) {
    const type = (c.item.stats as Record<string, unknown>).buffType
    const row = typeof type === 'number' && type > 0 ? buffTable.rows.find((r) => r.id === type) : undefined
    if (row) addMember(row.name, `granted by ${c.name}`)
  }
  for (const e of buffsOverlay.entries) addMember(e.name, 'combat buff potion (overlays/buffs.json)')
  const buffs = buildBuffs({ table: buffTable, members, overlay: buffsOverlay, articles: sync.articles, evidence })

  // P2-S7 ammo items; dual-role weapons (Snowball) receive their ammoStats on the weapon record
  const ammo = buildAmmo({
    itemRows: sync.tables.Items.rows,
    itemsFetchedAt: sync.tables.Items.fetchedAt,
    iteminfo,
    projectileinfo,
    articles: sync.articles,
    categories: sync.ammoCategories,
    images: sync.ammoImages,
    recipes: recipes.recipes,
    drops: drops.drops,
    gating: derive,
    weaponIds: new Set(weapons.weapons.map((w) => w.id)),
    usedSlugs: new Set(weapons.weapons.map((w) => w.slug)),
    stationIds: new Set(stationItemUses(recipes.recipes, new Map(recipes.groups.map((g) => [g.id, g]))).keys()),
    buffTable: buffTable.rows,
    buffSlug: (name) => buffs.slugByName.get(name),
    withheld,
  })
  const weaponRecords = weapons.weapons.map((w): Weapon => {
    const a = ammo.weaponAmmo.get(w.id)
    if (!a) return w
    const { behaviorText, labBehavior, _prov, ...rest } = w
    const crossCheckFailed = a.crossCheckFailed || (!_prov.verified && _prov.unverifiedFields.length === 0)
    return { ...rest, ammoStats: a.ammoStats, ...(behaviorText !== undefined ? { behaviorText } : {}), labBehavior, _prov: makeProv([..._prov.sources, ...a.sources], [..._prov.unverifiedFields, ...a.unverified], crossCheckFailed) }
  })
  // P3-S0 Weapon Lab archetype params: derivation + article screen + curated residuals (merge/labParams.ts)
  const labOverlay = loadLabParamsOverlay()
  const lab = buildLabParams({
    weapons: weaponRecords,
    iteminfo,
    projectileinfo,
    articles: sync.articles,
    evidence,
    pageOf: weapons.pageOf,
    rows: new Map(weapons.identification.included.map((c) => [c.item.id, c.row])),
    sprites: new Map(weapons.sprites.map((f) => [Number(f.ref.slice(2)), f])),
    overlay: labOverlay,
  })
  // P2-S8 armor pieces + armor sets, accessories (merge/armor.ts, merge/accessories.ts, merge/effects.ts)
  const itemSlugs = new Set([...weapons.weapons.map((w) => w.slug), ...ammo.items.map((i) => i.slug)])
  const armorSetsOverlay = loadArmorSetsOverlay()
  const equipmentInput = {
    itemRows: sync.tables.Items.rows,
    itemsFetchedAt: sync.tables.Items.fetchedAt,
    iteminfo,
    equipinfo: sync.equipinfo,
    articles: sync.articles,
    images: sync.equipmentImages,
    recipes: recipes.recipes,
    drops: drops.drops,
    gating: derive,
    withheld,
  }
  const armor = buildArmor({ ...equipmentInput, evidence, overlay: armorSetsOverlay, usedSlugs: itemSlugs })
  const accessories = buildAccessories({ ...equipmentInput, usedSlugs: new Set([...itemSlugs, ...armor.pieces.map((p) => p.slug)]) })
  const stageGaps = [...recipes.gaps, ...drops.gaps, ...weapons.gaps, ...bosses.gaps, ...ammo.gaps, ...buffs.gaps, ...armor.gaps, ...accessories.gaps]

  const generatedAt = [
    sync.iteminfo.fetchedAt,
    ...Object.values(mods).map((m) => m.fetchedAt),
    ...Object.values(sync.tables).map((t) => t.fetchedAt),
    sync.weaponCategories.fetchedAt,
    sync.weaponImages.fetchedAt,
    sync.bossImages.fetchedAt,
    ...[...sync.articles.values()].map((a) => a.fetchedAt),
    sync.projectileinfo.fetchedAt,
    sync.ammoCategories.fetchedAt,
    sync.ammoImages.fetchedAt,
    sync.equipinfo.fetchedAt,
    sync.armorCategories.fetchedAt,
    sync.accessoryCategories.fetchedAt,
    sync.equipmentImages.fetchedAt,
  ]
    .sort()
    .at(-1) as string

  const manifest: DatasetManifest = {
    name: 'wiki-sync',
    description:
      'Live terraria.wiki.gg sync for Terraria 1.4.5.8 (Desktop): weapons (P2-S2), recipes, recipe groups, drops, enemies and the conditions registry (P2-S2a), bosses and the progression graph (P2-S6), ammo items and the Lab/loadout buff registry (P2-S7), Weapon Lab archetype params (P3-S0), armor pieces, armor sets and accessories (P2-S8), plus search docs. Item IDs resolve against the Module:Iteminfo/data universe: the rest of the item corpus is produced by P6-S0 (partial.itemUniverse) and Lab scenarios by a later slice (partial.pending).',
    iteminfo: { rev: iteminfo.rev, syncedTo: iteminfo.terrariaVersion },
    notes: [
      `Sources: Module:Iteminfo/data rev ${iteminfo.rev} (generated ${iteminfo.generated}, game ${iteminfo.terrariaVersion}); ${Object.values(mods).map((m) => `${m.title} rev ${m.rev}`).join('; ')}; Cargo tables fetched ${Object.values(sync.tables).map((t) => `${t.table} ${t.fetchedAt}`).join(', ')}; weapon category tree ${sync.weaponCategories.fetchedAt}; imageinfo ${sync.weaponImages.fetchedAt}.`,
      'Weapons: Cargo Items rows whose infobox type contains "weapon" and whose itemid is the same item in Module:Iteminfo/data (display name, or internal name for unnamed IDs). Stats from Module:Iteminfo/data, cross-checked against the Cargo infobox (a disagreement withholds the value as Unknown + source-mismatch gap). See pipeline/merge/weapons.ts for every field rule.',
      'useTimeTicks = Iteminfo useTime (interval between uses/shots); useAnimationTicks = Iteminfo useAnimation = the wiki\'s displayed "Use time" (TO-VERIFY #10). critPct = the weapon\'s crit bonus (wiki shows 4% + bonus); not applicable for summon weapons (summon damage cannot normally crit). shootSpeedTps = Iteminfo shootSpeed (px/tick) × 3.75, the item stat, not the effective projectile velocity.',
      'Weapon acquisition links recipes (incl. Shimmer), drops (NPCs, bosses, bags, chests, crates) and vendor:<NPC> Cargo tags (purchase; shop conditions Unknown). Weapon gatedBy/stage follow DATA_SCHEMA_SPEC §7b over the progression graph and are Unknown wherever any input is unverified (gap report lists the blockers). Wiki self-conflicts listed in pipeline/overlays/withheld.json (AMENDMENTS-004 B19) withhold the field (Unknown + source-mismatch gap).',
      'Weapon labBehavior (P3-S0, pipeline/merge/labParams.ts + pipeline/overlays/lab-params.json): weapons in the wiki categories Broadswords / Shortswords + Spears / Bows + Repeaters + Guns / Wands + Magic guns + Spell books are classified into the swing-melee / thrust / bow-gun / magic-bolt archetypes from Iteminfo useStyle (quoted from the Use Style IDs article), class, noMelee, channel, shoot, useAmmo and mana; params are derived from Module:Iteminfo/data, Module:Projectileinfo/data and the wiki sprite metadata where a formula exists, and single-projectile / no-spread / ammo-unchanged defaults only when the article screen finds no statement of other behavior — flagged weapons need a reviewed overlay entry with verbatim, revision-checked quotes. Semantics follow src/sim/README.md (AMENDMENTS-008 B37). Everything else keeps a limitation card (tooltip text where the wiki has one) with the specific reason; every emitted archetype weapon passes the sim guard (assessWeapon).',
      'Recipes: desktop rows only (legacy=0 and version empty or containing "desktop"); result = Cargo resultid checked against the Iteminfo name; ingredients from `ings`; "Any X" → Module:Recipes groups; stations split on " and " → registered environment condition, else Module:Recipes/l10n station category group (B3), else item; "By Hand" = no stations.',
      'Recipe result notes (#note_post_moon_lord, #note_moon_N, …) are availability conditions in Recipe.conditions (AMENDMENTS-003 B9); environment stations are only genuine crafting environments.',
      'Recipe ids: resultItemId-fnv1a32hex(JSON.stringify({s: sorted station refs (i:/grp:/cond:, availability conditions included as cond:), i: sorted "ref*amount"})); same canonical recipe with a different result amount gets a -2 suffix. Drop ids: itemId-slug(npcName)-fnv1a32hex(JSON.stringify(sorted conditions)), -N suffix on collision.',
      'Drops: rows whose platform icons exclude Desktop are skipped; normal/expert/master flags give the applicable difficulties; rate/quantity cells are parsed per pipeline/parse/dropCells.ts; anything else is absent + listed (Unknown). Unregistered notes make conditions Unknown ([] + "conditions" listed).',
      'Boss drops (source NPC typed boss / boss Part in Cargo NPCs, or a treasure bag): source.bossId = the registry boss of the row\'s article (pipeline/overlays/bosses.json), cross-checked against the boss\'s NPC ids (a mismatch keeps it Unknown + gap). Rows on event-boss articles (Pumpking, Betsy, Celestial Pillars…) carry no bossId: they are not Boss records (A3), so the field is not applicable.',
      'Bosses (P2-S6): the REQUIREMENTS §6 registry in pipeline/overlays/bosses.json; npcIds, environment and per-difficulty stats from Cargo NPCs (pipeline/parse/npcStats.ts withholds every cell that is not one integer per difficulty, incl. cells flagged as based on outdated source code; multi-part bosses without a boss-level row are Unknown; values are the representative NPC\'s BASE stats = the article\'s first infobox — later-phase changes such as the second forms of Eye of Cthulhu, Plantera and Empress of Light are fight behavior and not modeled); summon items resolved through Module:Iteminfo/data; summon text, location time and attack-pattern tags only as verbatim quotes checked against the cited article revision; stage editorial; prep/suggested equipment/strategies absent + listed (A1 staging, enforced at P5).',
      'Progression (P2-S6): boss nodes 1:1 with bosses + milestone/event markers (A3) from pipeline/overlays/progression.json; every edge is typed, its note is a verbatim quote of its sourceUrl article (checked at build). Edges model one world; the hardmode condition is satisfied by the Hardmode milestone (required-gated by the Wall of Flesh).',
      'Enemies: Cargo NPCs rows with an enemy type and no boss/critter/town/projectile type, merged by name; biomes = NPCs `environment` alternatives verbatim ("/" = or, "+" = and); stage absent + listed; dropIds derived (deriveEnemyDropIds).',
      'Conditions: curated overlay pipeline/overlays/conditions.json; every cited page verified to exist by the fetch stage; satisfiedByNode slugs are deferred references into the P2-S6 progression graph.',
      'Collections are emitted as JSON arrays (one record per line), incl. weapons.detail.json (AMENDMENTS-003 B11 supersedes the map shapes in DATA_SCHEMA_SPEC §3/§5).',
      'Ammo (P2-S7): Cargo Items rows typed "ammunition" that are the same desktop item in Module:Iteminfo/data with a non-zero `ammo` (AmmoID), emitted to items.detail.json / items.list.json (§5 list/detail split; category "ammo"). ammoStats.ammoClass = slug of the AmmoID item (the weapon rule). damage / knockback / velocityBonusTps (shootSpeed × 3.75 tiles/s, added to the weapon\'s) from Iteminfo for items with damage > 0, cross-checked against Cargo; items with no damage of their own (Gel, sand, solutions…) list all three as Unknown. velocityMultiplier (AMENDMENTS-002 B2) = the item\'s own infobox "Velocity Multiplier" row, cross-checked with 1 + extraUpdates (Module:Projectileinfo/data); not applicable when the own infobox shows none and Projectileinfo agrees, or the item fires no projectile of its own (Iteminfo shoot 0); Unknown for items sharing a list article without an own infobox. Snowball is a weapon AND ammo: its ammoStats are on the weapon record (one ID, one collection). See pipeline/merge/ammo.ts.',
      'Buffs (P2-S7, A4 bound): every debuff an emitted weapon or ammo item inflicts (Cargo `debuffs`) or grants (Iteminfo buffType), plus the curated combat buff potions in pipeline/overlays/buffs.json. gameBuffId / isDebuff / article from the wiki\'s "Buff IDs" table (TO-VERIFY #12), cross-checked with the article\'s own Buff ID; dot.dps = enemy health loss per second from the buff infobox "Effects" row; effects only from the overlay (verbatim, number-checked quotes), else Unknown. Search docs include buffs because §7a-11 requires every emitted entity to be searchable. See pipeline/merge/buffs.ts.',
      'Stage (AMENDMENTS-005 B22): §7b item stage = max over gates of (node.unlocksStage ?? node.stage); wall-of-flesh carries unlocksStage early-hm (its drops are Early Hardmode content), validated against its required-gate edge into the hardmode milestone.',
      'Lists and search docs carry each record\'s own wikiUrl (AMENDMENTS-007 B31). Sprite files over 100 KB get a static first-frame PNG thumbnail (whole-number downscale to ≤ 128 px; AMENDMENTS-007 B30) listed in the sprite manifest and generated locally by npm run pipeline:sprites.',
      'Armor (P2-S8, pipeline/merge/armor.ts): Cargo Items rows typed "armor" (the set row of a set article, typed "armor" + "set", is the set infobox, not an item) that are the same desktop item in Module:Iteminfo/data with exactly one head/body/leg slot agreeing with the Cargo body slot. defense = Iteminfo defense cross-checked with the infobox; effects = the per-piece game-text tooltip lines classified by pipeline/merge/effects.ts and cross-checked with Cargo Equipinfo (the wiki\'s UpdateEquip transcription). No maxStack (AMENDMENTS-002 B7).',
      'Armor sets (P2-S8): one per set article; pieces = the armor pieces hosted by the article (≥1 helmet, exactly one chest and legs piece); per-helmet set bonus = the set infobox "Set Bonus" game text (a helmet-specific segment replaces the default for that helmet), classified like tooltips; setBonusText = those lines verbatim. Sets the schema cannot express (two alternative chests, no legs, pieces on other pages, no set bonus) are withheld by a reviewed pipeline/overlays/armor-sets.json entry (quote-checked) with a gap. Variant class (editorial) = the damage-class signals of the variant\'s stats (one → that class, none → other, several → a quoted overlay ruling). Set stage = earliest stage a complete set can be assembled (min over helmets of max piece stage), Unknown unless every piece\'s stage is derived.',
      'Accessories (P2-S8, pipeline/merge/accessories.ts): Cargo Items rows typed "accessory" and not "vanity" that are the same desktop item in Module:Iteminfo/data (accessory true, vanity false); vanity accessories (cosmetic, incl. music boxes) are reconciled but left to the item corpus (P6-S0). effects = Iteminfo defense (defense-flat) + classified game-text lines (Equipinfo cross-check; a disagreement withholds them, an Equipinfo-only stat is a gap, never filled in); Unknown (empty + listed, A1) when the wiki transcribes no game text. categories (editorial) = union of the classified effects\' categories. combinedFrom / upgradesTo derived from Tinkerer\'s Workshop recipes (§7a-7). wingStats from the "Wings" article list table: flightTimeTicks = round(seconds × 60) (exact at the table\'s 2-decimal precision), hover = a hovering speed is listed; verticalSpeedTps Unknown (the table states a multiplier).',
      'Effect lines (P2-S8, pipeline/merge/effects.ts): every game-text line must match exactly one explicit rule — a stat rule onto the CLOSED StatKind enum (the line must state every emitted number), a special (verbatim text, simulated false; rules that would need a new StatKind name it as an amendment candidate), or flavor text; an unclassifiable line fails the build.',
    ],
    partial: { itemUniverse: ITEM_UNIVERSE_FILE, pending: PENDING },
  }

  // validate pass 1 → the strict-parsed (and possibly Lab-downgraded) weapons the lists project
  const collections: RawDataset['collections'] = {
    weapons: lab.weapons,
    items: ammo.items,
    buffs: buffs.buffs,
    recipes: recipes.recipes,
    recipeGroups: recipes.groups,
    drops: drops.drops,
    enemies: enemies.enemies,
    conditions,
    bosses: bosses.bosses,
    nodes: progression.nodes,
    edges: progression.edges,
    armor: armor.pieces,
    armorSets: armor.sets,
    accessories: accessories.accessories,
  }
  const first = validateDataset({ manifest, collections, lists: {}, itemUniverse: universe, stageGaps }, { now: new Date(generatedAt) })
  if (!first.ok) {
    console.error(`FAIL — validate: ${first.errors.length} error(s)`)
    for (const e of first.errors.slice(0, 60)) console.error(`  ${formatError(e).replaceAll('\n', '\n  ')}`)
    if (first.errors.length > 60) console.error(`  … ${first.errors.length - 60} more`)
    return 1
  }
  const weaponDetails = first.dataset.weapons
  const weaponList = weaponDetails.map((w) => projectList('weapons', w as unknown as Record<string, unknown>))
  const itemDetails = first.dataset.items
  const itemList = itemDetails.map((i) => projectList('items', i as unknown as Record<string, unknown>))
  const armorDetails = first.dataset.armor
  const armorList = armorDetails.map((a) => projectList('armor', a as unknown as Record<string, unknown>))
  const accessoryDetails = first.dataset.accessories
  const accessoryList = accessoryDetails.map((a) => projectList('accessories', a as unknown as Record<string, unknown>))
  const setDetails = first.dataset.armorSets
  const searchDocs = buildSearchDocs({ weapons: weaponDetails, enemies: enemies.enemies, bosses: first.dataset.bosses, items: itemDetails, buffs: first.dataset.buffs, armor: armorDetails, accessories: accessoryDetails, armorSets: setDetails })

  // validate pass 2 over exactly what is emitted (details + lists + search docs)
  const raw: RawDataset = { manifest, collections: { ...collections, weapons: weaponDetails }, lists: { weapons: weaponList, items: itemList, armor: armorList, accessories: accessoryList }, searchDocs, itemUniverse: universe, stageGaps }
  const result = validateDataset(raw, { now: new Date(generatedAt) })
  for (const w of result.warnings) console.log(`  ${formatWarning(w)}`)
  if (!result.ok) {
    console.error(`FAIL — validate (emitted form): ${result.errors.length} error(s)`)
    for (const e of result.errors.slice(0, 60)) console.error(`  ${formatError(e).replaceAll('\n', '\n  ')}`)
    return 1
  }
  // P3-S0 guard contract (AMENDMENTS-008 B37): every emitted archetype weapon passes the sim's own guard
  const labRefused = weaponDetails.flatMap((w) => {
    if (w.labBehavior.kind !== 'archetype') return []
    const verdict = assessWeapon(w)
    return verdict.simulable ? [] : [`${w.name} (i:${w.id}): ${verdict.refusal.reason} — ${verdict.refusal.message}`]
  })
  if (labRefused.length > 0) {
    console.error(`FAIL — Weapon Lab guard contract: ${labRefused.length} emitted archetype weapon(s) are refused by src/sim assessWeapon`)
    for (const line of labRefused) console.error(`  ${line}`)
    return 1
  }

  // sprite manifest (public/, committed; binaries are local-only). B30: files over 100 KB list a thumbnail.
  const spriteFiles = [...weapons.sprites, ...bosses.sprites, ...ammo.sprites, ...armor.sprites, ...accessories.sprites].map((f) => {
    const thumbnail = thumbnailFor(f)
    return thumbnail ? { ...f, thumbnail } : f
  })
  const spriteManifest = SpriteManifest.parse({ fallbackMode: false, rightsNote: SPRITE_RIGHTS_NOTE, files: spriteFiles.sort((a, b) => a.path.localeCompare(b.path)) })
  const heavyWithoutThumbnail = spriteManifest.files.filter((f) => f.bytes > THUMBNAIL_MIN_BYTES && !f.thumbnail)
  for (const f of heavyWithoutThumbnail) console.log(`  [W_THUMBNAIL] ${f.path}: ${f.bytes} B but the thumbnail generator decodes GIF only — no thumbnail listed`)
  const spritePaths = new Set(spriteManifest.files.map((f) => f.path))
  const usedSprites = [...weaponDetails, ...first.dataset.bosses, ...itemDetails, ...armorDetails, ...accessoryDetails].flatMap((r) => (r.sprite ? [r.sprite] : []))
  const unlisted = usedSprites.filter((p) => !spritePaths.has(p))
  if (unlisted.length > 0 || spritePaths.size !== spriteManifest.files.length || usedSprites.length !== spritePaths.size) {
    console.error(`FAIL — sprite manifest: ${unlisted.length} sprite path(s) missing from the manifest, or duplicate / unused paths`)
    return 1
  }
  const spriteManifestText = `{"fallbackMode":${JSON.stringify(spriteManifest.fallbackMode)},"rightsNote":${JSON.stringify(spriteManifest.rightsNote)},"files":${serializeRecords(spriteManifest.files).trimEnd()}}\n`

  const files = new Map<string, string>([
    [MANIFEST_FILE, serializeObject(manifest)],
    [ITEM_UNIVERSE_FILE, `{"source":${JSON.stringify(universe.source)},"items":${serializeRecords(universe.items).trimEnd()}}\n`],
    [STAGE_GAPS_FILE, serializeRecords(stageGaps)],
    [collectionFile('weapons'), serializeRecords(weaponDetails)],
    [LIST_FILES.weapons, serializeRecords(weaponList)],
    [collectionFile('items'), serializeRecords(itemDetails)],
    [LIST_FILES.items, serializeRecords(itemList)],
    [collectionFile('buffs'), serializeRecords(first.dataset.buffs)],
    [collectionFile('armor'), serializeRecords(armorDetails)],
    [LIST_FILES.armor, serializeRecords(armorList)],
    [collectionFile('accessories'), serializeRecords(accessoryDetails)],
    [LIST_FILES.accessories, serializeRecords(accessoryList)],
    [collectionFile('armorSets'), serializeRecords(setDetails)],
    [SEARCH_DOCS_FILE, serializeRecords(searchDocs)],
    [collectionFile('recipes'), serializeRecords(recipes.recipes)],
    [collectionFile('recipeGroups'), serializeRecords(recipes.groups)],
    [collectionFile('drops'), serializeRecords(drops.drops)],
    [collectionFile('enemies'), serializeRecords(enemies.enemies)],
    [collectionFile('conditions'), serializeRecords(conditions)],
    [collectionFile('bosses'), serializeRecords(first.dataset.bosses)],
    ['progression.json', `{"nodes":${serializeRecords(first.dataset.nodes).trimEnd()},"edges":${serializeRecords(first.dataset.edges).trimEnd()}}\n`],
    ['meta.json', serializeObject(result.meta)],
    ['gaps.json', `{"generatedAt":${JSON.stringify(result.gaps.generatedAt)},"gameVersion":${JSON.stringify(result.gaps.gameVersion)},"summary":${JSON.stringify(result.gaps.summary)},"entries":${serializeRecords(result.gaps.entries).trimEnd()}}\n`],
  ])
  const budget = checkBudgets(files)
  if (budget.errors.length > 0) {
    for (const e of budget.errors) console.error(`  ${formatError(e)}`)
    return 1
  }

  const owned = new Set<string>([MANIFEST_FILE, ITEM_UNIVERSE_FILE, STAGE_GAPS_FILE, SEARCH_DOCS_FILE, ...OUTPUT_FILES, ...Object.values(LIST_FILES), ...Object.values(COLLECTIONS).map((c) => c.file.split('#')[0]), 'weapons.json'])
  writeFiles(outDir, files, (f) => owned.has(f))
  mkdirSync(dirname(spriteManifestPath), { recursive: true })
  writeFileSync(spriteManifestPath, spriteManifestText)

  // ---- human-readable gap report ----
  const logPath = join(RAW_DIR, 'requests.log.jsonl')
  const networkAttempts = existsSync(logPath) ? readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).length : 0
  const r = recipes.ledger
  const d = drops.ledger
  const idn = weapons.identification
  const cat = reconcileCategories(sync.weaponCategories, sync.tables.Items.rows, weaponDetails, idn, weapons.pageOf)
  const lists = reconcileWeaponLists(sync.tables.Weapon_source.rows, sync.tables.Items.rows, weaponDetails, idn)
  const byClass = new Map<string, number>()
  for (const w of weaponDetails) byClass.set(w.damageClass ?? 'Unknown', (byClass.get(w.damageClass ?? 'Unknown') ?? 0) + 1)
  const excludedByKind = new Map<string, number>()
  for (const e of idn.excluded) excludedByKind.set(e.kind, (excludedByKind.get(e.kind) ?? 0) + 1)
  const xc = (field: string) => weapons.crossCheck.get(field) ?? { agree: 0, mismatch: 0, noWikiValue: 0 }
  const useAnim = xc('useAnimationTicks (wiki "Use time")')
  const useTimeVsWiki = xc('useTimeTicks vs wiki "Use time"')
  const crit = xc('critPct (+4% base)')
  const summonCrit = xc('critPct (summon: wiki shows none)')
  const velocity = xc('shootSpeed vs wiki "Velocity" (not cross-checked: different quantity)')
  const rarity = xc('rarity')
  const specialRarityWeapons = weaponDetails.filter((w) => typeof w.rarity === 'string').length
  const ammoClasses = [...new Set(weaponDetails.flatMap((w) => (w.ammoClass ? [w.ammoClass] : [])))].sort()
  const sum = (n: number[]) => n.reduce((a, b) => a + b, 0)
  const bucketRows: [string, number][] = (Object.keys(PAGE_BUCKET_LABEL) as PageBucket[]).map((k) => [`− ${PAGE_BUCKET_LABEL[k]}`, cat.buckets[k].length])
  const pageWeaponCounts = new Map<string, number>()
  for (const p of weapons.pageOf.values()) pageWeaponCounts.set(p, (pageWeaponCounts.get(p) ?? 0) + 1)
  const multiItemPages = [...pageWeaponCounts].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const rarities = weaponDetails.flatMap((w) => (typeof w.rarity === 'number' ? [w.rarity] : []))
  const zenith = weaponDetails.find((w) => w.id === 4956)
  const classlessCount = byClass.get('other') ?? 0
  const list = (xs: readonly string[], max = 400) => (xs.length === 0 ? 'none' : xs.length > max ? `${xs.slice(0, max).join('; ')}; … (+${xs.length - max})` : xs.join('; '))

  // ---- P3-S0 report inputs ----
  const pct = (n: number, d: number) => (d === 0 ? '—' : `${((100 * n) / d).toFixed(1)}%`)
  const labCoverage = coverageByFamily(lab.decisions, new Map(weaponDetails.map((w) => [w.id, w])))
  const labArchetypeTotal = weaponDetails.filter((w) => w.labBehavior.kind === 'archetype').length
  const labWithParams = lab.decisions.filter((d) => d.method !== 'limitation').length
  const B36_MELEE = ['swing-melee', 'thrust', 'returning']
  const b36Fields = (archetype: string) => ['useAnimationTicks', ...(B36_MELEE.includes(archetype) ? ['autoReuse'] : [])]
  const labB36 = lab.decisions.flatMap((d) => (d.pipelineBlocked && d.archetype ? [{ name: d.name, archetype: d.archetype, fields: d.pipelineBlocked }] : []))
  const labB36Only = labB36.filter((x) => x.fields.every((p) => isCoveredBy(b36Fields(x.archetype), p) || b36Fields(x.archetype).some((f) => isCoveredBy([p], f))))
  const labB36Sensitive = weaponDetails.flatMap((w) => {
    const fields = w._prov.unverifiedFields.filter((f) => f === 'useAnimationTicks' || f === 'autoReuse')
    return fields.length ? [{ name: w.name, fields, family: lab.decisions.find((d) => d.id === w.id)?.family, lab: w.labBehavior.kind }] : []
  })
  const labFlagCounts = new Map<string, number>()
  for (const d of lab.decisions) for (const id of new Set(d.flags.map((f) => f.id))) labFlagCounts.set(id, (labFlagCounts.get(id) ?? 0) + 1)
  const LAB_REASON_LABEL: Record<string, string> = {
    flagged: 'article/data describe behavior beyond the plain archetype — not reviewed yet',
    overlay: 'reviewed: the article documents behavior the archetype params cannot express (overlay)',
    'thrust-reach-undocumented': 'thrust reach undocumented (stab projectile travel distance)',
    'not-swing': 'game data is not a plain swing (use style / no contact damage / held use)',
    'not-bow-gun': 'game data is not a plain ammo-firing weapon',
    'not-magic-bolt': 'game data is not a plain magic projectile',
    'no-sprite': 'no sprite / scale to derive the swing reach',
    'reuse-delay': 'cooldown after each use (Iteminfo reuseDelay) not in the Lab cadence',
    'velocity-mismatch': 'wiki infobox velocity disagrees with Iteminfo × Projectileinfo',
    ...Object.fromEntries(['unverified-required-field', 'missing-required-field', 'invalid-data', 'modifier-not-implemented'].map((r) => [`guard:${r}`, `sim guard refusal (${r})`])),
  }

  // ---- P2-S7 report inputs ----
  const xcA = (field: string) => ammo.crossCheck.get(field) ?? { agree: 0, mismatch: 0, noWikiValue: 0 }
  const xcB = (field: string) => buffs.crossCheck.get(field) ?? { agree: 0, mismatch: 0, noWikiValue: 0 }
  const aIdn = ammo.identification
  const dualRole = weaponDetails.filter((w) => w.ammoStats)
  const ammoRecords = [...itemDetails, ...dualRole]
  const iteminfoAmmo = [...iteminfo.items.values()].filter((i) => (i.stats as Record<string, unknown>).ammo !== 0)
  const aCat = reconcileCategories(sync.ammoCategories, sync.tables.Items.rows, ammoRecords, aIdn, ammo.pageOf)
  const aBucketRows: [string, number][] = (Object.keys(PAGE_BUCKET_LABEL) as PageBucket[]).map((k) => [`− ${PAGE_BUCKET_LABEL[k].replaceAll('weapon', 'ammo')}`, aCat.buckets[k].length])
  const aExcludedByKind = new Map<string, number>()
  for (const e of aIdn.excluded) aExcludedByKind.set(e.kind, (aExcludedByKind.get(e.kind) ?? 0) + 1)
  const ammoByClass = new Map<string, string[]>()
  for (const r of ammoRecords) ammoByClass.set(r.ammoStats?.ammoClass ?? '?', [...(ammoByClass.get(r.ammoStats?.ammoClass ?? '?') ?? []), r.name])
  const statusOf = (r: { _prov: { unverifiedFields: string[] } }, field: string, value: unknown) => (value !== undefined ? String(value) : r._prov.unverifiedFields.includes(field) ? 'Unknown' : 'n/a')
  // B22: stage of every derived record with and without node.unlocksStage
  const nodeById = new Map(first.dataset.nodes.map((n) => [n.id, n]))
  const transitions = first.dataset.nodes.filter((n) => n.unlocksStage)
  const plainStage = (g: { bosses: string[] }) => g.bosses.reduce<keyof typeof STAGE_ORDER>((s, b) => { const st = nodeById.get(b)?.stage ?? 'early-prehm'; return STAGE_ORDER[st] > STAGE_ORDER[s] ? st : s }, 'early-prehm')
  const derivedRecords = [...weaponDetails, ...itemDetails].filter((r) => r.gatedBy)
  const b22Moved = derivedRecords.filter((r) => r.gatedBy && plainStage(r.gatedBy) !== r.gatedBy.stage)
  const multiplierBuckets = new Map<string, number>()
  for (const v of [...ammo.multiplier.values()].sort()) {
    const k = /^\d/.test(v) ? 'stated on the own infobox' : v.replace(/; Projectileinfo [^)]*\)$/, ', Projectileinfo agrees)')
    multiplierBuckets.set(k, (multiplierBuckets.get(k) ?? 0) + 1)
  }
  const stageCounts = (stage: (r: (typeof derivedRecords)[number]) => string) => (Object.keys(STAGE_ORDER) as (keyof typeof STAGE_ORDER)[]).map((st) => `${st} ${weaponDetails.filter((w) => w.gatedBy && stage(w) === st).length}`).join(', ')

  // ---- P2-S8 report inputs ----
  const esc = (t: string) => t.replaceAll('|', '\\|').replaceAll('\n', ' / ')
  const itemRowsAll = sync.tables.Items.rows
  const typedArmorRows = itemRowsAll.filter((r) => itemTypeIncludes(r, 'armor')).length
  const iiStats = (i: { stats: Readonly<Record<string, unknown>> }) => i.stats as Record<string, unknown>
  const iteminfoArmor = [...iteminfo.items.values()].filter((i) => iteminfoArmorSlot(i) && iiStats(i).vanity !== true)
  const iteminfoAccessories = [...iteminfo.items.values()].filter((i) => iiStats(i).accessory === true)
  const iteminfoFunctionalAcc = iteminfoAccessories.filter((i) => iiStats(i).vanity !== true)
  const emittedEquipIds = new Set([...armorDetails, ...accessoryDetails].map((r) => r.id))
  const iteminfoEquipOnly = [...iteminfoArmor, ...iteminfoFunctionalAcc].filter((i) => !emittedEquipIds.has(i.id))
  const armorCat = reconcileCategories(sync.armorCategories, itemRowsAll, armorDetails, armor.identification, armor.pageOf)
  const accCat = reconcileCategories(sync.accessoryCategories, itemRowsAll, accessoryDetails, accessories.identification, accessories.pageOf, accessories.vanityRows)
  const bucketTable = (c: typeof armorCat, noun: string): [string, number][] => (Object.keys(PAGE_BUCKET_LABEL) as PageBucket[]).map((k) => [`− ${PAGE_BUCKET_LABEL[k].replaceAll('weapon', noun)}`, c.buckets[k].length])
  const armorBuckets = bucketTable(armorCat, 'armor')
  const accBuckets = bucketTable(accCat, 'accessory')
  const setCategoryPages = new Set([...sync.armorCategories.categories].filter(([t]) => t.startsWith('Category:Armor sets')).flatMap(([, c]) => c.pages))
  const setReportPages = new Set(armor.setReport.map((r) => r.page))
  const setPagesOutsideCategory = [...setReportPages].filter((p) => !setCategoryPages.has(p)).sort()
  const categorySetPagesWithoutRow = [...setCategoryPages].filter((p) => !setReportPages.has(p)).sort()
  const slotCount = (slot: string) => armorDetails.filter((p) => p.slot === slot).length
  const tinkererRecipes = recipes.recipes.filter((r) => r.stations.some((s) => s.kind === 'item' && s.itemId === TINKERERS_WORKSHOP_ITEM_ID))
  const accessoryIdSet = new Set(accessoryDetails.map((a) => a.id))
  const tinkererToAccessory = tinkererRecipes.filter((r) => accessoryIdSet.has(r.resultItemId))
  const tinkeringLinks = accessoryDetails.reduce((n, a) => n + a.combinedFrom.length, 0)
  const ruleUsage = (id: string) => [armor.ruleCounts.get(id)?.count ?? 0, accessories.ruleCounts.get(id)?.count ?? 0] as const
  const ruleExample = (id: string) => armor.ruleCounts.get(id)?.example ?? accessories.ruleCounts.get(id)?.example
  const proposals = new Map<string, { rules: string[]; lines: number; examples: string[] }>()
  for (const r of EFFECT_RULES) {
    const proposed = r.kind === 'special' ? r.proposed : r.kind === 'stat' ? r.remainder?.proposed : undefined
    if (!proposed) continue
    const [a, b] = ruleUsage(r.id)
    const p = proposals.get(proposed) ?? { rules: [], lines: 0, examples: [] }
    p.rules.push(r.id)
    p.lines += a + b
    const ex = ruleExample(r.id)
    if (ex) p.examples.push(`${ex.name}: "${ex.line}" (${ex.url})`)
    proposals.set(proposed, p)
  }
  const equipOutcomes = (m: ReadonlyMap<number, { outcome: string }>) => {
    const out = new Map<string, number>()
    for (const v of m.values()) out.set(v.outcome, (out.get(v.outcome) ?? 0) + 1)
    return ['agree', 'partial', 'disagree', 'no-equipinfo-row'].map((k) => `${k} ${out.get(k) ?? 0}`).join(', ')
  }
  const nameOfEquip = new Map([...armorDetails, ...accessoryDetails].map((r) => [r.id, r.name]))
  const partialLines = [...armor.equip, ...accessories.equip]
    .filter(([, x]) => x.outcome === 'partial')
    .map(([id, x]) => `${nameOfEquip.get(id)} (${id}): ${[...(x.textOnly.length ? [`game text only: ${x.textOnly.join(', ')}`] : []), ...(x.equipinfoOnly.length ? [`Equipinfo only: ${x.equipinfoOnly.join(', ')}`] : [])].join('; ')}`)
  const wingSlotOf = (id: number): unknown => (iteminfo.items.get(id)?.stats as Record<string, unknown> | undefined)?.wingSlot
  const wingRecords = accessoryDetails.filter((a) => {
    const slot = wingSlotOf(a.id)
    return typeof slot === 'number' && slot > 0
  })
  const unknownEffectAccessories = accessoryDetails.filter((a) => a._prov.unverifiedFields.includes('effects'))
  const pieceById = new Map(armorDetails.map((p) => [p.id, p]))
  const effectText = (e: { kind: string; stat?: string; value?: number; scope?: string; text?: string }) => (e.kind === 'stat' ? `${e.stat} ${e.value}${e.scope ? ` (${e.scope})` : ''}` : `special "${e.text}"`)
  const byKind = (idn: { excluded: readonly { kind: string }[] }) => {
    const m = new Map<string, number>()
    for (const e of idn.excluded) m.set(e.kind, (m.get(e.kind) ?? 0) + 1)
    return [...m].sort()
  }
  const iteminfoArmorOnly = iteminfoEquipOnly.filter((i) => iteminfoArmor.includes(i))
  const iteminfoAccOnly = iteminfoEquipOnly.filter((i) => iteminfoFunctionalAcc.includes(i))
  const iiName = (i: { id: number; name?: string; internalName: string }) => `${i.name ?? i.internalName} (${i.id})`
  const accRowById = new Map(accessories.identification.included.map((c) => [c.item.id, c.row]))
  const setlessPieces = armorDetails.filter((p) => !p.setId)
  const withheldSetPages = new Set(armor.setReport.filter((r) => r.outcome === 'withheld').map((r) => r.page))
  const cycles = accessoryDetails.flatMap((a) => a.combinedFrom.filter((b) => b > a.id && accessoryDetails.find((x) => x.id === b)?.combinedFrom.includes(a.id)).map((b) => `${a.name} ↔ ${nameOfEquip.get(b)}`))
  const groupOnlyTinkerer = tinkererToAccessory.filter((r) => r.ingredients.some((i) => i.ref.kind === 'group'))
  const armorXc = (field: string) => armor.crossCheck.get(field) ?? { agree: 0, mismatch: 0, noWikiValue: 0 }
  const accXc = (field: string) => accessories.crossCheck.get(field) ?? { agree: 0, mismatch: 0, noWikiValue: 0 }
  const setRowsByPage = new Map<string, number>()
  for (const r of armorSetRows(itemRowsAll)) setRowsByPage.set(String(r._page ?? ''), (setRowsByPage.get(String(r._page ?? '')) ?? 0) + 1)
  const multiRowSetPages = [...setRowsByPage].filter(([, n]) => n > 1).sort()
  const statKinds = new Set<string>(StatKind.options)
  const reconciles = (a: number, b: number) => (a === b ? '(reconciles)' : '(DOES NOT RECONCILE)')
  const ruleEmits = (r: (typeof EFFECT_RULES)[number]) => (r.kind === 'flavor' ? 'nothing (flavor / explanation)' : r.kind === 'special' ? `special${r.proposed ? ` — would be a stat under "${r.proposed}"` : ''}` : `stat${r.remainder ? ` + special (remainder${r.remainder.proposed ? `; "${r.remainder.proposed}"` : ''})` : ''}`)

  const resolutions = [
    {
      id: '#4 NPCs table per-difficulty hp/defense',
      text: `Cargo NPCs \`life\` / \`defense\` / \`damage\` are rendered infobox cells: a per-difficulty block (\`npcstat\` or \`mode-content\` with m-normal / m-expert / m-master / m-expert-master / m-all spans), or a bare integer for every difficulty (6 of 1,538 cells). Additional lines are alternative values (enraged, per-health, with minions) or — after a "(contact)" note — projectile damages; cells can carry the wiki's "based on outdated versions of Terraria's source code" category flag. pipeline/parse/npcStats.ts keeps only one integer per difficulty and withholds everything else; a boss difficulty is emitted only with both hp and defense verified (${bosses.stats.filter((r) => Object.values(r.byDifficulty).some((v) => v !== 'Unknown')).length}/${bosses.stats.length} bosses).`,
    },
    {
      id: '#1 Cargo Items columns / class / rarity',
      text: `Cargo Items has ${Object.keys(sync.tables.Items.fields).length} columns (${Object.keys(sync.tables.Items.fields).join(', ')}). \`type\` is a ^-list of infobox types ("weapon", "tool", "ammunition", …); \`damagetype\` is the class as text (Melee/Ranged/Magic/Summon, empty for classless) and agrees with the Iteminfo class flags for every identified weapon (${xc('damageClass').agree} agree, ${xc('damageClass').mismatch} mismatch, ${xc('damageClass').noWikiValue} with no wiki class: ${classlessCount} classless in both sources, ${xc('damageClass').noWikiValue - classlessCount} with an Iteminfo class only); \`rare\` is the game rarity number (plain or wrapped in the rarity template "Rarity level: N"; ${rarity.agree}/${rarity.agree + rarity.mismatch} weapons agree with Iteminfo); \`critical\` = 4 + Iteminfo crit (${crit.agree} agree, ${crit.mismatch} mismatch); \`usetime\` = Iteminfo useAnimation; \`velocity\` is the effective projectile velocity (equals Iteminfo shootSpeed for ${velocity.agree} weapons, differs for ${velocity.mismatch} — extra updates / ammo), so it is not cross-checked. \`tag\` carries vendor:<NPC> (purchase routes), \`listcat\` route hints; \`stack\` reports 9999 for weapons (B7 — maxStack only for consumable weapons, from Iteminfo).`,
    },
    {
      id: '#9 special rarity tiers',
      text: `Module:Iteminfo/data \`rare\`: -1 gray, 0–11 numeric tiers, -11 amber (quest fish + Strange Plants), -12 rainbow (Expert items; flag expert:true, base tier in \`rarity\`), -13 fiery red (Master items). Cargo \`rare\` uses the same numbers (Shield of Cthulhu -12, Eye of Cthulhu Relic -13). Mapped to Rarity -1..11 | "amber" | "rainbow" | "fiery-red"; ${specialRarityWeapons} weapons use a special tier (weapon rarities span ${Math.min(...rarities)}–${Math.max(...rarities)}).`,
    },
    {
      id: '#10 useTime vs useAnimation',
      text: `The wiki's "Use time" equals Iteminfo useAnimation for ${useAnim.agree}/${useAnim.agree + useAnim.mismatch} weapons with a wiki value (useTime differs from the wiki value for ${useTimeVsWiki.mismatch}${zenith ? `, e.g. Zenith useTime ${zenith.useTimeTicks} / useAnimation ${zenith.useAnimationTicks}` : ''}). useAnimation = length of one use (attack cycle); useTime = interval between successive uses/shots within it (bursts, multi-swing projectiles). Emitted: useTimeTicks = useTime, useAnimationTicks = useAnimation (both always present). Display "Use time" from useAnimationTicks (wiki parity); attack cycles per second = 60 / useAnimationTicks; useAnimationTicks was added to the weapons list projection for that reason.`,
    },
    {
      id: '#11 ammo damage / velocity modifier location (RESOLVED, P2-S7)',
      text: `A weapon's ammo class is Iteminfo \`useAmmo\` = the game's AmmoID, i.e. the item ID of the class's representative item (40 Wooden Arrow, 97 Musket Ball, 771 Rocket I, 23 Gel …); ammo items carry the same value in \`ammo\` plus their own \`damage\`, \`knockBack\` and \`shootSpeed\`, which the game adds to the weapon's (Cargo Items \`damage\` / \`knockback\` / \`velocity\` = the same base values: ${xcA('ammoStats.damage').agree} / ${xcA('ammoStats.knockback').agree} / ${xcA('ammoStats.velocityBonusTps (shootSpeed vs wiki base velocity)').agree} ammo records agree, ${xcA('ammoStats.damage').mismatch + xcA('ammoStats.knockback').mismatch + xcA('ammoStats.velocityBonusTps (shootSpeed vs wiki base velocity)').mismatch} mismatches). ammoClass = slug of the representative item's name (${ammoClasses.length} classes among weapons: ${ammoClasses.join(', ')}; every one matched by ≥1 ammo record — §7a-10 is a hard check again). The velocity MULTIPLIER (B2) is the ammo projectile's \`extraUpdates\` + 1: Module:Projectileinfo/data rev ${projectileinfo.rev} (generated ${projectileinfo.generated}) carries extraUpdates per projectile, and the wiki's item infobox shows "Velocity Multiplier N×" (linked to Velocity#extraUpdates) — emitted from the item's own infobox, cross-checked with Projectileinfo (${xcA('ammoStats.velocityMultiplier (infobox vs 1 + extraUpdates)').agree} agree, ${xcA('ammoStats.velocityMultiplier (infobox vs 1 + extraUpdates)').mismatch} mismatch). Iteminfo \`shoot\` is NOT always a projectile for ammo (rockets and solutions store a type index: Rocket II "shoots" projectile 3), so Projectileinfo is never joined without the infobox naming the projectile. Per-weapon ammo conversions (Uzi → High Velocity Bullets, …) are weapon behaviors (P3 archetype params).`,
    },
    {
      id: '#12 structured buff-ID source (RESOLVED, P2-S7)',
      text: `The wiki article "Buff IDs" (rev ${buffTable.rev}) is a table of every game buff: ID, name, internal name and type (Buff / Debuff), each name linking its article (${buffTable.rows.length} named rows; potion buffs link their potion's page, e.g. Ironskin → Ironskin Potion). Buff articles repeat the ID in their infobox ("Buff ID" on buff pages, "Internal Buff ID" on potion/weapon pages) — ${xcB('gameBuffId (Buff IDs table vs article)').agree} agree, ${xcB('gameBuffId (Buff IDs table vs article)').mismatch} mismatch, ${xcB('gameBuffId (Buff IDs table vs article)').noWikiValue} articles state none. Iteminfo \`buffType\` (the buff an item grants) is the same ID (Ale → 25 Tipsy). One name can cover several IDs (Zapped 399 / 400) → gameBuffId Unknown. Debuff articles state damage over time in their infobox "Effects" row per target ("−24 health per second (on enemies)" / "(on players)"; unqualified = every entity) → Buff.dot.dps is the enemy value.`,
    },
    {
      id: 'D1 caveat: 1.4.5.7 → 1.4.5.8 patch diff',
      text: 'The 1.4.5.8 patch notes (wiki page "1.4.5.8", rev 1029883) name three weapons — Clay Bud Staff (now always knocks enemies away), Last Prism (laser fades without enough mana), Acorn Slingshot (crash fix) — all behavioral; no numeric item stat changed, so no extracted field is in the patch-diff set. The Cargo cross-check above is the re-confirmation for every compared field.',
    },
    {
      id: 'critPct for summon weapons',
      text: `The wiki's Critical hit page (rev 1032172) states summon damage cannot normally deal critical hits, and the infobox shows no crit for all ${summonCrit.agree} summon weapons; critPct is therefore not applicable (absent, not listed). Classless weapons show no crit either but no rule is documented → Unknown.`,
    },
    {
      id: '#5 Equipinfo columns (defense, tooltip, wing flight time) (RESOLVED, P2-S8)',
      text: `Cargo Equipinfo (${Object.keys(sync.equipinfo.fields).length} columns, ${sync.equipinfo.rows.length} rows on Template:GetEquipInfo/db) is the wiki's transcription of the game's UpdateEquip effect code per item: class damage as fractions (meleeDamage "+0.1"), crit / mana / minion slots as integers, moveSpeed, endurance, pickSpeed, whipRangeMultiplier, flags (noKnockback, fireWalk, buffImmune lists, accRunSpeed …). It has NO defense, tooltip or wing flight-time column: defense comes from Module:Iteminfo/data \`defense\` (cross-checked with the Cargo Items infobox: armor ${armorXc('defense').agree} agree / ${armorXc('defense').mismatch} mismatch; accessories ${accXc('defense').agree} / ${accXc('defense').mismatch}), the tooltip from Cargo Items \`tooltip\` (game text), and flight time from the "Wings" article list table (Iteminfo \`wingSlot\` only names the wing). ${accessories.unattributedEquipinfoRows} Equipinfo rows carry no item ID (effect code shared by several items). Equipinfo is therefore the cross-check of the tooltip-derived stats, not their source.`,
    },
    ...STATIC_RESOLUTIONS,
  ]

  const sections = [
    {
      title: 'Weapons — identification and count reconciliation',
      lines: [
        '| Step | Count |',
        '|---|---:|',
        `| Cargo Items rows (all types) | ${sync.tables.Items.rows.length} |`,
        `| rows whose infobox type contains "weapon" | ${idn.typedRows} |`,
        ...[...excludedByKind].sort().map(([k, n]) => `| − excluded (${k}; one gap entry each) | ${n} |`),
        `| **= weapons emitted** | **${weaponDetails.length}** |`,
        ...[...byClass].sort().map(([k, n]) => `|   ${k} | ${n} |`),
        '',
        `**Wiki category tree** — roots ${sync.weaponCategories.roots.join(' + ')}: ${cat.treeCategories} categories, ${cat.treePages} distinct articles (${cat.rootTitle} alone: ${cat.rootPages} articles).`,
        '',
        '| Category-tree articles | Count |',
        '|---|---:|',
        `| articles in the tree | ${cat.treePages} |`,
        ...bucketRows.map(([k, n]) => `| ${k} | ${n} |`),
        `| = check: ${sum(bucketRows.map(([, n]) => n))} classified + 0 unclassified | ${cat.treePages - sum(bucketRows.map(([, n]) => n)) === 0 ? 'OK' : 'MISMATCH'} |`,
        `| weapons hosted by the ${cat.buckets['weapon-article'].length} weapon articles (${multiItemPages.length} articles host several: ${multiItemPages.map(([p, n]) => `${p} ${n}`).join(', ')}) | ${cat.weaponsOnTreePages} |`,
        `| + emitted weapons whose article is outside the tree | ${cat.weaponsOutsideTree.length} |`,
        `| **= weapons emitted** | **${cat.weaponsOnTreePages + cat.weaponsOutsideTree.length}** ${cat.weaponsOnTreePages + cat.weaponsOutsideTree.length === weaponDetails.length ? '(reconciles)' : '(DOES NOT RECONCILE)'} |`,
        '',
        `Non-weapon item articles in the tree, by infobox type: ${[...cat.nonWeaponTypes].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join('; ')}. The wiki files tools (pickaxes, axes, hammers, chainsaws, drills) under the melee weapon categories because they deal damage; their infobox type is "tool", so they belong to the item corpus (P6-S0), not the weapons dataset.`,
        '',
        `- Excluded-row articles: ${list(cat.buckets['excluded-weapon-rows'])}`,
        `- Articles without an item infobox: ${list(cat.buckets['no-item-infobox'])}`,
        `- Redirects: ${list(cat.buckets.redirect)}`,
        `- Missing pages: ${list(cat.buckets['missing-page'])}`,
        `- Emitted weapons outside the tree: ${list(cat.weaponsOutsideTree)}`,
        '',
        `**Wiki weapon list pages** (Cargo Weapon_source, English rows on ${lists.listPages.join(', ')}): ${lists.rows} rows, ${lists.names} distinct names; ${lists.both} are emitted weapons; ${lists.listOnly.length} listed names are not emitted; ${lists.emittedOnly.length} emitted weapons are not on any list page.`,
        '',
        `- Listed but not emitted: ${list(lists.listOnly.map((x) => `${x.name} (${x.why})`))}`,
        `- Emitted but not listed: ${list(lists.emittedOnly)}`,
        '',
        `**Iteminfo signal** (damage > 0 + a class flag, not ammo/tool/armor/accessory) not typed "weapon" by the wiki: ${idn.untypedIteminfoCandidates.length} — ${list(idn.untypedIteminfoCandidates.map((i) => `${i.name ?? i.internalName} (${i.id})`))}. Not emitted (the wiki's item type decides; listed for review).`,
      ],
    },
    {
      title: 'Weapons — Cargo vs Iteminfo cross-check',
      lines: [
        '| Field | Agree | Mismatch (value withheld) | No wiki value |',
        '|---|---:|---:|---:|',
        ...[...weapons.crossCheck].map(([f, c]) => `| ${f} | ${c.agree} | ${c.mismatch} | ${c.noWikiValue} |`),
        '',
        'Every mismatch is a `source-mismatch` gap (listed below) and the field renders Unknown. The two "not a cross-check" rows are evidence only (TO-VERIFY #1/#10).',
      ],
    },
    {
      title: 'Weapons — why gatedBy / stage are Unknown (§7b blockers)',
      lines: [
        `gatedBy derived: ${weaponDetails.filter((w) => w.gatedBy).length}/${weaponDetails.length} (P2-S2: 0/${weaponDetails.length}, before the boss registry and progression graph existed). A route is derivable only when every input in its chain is verified: boss drops (incl. treasure bags) now gate on their boss node, conditions with satisfiedByNode on their node, transitively reduced over the required-gate DAG; enemy and event-boss stages are Unknown and base materials have no acquisition data yet (P6-S0), so those chains stay underivable. Derived weapons by stage: ${(Object.keys(STAGE_ORDER) as (keyof typeof STAGE_ORDER)[]).map((st) => `${st} ${weaponDetails.filter((w) => w.gatedBy?.stage === st).length}`).join(', ')}. Each weapon below is Unknown → never "obtainable now" (A3 safe direction).`,
        '',
        '| Blockers met on every route | Weapons | Examples |',
        '|---|---:|---|',
        ...[...weapons.gatingBlockers].sort((a, b) => b[1].count - a[1].count).map(([k, v]) => `| ${k} | ${v.count} | ${v.examples.join('; ')} |`),
        '',
        ...(Object.entries(GATING_BLOCKERS) as [GatingBlocker, string][]).map(([k, v]) => `- **${k}**: ${v}`),
      ],
    },
    {
      title: 'Bosses — stats per difficulty (Cargo NPCs) and why the rest is Unknown',
      lines: [
        'hp / defense / contact damage of the representative Cargo NPCs row (pipeline/overlays/bosses.json `primary`) — the NPC\'s BASE stats as in the article\'s first infobox. Later-phase changes shown only in secondary infoboxes (e.g. second-form defense of Eye of Cthulhu, Plantera, Empress of Light) are not modeled. Bosses whose simultaneous parts have different stats (Wall of Flesh mouth/eyes, segments, Twins, Golem, Moon Lord) are Unknown rather than represented by one part. "none" = the wiki gives 0 contact damage (not applicable); Unknown = absent + listed in _prov.unverifiedFields.',
        '',
        '| Boss | Classic | Expert | Master | Why (Unknown parts) |',
        '|---|---|---|---|---|',
        ...bosses.stats.map((r) => `| ${r.name} | ${r.byDifficulty.classic} | ${r.byDifficulty.expert} | ${r.byDifficulty.master} | ${r.reasons.join('; ').replaceAll('|', '\\|') || '—'} |`),
        '',
        `Attack-pattern tags (editorial, A1 staging — each backed by a verbatim behavior quote): ${first.dataset.bosses.map((b) => `${b.name} ${b.attackPatternTags?.length ?? 0}`).join(', ')}. Location time Unknown (no quote states it): ${first.dataset.bosses.filter((b) => !b.location.time).map((b) => b.name).join(', ') || 'none'}. prepChecklist / suggestedEquipment / strategies are absent + listed on every boss (P5 overlays, E_BOSS_CURATION gate).`,
      ],
    },
    {
      title: 'Progression graph — typed edges with provenance',
      lines: [
        'Each edge note is a verbatim quote of its source article (checked against the cached revision at build). Edges model one world (pipeline/overlays/progression.json notes).',
        '',
        '| From | To | Type | Source |',
        '|---|---|---|---|',
        ...first.dataset.edges.map((e) => `| ${e.from} | ${e.to} | ${e.type} | ${e.sourceUrl} |`),
        '',
        `Nodes without edges: ${first.dataset.nodes.filter((n) => !first.dataset.edges.some((e) => e.from === n.id || e.to === n.id)).map((n) => n.id).join(', ') || 'none'}.`,
      ],
    },
    {
      title: 'Stage-transition gates (AMENDMENTS-005 B22)',
      lines: [
        `§7b stage = max over the gating nodes of (unlocksStage ?? stage). Stage-transition nodes: ${transitions.map((n) => `${n.id} (${n.stage} → unlocks ${n.unlocksStage})`).join(', ') || 'none'} — each validated against a required-gate edge into a milestone of that stage. Mechanical bosses set none: one mech boss does not open mid-hm (the all-mechanical-bosses milestone does); Plantera / Golem are mid-hm nodes whose drops are mid-hm already.`,
        '',
        `Derived weapon stages without unlocksStage: ${stageCounts((w) => plainStage(w.gatedBy as { bosses: string[] }))}. With it (emitted): ${stageCounts((w) => (w.gatedBy as { stage: string }).stage)}.`,
        '',
        `Records whose stage moved: ${list(b22Moved.map((x) => `${x.name} (${x.type}, ${plainStage(x.gatedBy as { bosses: string[] })} → ${x.gatedBy?.stage}; gated by ${x.gatedBy?.bosses.join(', ')})`))}.`,
      ],
    },
    {
      title: 'Ammo — identification and count reconciliation (P2-S7)',
      lines: [
        '| Step | Count |',
        '|---|---:|',
        `| Module:Iteminfo/data items with a non-zero \`ammo\` (AmmoID) | ${iteminfoAmmo.length} |`,
        `| Cargo Items rows whose infobox type contains "ammunition" | ${aIdn.typedRows} |`,
        ...[...aExcludedByKind].sort().map(([k, n]) => `| − excluded (${k}; one gap entry each) | ${n} |`),
        `| **= ammo records** | **${ammoRecords.length}** |`,
        `|   ammo items (items.detail.json, category "ammo") | ${itemDetails.length} |`,
        `|   weapons that are also ammo (ammoStats on the weapon record: ${dualRole.map((w) => w.name).join(', ') || 'none'}) | ${dualRole.length} |`,
        `| Iteminfo ammo items without an emitted record | ${aIdn.iteminfoOnly.length}${aIdn.iteminfoOnly.length ? ` (${aIdn.iteminfoOnly.map((i) => `${i.name ?? i.internalName} ${i.id}`).join(', ')})` : ''} |`,
        '',
        `**Wiki category tree** — ${sync.ammoCategories.roots.join(' + ')}: ${aCat.treeCategories} categories (${[...sync.ammoCategories.categories.keys()].filter((k) => !sync.ammoCategories.roots.includes(k)).map((k) => k.replace('Category:', '')).join(', ')}), ${aCat.treePages} distinct articles.`,
        '',
        '| Category-tree articles | Count |',
        '|---|---:|',
        `| articles in the tree | ${aCat.treePages} |`,
        ...aBucketRows.map(([k, n]) => `| ${k} | ${n} |`),
        `| = check: ${sum(aBucketRows.map(([, n]) => n))} classified | ${aCat.treePages - sum(aBucketRows.map(([, n]) => n)) === 0 ? 'OK' : 'MISMATCH'} |`,
        `| ammo records hosted by the ${aCat.buckets['weapon-article'].length} ammo articles | ${aCat.weaponsOnTreePages} |`,
        `| + ammo records whose article is outside the tree | ${aCat.weaponsOutsideTree.length} |`,
        `| **= ammo records** | **${aCat.weaponsOnTreePages + aCat.weaponsOutsideTree.length}** ${aCat.weaponsOnTreePages + aCat.weaponsOutsideTree.length === ammoRecords.length ? '(reconciles)' : '(DOES NOT RECONCILE)'} |`,
        '',
        `- Redirects: ${list(aCat.buckets.redirect)}`,
        `- Articles without an item infobox (list / localized pages): ${list(aCat.buckets['no-item-infobox'])}`,
        `- Non-ammo item articles in the tree: ${list(aCat.buckets['non-weapon-item-article'])} (by infobox type: ${[...aCat.nonWeaponTypes].map(([t, n]) => `${t} ${n}`).join('; ') || 'none'})`,
        `- Ammo records outside the tree: ${list(aCat.weaponsOutsideTree)}`,
        '',
        `**Ammo classes** (AmmoID representative item; the ${ammoClasses.length} weapon classes are all matched — §7a-10 hard check): ${[...ammoByClass].sort().map(([c, names]) => `${c} ${names.length}`).join(', ')}.`,
      ],
    },
    {
      title: 'Ammo — stats, cross-check and velocity multiplier',
      lines: [
        '| Field | Agree | Mismatch (value withheld) | No wiki value |',
        '|---|---:|---:|---:|',
        ...[...ammo.crossCheck].map(([f, c]) => `| ${f} | ${c.agree} | ${c.mismatch} | ${c.noWikiValue} |`),
        '',
        `Velocity multiplier (B2) per ammo record: ${[...multiplierBuckets].map(([k, n]) => `${k} ${n}`).join('; ')}.`,
        '',
        '| Ammo | Class | Damage | Knockback | Velocity bonus (tiles/s) | Velocity multiplier | Stage |',
        '|---|---|---:|---:|---:|---|---|',
        ...ammoRecords
          .slice()
          .sort((a, b) => a.id - b.id)
          .map((x) => {
            const s = x.ammoStats as NonNullable<typeof x.ammoStats>
            return `| ${x.name} (${x.id}) | ${s.ammoClass} | ${statusOf(x, 'ammoStats.damage', s.damage)} | ${statusOf(x, 'ammoStats.knockback', s.knockback)} | ${statusOf(x, 'ammoStats.velocityBonusTps', s.velocityBonusTps)} | ${s.velocityMultiplier !== undefined ? `${s.velocityMultiplier}×` : (ammo.multiplier.get(x.id) ?? '?')} | ${x.stage ?? 'Unknown'} |`
          }),
      ],
    },
    {
      title: 'Buffs — registry (P2-S7, A4 bound)',
      lines: [
        `${buffs.buffs.length} buffs: every debuff an emitted weapon / ammo item inflicts (Cargo \`debuffs\`) or grants (Iteminfo buffType), plus the ${buffsOverlay.entries.length} overlay entries (combat buff potions + Tipsy's effects). Resolved through the Buff IDs table (rev ${buffTable.rev}); dot.dps = enemy health loss per second from the debuff infobox "Effects" row; effects only from pipeline/overlays/buffs.json (verbatim, number-checked quotes), Unknown otherwise.`,
        '',
        '| Buff | Game ID | Type | Enemy DoT (HP/s) | Effects | Why in the registry |',
        '|---|---:|---|---|---|---|',
        ...buffs.report.map((b) => `| ${b.name} (${b.id}) | ${b.gameBuffId} | ${b.type} | ${b.dps} | ${b.effects} | ${b.why.replaceAll('|', '\\|')} |`),
      ],
    },
    {
      title: 'Weapon Lab — archetype params and coverage (P3-S0)',
      lines: [
        `Rules: pipeline/merge/labParams.ts (header = the tooling doc). Param semantics are binding as documented in src/sim/README.md ("Cadence" and "Open questions" #2; AMENDMENTS-008 B37): pierce = extra dummies after the first; projectilesPerUse = projectiles per activation (bursts come from useTime < useAnimation); ammo speed only from the ammo's velocityBonusTps / velocityMultiplier; magic-bolt speed = params.projectile.velocityTps. Family = the wiki category of the weapon's article (${Object.entries(FAMILY_CATEGORIES).map(([f, cats]) => `${f}: ${cats.map((c) => c.replace('Category:', '')).join(' + ')}`).join('; ')}). "Derived" = every param computed from the data modules / sprite metadata and the article screen found nothing the params cannot express; "overlay" = the screen flagged the weapon and a reviewed entry in pipeline/overlays/lab-params.json (verbatim quotes, checked against the cached article revision) decided it; "downgraded" = params were assigned but a core field the sim needs is unverified, so the validate stage's §2.1-3 rule (incl. AMENDMENTS-008 B36) emits a limitation. Every emitted archetype weapon passed src/sim assessWeapon (build-time guard contract).`,
        '',
        '| Family (archetype) | Weapons | Derived | Overlay (reviewed) | Downgraded at validate | Limitation | **Simulable** | Simulable % |',
        '|---|---:|---:|---:|---:|---:|---:|---:|',
        ...labCoverage.map((c) => `| ${c.family} | ${c.total} | ${c.derived} | ${c.overlay} | ${c.downgraded} | ${c.limitation} | **${c.simulable}** | ${pct(c.simulable, c.total)} |`),
        `| **all four families** | ${sum(labCoverage.map((c) => c.total))} | ${sum(labCoverage.map((c) => c.derived))} | ${sum(labCoverage.map((c) => c.overlay))} | ${sum(labCoverage.map((c) => c.downgraded))} | ${sum(labCoverage.map((c) => c.limitation))} | **${sum(labCoverage.map((c) => c.simulable))}** | ${pct(sum(labCoverage.map((c) => c.simulable)), sum(labCoverage.map((c) => c.total)))} |`,
        `| all weapons (A3 MVP target ≥ 60% at P3-S13) | ${weaponDetails.length} | | | | | **${labArchetypeTotal}** | ${pct(labArchetypeTotal, weaponDetails.length)} |`,
        '',
        '| Family | Limitation reason | Weapons |',
        '|---|---|---:|',
        ...labCoverage.flatMap((c) => [...c.byReason].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, n]) => `| ${c.family} | ${LAB_REASON_LABEL[k] ?? k} | ${n} |`)),
        '',
        `**AMENDMENTS-008 B36** (simRequiredWeaponFields += useAnimationTicks for every archetype, + autoReuse for swing-melee / thrust / returning): of ${labWithParams} weapons given params, ${labB36.length} are downgraded by the validate rule${labB36.length ? ` (${labB36.map((x) => `${x.name} — ${x.fields.join(', ')}`).join('; ')})` : ''}; ${labB36Only.length} of them only because of the B36 fields (${labB36Only.map((x) => x.name).join(', ') || 'none'}). Weapons in the whole dataset with an unverified B36 field: ${labB36Sensitive.map((w) => `${w.name} (${w.fields.join(', ')}; ${w.family ?? 'no family'} → ${w.lab})`).join('; ') || 'none'} — none of them had params to lose (a thrust limitation and a reviewed magic limitation), so B36 changes no emitted record in this build; it now guarantees that any future params on them are downgraded with a proper limitation card. B36 adds requirements only, so it upgrades nothing; the slice's upgrades are the ${labArchetypeTotal} weapons whose labBehavior went from the P2 default limitation to a simulable archetype. Guard-only refusals turned into limitations at merge time: ${lab.decisions.filter((d) => d.reasonKey?.startsWith('guard:')).map((d) => `${d.name} (${d.reason})`).join('; ') || 'none'}.`,
        '',
        `**Article screen** (high recall; a flag only routes a weapon to review, it never sets a value): ${SCREEN_RULES.map((r) => `${r.id} — ${r.label} (${r.families.join(', ')})`).join('; ')}; the tooltip is screened with the same rules; plus data flags: shoots-projectile (Iteminfo shoot > 0, melee), infobox-projectile, inflicts-debuff (Cargo debuffs / infobox buff), burst (useTime < useAnimation). Hard (non-overridable) data rules: Iteminfo reuseDelay > 0 (a cooldown the sim cadence omits), use style / class / ammo / mana / channel signals per archetype, thrust reach unsourced. Flag counts among family weapons: ${[...labFlagCounts].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}.`,
        '',
        '| Family | Weapon | Result | Params | How (derivation / overlay rationale / flags) |',
        '|---|---|---|---|---|',
        ...lab.decisions
          .slice()
          .sort((a, b) => a.family.localeCompare(b.family) || a.name.localeCompare(b.name))
          .map((d) => {
            const final = weaponDetails.find((w) => w.id === d.id)
            const result = final?.labBehavior.kind === 'archetype' ? `simulated (${d.method})` : d.method === 'limitation' ? `limitation: ${LAB_REASON_LABEL[d.reasonKey ?? ''] ?? d.reasonKey}` : 'limitation (downgraded at validate)'
            const params = d.params && final?.labBehavior.kind === 'archetype' ? Object.entries(d.params).filter(([k]) => k !== 'archetype').map(([k, v]) => `${k} ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(', ') : '—'
            const how = [...d.derivation, ...(d.reason ? [`reason: ${d.reason}`] : []), ...(d.flags.length ? [`flags: ${d.flags.map((f) => `${f.id} ${f.evidence}`).join('; ')}`] : [])].join(' · ')
            return `| ${d.family} | ${d.name} (${d.id}) | ${result} | ${params} | ${how.replaceAll('|', '\\|')} |`
          }),
      ],
    },
    {
      title: 'Armor — identification and count reconciliation (P2-S8)',
      lines: [
        '| Step | Count |',
        '|---|---:|',
        `| Cargo Items rows whose infobox type contains "armor" | ${typedArmorRows} |`,
        `| − set rows (type "armor" + "set" = the set infobox of a set article, not an item; ${armor.setPages} set articles) | ${armor.setRows} |`,
        `| = armor piece rows | ${armor.identification.typedRows} |`,
        ...byKind(armor.identification).map(([k, n]) => `| − excluded (${k}; one gap entry each) | ${n} |`),
        `| **= armor pieces emitted** | **${armorDetails.length}** ${reconciles(armor.identification.typedRows - armor.identification.excluded.length, armorDetails.length)} |`,
        `|   head / chest / legs | ${slotCount('head')} / ${slotCount('chest')} / ${slotCount('legs')} |`,
        `|   pieces of an emitted set (setId) / without a set | ${armorDetails.length - setlessPieces.length} / ${setlessPieces.length} |`,
        `| Module:Iteminfo/data non-vanity items with exactly one head/body/leg slot | ${iteminfoArmor.length} |`,
        `|   = emitted armor pieces (every emitted piece is one) + Iteminfo-only | ${armorDetails.length} + ${iteminfoArmorOnly.length} ${reconciles(armorDetails.length + iteminfoArmorOnly.length, iteminfoArmor.length)} |`,
        '',
        `**Wiki category tree** — ${sync.armorCategories.roots.join(' + ')}: ${armorCat.treeCategories} categories (${[...sync.armorCategories.categories.keys()].map((k) => k.replace('Category:', '')).join(', ')}), ${armorCat.treePages} distinct articles.`,
        '',
        '| Category-tree articles | Count |',
        '|---|---:|',
        `| articles in the tree | ${armorCat.treePages} |`,
        ...armorBuckets.map(([k, n]) => `| ${k} | ${n} |`),
        `| = check: ${sum(armorBuckets.map(([, n]) => n))} classified | ${armorCat.treePages - sum(armorBuckets.map(([, n]) => n)) === 0 ? 'OK' : 'MISMATCH'} |`,
        `| armor pieces hosted by the ${armorCat.buckets['weapon-article'].length} armor articles | ${armorCat.weaponsOnTreePages} |`,
        `| + armor pieces whose article is outside the tree | ${armorCat.weaponsOutsideTree.length} |`,
        `| **= armor pieces emitted** | **${armorCat.weaponsOnTreePages + armorCat.weaponsOutsideTree.length}** ${reconciles(armorCat.weaponsOnTreePages + armorCat.weaponsOutsideTree.length, armorDetails.length)} |`,
        '',
        `- Non-armor item articles in the tree, by infobox type: ${[...armorCat.nonWeaponTypes].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join('; ') || 'none'} (${list(armorCat.buckets['non-weapon-item-article'])})`,
        `- Excluded-row articles: ${list(armorCat.buckets['excluded-weapon-rows'])}`,
        `- Articles without an item infobox: ${list(armorCat.buckets['no-item-infobox'])}`,
        `- Redirects: ${list(armorCat.buckets.redirect)}`,
        `- Missing pages: ${list(armorCat.buckets['missing-page'])}`,
        `- Armor pieces outside the tree: ${list(armorCat.weaponsOutsideTree)}`,
        `- Iteminfo armor-slot items (non-vanity) without an armor record — not typed "armor" by the wiki or excluded above (the wiki's item type decides; item corpus P6-S0): ${list(iteminfoArmorOnly.map(iiName))}`,
        '',
        '| Cross-check | Agree | Mismatch (value withheld) | No wiki value |',
        '|---|---:|---:|---:|',
        ...[...armor.crossCheck].map(([f, c]) => `| ${f} | ${c.agree} | ${c.mismatch} | ${c.noWikiValue} |`),
      ],
    },
    {
      title: 'Armor sets — set articles, class-variant helmets, set bonuses (P2-S8)',
      lines: [
        `${armor.setRows} Cargo set rows on ${armor.setPages} set articles → **${setDetails.length} armor sets emitted** + ${withheldSetPages.size} withheld by a reviewed, quote-checked pipeline/overlays/armor-sets.json entry (${[...withheldSetPages].join(', ')}; one count-reconciliation gap each, their pieces carry no setId) ${reconciles(setDetails.length + withheldSetPages.size, armor.setPages)}. Articles with several set rows: ${list(multiRowSetPages.map(([p, n]) => `${p} ${n}`))}. Validate checks every set as a hard §7a-6 rule: pieces resolve with the matching slot, piece setId back-refs agree (E_DERIVED_MISMATCH), helmets are not repeated and variants ⇄ helmets are bijective (${setDetails.reduce((n, s) => n + s.variants.length, 0)} variants = ${setDetails.reduce((n, s) => n + s.pieces.helmets.length, 0)} helmets).`,
        '',
        `Category check: set articles not in a Category:Armor sets* category: ${list(setPagesOutsideCategory)}; Category:Armor sets* articles without a Cargo set row: ${list(categorySetPagesWithoutRow)}.`,
        '',
        `Set Defense totals (infobox, per helmet or one total) vs Σ piece defense (each piece Iteminfo, cross-checked): ${armorXc('set Defense total (infobox vs Σ piece defense)').agree} agree, ${armorXc('set Defense total (infobox vs Σ piece defense)').mismatch} mismatch, ${armorXc('set Defense total (infobox vs Σ piece defense)').noWikiValue} without a total. Variant class (editorialFields) = the damage-class signals of helmet + chest + legs + set bonus stats; hybrid sets are ruled "other" by a quoted overlay entry. Set stage = earliest stage a complete set can be assembled, Unknown unless every piece stage is derived (${setDetails.filter((s) => s.stage).length}/${setDetails.length} derived).`,
        '',
        '| Set | Stage | Helmet → class | Chest · Legs | Set bonus (structured; specials quoted) |',
        '|---|---|---|---|---|',
        ...setDetails.map((s) => {
          const how = armor.setReport.find((r) => r.id === s.id)?.detail ?? ''
          const name = (id: number) => pieceById.get(id)?.name ?? `#${id}`
          const bonuses = s.variants.map((v) => `${s.variants.length > 1 ? `${name(v.helmetId)}: ` : ''}${v.setBonus.map(effectText).join('; ')}`)
          return `| ${s.name} | ${s.stage ?? 'Unknown'} | ${esc(how)} | ${esc(`${name(s.pieces.chest)} · ${name(s.pieces.legs)}`)} | ${esc(bonuses.join(' ‖ '))} |`
        }),
        '',
        `Armor pieces without a set (${setlessPieces.length}): on withheld set articles — ${list(setlessPieces.filter((p) => withheldSetPages.has(armor.pageOf.get(p.id) ?? '')).map((p) => p.name))}; on other articles — ${list(setlessPieces.filter((p) => !withheldSetPages.has(armor.pageOf.get(p.id) ?? '')).map((p) => `${p.name} (${armor.pageOf.get(p.id)})`))}.`,
      ],
    },
    {
      title: 'Accessories — identification and count reconciliation (P2-S8)',
      lines: [
        '| Step | Count |',
        '|---|---:|',
        `| Cargo Items rows whose infobox type contains "accessory" | ${accessories.identification.typedRows + accessories.vanityRows.length} |`,
        `| − vanity accessories (also typed "vanity": cosmetic, incl. music boxes → item corpus P6-S0; no gap) | ${accessories.vanityRows.length} |`,
        `| = functional accessory rows | ${accessories.identification.typedRows} |`,
        ...byKind(accessories.identification).map(([k, n]) => `| − excluded (${k}; one gap entry each) | ${n} |`),
        `| **= accessories emitted** | **${accessoryDetails.length}** ${reconciles(accessories.identification.typedRows - accessories.identification.excluded.length, accessoryDetails.length)} |`,
        ...EFFECT_CATEGORIES.map((c) => `|   category ${c} (editorial; an accessory can have several) | ${accessoryDetails.filter((a) => a.categories.includes(c)).length} |`),
        `|   effects Unknown (empty + listed) | ${unknownEffectAccessories.length} |`,
        `| Module:Iteminfo/data items with \`accessory\` true | ${iteminfoAccessories.length} |`,
        `|   − \`vanity\` true | ${iteminfoAccessories.length - iteminfoFunctionalAcc.length} |`,
        `|   = functional = emitted accessories + Iteminfo-only | ${accessoryDetails.length} + ${iteminfoAccOnly.length} ${reconciles(accessoryDetails.length + iteminfoAccOnly.length, iteminfoFunctionalAcc.length)} |`,
        '',
        `**Wiki category tree** — ${sync.accessoryCategories.roots.join(' + ')}: ${accCat.treeCategories} categories (${[...sync.accessoryCategories.categories.keys()].map((k) => k.replace('Category:', '')).join(', ')}), ${accCat.treePages} distinct articles.`,
        '',
        '| Category-tree articles | Count |',
        '|---|---:|',
        `| articles in the tree | ${accCat.treePages} |`,
        ...accBuckets.map(([k, n]) => `| ${k} | ${n} |`),
        `| = check: ${sum(accBuckets.map(([, n]) => n))} classified | ${accCat.treePages - sum(accBuckets.map(([, n]) => n)) === 0 ? 'OK' : 'MISMATCH'} |`,
        `| accessories hosted by the ${accCat.buckets['weapon-article'].length} accessory articles | ${accCat.weaponsOnTreePages} |`,
        `| + accessories whose article is outside the tree | ${accCat.weaponsOutsideTree.length} |`,
        `| **= accessories emitted** | **${accCat.weaponsOnTreePages + accCat.weaponsOutsideTree.length}** ${reconciles(accCat.weaponsOnTreePages + accCat.weaponsOutsideTree.length, accessoryDetails.length)} |`,
        '',
        `- Non-accessory item articles in the tree, by infobox type: ${[...accCat.nonWeaponTypes].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join('; ') || 'none'} (${list(accCat.buckets['non-weapon-item-article'])})`,
        `- Vanity-only articles (out of scope): ${list(accCat.buckets['out-of-scope-rows'])}`,
        `- Excluded-row articles: ${list(accCat.buckets['excluded-weapon-rows'])}`,
        `- Articles without an item infobox: ${list(accCat.buckets['no-item-infobox'])}`,
        `- Redirects: ${list(accCat.buckets.redirect)}`,
        `- Missing pages: ${list(accCat.buckets['missing-page'])}`,
        `- Accessories outside the tree: ${list(accCat.weaponsOutsideTree)}`,
        `- Iteminfo functional accessories without an accessory record — not typed "accessory" by the wiki or excluded above: ${list(iteminfoAccOnly.map(iiName))}`,
        '',
        '| Cross-check | Agree | Mismatch (value withheld) | No wiki value |',
        '|---|---:|---:|---:|',
        ...[...accessories.crossCheck].map(([f, c]) => `| ${f} | ${c.agree} | ${c.mismatch} | ${c.noWikiValue} |`),
        '',
        `**Effects Unknown** (A1: empty + listed, never invented): ${list(unknownEffectAccessories.map((a) => `${a.name} (${a.id}; ${tooltipEffectLines(accRowById.get(a.id) ?? {}).lines.length === 0 ? 'no game text transcribed on the wiki' : 'game text is flavor only'})`))}.`,
      ],
    },
    {
      title: 'Equipment effects — closed StatKind classification and Equipinfo cross-check (P2-S8)',
      lines: [
        `Every game-text line (Cargo Items \`tooltip\` for pieces and accessories, the set infobox "Set Bonus" for sets) matches exactly one rule in pipeline/merge/effects.ts — an unmatched or doubly-matched line fails the build (StatKind is closed). A stat rule's numbers must all occur in the line; specials keep the verbatim line (simulated: false, sourceUrl = the record's article). ${EFFECT_RULES.length} rules; lines classified: armor pieces + set bonuses ${sum([...armor.ruleCounts.values()].map((u) => u.count))}, accessories ${sum([...accessories.ruleCounts.values()].map((u) => u.count))}.`,
        '',
        '| Rule | Emits | Armor + set lines | Accessory lines | Example (wiki) |',
        '|---|---|---:|---:|---|',
        ...EFFECT_RULES.filter((r) => ruleUsage(r.id)[0] + ruleUsage(r.id)[1] > 0).map((r) => {
          const [a, b] = ruleUsage(r.id)
          const ex = ruleExample(r.id)
          return `| ${r.id} | ${esc(ruleEmits(r))} | ${a} | ${b} | ${ex ? esc(`${ex.name}: "${ex.line}"`) : ''} |`
        }),
        '',
        `Unused rules (kept for lines of other rows / platforms): ${EFFECT_RULES.filter((r) => ruleUsage(r.id)[0] + ruleUsage(r.id)[1] === 0).map((r) => r.id).join(', ') || 'none'}.`,
        '',
        `**Equipinfo cross-check** (Cargo Equipinfo = the wiki's UpdateEquip transcription, ${sync.equipinfo.rows.length} rows, ${accessories.unattributedEquipinfoRows} without an item ID = shared code): armor pieces — ${equipOutcomes(armor.equip)}; accessories — ${equipOutcomes(accessories.equip)}. "disagree" withholds the record's effects (Unknown + source-mismatch gap); "partial" = a field stated on one side only: game text only (shared code the wiki leaves unattributed) is kept, Equipinfo only (a stat the game text gives no number for) is a gap and never filled in. Set bonuses have no Equipinfo counterpart (UpdateArmorSet is not transcribed).`,
        '',
        `Partial rows: ${list(partialLines)}.`,
      ],
    },
    {
      title: 'StatKind extension candidates (amendment proposals, P2-S8)',
      lines: [
        'Effects the closed StatKind enum (DATA_SCHEMA_SPEC §2.3) cannot express are emitted as `special` (simulated: false) — never as an invented stat. These rules name the StatKind extension that would make them structured; each row is wiki evidence (verbatim game text + article) for an amendment.',
        '',
        '"Existing kind" = the StatKind is in the enum but the game text states no value / unit / scope for it (a unit definition, a value source or a scope extension is the amendment); "new kind" = no StatKind covers it.',
        '',
        '| Proposed StatKind | Today | Lines | Rules | Evidence (first line per rule) |',
        '|---|---|---:|---|---|',
        ...[...proposals].sort((a, b) => b[1].lines - a[1].lines || a[0].localeCompare(b[0])).map(([k, p]) => `| ${esc(k)} | ${statKinds.has(k.split(/[\s,]/)[0]) ? 'existing kind' : 'new kind'} | ${p.lines} | ${p.rules.join(', ')} | ${esc(p.examples.join('; ') || '(no line in this sync)')} |`),
      ],
    },
    {
      title: "Tinkering — combinedFrom / upgradesTo derived from Tinkerer's Workshop recipes (§7a-7, P2-S8)",
      lines: [
        `Rule (validate/integrity.ts deriveTinkering, the one definition the build and validate share): a recipe whose station is the Tinkerer's Workshop (item ${TINKERERS_WORKSHOP_ITEM_ID}) and whose result is an emitted accessory links each ITEM ingredient that is itself an emitted accessory; other stations, group ingredients ("Any …") and materials never link. ${tinkererRecipes.length} Tinkerer's Workshop recipes; ${tinkererToAccessory.length} produce an emitted accessory → ${tinkeringLinks} combinedFrom links = ${accessoryDetails.reduce((n, a) => n + a.upgradesTo.length, 0)} upgradesTo links ${reconciles(tinkeringLinks, accessoryDetails.reduce((n, a) => n + a.upgradesTo.length, 0))}; ${accessoryDetails.filter((a) => a.combinedFrom.length > 0).length} accessories have combinedFrom, ${accessoryDetails.filter((a) => a.upgradesTo.length > 0).length} have upgradesTo. Validate re-derives both directions and fails on any difference (E_DERIVED_MISMATCH) — symmetric by construction and by check.`,
        '',
        `- Recipes with a group ingredient (the group member is not linked — groups never link): ${list(groupOnlyTinkerer.map((r) => nameOfEquip.get(r.resultItemId) ?? `i:${r.resultItemId}`))}`,
        `- Two-way links (each is a Tinkerer's Workshop recipe on the wiki; consumers walking the tree must cycle-guard): ${list(cycles)}`,
      ],
    },
    {
      title: 'Wings — wingStats from the Wings article list table (P2-S8)',
      lines: [
        `${wingRecords.length} emitted accessories have an Iteminfo wing slot; the "Wings" article list table has ${accessories.wings.table.length} rows; ${wingRecords.filter((a) => a.wingStats).length} accessories carry wingStats, without a table row: ${list(accessories.wings.withoutRow)}. flightTimeTicks = round(seconds × 60) with |60·s − ticks| ≤ 0.3 (the table's 2-decimal seconds pin the tick count); hover = the horizontal speed cell lists a second "hovering" speed, cross-checked with tooltips ("Press Down to toggle hover") and the notes (${accXc('wingStats.hover (tooltip / table notes say it can hover ⇒ a hovering speed line)').agree} agree, ${accXc('wingStats.hover (tooltip / table notes say it can hover ⇒ a hovering speed line)').mismatch} mismatch); verticalSpeedTps Unknown on every wing (the table states a multiplier, not a speed).`,
        '',
        '| Wing | Flight time (wiki table) | flightTimeTicks | Hover |',
        '|---|---|---:|---|',
        ...wingRecords.map((a) => {
          const row = accessories.wings.table.find((w) => w.itemIds.includes(a.id))
          const shown = (v: unknown, f: string) => (v !== undefined ? String(v) : a._prov.unverifiedFields.includes(f) ? 'Unknown' : 'n/a')
          return `| ${a.name} (${a.id}) | ${row?.flightTime ?? '—'} | ${shown(a.wingStats?.flightTimeTicks, 'wingStats.flightTimeTicks')} | ${shown(a.wingStats?.hover, 'wingStats.hover')} |`
        }),
      ],
    },
    {
      title: 'Sprites',
      lines: [
        `public/sprites/manifest.json lists ${weapons.sprites.length}/${weaponDetails.length} weapon sprites, ${bosses.sprites.length}/${first.dataset.bosses.length} boss sprites, ${ammo.sprites.length}/${itemDetails.length} ammo item sprites, ${armor.sprites.length}/${armorDetails.length} armor piece sprites and ${accessories.sprites.length}/${accessoryDetails.length} accessory sprites (${spriteManifest.files.filter((f) => f.path.endsWith('.gif')).length} animated GIFs), each with its wiki File: page, SHA-1, size and rights "re-logic"; ${weaponDetails.length - weapons.sprites.length} weapons, ${armorDetails.length - armor.sprites.length} armor pieces and ${accessoryDetails.length - accessories.sprites.length} accessories have no wiki image and use the placeholder. Binaries are downloaded locally by \`npm run pipeline:sprites\` (verified against imageinfo — exact SHA-1 or CDN original size, see #8; gitignored, never in CI — A10); fallbackMode=false.`,
        '',
        `Thumbnails (AMENDMENTS-007 B30): every sprite file over ${THUMBNAIL_MIN_BYTES / 1024} KB gets a static PNG of its first frame, downscaled by a whole number to ≤ 128 px (nearest-neighbour block sampling — pixel art is never resampled fractionally), generated locally by \`npm run pipeline:sprites\`: ${spriteManifest.files.filter((f) => f.thumbnail).map((f) => `${f.path} (${f.ref}, ${f.bytes} B, ${f.width}×${f.height}) → ${f.thumbnail?.path} ${f.thumbnail?.width}×${f.thumbnail?.height}`).join('; ') || 'none'}. Heavy files without a thumbnail (generator decodes GIF only): ${heavyWithoutThumbnail.map((f) => f.path).join(', ') || 'none'}. Rows and cards should use the thumbnail, the full file only on detail / boss pages (UI wiring: next UI slice).`,
      ],
    },
  ]

  const sizes: EmittedFile[] = [...budget.sizes, { file: relative(repoRoot, spriteManifestPath), bytes: Buffer.byteLength(spriteManifestText), gzBytes: gzSize(spriteManifestText) }]
  const report = renderGapReport({
    slice: 'P2-S8',
    meta: result.meta,
    gaps: result.gaps,
    warnings: result.warnings,
    reconciliation: [
      {
        title: `Recipes (Cargo COUNT(*) ${sync.tables.Recipes.cargoCount})`,
        rows: [
          ['Cargo rows fetched', r.cargoRows],
          ['− legacy (old-gen/3DS registrations, legacy=1)', r.legacyRows],
          ['− non-desktop version', r.nonDesktopRows],
          ['− duplicate rows (identical canonical recipe)', r.duplicateRows],
          ['− excluded (unresolvable; one gap entry each)', r.excludedRows],
          ['= emitted recipes', r.emitted],
          ['  of which Shimmer transmutations', r.byStation.Shimmer ?? 0],
          ['  of which Chlorophyte Extractinator conversions', r.byStation['Chlorophyte Extractinator'] ?? 0],
          ['  of which carry availability conditions in Recipe.conditions (AMENDMENTS-003 B9)', r.withConditions],
          ['  of which availability notes still stored as environment stations (B9 debt)', r.availabilityNoteStations],
          ['recipe groups emitted (ingredient + B3 station groups)', recipes.groups.length],
        ],
      },
      {
        title: `Drops (Cargo COUNT(*) ${sync.tables.Drops.cargoCount})`,
        rows: [
          ['Cargo rows fetched', d.cargoRows],
          ['− non-desktop rows (platform icons without Desktop)', d.nonDesktopRows],
          ['− excluded (item not resolvable; one gap entry each)', d.excludedRows],
          ['= rows emitted', d.emittedRows],
          ['+ extra records from rows split by condition (e.g. Underground/Cavern, pre-Hardmode/Hardmode)', d.emittedRecords - d.emittedRows],
          ['= drop records emitted', d.emittedRecords],
          ['id collisions resolved with -N suffix', d.idCollisions],
        ],
      },
      {
        title: 'Boss drops — registry attribution (AMENDMENTS-003 B12)',
        rows: [
          ['boss-typed / treasure-bag drop records (source.bossId pending before P2-S6)', d.bossLinkedRecords + d.eventBossRecords + d.bossMismatchRecords],
          ['→ linked to a registry boss (source.bossId)', d.bossLinkedRecords],
          ['→ event-boss article: bossId not applicable (events are A3 markers)', d.eventBossRecords],
          ['→ NPC ids disagree with the registry boss: bossId Unknown + gap', d.bossMismatchRecords],
          ...[...d.eventBossPages].sort(([a], [b]) => a.localeCompare(b)).map(([page, n]): [string, number] => [`    event boss: ${page}`, n]),
        ],
      },
      {
        title: 'Bosses + progression graph (P2-S6)',
        rows: [
          ['bosses (REQUIREMENTS §6 registry, EoW/BoC as world-evil alternatives)', first.dataset.bosses.length],
          ['  with stats for every difficulty / for none', `${bosses.stats.filter((r) => Object.values(r.byDifficulty).every((v) => v !== 'Unknown')).length} / ${bosses.stats.filter((r) => Object.values(r.byDifficulty).every((v) => v === 'Unknown')).length}`],
          ['  with quoted attack-pattern tags', first.dataset.bosses.filter((b) => b.attackPatternTags).length],
          ['  with a wiki sprite (manifest)', bosses.sprites.length],
          ['  derived dropIds (sum)', first.dataset.bosses.reduce((n, b) => n + b.dropIds.length, 0)],
          ['progression nodes', first.dataset.nodes.length],
          ...(['boss', 'milestone', 'event'] as const).map((k): [string, number] => [`  ${k}`, first.dataset.nodes.filter((n) => n.kind === k).length]),
          ['progression edges (each with a wiki sourceUrl + verbatim note)', first.dataset.edges.length],
          ...(['required-gate', 'recommended-next', 'optional', 'alternative-route', 'early-challenge-possible'] as const).map((t): [string, number] => [`  ${t}`, first.dataset.edges.filter((e) => e.type === t).length]),
          ['overlay evidence articles (rendered text + revision id)', sync.articles.size],
        ],
      },
      {
        title: `Enemies (Cargo NPCs COUNT(*) ${sync.tables.NPCs.cargoCount})`,
        rows: [
          ['NPC rows fetched', enemies.ledger.npcRows],
          ['enemy-typed rows (no boss/critter/town/projectile type)', enemies.ledger.enemyRows],
          ['= enemies (rows merged by name)', enemies.ledger.enemies],
          ['enemies with ≥1 derived drop', enemies.enemies.filter((e) => e.dropIds.length > 0).length],
        ],
      },
      {
        title: 'Weapons (summary — details below)',
        rows: [
          ['weapons emitted', weaponDetails.length],
          ['with ≥1 acquisition route', weaponDetails.filter((w) => w.acquisition.length > 0).length],
          ['  craft (recipe ids)', weaponDetails.filter((w) => w.acquisition.some((a) => a.method === 'craft')).length],
          ['  drop (drop ids)', weaponDetails.filter((w) => w.acquisition.some((a) => a.method === 'drop')).length],
          ['  purchase (vendor tags)', weaponDetails.filter((w) => w.acquisition.some((a) => a.method === 'purchase')).length],
          ['acquisition Unknown (no route on the wiki structured data)', weaponDetails.filter((w) => w.acquisition.length === 0).length],
          ['with a wiki sprite (manifest) / placeholder', `${weapons.sprites.length} / ${weaponDetails.length - weapons.sprites.length}`],
          ['Lab: limitation / archetype / custom (P3-S0 coverage below)', `${result.gaps.summary.labCoverage.limitation} / ${result.gaps.summary.labCoverage.archetype} / ${result.gaps.summary.labCoverage.customScenario}`],
        ],
      },
      {
        title: 'Ammo + buffs (P2-S7 summary — details below)',
        rows: [
          ['ammo records (Iteminfo ammo ≠ 0: ' + iteminfoAmmo.length + '; Cargo "ammunition" rows: ' + aIdn.typedRows + ')', ammoRecords.length],
          ['  ammo items emitted (items.detail.json)', itemDetails.length],
          ['  weapons that are also ammo (ammoStats on the weapon)', dualRole.length],
          ['  with ≥1 acquisition route', itemDetails.filter((i) => i.acquisition.length > 0).length],
          ['  with derived gatedBy / stage', itemDetails.filter((i) => i.gatedBy).length],
          ['  with a wiki sprite (manifest)', ammo.sprites.length],
          ['  damage verified / Unknown', `${ammoRecords.filter((x) => x.ammoStats?.damage !== undefined).length} / ${ammoRecords.filter((x) => x._prov.unverifiedFields.includes('ammoStats.damage')).length}`],
          ['  velocityMultiplier stated / not applicable / Unknown', `${ammoRecords.filter((x) => x.ammoStats?.velocityMultiplier !== undefined).length} / ${ammoRecords.filter((x) => x.ammoStats?.velocityMultiplier === undefined && !x._prov.unverifiedFields.includes('ammoStats.velocityMultiplier')).length} / ${ammoRecords.filter((x) => x._prov.unverifiedFields.includes('ammoStats.velocityMultiplier')).length}`],
          ['buffs emitted (Buff IDs table rows: ' + buffTable.rows.length + ')', buffs.buffs.length],
          ['  debuffs / buffs', `${buffs.buffs.filter((b) => b.isDebuff).length} / ${buffs.buffs.filter((b) => !b.isDebuff).length}`],
          ['  with a verified enemy DoT (dot.dps)', buffs.buffs.filter((b) => b.dot).length],
          ['  with structured effects (overlay)', buffs.buffs.filter((b) => b.effects.length > 0).length],
        ],
      },
      {
        title: 'Armor + armor sets + accessories (P2-S8 summary — details below)',
        rows: [
          ['armor pieces (Cargo "armor" piece rows: ' + armor.identification.typedRows + '; excluded: ' + armor.identification.excluded.length + ')', armorDetails.length],
          ['  head / chest / legs', `${slotCount('head')} / ${slotCount('chest')} / ${slotCount('legs')}`],
          ['  defense verified / Unknown', `${armorDetails.filter((p) => p.defense !== undefined).length} / ${armorDetails.filter((p) => p._prov.unverifiedFields.includes('defense')).length}`],
          ['  with ≥1 acquisition route / derived gatedBy', `${armorDetails.filter((p) => p.acquisition.length > 0).length} / ${armorDetails.filter((p) => p.gatedBy).length}`],
          ['  with a wiki sprite (manifest)', armor.sprites.length],
          ['armor sets (set articles: ' + armor.setPages + '; withheld: ' + withheldSetPages.size + ')', setDetails.length],
          ['  helmet variants (sets with several helmets)', `${setDetails.reduce((n, s) => n + s.variants.length, 0)} (${setDetails.filter((s) => s.variants.length > 1).length})`],
          ['  set-bonus effects: stat / special', `${setDetails.reduce((n, s) => n + s.variants.reduce((m, v) => m + v.setBonus.filter((e) => e.kind === 'stat').length, 0), 0)} / ${setDetails.reduce((n, s) => n + s.variants.reduce((m, v) => m + v.setBonus.filter((e) => e.kind === 'special').length, 0), 0)}`],
          ['accessories (Cargo functional "accessory" rows: ' + accessories.identification.typedRows + '; excluded: ' + accessories.identification.excluded.length + '; vanity rows not in scope: ' + accessories.vanityRows.length + ')', accessoryDetails.length],
          ['  effects: stat / special (Unknown records)', `${accessoryDetails.reduce((n, a) => n + a.effects.filter((e) => e.kind === 'stat').length, 0)} / ${accessoryDetails.reduce((n, a) => n + a.effects.filter((e) => e.kind === 'special').length, 0)} (${unknownEffectAccessories.length})`],
          ['  with combinedFrom / upgradesTo (Tinkerer\'s Workshop)', `${accessoryDetails.filter((a) => a.combinedFrom.length > 0).length} / ${accessoryDetails.filter((a) => a.upgradesTo.length > 0).length}`],
          ['  wings with wingStats / wing accessories', `${wingRecords.filter((a) => a.wingStats).length} / ${wingRecords.length}`],
          ['  with ≥1 acquisition route / derived gatedBy', `${accessoryDetails.filter((a) => a.acquisition.length > 0).length} / ${accessoryDetails.filter((a) => a.gatedBy).length}`],
          ['  with a wiki sprite (manifest)', accessories.sprites.length],
        ],
      },
      { title: 'Search docs + conditions + item universe', rows: [['search docs (weapons + ammo items + armor + accessories + armor sets + enemies + bosses + buffs)', searchDocs.length], ['conditions (curated registry)', conditions.length], ['Iteminfo item IDs (universe)', universe.items.length]] },
    ],
    reasonTallies: [
      { title: 'Why drop fields are Unknown (rows per reason)', tally: drops.reasons },
      { title: 'Why weapon fields are Unknown / routes not modeled (weapons per reason)', tally: weapons.reasons },
      { title: 'Why ammo fields are Unknown / routes not modeled (ammo items per reason)', tally: ammo.reasons },
      { title: 'Why ammo gatedBy / stage are Unknown (§7b blockers, ammo items per combination)', tally: ammo.gatingBlockers },
      { title: 'Why buff fields are Unknown (buffs per reason)', tally: buffs.reasons },
      { title: 'Why armor-piece fields are Unknown / routes not modeled (pieces per reason)', tally: armor.reasons },
      { title: 'Why armor-piece gatedBy / stage are Unknown (§7b blockers, pieces per combination)', tally: armor.gatingBlockers },
      { title: 'Why accessory fields are Unknown / routes not modeled (accessories per reason)', tally: accessories.reasons },
      { title: 'Why accessory gatedBy / stage are Unknown (§7b blockers, accessories per combination)', tally: accessories.gatingBlockers },
    ],
    sections,
    ambiguousNames: new Map([...recipes.ambiguousNames, ...drops.ambiguousNames]),
    unknownFields: countUnknownFields(result.dataset),
    resolutions,
    files: sizes,
    fetch: { networkAttempts, note: 'serial, paced 1.1 s start-to-start, maxlag=5; incl. sprite downloads; build itself is offline. Before P2-S2 fixed client pacing, timers firing ~1 ms early produced some 1.099 s gaps (still under 1 req/s)' },
  })
  mkdirSync(dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, report)

  const spriteBinaries = spriteManifest.files.filter((f) => existsSync(join(dirname(spriteManifestPath), '..', f.path.slice(1)))).length
  console.log(`pipeline:build — wrote ${relative(process.cwd(), outDir)} (${files.size} files) + ${relative(process.cwd(), spriteManifestPath)} + ${relative(process.cwd(), reportPath)}`)
  console.log(`  weapons ${weaponDetails.length} (typed rows ${idn.typedRows}, excluded ${idn.excluded.length}); category tree ${cat.treePages} articles → ${cat.buckets['weapon-article'].length} weapon articles hosting ${cat.weaponsOnTreePages} weapons`)
  console.log(`  recipes ${r.emitted}/${r.cargoRows} Cargo rows (legacy ${r.legacyRows}, non-desktop ${r.nonDesktopRows}, duplicate ${r.duplicateRows}, excluded ${r.excludedRows}); with conditions ${r.withConditions}; note stations ${r.availabilityNoteStations}; groups ${recipes.groups.length}`)
  console.log(`  drops ${d.emittedRecords} records from ${d.emittedRows}/${d.cargoRows} rows (non-desktop ${d.nonDesktopRows}, excluded ${d.excludedRows}, split rows ${d.splitRows}, id collisions ${d.idCollisions})`)
  console.log(`  enemies ${enemies.ledger.enemies}; conditions ${conditions.length}; search docs ${searchDocs.length}; item universe ${universe.items.length}`)
  console.log(`  bosses ${first.dataset.bosses.length}; nodes ${first.dataset.nodes.length}; edges ${first.dataset.edges.length}; boss drops linked ${d.bossLinkedRecords}, event-boss n/a ${d.eventBossRecords}, mismatch ${d.bossMismatchRecords}; weapons with gatedBy ${weaponDetails.filter((w) => w.gatedBy).length}/${weaponDetails.length}`)
  console.log(`  armor pieces ${armorDetails.length} (piece rows ${armor.identification.typedRows}, excluded ${armor.identification.excluded.length}); sets ${setDetails.length}/${armor.setPages} set articles (withheld ${withheldSetPages.size}); accessories ${accessoryDetails.length} (functional rows ${accessories.identification.typedRows}, excluded ${accessories.identification.excluded.length}, vanity ${accessories.vanityRows.length}); tinkering links ${tinkeringLinks}; wings ${wingRecords.filter((a) => a.wingStats).length}/${wingRecords.length}; effects Unknown ${unknownEffectAccessories.length}`)
  console.log(`  ammo records ${ammoRecords.length} (items ${itemDetails.length} + weapons-as-ammo ${dualRole.length}; Cargo ammunition rows ${aIdn.typedRows}, excluded ${aIdn.excluded.length}; Iteminfo ammo ${iteminfoAmmo.length}); buffs ${buffs.buffs.length} (dot ${buffs.buffs.filter((b) => b.dot).length}, structured effects ${buffs.buffs.filter((b) => b.effects.length > 0).length})`)
  console.log(`  B22 stage moves: ${b22Moved.map((x) => `${x.name} ${plainStage(x.gatedBy as { bosses: string[] })}→${x.gatedBy?.stage}`).join(', ') || 'none'}`)
  console.log(`  sprites: manifest ${spriteManifest.files.length} files (${spriteManifest.files.filter((f) => f.thumbnail).length} with a thumbnail); binaries present locally ${spriteBinaries}/${spriteManifest.files.length} (npm run pipeline:sprites)`)
  console.log(`  lab (P3-S0): ${labCoverage.map((c) => `${c.family} ${c.simulable}/${c.total} (derived ${c.derived}, overlay ${c.overlay}, downgraded ${c.downgraded})`).join('; ')}; all weapons simulable ${labArchetypeTotal}/${weaponDetails.length}; B36 downgrades ${labB36.length} (B36-only ${labB36Only.length})`)
  console.log(`  gaps ${result.meta.gapSummary.total} (${Object.entries(result.meta.gapSummary.byKind).map(([k, n]) => `${k} ${n}`).join(', ')})`)
  for (const f of sizes) console.log(`  ${f.file.padEnd(28)} ${String(f.bytes).padStart(9)} B  ${(f.gzBytes / 1024).toFixed(1).padStart(7)} KB gz`)
  return 0
}

process.exitCode = await main()
