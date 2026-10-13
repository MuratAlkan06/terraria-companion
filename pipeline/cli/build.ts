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
import { SpriteManifest, STAGE_ORDER, type Condition, type DropSource, type Recipe } from '../../src/schemas'
import { RAW_DIR, runSyncPlan, WikiClient } from '../fetch'
import { renderGapReport } from '../emit/gapReport'
import { checkBudgets, gzSize, serializeObject, serializeRecords, type EmittedFile } from '../emit/write'
import { writeFiles } from '../emit/write'
import { bossAttribution, buildBosses, buildProgression } from '../merge/bosses'
import { buildDrops, indexNpcs } from '../merge/drops'
import { buildEnemies } from '../merge/enemies'
import { Evidence } from '../merge/evidence'
import { createGatingDeriver, GATING_BLOCKERS, type GatingBlocker } from '../merge/gating'
import { conditionMatchers, loadBossesOverlay, loadConditionsOverlay, loadProgressionOverlay, loadWithheldOverlay } from '../merge/overlays'
import { buildRecipes } from '../merge/recipes'
import { PAGE_BUCKET_LABEL, reconcileCategories, reconcileWeaponLists, type PageBucket } from '../merge/reconcile'
import { buildConditions, buildItemUniverse } from '../merge/registry'
import { buildSearchDocs } from '../merge/search'
import { buildWeapons, type WithheldField } from '../merge/weapons'
import { parseIteminfo } from '../parse/iteminfo'
import { parseGameRecipeGroups, parseRecipesL10n, parseWikiRecipeGroups } from '../parse/recipeModules'
import { formatError, formatWarning, validateDataset } from '../validate'
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

