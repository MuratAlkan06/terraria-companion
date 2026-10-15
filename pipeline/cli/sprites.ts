/**
 * `npm run pipeline:sprites` — LOCAL ONLY, never in CI (AMENDMENTS-001 A10). Downloads the
 * weapon sprites (the wiki's infobox image of every emitted weapon) into the gitignored
 * public/sprites/weapons/<itemId>.<ext>, the boss sprites (P2-S6: the registry boss's Cargo
 * NPCs infobox image) into public/sprites/bosses/<npcId>.<ext> and the ammo item sprites (P2-S7) and
 * potion sprites (B70 P4-prep) into public/sprites/items/<itemId>.<ext>, through the ADR-001 D2 etiquette client (serial,
 * >= 1.1 s apart, backoff, audited in pipeline/raw/requests.log.jsonl). Then writes the B30
 * thumbnails (public/sprites/thumbs/…, first frame of every sprite over 100 KB, emit/thumbnail.ts)
 * from the verified binaries — no network.
 *
 *   tsx pipeline/cli/sprites.ts [--refresh] [--corpus]
 *
 * AMENDMENTS-011 B55 (the P6 encyclopedia slice, AMENDMENTS-016): every armor piece and accessory sprite of the
 * manifest (public/sprites/armor/<id>.<ext>, public/sprites/accessories/<id>.<ext>) — the builder overview and
 * the boss pages draw them.
 *
 * P6-S0 item corpus: the corpus items items.detail.json holds (every item a boss record references —
 * summon and prep-checklist items the shipped boss pages / readiness checker render) are downloaded by
 * default; `--corpus` adds every other corpus item of the manifest (≈ 4,900 files ≈ 90 min at the D2
 * pace — deferred until the encyclopedia view ships, the AMENDMENTS-011 B55 precedent). Their image
 * URLs are the cached imageinfo of the manifest entry's SHA-1.
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
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { FetchError, RAW_DIR, runSyncPlan, WikiClient } from '../fetch'
import { sha1Hex } from '../fetch/client'
import { gifThumbnail, thumbnailFor } from '../emit/thumbnail'
import { SpriteManifest } from '../../src/schemas'
import { identifyAmmo } from '../merge/ammo'
import { identifyPotions } from '../merge/potions'
import { bossSprite } from '../merge/bosses'
import { loadBossesOverlay } from '../merge/overlays'
import { identifyWeapons } from '../merge/weapons'
import { parseIteminfo } from '../parse/iteminfo'

const repoRoot = resolve(import.meta.dirname, '..', '..')
const SPRITES_DIR = join(repoRoot, 'public/sprites')

async function main(): Promise<number> {
  const { values } = parseArgs({ options: { refresh: { type: 'boolean', default: false }, corpus: { type: 'boolean', default: false } }, strict: true })
  const client = new WikiClient({ cacheDir: RAW_DIR, refresh: false, log: (l) => console.log(l) })
  const started = Date.now()
  const sync = await runSyncPlan(client)
  const info = parseIteminfo(sync.iteminfo)
  const planRequests = client.stats.networkRequests
  const weapons = identifyWeapons(sync.tables.Items.rows, info).included
  const weaponTargets = weapons
    .flatMap(({ row, item }) => {
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
  // P2-S7 ammo items (a weapon that is also ammo keeps its weapon sprite)
  const weaponIds = new Set(weapons.map((w) => w.item.id))
  const itemTargets = identifyAmmo(sync.tables.Items.rows, info)
    .included.filter(({ item }) => !weaponIds.has(item.id))
    .flatMap(({ row, item, name }) => {
      const image = sync.ammoImages.found.get(String(row.imagefile ?? '').trim())
      return image ? [{ id: item.id, label: `items/${item.id}`, name, image, dest: join(SPRITES_DIR, 'items', `${item.id}.${/\.gif$/i.test(image.file) ? 'gif' : 'png'}`) }] : []
    })
    .sort((a, b) => a.id - b.id)
  // B70 potion corpus (an item emitted as ammo keeps its ammo sprite)
  const ammoIds = new Set(itemTargets.map((t) => t.id))
  const potionTargets = identifyPotions(sync.tables.Items.rows, info)
    .included.filter(({ item }) => !weaponIds.has(item.id) && !ammoIds.has(item.id))
    .flatMap(({ row, item, name }) => {
      const image = sync.potionImages.found.get(String(row.imagefile ?? '').trim())
      return image ? [{ id: item.id, label: `items/${item.id}`, name, image, dest: join(SPRITES_DIR, 'items', `${item.id}.${/\.gif$/i.test(image.file) ? 'gif' : 'png'}`) }] : []
    })
    .sort((a, b) => a.id - b.id)
  // P6-S0 corpus items (see the header): core by default, every one with --corpus
  const manifest = SpriteManifest.parse(JSON.parse(readFileSync(join(SPRITES_DIR, 'manifest.json'), 'utf8')))
  const imageBySha = new Map([sync.weaponImages, sync.ammoImages, sync.equipmentImages, sync.potionImages, sync.corpusImages].flatMap((f) => [...f.found.values()].map((i) => [i.sha1, i] as const)))
  const coreIds = new Set((JSON.parse(readFileSync(join(repoRoot, 'src/data/items.detail.json'), 'utf8')) as { id: number }[]).map((i) => i.id))
  const taken = new Set([...itemTargets, ...potionTargets].map((t) => t.dest))
  const manifestTargets = (dir: string, wanted: (id: number) => boolean) =>
    manifest.files
      .filter((f) => f.path.startsWith(`/sprites/${dir}/`))
      .flatMap((f) => {
        const id = Number(f.ref.slice(2))
        const dest = join(SPRITES_DIR, f.path.replace(/^\/sprites\//, ''))
        const image = imageBySha.get(f.sha1)
        if (!wanted(id) || taken.has(dest) || !image) return []
        return [{ id, label: `${dir}/${id}`, name: info.items.get(id)?.name ?? `item ${id}`, image, dest }]
      })
      .sort((a, b) => a.id - b.id)
  const corpusTargets = manifestTargets('items', (id) => values.corpus || coreIds.has(id))
  // AMENDMENTS-011 B55 (rides the P6 encyclopedia slice, AMENDMENTS-016): armor piece + accessory sprites, every one
  const armorTargets = manifestTargets('armor', () => true)
  const accessoryTargets = manifestTargets('accessories', () => true)
  const targets = [...weaponTargets, ...bossTargets, ...itemTargets, ...potionTargets, ...corpusTargets, ...armorTargets, ...accessoryTargets]

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

  // AMENDMENTS-007 B30: static first-frame thumbnails of heavy sprites, from the verified binaries only
  const thumbnails: { path: string; source: string; bytes: number; width: number; height: number }[] = []
  for (const t of targets) {
    const path = `/sprites/${relative(SPRITES_DIR, t.dest)}`
    const expected = thumbnailFor({ path, bytes: t.image.bytes, width: t.image.width, height: t.image.height })
    if (!expected) continue
    if (!isPresent(t)) {
      failures.push({ id: t.id, name: t.name, reason: `thumbnail ${expected.path}: source sprite not present / not verified` })
      continue
    }
    const thumb = gifThumbnail(readFileSync(t.dest))
    if (thumb.width !== expected.width || thumb.height !== expected.height) {
      failures.push({ id: t.id, name: t.name, reason: `thumbnail ${expected.path}: decoded ${thumb.width}×${thumb.height}, manifest expects ${expected.width}×${expected.height}` })
      continue
    }
    const out = join(SPRITES_DIR, expected.path.replace(/^\/sprites\//, ''))
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, thumb.png)
    thumbnails.push({ path: expected.path, source: path, bytes: thumb.png.length, width: thumb.width, height: thumb.height })
  }
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
    thumbnails,
    failures,
    stoppedEarly: stoppedEarly ?? null,
    requests: { syncPlan: planRequests, downloads: s.networkRequests, attempts: s.attempts, retries: s.retries, networkMs: s.networkMs, firstRequestAt: s.firstRequestAt ?? null, lastRequestAt: s.lastRequestAt ?? null },
  }
  writeFileSync(join(RAW_DIR, 'sprites-record.json'), `${JSON.stringify(record, null, 2)}\n`)
  console.log(`\nsprites summary (weapons + bosses + ammo items + potions + ${values.corpus ? 'every corpus item' : 'core corpus items'} + armor + accessories)`)
  console.log(`  ${present}/${targets.length} sprite files present and verified in public/sprites/{weapons,bosses,items,armor,accessories} (gitignored; ${weaponTargets.length} weapons + ${bossTargets.length} bosses + ${itemTargets.length} ammo items + ${potionTargets.length} potions + ${corpusTargets.length} corpus items + ${armorTargets.length} armor pieces + ${accessoryTargets.length} accessories): ${presentByVerification.exact} byte-exact, ${presentByVerification['cdn-optimized']} CDN-optimized renditions (orig_size = wiki size)`)
  for (const t of thumbnails) console.log(`  thumbnail ${t.path} ${t.width}×${t.height} ${t.bytes} B (from ${t.source})`)
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
