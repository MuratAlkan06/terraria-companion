/**
 * `npm run pipeline:sprites` — LOCAL ONLY, never in CI (AMENDMENTS-001 A10). Downloads the
 * weapon sprites (the wiki's infobox image of every emitted weapon) into the gitignored
 * public/sprites/weapons/<itemId>.<ext>, and the boss sprites (P2-S6: the registry boss's Cargo
 * NPCs infobox image) into public/sprites/bosses/<npcId>.<ext>, through the ADR-001 D2 etiquette client (serial,
 * >= 1.1 s apart, backoff, audited in pipeline/raw/requests.log.jsonl).
 *
 *   tsx pipeline/cli/sprites.ts [--refresh]
 *
 * Resumable + cached: a file already present (wiki SHA-1, or the served SHA-1 recorded in
 * pipeline/raw/sprites-index.json for the same wiki version) is skipped. Verification: the
 * wiki's SHA-1 exactly, or — when the wiki's CDN (Cloudflare Polish) serves a re-encoded
 * rendition — the CDN's `cf-polished orig_size` equal to the wiki's recorded size of that file
 * version (the URL's ?<sha1-prefix> pins the version). Sprites are Re-Logic IP — never
 * committed; only public/sprites/manifest.json (written by pipeline:build) is.
 * The file list comes from the same cached sync plan as the build (Cargo Items + Iteminfo +
 * imageinfo), so it always matches the manifest. Writes pipeline/raw/sprites-record.json.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { FetchError, RAW_DIR, runSyncPlan, WikiClient } from '../fetch'
import { sha1Hex } from '../fetch/client'
import { bossSprite } from '../merge/bosses'
import { loadBossesOverlay } from '../merge/overlays'
import { identifyWeapons } from '../merge/weapons'
import { parseIteminfo } from '../parse/iteminfo'

const repoRoot = resolve(import.meta.dirname, '..', '..')
const SPRITES_DIR = join(repoRoot, 'public/sprites')

async function main(): Promise<number> {
  const { values } = parseArgs({ options: { refresh: { type: 'boolean', default: false } }, strict: true })
  const client = new WikiClient({ cacheDir: RAW_DIR, refresh: false, log: (l) => console.log(l) })
  const started = Date.now()
  const sync = await runSyncPlan(client)
  const info = parseIteminfo(sync.iteminfo)
  const planRequests = client.stats.networkRequests
  const weaponTargets = identifyWeapons(sync.tables.Items.rows, info)
    .included.flatMap(({ row, item }) => {
      const image = sync.weaponImages.found.get(String(row.imagefile ?? '').trim())
      return image ? [{ id: item.id, label: `weapons/${item.id}`, name: item.name ?? item.internalName, image, dest: join(SPRITES_DIR, 'weapons', `${item.id}.${/\.gif$/i.test(image.file) ? 'gif' : 'png'}`) }] : []
    })
    .sort((a, b) => a.id - b.id)
  const bossTargets = loadBossesOverlay()
    .entries.flatMap((e) => {
      const sp = bossSprite(e, sync.tables.NPCs.rows, sync.bossImages)
      return sp.image ? [{ id: sp.npcId, label: `bosses/${sp.npcId}`, name: e.name, image: sp.image, dest: join(SPRITES_DIR, sp.path.replace(/^\/sprites\//, '')) }] : []
    })
    .sort((a, b) => a.id - b.id)
  const targets = [...weaponTargets, ...bossTargets]

  const downloader = new WikiClient({ cacheDir: RAW_DIR, refresh: values.refresh, log: (l) => console.log(l) })
  const indexPath = join(RAW_DIR, 'sprites-index.json')
  type IndexEntry = { wikiSha1: string; servedSha1: string; verification: 'exact' | 'cdn-optimized' }
  const index: Record<string, IndexEntry> = existsSync(indexPath) ? (JSON.parse(readFileSync(indexPath, 'utf8')) as Record<string, IndexEntry>) : {}
  const bySha = new Map<string, string>()
  const failures: { id: number; name: string; reason: string }[] = []
  const verification = { exact: 0, 'cdn-optimized': 0 }
  let downloaded = 0
  let cached = 0
  let copied = 0
  let stoppedEarly: string | undefined
  for (const t of targets) {
    const key = relative(SPRITES_DIR, t.dest)
    const known = index[key]?.wikiSha1 === t.image.sha1 ? index[key] : undefined
    const twin = bySha.get(t.image.sha1)
    if (twin && !known) {
      copyFileSync(twin, t.dest) // the same wiki file was already fetched for another weapon
      index[key] = { ...index[relative(SPRITES_DIR, twin)] }
      copied += 1
      continue
    }
    try {
      const r = await downloader.download(t.image.url, t.dest, { sha1: t.image.sha1, bytes: t.image.bytes }, `sprite:${t.label}`, known?.servedSha1)
      if (r.fromCache) cached += 1
      else {
        downloaded += 1
        verification[r.verification === 'cached' ? 'exact' : r.verification] += 1
        index[key] = { wikiSha1: t.image.sha1, servedSha1: r.servedSha1, verification: r.verification === 'cached' ? 'exact' : r.verification }
        writeFileSync(indexPath, `${JSON.stringify(index, null, 1)}\n`)
      }
      bySha.set(t.image.sha1, t.dest)
    } catch (error) {
      const e = error as FetchError
      if (e instanceof FetchError && (e.status === 404 || /SHA-1|content-type/.test(e.message))) {
        failures.push({ id: t.id, name: t.name, reason: e.message })
        continue
      }
      stoppedEarly = e.message // blocked / wiki unavailable: stop, keep progress (resumable)
      break
    }
  }
  writeFileSync(indexPath, `${JSON.stringify(index, null, 1)}\n`)
  const isPresent = (t: (typeof targets)[number]) => {
    if (!existsSync(t.dest)) return false
    const sha = sha1Hex(readFileSync(t.dest))
    const entry = index[relative(SPRITES_DIR, t.dest)]
    return sha === t.image.sha1 || (entry?.wikiSha1 === t.image.sha1 && entry.servedSha1 === sha)
  }
  const present = targets.filter(isPresent).length
  const presentByVerification = { exact: 0, 'cdn-optimized': 0 }
  for (const t of targets.filter(isPresent)) presentByVerification[index[relative(SPRITES_DIR, t.dest)]?.verification ?? 'exact'] += 1
  const durationMs = Date.now() - started
  const s = downloader.stats
  const record = {
    finishedAt: new Date().toISOString(),
    durationMs,
    targets: targets.length,
    presentVerified: present,
    presentByVerification,
    verificationThisRun: verification,
    downloadedThisRun: downloaded,
    alreadyCached: cached,
    copiedDuplicates: copied,
    failures,
    stoppedEarly: stoppedEarly ?? null,
    requests: { syncPlan: planRequests, downloads: s.networkRequests, attempts: s.attempts, retries: s.retries, networkMs: s.networkMs, firstRequestAt: s.firstRequestAt ?? null, lastRequestAt: s.lastRequestAt ?? null },
  }
  writeFileSync(join(RAW_DIR, 'sprites-record.json'), `${JSON.stringify(record, null, 2)}\n`)
  console.log('\nsprites summary (weapons + bosses)')
  console.log(`  ${present}/${targets.length} sprite files present and verified in public/sprites/{weapons,bosses} (gitignored; ${weaponTargets.length} weapons + ${bossTargets.length} bosses): ${presentByVerification.exact} byte-exact, ${presentByVerification['cdn-optimized']} CDN-optimized renditions (orig_size = wiki size)`)
  console.log(`  this run: ${downloaded} downloaded, ${cached} already cached, ${copied} copied (identical file), ${failures.length} failed`)
  console.log(`  requests: ${planRequests} sync-plan + ${s.networkRequests} downloads (${s.attempts} attempts, ${s.retries} retries); ${(durationMs / 1000).toFixed(1)}s wall`)
  for (const f of failures) console.log(`  FAILED ${f.id} ${f.name}: ${f.reason}`)
  if (stoppedEarly) {
    console.error(`stopped early: ${stoppedEarly}\nprogress is kept — rerun to resume.`)
    return 1
  }
  return failures.length > 0 ? 1 : 0
}

process.exitCode = await main()
