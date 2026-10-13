/**
 * Buff registry (P2-S7, DATA_SCHEMA_SPEC §2.9, A4 bound) — the "Buff IDs" article table + buff /
 * debuff articles + overlays/buffs.json → Buff[].
 *
 * MEMBERSHIP (`members`): every buff an emitted weapon or ammo item inflicts or grants (Cargo Items
 * `debuffs` / ammo `buffs` columns, Iteminfo `buffType` of ammo) + the curated loadout potions of the
 * overlay. Each member is resolved by its exact name in the Buff IDs table (TO-VERIFY #12: the game's
 * buff ID list with each buff's article); a name the table does not have is not emitted (gap).
 *
 * FIELDS
 * - gameBuffId, isDebuff, name: the table row. Several IDs under one name (Zapped: 399 blue / 400 red)
 *   → gameBuffId Unknown (which applies is not stated). The ID is cross-checked against the article's
 *   own statement ("Buff ID" in a buff infobox, "Internal Buff ID" in an item infobox); a disagreement
 *   withholds it (Unknown + source-mismatch gap).
 * - wikiUrl: the table's article link, redirects resolved (Ironskin → Ironskin Potion); the Buff IDs
 *   page itself when the name is unlinked.
 * - dot.dps (damage per second to ENEMIES — what the Weapon Lab simulates): not applicable for a buff
 *   the table types "Buff" (§2.9: dot iff damaging debuff). For a debuff: the buff infobox "Effects"
 *   row of the article ("−24 health per second (on enemies)"; an unqualified "−4 health per second"
 *   applies to every entity). Effects without a health-loss line → no DoT (not applicable). No buff
 *   infobox for this ID on the article (stacking weapon debuffs documented on weapon pages: Blood
 *   Butchered, Penetrated, Celled…), an unparseable health line, or infoboxes that disagree → Unknown.
 * - effects: overlay entries only (each a verbatim quote of the article, number- and scope-checked);
 *   other buffs → [] + listed (Unknown): their target-side effects are not structured yet.
 */
import type { Buff, DamageClass, GapEntry, ProvSource, StatEffect } from '../../src/schemas'
import type { Article } from '../fetch/articles'
import type { CargoRow } from '../fetch/cargo'
import { wikiPageUrl } from '../fetch/config'
import { parseBuffInfoboxes, parseItemInfoboxes, type BuffIdRow } from '../parse/infobox'
import { slugify } from '../parse/text'
import { tally, type ReasonTally } from './drops'
import { Evidence } from './evidence'
import type { BuffEffectEntry, BuffsOverlay } from './overlays'
import { GapLog, isoDate, makeProv } from './prov'
import { OverlayError } from './registry'
import type { CrossCheckCount } from './weapons'

/** The wiki article holding the game's buff ID list (TO-VERIFY-IN-P2 #12). */
export const BUFF_IDS_PAGE = 'Buff IDs'

const str = (v: CargoRow[string] | undefined) => (v === null || v === undefined ? '' : String(v))

/** Buff names in a `^`-list Cargo Items column (`debuffs` / `buffs`) → the row names that list them. */
export function cargoBuffNames(rows: readonly CargoRow[], column: 'debuffs' | 'buffs'): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const r of rows) {
    for (const name of str(r[column]).split('^').map((s) => s.trim()).filter(Boolean)) out.set(name, [...(out.get(name) ?? []), str(r.name)])
  }
  return out
}

/** Articles the sync plan must fetch for these buff names (the Buff IDs table links). */
export function buffArticleTitles(table: readonly BuffIdRow[], names: Iterable<string>): string[] {
  const wanted = new Set(names)
  return [...new Set(table.filter((r) => wanted.has(r.name) && r.article).map((r) => r.article as string))].sort()
}

const HEALTH_LINE = /health per second/
const HEALTH = /^[−-]\s*(\d+(?:\.\d+)?) health per second(?: \(on (enemies|players)\))?$/

/** Enemy damage per second stated by an "Effects" row: number, `null` (no health loss stated) or `undefined` (unparseable). */
export function enemyDps(effects: readonly string[]): number | null | undefined {
  let enemy: number | undefined
  let general: number | undefined
  for (const line of effects) {
    if (!HEALTH_LINE.test(line)) continue
    const m = HEALTH.exec(line)
    if (!m) return undefined
    if (m[2] === 'enemies') enemy = Number(m[1])
    else if (m[2] === undefined) general = Number(m[1])
  }
  const dps = enemy ?? general
  return dps === undefined ? null : dps
}

const NUMBER = /\d+(?:\.\d+)?/g
const SCOPE_WORD: Record<DamageClass, RegExp> = { melee: /melee/i, ranged: /ranged/i, magic: /magic/i, summon: /summon/i, other: /$^/ }

