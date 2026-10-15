/**
 * Potion corpus (AMENDMENTS-014 B70 / B68 Q5; DATA_SCHEMA_SPEC §2.6 Item, category "potion"): the
 * loadout-relevant combat / utility / healing consumables — Cargo Items + Module:Iteminfo/data + each
 * potion's article infobox (+ recipes / drops / vendors / gating / image metadata) → Item[].
 *
 * IDENTIFICATION. A potion is a Cargo Items row whose infobox `type` list contains "potion" and not
 * "food" (Well Fed foods are the item corpus, P6-S0), that is the same desktop item in
 * Module:Iteminfo/data (same display name), and whose game data either grants a buff (`buffType`) or
 * restores health / mana (`healLife` / `healMana`). Utility consumables that do neither (Recall,
 * Teleportation, Wormhole, Return, Gender Change, Red Potion, the thrown Love / Stink potions, Glowing
 * Mushroom) are reconciled and excluded with a reason; an item already emitted in another collection
 * (Ale: ammo for the Ale Tosser) stays there (one ID, one collection — §3).
 * Reconciled against the wiki's "Buff potions" article table (43 rows on the 2026-10-14 sync) and its
 * Potions navbox groups (Health, Mana, Flasks, Tipsy).
 *
 * FIELDS (Iteminfo = numeric ground truth, cross-checked; a disagreement withholds the value: Unknown +
 * source-mismatch gap):
 * - healLife / healMana = Iteminfo healLife / healMana, cross-checked with the Cargo `hheal` / `mheal`
 *   cells and the infobox "Heals Health" / "Heals Mana" rows (a range such as Strange Brew's "70–120"
 *   disagrees with the single game value → Unknown).
 * - buffGrants (in order):
 *   · Iteminfo buffType → the Buff IDs table name, for buffTime ticks; the Cargo `buffs` / `debuffs`
 *     columns must list that name, and the infobox "Duration" of that Buff / Debuff section must equal
 *     buffTime (else the duration is withheld);
 *   · Potion Sickness when Iteminfo `potion` is true (the game flag that applies it) — the Cargo
 *     `debuffs` column must agree; its duration is the infobox "Duration" of the Potion Sickness
 *     section ("1 minute", "45 seconds", a range "40–70 seconds"), else Unknown;
 *   · Mana Sickness when Iteminfo healMana > 0 and the Cargo `debuffs` column lists it (both ways
 *     checked); duration from the infobox, else Unknown.
 * - rarity, valueCopper, consumable, maxStack: the ammo rules (merge/ammo.ts).
 * - tags: "buff-potion" + the Buff potions table's Type column (battle, movement, fishing, mining,
 *   miscellaneous) for rows of that table; "flask" for Weapon Imbue buffs; "healing-potion" /
 *   "mana-potion" from healLife / healMana; "unobtainable".
 * - acquisition + gatedBy/stage: merge/acquisition.ts with the B68/B78 acquisition sources.
 * - sprite: the infobox image's imageinfo (`/sprites/items/<id>.png`), as ammo.
 */
import type { GapEntry, Item, ProvSource, SpriteManifestFile } from '../../src/schemas'
import type { Article } from '../fetch/articles'
import { itemTypeIncludes, type CargoRow } from '../fetch/cargo'
import { wikiPageUrl } from '../fetch/config'
import type { ImageInfoFetch } from '../fetch/images'
import { findAll, hasClass, parseHtml, rawText, type HNode } from '../parse/html'
import { infoboxForItem, parseItemInfoboxes, type BuffIdRow, type ItemInfobox } from '../parse/infobox'
import type { Iteminfo, IteminfoItem } from '../parse/iteminfo'
import { slugify, stripMarkup } from '../parse/text'
import { itemRoutes, type RouteSources, type WithheldField } from './acquisition'
import { tally, type ReasonTally } from './drops'
import type { GatingResult } from './gating'
import { GapLog, isoDate, makeProv, moduleSource } from './prov'
import { OverlayError } from './registry'
import { cargoRarity, rarityOf, type CrossCheckCount } from './weapons'

const str = (v: CargoRow[string] | undefined) => (v === null || v === undefined ? '' : String(v))

