/**
 * Boss registry + progression graph (P2-S6): pipeline/overlays/bosses.json + progression.json
 * (curated, every claim a verbatim quote checked by merge/evidence.ts) + Cargo NPCs (stats, NPC ids,
 * environment, sprite file) + DropSource (derived dropIds) → Boss[], ProgressionNode[], ProgressionEdge[].
 *
 * Field rules (DATA_SCHEMA_SPEC §2.8, AMENDMENTS-001 A1/A3, AMENDMENTS-003 B10/B12):
 * - npcIds: every Desktop Cargo NPCs row on the boss article typed `boss` / `boss Part` (the same
 *   rule that attributes drops to the boss, merge/drops.ts) — multi-part bosses list every part.
 * - statsByDifficulty: the overlay's representative row (`primary`) through parse/npcStats.ts. A
 *   difficulty is emitted only when both hp and defense are single verified integers; contact damage
 *   is added when verified (> 0; 0 = no contact damage → not applicable). Multi-part bosses whose
 *   boss-level stats are not one row (`statsUnknown`) and every unparseable cell are Unknown.
 * - location.biomes: the primary row's Cargo `environment` alternatives verbatim (as enemies);
 *   location.time: only with a quote stating it, else Unknown.
 * - summon: item names → Iteminfo IDs (exact + unambiguous or the build fails), registry
 *   conditions, the verbatim quote as text, its article as sourceUrl.
 * - attackPatternTags: A1 staging — only tags with a behavior quote (editorialFields); else absent +
 *   listed. suggestedEquipment / prepChecklist / strategies: absent + listed (enforced at P5 by
 *   E_BOSS_CURATION, not here).
 * - stage: editorial (overlay). dropIds: derived from DropSource.source.bossId (§7a-3).
 * - Nodes: one boss node per boss (same slug, Boss↔Node 1:1) + the overlay's event / milestone
 *   markers (A3: markers only). Edges: overlay, note = the verbatim quote, sourceUrl = its article.
 */
import type { Boss, BossStats, DropSource, GapEntry, ProgressionEdge, ProgressionNode, ProvSource, SpriteManifestFile } from '../../src/schemas'
import type { CargoRow } from '../fetch/cargo'
import type { ImageInfo, ImageInfoFetch } from '../fetch/images'
import { notesOf, platformsOf, type Difficulty } from '../parse/dropCells'
import { resolveItemName, type Iteminfo } from '../parse/iteminfo'
import { parseNpcStat, type PerDifficulty } from '../parse/npcStats'
import { stripMarkup } from '../parse/text'
import { BOSS_TYPES } from './drops'
import { Evidence } from './evidence'
import type { BossesOverlay, BossOverlayEntry, NpcRowRef, ProgressionOverlay } from './overlays'
import { GapLog, isoDate, makeProv, moduleSource } from './prov'
import { OverlayError } from './registry'

const DIFFS: readonly Difficulty[] = ['classic', 'expert', 'master']
const A1_STAGED = ['prepChecklist', 'strategies', 'suggestedEquipment'] as const

const str = (v: CargoRow[string] | undefined) => (v === null || v === undefined ? '' : String(v))
const types = (row: CargoRow) => str(row.type).split('^').map((t) => t.trim()).filter(Boolean)
const isDesktop = (row: CargoRow) => {
  const p = platformsOf(str(row.name))
  return p.length === 0 || p.some((x) => x.includes('Desktop'))
}

/** Desktop Cargo NPCs rows on `page` typed boss / boss Part. */
export function bossRows(npcRows: readonly CargoRow[], page: string): CargoRow[] {
  return npcRows.filter((r) => str(r._page) === page && isDesktop(r) && types(r).some((t) => (BOSS_TYPES as readonly string[]).includes(t)))
}

export interface BossAttribution {
  id: string
  npcIds: ReadonlySet<number>
}