/** Overlay effect → StatEffect, after checking the quote carries what the effect claims. */
export function effectFromEntry(e: BuffEffectEntry, sourceUrl: string, where: string): StatEffect {
  if ('special' in e) return { kind: 'special', text: e.special, simulated: false, sourceUrl }
  const numbers = (e.quote.match(NUMBER) ?? []).map(Number)
  if (!numbers.includes(Math.abs(e.value))) throw new OverlayError(`[E_SCHEMA] ${where}: quote "${e.quote}" does not state the value ${Math.abs(e.value)}`)
  if (e.value < 0 && !/[−-]|reduc|lower|decreas/i.test(e.quote)) throw new OverlayError(`[E_SCHEMA] ${where}: quote "${e.quote}" does not state a reduction for the negative value ${e.value}`)
  if (e.scope && !SCOPE_WORD[e.scope].test(e.quote)) throw new OverlayError(`[E_SCHEMA] ${where}: quote "${e.quote}" does not name the scope "${e.scope}"`)
  return { kind: 'stat', stat: e.stat, value: e.value, ...(e.scope ? { scope: e.scope } : {}) }
}

export interface BuffTable {
  rows: readonly BuffIdRow[]
  /** The Buff IDs article (canonical URL + revision). */
  url: string
  rev: number
  fetchedAt: string
}

export interface BuffBuildInput {
  table: BuffTable
  /** Buff name → why it is in the registry (shown in the gap report). */
  members: ReadonlyMap<string, readonly string[]>
  overlay: BuffsOverlay
  articles: ReadonlyMap<string, Article>
  evidence: Evidence
}

export interface BuffReportRow {
  name: string
  id: string
  gameBuffId: string
  type: 'buff' | 'debuff'
  dps: string
  effects: string
  why: string
}

export interface BuffBuild {
  buffs: Buff[]
  gaps: GapEntry[]
  /** Buff name → emitted slug (for Item.buffGrants). */
  slugByName: Map<string, string>
  report: BuffReportRow[]
  crossCheck: Map<string, CrossCheckCount>
  reasons: ReasonTally
}

