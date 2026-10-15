/**
 * Cargo Items + Module:Iteminfo/data + Cargo Equipinfo + the armor set articles (+ overlays/armor-sets.json
 * residuals) → ArmorPiece[] + ArmorSet[] (P2-S8, DATA_SCHEMA_SPEC §2.5). Derivation first; the overlay only
 * settles what the data cannot (AMENDMENTS-001 A3 principle). Rules verified against the 2026-10-13 sync.
 *
 * PIECES (merge/equipment.ts identification: Cargo rows typed "armor" (not the set row), same desktop
 * item in Module:Iteminfo/data, exactly one head/body/leg slot agreeing with the Cargo body slot, not
 * vanity). slot = that slot; defense = Iteminfo `defense` cross-checked with the infobox (a 0 defense has
 * no infobox row); effects = the per-piece game-text tooltip lines classified by merge/effects.ts and
 * cross-checked against Cargo Equipinfo (a value disagreement withholds them: Unknown + gap). An empty
 * list means "no per-piece effect" only when both sources agree (no game text AND no Equipinfo row);
 * no game text but an Equipinfo row = effects Unknown (empty + listed). Core fields as for accessories
 * (equipment.ts).
 *
 * SETS. A set is the set row of a set article (Cargo type "armor" + "set"); its pieces are the armor
 * pieces whose `_page` is that article: 1..N helmets, 1..N chests and exactly one legs piece. The set
 * infobox (parse/equipment.ts) "Set Bonus" row gives the game text per helmet: a piece-specific segment
 * ("<Hallowed Hood icon>: …") is that helmet's complete bonus; the default segment(s) apply to every
 * other helmet. Each line is classified by effects.ts (the set article is the special's sourceUrl);
 * setBonusText = the lines joined by newlines.
 * P6 fix round (additive schema, `pieces.chests` / optional `pieces.legs` / `variants[].chestId`):
 * - several chests on the article need a reviewed overlay `chests` ruling quoting each chest; when the
 *   Set Bonus segments name those chests (Beetle armor: Scale Mail → offensive, Shell → defensive) the
 *   bonus is keyed by the chest — one variant per helmet × chest, each with its `chestId`;
 * - a combination set whose pieces live on their own articles (Wizard set) takes its members from the
 *   overlay's `combination` ruling, checked row for row against the article's set-pieces table, and has
 *   no legs piece (quoted: any legs keep the bonus).
 * A set the schema still cannot express (Rain armor: no Set Bonus row) needs an overlay `withhold`
 * entry with a verbatim quote: the set is not emitted, a gap records why, and its pieces' setId is
 * listed Unknown (not "none"). Unreviewed → the build fails. The overlay's `unrecorded` pieces (tied by
 * the wiki to more than one set — Ultrabright Helmet) likewise carry an Unknown setId.
 *
 * VARIANT CLASS (editorial — a site taxonomy): the damage-class signals of the variant's stat effects —
 * helmet + chest + legs + its set bonus: a class scope (damage / crit), minion / sentry slots and whip
 * range → summon, max mana / mana cost → magic, melee speed → melee. One class → that class; none →
 * "other" (classless); several (hybrid sets) → an overlay `classes` ruling backed by a quote (a ruling
 * where the signals already decide fails as stale).
 * VARIANT CLASSES (AMENDMENTS-011 B52, landed by the B70 P4-prep slice; `class` is kept one release):
 * [class] for a single-class or classless variant; for a hybrid ruling the overlay's `classes` list —
 * the classes the quoted article description names ("melee/summoner" → melee, summon; "mage" → magic),
 * which must also EQUAL the variant's stat class signals (quote and data agree, else the build fails).
 * A hybrid ruling without a list (Crystal Assassin: the article names no class) stays ["other"].
 *
 * Set stage = the earliest stage a complete set can be assembled: min over helmet × chest of max(helmet,
 * chest, legs) stage — only when every piece's stage is derived (else Unknown). The set infobox "Defense"
 * totals (per helmet, per chest or one total) are cross-checked against the sum of the piece defenses (report).
 */
