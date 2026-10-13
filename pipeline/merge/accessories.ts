/**
 * Cargo Items + Module:Iteminfo/data + Cargo Equipinfo + the "Wings" article + Tinkerer's Workshop
 * recipes → Accessory[] (P2-S8, DATA_SCHEMA_SPEC §2.5). Rules verified against the 2026-10-13 sync; the
 * gap report restates the evidence.
 *
 * IDENTIFICATION (merge/equipment.ts): Cargo rows typed "accessory" and not "vanity", same desktop item
 * in Module:Iteminfo/data with `accessory` true and `vanity` false. Vanity accessories (cosmetic, incl.
 * music boxes) are counted in the reconciliation and left to the item corpus (P6-S0).
 *
 * FIELDS
 * - core (equipment.ts): rarity, valueCopper, tags, sprite, acquisition, gatedBy/stage; no maxStack (B7).
 * - effects: `defense-flat` = Iteminfo `defense` (> 0; cross-checked with the infobox) + every game-text
 *   tooltip line classified by merge/effects.ts (stat / special / flavor; an unclassifiable line fails the
 *   build). Cross-checked against Cargo Equipinfo: a value disagreement withholds the effects (Unknown +
 *   source-mismatch gap); a stat only Equipinfo records (the game text gives no number) is reported as a
 *   gap and the record is unverified — it is never filled in. No game-text effect and no defense → effects
 *   Unknown (empty + listed).
 * - categories: union of the classified effects' categories (effects.ts taxonomy) — editorialFields;
 *   Unknown with the effects.
 * - combinedFrom / upgradesTo: DERIVED from Tinkerer's Workshop recipes (validate/integrity.ts
 *   deriveTinkering — the same function validate re-checks, §7a-7).
 * - wingStats (Iteminfo `wingSlot` > 0): the "Wings" article list table row whose "Internal Item ID" is
 *   the item (11 cells) — flightTimeTicks = round(seconds × 60) (the table shows seconds to 2 decimals:
 *   |60s − ticks| ≤ 0.3 is required, so the tick count is exact); hover = the horizontal speed cell has a
 *   second "hovering" line (one line = the wing cannot hover). verticalSpeedTps is Unknown: the table
 *   states a multiplier, not a speed. Cross-checks: a tooltip "Press Down to toggle hover" or a notes cell
 *   saying the wing can hover must agree with hover = true (a disagreement withholds hover).
 */
import type { Accessory, GapEntry, ProvSource, Recipe, SpriteManifestFile, StatEffect } from '../../src/schemas'
import type { Article } from '../fetch/articles'
import type { CargoRow, CargoTableFetch } from '../fetch/cargo'
import { wikiPageUrl } from '../fetch/config'
import type { ImageInfoFetch } from '../fetch/images'
import { parseWingTable, type WingRow } from '../parse/equipment'
import type { Iteminfo } from '../parse/iteminfo'
import { slugify } from '../parse/text'
import { deriveTinkering } from '../validate/integrity'
import type { WithheldField } from './acquisition'
import { tally, type ReasonTally } from './drops'
import { classifyLine, countRule, crossCheckEquipinfo, EFFECT_CATEGORIES, tooltipEffectLines, type EffectCategory, type EquipCrossCheck, type RuleUsage } from './effects'
import { accessoryRows, checkedDefense, equipmentCore, identifyAccessories, recordState, uniqueSlugs, WINGS_PAGE, type EquipmentContext, type EquipmentIdentification } from './equipment'
import type { GatingResult } from './gating'
import { GapLog, isoDate, makeProv } from './prov'
import { OverlayError } from './registry'
import type { CrossCheckCount } from './weapons'

/** Equipinfo rows live on one template page (the wiki's UpdateEquip transcription). */
export const EQUIPINFO_PAGE = 'Template:GetEquipInfo/db'

