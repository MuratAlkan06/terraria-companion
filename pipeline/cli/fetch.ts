/**
 * `npm run pipeline:fetch` — fetch stage. Pulls Module:Iteminfo/data and the Cargo tables in
 * SYNC_TABLES into the gitignored raw cache (pipeline/raw/) under the ADR-001 D2 etiquette
 * (serial, <=1 req/s, maxlag=5, descriptive UA, backoff, stop on persistent errors).
 *
 *   tsx pipeline/cli/fetch.ts [--refresh]
 *
 * Resumable: anything already cached (same request params) is not refetched, so an
 * interrupted run continues where it stopped. --refresh refetches everything.
 * Writes pipeline/raw/fetch-record.json (counts, page sizes, request totals, duration).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { RAW_DIR, runSyncPlan, WikiClient } from '../fetch'

async function main(): Promise<number> {
  const { values } = parseArgs({ options: { refresh: { type: 'boolean', default: false } }, strict: true })
  const client = new WikiClient({ cacheDir: RAW_DIR, refresh: values.refresh, log: (l) => console.log(l) })
  const started = Date.now()
  try {
    const result = await runSyncPlan(client, (l) => console.log(l))
    const durationMs = Date.now() - started
    const logPath = join(RAW_DIR, 'requests.log.jsonl')
    const cumulative = existsSync(logPath) ? readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).length : 0
    const record = {
      finishedAt: new Date().toISOString(),
      durationMs,
      thisRun: client.stats,
      cumulativeNetworkAttempts: cumulative,
      iteminfo: { title: result.iteminfo.title, rev: result.iteminfo.rev, revTimestamp: result.iteminfo.revTimestamp, bytes: result.iteminfo.content.length, fetchedAt: result.iteminfo.fetchedAt },
      modules: Object.values(result.modules).map((m) => ({ title: m.title, rev: m.rev, revTimestamp: m.revTimestamp, fetchedAt: m.fetchedAt })),
      overlayPages: Object.fromEntries([...result.overlayPages].map(([title, p]) => [title, p.exists ? p.resolvedTitle : 'MISSING'])),
      tables: Object.fromEntries(
        Object.values(result.tables).map((t) => [
          t.table,
          { cargoCount: t.cargoCount, rowsFetched: t.rows.length, requestedLimit: t.requestedLimit, rowsPerPage: t.rowsPerPage, fetchedAt: t.fetchedAt, fields: t.selected },
        ]),
      ),
      weaponCategories: {
        roots: result.weaponCategories.roots,
        categories: Object.fromEntries([...result.weaponCategories.categories].map(([t, c]) => [t, { pages: c.pages.length, subcats: c.subcats }])),
        distinctPages: result.weaponCategories.pages.length,
        fetchedAt: result.weaponCategories.fetchedAt,
      },
      weaponImages: { resolved: result.weaponImages.found.size, missing: result.weaponImages.missing, fetchedAt: result.weaponImages.fetchedAt },
      articles: Object.fromEntries([...result.articles].map(([title, a]) => [title, { resolvedTitle: a.resolvedTitle, revid: a.revid, fetchedAt: a.fetchedAt }])),
      bossImages: { resolved: result.bossImages.found.size, missing: result.bossImages.missing, fetchedAt: result.bossImages.fetchedAt },
      projectileinfo: { title: result.projectileinfo.title, rev: result.projectileinfo.rev, revTimestamp: result.projectileinfo.revTimestamp, bytes: result.projectileinfo.content.length, fetchedAt: result.projectileinfo.fetchedAt },
      ammoCategories: {
        roots: result.ammoCategories.roots,
        categories: Object.fromEntries([...result.ammoCategories.categories].map(([t, c]) => [t, { pages: c.pages.length, subcats: c.subcats }])),
        distinctPages: result.ammoCategories.pages.length,
        fetchedAt: result.ammoCategories.fetchedAt,
      },
      ammoImages: { resolved: result.ammoImages.found.size, missing: result.ammoImages.missing, fetchedAt: result.ammoImages.fetchedAt },
    }
    writeFileSync(join(RAW_DIR, 'fetch-record.json'), `${JSON.stringify(record, null, 2)}\n`)
    console.log('\nfetch summary')
    console.log(`  Module:Iteminfo/data rev ${result.iteminfo.rev} (${result.iteminfo.revTimestamp})`)
    for (const m of Object.values(result.modules)) console.log(`  ${m.title} rev ${m.rev} (${m.revTimestamp})`)
    const missing = [...result.overlayPages].filter(([, p]) => !p.exists).map(([t]) => t)
    console.log(`  overlay source pages: ${result.overlayPages.size} checked, ${missing.length} missing${missing.length ? ` (${missing.join(', ')})` : ''}`)
    for (const t of Object.values(result.tables)) {
      console.log(`  ${t.table}: ${t.rows.length}/${t.cargoCount} rows; requested limit ${t.requestedLimit}; rows per page [${t.rowsPerPage.join(', ')}]`)
    }
    const wc = result.weaponCategories
    console.log(`  weapon category tree: ${wc.categories.size} categories, ${wc.pages.length} distinct article pages`)
    console.log(`  weapon images (imageinfo): ${result.weaponImages.found.size} resolved, ${result.weaponImages.missing.length} missing${result.weaponImages.missing.length ? ` (${result.weaponImages.missing.join(', ')})` : ''}`)
    console.log(`  articles (overlay evidence, ammunition rows, Buff IDs, buffs): ${result.articles.size} (rendered text + revision id)`)
    console.log(`  boss images (imageinfo): ${result.bossImages.found.size} resolved, ${result.bossImages.missing.length} missing${result.bossImages.missing.length ? ` (${result.bossImages.missing.join(', ')})` : ''}`)
    console.log(`  ${result.projectileinfo.title} rev ${result.projectileinfo.rev} (${result.projectileinfo.revTimestamp})`)
    console.log(`  ammunition category tree: ${result.ammoCategories.categories.size} categories, ${result.ammoCategories.pages.length} distinct article pages`)
    console.log(`  ammunition images (imageinfo): ${result.ammoImages.found.size} resolved, ${result.ammoImages.missing.length} missing${result.ammoImages.missing.length ? ` (${result.ammoImages.missing.join(', ')})` : ''}`)
    const s = client.stats
    console.log(`  this run: ${s.networkRequests} network requests (${s.attempts} attempts, ${s.retries} retries), ${s.cacheHits} cache hits, ${(durationMs / 1000).toFixed(1)}s wall`)
    console.log(`  cumulative network attempts logged in pipeline/raw/requests.log.jsonl: ${cumulative}`)
    return 0
  } catch (error) {
    console.error(String((error as Error).message))
    console.error(`stopped after ${client.stats.attempts} network attempts; cached progress is kept — rerun to resume.`)
    return 1
  }
}

process.exitCode = await main()
