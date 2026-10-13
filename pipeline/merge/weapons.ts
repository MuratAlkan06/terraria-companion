/**
 * Cargo Items + Module:Iteminfo/data (+ the recipes/drops datasets, the weapon category tree and
 * image metadata) → Weapon[] (P2-S2). Every rule below was verified against the 2026-10-13 sync;
 * the gap report restates the evidence.
 *
 * IDENTIFICATION. A weapon is a Cargo Items row whose infobox `type` list contains "weapon" (the
 * wiki's own classification; every such row sits on a page in the weapon category tree) AND
 * whose `itemid` is a desktop game item: the ID exists in Module:Iteminfo/data (extracted from
 * the desktop game source) with the same display name (or, for the few items the module leaves
 * unnamed, the same internal name). Rows without an item ID, or whose ID belongs to a different
 * item (mobile-only items reuse desktop IDs), are excluded with a gap entry — never guessed.
 *
 * STATS (Iteminfo = numeric ground truth, ADR D2; cross-checked against the Cargo infobox — a
 * disagreement strips the value, lists it as Unknown and records a source-mismatch gap):
 * - damage (Iteminfo `damage` > 0; ≤ 0 means the item carries no damage of its own — explosives,
 *   ammo-driven launchers — so damage AND knockback are Unknown), knockback (`knockBack`),
 *   useTimeTicks (`useTime`) and useAnimationTicks (`useAnimation`; TO-VERIFY #10: the wiki's
 *   "Use time" equals useAnimation for every weapon), autoReuse (`autoReuse` ⇔ Cargo
 *   `autoswing`), manaCost (`mana` > 0), rarity (`rare`, special tiers per TO-VERIFY #9),
 *   ammoClass (`useAmmo` = the AmmoID representative item → slug of its name, e.g. 40 →
 *   "wooden-arrow"), shootSpeedTps (`shootSpeed` px/tick × 60/16; the item stat, not the
 *   projectile's effective velocity), valueCopper (`value`), maxStack (consumables only, B7).
 * - critPct = Iteminfo `crit` (the weapon's bonus; the wiki shows 4% + crit). Not applicable for
 *   summon weapons (Critical hit page: summon damage cannot normally crit; the wiki infobox
 *   shows none); Unknown for classless weapons (the wiki shows none, rule undocumented).
 * - damageClass from the Iteminfo class flags, cross-checked with Cargo `damagetype`; no flag
 *   and an empty `damagetype` = classless → "other".
 *
 * ACQUISITION links the existing datasets: craft = recipes producing the weapon (incl. Shimmer
 * transmutations), drop = drop records yielding it (NPCs, bosses, bags, chests, crates),
 * purchase = one route per `vendor:<NPC>` Cargo tag (price from a single-coin `buy` cell; shop
 * conditions are not structured on the wiki → conditions Unknown). Route hints in the Cargo
 * tags/listcat that no record backs (craftable but no recipe, fished, plunder, unnamed vendor…)
 * are reported as gaps; nothing is inferred from them.
 */
import type { Acquisition, GapEntry, ProvSource, Rarity, SpriteManifestFile, Weapon } from '../../src/schemas'
import { itemTypeIncludes, type CargoRow } from '../fetch/cargo'
import type { CategoryTree } from '../fetch/categories'
import { wikiPageUrl } from '../fetch/config'
import type { ImageInfoFetch } from '../fetch/images'
import type { Iteminfo, IteminfoItem } from '../parse/iteminfo'
import { slugify, stripMarkup } from '../parse/text'
import { limitation } from '../validate/labDowngrade'
import { tally, type ReasonTally } from './drops'
import type { GatingResult } from './gating'
import { GapLog, isoDate, makeProv, moduleSource } from './prov'
import { OverlayError } from './registry'

const str = (v: CargoRow[string] | undefined) => (v === null || v === undefined ? '' : String(v))

/** Leading number of a Cargo cell after markup stripping ("6 (Insanely fast)" → 6). */
export function leadingNumber(cell: string): number | undefined {
  const m = /^\s*(-?\d+(?:\.\d+)?)/.exec(stripMarkup(cell))
  return m ? Number(m[1]) : undefined
}