/** The wiki article whose table lists every buff potion (reconciliation target, B70 acceptance). */
export const BUFF_POTIONS_PAGE = 'Buff potions'
export const POTION_SICKNESS = 'Potion Sickness'
export const MANA_SICKNESS = 'Mana Sickness'

/** Cargo rows typed "potion" and not "food", in row order. */
export const potionRows = (rows: readonly CargoRow[]): CargoRow[] =>
  rows.filter((r) => itemTypeIncludes(r, 'potion') && !itemTypeIncludes(r, 'food')).sort((a, b) => Number(str(a._rowid)) - Number(str(b._rowid)))

const stat = (item: IteminfoItem, key: string): number => {
  const v = (item.stats as Record<string, unknown>)[key]
  return typeof v === 'number' ? v : 0
}

export interface PotionCandidate {
  row: CargoRow
  item: IteminfoItem
  name: string
}

export interface PotionIdentification {
  typedRows: number
  included: PotionCandidate[]
  excluded: { row: CargoRow; kind: GapEntry['kind']; reason: string }[]
}

/** See the header; `elsewhere` = item IDs emitted by another collection (ammo, weapons). */
export function identifyPotions(rows: readonly CargoRow[], info: Iteminfo, elsewhere: ReadonlyMap<number, string> = new Map()): PotionIdentification {
  const typed = potionRows(rows)
  const included: PotionCandidate[] = []
  const excluded: PotionIdentification['excluded'] = []
  const seen = new Set<number>()
  for (const row of typed) {
    const cargoName = stripMarkup(str(row.name))
    const id = Number(str(row.itemid))
    if (str(row.itemid).trim() === '' || !Number.isInteger(id) || id <= 0) {
      excluded.push({ row, kind: 'count-reconciliation', reason: `"${cargoName}" (page ${str(row._page)}) has no item ID on the wiki — not a desktop game item` })
      continue
    }
    const item = info.items.get(id)
    if (!item) {
      excluded.push({ row, kind: 'sync-lag-1457', reason: `item ID ${id} ("${cargoName}") is not in Module:Iteminfo/data rev ${info.rev} (synced to ${info.terrariaVersion}) — no verifiable stats` })
      continue
    }
    const sameName = item.name !== undefined ? item.name === cargoName : item.internalName === stripMarkup(str(row.internalname))
    if (!sameName) {
      excluded.push({ row, kind: 'source-mismatch', reason: `Cargo row "${cargoName}" carries item ID ${id}, which Module:Iteminfo/data assigns to "${item.name ?? item.internalName}"` })
      continue
    }
    if (seen.has(id)) {
      excluded.push({ row, kind: 'count-reconciliation', reason: `duplicate Cargo row for item ${id} ("${cargoName}", page ${str(row._page)})` })
      continue
    }
    seen.add(id)
    const name = item.name ?? cargoName
    const other = elsewhere.get(id)
    if (other) {
      excluded.push({ row, kind: 'count-reconciliation', reason: `"${name}" is emitted as ${other} (one ID, one collection — DATA_SCHEMA_SPEC §3); its buff is on that record` })
      continue
    }
    if (stat(item, 'buffType') <= 0 && stat(item, 'healLife') <= 0 && stat(item, 'healMana') <= 0) {
      excluded.push({ row, kind: 'count-reconciliation', reason: `"${name}" grants no buff and restores no health or mana in Module:Iteminfo/data (a utility consumable: teleport / recall / gender change, or thrown at others) — outside the loadout potion corpus (item corpus, P6-S0)` })
      continue
    }
    included.push({ row, item, name })
  }
  return { typedRows: typed.length, included, excluded }
}

