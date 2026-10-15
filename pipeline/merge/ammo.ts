/**
 * Cargo Items + Module:Iteminfo/data + Module:Projectileinfo/data + the ammo articles' item infoboxes
 * (+ recipes / drops / gating / image metadata) → ammo Item[] (P2-S7, DATA_SCHEMA_SPEC §2.6 ammoStats,
 * AMENDMENTS-002 B2). Every rule was verified against the 2026-10-13 sync; the gap report restates it.
 *
 * IDENTIFICATION. An ammo item is a Cargo Items row whose infobox `type` list contains "ammunition"
 * (the wiki's classification) AND whose `itemid` is the same desktop item in Module:Iteminfo/data
 * (same display name) AND whose Iteminfo `ammo` (the game's AmmoID) is non-zero. Rows failing a test
 * are excluded with a gap entry, never guessed. Items that are also weapons (Snowball: thrown weapon
 * and Snowball Cannon ammo) stay in the weapons collection (one ID, one collection — §3) and receive
 * their ammoStats there (`weaponAmmo`).
 *
 * FIELDS (Iteminfo = numeric ground truth, cross-checked against the Cargo infobox; a disagreement
 * withholds the value: Unknown + source-mismatch gap):
 * - ammoStats.ammoClass = slug of the AmmoID's representative item (same rule as Weapon.ammoClass).
 * - Items whose Iteminfo `damage` > 0: damage (`damage`), knockback (`knockBack`) and velocityBonusTps
 *   (`shootSpeed` px/tick × 3.75 — what the game adds to the firing weapon's shoot speed; Cargo
 *   `velocity` is the same base value). Items with no damage of their own (Gel, Fallen Star, sand,
 *   Ale, solutions, Acorn): the game data carries no ammo stats, so all three are Unknown.
 * - ammoStats.velocityMultiplier (B2) = the item's OWN infobox row "Velocity Multiplier N×" (the
 *   infobox whose "Internal Item ID" lists the item), cross-checked against Module:Projectileinfo/data
 *   (1 + extraUpdates of the projectile the item fires, when the infobox names that projectile).
 *   No row on its own infobox + Projectileinfo agrees (no extra updates) → not applicable. Iteminfo
 *   `shoot` 0 (the firing weapon decides the projectile: rockets, gel…) → not applicable. No own
 *   infobox (Coins, Rockets I–IV, Solutions, Flares share list articles) → Unknown: the wiki states no
 *   per-item multiplier, and `shoot` is not always a projectile there (rockets and solutions store a
 *   type index in it).
 * - ammoStats.projectile: not emitted — ProjectileSpec needs an absolute velocity, which for ammo
 *   depends on the firing weapon (weapon shootSpeed + velocityBonusTps); the Lab composes it.
 * - rarity, valueCopper, consumable, maxStack (consumables only, B7), tags = the item article's
 *   subcategories of Category:Ammunition items (arrows, bullets, darts, …) + "unobtainable".
 * - buffGrants: Iteminfo `buffType` (game buff ID → Buff IDs table name) for `buffTime` ticks,
 *   cross-checked against the Cargo `buffs` / `debuffs` columns (Ale → Tipsy, 7200 ticks).
 * - acquisition + gatedBy/stage: merge/acquisition.ts (the weapons rules).
 */
import type { AmmoStats, GapEntry, Item, ProvSource, SpriteManifestFile } from '../../src/schemas'
import type { Article } from '../fetch/articles'
import { itemTypeIncludes, type CargoRow } from '../fetch/cargo'
import type { CategoryTree } from '../fetch/categories'
import { wikiPageUrl } from '../fetch/config'
import type { ImageInfoFetch } from '../fetch/images'
import { infoboxForItem, parseItemInfoboxes, type BuffIdRow, type ItemInfobox } from '../parse/infobox'
import type { Iteminfo, IteminfoItem } from '../parse/iteminfo'
import { extraUpdates, type Projectileinfo } from '../parse/projectileinfo'
import { slugify, stripMarkup } from '../parse/text'
import { itemRoutes, type RouteSources, type WithheldField } from './acquisition'
import { tally, type ReasonTally } from './drops'
import type { GatingResult } from './gating'
import { GapLog, isoDate, makeProv, moduleSource } from './prov'
import { OverlayError } from './registry'
import { ammoClassSlug, cargoRarity, leadingNumber, rarityOf, tagCategoriesOf, type CrossCheckCount } from './weapons'