/** TO-VERIFY #9: Iteminfo `rare` → Rarity. -11 amber (quest), -12 rainbow (Expert), -13 fiery red (Master). */
export function rarityOf(rare: unknown): Rarity | undefined {
  if (typeof rare !== 'number' || !Number.isInteger(rare)) return undefined
  if (rare >= -1 && rare <= 11) return rare
  return ({ [-11]: 'amber', [-12]: 'rainbow', [-13]: 'fiery-red' } as Record<number, Rarity>)[rare]
}

/** Cargo `rare` cell → the game value (plain integer or the rarity template's "Rarity level: N"). */
export function cargoRarity(cell: string): number | undefined {
  const m = /Rarity level: (-?\d+)/.exec(cell) ?? /^\s*(-?\d+)\s*$/.exec(cell)
  return m ? Number(m[1]) : undefined
}

/**
 * Ammo class slug shared by weapons (`useAmmo`) and ammo items (`ammo`, P2-S7): both hold the
 * game's AmmoID, which is the item ID of the class's representative item. Slug = that item's
 * name (40 → "wooden-arrow", 97 → "musket-ball", 771 → "rocket-i").
 */
export function ammoClassSlug(ammoId: number, info: Iteminfo): string | undefined {
  const item = info.items.get(ammoId)
  if (!item) return undefined
  const slug = slugify(item.name ?? item.internalName)
  return slug === '' ? undefined : slug
}

const CLASS_FLAGS = ['melee', 'ranged', 'magic', 'summon'] as const

/** Tooltip HTML → plain text lines (A15), joined by "\n". */
export function tooltipText(cell: string): string | undefined {
  const lines = cell
    .split(/<br\s*\/?>/i)
    .map((l) => stripMarkup(l))
    .filter((l) => l !== '')
  return lines.length > 0 ? lines.join('\n') : undefined
}

/** A `buy` cell holding exactly one coin amount → copper (the coin template's data-sort-value). */
export function coinPrice(cell: string): number | undefined {
  const coins = [...cell.matchAll(/class="coin"[^>]*data-sort-value="(\d+)"/g)]
  if (coins.length !== 1) return undefined
  const v = Number(coins[0][1])
  return Number.isInteger(v) && v > 0 ? v : undefined
}

export const LAB_DEFAULT_REASON = 'Not simulated yet: Weapon Lab behavior parameters have not been assigned to this weapon.'

export interface WeaponCandidate {
  row: CargoRow
  item: IteminfoItem
  name: string
}

export interface WeaponIdentification {
  typedRows: number
  included: WeaponCandidate[]
  excluded: { row: CargoRow; kind: GapEntry['kind']; reason: string }[]
  /** Iteminfo items with damage > 0 and a class flag (not ammo/tool/equipment) that the wiki does not type "weapon". */
  untypedIteminfoCandidates: IteminfoItem[]
}

export function identifyWeapons(rows: readonly CargoRow[], info: Iteminfo): WeaponIdentification {
  const typed = rows.filter((r) => itemTypeIncludes(r, 'weapon')).sort((a, b) => Number(str(a._rowid)) - Number(str(b._rowid)))
  const included: WeaponCandidate[] = []
  const excluded: WeaponIdentification['excluded'] = []
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
      excluded.push({
        row,
        kind: 'source-mismatch',
        reason: `Cargo row "${cargoName}" (page ${str(row._page)}) carries item ID ${id}, which Module:Iteminfo/data assigns to "${item.name ?? item.internalName}" — a different (desktop) item; the row is a platform-exclusive item`,
      })
      continue
    }
    if (seen.has(id)) {
      excluded.push({ row, kind: 'count-reconciliation', reason: `duplicate Cargo row for item ${id} ("${cargoName}", page ${str(row._page)})` })
      continue
    }
    seen.add(id)
    included.push({ row, item, name: item.name ?? cargoName })
  }
  const untypedIteminfoCandidates = [...info.items.values()]
    .filter((i) => {
      const s = i.stats as Record<string, unknown>
      const equip = ['headSlot', 'bodySlot', 'legSlot'].some((k) => s[k] !== -1) || s.accessory === true
      return (s.damage as number) > 0 && CLASS_FLAGS.some((c) => s[c] === true) && s.ammo === 0 && !s.pick && !s.axe && !s.hammer && !equip && !seen.has(i.id)
    })
    .sort((a, b) => a.id - b.id)
  return { typedRows: typed.length, included, excluded, untypedIteminfoCandidates }
}

