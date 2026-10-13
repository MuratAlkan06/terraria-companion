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
 * pieces whose `_page` is that article: 1..N helmets, exactly one chest and one legs piece. The set
 * infobox (parse/equipment.ts) "Set Bonus" row gives the game text per helmet: a piece-specific segment
 * ("<Hallowed Hood icon>: …") is that helmet's complete bonus; the default segment(s) apply to every
 * other helmet. Each line is classified by effects.ts (the set article is the special's sourceUrl);
 * setBonusText = the lines joined by newlines. A set the schema cannot express — no Set Bonus row, not
 * exactly one chest + legs on the article, bonus segments keyed by a non-helmet piece (Beetle: two
 * alternative chests with different bonuses) — needs an overlay `withhold` entry with a verbatim quote:
 * the set is not emitted, its pieces carry no setId, a gap records why. Unreviewed → the build fails.
 *
 * VARIANT CLASS (editorial — a site taxonomy): the damage-class signals of the variant's stat effects —
 * helmet + chest + legs + its set bonus: a class scope (damage / crit), minion / sentry slots and whip
 * range → summon, max mana / mana cost → magic, melee speed → melee. One class → that class; none →
 * "other" (classless); several (hybrid sets) → an overlay `classes` ruling backed by a quote (a ruling
 * where the signals already decide fails as stale).
 *
 * Set stage = the earliest stage a complete set can be assembled: min over helmets of max(helmet, chest,
 * legs) stage — only when every piece's stage is derived (else Unknown). The set infobox "Defense"
 * totals (per helmet or one total) are cross-checked against the sum of the piece defenses (report).
 */
import { STAGE_ORDER, type ArmorPiece, type ArmorSet, type DamageClass, type GapEntry, type ProvSource, type Recipe, type SpriteManifestFile, type Stage, type StatEffect } from '../../src/schemas'
import type { Article } from '../fetch/articles'
import type { CargoRow, CargoTableFetch } from '../fetch/cargo'
import { wikiPageUrl } from '../fetch/config'
import type { ImageInfoFetch } from '../fetch/images'
import { parseSetInfoboxes, type SetBonusSegment } from '../parse/equipment'
import type { Iteminfo } from '../parse/iteminfo'
import { slugify } from '../parse/text'
import { EQUIPINFO_PAGE, equipinfoByItem } from './accessories'
import type { WithheldField } from './acquisition'
import { tally, type ReasonTally } from './drops'
import { classifyLine, countRule, crossCheckEquipinfo, normalizeEffectLines, tooltipEffectLines, type EquipCrossCheck, type RuleUsage } from './effects'
import { armorSetPages, armorSetRows, checkedDefense, equipmentCore, identifyArmor, iteminfoArmorSlot, recordState, uniqueSlugs, type EquipmentContext, type EquipmentIdentification } from './equipment'
import { Evidence } from './evidence'
import type { GatingResult } from './gating'
import type { ArmorSetsOverlay } from './overlays'
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

/** Which bonus lines apply to each helmet; or why the set's bonus cannot be expressed. */
export function bonusPerHelmet(segments: readonly SetBonusSegment[], helmets: readonly string[]): { ok: true; byHelmet: Map<string, string[]> } | { ok: false; reason: string } {
  const defaults = segments.filter((s) => s.pieces.length === 0).flatMap((s) => s.lines)
  const specific = new Map<string, string[]>()
  for (const s of segments.filter((x) => x.pieces.length > 0)) {
    for (const p of s.pieces) {
      if (!helmets.includes(p)) return { ok: false, reason: `the Set Bonus row has a segment for "${p}", which is not a helmet of the set` }
      specific.set(p, [...(specific.get(p) ?? []), ...s.lines])
    }
  }
  const byHelmet = new Map<string, string[]>()
  for (const h of helmets) {
    const lines = specific.get(h) ?? defaults
    if (lines.length === 0) return { ok: false, reason: `no Set Bonus text applies to the helmet "${h}"` }
    byHelmet.set(h, lines)
  }
  return { ok: true, byHelmet }
}

const stageMax = (a: Stage, b: Stage): Stage => (STAGE_ORDER[a] >= STAGE_ORDER[b] ? a : b)

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
    const members = (piecesByPage.get(page) ?? []).slice().sort((a, b) => a.id - b.id)
    const helmets = members.filter((p) => p.slot === 'head')
    const chests = members.filter((p) => p.slot === 'chest')
    const legs = members.filter((p) => p.slot === 'legs')
    const entry = overlayByPage.get(page)
    if (entry) usedOverlay.add(page)

    // what the schema cannot express
    const problems: string[] = []
    if (!box) problems.push('the article has no set infobox')
    else if (!box.bonus) problems.push('the set infobox has no Set Bonus row')
    if (chests.length !== 1 || legs.length !== 1 || helmets.length === 0) problems.push(`the article hosts ${helmets.length} helmet(s), ${chests.length} chest piece(s) and ${legs.length} legs piece(s) — an ArmorSet needs ≥1 helmet and exactly one chest and one legs piece`)
    const perHelmet = box?.bonus ? bonusPerHelmet(box.bonus, helmets.map((h) => h.name)) : undefined
    if (perHelmet && !perHelmet.ok && problems.length === 0) problems.push(perHelmet.reason)
    if (problems.length > 0 || entry?.withhold) {
      if (!entry?.withhold) throw new OverlayError(`[E_SCHEMA] armor set "${page}" cannot be expressed as an ArmorSet (${problems.join('; ') || '—'}) — review it and add a withhold entry with a verbatim quote to pipeline/overlays/armor-sets.json`)
      if (problems.length === 0) throw new OverlayError(`[E_SCHEMA] overlay armor-sets/${page}: withhold entry, but the set is expressible — remove the stale entry`)
      const p = input.evidence.quote(page, entry.withhold.quote, `overlay armor-sets/${page} withhold`)
      gaps.add({ ref, kind: 'count-reconciliation', detail: `${name} not emitted as an armor set: ${entry.withhold.reason} (${problems.join('; ')}); its pieces carry no setId`, sources: [p.url] })
      setReport.push({ page, id, outcome: 'withheld', detail: `${entry.withhold.reason} — ${problems.join('; ')}` })
      continue
    }
    const byHelmet = (perHelmet as { ok: true; byHelmet: Map<string, string[]> }).byHelmet
    const chest = chests[0]
    const leg = legs[0]
    const sources: ProvSource[] = [{ kind: 'cargo:Items', url: wikiPageUrl(page), fetchedAt: isoDate(input.itemsFetchedAt) }, { kind: 'wiki-article', url, rev: article.revid, fetchedAt: isoDate(article.fetchedAt) }]
    const rulings = new Map((entry?.classes ?? []).map((r) => [r.helmet, r]))
    for (const h of rulings.keys()) if (!helmets.some((x) => x.name === h)) throw new OverlayError(`[E_SCHEMA] overlay armor-sets/${page}: class ruling for "${h}", which is not a helmet of the set`)
    const classNotes: string[] = []
    const variants: ArmorSet['variants'] = helmets.map((h) => {
      const { lines } = normalizeEffectLines(byHelmet.get(h.name) as string[])
      const setBonus: StatEffect[] = []
      for (const line of lines) {
        const r = classifyLine(line, url, `armor set ${page} (${h.name})`)
        countRule(ruleCounts, r, `${name} set bonus (${h.name})`, url)
        setBonus.push(...r.effects)
      }
      if (setBonus.length === 0) throw new OverlayError(`[E_SCHEMA] armor set "${page}" (${h.name}): the Set Bonus text holds no effect line`)
      const signals = classSignals([...h.effects, ...chest.effects, ...leg.effects, ...setBonus])
      const ruling = rulings.get(h.name)
      let cls: DamageClass
      if (signals.size > 1) {
        if (!ruling) throw new OverlayError(`[E_SCHEMA] armor set "${page}" (${h.name}): the variant's effects name several classes (${[...signals].sort().join(', ')}) — add a class ruling with a verbatim quote to pipeline/overlays/armor-sets.json`)
        input.evidence.quote(page, ruling.quote, `overlay armor-sets/${page} classes ${h.name}`)
        cls = ruling.class
        classNotes.push(`${h.name}: ${cls} (ruling; signals ${[...signals].sort().join(' + ')})`)
      } else {
        if (ruling) throw new OverlayError(`[E_SCHEMA] overlay armor-sets/${page}: class ruling for "${h.name}" is stale — the effects already decide (${[...signals].join(', ') || 'none → other'})`)
        cls = signals.size === 1 ? [...signals][0] : 'other'
        classNotes.push(`${h.name}: ${cls} (${signals.size === 1 ? 'derived' : 'no class signal → other'})`)
      }
      return { helmetId: h.id, class: cls, setBonus, setBonusText: lines.join('\n') }
    })
    if (entry) sources.push(Evidence.source('armor-sets', input.evidence.page(page, `overlay armor-sets/${page}`)))

    // Defense totals: infobox vs Σ pieces (report evidence; the piece values are already cross-checked)
    for (const h of helmets) {
      const total = box?.defense.get(h.name) ?? box?.defense.get('')
      const sum = [h, chest, leg].every((p) => p.defense !== undefined) ? (h.defense as number) + (chest.defense as number) + (leg.defense as number) : undefined
      if (total === undefined || sum === undefined) setCheck('noWikiValue')
      else if (total === sum) setCheck('agree')
      else {
        setCheck('mismatch')
        gaps.add({ ref, field: 'pieces', kind: 'source-mismatch', detail: `${name} (${h.name}): the set infobox Defense total ${total} differs from the sum of the piece defenses ${sum} (Module:Iteminfo/data, cross-checked per piece)`, sources: [url] })
      }
    }

    // stage: earliest complete set (only when every piece is derived)
    const unverified: string[] = []
    let stage: Stage | undefined
    if (members.every((p) => p.stage)) {
      const base = stageMax(chest.stage as Stage, leg.stage as Stage)
      stage = helmets.map((h) => stageMax(h.stage as Stage, base)).reduce((a, b) => (STAGE_ORDER[a] <= STAGE_ORDER[b] ? a : b))
    } else unverified.push('stage')
    const prov = makeProv(sources, unverified)
    prov.editorialFields = variants.map((_, i) => `variants.${i}.class`)
    sets.push({
      id,
      name,
      pieces: { helmets: helmets.map((h) => h.id), chest: chest.id, legs: leg.id },
      variants,
      ...(stage ? { stage } : {}),
      wikiUrl: url,
      _prov: prov,
    })
    for (const p of members) {
      const piece = byId.get(p.id) as ArmorPiece
      piece.setId = id
    }
    setReport.push({ page, id, outcome: 'emitted', detail: classNotes.join('; ') })
  }
  for (const page of overlayByPage.keys()) if (!usedOverlay.has(page)) throw new OverlayError(`[E_SCHEMA] overlay armor-sets/${page}: no armor set row has this article — remove the stale entry`)
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