// P2-S6: bosses / nodes / edges are produced — references into them are hard checks now (B12)
const PENDING: CollectionKey[] = ['armor', 'accessories', 'items', 'armorSets', 'buffs', 'scenarios']

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
  const stageGaps = [...recipes.gaps, ...drops.gaps, ...weapons.gaps, ...bosses.gaps]

  const generatedAt = [
    sync.iteminfo.fetchedAt,
    ...Object.values(mods).map((m) => m.fetchedAt),
    ...Object.values(sync.tables).map((t) => t.fetchedAt),
    sync.weaponCategories.fetchedAt,
    sync.weaponImages.fetchedAt,
    sync.bossImages.fetchedAt,
    ...[...sync.articles.values()].map((a) => a.fetchedAt),
  ]
    .sort()
    .at(-1) as string

  const manifest: DatasetManifest = {
    name: 'wiki-sync',
    description:
      'Live terraria.wiki.gg sync for Terraria 1.4.5.8 (Desktop): weapons (P2-S2), recipes, recipe groups, drops, enemies and the conditions registry (P2-S2a), bosses and the progression graph (P2-S6), plus search docs. Item IDs resolve against the Module:Iteminfo/data universe; armor/accessory/item detail records, buffs and Lab scenarios are produced by later slices (partial.pending).',
    iteminfo: { rev: iteminfo.rev, syncedTo: iteminfo.terrariaVersion },
    notes: [
      `Sources: Module:Iteminfo/data rev ${iteminfo.rev} (generated ${iteminfo.generated}, game ${iteminfo.terrariaVersion}); ${Object.values(mods).map((m) => `${m.title} rev ${m.rev}`).join('; ')}; Cargo tables fetched ${Object.values(sync.tables).map((t) => `${t.table} ${t.fetchedAt}`).join(', ')}; weapon category tree ${sync.weaponCategories.fetchedAt}; imageinfo ${sync.weaponImages.fetchedAt}.`,
      'Weapons: Cargo Items rows whose infobox type contains "weapon" and whose itemid is the same item in Module:Iteminfo/data (display name, or internal name for unnamed IDs). Stats from Module:Iteminfo/data, cross-checked against the Cargo infobox (a disagreement withholds the value as Unknown + source-mismatch gap). See pipeline/merge/weapons.ts for every field rule.',
      'useTimeTicks = Iteminfo useTime (interval between uses/shots); useAnimationTicks = Iteminfo useAnimation = the wiki\'s displayed "Use time" (TO-VERIFY #10). critPct = the weapon\'s crit bonus (wiki shows 4% + bonus); not applicable for summon weapons (summon damage cannot normally crit). shootSpeedTps = Iteminfo shootSpeed (px/tick) × 3.75, the item stat, not the effective projectile velocity.',
      'Weapon acquisition links recipes (incl. Shimmer), drops (NPCs, bosses, bags, chests, crates) and vendor:<NPC> Cargo tags (purchase; shop conditions Unknown). Weapon gatedBy/stage follow DATA_SCHEMA_SPEC §7b over the progression graph and are Unknown wherever any input is unverified (gap report lists the blockers). Wiki self-conflicts listed in pipeline/overlays/withheld.json (AMENDMENTS-004 B19) withhold the field (Unknown + source-mismatch gap).',
      'Weapon labBehavior defaults to a limitation card (in-game tooltip text where the wiki has one); archetype parameters are assigned by P3-S0.',
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
    ],
    partial: { itemUniverse: ITEM_UNIVERSE_FILE, pending: PENDING },
  }

  // validate pass 1 → the strict-parsed (and possibly Lab-downgraded) weapons the lists project
  const collections: RawDataset['collections'] = {
    weapons: weapons.weapons,
    recipes: recipes.recipes,
    recipeGroups: recipes.groups,
    drops: drops.drops,
    enemies: enemies.enemies,
    conditions,
    bosses: bosses.bosses,
    nodes: progression.nodes,
    edges: progression.edges,
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
  const searchDocs = buildSearchDocs({ weapons: weaponDetails, enemies: enemies.enemies, bosses: first.dataset.bosses })

  // validate pass 2 over exactly what is emitted (details + list + search docs)
  const raw: RawDataset = { manifest, collections: { ...collections, weapons: weaponDetails }, lists: { weapons: weaponList }, searchDocs, itemUniverse: universe, stageGaps }
  const result = validateDataset(raw, { now: new Date(generatedAt) })
  for (const w of result.warnings) console.log(`  ${formatWarning(w)}`)
  if (!result.ok) {
    console.error(`FAIL — validate (emitted form): ${result.errors.length} error(s)`)
    for (const e of result.errors.slice(0, 60)) console.error(`  ${formatError(e).replaceAll('\n', '\n  ')}`)
    return 1
  }

  // sprite manifest (public/, committed; binaries are local-only)
  const spriteManifest = SpriteManifest.parse({ fallbackMode: false, rightsNote: SPRITE_RIGHTS_NOTE, files: [...weapons.sprites, ...bosses.sprites].sort((a, b) => a.path.localeCompare(b.path)) })
  const spritePaths = new Set(spriteManifest.files.map((f) => f.path))
  const usedSprites = [...weaponDetails, ...first.dataset.bosses].flatMap((r) => (r.sprite ? [r.sprite] : []))
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
      id: '#11 ammo modifier location (weapon side)',
      text: `A weapon's ammo class is Iteminfo \`useAmmo\` = the game's AmmoID, i.e. the item ID of the class's representative item (40 Wooden Arrow, 97 Musket Ball, 771 Rocket I, 23 Gel …); ammo items carry the same value in \`ammo\` plus their own \`damage\`, \`knockBack\` and \`shootSpeed\`, which the game adds to the weapon's. ammoClass = slug of the representative item's name (${ammoClasses.length} classes among weapons: ${ammoClasses.join(', ')}). Velocity MULTIPLIERS (B2, e.g. Musket Ball) and per-weapon ammo conversions are not item fields in Iteminfo — they come from projectile code and remain wiki-text facts for the ammo slice (P2-S7). Rule 10 (ammo match) is deferred while items are pending.`,
    },
    {
      id: 'D1 caveat: 1.4.5.7 → 1.4.5.8 patch diff',
      text: 'The 1.4.5.8 patch notes (wiki page "1.4.5.8", rev 1029883) name three weapons — Clay Bud Staff (now always knocks enemies away), Last Prism (laser fades without enough mana), Acorn Slingshot (crash fix) — all behavioral; no numeric item stat changed, so no extracted field is in the patch-diff set. The Cargo cross-check above is the re-confirmation for every compared field.',
    },
    {
      id: 'critPct for summon weapons',
      text: `The wiki's Critical hit page (rev 1032172) states summon damage cannot normally deal critical hits, and the infobox shows no crit for all ${summonCrit.agree} summon weapons; critPct is therefore not applicable (absent, not listed). Classless weapons show no crit either but no rule is documented → Unknown.`,
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
      title: 'Weapons — sprites',
      lines: [
        `public/sprites/manifest.json lists ${weapons.sprites.length}/${weaponDetails.length} weapon sprites and ${bosses.sprites.length}/${first.dataset.bosses.length} boss sprites (${spriteManifest.files.filter((f) => f.path.endsWith('.gif')).length} animated GIFs), each with its wiki File: page, SHA-1, size and rights "re-logic"; ${weaponDetails.length - weapons.sprites.length} weapons have no wiki image and use the placeholder. Binaries are downloaded locally by \`npm run pipeline:sprites\` (verified against imageinfo — exact SHA-1 or CDN original size, see #8; gitignored, never in CI — A10); fallbackMode=false.`,
      ],
    },
  ]

  const sizes: EmittedFile[] = [...budget.sizes, { file: relative(repoRoot, spriteManifestPath), bytes: Buffer.byteLength(spriteManifestText), gzBytes: gzSize(spriteManifestText) }]
  const report = renderGapReport({
    slice: 'P2-S6',
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
          ['Lab: limitation (default) / archetype / custom', `${result.gaps.summary.labCoverage.limitation} / ${result.gaps.summary.labCoverage.archetype} / ${result.gaps.summary.labCoverage.customScenario}`],
        ],
      },
      { title: 'Search docs + conditions + item universe', rows: [['search docs (weapons + enemies + bosses)', searchDocs.length], ['conditions (curated registry)', conditions.length], ['Iteminfo item IDs (universe)', universe.items.length]] },
    ],
    reasonTallies: [
      { title: 'Why drop fields are Unknown (rows per reason)', tally: drops.reasons },
      { title: 'Why weapon fields are Unknown / routes not modeled (weapons per reason)', tally: weapons.reasons },
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
  console.log(`  sprites: manifest ${spriteManifest.files.length} files; binaries present locally ${spriteBinaries}/${spriteManifest.files.length} (npm run pipeline:sprites)`)
  console.log(`  gaps ${result.meta.gapSummary.total} (${Object.entries(result.meta.gapSummary.byKind).map(([k, n]) => `${k} ${n}`).join(', ')})`)
  for (const f of sizes) console.log(`  ${f.file.padEnd(28)} ${String(f.bytes).padStart(9)} B  ${(f.gzBytes / 1024).toFixed(1).padStart(7)} KB gz`)
  return 0
}

process.exitCode = await main()
