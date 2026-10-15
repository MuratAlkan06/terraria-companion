/**
 * Equipment identification shared by the fetch plan and the armor / accessory builders (P2-S8).
 *
 * The wiki's own classification decides, like the weapons rule (P2-S2): Cargo Items `type` lists
 * "armor" for wearable armor pieces and "armor" + "set" for the set row of a set article (no item ID:
 * it is the set infobox, not an item); "accessory" for accessories, + "vanity" for cosmetic ones.
 * Every candidate row must also be the same desktop item in Module:Iteminfo/data (same display name,
 * head/body/leg slot or `accessory` flag, `vanity` agreeing) — excluded rows get a gap entry, never a guess.
 *
 * Scope ruling (reported): vanity accessories (cosmetic, incl. music boxes) carry no equipment effect —
 * the Accessory schema's categories / effects cannot describe them — so they are reconciled and
 * counted but not emitted here (item corpus, P6-S0). The wiki's `type` and Iteminfo `vanity` agree on
 * every accessory row (checked: a disagreement excludes the row with a source-mismatch gap).
 */
import type { Acquisition, GapEntry, GatedBy, ProvSource, Rarity, SpriteManifestFile } from '../../src/schemas'
import { itemTypeIncludes, type CargoRow } from '../fetch/cargo'
import { wikiPageUrl } from '../fetch/config'
import type { ImageInfoFetch } from '../fetch/images'
import type { Iteminfo, IteminfoItem } from '../parse/iteminfo'
import { slugify, stripMarkup } from '../parse/text'
import { itemRoutes, type RouteSources, type WithheldField } from './acquisition'
import { tally, type ReasonTally } from './drops'
import type { GatingResult } from './gating'
import { GapLog, isoDate, moduleSource } from './prov'
import { cargoRarity, leadingNumber, rarityOf, type CrossCheckCount } from './weapons'

const str = (v: CargoRow[string] | undefined) => (v === null || v === undefined ? '' : String(v))

/** The wiki article holding every wing type's list table (flight time, hover) — P2-S8 wingStats. */
export const WINGS_PAGE = 'Wings'

const byRowId = (a: CargoRow, b: CargoRow) => Number(str(a._rowid)) - Number(str(b._rowid))

/** Cargo Items rows of wearable armor pieces (typed "armor", not the set row). */
export const armorPieceRows = (rows: readonly CargoRow[]): CargoRow[] => rows.filter((r) => itemTypeIncludes(r, 'armor') && !itemTypeIncludes(r, 'set')).sort(byRowId)

/** Cargo Items set rows (typed "armor" + "set": the set infobox of a set article). */
export const armorSetRows = (rows: readonly CargoRow[]): CargoRow[] => rows.filter((r) => itemTypeIncludes(r, 'armor') && itemTypeIncludes(r, 'set')).sort(byRowId)

/** Every armor set article (the `_page` of a set row), sorted. */
export const armorSetPages = (rows: readonly CargoRow[]): string[] => [...new Set(armorSetRows(rows).map((r) => str(r._page)).filter(Boolean))].sort()

/** Cargo Items rows typed "accessory", split by the wiki's "vanity" type. */
export function accessoryRows(rows: readonly CargoRow[]): { functional: CargoRow[]; vanity: CargoRow[] } {
  const all = rows.filter((r) => itemTypeIncludes(r, 'accessory')).sort(byRowId)
  return { functional: all.filter((r) => !itemTypeIncludes(r, 'vanity')), vanity: all.filter((r) => itemTypeIncludes(r, 'vanity')) }
}

export interface EquipmentCandidate {
  row: CargoRow
  item: IteminfoItem
  name: string
}

export interface EquipmentIdentification {
  typedRows: number
  included: EquipmentCandidate[]
  excluded: { row: CargoRow; kind: GapEntry['kind']; reason: string }[]
}

/**
 * Same item in both sources: a positive Cargo item ID that Module:Iteminfo/data carries under the same
 * display name (internal name for unnamed IDs), passing `check` (slot / accessory flag), not seen before.
 */