/** Buff names the potion candidates grant (Iteminfo buffType, + the sickness debuffs the Cargo rows list) → the potions. */
export function potionBuffNames(idn: PotionIdentification, table: readonly BuffIdRow[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const add = (name: string, by: string) => out.set(name, [...(out.get(name) ?? []), by])
  for (const c of idn.included) {
    const type = stat(c.item, 'buffType')
    const row = type > 0 ? table.find((r) => r.id === type) : undefined
    if (row) add(row.name, c.name)
    const debuffs = str(c.row.debuffs).split('^').map((x) => x.trim())
    if (debuffs.includes(POTION_SICKNESS)) add(POTION_SICKNESS, c.name)
    if (debuffs.includes(MANA_SICKNESS)) add(MANA_SICKNESS, c.name)
  }
  return out
}

/** Articles the sync plan fetches for the potion corpus: every candidate's page + its buffs' articles. */
export function potionArticleTitles(rows: readonly CargoRow[], info: Iteminfo, table: readonly BuffIdRow[]): string[] {
  const idn = identifyPotions(rows, info)
  const names = new Set(potionBuffNames(idn, table).keys())
  return [...new Set([BUFF_POTIONS_PAGE, ...idn.included.map((c) => str(c.row._page)).filter(Boolean), ...table.filter((r) => names.has(r.name) && r.article).map((r) => r.article as string)])].sort()
}

/** Infobox image files of the potion candidates (sprite manifest). */
export const potionImageFiles = (rows: readonly CargoRow[], info: Iteminfo): string[] => identifyPotions(rows, info).included.map((c) => str(c.row.imagefile))

/** "8 minutes" → 28800 · "45 seconds" → 2700 · "40–70 seconds" → {2400, 4200}; undefined when not that shape. */
export function durationTicksOf(text: string): number | { minTicks: number; maxTicks: number } | undefined {
  const unit: Record<string, number> = { second: 60, minute: 3600, hour: 216000 }
  const m = /^(\d+(?:\.\d+)?)(?:\s*[–-]\s*(\d+(?:\.\d+)?))?\s+(second|minute|hour)s?$/.exec(text.trim())
  if (!m) return undefined
  const f = unit[m[3]]
  const a = Math.round(Number(m[1]) * f)
  if (m[2] === undefined) return a
  const b = Math.round(Number(m[2]) * f)
  return b > a ? { minTicks: a, maxTicks: b } : undefined
}

/** The infobox's "Buff" / "Debuff" sections: buff name → the section's Duration text (first section wins). */
export function infoboxBuffDurations(box: ItemInfobox | undefined): Map<string, string | undefined> {
  const out = new Map<string, string | undefined>()
  let current: string | undefined
  for (const r of box?.rows ?? []) {
    if (r.label === 'Buff' || r.label === 'Debuff') {
      current = r.value
      if (!out.has(current)) out.set(current, undefined)
    } else if (r.label === 'Duration' && current !== undefined && out.get(current) === undefined) out.set(current, r.value)
  }
  return out
}

export interface BuffPotionRow {
  name: string
  duration: string
  type: string
}

/** The "Buff potions" article table: one row per potion (rowspanned recipe rows collapse). */
export function parseBuffPotionsTable(html: string): BuffPotionRow[] {
  const kids = (n: HNode | undefined): HNode[] => (n && n.type === 'el' ? n.children : [])
  const out: BuffPotionRow[] = []
  for (const tr of findAll(parseHtml(html), (n) => n.type === 'el' && n.tag === 'tr')) {
    const cells = kids(tr).filter((c) => c.type === 'el' && c.tag === 'td')
    const result = cells.find((c) => hasClass(c, 'result'))
    if (!result || result.type !== 'el' || !result.attrs['data-sort-value']) continue
    const cell = (cls: string) => stripMarkup(rawText(kids(cells.find((c) => hasClass(c, cls)))))
    out.push({ name: stripMarkup(result.attrs['data-sort-value']), duration: cell('col-C-2'), type: cell('col-C-4') })
  }
  return out
}

/** Potions navbox groups (the "ranger" navbox at the bottom of potion articles): group label → linked article titles. */
export function parsePotionNavbox(html: string): Map<string, string[]> {
  const kids = (n: HNode): HNode[] => (n.type === 'el' ? n.children : [])
  const out = new Map<string, string[]>()
  for (const row of findAll(parseHtml(html), (n) => hasClass(n, 'ranger-row'))) {
    const g = kids(row).find((c) => hasClass(c, 'ranger-group'))
    const lb = kids(row).find((c) => hasClass(c, 'ranger-listbox'))
    if (!g || !lb || findAll(kids(lb), (n) => hasClass(n, 'ranger-row')).length > 0) continue
    const label = stripMarkup(rawText(kids(g)))
    const links = [...new Set(findAll(kids(lb), (n) => n.type === 'el' && n.tag === 'a').map((a) => stripMarkup(a.type === 'el' ? (a.attrs.title ?? '') : '')).filter(Boolean))]
    if (!out.has(label)) out.set(label, links)
  }
  return out
}

/** Navbox groups the potion corpus is reconciled against besides the Buff potions table. */
export const POTION_NAVBOX_GROUPS = ['Health', 'Mana', 'Flasks', 'Tipsy'] as const

export interface PotionBuildInput {
  itemRows: readonly CargoRow[]
  itemsFetchedAt: string
  iteminfo: Iteminfo
  articles: ReadonlyMap<string, Article>
  images: ImageInfoFetch
  recipes: readonly { id: string; resultItemId: number }[]
  drops: readonly { id: string; itemId: number }[]
  gating: (itemId: number) => GatingResult
  /** Item IDs emitted by another collection → what they are ("an ammo item"). */
  elsewhere: ReadonlyMap<number, string>
  usedSlugs: ReadonlySet<string>
  stationIds: ReadonlySet<number>
  buffTable: readonly BuffIdRow[]
  buffSlug: (name: string) => string | undefined
  withheld?: ReadonlyMap<number, WithheldField>
  /** B68/B78 acquisition sources (vendor model + gatherables). */
  sources?: RouteSources
}

export interface PotionReconRow {
  name: string
  group: string
  outcome: string
  ref?: string
}

export interface PotionBuild {
  items: Item[]
  gaps: GapEntry[]
  identification: PotionIdentification
  sprites: SpriteManifestFile[]
  reasons: ReasonTally
  gatingBlockers: ReasonTally
  crossCheck: Map<string, CrossCheckCount>
  /** Buff potions table rows + navbox group members → outcome. */
  reconciliation: PotionReconRow[]
  buffPotionsUrl: string
  buffPotionsRows: number
}

export function buildPotions(input: PotionBuildInput): PotionBuild {
  const info = input.iteminfo
  const gaps = new GapLog()
  const reasons: ReasonTally = new Map()
  const gatingBlockers: ReasonTally = new Map()
  const crossCheck = new Map<string, CrossCheckCount>()
  const fetchedAt = isoDate(input.itemsFetchedAt)
  const iteminfoSrc = moduleSource('iteminfo', { title: 'Module:Iteminfo/data', rev: info.rev, fetchedAt: info.fetchedAt })
  const tableArticle = input.articles.get(BUFF_POTIONS_PAGE)
  if (!tableArticle) throw new OverlayError(`[E_SCHEMA] potions: the "${BUFF_POTIONS_PAGE}" article was not fetched by the sync plan (run npm run pipeline:fetch)`)
  const tableUrl = wikiPageUrl(tableArticle.resolvedTitle)
  const tableSource: ProvSource = { kind: 'wiki-article', url: tableUrl, rev: tableArticle.revid, fetchedAt: isoDate(tableArticle.fetchedAt) }
  const tableRows = parseBuffPotionsTable(tableArticle.html)
  if (tableRows.length === 0) throw new OverlayError(`[E_SCHEMA] potions: no potion rows parsed from the "${BUFF_POTIONS_PAGE}" table`)
  const tableByName = new Map(tableRows.map((r) => [r.name, r]))
  const navbox = parsePotionNavbox(tableArticle.html)

  const identification = identifyPotions(input.itemRows, info, input.elsewhere)
  for (const ex of identification.excluded) {
    const claimed = Number(str(ex.row.itemid))
    gaps.add({ ref: `i:${Number.isInteger(claimed) && claimed > 0 ? claimed : 0}`, field: 'id', kind: ex.kind, detail: `Cargo Items row ${str(ex.row._rowid)} not emitted as a potion: ${ex.reason}`, sources: [wikiPageUrl(str(ex.row._page))] })
  }
  const recipesBy = new Map<number, string[]>()
  for (const r of input.recipes) recipesBy.set(r.resultItemId, [...(recipesBy.get(r.resultItemId) ?? []), r.id])
  const dropsBy = new Map<number, string[]>()
  for (const d of input.drops) dropsBy.set(d.itemId, [...(dropsBy.get(d.itemId) ?? []), d.id])
  const count = (field: string, outcome: keyof CrossCheckCount) => {
    const c = crossCheck.get(field) ?? { agree: 0, mismatch: 0, noWikiValue: 0 }
    c[outcome] += 1
    crossCheck.set(field, c)
  }
  const sprites: SpriteManifestFile[] = []
  const items: Item[] = []

  for (const { row, item, name } of [...identification.included].sort((a, b) => a.item.id - b.item.id)) {
    const s = item.stats as Record<string, unknown>
    const id = item.id
    const ref = `i:${id}`
    const page = str(row._page)
    const wikiUrl = wikiPageUrl(page)
    const article = input.articles.get(page)
    if (!article) throw new OverlayError(`[E_SCHEMA] potion ${ref} (${name}): article "${page}" was not fetched by the sync plan (run npm run pipeline:fetch)`)
    const boxes = parseItemInfoboxes(article.html)
    const box = infoboxForItem(boxes, id) ?? (boxes.length === 1 && boxes[0].itemIds.length === 0 && boxes[0].title === name ? boxes[0] : undefined)
    const unverified: string[] = []
    let crossCheckFailed = false
    const sources: ProvSource[] = [{ kind: 'cargo:Items', url: wikiUrl, fetchedAt }, iteminfoSrc]
    if (box) sources.push({ kind: 'wiki-article', url: wikiPageUrl(article.resolvedTitle), rev: article.revid, fetchedAt: isoDate(article.fetchedAt) })
    const tableRow = tableByName.get(name)
    if (tableRow) sources.push(tableSource)
    const mismatch = (field: string, detail: string, srcs = [wikiUrl, iteminfoSrc.url]) => {
      unverified.push(field)
      crossCheckFailed = true
      gaps.add({ ref, field, kind: 'source-mismatch', detail: `${name}: ${detail}; value withheld (Unknown)`, sources: srcs })
    }
    const tallied = new Set<string>()
    const unknown = (field: string, why: string) => {
      unverified.push(field)
      const key = `${field.replace(/\.\d+\./g, '.N.')}: ${why}`
      if (!tallied.has(key)) tally(reasons, key, name)
      tallied.add(key)
    }
    const boxRow = (label: string) => box?.rows.find((r) => r.label === label)?.value

    // ---- healing / mana restored ----
    const heal = (field: 'healLife' | 'healMana', cargoCell: string, boxLabel: string): number | undefined => {
      const game = stat(item, field)
      const wiki = [str(row[cargoCell]).trim(), boxRow(boxLabel) ?? ''].filter((x) => x !== '')
      if (game <= 0) {
        if (wiki.length > 0) mismatch(field, `Module:Iteminfo/data restores nothing, the wiki states "${wiki[0]}"`)
        return undefined
      }
      if (wiki.length === 0) {
        count(field, 'noWikiValue')
        return game
      }
      const agree = wiki.every((w) => /^\d+$/.test(w) && Number(w) === game)
      count(field, agree ? 'agree' : 'mismatch')
      if (!agree) {
        mismatch(field, `Module:Iteminfo/data ${field} ${game}, the wiki states "${wiki.join('" / "')}"`)
        return undefined
      }
      return game
    }
    const healLife = heal('healLife', 'hheal', 'Heals Health')
    const healMana = heal('healMana', 'mheal', 'Heals Mana')

    // ---- buffs granted on use ----
    const cargoBuffs = new Set([...str(row.buffs).split('^'), ...str(row.debuffs).split('^')].map((x) => x.trim()).filter(Boolean))
    const durations = infoboxBuffDurations(box)
    const buffGrants: NonNullable<Item['buffGrants']> = []
    const grant = (buffName: string, ticks: number | undefined, why: string) => {
      const slug = input.buffSlug(buffName)
      if (!slug) {
        mismatch('buffGrants', `${why}: "${buffName}" has no emitted buff record`)
        return
      }
      const i = buffGrants.length
      const stated = durations.get(buffName)
      const parsed = stated !== undefined ? durationTicksOf(stated) : undefined
      if (ticks !== undefined) {
        // game duration, cross-checked with the infobox section of this buff
        if (stated === undefined) count('buffGrants.durationTicks (Iteminfo buffTime vs infobox Duration)', 'noWikiValue')
        else if (parsed === ticks) count('buffGrants.durationTicks (Iteminfo buffTime vs infobox Duration)', 'agree')
        else {
          count('buffGrants.durationTicks (Iteminfo buffTime vs infobox Duration)', 'mismatch')
          buffGrants.push({ buffId: slug })
          mismatch(`buffGrants.${i}.durationTicks`, `Module:Iteminfo/data buffTime ${ticks} ticks, the infobox states "${stated}"`, [wikiUrl, iteminfoSrc.url])
          return
        }
        buffGrants.push({ buffId: slug, durationTicks: ticks })
      } else if (parsed !== undefined) {
        // no game field holds this duration: the infobox's statement (wiki-article source)
        buffGrants.push({ buffId: slug, durationTicks: parsed })
      } else {
        buffGrants.push({ buffId: slug })
        unknown(`buffGrants.${i}.durationTicks`, `the wiki infobox states no ${buffName} duration for this item`)
      }
    }
    const buffType = stat(item, 'buffType')
    if (buffType > 0) {
      const tableName = input.buffTable.find((r) => r.id === buffType)?.name
      const time = stat(item, 'buffTime')
      if (!tableName || !cargoBuffs.has(tableName) || time <= 0) {
        mismatch('buffGrants', `Module:Iteminfo/data buffType ${buffType} (${tableName ?? 'not in the Buff IDs table'}) for ${time} ticks is not confirmed by the wiki infobox buffs (${[...cargoBuffs].join(', ') || 'none'})`)
      } else grant(tableName, time, `Module:Iteminfo/data buffType ${buffType}`)
    }
    const potionFlag = s.potion === true
    if (potionFlag !== cargoBuffs.has(POTION_SICKNESS)) mismatch('buffGrants', `Module:Iteminfo/data potion flag ${potionFlag} (the game's Potion Sickness trigger) disagrees with the wiki infobox debuffs (${[...cargoBuffs].join(', ') || 'none'})`)
    else if (potionFlag) grant(POTION_SICKNESS, undefined, 'Module:Iteminfo/data potion flag')
    if (stat(item, 'healMana') > 0 !== cargoBuffs.has(MANA_SICKNESS)) mismatch('buffGrants', `Module:Iteminfo/data healMana ${stat(item, 'healMana')} disagrees with the wiki infobox debuffs on Mana Sickness (${[...cargoBuffs].join(', ') || 'none'})`)
    else if (cargoBuffs.has(MANA_SICKNESS)) grant(MANA_SICKNESS, undefined, 'mana-restoring item')
    const listedGrants = unverified.includes('buffGrants')

    // ---- core fields (ammo rules) ----
    const rarity = rarityOf(s.rare)
    const cargoRare = cargoRarity(str(row.rare))
    if (rarity === undefined) unknown('rarity', `rare ${String(s.rare)} has no Rarity encoding`)
    else if (cargoRare !== undefined) {
      count('rarity', cargoRare === s.rare ? 'agree' : 'mismatch')
      if (cargoRare !== s.rare) mismatch('rarity', `Module:Iteminfo/data rare ${String(s.rare)}, wiki infobox ${cargoRare}`)
    } else count('rarity', 'noWikiValue')
    const consumable = s.consumable === true
    const cargoConsumable = str(row.consumable).trim() === '1'
    count('consumable', cargoConsumable === consumable ? 'agree' : 'mismatch')
    if (cargoConsumable !== consumable) mismatch('consumable', `Module:Iteminfo/data consumable ${consumable}, wiki infobox ${cargoConsumable}`)
    const value = typeof s.value === 'number' && s.value >= 0 ? s.value : undefined
    const imbue = buffGrants.some((g) => g.buffId.startsWith('weapon-imbue'))
    const tags = [
      ...new Set([
        ...(tableRow ? ['buff-potion', slugify(tableRow.type)] : []),
        ...(imbue ? ['flask'] : []),
        ...(stat(item, 'healLife') > 0 ? ['healing-potion'] : []),
        ...(stat(item, 'healMana') > 0 ? ['mana-potion'] : []),
        ...(str(row.unobtainable) === '1' ? ['unobtainable'] : []),
      ]),
    ]
      .filter(Boolean)
      .sort()

    // ---- sprite ----
    const image = input.images.found.get(str(row.imagefile).trim())
    let sprite: string | undefined
    if (image) {
      sprite = `/sprites/items/${id}.${/\.gif$/i.test(image.file) ? 'gif' : 'png'}`
      sprites.push({ path: sprite, ref, wikiFileUrl: image.descriptionUrl, sha1: image.sha1, bytes: image.bytes, width: image.width, height: image.height, rights: 're-logic' })
    } else gaps.add({ ref, field: 'sprite', kind: 'missing-sprite', detail: `${name}: no wiki image file resolved for "${str(row.imagefile)}"; the placeholder sprite is shown`, sources: [wikiUrl] })

    // ---- acquisition + §7b gating ----
    const { acquisition, gating } = itemRoutes({ id, name, noun: 'potion', row, wikiUrl, recipesBy, dropsBy, withheld: input.withheld?.get(id), gating: input.gating, unknown, mismatch, gaps, reasons, ...(input.sources ? { sources: input.sources } : {}) })
    let gatedBy: Item['gatedBy']
    if (gating.ok) gatedBy = gating.gatedBy
    else {
      unverified.push('gatedBy', 'stage')
      tally(gatingBlockers, gating.blockers.join(' + '), name)
    }

    items.push({
      id,
      name,
      slug: slugify(name),
      type: 'item',
      ...(rarity !== undefined && !unverified.includes('rarity') ? { rarity } : {}),
      ...(gatedBy ? { stage: gatedBy.stage } : {}),
      tags,
      wikiUrl,
      ...(sprite ? { sprite } : {}),
      ...(value !== undefined ? { valueCopper: value } : {}),
      ...(consumable && stat(item, 'maxStack') > 0 ? { maxStack: stat(item, 'maxStack') } : {}),
      ...(gatedBy ? { gatedBy } : {}),
      acquisition,
      category: 'potion',
      ...(!unverified.includes('consumable') ? { consumable } : {}),
      isStation: input.stationIds.has(id),
      ...(healLife !== undefined ? { healLife } : {}),
      ...(healMana !== undefined ? { healMana } : {}),
      ...(buffGrants.length > 0 && !listedGrants ? { buffGrants } : {}),
      _prov: makeProv(sources, unverified, crossCheckFailed),
    })
  }

  // slugs unique across the item ID space (weapons rule)
  const slugs = new Set(input.usedSlugs)
  for (const i of items) {
    if (slugs.has(i.slug)) i.slug = `${i.slug}-${i.id}`
    slugs.add(i.slug)
  }

  // ---- reconciliation: the Buff potions table + the potions navbox groups ----
  const byName = new Map(items.map((i) => [i.name, i]))
  const excludedBy = new Map(identification.excluded.map((e) => [stripMarkup(str(e.row.name)), e.reason]))
  const outcome = (name: string): { outcome: string; ref?: string } => {
    const it = byName.get(name)
    if (it) return { outcome: 'emitted', ref: `i:${it.id}` }
    const why = excludedBy.get(name)
    return { outcome: why ? `excluded — ${why}` : 'no Cargo Items potion row with this name' }
  }
  const reconciliation: PotionReconRow[] = tableRows.map((r) => ({ name: r.name, group: `Buff potions table (${r.type})`, ...outcome(r.name) }))
  for (const group of POTION_NAVBOX_GROUPS) {
    for (const title of navbox.get(group) ?? []) {
      if (tableByName.has(title)) continue
      reconciliation.push({ name: title, group: `Potions navbox: ${group}`, ...outcome(title) })
    }
  }
  return {
    items,
    gaps: gaps.entries,
    identification,
    sprites,
    reasons,
    gatingBlockers,
    crossCheck: new Map([...crossCheck].sort(([a], [b]) => a.localeCompare(b))),
    reconciliation,
    buffPotionsUrl: tableUrl,
    buffPotionsRows: tableRows.length,
  }
}