export interface AccessoryBuildInput {
  itemRows: readonly CargoRow[]
  itemsFetchedAt: string
  iteminfo: Iteminfo
  equipinfo: CargoTableFetch
  articles: ReadonlyMap<string, Article>
  images: ImageInfoFetch
  recipes: readonly Recipe[]
  drops: readonly { id: string; itemId: number }[]
  gating: (itemId: number) => GatingResult
  withheld?: ReadonlyMap<number, WithheldField>
  /** Slugs already used in the item ID space. */
  usedSlugs: ReadonlySet<string>
}

export interface AccessoryBuild {
  accessories: Accessory[]
  gaps: GapEntry[]
  identification: EquipmentIdentification
  /** Cargo rows typed accessory + vanity (not emitted; reconciliation). */
  vanityRows: CargoRow[]
  sprites: SpriteManifestFile[]
  reasons: ReasonTally
  gatingBlockers: ReasonTally
  crossCheck: Map<string, CrossCheckCount>
  /** Effect rule id → lines classified by it. */
  ruleCounts: RuleUsage
  /** Equipinfo cross-check outcome per accessory (report). */
  equip: Map<number, EquipCrossCheck>
  /** Wing rows of the Wings table, and the wing accessories without one. */
  wings: { table: WingRow[]; withoutRow: string[] }
  pageOf: Map<number, string>
  /** Equipinfo rows the wiki leaves without an item ID (shared effect code). */
  unattributedEquipinfoRows: number
}

const str = (v: CargoRow[string] | undefined) => (v === null || v === undefined ? '' : String(v))

/** Equipinfo rows by item ID (rows without an item ID are shared code the wiki does not attribute). */
export function equipinfoByItem(t: CargoTableFetch): { byId: Map<number, CargoRow>; unattributed: number } {
  const byId = new Map<number, CargoRow>()
  let unattributed = 0
  for (const r of t.rows) {
    const id = Number(str(r.itemid))
    if (str(r.itemid).trim() === '' || !Number.isInteger(id) || id <= 0) unattributed += 1
    else if (byId.has(id)) throw new OverlayError(`[E_SCHEMA] Cargo Equipinfo has two rows for item ${id}`)
    else byId.set(id, r)
  }
  return { byId, unattributed }
}

const sortCategories = (c: Iterable<EffectCategory>) => EFFECT_CATEGORIES.filter((x) => new Set(c).has(x))