/** Boss article → registry boss (drop attribution, merge/drops.ts). */
export function bossAttribution(overlay: BossesOverlay, npcRows: readonly CargoRow[]): Map<string, BossAttribution> {
  return new Map(overlay.entries.map((e) => [e.page, { id: e.id, npcIds: new Set(npcIdsOf(bossRows(npcRows, e.page))) }]))
}

const npcIdsOf = (rows: readonly CargoRow[]) => [...new Set(rows.map((r) => Number(str(r.npcid))).filter((n) => Number.isInteger(n) && n !== 0))].sort((a, b) => a - b)

/** Image file of an NPC row's infobox image ("[[File:King Slime.gif|link=]]" → "King Slime.gif"). */
export const npcImageFile = (row: CargoRow): string | undefined => /\[\[File:([^|\]]+)/.exec(str(row.image))?.[1]?.trim()

/** Every boss-row image file of the registry (the sync plan fetches their imageinfo). */
export function bossImageFiles(overlay: BossesOverlay, npcRows: readonly CargoRow[]): string[] {
  return overlay.entries.flatMap((e) => bossRows(npcRows, e.page).flatMap((r) => npcImageFile(r) ?? []))
}

function selectRow(npcRows: readonly CargoRow[], e: BossOverlayEntry, ref: NpcRowRef, what: string): CargoRow {
  const matches = npcRows.filter((r) => str(r._page) === e.page && isDesktop(r) && Number(str(r.npcid)) === ref.npcId && notesOf(str(r.name)).join(', ') === (ref.variant ?? ''))
  if (matches.length !== 1) throw new OverlayError(`[E_SCHEMA] overlay bosses/${e.id}: ${what} row npcId ${ref.npcId}${ref.variant ? ` "${ref.variant}"` : ''} matches ${matches.length} Cargo NPCs rows on "${e.page}" (expected exactly 1)`)
  return matches[0]
}

/** A boss's sprite: the `sprite` (else `primary`) row's infobox image → /sprites/bosses/<npcId>.<ext>. */
export function bossSprite(e: BossOverlayEntry, npcRows: readonly CargoRow[], images: ImageInfoFetch): { path: string; npcId: number; file?: string; image?: ImageInfo } {
  const row = selectRow(npcRows, e, e.sprite ?? e.primary, e.sprite ? 'sprite' : 'primary')
  const npcId = Number(str(row.npcid))
  const file = npcImageFile(row)
  const image = file ? images.found.get(file) : undefined
  return { path: `/sprites/bosses/${npcId}.${image && /\.gif$/i.test(image.file) ? 'gif' : 'png'}`, npcId, ...(file ? { file } : {}), ...(image ? { image } : {}) }
}

export interface BossStatsRow {
  id: string
  name: string
  /** Per difficulty: "hp/def[/contact]" or "Unknown". */
  byDifficulty: Record<Difficulty, string>
  reasons: string[]
}

export interface BossBuildInput {
  overlay: BossesOverlay
  npcRows: readonly CargoRow[]
  npcsFetchedAt: string
  dropsFetchedAt: string
  /** Drops with source.bossId already attributed (merge/drops.ts). */
  drops: readonly DropSource[]
  evidence: Evidence
  iteminfo: Iteminfo
  images: ImageInfoFetch
}

export interface BossBuild {
  bosses: Boss[]
  sprites: SpriteManifestFile[]
  gaps: GapEntry[]
  stats: BossStatsRow[]
}

export function buildBosses(input: BossBuildInput): BossBuild {
  const { overlay, evidence, iteminfo } = input
  const gaps = new GapLog()
  const sprites: SpriteManifestFile[] = []
  const stats: BossStatsRow[] = []
  const bosses: Boss[] = []
  const iteminfoSrc = moduleSource('iteminfo', { title: 'Module:Iteminfo/data', rev: iteminfo.rev, fetchedAt: iteminfo.fetchedAt })
  const dropsByBoss = new Map<string, string[]>()
  for (const d of input.drops) if (d.source.bossId) dropsByBoss.set(d.source.bossId, [...(dropsByBoss.get(d.source.bossId) ?? []), d.id])

  for (const e of overlay.entries) {
    const where = `overlay bosses/${e.id}`
    const article = evidence.page(e.page, where)
    const wikiUrl = article.url
    const rows = bossRows(input.npcRows, e.page)
    if (rows.length === 0) throw new OverlayError(`[E_SCHEMA] ${where}: no Cargo NPCs row typed boss/boss Part on "${e.page}"`)
    const primary = selectRow(input.npcRows, e, e.primary, 'primary')
    if (!rows.includes(primary)) throw new OverlayError(`[E_SCHEMA] ${where}: primary row is not typed boss/boss Part`)
    const unverified: string[] = []
    const editorial = ['stage']

    // stats
    const statsByDifficulty: Boss['statsByDifficulty'] = {}
    const statRow: BossStatsRow = { id: e.id, name: e.name, byDifficulty: { classic: 'Unknown', expert: 'Unknown', master: 'Unknown' }, reasons: [] }
    if (e.statsUnknown) {
      for (const d of DIFFS) unverified.push(`statsByDifficulty.${d}`)
      statRow.reasons.push(e.statsUnknown)
    } else {
      const parsed = (k: 'life' | 'defense' | 'damage'): PerDifficulty => {
        const p = parseNpcStat(str(primary[k]), k)
        if (!p.ok) statRow.reasons.push(`${k === 'life' ? 'hp' : k === 'damage' ? 'contact damage' : k}: ${p.reason}`)
        return p.ok ? p.value : {}
      }
      const [hp, def, dmg] = [parsed('life'), parsed('defense'), parsed('damage')]
      for (const d of DIFFS) {
        if (hp[d] === undefined || def[d] === undefined || hp[d] === 0) {
          unverified.push(`statsByDifficulty.${d}`)
          continue
        }
        const s: BossStats = { hp: hp[d], defense: def[d] }
        if (dmg[d] === undefined) unverified.push(`statsByDifficulty.${d}.contactDamage`)
        else if (dmg[d] > 0) s.contactDamage = dmg[d]
        statsByDifficulty[d] = s
        statRow.byDifficulty[d] = `${s.hp} / ${s.defense} / ${s.contactDamage ?? (dmg[d] === 0 ? 'none' : 'Unknown')}`
      }
    }
    stats.push(statRow)

    // summon
    const items = e.summon.items.map((name) => {
      const r = resolveItemName(iteminfo, name)
      if (!r.ok || r.ambiguous) throw new OverlayError(`[E_SCHEMA] ${where}: summon item "${name}" does not resolve to exactly one Module:Iteminfo/data item${r.ok ? ` (ambiguous: ${r.ambiguous?.join(', ')})` : ` (${r.reason})`}`)
      return r.id
    })
    const summonPage = evidence.quote(e.page, e.summon.quote, `${where} summon`)

    // location
    const env = stripMarkup(str(primary.environment))
    const biomes = [...new Set(env.split('/').map((alt) => alt.split('+').map((p) => p.trim()).filter(Boolean).join(' + ')).filter(Boolean))]
    if (biomes.length === 0) unverified.push('location.biomes')
    if (e.time) evidence.quote(e.page, e.time.quote, `${where} time`)
    else unverified.push('location.time')

    // attack pattern tags (A1 staging: only quoted ones)
    const tagSources: ProvSource[] = []
    for (const t of e.attackPatternTags) tagSources.push(Evidence.source('bosses', evidence.quote(t.page ?? e.page, t.quote, `${where} attackPatternTags.${t.tag}`)))
    const tags = e.attackPatternTags.map((t) => t.tag).sort()
    if (tags.length > 0) editorial.push('attackPatternTags')
    else unverified.push('attackPatternTags')
    unverified.push(...A1_STAGED)

    // sprite
    const sp = bossSprite(e, input.npcRows, input.images)
    let sprite: string | undefined
    if (sp.image) {
      sprite = sp.path
      sprites.push({ path: sprite, ref: `boss:${e.id}`, wikiFileUrl: sp.image.descriptionUrl, sha1: sp.image.sha1, bytes: sp.image.bytes, width: sp.image.width, height: sp.image.height, rights: 're-logic' })
    } else {
      gaps.add({ ref: `boss:${e.id}`, field: 'sprite', kind: 'missing-sprite', detail: `${e.name}: no wiki image file resolved for the Cargo NPCs image "${sp.file ?? '(none)'}"; the placeholder sprite is shown`, sources: [wikiUrl] })
    }

    const dropIds = [...(dropsByBoss.get(e.id) ?? [])].sort()
    const sources: ProvSource[] = [
      { kind: 'cargo:NPCs', url: wikiUrl, fetchedAt: isoDate(input.npcsFetchedAt) },
      ...(dropIds.length > 0 ? [{ kind: 'cargo:Drops' as const, url: wikiUrl, fetchedAt: isoDate(input.dropsFetchedAt) }] : []),
      Evidence.source('bosses', summonPage),
      ...(items.length > 0 ? [iteminfoSrc] : []),
      ...tagSources,
    ]
    const prov = makeProv(sources, unverified)
    prov.editorialFields = editorial.sort()
    bosses.push({
      id: e.id,
      name: e.name,
      nodeId: e.id,
      npcIds: npcIdsOf(rows),
      wikiUrl,
      ...(sprite ? { sprite } : {}),
      stage: e.stage,
      ...(e.worldEvil ? { worldEvil: e.worldEvil } : {}),
      summon: { items, conditions: [...e.summon.conditions], text: e.summon.quote, sourceUrl: summonPage.url },
      location: { biomes, ...(e.time ? { time: e.time.value } : {}) },
      statsByDifficulty,
      ...(tags.length > 0 ? { attackPatternTags: tags } : {}),
      dropIds,
      _prov: prov,
    })
  }
  return { bosses: bosses.sort((a, b) => a.id.localeCompare(b.id)), sprites, gaps: gaps.entries, stats }
}

/** Boss nodes (1:1 with the registry) + overlay event/milestone markers + quoted, typed edges. */
export function buildProgression(input: { overlay: ProgressionOverlay; bosses: BossesOverlay; evidence: Evidence }): { nodes: ProgressionNode[]; edges: ProgressionEdge[] } {
  const { overlay, evidence } = input
  const nodes: ProgressionNode[] = []
  for (const b of input.bosses.entries) {
    const p = evidence.page(b.page, `overlay bosses/${b.id} node`)
    const prov = makeProv([Evidence.source('bosses', p)])
    prov.editorialFields = b.unlocksStage ? ['stage', 'unlocksStage'] : ['stage']
    nodes.push({ id: b.id, kind: 'boss', bossId: b.id, name: b.name, stage: b.stage, ...(b.unlocksStage ? { unlocksStage: b.unlocksStage } : {}), ...(b.worldEvil ? { worldEvil: b.worldEvil } : {}), wikiUrl: p.url, _prov: prov })
  }
  for (const n of overlay.nodes) {
    const p = evidence.page(n.page, `overlay progression/nodes/${n.id}`)
    const prov = makeProv([Evidence.source('progression', p)])
    prov.editorialFields = ['stage']
    nodes.push({ id: n.id, kind: n.kind, name: n.name, stage: n.stage, wikiUrl: p.url, _prov: prov })
  }
  const edges: ProgressionEdge[] = overlay.edges.map((e) => {
    const p = evidence.quote(e.page, e.quote, `overlay progression/edges/${e.from}->${e.to}(${e.type})`)
    return { from: e.from, to: e.to, type: e.type, note: e.quote, sourceUrl: p.url, _prov: makeProv([Evidence.source('progression', p)]) }
  })
  const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)
  return {
    nodes: nodes.sort(byId),
    edges: edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.type.localeCompare(b.type)),
  }
}