export function identifyEquipment(rows: readonly CargoRow[], info: Iteminfo, noun: string, check: (item: IteminfoItem, row: CargoRow) => string | undefined): EquipmentIdentification {
  const included: EquipmentCandidate[] = []
  const excluded: EquipmentIdentification['excluded'] = []
  const seen = new Set<number>()
  for (const row of rows) {
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
      excluded.push({ row, kind: 'source-mismatch', reason: `Cargo row "${cargoName}" (page ${str(row._page)}) carries item ID ${id}, which Module:Iteminfo/data assigns to "${item.name ?? item.internalName}" — a different (desktop) item` })
      continue
    }
    const problem = check(item, row)
    if (problem) {
      excluded.push({ row, kind: 'source-mismatch', reason: `"${cargoName}" is typed ${noun} on the wiki but ${problem}` })
      continue
    }
    if (seen.has(id)) {
      excluded.push({ row, kind: 'count-reconciliation', reason: `duplicate Cargo row for item ${id} ("${cargoName}", page ${str(row._page)})` })
      continue
    }
    seen.add(id)
    included.push({ row, item, name: item.name ?? cargoName })
  }
  return { typedRows: rows.length, included, excluded }
}

const stat = (item: IteminfoItem, key: string): unknown => (item.stats as Record<string, unknown>)[key]

/** Armor slot from Iteminfo head/body/leg slot (exactly one must be set). */
export function iteminfoArmorSlot(item: IteminfoItem): 'head' | 'chest' | 'legs' | undefined {
  const slots = (
    [
      ['head', 'headSlot'],
      ['chest', 'bodySlot'],
      ['legs', 'legSlot'],
    ] as const
  ).filter(([, k]) => typeof stat(item, k) === 'number' && (stat(item, k) as number) >= 0)
  return slots.length === 1 ? slots[0][0] : undefined
}

/** Cargo `bodyslot` → slot ("helmet" / "shirt" / "pants"). */
export const CARGO_BODYSLOT: Record<string, 'head' | 'chest' | 'legs'> = { helmet: 'head', shirt: 'chest', pants: 'legs' }

export function identifyArmor(rows: readonly CargoRow[], info: Iteminfo): EquipmentIdentification {
  return identifyEquipment(armorPieceRows(rows), info, 'armor', (item, row) => {
    const slot = iteminfoArmorSlot(item)
    if (!slot) return 'Module:Iteminfo/data gives it no single head/body/leg slot'
    if (stat(item, 'vanity') === true) return 'Module:Iteminfo/data marks it vanity'
    const cargoSlot = CARGO_BODYSLOT[str(row.bodyslot).trim()]
    if (cargoSlot !== slot) return `the wiki body slot "${str(row.bodyslot)}" disagrees with Module:Iteminfo/data (${slot})`
    return undefined
  })
}

export function identifyAccessories(rows: readonly CargoRow[], info: Iteminfo): EquipmentIdentification {
  return identifyEquipment(accessoryRows(rows).functional, info, 'a functional accessory', (item) => {
    if (stat(item, 'accessory') !== true) return 'Module:Iteminfo/data does not flag it as an accessory'
    if (stat(item, 'vanity') === true) return 'Module:Iteminfo/data marks it vanity (the wiki does not)'
    return undefined
  })
}

// ---------------------------------------------------------------------------------------------
// Shared per-record core (armor pieces + accessories), the weapons/ammo rules (merge/weapons.ts,
// merge/ammo.ts): rarity (Iteminfo `rare`, cross-checked with Cargo `rare`), valueCopper (Iteminfo
// `value`), NO maxStack (AMENDMENTS-002 B7: equipment never stacks; Cargo's 9999 is bogus), tags = the
// row's other wiki item types ("boots", "shield", …) + "wings" (Iteminfo wingSlot) + "unobtainable",
// sprite (the infobox image's imageinfo), acquisition + §7b gating (merge/acquisition.ts).
// ---------------------------------------------------------------------------------------------