/** AMENDMENTS-004 B19: a wiki self-conflict on a weapon field (overlays/withheld.json). */
export interface WithheldField {
  field: 'acquisition'
  detail: string
  /** The conflicting Cargo Items tag; must still be present (else the entry is stale). */
  cargoTag: string
  sources: string[]
}

export interface WeaponBuildInput {
  itemRows: readonly CargoRow[]
  itemsFetchedAt: string
  iteminfo: Iteminfo
  recipes: readonly { id: string; resultItemId: number }[]
  drops: readonly { id: string; itemId: number }[]
  categories: CategoryTree
  images: ImageInfoFetch
  gating: (itemId: number) => GatingResult
  /** Item ID → withheld field (B19); withheld values become Unknown + a source-mismatch gap. */
  withheld?: ReadonlyMap<number, WithheldField>
}

export interface WeaponBuild {
  weapons: Weapon[]
  gaps: GapEntry[]
  identification: WeaponIdentification
  sprites: SpriteManifestFile[]
  /** Why fields are Unknown / not modeled (aggregated for the gap report, not duplicated in gaps.json). */
  reasons: ReasonTally
  gatingBlockers: ReasonTally
  /** Category-derived tag slugs used (for the report). */
  tagCategories: string[]
  /** Cargo-vs-Iteminfo cross-check outcome per field (evidence for the report). */
  crossCheck: Map<string, CrossCheckCount>
  /** Weapon item ID → its wiki article (Cargo `_page`). */
  pageOf: Map<number, string>
}

export interface CrossCheckCount {
  agree: number
  mismatch: number
  /** The wiki infobox shows no comparable value. */
  noWikiValue: number
}

/** Tag categories: every category in the weapon tree except the roots and the per-class level. */
export function tagCategoriesOf(tree: CategoryTree): Map<string, string[]> {
  const classLevel = new Set(tree.roots.flatMap((r) => (r === 'Category:Weapon types' ? (tree.categories.get(r)?.subcats ?? []) : [])))
  const byPage = new Map<string, string[]>()
  for (const [title, c] of [...tree.categories].sort(([a], [b]) => a.localeCompare(b))) {
    if (tree.roots.includes(title) || classLevel.has(title)) continue
    const tag = slugify(title.replace(/^Category:/, ''))
    for (const page of c.pages) byPage.set(page, [...(byPage.get(page) ?? []), tag])
  }
  return byPage
}