import { STAGE_ORDER, type ArmorPiece, type ArmorSet, type DamageClass, type GapEntry, type ProvSource, type Recipe, type SpriteManifestFile, type Stage, type StatEffect } from '../../src/schemas'
import type { Article } from '../fetch/articles'
import type { CargoRow, CargoTableFetch } from '../fetch/cargo'
import { wikiPageUrl } from '../fetch/config'
import type { ImageInfoFetch } from '../fetch/images'
import { parseSetInfoboxes, parseSetPiecesTable, type SetBonusSegment, type SetPieceRow } from '../parse/equipment'
import type { Iteminfo } from '../parse/iteminfo'
import { slugify } from '../parse/text'
import { EQUIPINFO_PAGE, equipinfoByItem } from './accessories'
import type { RouteSources, WithheldField } from './acquisition'
import { tally, type ReasonTally } from './drops'
import { classifyLine, countRule, crossCheckEquipinfo, normalizeEffectLines, tooltipEffectLines, type EquipCrossCheck, type RuleUsage } from './effects'
import { armorSetPages, armorSetRows, checkedDefense, equipmentCore, identifyArmor, iteminfoArmorSlot, recordState, uniqueSlugs, type EquipmentContext, type EquipmentIdentification } from './equipment'
import { Evidence } from './evidence'
import type { GatingResult } from './gating'
import type { ArmorSetEntry, ArmorSetsOverlay } from './overlays'
import { GapLog, isoDate, makeProv } from './prov'
import { OverlayError } from './registry'
import type { CrossCheckCount } from './weapons'

const str = (v: CargoRow[string] | undefined) => (v === null || v === undefined ? '' : String(v))

export interface ArmorBuildInput {
  itemRows: readonly CargoRow[]
  itemsFetchedAt: string
  iteminfo: Iteminfo
  equipinfo: CargoTableFetch
  articles: ReadonlyMap<string, Article>
  evidence: Evidence
  overlay: ArmorSetsOverlay
  images: ImageInfoFetch
  recipes: readonly Recipe[]
  drops: readonly { id: string; itemId: number }[]
  gating: (itemId: number) => GatingResult
  withheld?: ReadonlyMap<number, WithheldField>
  /** B68/B78 acquisition sources (vendor model + gatherables). */
  sources?: RouteSources
  usedSlugs: ReadonlySet<string>
}

export interface SetReportRow {
  page: string
  id: string
  outcome: 'emitted' | 'withheld'
  detail: string
}

export interface ArmorBuild {
  pieces: ArmorPiece[]
  sets: ArmorSet[]
  gaps: GapEntry[]
  identification: EquipmentIdentification
  sprites: SpriteManifestFile[]
  reasons: ReasonTally
  gatingBlockers: ReasonTally
  crossCheck: Map<string, CrossCheckCount>
  ruleCounts: RuleUsage
  equip: Map<number, EquipCrossCheck>
  setReport: SetReportRow[]
  /** Set row count (Cargo type armor + set) and distinct set articles. */
  setRows: number
  setPages: number
  pageOf: Map<number, string>
}

/** Damage-class signals of a list of effects (see header). */
export function classSignals(effects: readonly StatEffect[]): Set<Exclude<DamageClass, 'other'>> {
  const out = new Set<Exclude<DamageClass, 'other'>>()
  for (const e of effects) {
    if (e.kind !== 'stat') continue
    if ((e.stat === 'damage-pct' || e.stat === 'crit-pct') && e.scope && e.scope !== 'other') out.add(e.scope)
    else if (e.stat === 'minion-slots' || e.stat === 'sentry-slots' || e.stat === 'whip-range-pct') out.add('summon')
    else if (e.stat === 'max-mana-flat' || e.stat === 'mana-cost-pct') out.add('magic')
    else if (e.stat === 'melee-speed-pct') out.add('melee')
  }
  return out
}

/**
 * Which bonus lines apply to each key piece — the helmets, or the chests of a set whose Set Bonus segments are keyed
 * by its alternative chests (Beetle armor); or why the set's bonus cannot be expressed.
 */