export interface EquipmentContext {
  family: 'armor' | 'accessories'
  /** What the record is, for reason text ("armor piece", "accessory"). */
  noun: string
  iteminfo: Iteminfo
  itemsFetchedAt: string
  images: ImageInfoFetch
  recipesBy: ReadonlyMap<number, readonly string[]>
  dropsBy: ReadonlyMap<number, readonly string[]>
  gating: (itemId: number) => GatingResult
  withheld?: ReadonlyMap<number, WithheldField>
  /** B68/B78 acquisition sources (vendor model + gatherables); absent = the P2-S8 vendor behavior. */
  sources?: RouteSources
  gaps: GapLog
  reasons: ReasonTally
  gatingBlockers: ReasonTally
  crossCheck: Map<string, CrossCheckCount>
  sprites: SpriteManifestFile[]
}

/** Mutable per-record verification state. */
export interface RecordState {
  ref: string
  name: string
  wikiUrl: string
  unverified: string[]
  sources: ProvSource[]
  crossCheckFailed: boolean
  /** Lists a field as Unknown with a reason for the report (once per record and reason). */
  unknown: (field: string, why: string) => void
  /** Withholds a field because sources disagree (Unknown + source-mismatch gap). */
  mismatch: (field: string, detail: string, sources?: string[]) => void
  /** Counts a cross-check outcome; returns false on mismatch. */
  agrees: (field: string, wiki: number | undefined, expected: number) => boolean
  count: (field: string, outcome: keyof CrossCheckCount) => void
}

export function recordState(ctx: EquipmentContext, c: EquipmentCandidate): RecordState {
  const id = c.item.id
  const ref = `i:${id}`
  const wikiUrl = wikiPageUrl(str(c.row._page))
  const iteminfoSrc = moduleSource('iteminfo', { title: 'Module:Iteminfo/data', rev: ctx.iteminfo.rev, fetchedAt: ctx.iteminfo.fetchedAt })
  const tallied = new Set<string>()
  const s: RecordState = {
    ref,
    name: c.name,
    wikiUrl,
    unverified: [],
    sources: [{ kind: 'cargo:Items', url: wikiUrl, fetchedAt: isoDate(ctx.itemsFetchedAt) }, iteminfoSrc],
    crossCheckFailed: false,
    unknown: (field, why) => {
      s.unverified.push(field)
      const key = `${field.replace(/\.\d+\./g, '.N.')}: ${why}`
      if (!tallied.has(key)) tally(ctx.reasons, key, c.name)
      tallied.add(key)
    },
    mismatch: (field, detail, sources = [wikiUrl, iteminfoSrc.url]) => {
      s.unverified.push(field)
      s.crossCheckFailed = true
      ctx.gaps.add({ ref, field, kind: 'source-mismatch', detail: `${c.name}: ${detail}; value withheld (Unknown)`, sources })
    },
    count: (field, outcome) => {
      const cc = ctx.crossCheck.get(field) ?? { agree: 0, mismatch: 0, noWikiValue: 0 }
      cc[outcome] += 1
      ctx.crossCheck.set(field, cc)
    },
    agrees: (field, wiki, expected) => {
      if (wiki === undefined) {
        s.count(field, 'noWikiValue')
        return true
      }
      s.count(field, wiki === expected ? 'agree' : 'mismatch')
      return wiki === expected
    },
  }
  return s
}

export interface EquipmentCore {
  rarity?: Rarity
  stage?: GatedBy['stage']
  tags: string[]
  sprite?: string
  valueCopper?: number
  gatedBy?: GatedBy
  acquisition: Acquisition[]
}

const FAMILY_TYPES: Record<EquipmentContext['family'], string> = { armor: 'armor', accessories: 'accessory' }