export function buildAccessories(input: AccessoryBuildInput): AccessoryBuild {
  const info = input.iteminfo
  const gaps = new GapLog()
  const ctx: EquipmentContext = {
    family: 'accessories',
    noun: 'accessory',
    iteminfo: info,
    itemsFetchedAt: input.itemsFetchedAt,
    images: input.images,
    recipesBy: new Map(),
    dropsBy: new Map(),
    gating: input.gating,
    withheld: input.withheld,
    gaps,
    reasons: new Map(),
    gatingBlockers: new Map(),
    crossCheck: new Map(),
    sprites: [],
  }
  const recipesBy = ctx.recipesBy as Map<number, string[]>
  for (const r of input.recipes) recipesBy.set(r.resultItemId, [...(recipesBy.get(r.resultItemId) ?? []), r.id])
  const dropsBy = ctx.dropsBy as Map<number, string[]>
  for (const d of input.drops) dropsBy.set(d.itemId, [...(dropsBy.get(d.itemId) ?? []), d.id])

  const identification = identifyAccessories(input.itemRows, info)
  for (const ex of identification.excluded) {
    const claimed = Number(str(ex.row.itemid))
    gaps.add({ ref: `i:${Number.isInteger(claimed) && claimed > 0 ? claimed : 0}`, field: 'id', kind: ex.kind, detail: `Cargo Items row ${str(ex.row._rowid)} not emitted as an accessory: ${ex.reason}`, sources: [wikiPageUrl(str(ex.row._page))] })
  }
  const { byId: equipRows, unattributed } = equipinfoByItem(input.equipinfo)
  const equipSource: ProvSource = { kind: 'cargo:Equipinfo', url: wikiPageUrl(EQUIPINFO_PAGE), fetchedAt: isoDate(input.equipinfo.fetchedAt) }
  const wingsArticle = input.articles.get(WINGS_PAGE)
  if (!wingsArticle) throw new OverlayError(`[E_SCHEMA] the "${WINGS_PAGE}" article was not fetched by the sync plan (run npm run pipeline:fetch)`)
  const wingTable = parseWingTable(wingsArticle.html)
  const wingsUrl = wikiPageUrl(wingsArticle.resolvedTitle)
  const wingsSource: ProvSource = { kind: 'wiki-article', url: wingsUrl, rev: wingsArticle.revid, fetchedAt: isoDate(wingsArticle.fetchedAt) }
  const ids = new Set(identification.included.map((c) => c.item.id))
  const tinkering = deriveTinkering(input.recipes, (id) => ids.has(id))
  const ruleCounts: RuleUsage = new Map()
  const equip = new Map<number, EquipCrossCheck>()
  const pageOf = new Map<number, string>()
  const withoutRow: string[] = []
  const accessories: Accessory[] = []

  for (const c of [...identification.included].sort((a, b) => a.item.id - b.item.id)) {
    const id = c.item.id
    const s = recordState(ctx, c)
    pageOf.set(id, str(c.row._page))
    const core = equipmentCore(ctx, c, s)
    const st = c.item.stats as Record<string, unknown>

    // ---- effects ----
    let effects: StatEffect[] = []
    const categories = new Set<EffectCategory>()
    const defense = checkedDefense(c, s, 'effects')
    if (defense !== undefined && defense > 0) {
      effects.push({ kind: 'stat', stat: 'defense-flat', value: defense })
      categories.add('defense')
    }
    const { lines } = tooltipEffectLines(c.row)
    const textEffects: StatEffect[] = []
    for (const line of lines) {
      const r = classifyLine(line, s.wikiUrl, `accessory i:${id} (${c.name})`)
      countRule(ruleCounts, r, c.name, s.wikiUrl)
      textEffects.push(...r.effects)
      for (const cat of r.categories) categories.add(cat)
    }
    effects.push(...textEffects)
    const equipRow = equipRows.get(id)
    const xc = crossCheckEquipinfo(textEffects, equipRow)
    equip.set(id, xc)
    s.count('effects (game text vs Equipinfo)', xc.outcome === 'agree' ? 'agree' : xc.outcome === 'disagree' ? 'mismatch' : 'noWikiValue')
    if (equipRow && xc.outcome !== 'disagree') s.sources.push(equipSource)
    if (xc.outcome === 'disagree') {
      s.mismatch('effects', `the game text and Cargo Equipinfo disagree (${xc.differences.join('; ')})`, [s.wikiUrl, equipSource.url])
    } else if (xc.equipinfoOnly.length > 0) {
      s.crossCheckFailed = true
      gaps.add({ ref: s.ref, field: 'effects', kind: 'source-mismatch', detail: `${c.name}: Cargo Equipinfo also records ${xc.equipinfoOnly.join(', ')}, which the game text states no value for — not emitted (the listed effects are the game text's)`, sources: [s.wikiUrl, equipSource.url] })
      tally(ctx.reasons, 'effects: Equipinfo records a stat the game text gives no number for (gap; not emitted)', c.name)
    }
    if (s.unverified.includes('effects')) {
      // withheld (Equipinfo disagreement or defense mismatch): the whole list is Unknown, categories with it
      effects = []
      categories.clear()
      if (!s.unverified.includes('categories')) s.unverified.push('categories')
    } else if (effects.length === 0) {
      s.unknown('effects', lines.length === 0 ? 'the wiki transcribes no game text (tooltip) for this accessory and it has no defense' : 'the game text holds flavor text only')
      s.unknown('categories', 'derived from the effects, which are Unknown')
    }

    // ---- wings ----
    let wingStats: Accessory['wingStats']
    if (typeof st.wingSlot === 'number' && st.wingSlot > 0) {
      const rows = wingTable.filter((w) => w.itemIds.includes(id))
      if (rows.length !== 1) {
        s.unknown('wingStats', rows.length === 0 ? 'no row for this wing in the Wings article list table' : 'several Wings table rows name this item')
        withoutRow.push(`${c.name} (${id})`)
      } else {
        const w = rows[0]
        wingStats = {}
        const m = /^(\d+(?:\.\d+)?)\s*s$/.exec(w.flightTime)
        const ticks = m ? Math.round(Number(m[1]) * 60) : undefined
        if (m && ticks !== undefined && ticks > 0 && Math.abs(Number(m[1]) * 60 - ticks) <= 0.3) wingStats.flightTimeTicks = ticks
        else s.unknown('wingStats.flightTimeTicks', `the Wings table flight time "${w.flightTime}" is not a plain seconds value`)
        s.unknown('wingStats.verticalSpeedTps', 'the Wings table states a vertical speed multiplier, not a speed')
        const speeds = w.horizontalSpeed
        const hover = w.cells !== 11 ? undefined : speeds.length === 1 && /mph$/.test(speeds[0]) ? false : speeds.length === 2 && speeds.every((x) => /mph$/.test(x)) ? true : undefined
        const statedHover = lines.some((l) => /toggle hover/.test(l)) || /\bhover\b/i.test(w.notes)
        s.count('wingStats.hover (tooltip / table notes say it can hover ⇒ a hovering speed line)', statedHover ? (hover === true ? 'agree' : 'mismatch') : 'noWikiValue')
        if (hover === undefined) s.unknown('wingStats.hover', `the Wings table horizontal speed cell "${speeds.join(' / ')}" is not one (normal) or two (normal / hovering) speeds`)
        else if (statedHover && !hover) s.mismatch('wingStats.hover', 'the tooltip or the Wings table notes say the wing can hover, but the table lists no hovering speed', [s.wikiUrl, wingsUrl])
        else wingStats.hover = hover
        s.sources.push(wingsSource)
      }
    }

    const record: Accessory = {
      id,
      name: c.name,
      slug: slugify(c.name),
      type: 'accessory',
      ...(core.rarity !== undefined ? { rarity: core.rarity } : {}),
      ...(core.stage ? { stage: core.stage } : {}),
      tags: core.tags,
      wikiUrl: s.wikiUrl,
      ...(core.sprite ? { sprite: core.sprite } : {}),
      ...(core.valueCopper !== undefined ? { valueCopper: core.valueCopper } : {}),
      ...(core.gatedBy ? { gatedBy: core.gatedBy } : {}),
      acquisition: core.acquisition,
      categories: s.unverified.includes('categories') ? [] : sortCategories(categories),
      effects,
      combinedFrom: [...(tinkering.combinedFrom.get(id)?.keys() ?? [])].sort((a, b) => a - b),
      upgradesTo: [...(tinkering.upgradesTo.get(id)?.keys() ?? [])].sort((a, b) => a - b),
      ...(wingStats ? { wingStats } : {}),
      _prov: { ...makeProv(s.sources, s.unverified, s.crossCheckFailed), editorialFields: s.unverified.includes('categories') ? [] : ['categories'] },
    }
    accessories.push(record)
  }
  uniqueSlugs(accessories, input.usedSlugs)
  return {
    accessories,
    gaps: gaps.entries,
    identification,
    vanityRows: accessoryRows(input.itemRows).vanity,
    sprites: ctx.sprites,
    reasons: ctx.reasons,
    gatingBlockers: ctx.gatingBlockers,
    crossCheck: new Map([...ctx.crossCheck].sort(([a], [b]) => a.localeCompare(b))),
    ruleCounts,
    equip,
    wings: { table: wingTable, withoutRow },
    pageOf,
    unattributedEquipinfoRows: unattributed,
  }
}
