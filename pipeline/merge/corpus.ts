/**
 * Item corpus (P6-S0, AMENDMENTS-001 A2 "Full item corpus dataset"; DATA_SCHEMA_SPEC §2.6 Item):
 * every vanilla desktop item the other item builders (weapons, ammo, potions, armor, accessories) do
 * not emit — materials, tools, hooks, mounts, pets, vanity, dyes, furniture, blocks, fishing items
 * (AMENDMENTS-004 B20), boss / event summons, grab bags, permanent boosters, utility consumables — as
 * `Item` records (type "item").
 *
 * IDENTIFICATION (the potion / ammo rules): a Cargo Items row whose positive `itemid` is the same item in
 * Module:Iteminfo/data (same display name, or internal name for unnamed IDs), first row per ID, and
 * whose ID no other collection emits (one ID, one collection — §3). Excluded with a gap entry: set
 * infobox rows (armor / vanity set articles: no item ID), other rows without an item ID, IDs missing
 * from Iteminfo (sync lag), name mismatches, duplicate rows.
 *
 * CATEGORY (`ItemCategory`): the wiki infobox `type` list (Cargo Items `type`), first matching rule of
 * CATEGORY_RULES in order — e.g. "furniture^crafting station" → station, "food^potion" → food,
 * "grab bag^furniture^crate" (fished) → fishing. The wiki's "crafting material" type only says that a
 * recipe uses the item, so it decides nothing but "material" when it is the item's only type. The full
 * type list is kept in `tags` (slugged), plus "quest-fish" (Cargo tag) and "unobtainable" (Cargo flag).
 *
 * FIELDS (Iteminfo = numeric ground truth, cross-checked; a disagreement withholds the value: Unknown +
 * source-mismatch gap):
 * - rarity, valueCopper, consumable: the potion rules (rarity cross-checked with Cargo `rare`,
 *   consumable with Cargo `consumable`).
 * - maxStack: Iteminfo maxStack for CONSUMABLE items only — the module and the Cargo `stack` cell both
 *   report 9999 for non-stacking items (tools, vanity; AMENDMENTS-002 B7), so a non-consumable's
 *   value is never emitted.
 * - toolStats: pickaxe / hammer power = Iteminfo pick / hammer, axe power = Iteminfo axe × 5 (the
 *   displayed percentage), fishing power = Iteminfo fishingPole — each cross-checked with the Cargo
 *   pick / hammer / axe / fishing cells. baitPowerPct = Iteminfo bait, cross-checked with Cargo `bait`.
 * - buffGrants: Iteminfo buffType (→ the Buff IDs table name, which the Cargo buffs/debuffs columns must
 *   list) for buffTime ticks, when the buff is in the registry (food: Well Fed and its tiers); a buff
 *   outside the v1 registry (pets, light pets — AMENDMENTS-001 A4 bound) is Unknown.
 * - hookStats (hooks) / mountStats (mounts): not extracted in this slice → Unknown (listed), never
 *   claimed not applicable.
 * - summonsBossNode: DERIVED — the boss whose summon items (Boss.summon.items) include the item.
 * - acquisition + gatedBy/stage: merge/acquisition.ts with the B68/B78 sources and the B20 fishing
 *   routes; isStation derived from the recipes; sprite from the infobox image's imageinfo.
 */
import type { GapEntry, Item, ItemCategory, ProvSource, SpriteManifestFile } from '../../src/schemas'
import type { CargoRow } from '../fetch/cargo'
import { wikiPageUrl } from '../fetch/config'
import type { ImageInfo } from '../fetch/images'
import type { BuffIdRow } from '../parse/infobox'
import type { Iteminfo, IteminfoItem } from '../parse/iteminfo'
import { slugify, stripMarkup } from '../parse/text'
import { itemRoutes, type RouteSources, type WithheldField } from './acquisition'
import { tally, type ReasonTally } from './drops'
import type { GatingResult } from './gating'
import { GapLog, isoDate, makeProv, moduleSource } from './prov'
import { cargoRarity, rarityOf, type CrossCheckCount } from './weapons'

const str = (v: CargoRow[string] | undefined) => (v === null || v === undefined ? '' : String(v))