export function equipmentCore(ctx: EquipmentContext, c: EquipmentCandidate, s: RecordState): EquipmentCore {
  const st = c.item.stats as Record<string, unknown>
  const id = c.item.id
  // rarity
  const rarity = rarityOf(st.rare)
  const cargoRare = cargoRarity(str(c.row.rare))
  if (rarity === undefined) s.unknown('rarity', `rare ${String(st.rare)} has no Rarity encoding`)
  else if (!s.agrees('rarity', cargoRare, st.rare as number)) s.mismatch('rarity', `Module:Iteminfo/data rare ${String(st.rare)}, wiki infobox ${cargoRare}`)
  const value = typeof st.value === 'number' && st.value >= 0 ? st.value : undefined
  // tags: the wiki's other item types for this row + Iteminfo wing slot + unobtainable
  const types = str(c.row.type).split('^').map((t) => t.trim()).filter((t) => t !== '' && t !== FAMILY_TYPES[ctx.family] && t !== 'crafting material')
  const wings = typeof st.wingSlot === 'number' && st.wingSlot > 0
  const tags = [...new Set([...types.map(slugify), ...(wings ? ['wings'] : []), ...(str(c.row.unobtainable) === '1' ? ['unobtainable'] : [])])].filter(Boolean).sort()
  // sprite
  const image = ctx.images.found.get(str(c.row.imagefile).trim())
  let sprite: string | undefined
  if (image) {
    sprite = `/sprites/${ctx.family}/${id}.${/\.gif$/i.test(image.file) ? 'gif' : 'png'}`
    ctx.sprites.push({ path: sprite, ref: s.ref, wikiFileUrl: image.descriptionUrl, sha1: image.sha1, bytes: image.bytes, width: image.width, height: image.height, rights: 're-logic' })
  } else {
    ctx.gaps.add({ ref: s.ref, field: 'sprite', kind: 'missing-sprite', detail: `${c.name}: no wiki image file resolved for "${str(c.row.imagefile)}"; the placeholder sprite is shown`, sources: [s.wikiUrl] })
  }
  // acquisition + §7b gating
  const { acquisition, gating, sources: routeSources } = itemRoutes({
    id,
    name: c.name,
    noun: ctx.noun,
    row: c.row,
    wikiUrl: s.wikiUrl,
    recipesBy: ctx.recipesBy,
    dropsBy: ctx.dropsBy,
    withheld: ctx.withheld?.get(id),
    gating: ctx.gating,
    unknown: s.unknown,
    mismatch: s.mismatch,
    gaps: ctx.gaps,
    reasons: ctx.reasons,
    ...(ctx.sources ? { sources: ctx.sources } : {}),
  })
  s.sources.push(...routeSources)
  let gatedBy: GatedBy | undefined
  if (gating.ok) gatedBy = gating.gatedBy
  else {
    s.unverified.push('gatedBy', 'stage')
    tally(ctx.gatingBlockers, gating.blockers.join(' + '), c.name)
  }
  return {
    ...(rarity !== undefined && !s.unverified.includes('rarity') ? { rarity } : {}),
    ...(gatedBy ? { stage: gatedBy.stage } : {}),
    tags,
    ...(sprite ? { sprite } : {}),
    ...(value !== undefined ? { valueCopper: value } : {}),
    ...(gatedBy ? { gatedBy } : {}),
    acquisition,
  }
}

/** Iteminfo `defense` cross-checked with the Cargo infobox `defense` cell (no cell = the wiki shows none). */
export function checkedDefense(c: EquipmentCandidate, s: RecordState, field = 'defense'): number | undefined {
  const def = (c.item.stats as Record<string, unknown>).defense
  const iteminfo = typeof def === 'number' && Number.isInteger(def) && def >= 0 ? def : undefined
  const cargo = leadingNumber(str(c.row.defense))
  if (iteminfo === undefined) {
    s.unknown(field, 'no integer defense in Module:Iteminfo/data')
    return undefined
  }
  // the wiki infobox omits a 0 defense row: no wiki value to compare
  if (!s.agrees('defense', cargo === undefined && iteminfo === 0 ? undefined : cargo, iteminfo)) {
    s.mismatch(field, `Module:Iteminfo/data defense ${iteminfo}, wiki infobox ${cargo ?? 'none'}`)
    return undefined
  }
  return iteminfo
}

/** Slugs unique across the item ID space: later duplicates get the item ID appended (weapons rule). */
export function uniqueSlugs<T extends { id: number; slug: string }>(records: T[], used: ReadonlySet<string>): void {
  const slugs = new Set(used)
  for (const r of records) {
    if (slugs.has(r.slug)) r.slug = `${r.slug}-${r.id}`
    slugs.add(r.slug)
  }
}