export function bonusPerPiece(segments: readonly SetBonusSegment[], keys: readonly string[], noun: 'helmet' | 'chest piece' = 'helmet'): { ok: true; byHelmet: Map<string, string[]> } | { ok: false; reason: string } {
  const defaults = segments.filter((s) => s.pieces.length === 0).flatMap((s) => s.lines)
  const specific = new Map<string, string[]>()
  for (const s of segments.filter((x) => x.pieces.length > 0)) {
    for (const p of s.pieces) {
      if (!keys.includes(p)) return { ok: false, reason: `the Set Bonus row has a segment for "${p}", which is not a ${noun} of the set` }
      specific.set(p, [...(specific.get(p) ?? []), ...s.lines])
    }
  }
  const byHelmet = new Map<string, string[]>()
  for (const h of keys) {
    const lines = specific.get(h) ?? defaults
    if (lines.length === 0) return { ok: false, reason: `no Set Bonus text applies to the ${noun} "${h}"` }
    byHelmet.set(h, lines)
  }
  return { ok: true, byHelmet }
}

/** Which bonus lines apply to each helmet (the usual keying). */
export const bonusPerHelmet = (segments: readonly SetBonusSegment[], helmets: readonly string[]) => bonusPerPiece(segments, helmets, 'helmet')

/** The set-pieces table's "Body slot" words → ArmorPiece slots (P6 fix round, combination sets). */
const TABLE_SLOT: Readonly<Record<string, ArmorPiece['slot']>> = { Helmet: 'head', Shirt: 'chest', Pants: 'legs' }

const stageMax = (a: Stage, b: Stage): Stage => (STAGE_ORDER[a] >= STAGE_ORDER[b] ? a : b)

/** How an article names each damage class in a hybrid description ("mage/summoner armor set"). */
const CLASS_WORD: Record<Exclude<DamageClass, 'other'>, RegExp> = { melee: /\bmelee\b/i, ranged: /\branged\b/i, magic: /\b(?:mage|magic)\b/i, summon: /\bsummon(?:er)?\b/i }