const str = (v: CargoRow[string] | undefined) => (v === null || v === undefined ? '' : String(v))

export interface AmmoCandidate {
  row: CargoRow
  item: IteminfoItem
  name: string
}

export interface AmmoIdentification {
  typedRows: number
  included: AmmoCandidate[]
  excluded: { row: CargoRow; kind: GapEntry['kind']; reason: string }[]
  /** Iteminfo items with a non-zero `ammo` that no included row covers (reconciliation). */
  iteminfoOnly: IteminfoItem[]
}

export function identifyAmmo(rows: readonly CargoRow[], info: Iteminfo): AmmoIdentification {
  const typed = rows.filter((r) => itemTypeIncludes(r, 'ammunition')).sort((a, b) => Number(str(a._rowid)) - Number(str(b._rowid)))
  const included: AmmoCandidate[] = []
  const excluded: AmmoIdentification['excluded'] = []
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
    if (!((item.stats as Record<string, unknown>).ammo as number)) {
      excluded.push({ row, kind: 'source-mismatch', reason: `"${cargoName}" is typed ammunition on the wiki but Module:Iteminfo/data gives it no ammo class (ammo 0)` })
      continue
    }
    if (seen.has(id)) {
      excluded.push({ row, kind: 'count-reconciliation', reason: `duplicate Cargo row for item ${id} ("${cargoName}", page ${str(row._page)})` })
      continue
    }
    seen.add(id)
    included.push({ row, item, name: item.name ?? cargoName })
  }
  const iteminfoOnly = [...info.items.values()].filter((i) => (i.stats as Record<string, unknown>).ammo !== 0 && !seen.has(i.id)).sort((a, b) => a.id - b.id)
  return { typedRows: typed.length, included, excluded, iteminfoOnly }
}

/** "2×" → 2 (the infobox Velocity Multiplier cell); undefined when not that shape. */
export function multiplierOf(cell: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)\s*[×x]$/.exec(cell.trim())
  return m ? Number(m[1]) : undefined
}

export interface WeaponAmmo {
  ammoStats: AmmoStats
  unverified: string[]
  sources: ProvSource[]
  crossCheckFailed: boolean
}

export interface AmmoBuildInput {
  itemRows: readonly CargoRow[]
  itemsFetchedAt: string
  iteminfo: Iteminfo
  projectileinfo: Projectileinfo
  /** Ammo item articles by title (Cargo `_page`), as fetched by the sync plan. */
  articles: ReadonlyMap<string, Article>
  /** Category:Ammunition items tree (tags). */
  categories: CategoryTree
  images: ImageInfoFetch
  recipes: readonly { id: string; resultItemId: number }[]
  drops: readonly { id: string; itemId: number }[]
  gating: (itemId: number) => GatingResult
  /** Item IDs emitted as weapons (dual-role items get their ammoStats on the weapon). */
  weaponIds: ReadonlySet<number>
  /** Slugs already used in the item ID space (weapons) — item slugs must stay unique (§3). */
  usedSlugs: ReadonlySet<string>
  /** Item IDs used as a crafting station by ≥1 recipe (Item.isStation, derived). */
  stationIds: ReadonlySet<number>
  buffTable: readonly BuffIdRow[]
  /** Buff name → emitted buff slug. */
  buffSlug: (name: string) => string | undefined
  withheld?: ReadonlyMap<number, WithheldField>
  /** B68/B78 acquisition sources (vendor model + gatherables); absent = the P2-S7 vendor behavior. */
  sources?: RouteSources
}

export interface AmmoBuild {
  items: Item[]
  weaponAmmo: Map<number, WeaponAmmo>
  gaps: GapEntry[]
  identification: AmmoIdentification
  sprites: SpriteManifestFile[]
  reasons: ReasonTally
  gatingBlockers: ReasonTally
  crossCheck: Map<string, CrossCheckCount>
  /** Ammo item ID → its wiki article (Cargo `_page`). */
  pageOf: Map<number, string>
  /** velocityMultiplier provenance per item (report): "infobox", "n/a (…)", "Unknown (…)". */
  multiplier: Map<number, string>
}