export function buildBuffs(input: BuffBuildInput): BuffBuild {
  const { table, overlay, articles, evidence } = input
  const gaps = new GapLog()
  const reasons: ReasonTally = new Map()
  const crossCheck = new Map<string, CrossCheckCount>([['gameBuffId (Buff IDs table vs article)', { agree: 0, mismatch: 0, noWikiValue: 0 }]])
  const idCheck = crossCheck.get('gameBuffId (Buff IDs table vs article)') as CrossCheckCount
  const byName = new Map(overlay.entries.map((e) => [e.name, e]))
  for (const e of overlay.entries) if (!input.members.has(e.name)) throw new OverlayError(`[E_SCHEMA] overlay buffs/${e.name}: entry is not a member of the buff registry (pass it in members)`)
  const tableSource: ProvSource = { kind: 'wiki-article', url: table.url, rev: table.rev, fetchedAt: isoDate(table.fetchedAt) }
  const buffs: Buff[] = []
  const report: BuffReportRow[] = []
  const slugByName = new Map<string, string>()

  for (const [name, why] of [...input.members].sort(([a], [b]) => a.localeCompare(b))) {
    const id = slugify(name)
    const ref = `buff:${id}`
    const rows = table.rows.filter((r) => r.name === name)
    if (rows.length === 0) {
      gaps.add({ ref, kind: 'count-reconciliation', detail: `"${name}" (${why.join('; ')}) is not a buff name in the wiki's Buff IDs table — no buff record emitted`, sources: [table.url] })
      continue
    }
    const types = new Set(rows.map((r) => r.isDebuff))
    const articlesOf = new Set(rows.map((r) => r.article ?? ''))
    if (types.size !== 1 || articlesOf.size !== 1) {
      gaps.add({ ref, kind: 'source-mismatch', detail: `"${name}": the Buff IDs table lists it under IDs ${rows.map((r) => r.id).join(', ')} with different types or articles — no buff record emitted`, sources: [table.url] })
      continue
    }
    const title = rows[0].article
    const article = title ? articles.get(title) : undefined
    if (title && !article) throw new OverlayError(`[E_SCHEMA] buff "${name}": article "${title}" was not fetched by the sync plan (run npm run pipeline:fetch)`)
    const wikiUrl = article ? wikiPageUrl(article.resolvedTitle) : table.url
    const articleSource: ProvSource | undefined = article ? { kind: 'wiki-article', url: wikiUrl, rev: article.revid, fetchedAt: isoDate(article.fetchedAt) } : undefined
    const sources: ProvSource[] = [tableSource]
    const unverified: string[] = []
    let crossCheckFailed = false
    const ids = rows.map((r) => r.id)

    // game buff ID (single row) cross-checked against the article's own statement
    let gameBuffId: number | undefined
    if (ids.length > 1) {
      unverified.push('gameBuffId')
      tally(reasons, 'gameBuffId: several game buff IDs share this name (which one applies is not stated)', name)
    } else gameBuffId = ids[0]
    const buffBoxes = article ? parseBuffInfoboxes(article.html) : []
    const stated = new Set<number>([...buffBoxes.flatMap((b) => (b.buffId !== undefined ? [b.buffId] : [])), ...(article ? parseItemInfoboxes(article.html).flatMap((b) => b.buffIds) : [])])
    if (gameBuffId !== undefined) {
      if (stated.size === 0) idCheck.noWikiValue += 1
      else if (stated.has(gameBuffId)) {
        idCheck.agree += 1
        if (articleSource) sources.push(articleSource)
      } else {
        idCheck.mismatch += 1
        crossCheckFailed = true
        unverified.push('gameBuffId')
        gaps.add({ ref, field: 'gameBuffId', kind: 'source-mismatch', detail: `${name}: Buff IDs table ID ${gameBuffId}, its article states ${[...stated].join(', ')}; value withheld (Unknown)`, sources: [table.url, wikiUrl] })
        gameBuffId = undefined
      }
    }

    // DoT to enemies from the buff infobox(es) of these IDs
    const boxes = buffBoxes.filter((b) => b.buffId !== undefined && ids.includes(b.buffId))
    let dot: Buff['dot']
    let dpsText = 'Unknown'
    if (!rows[0].isDebuff) {
      // §2.9: dot is present iff the buff is a damaging DEBUFF; the Buff IDs table types this one "Buff"
      dpsText = 'n/a (buff)'
    } else if (boxes.length === 0 || boxes.some((b) => !b.data.has('Effects'))) {
      unverified.push('dot')
      tally(reasons, `dot: ${boxes.length === 0 ? 'the article has no buff infobox for this buff ID (e.g. a weapon page documenting a stacking debuff)' : 'the buff infobox has no Effects row'}`, name)
    } else {
      const values = boxes.map((b) => enemyDps(b.data.get('Effects') ?? []))
      if (values.some((v) => v === undefined) || new Set(values).size !== 1) {
        unverified.push('dot')
        tally(reasons, 'dot: the Effects row states health loss in an unparsed form, or infoboxes disagree', name)
      } else if (values[0] !== null && values[0] !== undefined) {
        dot = { dps: values[0] }
        dpsText = String(values[0])
      } else dpsText = 'none (no health loss stated)'
      if (articleSource) sources.push(articleSource)
    }

    // effects: overlay only
    const entry = byName.get(name)
    let effects: StatEffect[] = []
    if (entry) {
      if (!article) throw new OverlayError(`[E_SCHEMA] overlay buffs/${name}: the buff has no article to quote`)
      effects = entry.effects.map((e, i) => {
        const where = `overlay buffs/${name} effects.${i}`
        const page = evidence.quote(title as string, 'special' in e ? e.special : e.quote, where)
        return effectFromEntry(e, page.url, where)
      })
      sources.push(Evidence.source('buffs', evidence.page(title as string, `overlay buffs/${name}`)))
    } else {
      unverified.push('effects')
      tally(reasons, 'effects: target-side debuff effects are not structured yet (only the DoT is)', name)
    }

    const buff: Buff = {
      id,
      ...(gameBuffId !== undefined ? { gameBuffId } : {}),
      name,
      isDebuff: rows[0].isDebuff,
      effects,
      ...(dot ? { dot } : {}),
      wikiUrl,
      _prov: makeProv(sources, unverified, crossCheckFailed),
    }
    buffs.push(buff)
    slugByName.set(name, id)
    report.push({
      name,
      id,
      gameBuffId: gameBuffId !== undefined ? String(gameBuffId) : `Unknown (${ids.join(', ')})`,
      type: rows[0].isDebuff ? 'debuff' : 'buff',
      dps: dpsText,
      effects: entry ? `${effects.length} (${effects.filter((e) => e.kind === 'stat').length} stat)` : 'Unknown',
      why: why.join('; '),
    })
  }
  const slugs = new Set<string>()
  for (const b of buffs) {
    if (slugs.has(b.id)) throw new OverlayError(`[E_DUPLICATE_ID] buff slug "${b.id}" produced by two buff names`)
    slugs.add(b.id)
  }
  return { buffs, gaps: gaps.entries, slugByName, report, crossCheck, reasons }
}