export function buildWeapons(input: WeaponBuildInput): WeaponBuild {
  const { iteminfo: info } = input
  const gaps = new GapLog()
  const reasons: ReasonTally = new Map()
  const gatingBlockers: ReasonTally = new Map()
  const fetchedAt = isoDate(input.itemsFetchedAt)
  const iteminfoSrc = moduleSource('iteminfo', { title: 'Module:Iteminfo/data', rev: info.rev, fetchedAt: info.fetchedAt })
  const identification = identifyWeapons(input.itemRows, info)
  for (const ex of identification.excluded) {
    // ref = the item ID the row claims (i:0 when it has none); the detail names the row
    const claimed = Number(str(ex.row.itemid))
    gaps.add({ ref: `i:${Number.isInteger(claimed) && claimed > 0 ? claimed : 0}`, field: 'id', kind: ex.kind, detail: `Cargo Items row ${str(ex.row._rowid)} not emitted as a weapon: ${ex.reason}`, sources: [wikiPageUrl(str(ex.row._page))] })
  }
  const recipesBy = new Map<number, string[]>()
  for (const r of input.recipes) recipesBy.set(r.resultItemId, [...(recipesBy.get(r.resultItemId) ?? []), r.id])
  const dropsBy = new Map<number, string[]>()
  for (const d of input.drops) dropsBy.set(d.itemId, [...(dropsBy.get(d.itemId) ?? []), d.id])
  const tagsByPage = tagCategoriesOf(input.categories)
  const sprites: SpriteManifestFile[] = []
  const weapons: Weapon[] = []
  const crossCheck = new Map<string, CrossCheckCount>()
  const pageOf = new Map<number, string>()
  const count = (field: string, outcome: keyof CrossCheckCount) => {
    const c = crossCheck.get(field) ?? { agree: 0, mismatch: 0, noWikiValue: 0 }
    c[outcome] += 1
    crossCheck.set(field, c)
  }
  /** Compares a wiki value with the expected one; returns false (and counts) on mismatch. */
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
    const unverified: string[] = []
    let crossCheckFailed = false
    const mismatch = (field: string, detail: string, sources = [wikiUrl, iteminfoSrc.url]) => {
      unverified.push(field)
      crossCheckFailed = true
      gaps.add({ ref, field, kind: 'source-mismatch', detail: `${name}: ${detail}; value withheld (Unknown)`, sources })
    }
    const tallied = new Set<string>()
    const unknown = (field: string, why: string) => {
      unverified.push(field)
      const key = `${field.replace(/\.\d+\./g, '.N.')}: ${why}`
      if (!tallied.has(key)) tally(reasons, key, name) // once per weapon
      tallied.add(key)
    }
    const sources: ProvSource[] = [{ kind: 'cargo:Items', url: wikiUrl, fetchedAt }, iteminfoSrc]
    const w: Partial<Weapon> & { id: number } = { id }

    // class
    const flags = CLASS_FLAGS.filter((c) => s[c] === true)
    const cargoClass = str(row.damagetype).trim().toLowerCase()
    if (flags.length > 1) mismatch('damageClass', `Module:Iteminfo/data sets several class flags (${flags.join(', ')})`)
    else if (flags.length === 1 && cargoClass !== '' && cargoClass !== flags[0]) mismatch('damageClass', `Module:Iteminfo/data says ${flags[0]}, the wiki infobox says ${cargoClass}`)
    else if (flags.length === 0 && cargoClass !== '') mismatch('damageClass', `Module:Iteminfo/data sets no class flag, the wiki infobox says ${cargoClass}`)
    count('damageClass', unverified.includes('damageClass') ? 'mismatch' : cargoClass === '' ? 'noWikiValue' : 'agree')
    const damageClass: Weapon['damageClass'] = unverified.includes('damageClass') ? undefined : flags.length === 0 ? 'other' : flags[0]

    // damage + knockback
    const damage = n('damage') ?? -1
    const cargoDamage = leadingNumber(str(row.damage))
    if (damage <= 0) {
      unknown('damage', 'Module:Iteminfo/data gives the item no damage of its own (set by its projectile or ammo)')
      if (cargoDamage !== undefined) tally(reasons, 'damage: the wiki states a damage the game source does not put on the item', `${name} (wiki ${cargoDamage})`)
      unknown('knockback', 'damage is carried by the projectile/ammo, so the item knockback is not its effective knockback')
    } else {
      if (!agrees('damage', cargoDamage, damage)) mismatch('damage', `Module:Iteminfo/data damage ${damage}, wiki infobox ${cargoDamage}`)
      const kb = n('knockBack') ?? 0
      const cargoKb = leadingNumber(str(row.knockback))
      if (!agrees('knockback', cargoKb, kb)) mismatch('knockback', `Module:Iteminfo/data knockback ${kb}, wiki infobox ${cargoKb}`)
      if (!unverified.includes('damage')) w.damage = damage
      if (!unverified.includes('knockback')) w.knockback = kb
    }

    // crit (weapon bonus)
    const cargoCrit = leadingNumber(str(row.critical))
    if (damageClass === 'summon') {
      count('critPct (summon: wiki shows none)', cargoCrit === undefined ? 'agree' : 'mismatch')
      if (cargoCrit !== undefined) mismatch('critPct', `summon damage cannot crit (Critical hit page) but the wiki infobox shows ${cargoCrit}%`)
    } else if (damageClass === 'other' || damageClass === undefined) {
      unknown('critPct', damageClass === 'other' ? 'classless weapon: the wiki shows no critical chance and documents no rule' : 'damage class Unknown')
    } else {
      const crit = n('crit') ?? 0
      if (!agrees('critPct (+4% base)', cargoCrit, crit + 4)) mismatch('critPct', `Module:Iteminfo/data crit bonus ${crit} (= ${crit + 4}% shown), wiki infobox ${cargoCrit}%`)
      else w.critPct = crit
    }

    // use time / animation (TO-VERIFY #10)
    const useTime = n('useTime')
    const useAnimation = n('useAnimation')
    if (useTime !== undefined && useTime > 0) w.useTimeTicks = useTime
    else unknown('useTimeTicks', 'no positive useTime in Module:Iteminfo/data')
    const cargoUse = leadingNumber(str(row.usetime))
    if (cargoUse !== undefined && useTime !== undefined) count('useTimeTicks vs wiki "Use time"', cargoUse === useTime ? 'agree' : 'mismatch')
    if (useAnimation === undefined || useAnimation <= 0) unknown('useAnimationTicks', 'no positive useAnimation in Module:Iteminfo/data')
    else if (!agrees('useAnimationTicks (wiki "Use time")', cargoUse, useAnimation)) mismatch('useAnimationTicks', `Module:Iteminfo/data useAnimation ${useAnimation}, wiki infobox use time ${cargoUse}`)
    else w.useAnimationTicks = useAnimation

    // autoReuse
    const auto = s.autoReuse === true
    const cargoAuto = str(row.autoswing).trim()
    count('autoReuse', (cargoAuto === '1') === auto ? 'agree' : 'mismatch')
    if ((cargoAuto === '1') !== auto) mismatch('autoReuse', `Module:Iteminfo/data autoReuse ${auto}, wiki infobox auto-swing ${cargoAuto === '1' ? 'yes' : 'no'}`)
    else w.autoReuse = auto

    // mana
    const mana = n('mana') ?? 0
    const cargoMana = leadingNumber(str(row.mana))
    if (mana > 0) {
      if (!agrees('manaCost', cargoMana, mana)) mismatch('manaCost', `Module:Iteminfo/data mana ${mana}, wiki infobox ${cargoMana}`)
      else w.manaCost = mana
    } else if (cargoMana !== undefined && cargoMana > 0) mismatch('manaCost', `Module:Iteminfo/data has no mana cost, wiki infobox ${cargoMana}`)

    // ammo, shoot speed, rarity, value, stack
    const useAmmo = n('useAmmo') ?? 0
    if (useAmmo > 0) {
      const slug = ammoClassSlug(useAmmo, info)
      if (slug) w.ammoClass = slug
      else unknown('ammoClass', `useAmmo ${useAmmo} is not a named item in Module:Iteminfo/data`)
    }
    const shootSpeed = n('shootSpeed') ?? 0
    if (shootSpeed > 0) w.shootSpeedTps = Math.round(shootSpeed * 3.75 * 1e6) / 1e6
    const cargoVelocity = leadingNumber(str(row.velocity))
    if (shootSpeed > 0 && cargoVelocity !== undefined) count('shootSpeed vs wiki "Velocity" (not cross-checked: different quantity)', cargoVelocity === shootSpeed ? 'agree' : 'mismatch')
    const rarity = rarityOf(s.rare)
    const cargoRare = cargoRarity(str(row.rare))
    if (rarity === undefined) unknown('rarity', `rare ${String(s.rare)} has no Rarity encoding`)
    else if (!agrees('rarity', cargoRare, s.rare as number)) mismatch('rarity', `Module:Iteminfo/data rare ${String(s.rare)}, wiki infobox ${cargoRare}`)
    const value = n('value')
    if (s.consumable === true && (n('maxStack') ?? 0) > 0) w.maxStack = n('maxStack')

    // tags (wiki weapon-type categories of the page) + unobtainable flag
    const tags = [...new Set([...(tagsByPage.get(page) ?? []), ...(str(row.unobtainable) === '1' ? ['unobtainable'] : [])])].sort()

    // sprite
    const image = input.images.found.get(str(row.imagefile).trim())
    let sprite: string | undefined
    if (image) {
      const ext = /\.gif$/i.test(image.file) ? 'gif' : 'png'
      sprite = `/sprites/weapons/${id}.${ext}`
      sprites.push({ path: sprite, ref: `i:${id}`, wikiFileUrl: image.descriptionUrl, sha1: image.sha1, bytes: image.bytes, width: image.width, height: image.height, rights: 're-logic' })
    } else {
      gaps.add({ ref, field: 'sprite', kind: 'missing-sprite', detail: `${name}: no wiki image file resolved for "${str(row.imagefile)}"; the placeholder sprite is shown`, sources: [wikiUrl] })
    }

    // acquisition
    const acquisition: Acquisition[] = []
    const recipeIds = [...(recipesBy.get(id) ?? [])].sort()
    const dropIds = [...(dropsBy.get(id) ?? [])].sort()
    const tagList = str(row.tag).split('^').map((t) => t.trim()).filter(Boolean)
    const lower = tagList.map((t) => t.toLowerCase())
    const listcat = str(row.listcat).split('^').map((t) => t.trim().toLowerCase()).filter(Boolean)
    const withheld = input.withheld?.get(id)
    if (withheld && !tagList.includes(withheld.cargoTag)) throw new OverlayError(`[E_SCHEMA] overlay withheld/i:${id}: Cargo Items no longer carries the conflicting tag "${withheld.cargoTag}" — the conflict was resolved upstream; remove the entry`)
    const vendors = withheld ? [] : [...new Set(tagList.filter((t) => /^vendor:/i.test(t) && !/^vendor:seed:/i.test(t)).map((t) => t.slice('vendor:'.length).trim()))].sort()
    if (withheld) {
      // B19: never pick a side on conflicting wiki sources — the whole acquisition is Unknown
      mismatch('acquisition', withheld.detail, [...new Set([wikiUrl, ...withheld.sources])])
    } else {
      if (recipeIds.length > 0) acquisition.push({ method: 'craft', recipeIds })
      if (dropIds.length > 0) acquisition.push({ method: 'drop', dropIds })
    }
    const price = vendors.length === 1 ? coinPrice(str(row.buy)) : undefined
    for (const npcName of vendors) {
      const i = acquisition.length
      acquisition.push({ method: 'purchase', npcName, ...(price ? { priceCopper: price } : {}), conditions: [] })
      unknown(`acquisition.${i}.conditions`, 'shop availability conditions are not structured on the wiki')
      if (!price) unknown(`acquisition.${i}.priceCopper`, vendors.length > 1 ? 'one wiki buy price for several vendors' : 'the wiki buy price is not a single coin amount (e.g. Defender Medals)')
    }
    if (acquisition.length === 0 && !withheld) unknown('acquisition', 'no recipe, drop or named vendor on the wiki for this weapon')
    // route hints with no backing record (reported, never inferred)
    const hints: string[] = []
    // a withheld acquisition (B19) is itself the finding; route hints would restate the conflicting tag
    if (!withheld) {
      if (listcat.includes('craftable items') && recipeIds.length === 0) hints.push('listed as craftable but no desktop recipe resolves')
      if ((lower.some((t) => ['drop', 'bag loot', 'treasure bag loot', 'loot'].includes(t)) || listcat.some((c) => /(drop|loot) items$/.test(c))) && dropIds.length === 0) hints.push('tagged drop/loot but no Cargo Drops row resolves')
      if (lower.some((t) => ['vendor', 'buy', 'buyable'].includes(t)) && vendors.length === 0) hints.push('tagged as sold but no vendor NPC is named')
      if (lower.some((t) => /^vendor:seed:/.test(t))) hints.push('sold only in secret-seed worlds (not modeled)')
      if (lower.includes('fished') || listcat.includes('fished items')) hints.push('obtained by fishing (not modeled)')
      if (lower.includes('plunder') || listcat.includes('plunder items')) hints.push('plunder (not modeled)')
    }
    for (const h of hints) tally(reasons, `acquisition: ${h}`, name)
    if (hints.length > 0) gaps.add({ ref, field: 'acquisition', kind: 'missing-field', detail: `${name}: ${hints.join('; ')}`, sources: [wikiUrl] })

    // gating (§7b) — a withheld acquisition is an unverified input, so gating is Unknown too
    let gating: GatingResult = withheld ? { ok: false, blockers: ['acquisition-withheld'] } : input.gating(id)
    // own purchase routes take part in §7b too: their conditions are Unknown, so they never derive,
    // and an Unknown route could be the less gated one — a derived craft/drop gate is only exact
    // when it is already gate-free (same rule as the deriver's minimum over routes)
    if (vendors.length > 0) {
      if (!gating.ok) gating = { ok: false, blockers: [...new Set([...gating.blockers.filter((b) => b !== 'cycle'), 'vendor-conditions-unknown' as const])].sort() }
      else if (gating.gatedBy.bosses.length > 0 || gating.gatedBy.conditions.length > 0) gating = { ok: false, blockers: ['alternative-route-unverified', 'vendor-conditions-unknown'] }
    }
    if (gating.ok) {
      w.gatedBy = gating.gatedBy
      w.stage = gating.gatedBy.stage
    } else {
      unverified.push('gatedBy', 'stage')
      tally(gatingBlockers, gating.blockers.join(' + '), name)
    }

    const behaviorText = tooltipText(str(row.tooltip))
    const record: Weapon = {
      id,
      name,
      slug: slugify(name),
      type: 'weapon',
      ...(rarity !== undefined && !unverified.includes('rarity') ? { rarity } : {}),
      ...(w.stage ? { stage: w.stage } : {}),
      tags,
      wikiUrl,
      ...(sprite ? { sprite } : {}),
      ...(value !== undefined && value >= 0 ? { valueCopper: value } : {}),
      ...(w.maxStack !== undefined ? { maxStack: w.maxStack } : {}),
      ...(w.gatedBy ? { gatedBy: w.gatedBy } : {}),
      acquisition,
      ...(damageClass ? { damageClass } : {}),
      ...(w.damage !== undefined ? { damage: w.damage } : {}),
      ...(w.critPct !== undefined ? { critPct: w.critPct } : {}),
      ...(w.useTimeTicks !== undefined ? { useTimeTicks: w.useTimeTicks } : {}),
      ...(w.useAnimationTicks !== undefined ? { useAnimationTicks: w.useAnimationTicks } : {}),
      ...(w.knockback !== undefined ? { knockback: w.knockback } : {}),
      ...(w.autoReuse !== undefined ? { autoReuse: w.autoReuse } : {}),
      ...(w.manaCost !== undefined ? { manaCost: w.manaCost } : {}),
      ...(w.ammoClass !== undefined ? { ammoClass: w.ammoClass } : {}),
      ...(w.shootSpeedTps !== undefined ? { shootSpeedTps: w.shootSpeedTps } : {}),
      ...(behaviorText ? { behaviorText } : {}),
      labBehavior: limitation({ name, behaviorText, wikiUrl }, LAB_DEFAULT_REASON),
      _prov: makeProv(sources, unverified, crossCheckFailed),
    }
    weapons.push(record)
  }

  // slugs must be unique across the item ID space: later duplicates get the item ID appended
  const slugs = new Set<string>()
  for (const w of weapons) {
    if (slugs.has(w.slug)) w.slug = `${w.slug}-${w.id}`
    slugs.add(w.slug)
  }
  return {
    weapons,
    gaps: gaps.entries,
    identification,
    sprites,
    reasons,
    gatingBlockers,
    tagCategories: [...new Set([...tagsByPage.values()].flat())].sort(),
    crossCheck: new Map([...crossCheck].sort(([a], [b]) => a.localeCompare(b))),
    pageOf,
  }
}