export function buildAmmo(input: AmmoBuildInput): AmmoBuild {
  const { iteminfo: info, projectileinfo: proj } = input
  const gaps = new GapLog()
  const reasons: ReasonTally = new Map()
  const gatingBlockers: ReasonTally = new Map()
  const fetchedAt = isoDate(input.itemsFetchedAt)
  const iteminfoSrc = moduleSource('iteminfo', { title: 'Module:Iteminfo/data', rev: info.rev, fetchedAt: info.fetchedAt })
  const projSrc = moduleSource('wiki-module', { title: proj.title, rev: proj.rev, fetchedAt: proj.fetchedAt })
  const identification = identifyAmmo(input.itemRows, info)
  for (const ex of identification.excluded) {
    const claimed = Number(str(ex.row.itemid))
    gaps.add({ ref: `i:${Number.isInteger(claimed) && claimed > 0 ? claimed : 0}`, field: 'id', kind: ex.kind, detail: `Cargo Items row ${str(ex.row._rowid)} not emitted as ammo: ${ex.reason}`, sources: [wikiPageUrl(str(ex.row._page))] })
  }
  const recipesBy = new Map<number, string[]>()
  for (const r of input.recipes) recipesBy.set(r.resultItemId, [...(recipesBy.get(r.resultItemId) ?? []), r.id])
  const dropsBy = new Map<number, string[]>()
  for (const d of input.drops) dropsBy.set(d.itemId, [...(dropsBy.get(d.itemId) ?? []), d.id])
  const tagsByPage = tagCategoriesOf(input.categories)
  const boxCache = new Map<string, ItemInfobox[]>()
  const boxesOf = (page: string): ItemInfobox[] => {
    if (!boxCache.has(page)) {
      const article = input.articles.get(page)
      if (!article) throw new OverlayError(`[E_SCHEMA] ammo article "${page}" was not fetched by the sync plan (run npm run pipeline:fetch)`)
      boxCache.set(page, parseItemInfoboxes(article.html))
    }
    return boxCache.get(page) as ItemInfobox[]
  }
  const sprites: SpriteManifestFile[] = []
  const items: Item[] = []
  const weaponAmmo = new Map<number, WeaponAmmo>()
  const crossCheck = new Map<string, CrossCheckCount>()
  const pageOf = new Map<number, string>()
  const multiplier = new Map<number, string>()
  const count = (field: string, outcome: keyof CrossCheckCount) => {
    const c = crossCheck.get(field) ?? { agree: 0, mismatch: 0, noWikiValue: 0 }
    c[outcome] += 1
    crossCheck.set(field, c)
  }
  const agrees = (field: string, wiki: number | undefined, expected: number): boolean => {
    if (wiki === undefined) {
      count(field, 'noWikiValue')
      return true
    }
    count(field, wiki === expected ? 'agree' : 'mismatch')
    return wiki === expected
  }

  for (const { row, item, name } of [...identification.included].sort((a, b) => a.item.id - b.item.id)) {
    const s = item.stats as Record<string, unknown>
    const n = (k: string) => (typeof s[k] === 'number' ? (s[k] as number) : undefined)
    const id = item.id
    const ref = `i:${id}`
    const page = str(row._page)
    pageOf.set(id, page)
    const wikiUrl = wikiPageUrl(page)
    const article = input.articles.get(page)
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

    // ---- ammoStats ----
    const ammoClass = ammoClassSlug(n('ammo') ?? 0, info)
    if (!ammoClass) throw new OverlayError(`[E_SCHEMA] ammo ${ref}: Iteminfo ammo ${String(s.ammo)} is not a named item`)
    const stats: AmmoStats = { ammoClass }
    const damage = n('damage') ?? -1
    const cargoDamage = leadingNumber(str(row.damage))
    if (damage > 0) {
      if (!agrees('ammoStats.damage', cargoDamage, damage)) mismatch('ammoStats.damage', `Module:Iteminfo/data damage ${damage}, wiki infobox ${cargoDamage}`)
      else stats.damage = damage
      const kb = n('knockBack') ?? 0
      if (!agrees('ammoStats.knockback', leadingNumber(str(row.knockback)), kb)) mismatch('ammoStats.knockback', `Module:Iteminfo/data knockback ${kb}, wiki infobox ${leadingNumber(str(row.knockback))}`)
      else stats.knockback = kb
      const speed = n('shootSpeed') ?? 0
      const cargoVelocity = leadingNumber(str(row.velocity))
      if (!agrees('ammoStats.velocityBonusTps (shootSpeed vs wiki base velocity)', cargoVelocity, speed)) mismatch('ammoStats.velocityBonusTps', `Module:Iteminfo/data shootSpeed ${speed}, wiki infobox velocity ${cargoVelocity}`)
      else stats.velocityBonusTps = Math.round(speed * 3.75 * 1e6) / 1e6
    } else {
      const why = 'Module:Iteminfo/data gives the item no damage of its own (no ammo stats in the game data)'
      unknown('ammoStats.damage', why)
      unknown('ammoStats.knockback', why)
      unknown('ammoStats.velocityBonusTps', why)
      if (cargoDamage !== undefined) mismatch('ammoStats.damage', `Module:Iteminfo/data has no damage, wiki infobox ${cargoDamage}`)
    }

    // velocity multiplier (B2): the item's own infobox, cross-checked with Module:Projectileinfo/data
    const shoot = n('shoot') ?? 0
    const box = article ? infoboxForItem(boxesOf(page), id) : undefined
    const rowValue = box?.rows.find((r) => r.label === 'Velocity Multiplier')?.value
    const xu = box && box.projectileIds.includes(shoot) ? extraUpdates(proj, shoot) : undefined
    const projNote = xu !== undefined ? `; Projectileinfo projectile ${shoot} extraUpdates ${xu}` : ''
    if (rowValue !== undefined) {
      const mult = multiplierOf(rowValue)
      if (mult === undefined) mismatch('ammoStats.velocityMultiplier', `infobox Velocity Multiplier "${rowValue}" is not a plain factor`, [wikiUrl])
      else if (xu !== undefined && xu + 1 !== mult) {
        count('ammoStats.velocityMultiplier (infobox vs 1 + extraUpdates)', 'mismatch')
        mismatch('ammoStats.velocityMultiplier', `wiki infobox Velocity Multiplier ${mult}×, Module:Projectileinfo/data projectile ${shoot} extraUpdates ${xu}`, [wikiUrl, projSrc.url])
      } else {
        count('ammoStats.velocityMultiplier (infobox vs 1 + extraUpdates)', xu === undefined ? 'noWikiValue' : 'agree')
        stats.velocityMultiplier = mult
        multiplier.set(id, `${mult}× (own infobox${projNote})`)
      }
    } else if (shoot === 0) {
      multiplier.set(id, 'n/a (Iteminfo shoot 0: the firing weapon decides the projectile)')
    } else if (box) {
      if (xu !== undefined && xu > 0) {
        count('ammoStats.velocityMultiplier (infobox vs 1 + extraUpdates)', 'mismatch')
        mismatch('ammoStats.velocityMultiplier', `wiki infobox shows no Velocity Multiplier, Module:Projectileinfo/data projectile ${shoot} has extraUpdates ${xu}`, [wikiUrl, projSrc.url])
        multiplier.set(id, 'Unknown (sources disagree)')
      } else {
        if (xu !== undefined) count('ammoStats.velocityMultiplier (infobox vs 1 + extraUpdates)', 'agree')
        multiplier.set(id, `n/a (own infobox states none${projNote})`)
      }
    } else {
      unknown('ammoStats.velocityMultiplier', 'the item has no infobox of its own (list article shared by several items), so the wiki states no per-item multiplier')
      multiplier.set(id, 'Unknown (no own infobox)')
    }
    if (box) sources.push({ kind: 'wiki-article', url: wikiPageUrl(article?.resolvedTitle ?? page), rev: article?.revid as number, fetchedAt: isoDate(article?.fetchedAt ?? input.itemsFetchedAt) })
    if (xu !== undefined) sources.push(projSrc)

    // buffs granted on use (Ale → Tipsy)
    const buffType = n('buffType') ?? 0
    let buffGrants: Item['buffGrants']
    if (buffType > 0) {
      const tableName = input.buffTable.find((r) => r.id === buffType)?.name
      const cargoNames = new Set([...str(row.buffs).split('^'), ...str(row.debuffs).split('^')].map((x) => x.trim()).filter(Boolean))
      const slug = tableName ? input.buffSlug(tableName) : undefined
      const time = n('buffTime') ?? 0
      if (!tableName || !cargoNames.has(tableName) || !slug || time <= 0) {
        mismatch('buffGrants', `Module:Iteminfo/data buffType ${buffType} (${tableName ?? 'not in the Buff IDs table'}) is not confirmed by the wiki infobox buffs (${[...cargoNames].join(', ') || 'none'}) or has no emitted buff record`)
      } else buffGrants = [{ buffId: slug, durationTicks: time }]
    }

    // core item fields
    const rarity = rarityOf(s.rare)
    const cargoRare = cargoRarity(str(row.rare))
    if (rarity === undefined) unknown('rarity', `rare ${String(s.rare)} has no Rarity encoding`)
    else if (!agrees('rarity', cargoRare, s.rare as number)) mismatch('rarity', `Module:Iteminfo/data rare ${String(s.rare)}, wiki infobox ${cargoRare}`)
    const consumable = s.consumable === true
    const cargoConsumable = str(row.consumable).trim() === '1'
    count('consumable', cargoConsumable === consumable ? 'agree' : 'mismatch')
    if (cargoConsumable !== consumable) mismatch('consumable', `Module:Iteminfo/data consumable ${consumable}, wiki infobox ${cargoConsumable}`)
    const value = n('value')
    const tags = [...new Set([...(tagsByPage.get(page) ?? []), ...(str(row.unobtainable) === '1' ? ['unobtainable'] : [])])].sort()

    // sprite
    const image = input.images.found.get(str(row.imagefile).trim())
    let sprite: string | undefined
    if (image) {
      sprite = `/sprites/items/${id}.${/\.gif$/i.test(image.file) ? 'gif' : 'png'}`
    } else if (!input.weaponIds.has(id)) {
      gaps.add({ ref, field: 'sprite', kind: 'missing-sprite', detail: `${name}: no wiki image file resolved for "${str(row.imagefile)}"; the placeholder sprite is shown`, sources: [wikiUrl] })
    }

    // dual-role weapon: the weapon record carries everything else (its own sprite, acquisition, gating)
    if (input.weaponIds.has(id)) {
      weaponAmmo.set(id, { ammoStats: stats, unverified: unverified.filter((f) => f.startsWith('ammoStats.')), sources: sources.filter((x) => x.kind !== 'cargo:Items' && x.kind !== 'iteminfo'), crossCheckFailed })
      continue
    }
    if (image && sprite) sprites.push({ path: sprite, ref, wikiFileUrl: image.descriptionUrl, sha1: image.sha1, bytes: image.bytes, width: image.width, height: image.height, rights: 're-logic' })

    // acquisition + §7b gating (merge/acquisition.ts)
    const { acquisition, gating, sources: routeSources } = itemRoutes({ id, name, noun: 'ammo item', row, wikiUrl, recipesBy, dropsBy, withheld: input.withheld?.get(id), gating: input.gating, unknown, mismatch, gaps, reasons, ...(input.sources ? { sources: input.sources } : {}) })
    sources.push(...routeSources)
    let gatedBy: Item['gatedBy']
    if (gating.ok) gatedBy = gating.gatedBy
    else {
      unverified.push('gatedBy', 'stage')
      tally(gatingBlockers, gating.blockers.join(' + '), name)
    }

    const record: Item = {
      id,
      name,
      slug: slugify(name),
      type: 'item',
      ...(rarity !== undefined && !unverified.includes('rarity') ? { rarity } : {}),
      ...(gatedBy ? { stage: gatedBy.stage } : {}),
      tags,
      wikiUrl,
      ...(sprite && image ? { sprite } : {}),
      ...(value !== undefined && value >= 0 ? { valueCopper: value } : {}),
      ...(consumable && (n('maxStack') ?? 0) > 0 ? { maxStack: n('maxStack') } : {}),
      ...(gatedBy ? { gatedBy } : {}),
      acquisition,
      category: 'ammo',
      ...(!unverified.includes('consumable') ? { consumable } : {}),
      isStation: input.stationIds.has(id),
      ammoStats: stats,
      ...(buffGrants ? { buffGrants } : {}),
      _prov: makeProv(sources, unverified, crossCheckFailed),
    }
    items.push(record)
  }

  // slugs unique across the item ID space: later duplicates get the item ID appended (weapons rule)
  const slugs = new Set(input.usedSlugs)
  for (const i of items) {
    if (slugs.has(i.slug)) i.slug = `${i.slug}-${i.id}`
    slugs.add(i.slug)
  }
  return {
    items,
    weaponAmmo,
    gaps: gaps.entries,
    identification,
    sprites,
    reasons,
    gatingBlockers,
    crossCheck: new Map([...crossCheck].sort(([a], [b]) => a.localeCompare(b))),
    pageOf,
    multiplier,
  }
}