/** The Cargo Items `type` list, lower-cased (the wiki writes "light Source" and "light source"). */
export const cargoTypes = (row: CargoRow): string[] => [...new Set(str(row.type).split('^').map((t) => t.trim().toLowerCase()).filter(Boolean))]
const listOf = (row: CargoRow, column: 'tag' | 'listcat'): string[] => str(row[column]).split('^').map((t) => t.trim().toLowerCase()).filter(Boolean)

/** Fished per the wiki's own tags (Cargo tag "fished" / "quest fish", listcat "fished items"). */
export const taggedFished = (row: CargoRow): boolean => {
  const tags = listOf(row, 'tag')
  return tags.includes('fished') || tags.includes('quest fish') || listOf(row, 'listcat').includes('fished items')
}

export interface CategoryRule {
  category: ItemCategory
  /** Matches when the row has ANY of these infobox types. */
  types?: readonly string[]
  /** …or ANY of these Cargo tags. */
  tags?: readonly string[]
  /** …or is fished (taggedFished, or a catch row in the "Fishing catches" article). */
  fished?: boolean
  why: string
}

/** Category rules, first match wins (see the header). Documented in the gap report. */
export const CATEGORY_RULES: readonly CategoryRule[] = [
  { category: 'station', types: ['crafting station'], why: 'a crafting station' },
  { category: 'summoning', types: ['boss summon', 'event summon'], why: 'summons a boss or starts an event' },
  { category: 'mount', types: ['mount summon'], why: 'summons a mount (incl. minecarts)' },
  { category: 'pet', types: ['pet summon', 'light pet'], why: 'summons a pet or light pet' },
  { category: 'hook', tags: ['hooks'], why: 'a grappling hook (the wiki tags tool-typed hooks "Hooks")' },
  { category: 'tool', types: ['tool'], why: 'a tool (pickaxes, axes, hammers, fishing poles, buckets, wrenches, …)' },
  { category: 'dye', types: ['dye', 'hair dye'], why: 'a dye or hair dye' },
  { category: 'vanity', types: ['vanity'], why: 'a vanity item (cosmetic armor pieces, vanity accessories, music boxes)' },
  { category: 'food', types: ['food'], why: 'food (Well Fed and its tiers)' },
  { category: 'permanent-booster', types: ['permanent booster'], why: 'a permanent booster' },
  { category: 'exploration-utility', types: ['potion', 'item summon', 'key'], why: 'a utility consumable (teleport / recall potions — every buff or healing potion is in the B70 potion corpus), an item that summons a utility (Money Trough …) or a key' },
  { category: 'fishing', types: ['crate', 'bait'], fished: true, why: 'fished (fish, quest fish, crates) or bait' },
  { category: 'grab-bag', types: ['grab bag'], why: 'a grab bag (treasure bags, presents, goodie bags, …)' },
  { category: 'furniture', types: ['furniture', 'light source', 'storage', 'mechanism', 'background object'], why: 'placeable furniture, a light source, storage, a mechanism or a background object' },
  { category: 'block', types: ['block', 'brick', 'wall'], why: 'a placeable block, brick or wall' },
  { category: 'material', types: ['ore', 'bar', 'gem', 'crafting material'], why: 'a crafting material (ores, bars, gems, drops used in recipes)' },
  { category: 'other', why: 'none of the above (seeds, paints, coatings, rope coils, miscellaneous, or no infobox type)' },
]

export function corpusCategory(types: readonly string[], tags: readonly string[], fished: boolean): CategoryRule {
  for (const rule of CATEGORY_RULES) {
    if (rule.types?.some((t) => types.includes(t)) || rule.tags?.some((t) => tags.includes(t)) || (rule.fished && fished)) return rule
    if (!rule.types && !rule.tags && !rule.fished) return rule
  }
  return CATEGORY_RULES[CATEGORY_RULES.length - 1]
}

export interface CorpusCandidate {
  row: CargoRow
  item: IteminfoItem
  name: string
}

export interface CorpusIdentification {
  /** Cargo Items rows considered (all rows). */
  rows: number
  /** Rows whose item another collection emits (one ID, one collection). */
  elsewhere: number
  included: CorpusCandidate[]
  excluded: { row: CargoRow; kind: GapEntry['kind']; reason: string }[]
}

