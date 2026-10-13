/**
 * `npm run pipeline:build` — parse → merge → cross-check → validate → emit, OFFLINE from the raw
 * cache written by `npm run pipeline:fetch` (zero network; a cache miss is E_FETCH).
 *
 *   tsx pipeline/cli/build.ts [--out <dir>] [--report <file>]
 *
 * Defaults: --out src/data, --report pipeline/reports/gap-report.md. Nothing is written unless
 * validation and the 300 KB gz budgets pass. Output is deterministic for a given cache +
 * overlays (generatedAt = newest fetch timestamp, not the wall clock).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { RAW_DIR, runSyncPlan, WikiClient } from '../fetch'
import { renderGapReport } from '../emit/gapReport'
import { checkBudgets, serializeObject, serializeRecords, type EmittedFile } from '../emit/write'
import { writeFiles } from '../emit/write'
import { buildDrops, indexNpcs } from '../merge/drops'
import { buildEnemies } from '../merge/enemies'
import { conditionMatchers, loadConditionsOverlay } from '../merge/overlays'
import { buildRecipes } from '../merge/recipes'
import { buildConditions, buildItemUniverse } from '../merge/registry'
import { parseIteminfo } from '../parse/iteminfo'
import { parseGameRecipeGroups, parseRecipesL10n, parseWikiRecipeGroups } from '../parse/recipeModules'
import { formatError, formatWarning, validateDataset } from '../validate'
import {
  COLLECTION_KEYS,
  COLLECTIONS,
  ITEM_UNIVERSE_FILE,
  MANIFEST_FILE,
  OUTPUT_FILES,
  STAGE_GAPS_FILE,
  type CollectionKey,
  type Dataset,
  type DatasetManifest,
  type RawDataset,
} from '../validate/dataset'

const repoRoot = resolve(import.meta.dirname, '..', '..')

const PENDING: CollectionKey[] = ['weapons', 'armor', 'accessories', 'items', 'armorSets', 'bosses', 'nodes', 'edges', 'buffs', 'scenarios']

const RESOLUTIONS = [
  {
    id: '#2 recipe-group encoding',
    text: 'Cargo Recipes stores a group ingredient as its plain English name ("¦Any Iron Bar¦" in `ingredients`, "Any Iron Bar¦2" in `args`, "¦Any Iron Bar¦2" in `ings`); members are not in Cargo. Members come from Module:Recipes `group("Any …", {names})` (what the {{recipes}} template uses), resolved to IDs via Module:Iteminfo/data and cross-checked against Module:RecipeGroups (the game\'s SetupRecipeGroups, v1.4.5.4 transcription). Station alternatives (B3) come from Module:Recipes/l10n `en.station_cate` ("Iron Anvil" → "Iron or Lead Anvil").',
  },
  {
    id: '#3 drop NPC ids / multi-part bosses',
    text: 'Cargo Drops `id` carries NPC ids for most NPC rows (single, comma lists, ranges, per-variant notes, negative variant netIDs); container rows (crates, chests, treasure bags) carry none or the boss id. Ids are cross-checked against Cargo NPCs by name (mismatches withheld + gap); empty ids are filled from NPCs. Multi-part bosses: every part/segment NPC is typed `boss Part` and lives on the boss article (`_page`), so drops attribute to that boss. bossId stays absent + listed until the P2-S6 boss registry exists.',
  },
  {
    id: '#13 Cargo paging',
    text: 'limit=5000 requested; the server returned at most 500 rows per page for every table (Recipes 9 pages, Drops 7, NPCs 2). Pagination is by offset ordered by _ID until COUNT(*) is reached.',
  },
]

function countUnknownFields(ds: Dataset): Map<string, number> {
  const counts = new Map<string, number>()
  for (const key of COLLECTION_KEYS) {
    for (const r of ds[key] as readonly { _prov: { unverifiedFields: string[] } }[]) {
      for (const f of r._prov.unverifiedFields) counts.set(`${key} · ${f}`, (counts.get(`${key} · ${f}`) ?? 0) + 1)
    }
  }
  return counts
}

function collectionFile(key: CollectionKey): string {
  return COLLECTIONS[key].file
}

async function main(): Promise<number> {
  const { values } = parseArgs({ options: { out: { type: 'string' }, report: { type: 'string' } }, strict: true })
  const outDir = resolve(values.out ?? join(repoRoot, 'src/data'))
  const reportPath = resolve(values.report ?? join(repoRoot, 'pipeline/reports/gap-report.md'))

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
  const drops = buildDrops({ rows: sync.tables.Drops.rows, fetchedAt: sync.tables.Drops.fetchedAt, npcs: npcIndex, npcsFetchedAt: sync.tables.NPCs.fetchedAt, iteminfo, conditions: matchers })
  const enemies = buildEnemies(sync.tables.NPCs.rows, drops.drops, sync.tables.NPCs.fetchedAt, sync.tables.Drops.fetchedAt)
  const universe = buildItemUniverse(iteminfo)
  const stageGaps = [...recipes.gaps, ...drops.gaps]

  const generatedAt = [sync.iteminfo.fetchedAt, ...Object.values(mods).map((m) => m.fetchedAt), ...Object.values(sync.tables).map((t) => t.fetchedAt)].sort().at(-1) as string

  const manifest: DatasetManifest = {
    name: 'wiki-sync',
    description:
      'Live terraria.wiki.gg sync (P2-S2a): recipes, recipe groups, drops, enemies and the conditions registry for Terraria 1.4.5.8 (Desktop). Item IDs resolve against the Module:Iteminfo/data universe; weapon/armor/accessory/item detail records, bosses and progression are produced by later slices (partial.pending).',
    iteminfo: { rev: iteminfo.rev, syncedTo: iteminfo.terrariaVersion },
    notes: [
      `Sources: Module:Iteminfo/data rev ${iteminfo.rev} (generated ${iteminfo.generated}, game ${iteminfo.terrariaVersion}); ${Object.values(mods).map((m) => `${m.title} rev ${m.rev}`).join('; ')}; Cargo Recipes/Drops/NPCs fetched ${Object.values(sync.tables).map((t) => `${t.table} ${t.fetchedAt}`).join(', ')}.`,
      'Recipes: desktop rows only (legacy=0 and version empty or containing "desktop"); result = Cargo resultid checked against the Iteminfo name; ingredients from `ings`; "Any X" → Module:Recipes groups; stations split on " and " → registered environment condition, else Module:Recipes/l10n station category group (B3), else item; "By Hand" = no stations.',
      'Recipe result notes (#note_post_moon_lord, #note_moon_N, …) are availability conditions; the Recipe schema has no conditions field, so they are emitted as environment stations referencing the condition (e.g. {kind:"environment", condition:"post-moon-lord"}).',
      'Recipe ids: resultItemId-fnv1a32hex(JSON.stringify({s: sorted station refs (i:/grp:/cond:), i: sorted "ref*amount"})); same canonical recipe with a different result amount gets a -2 suffix. Drop ids: itemId-slug(npcName)-fnv1a32hex(JSON.stringify(sorted conditions)), -N suffix on collision.',
      'Drops: rows whose platform icons exclude Desktop are skipped; normal/expert/master flags give the applicable difficulties; rate/quantity cells are parsed per pipeline/parse/dropCells.ts; anything else is absent + listed (Unknown). Unregistered notes make conditions Unknown ([] + "conditions" listed).',
      'Boss drops (source NPC typed boss / boss Part in Cargo NPCs, or a treasure bag) list source.bossId as unverified until the P2-S6 boss registry exists.',
      'Enemies: Cargo NPCs rows with an enemy type and no boss/critter/town/projectile type, merged by name; biomes = NPCs `environment` alternatives verbatim ("/" = or, "+" = and); stage absent + listed; dropIds derived (deriveEnemyDropIds).',
      'Conditions: curated overlay pipeline/overlays/conditions.json; every cited page verified to exist by the fetch stage; satisfiedByNode slugs are deferred references into the P2-S6 progression graph.',
      'Collections are emitted as JSON arrays (one record per line), matching the P2-S1 validator; DATA_SCHEMA_SPEC §3/§5 describe slug-keyed maps for groups/conditions — flagged for doc parity.',
    ],
    partial: { itemUniverse: ITEM_UNIVERSE_FILE, pending: PENDING },
  }

  const collections: RawDataset['collections'] = {
    recipes: recipes.recipes,
    recipeGroups: recipes.groups,
    drops: drops.drops,
    enemies: enemies.enemies,
    conditions,
  }
  const raw: RawDataset = { manifest, collections, lists: {}, itemUniverse: universe, stageGaps }
  const result = validateDataset(raw, { now: new Date(generatedAt) })
  for (const w of result.warnings) console.log(`  ${formatWarning(w)}`)
  if (!result.ok) {
    console.error(`FAIL — validate: ${result.errors.length} error(s)`)
    for (const e of result.errors.slice(0, 60)) console.error(`  ${formatError(e).replaceAll('\n', '\n  ')}`)
    if (result.errors.length > 60) console.error(`  … ${result.errors.length - 60} more`)
    return 1
  }

  const files = new Map<string, string>([
    [MANIFEST_FILE, serializeObject(manifest)],
    [ITEM_UNIVERSE_FILE, `{"source":${JSON.stringify(universe.source)},"items":${serializeRecords(universe.items).trimEnd()}}\n`],
    [STAGE_GAPS_FILE, serializeRecords(stageGaps)],
    [collectionFile('recipes'), serializeRecords(recipes.recipes)],
    [collectionFile('recipeGroups'), serializeRecords(recipes.groups)],
    [collectionFile('drops'), serializeRecords(drops.drops)],
    [collectionFile('enemies'), serializeRecords(enemies.enemies)],
    [collectionFile('conditions'), serializeRecords(conditions)],
    ['meta.json', serializeObject(result.meta)],
    ['gaps.json', `{"generatedAt":${JSON.stringify(result.gaps.generatedAt)},"gameVersion":${JSON.stringify(result.gaps.gameVersion)},"summary":${JSON.stringify(result.gaps.summary)},"entries":${serializeRecords(result.gaps.entries).trimEnd()}}\n`],
  ])
  const budget = checkBudgets(files)
  if (budget.errors.length > 0) {
    for (const e of budget.errors) console.error(`  ${formatError(e)}`)
    return 1
  }

  const owned = new Set<string>([MANIFEST_FILE, ITEM_UNIVERSE_FILE, STAGE_GAPS_FILE, ...OUTPUT_FILES, ...Object.values(COLLECTIONS).map((c) => c.file.split('#')[0])])
  writeFiles(outDir, files, (f) => owned.has(f))

  const logPath = join(RAW_DIR, 'requests.log.jsonl')
  const networkAttempts = existsSync(logPath) ? readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).length : 0
  const r = recipes.ledger
  const d = drops.ledger
  const sizes: EmittedFile[] = budget.sizes
  const report = renderGapReport({
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
          ['  of which availability notes still stored as environment stations (AMENDMENTS-003 B9: migrate to Recipe.conditions)', r.availabilityNoteStations],
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
        title: `Enemies (Cargo NPCs COUNT(*) ${sync.tables.NPCs.cargoCount})`,
        rows: [
          ['NPC rows fetched', enemies.ledger.npcRows],
          ['enemy-typed rows (no boss/critter/town/projectile type)', enemies.ledger.enemyRows],
          ['= enemies (rows merged by name)', enemies.ledger.enemies],
          ['enemies with ≥1 derived drop', enemies.enemies.filter((e) => e.dropIds.length > 0).length],
        ],
      },
      { title: 'Conditions + item universe', rows: [['conditions (curated registry)', conditions.length], ['Iteminfo item IDs (universe)', universe.items.length]] },
    ],
    reasonTallies: [{ title: 'Why drop fields are Unknown (rows per reason)', tally: drops.reasons }],
    ambiguousNames: new Map([...recipes.ambiguousNames, ...drops.ambiguousNames]),
    unknownFields: countUnknownFields(result.dataset),
    resolutions: RESOLUTIONS,
    files: sizes,
    fetch: { networkAttempts, note: 'serial, >=1.1 s apart, maxlag=5; build itself is offline' },
  })
  mkdirSync(dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, report)

  console.log(`pipeline:build — wrote ${relative(process.cwd(), outDir)} (${files.size} files) + ${relative(process.cwd(), reportPath)}`)
  console.log(`  recipes ${r.emitted}/${r.cargoRows} Cargo rows (legacy ${r.legacyRows}, non-desktop ${r.nonDesktopRows}, duplicate ${r.duplicateRows}, excluded ${r.excludedRows}); groups ${recipes.groups.length}`)
  console.log(`  drops ${d.emittedRecords} records from ${d.emittedRows}/${d.cargoRows} rows (non-desktop ${d.nonDesktopRows}, excluded ${d.excludedRows}, split rows ${d.splitRows}, id collisions ${d.idCollisions})`)
  console.log(`  enemies ${enemies.ledger.enemies}; conditions ${conditions.length}; item universe ${universe.items.length}`)
  console.log(`  gaps ${result.meta.gapSummary.total} (${Object.entries(result.meta.gapSummary.byKind).map(([k, n]) => `${k} ${n}`).join(', ')})`)
  for (const f of sizes) console.log(`  ${f.file.padEnd(20)} ${String(f.bytes).padStart(9)} B  ${(f.gzBytes / 1024).toFixed(1).padStart(7)} KB gz`)
  return 0
}

process.exitCode = await main()