export function buildArmor(input: ArmorBuildInput): ArmorBuild {
  const info = input.iteminfo
  const gaps = new GapLog()
  const ctx: EquipmentContext = {
    family: 'armor',
    noun: 'armor piece',
    iteminfo: info,
    itemsFetchedAt: input.itemsFetchedAt,
    images: input.images,
    recipesBy: new Map(),
    dropsBy: new Map(),
    gating: input.gating,
    withheld: input.withheld,
    ...(input.sources ? { sources: input.sources } : {}),
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

  const identification = identifyArmor(input.itemRows, info)
  for (const ex of identification.excluded) {
    const claimed = Number(str(ex.row.itemid))
    gaps.add({ ref: `i:${Number.isInteger(claimed) && claimed > 0 ? claimed : 0}`, field: 'id', kind: ex.kind, detail: `Cargo Items row ${str(ex.row._rowid)} not emitted as an armor piece: ${ex.reason}`, sources: [wikiPageUrl(str(ex.row._page))] })
  }
  const { byId: equipRows } = equipinfoByItem(input.equipinfo)
  const equipSource: ProvSource = { kind: 'cargo:Equipinfo', url: wikiPageUrl(EQUIPINFO_PAGE), fetchedAt: isoDate(input.equipinfo.fetchedAt) }
  const ruleCounts: RuleUsage = new Map()
  const equip = new Map<number, EquipCrossCheck>()
  const pageOf = new Map<number, string>()
  const pieces: ArmorPiece[] = []

  // ---------------- pieces ----------------
  for (const c of [...identification.included].sort((a, b) => a.item.id - b.item.id)) {
    const id = c.item.id
    const s = recordState(ctx, c)
    pageOf.set(id, str(c.row._page))
    const core = equipmentCore(ctx, c, s)
    const defense = checkedDefense(c, s)
    const effects: StatEffect[] = []
    const { lines } = tooltipEffectLines(c.row)
    for (const line of lines) {
      const r = classifyLine(line, s.wikiUrl, `armor i:${id} (${c.name})`)
      countRule(ruleCounts, r, c.name, s.wikiUrl)
      effects.push(...r.effects)
    }
    const row = equipRows.get(id)
    const xc = crossCheckEquipinfo(effects, row)
    equip.set(id, xc)
    s.count('effects (game text vs Equipinfo)', xc.outcome === 'agree' ? 'agree' : xc.outcome === 'disagree' ? 'mismatch' : 'noWikiValue')
    if (row && xc.outcome !== 'disagree') s.sources.push(equipSource)
    if (xc.outcome === 'disagree') {
      s.mismatch('effects', `the game text and Cargo Equipinfo disagree (${xc.differences.join('; ')})`, [s.wikiUrl, equipSource.url])
      effects.length = 0
    } else {
      if (xc.equipinfoOnly.length > 0) {
        s.crossCheckFailed = true
        gaps.add({ ref: s.ref, field: 'effects', kind: 'source-mismatch', detail: `${c.name}: Cargo Equipinfo also records ${xc.equipinfoOnly.join(', ')}, which the game text states no value for — not emitted (the listed effects are the game text's)`, sources: [s.wikiUrl, equipSource.url] })
        tally(ctx.reasons, 'effects: Equipinfo records a stat the game text gives no number for (gap; not emitted)', c.name)
      }
      // "no per-piece effect" needs both sources to agree: no game text AND no Equipinfo row
      if (lines.length === 0 && row) s.unknown('effects', 'the wiki transcribes no game text (tooltip) for this piece, but Cargo Equipinfo has an effect row for it')
    }
    const slot = iteminfoArmorSlot(c.item) as ArmorPiece['slot']
    pieces.push({
      id,
      name: c.name,
      slug: slugify(c.name),
      type: 'armor',
      ...(core.rarity !== undefined ? { rarity: core.rarity } : {}),
      ...(core.stage ? { stage: core.stage } : {}),
      tags: core.tags,
      wikiUrl: s.wikiUrl,
      ...(core.sprite ? { sprite: core.sprite } : {}),
      ...(core.valueCopper !== undefined ? { valueCopper: core.valueCopper } : {}),
      ...(core.gatedBy ? { gatedBy: core.gatedBy } : {}),
      acquisition: core.acquisition,
      slot,
      ...(defense !== undefined ? { defense } : {}),
      effects,
      _prov: makeProv(s.sources, s.unverified, s.crossCheckFailed),
    })
  }
  uniqueSlugs(pieces, input.usedSlugs)

  // ---------------- sets ----------------
  const byId = new Map(pieces.map((p) => [p.id, p]))
  const piecesByPage = new Map<string, ArmorPiece[]>()
  for (const p of pieces) piecesByPage.set(pageOf.get(p.id) ?? '', [...(piecesByPage.get(pageOf.get(p.id) ?? '') ?? []), p])
  const overlayByPage = new Map(input.overlay.entries.map((e) => [e.page, e]))
  const usedOverlay = new Set<string>()
  const sets: ArmorSet[] = []
  const setReport: SetReportRow[] = []
  const setCheck = (outcome: keyof CrossCheckCount) => {
    const cc = ctx.crossCheck.get('set Defense total (infobox vs Σ piece defense)') ?? { agree: 0, mismatch: 0, noWikiValue: 0 }
    cc[outcome] += 1
    ctx.crossCheck.set('set Defense total (infobox vs Σ piece defense)', cc)
  }
  const withheld = new Map<string, { reason: string; url: string }>()
  // A combination set's members (P6 fix round — the Wizard set): the overlay's reviewed names, checked against the set
  // article's own set-pieces table (name, item ID, body slot) and the emitted pieces; the quotes back the rule.
  const combinationMembers = (page: string, c: NonNullable<ArmorSetEntry['combination']>): ArmorPiece[] => {
    const where = `overlay armor-sets/${page} combination`
    for (const q of [...c.quotes, c.legs.quote]) input.evidence.quote(page, q, where)
    for (const h of c.helmets) if (!c.quotes.some((q) => q.includes(h))) throw new OverlayError(`[E_SCHEMA] ${where}: no quote names the helmet "${h}"`)
    if ((piecesByPage.get(page) ?? []).length > 0) throw new OverlayError(`[E_SCHEMA] ${where}: the article also hosts armor pieces — not a combination set`)
    const table = parseSetPiecesTable((input.articles.get(page) as Article).html)
    if (!table) throw new OverlayError(`[E_SCHEMA] ${where}: the article has no set-pieces table to check the members against`)
    const named = new Map<string, ArmorPiece['slot']>([...c.helmets.map((n) => [n, 'head'] as const), ...c.chests.map((n) => [n, 'chest'] as const)])
    const rows = new Map(table.map((r) => [r.name, r]))
    const listed = [...named.keys()].sort()
    const tabled = [...rows.keys()].sort()
    if (listed.join('|') !== tabled.join('|')) throw new OverlayError(`[E_SCHEMA] ${where}: the members (${listed.join(', ')}) differ from the article's set-pieces table (${tabled.join(', ')})`)
    return [...named].map(([n, slot]) => {
      const row = rows.get(n) as SetPieceRow
      const matches = pieces.filter((p) => p.name === n)
      if (matches.length !== 1) throw new OverlayError(`[E_SCHEMA] ${where}: ${matches.length} emitted armor pieces are named "${n}" (needs exactly one)`)
      const piece = matches[0]
      if (piece.id !== row.itemId) throw new OverlayError(`[E_SCHEMA] ${where}: "${n}" is item ${row.itemId} in the set-pieces table but item ${piece.id} in the data`)
      if (TABLE_SLOT[row.bodySlot] !== slot || piece.slot !== slot) throw new OverlayError(`[E_SCHEMA] ${where}: "${n}" is listed as a ${slot} piece, the table says "${row.bodySlot}", the data ${piece.slot}`)
      return piece
    })
  }
  // one set per set ARTICLE (the Wizard set article carries eight set rows, one per hat/robe combination)
  const setRows = armorSetRows(input.itemRows)
  for (const page of armorSetPages(input.itemRows)) {
    const name = page
    const id = slugify(page)
    const ref = `set:${id}`
    const article = input.articles.get(page)
    if (!article) throw new OverlayError(`[E_SCHEMA] armor set "${page}": article not fetched by the sync plan (run npm run pipeline:fetch)`)
    const url = wikiPageUrl(article.resolvedTitle)
    const box = parseSetInfoboxes(article.html)[0]
    const entry = overlayByPage.get(page)
    if (entry) usedOverlay.add(page)
    // members: the pieces the set article hosts — or, for a combination set, the pieces its own set-pieces table names
    const members = (entry?.combination ? combinationMembers(page, entry.combination) : (piecesByPage.get(page) ?? [])).slice().sort((a, b) => a.id - b.id)
    const helmets = members.filter((p) => p.slot === 'head')
    const chests = members.filter((p) => p.slot === 'chest')
    const legs = members.filter((p) => p.slot === 'legs')
    const legsAny = entry?.combination !== undefined

    // what the schema cannot express
    const problems: string[] = []
    if (!box) problems.push('the article has no set infobox')
    else if (!box.bonus) problems.push('the set infobox has no Set Bonus row')
    if (helmets.length === 0 || chests.length === 0 || legs.length !== (legsAny ? 0 : 1)) {
      problems.push(`the set has ${helmets.length} helmet(s), ${chests.length} chest piece(s) and ${legs.length} legs piece(s) — an ArmorSet needs ≥1 helmet, ≥1 chest and exactly one legs piece (none for a combination set ruled "any legs")`)
    }
    // the Set Bonus segments decide the keying: by helmet (the usual), or by chest when they name the set's alternative chests
    const chestKeyed = chests.length > 1 && (box?.bonus ?? []).some((s) => s.pieces.some((p) => chests.some((c) => c.name === p)))
    const perPiece = box?.bonus ? (chestKeyed ? bonusPerPiece(box.bonus, chests.map((c) => c.name), 'chest piece') : bonusPerHelmet(box.bonus, helmets.map((h) => h.name))) : undefined
    if (perPiece && !perPiece.ok && problems.length === 0) problems.push(perPiece.reason)
    if (problems.length > 0 || entry?.withhold) {
      if (!entry?.withhold) throw new OverlayError(`[E_SCHEMA] armor set "${page}" cannot be expressed as an ArmorSet (${problems.join('; ') || '—'}) — review it and add a withhold entry with a verbatim quote to pipeline/overlays/armor-sets.json`)
      if (problems.length === 0) throw new OverlayError(`[E_SCHEMA] overlay armor-sets/${page}: withhold entry, but the set is expressible — remove the stale entry`)
      const p = input.evidence.quote(page, entry.withhold.quote, `overlay armor-sets/${page} withhold`)
      gaps.add({ ref, kind: 'count-reconciliation', detail: `${name} not emitted as an armor set: ${entry.withhold.reason} (${problems.join('; ')}); its pieces carry no setId (listed Unknown)`, sources: [p.url] })
      setReport.push({ page, id, outcome: 'withheld', detail: `${entry.withhold.reason} — ${problems.join('; ')}` })
      withheld.set(page, { reason: entry.withhold.reason, url: p.url })
      continue
    }
    // several alternative chests: a reviewed, quoted ruling that any one of them completes the set (each chest named)
    if (chests.length > 1 && !entry?.combination) {
      if (!entry?.chests) throw new OverlayError(`[E_SCHEMA] armor set "${page}" hosts ${chests.length} chest pieces (${chests.map((c) => c.name).join(', ')}) — review it and add a chests ruling with verbatim quotes to pipeline/overlays/armor-sets.json`)
      for (const q of entry.chests.quotes) input.evidence.quote(page, q, `overlay armor-sets/${page} chests`)
      for (const c of chests) if (!entry.chests.quotes.some((q) => q.includes(c.name))) throw new OverlayError(`[E_SCHEMA] overlay armor-sets/${page} chests: no quote names the chest "${c.name}"`)
    } else if (entry?.chests) throw new OverlayError(`[E_SCHEMA] overlay armor-sets/${page}: chests ruling, but the set has one chest — remove the stale entry`)
    const byKey = (perPiece as { ok: true; byHelmet: Map<string, string[]> }).byHelmet
    const sources: ProvSource[] = [{ kind: 'cargo:Items', url: wikiPageUrl(page), fetchedAt: isoDate(input.itemsFetchedAt) }, { kind: 'wiki-article', url, rev: article.revid, fetchedAt: isoDate(article.fetchedAt) }]
    const rulings = new Map((entry?.classes ?? []).map((r) => [r.helmet, r]))
    for (const h of rulings.keys()) if (!helmets.some((x) => x.name === h)) throw new OverlayError(`[E_SCHEMA] overlay armor-sets/${page}: class ruling for "${h}", which is not a helmet of the set`)
    const classNotes: string[] = []
    // one variant per helmet — per helmet × chest when the bonus is keyed by the chest
    const variants: ArmorSet['variants'] = helmets.flatMap((h) => (chestKeyed ? chests : [undefined]).map((keyChest) => {
      const label = keyChest ? `${h.name} + ${keyChest.name}` : h.name
      const { lines } = normalizeEffectLines(byKey.get(keyChest ? keyChest.name : h.name) as string[])
      const setBonus: StatEffect[] = []
      for (const line of lines) {
        const r = classifyLine(line, url, `armor set ${page} (${label})`)
        countRule(ruleCounts, r, `${name} set bonus (${label})`, url)
        setBonus.push(...r.effects)
      }
      if (setBonus.length === 0) throw new OverlayError(`[E_SCHEMA] armor set "${page}" (${label}): the Set Bonus text holds no effect line`)
      // the class signals of everything the variant can be worn with: its helmet, its chest(s), the legs, its bonus
      const signals = classSignals([...h.effects, ...(keyChest ? [keyChest] : chests).flatMap((c) => c.effects), ...legs.flatMap((l) => l.effects), ...setBonus])
      const ruling = rulings.get(h.name)
      let cls: DamageClass
      let classes: DamageClass[]
      if (signals.size > 1) {
        if (!ruling) throw new OverlayError(`[E_SCHEMA] armor set "${page}" (${h.name}): the variant's effects name several classes (${[...signals].sort().join(', ')}) — add a class ruling with a verbatim quote to pipeline/overlays/armor-sets.json`)
        const where = `overlay armor-sets/${page} classes ${h.name}`
        input.evidence.quote(page, ruling.quote, where)
        cls = ruling.class
        classes = [cls]
        if (ruling.classes) {
          // B52: the quoted hybrid description must name every listed class, and the list must equal the stat signals
          const listed = [...new Set(ruling.classes)].sort()
          for (const c of listed) if (!CLASS_WORD[c].test(ruling.quote)) throw new OverlayError(`[E_SCHEMA] ${where}: the quote "${ruling.quote}" does not name the class "${c}"`)
          if (listed.join(',') !== [...signals].sort().join(',')) throw new OverlayError(`[E_SCHEMA] ${where}: hybrid classes ${listed.join(' + ')} differ from the variant's stat class signals ${[...signals].sort().join(' + ')}`)
          if (cls !== 'other') throw new OverlayError(`[E_SCHEMA] ${where}: a hybrid variant's single class must be "other" (B52 keeps it beside classes)`)
          classes = listed
        }
        classNotes.push(`${label}: ${cls} → classes ${classes.join(' + ')} (ruling; signals ${[...signals].sort().join(' + ')})`)
      } else {
        if (ruling) throw new OverlayError(`[E_SCHEMA] overlay armor-sets/${page}: class ruling for "${h.name}" is stale — the effects already decide (${[...signals].join(', ') || 'none → other'})`)
        cls = signals.size === 1 ? [...signals][0] : 'other'
        classes = [cls]
        classNotes.push(`${label}: ${cls} (${signals.size === 1 ? 'derived' : 'no class signal → other'})`)
      }
      return { helmetId: h.id, ...(keyChest ? { chestId: keyChest.id } : {}), class: cls, classes, setBonus, setBonusText: lines.join('\n') }
    }))
    if (entry) sources.push(Evidence.source('armor-sets', input.evidence.page(page, `overlay armor-sets/${page}`)))

    // Defense totals: infobox (per helmet, per chest or one total) vs Σ pieces, per wearable combination (report
    // evidence; the piece values are already cross-checked). A combination set's article states none.
    for (const h of helmets) {
      for (const c of chests) {
        const total = box?.defense.get(h.name) ?? box?.defense.get(c.name) ?? box?.defense.get('')
        const worn = [h, c, ...legs]
        const sum = worn.every((p) => p.defense !== undefined) ? worn.reduce((n, p) => n + (p.defense as number), 0) : undefined
        if (total === undefined || sum === undefined) setCheck('noWikiValue')
        else if (total === sum) setCheck('agree')
        else {
          setCheck('mismatch')
          gaps.add({ ref, field: 'pieces', kind: 'source-mismatch', detail: `${name} (${chests.length > 1 ? `${h.name} + ${c.name}` : h.name}): the set infobox Defense total ${total} differs from the sum of the piece defenses ${sum} (Module:Iteminfo/data, cross-checked per piece)`, sources: [url] })
        }
      }
    }

    // stage: earliest complete set — min over the wearable combinations of their latest piece (only when every piece is derived)
    const unverified: string[] = []
    let stage: Stage | undefined
    if (members.every((p) => p.stage)) {
      const latest = (worn: readonly ArmorPiece[]) => worn.map((p) => p.stage as Stage).reduce(stageMax)
      stage = helmets.flatMap((h) => chests.map((c) => latest([h, c, ...legs]))).reduce((a, b) => (STAGE_ORDER[a] <= STAGE_ORDER[b] ? a : b))
    } else unverified.push('stage')
    const prov = makeProv(sources, unverified)
    prov.editorialFields = variants.flatMap((_, i) => [`variants.${i}.class`, `variants.${i}.classes`])
    sets.push({
      id,
      name,
      pieces: { helmets: helmets.map((h) => h.id), chest: chests[0].id, ...(chests.length > 1 ? { chests: chests.map((c) => c.id) } : {}), ...(legs.length > 0 ? { legs: legs[0].id } : {}) },
      variants,
      ...(stage ? { stage } : {}),
      wikiUrl: url,
      _prov: prov,
    })
    for (const p of members) {
      const piece = byId.get(p.id) as ArmorPiece
      if (piece.setId !== undefined) throw new OverlayError(`[E_SCHEMA] armor set "${page}": ${piece.name} is already in the set "${piece.setId}" — a piece belongs to one set`)
      piece.setId = id
    }
    const shape = [chestKeyed ? 'bonus keyed by the chest' : '', chests.length > 1 ? `${chests.length} alternative chests` : '', legsAny ? 'no legs piece (any legs, quoted)' : ''].filter(Boolean)
    setReport.push({ page, id, outcome: 'emitted', detail: `${classNotes.join('; ')}${shape.length > 0 ? ` — ${shape.join('; ')}` : ''}` })
  }
  for (const page of overlayByPage.keys()) if (!usedOverlay.has(page)) throw new OverlayError(`[E_SCHEMA] overlay armor-sets/${page}: no armor set row has this article — remove the stale entry`)

  // Set membership the dataset cannot record is Unknown (listed), never "none": the pieces of a withheld set article,
  // and the overlay's reviewed `unrecorded` pieces (a piece the wiki ties to more than one set).
  const unknownSet = (piece: ArmorPiece, detail: string, sources: string[]) => {
    piece._prov = { ...piece._prov, verified: false, unverifiedFields: [...new Set([...piece._prov.unverifiedFields, 'setId'])].sort() }
    gaps.add({ ref: `i:${piece.id}`, field: 'setId', kind: 'missing-field', detail, sources })
  }
  for (const [page, w] of withheld) {
    for (const p of piecesByPage.get(page) ?? []) unknownSet(p, `${p.name}: the wiki hosts it in ${page}, which is not emitted as an armor set (${w.reason}) — its set is Unknown here, not "none"`, [w.url])
  }
  for (const u of input.overlay.unrecorded) {
    const where = `overlay armor-sets unrecorded "${u.piece}"`
    const matches = pieces.filter((p) => p.name === u.piece)
    if (matches.length !== 1) throw new OverlayError(`[E_SCHEMA] ${where}: ${matches.length} armor pieces have this name (needs exactly one)`)
    const piece = matches[0]
    if (piece.setId !== undefined) throw new OverlayError(`[E_SCHEMA] ${where}: the piece is in the set "${piece.setId}" — remove the stale entry`)
    const urls = u.evidence.map((e) => {
      if (!e.quote.includes(u.piece)) throw new OverlayError(`[E_SCHEMA] ${where}: the quote "${e.quote}" does not name the piece`)
      return input.evidence.quote(e.page, e.quote, where).url
    })
    unknownSet(piece, `${piece.name}: ${u.reason} — its set is Unknown here, not "none"`, [...new Set(urls)])
  }
  // setId sits after effects in the emitted key order
  const ordered = pieces.map((p) => {
    const { setId, _prov, ...rest } = p
    return { ...rest, ...(setId ? { setId } : {}), _prov } as ArmorPiece
  })
  return {
    pieces: ordered,
    sets,
    gaps: gaps.entries,
    identification,
    sprites: ctx.sprites,
    reasons: ctx.reasons,
    gatingBlockers: ctx.gatingBlockers,
    crossCheck: new Map([...ctx.crossCheck].sort(([a], [b]) => a.localeCompare(b))),
    ruleCounts,
    equip,
    setReport,
    setRows: setRows.length,
    setPages: armorSetPages(input.itemRows).length,
    pageOf,
  }
}