/** See the header; `elsewhere` = item IDs emitted by another collection. */
export function identifyCorpus(rows: readonly CargoRow[], info: Iteminfo, elsewhere: ReadonlySet<number>): CorpusIdentification {
  const included: CorpusCandidate[] = []
  const excluded: CorpusIdentification['excluded'] = []
  const seen = new Set<number>()
  let elsewhereRows = 0
  for (const row of [...rows].sort((a, b) => Number(str(a._rowid)) - Number(str(b._rowid)))) {
    const cargoName = stripMarkup(str(row.name))
    const id = Number(str(row.itemid))
    if (str(row.itemid).trim() === '' || !Number.isInteger(id) || id <= 0) {
      excluded.push({
        row,
        kind: 'count-reconciliation',
        reason: cargoTypes(row).includes('set') ? `"${cargoName}" (page ${str(row._page)}) is the set infobox of an armor / vanity set article, not an item` : `"${cargoName}" (page ${str(row._page)}) has no item ID on the wiki — not a desktop game item`,
      })
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
    if (elsewhere.has(id)) {
      elsewhereRows += 1
      seen.add(id)
      continue
    }
    if (seen.has(id)) {
      excluded.push({ row, kind: 'count-reconciliation', reason: `duplicate Cargo row for item ${id} ("${cargoName}", page ${str(row._page)})` })
      continue
    }
    seen.add(id)
    included.push({ row, item, name: item.name ?? cargoName })
  }
  return { rows: rows.length, elsewhere: elsewhereRows, included, excluded }
}

/** Infobox image files of every corpus candidate (sprite manifest; the sync plan's superset — no `elsewhere`). */
export const corpusImageFiles = (rows: readonly CargoRow[], info: Iteminfo): string[] => identifyCorpus(rows, info, new Set()).included.map((c) => str(c.row.imagefile))

/** Buff names the corpus FOOD grants (Iteminfo buffType → the Buff IDs table): the buff registry members it adds. */
export function corpusFoodBuffNames(rows: readonly CargoRow[], info: Iteminfo, table: readonly BuffIdRow[], elsewhere: ReadonlySet<number> = new Set()): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const c of identifyCorpus(rows, info, elsewhere).included) {
    if (corpusCategory(cargoTypes(c.row), listOf(c.row, 'tag'), false).category !== 'food') continue
    const type = (c.item.stats as Record<string, unknown>).buffType
    const name = typeof type === 'number' && type > 0 ? table.find((r) => r.id === type)?.name : undefined
    if (name) out.set(name, [...(out.get(name) ?? []), c.name])
  }
  return out
}

export interface CorpusBuildInput {
  itemRows: readonly CargoRow[]
  itemsFetchedAt: string
  iteminfo: Iteminfo
  /** Image metadata by Cargo `imagefile` (every image fetch of the sync plan). */
  images: ReadonlyMap<string, ImageInfo>
  recipes: readonly { id: string; resultItemId: number }[]
  drops: readonly { id: string; itemId: number }[]
  gating: (itemId: number) => GatingResult
  /** Item IDs emitted by another collection. */
  elsewhere: ReadonlySet<number>
  usedSlugs: ReadonlySet<string>
  stationIds: ReadonlySet<number>
  buffTable: readonly BuffIdRow[]
  buffSlug: (name: string) => string | undefined
  /** Item → the boss nodes whose summon items include it (Boss.summon.items, Boss.nodeId). */
  summons: ReadonlyMap<number, readonly string[]>
  /** Item IDs the "Fishing catches" article lists (category rule `fished`). */
  fishedIds: ReadonlySet<number>
  withheld?: ReadonlyMap<number, WithheldField>
  sources?: RouteSources
}

export interface CorpusBuild {
  items: Item[]
  gaps: GapEntry[]
  identification: CorpusIdentification
  sprites: SpriteManifestFile[]
  reasons: ReasonTally
  gatingBlockers: ReasonTally
  crossCheck: Map<string, CrossCheckCount>
  /** Category → rule that assigned it (report). */
  categoryRules: Map<ItemCategory, CategoryRule>
}

const stat = (item: IteminfoItem, key: string): number => {
  const v = (item.stats as Record<string, unknown>)[key]
  return typeof v === 'number' ? v : 0
}
/** A Cargo percentage / number cell ("35%", "50") → number; '' → undefined. */
const cargoNumber = (cell: string): number | undefined => {
  const m = /^\s*(\d+)\s*%?\s*$/.exec(cell)
  return m ? Number(m[1]) : undefined
}

export function buildCorpus(input: CorpusBuildInput): CorpusBuild {
  const info = input.iteminfo
  const gaps = new GapLog()
  const reasons: ReasonTally = new Map()
  const gatingBlockers: ReasonTally = new Map()
  const crossCheck = new Map<string, CrossCheckCount>()
  const fetchedAt = isoDate(input.itemsFetchedAt)
  const iteminfoSrc = moduleSource('iteminfo', { title: 'Module:Iteminfo/data', rev: info.rev, fetchedAt: info.fetchedAt })
  const identification = identifyCorpus(input.itemRows, info, input.elsewhere)
  for (const ex of identification.excluded) {
    const claimed = Number(str(ex.row.itemid))
    gaps.add({ ref: `i:${Number.isInteger(claimed) && claimed > 0 ? claimed : 0}`, field: 'id', kind: ex.kind, detail: `Cargo Items row ${str(ex.row._rowid)} not emitted as an item: ${ex.reason}`, sources: [wikiPageUrl(str(ex.row._page))] })
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
  const categoryRules = new Map<ItemCategory, CategoryRule>()

  for (const { row, item, name } of [...identification.included].sort((a, b) => a.item.id - b.item.id)) {
    const s = item.stats as Record<string, unknown>
    const id = item.id
    const ref = `i:${id}`
    const wikiUrl = wikiPageUrl(str(row._page))
    const unverified: string[] = []
    let crossCheckFailed = false
    const sources: ProvSource[] = [{ kind: 'cargo:Items', url: wikiUrl, fetchedAt }, iteminfoSrc]
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

    // ---- category + tags ----
    const types = cargoTypes(row)
    const tagList = listOf(row, 'tag')
    const rule = corpusCategory(types, tagList, taggedFished(row) || input.fishedIds.has(id))
    categoryRules.set(rule.category, rule)
    const unobtainable = str(row.unobtainable) === '1'
    const tags = [...new Set([...types.map(slugify), ...(tagList.includes('quest fish') ? ['quest-fish'] : []), ...(unobtainable ? ['unobtainable'] : [])])].filter(Boolean).sort()

    // ---- core fields (potion rules) ----
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

    // ---- tool / fishing powers (Iteminfo, cross-checked with the Cargo cells) ----
    const power = (field: string, game: number, cell: string): number | undefined => {
      const wiki = cargoNumber(cell)
      if (game <= 0) {
        if (wiki !== undefined) mismatch(field, `Module:Iteminfo/data has none, the wiki infobox states ${cell.trim()}`)
        return undefined
      }
      if (wiki === undefined) {
        count(field, 'noWikiValue')
        return game
      }
      count(field, wiki === game ? 'agree' : 'mismatch')
      if (wiki !== game) {
        mismatch(field, `Module:Iteminfo/data ${game}, the wiki infobox ${cell.trim()}`)
        return undefined
      }
      return game
    }
    const pickaxePowerPct = power('toolStats.pickaxePowerPct', stat(item, 'pick'), str(row.pick))
    const axePowerPct = power('toolStats.axePowerPct', stat(item, 'axe') * 5, str(row.axe))
    const hammerPowerPct = power('toolStats.hammerPowerPct', stat(item, 'hammer'), str(row.hammer))
    const fishingPowerPct = power('toolStats.fishingPowerPct', stat(item, 'fishingPole'), str(row.fishing))
    const baitPowerPct = power('baitPowerPct', stat(item, 'bait'), str(row.bait))
    const toolStats = {
      ...(pickaxePowerPct !== undefined ? { pickaxePowerPct } : {}),
      ...(axePowerPct !== undefined ? { axePowerPct } : {}),
      ...(hammerPowerPct !== undefined ? { hammerPowerPct } : {}),
      ...(fishingPowerPct !== undefined ? { fishingPowerPct } : {}),
    }

    // ---- buffs granted on use ----
    let buffGrants: Item['buffGrants']
    const buffType = stat(item, 'buffType')
    if (buffType > 0) {
      const cargoBuffs = new Set([...str(row.buffs).split('^'), ...str(row.debuffs).split('^')].map((x) => x.trim()).filter(Boolean))
      const tableName = input.buffTable.find((r) => r.id === buffType)?.name
      const time = stat(item, 'buffTime')
      if (!tableName || !cargoBuffs.has(tableName)) mismatch('buffGrants', `Module:Iteminfo/data buffType ${buffType} (${tableName ?? 'not in the Buff IDs table'}) is not confirmed by the wiki infobox buffs (${[...cargoBuffs].join(', ') || 'none'})`)
      else {
        const slug = input.buffSlug(tableName)
        if (!slug) unknown('buffGrants', `the buff it grants is outside the v1 buff registry (AMENDMENTS-001 A4 bound)`)
        else if (time > 0) buffGrants = [{ buffId: slug, durationTicks: time }]
        else {
          buffGrants = [{ buffId: slug }]
          unknown('buffGrants.0.durationTicks', 'Module:Iteminfo/data states no buffTime for this item')
        }
      }
    }

    // ---- stats this slice does not extract (never claimed not applicable) ----
    if (rule.category === 'hook') unknown('hookStats', 'hook reach / hook count / latching stats are not extracted (the Hooks article table is not part of the P6-S0 sync)')
    if (rule.category === 'mount') unknown('mountStats', 'the mount description is not extracted (mount articles state it in prose)')

    // ---- boss summoned (derived from Boss.summon.items) ----
    const summoned = input.summons.get(id) ?? []
    if (summoned.length > 1) unknown('summonsBossNode', `summons several bosses (${summoned.join(', ')}); one field cannot hold them`)

    // ---- sprite ----
    const image = input.images.get(str(row.imagefile).trim())
    let sprite: string | undefined
    if (image) {
      sprite = `/sprites/items/${id}.${/\.gif$/i.test(image.file) ? 'gif' : 'png'}`
      sprites.push({ path: sprite, ref, wikiFileUrl: image.descriptionUrl, sha1: image.sha1, bytes: image.bytes, width: image.width, height: image.height, rights: 're-logic' })
    } else gaps.add({ ref, field: 'sprite', kind: 'missing-sprite', detail: `${name}: no wiki image file resolved for "${str(row.imagefile)}"; the placeholder sprite is shown`, sources: [wikiUrl] })

    // ---- acquisition + §7b gating ----
    const routes = itemRoutes({ id, name, noun: 'item', row, wikiUrl, recipesBy, dropsBy, withheld: input.withheld?.get(id), gating: input.gating, unknown, mismatch, gaps, reasons, ...(input.sources ? { sources: input.sources } : {}) })
    sources.push(...routes.sources)
    let gatedBy: Item['gatedBy']
    if (routes.gating.ok) gatedBy = routes.gating.gatedBy
    else {
      unverified.push('gatedBy', 'stage')
      tally(gatingBlockers, routes.gating.blockers.join(' + '), name)
    }
    const listedGrants = unverified.includes('buffGrants')

    items.push({
      id,
      name,
      slug: slugify(name) || `item-${id}`,
      type: 'item',
      ...(rarity !== undefined && !unverified.includes('rarity') ? { rarity } : {}),
      ...(gatedBy ? { stage: gatedBy.stage } : {}),
      tags,
      wikiUrl,
      ...(sprite ? { sprite } : {}),
      ...(value !== undefined ? { valueCopper: value } : {}),
      ...(consumable && !unverified.includes('consumable') && stat(item, 'maxStack') > 0 ? { maxStack: stat(item, 'maxStack') } : {}),
      ...(gatedBy ? { gatedBy } : {}),
      acquisition: routes.acquisition,
      category: rule.category,
      ...(!unverified.includes('consumable') ? { consumable } : {}),
      isStation: input.stationIds.has(id),
      ...(Object.keys(toolStats).length > 0 ? { toolStats } : {}),
      ...(baitPowerPct !== undefined ? { baitPowerPct } : {}),
      ...(buffGrants && !listedGrants ? { buffGrants } : {}),
      ...(summoned.length === 1 ? { summonsBossNode: summoned[0] } : {}),
      _prov: makeProv(sources, unverified, crossCheckFailed),
    })
  }

  // slugs unique across the item ID space (weapons rule)
  const slugs = new Set(input.usedSlugs)
  for (const i of items) {
    if (slugs.has(i.slug)) i.slug = `${i.slug}-${i.id}`
    slugs.add(i.slug)
  }
  return {
    items,
    gaps: gaps.entries,
    identification,
    sprites,
    reasons,
    gatingBlockers,
    crossCheck: new Map([...crossCheck].sort(([a], [b]) => a.localeCompare(b))),
    categoryRules,
  }
}
