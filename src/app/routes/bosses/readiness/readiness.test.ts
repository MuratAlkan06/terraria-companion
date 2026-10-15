/* Readiness checker UI (PRD P5-S6/S7 + §9 Feature A; UX_SPEC §3.8, §5, §6, §8, §10.3): the panes'
 * markup in each state (guided start, ready, analyzed, out of date), the honesty affordances (every
 * "est." paired with a populated tip; Unknown markers; GateBadges / GatedSections; condition chips;
 * the Demon Heart assumption chip; the curated label on editorial lines), Improve My Build, the entry
 * points (boss page + map card), the picker's slot filter, and the copy audit over every UI string and
 * the rendered output with wiki quotes removed. */
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { GatedSection, type GatedSectionProps } from '../../../../components/GatedSection'
import { buildMapGraph } from '../../../../components/nodeMap/graph'
import type { Accessory, ArmorPiece, ArmorSet, Boss, Buff, Condition, Item, ProgressionEdge, ProgressionNode, Weapon } from '../../../../data-access/types'
import accessoriesJson from '../../../../data/accessories.detail.json'
import armorJson from '../../../../data/armor.detail.json'
import setsJson from '../../../../data/armor-sets.json'
import bossesJson from '../../../../data/bosses.json'
import buffsJson from '../../../../data/buffs.json'
import conditionsJson from '../../../../data/conditions.json'
import itemUniverseJson from '../../../../data/item-universe.json'
import itemsJson from '../../../../data/items.detail.json'
import progressionJson from '../../../../data/progression.json'
import weaponsJson from '../../../../data/weapons.detail.json'
import { auditCopy } from '../../../../scoring/copyAudit'
import { improveSuggestions, type ImproveResult } from '../../../../scoring/improve'
import type { TrackedProgress } from '../../../../scoring/progress'
import { analyzeReadiness, loadoutEntries, type ReadinessAnalysis } from '../../../../scoring/readiness'
import { defaultReadinessSetup, type ReadinessSetup } from '../../../../storage/readiness'
import { ACQUISITION_TITLE_ID } from '../../db/weapons/AcquisitionView'
import { BossFocusCard } from '../BossFocusCard'
import { AnalysisPane, type AnalysisPaneProps } from './AnalysisPane'
import { ACQUISITION_ANCHOR, ImprovePanel } from './ImprovePanel'
import { assembleReadinessData } from './readinessData'
import { ReadinessFactorCard, type ReadinessFactorCardProps } from './ReadinessFactorCard'
import { engineInput, fits, hasAnyItem, LIST_ALL_MAX, markedDefeats, recentFits, searchTypes, segmentContext, slotPool, staleReason } from './readinessUi'
import * as copy from './readinessUiCopy'
import { SetupPane, type SetupPaneProps } from './SetupPane'

const byId = <T extends { id: K }, K>(list: readonly T[]) => new Map(list.map((x) => [x.id, x]))
const bosses = bossesJson as unknown as Boss[]
const progression = progressionJson as { nodes: ProgressionNode[]; edges: ProgressionEdge[] }
const page = assembleReadinessData({
  map: { progression: { ...progression, nodeById: byId(progression.nodes) }, bosses, sprites: null },
  weapons: byId(weaponsJson as unknown as Weapon[]),
  armor: byId(armorJson as unknown as ArmorPiece[]),
  accessories: byId(accessoriesJson as unknown as Accessory[]),
  sets: byId(setsJson as unknown as ArmorSet[]),
  items: itemsJson as unknown as Item[],
  buffs: buffsJson as unknown as Buff[],
  conditions: { byId: byId(conditionsJson as unknown as Condition[]) },
  names: { byId: new Map(itemUniverseJson.items.flatMap((i) => (i.name ? [[i.id, i.name] as const] : []))), bySlug: new Map() },
})
const ALL = [...page.engine.weapons.values(), ...page.engine.armor.values(), ...page.engine.accessories.values(), ...page.engine.items.values()]
const id = (name: string) => (ALL.find((x) => x.name === name) as { id: number }).id
const defeated = (...ids: string[]): TrackedProgress => ({ worldEvil: 'corruption', nodeStates: Object.fromEntries(ids.map((n) => [n, 'defeated' as const])) })

const PLANTERA: ReadinessSetup = {
  ...defaultReadinessSetup('mid-hm'),
  bossId: 'plantera',
  difficulty: 'expert',
  class: 'melee',
  loadout: {
    ...defaultReadinessSetup().loadout,
    mainWeapon: id('Death Sickle'),
    helmet: id('Hallowed Mask'),
    chest: id('Hallowed Plate Mail'),
    legs: id('Hallowed Greaves'),
    accessories: [id('Warrior Emblem'), id('Lightning Boots'), id('Leaf Wings'), null, null, null, null],
  },
}
const MECHS = defeated('wall-of-flesh', 'the-twins', 'the-destroyer', 'skeletron-prime')

const wrap = (el: ReactElement) => renderToStaticMarkup(createElement(MemoryRouter, null, el))
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .replace(/ ([,.;:’])/g, '$1')
/**
 * Our own words: the rendered text without the verbatim wiki quotes (“…”) — audited like the engine's
 * lines — and without UnknownValue markers, whose wording is UX_SPEC §5.3's own ("Not yet verified …").
 */
const ownText = (html: string) =>
  text(
    html
      .replace(/<span data-quote=""[^>]*>[\s\S]*?<\/span>/g, ' ')
      .replace(/<(button|span)[^>]*data-unknown-field="[^"]*"[^>]*>Unknown<span class="sr-only">[^<]*<\/span><\/\1>/g, ' Unknown '),
  )
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length

function analysisOf(setup: ReadinessSetup, progress: TrackedProgress): { analysis: ReadinessAnalysis; improve: ImproveResult } {
  const analysis = analyzeReadiness(engineInput(setup, progress), page.engine)
  const improve = improveSuggestions(engineInput(setup, progress), page.engine)
  if ('error' in analysis || 'error' in improve) throw new Error('no boss')
  return { analysis, improve }
}

const IDS = { title: 't', region: 'r', improve: 'i' }
function renderAnalysis(over: Partial<AnalysisPaneProps> = {}): string {
  const { analysis, improve } = analysisOf(PLANTERA, MECHS)
  return wrap(createElement(AnalysisPane, { page, analysis, improve, analyzedSetup: PLANTERA, analyzedAt: '2026-10-14T12:00:00.000Z', stale: null, hasItems: true, improveOpen: false, onToggleImprove: () => {}, onReanalyze: () => {}, onGuidedAdd: () => {}, ids: IDS, ...over }))
}

const SETUP_IDS = { setup: 's', boss: 'b', bossError: 'be', loadout: 'l', loadoutError: 'le' }
function renderSetup(setup: ReadinessSetup, progress: TrackedProgress, over: Partial<SetupPaneProps> = {}): string {
  const entries = loadoutEntries(engineInput(setup, progress), page.engine)
  const marks = markedDefeats(page.engine.graph, progress)
  const noop = () => {}
  return wrap(
    createElement(SetupPane, {
      page,
      setup,
      entries,
      // as ReadinessPage computes them (B96a: actual marks; the chosen world's filter said apart)
      markedCount: marks.marked.length,
      worldEvilName: progress.worldEvil ? { corruption: 'Corruption', crimson: 'Crimson' }[progress.worldEvil] : null,
      offWorldNames: marks.offWorld.map((n) => page.graph.nodeById.get(n)?.name ?? n),
      demonHeartOpen: progress.nodeStates['wall-of-flesh'] === 'defeated',
      inactiveSlotItems: 0,
      errors: { boss: false, empty: false },
      onBoss: noop,
      onStage: noop,
      onDifficulty: noop,
      onClass: noop,
      onOpenPicker: noop,
      onRemove: noop,
      onAnalyze: noop,
      onClear: noop,
      registerSlot: noop,
      ids: SETUP_IDS,
      ...over,
    }),
  )
}

describe('ReadinessFactorCard: explanation slots only (UX_SPEC §8 "copy rule enforced structurally")', () => {
  it('its props are exactly factor + how to render segments + a heading id: no verdict, grade or probability slot exists', () => {
    // compile-time: adding any prop to ReadinessFactorCardProps breaks this exact record
    const keys: Record<keyof ReadinessFactorCardProps, true> = { factor: true, ctx: true, headingId: true }
    expect(Object.keys(keys).sort()).toEqual(['ctx', 'factor', 'headingId'])
  })

  it('every number with an estimate renders an "est." chip right after it, whose tip is populated', () => {
    const { analysis } = analysisOf(PLANTERA, MECHS)
    for (const factor of analysis.factors) {
      const html = wrap(createElement(ReadinessFactorCard, { factor, ctx: segmentContext(page, analysis.estimates), headingId: `f-${factor.id}` }))
      const estimates = factor.lines.flatMap((l) => l.segments.filter((s) => s.kind === 'num' && s.estimate)).length
      expect(count(html, /data-estimate="/g), factor.id).toBe(estimates)
      // the chip directly follows its number
      for (const m of html.matchAll(/<span class="font-semibold tabular-nums">([^<]+)<\/span> <button[^>]*data-estimate="([^"]+)"/g)) expect(m[1]).toMatch(/^[\d,.]+(\/s)?$/) // a figure, with its unit where it has one
    }
  })

  it('F3 lines carry the curated label (one explaining toggletip in the card head) and cite the boss page', () => {
    const { analysis } = analysisOf(PLANTERA, MECHS)
    const f3 = analysis.factors.find((f) => f.id === 'mobility') as ReadinessAnalysis['factors'][number]
    const html = wrap(createElement(ReadinessFactorCard, { factor: f3, ctx: segmentContext(page, analysis.estimates), headingId: 'f3' }))
    expect(count(html, /data-editorial=""/g)).toBe(f3.lines.length)
    expect(count(html, new RegExp(`>${copy.CURATED_TAG}</span>`, 'g'))).toBe(f3.lines.length)
    // one "curated" toggletip in the card head (its explanation, copy.MOBILITY_CURATED, opens in a popover)
    expect(count(html, /\(show what this means\)/g)).toBe(1)
    expect(count(html, /href="https:\/\/terraria\.wiki\.gg\/wiki\/Plantera"[^>]*data-source-link=""/g)).toBe(f3.lines.length)
  })
})

describe('AnalysisPane states (UX_SPEC §3.8, §5.2, §6)', () => {
  it('guided start when nothing is in the loadout — a start, not an error; ready when there are items', () => {
    const guided = wrap(createElement(AnalysisPane, { page, stale: null, hasItems: false, improveOpen: false, onToggleImprove: () => {}, onReanalyze: () => {}, onGuidedAdd: () => {}, ids: IDS }))
    expect(guided).toContain('data-analysis-state="guided"')
    expect(text(guided)).toContain(copy.GUIDED_TITLE)
    for (const step of copy.GUIDED_STEPS) expect(text(guided)).toContain(step)
    expect(guided).toMatch(/<button type="button" data-guided-add=""[^>]*>Add your main weapon<\/button>/)
    expect(guided).not.toContain('role="alert"')
    const ready = wrap(createElement(AnalysisPane, { page, stale: null, hasItems: true, improveOpen: false, onToggleImprove: () => {}, onReanalyze: () => {}, onGuidedAdd: () => {}, ids: IDS }))
    expect(ready).toContain('data-analysis-state="ready"')
    expect(text(ready)).toContain(copy.READY_BODY)
  })

  it('analyzed (§9.2): title, meta, the owned-but-gated Leaf Wings counted with their info line (no "Not counted" list), the summary = easier ∪ harder, five factors in order, assumptions, Improve collapsed', () => {
    const html = renderAnalysis()
    expect(html).toContain('data-analysis-state="analyzed"')
    expect(html).toMatch(/<h2 id="t" tabindex="-1"[^>]*>Plantera: your factors<\/h2>/)
    // the stage is context, said in the setup pane's note — never in the analysis header (B96c)
    const header = /<header[\s\S]*?<\/header>/.exec(html)?.[0] ?? ''
    expect(text(header)).toContain('Expert Mode · Melee')
    expect(text(header)).not.toContain('Mid-Hardmode')
    // owned items count whatever their gating (B94(1)): nothing is listed as not counted
    expect(html).not.toContain('data-not-counted-list')
    // the info line under Synergy: info tone, the two bosses linked in the sentence, no GateBadge repeated beside the item
    const info = /<li data-line="synergy\.owned-gated"[\s\S]*?<\/li>/.exec(html)?.[0] ?? ''
    expect(info).toContain('data-tone="info"')
    expect(text(info.replace(/<span class="sr-only">[^<]*<\/span>/g, ''))).toContain('Leaf Wings is counted because it’s in your loadout; its usual sources open after you defeat Plantera and Queen Bee, not marked defeated on the boss map.')
    expect(info).toContain('href="/bosses/plantera"')
    expect(info).toContain('href="/bosses/queen-bee"')
    expect(info).not.toContain('data-gate=')
    // summary columns hold exactly the easier / harder lines
    const { analysis } = analysisOf(PLANTERA, MECHS)
    const easier = /<div data-summary="easier"[\s\S]*?<\/div>/.exec(html)?.[0] ?? ''
    expect(count(easier, /<li /g)).toBe(analysis.summary.easier.length)
    const harder = /<div data-summary="harder"[\s\S]*?<\/ul><\/div>/.exec(html)?.[0] ?? ''
    expect(count(harder, /<li /g)).toBe(analysis.summary.harder.length)
    expect([...html.matchAll(/data-factor="([a-z]+)"/g)].map((m) => m[1])).toEqual(['damage', 'defense', 'mobility', 'synergy', 'preparation'])
    expect(text(html)).toContain(copy.ASSUMPTIONS_TITLE)
    expect(html).toContain('data-analysis-assumption="tracked-only"')
    // constants v2 (AMENDMENTS-015 B94(3), P4-S2): the footer names the current version
    expect(text(html)).toContain(copy.constantsFooter(2))
    expect(html).toMatch(/<button type="button" aria-expanded="false" aria-controls="i"[^>]*data-improve-toggle=""/)
    expect(html).not.toContain('data-improve-group')
    // every est. chip in the whole pane has a tip
    expect(count(html, /data-estimate="/g)).toBe(analysis.factors.flatMap((f) => f.lines.flatMap((l) => l.segments)).filter((s) => s.kind === 'num' && s.estimate).length)
  })

  it('"Not counted" names the gate once, in the sentence, linked — no GateBadge repeated (an accessory in the Demon Heart slot before the Wall of Flesh is marked)', () => {
    const setup: ReadinessSetup = { ...PLANTERA, loadout: { ...PLANTERA.loadout, accessories: [null, null, null, null, null, id('Feral Claws'), null] } }
    const { analysis, improve } = analysisOf(setup, defeated())
    const html = renderAnalysis({ analysis, improve, analyzedSetup: setup })
    const notCounted = /<section[^>]*aria-labelledby="r-not-counted"[\s\S]*?<\/section>/.exec(html)?.[0] ?? ''
    // visible text (the external item link's screen-reader note removed)
    expect(text(notCounted.replace(/<span class="sr-only">[^<]*<\/span>/g, ''))).toContain('Feral Claws — in the Demon Heart slot, which opens after you defeat Wall of Flesh.')
    expect(notCounted).not.toContain('data-gate=')
    expect(notCounted).toContain('href="/bosses/wall-of-flesh"')
    expect(html).toContain('data-analysis-assumption="demon-heart-closed"')
  })

  it('out of date: the old analysis stays, dimmed by a dashed hatched frame (never text opacity) and described by the sticky Re-analyze bar — its sentence said once', () => {
    const html = renderAnalysis({ stale: 'setup' })
    expect(html).toContain('data-analysis-state="stale"')
    const region = /<div id="r" data-analysis=""[^>]*>/.exec(html)?.[0] ?? ''
    expect(region).toMatch(/class="[^"]*\bborder-dashed\b[^"]*\bbg-\[repeating-linear-gradient/)
    expect(region).toContain('aria-describedby="r-stale"')
    // B96c: no opacity anywhere on the analysis — every line keeps its contrast
    expect(html).not.toMatch(/\bopacity-\d+\b/)
    expect(html).toMatch(/data-rerun-bar="setup"[\s\S]*<p id="r-stale"[^>]*>[\s\S]*Out of date: your setup changed since this analysis\.[\s\S]*data-reanalyze=""[^>]*>[\s\S]*Re-analyze<\/button><\/div><\/section>$/)
    // B96d: one out-of-date sentence, not a second screen-reader copy
    expect(count(html, new RegExp(copy.STALE_SETUP.replace(/[.]/g, '\\.'), 'g'))).toBe(1)
    expect(text(renderAnalysis({ stale: 'progress' }))).toContain(copy.STALE_PROGRESS)
    expect(renderAnalysis()).not.toContain('border-dashed border-gold-600')
  })

  it('arriving with another boss chosen (a boss page’s "Check readiness"): the heading names the new boss, the old analysis is said to be the previous boss’s, still dimmed', () => {
    const html = renderAnalysis({ stale: 'setup', currentBossId: 'skeletron' })
    expect(html).toMatch(/<h2 id="t"[^>]*>Skeletron: ready to analyze<\/h2>/)
    expect(text(html)).toContain(copy.previousAnalysis('Plantera'))
    expect(html).toContain('data-analysis-state="stale"')
    // same boss, other edits: the analyzed boss keeps the heading
    expect(renderAnalysis({ stale: 'setup', currentBossId: 'plantera' })).toMatch(/<h2 id="t"[^>]*>Plantera: your factors<\/h2>/)
    expect(renderAnalysis({ stale: 'progress', currentBossId: 'skeletron' })).toMatch(/<h2 id="t"[^>]*>Plantera: your factors<\/h2>/)
  })
})

describe('Improve My Build panel (P5-S7; UX_SPEC §3.8, §8 GatedSection)', () => {
  const { analysis, improve } = analysisOf(PLANTERA, MECHS)
  const html = wrap(createElement(ImprovePanel, { result: improve, ctx: segmentContext(page, analysis.estimates), sprites: null, setUrl: (s) => page.engine.sets.get(s)?.wikiUrl, idPrefix: 'imp' }))

  it('per group: obtainable-now rows with "Show Me How to Get It" (any item → its Feature B grind plan, /plan/new?item=:id; armor sets → their article)', () => {
    expect(ACQUISITION_ANCHOR).toBe(ACQUISITION_TITLE_ID)
    const weapon = /<section[^>]*aria-labelledby="imp-weapon"[\s\S]*?<\/section>/.exec(html)?.[0] ?? ''
    // PRD P5-S7 AC2 / §9 Feature B AC5 / UX_SPEC §3.8: deep-links into the planner now that P6-S5 ships
    for (const s of improve.groups[0].obtainable) expect(new RegExp(`<a [^>]*data-show-how="i:${s.id}"[^>]*>`).exec(weapon)?.[0]).toContain(`href="/plan/new?item=${s.id}"`)
    const healing = /<section[^>]*aria-labelledby="imp-healing"[\s\S]*?<\/section>/.exec(html)?.[0] ?? ''
    expect(healing).toMatch(/<a [^>]*href="\/plan\/new\?item=188"[^>]*data-show-how="i:188"|<a [^>]*data-show-how="i:188"[^>]*href="\/plan\/new\?item=188"/)
    // gated suggestions too (the brief's "readiness Improve's gated suggestions")
    const gatedItems = improve.groups.flatMap((x) => x.gated).flatMap((g) => g.items).filter((s) => s.kind !== 'armor-set')
    expect(gatedItems.length).toBeGreaterThan(0)
    for (const s of gatedItems) {
      const tag = [...html.matchAll(/<a [^>]*data-show-how="[^"]*"[^>]*>/g)].map((m) => m[0]).find((a) => a.includes(`data-show-how="${s.key}"`))
      expect(tag, s.key).toContain(`href="/plan/new?item=${s.id}"`)
    }
    expect(count(html, /data-show-how="/g)).toBe(improve.groups.reduce((n, g) => n + g.obtainable.length + g.gated.reduce((m, x) => m + x.items.length, 0), 0))
  })

  it('gated upgrades sit only in GatedSections headed "After you defeat {Boss}" (linked), keyed by their exact bosses', () => {
    const gated = improve.groups.flatMap((g) => g.gated)
    expect(gated.length).toBeGreaterThan(0)
    expect(count(html, /data-gated-section="/g)).toBe(gated.length)
    for (const group of improve.groups) {
      // the group's own panel: everything from its heading to the next group's
      const start = html.indexOf(`id="imp-${group.target}"`)
      const next = improve.groups.map((g) => html.indexOf(`id="imp-${g.target}"`)).filter((i) => i > start).sort((a, b) => a - b)[0] ?? html.length
      const panel = html.slice(start, next)
      for (const g of group.gated) {
        const section = new RegExp(`<section[^>]*data-gated-section="${g.missing.join('\\+')}"[\\s\\S]*?</section>`).exec(panel)?.[0] ?? ''
        expect(text(section)).toMatch(/After you defeat /)
        for (const name of g.names) expect(text(section)).toContain(name)
        for (const s of g.items) expect(section).toContain(`data-suggestion="${s.key}"`)
      }
      // and no gated upgrade among the obtainable-now rows
      const obtainable = panel.split('data-gated-section=')[0]
      for (const g of group.gated) for (const s of g.items) expect(obtainable).not.toContain(`data-suggestion="${s.key}"`)
    }
  })

  it('a GatedSection heading with several bosses: each linked, the comma hugging its name (no gap before it), "and" before the last', () => {
    const gates = [
      { id: 'skeletron-prime', name: 'Skeletron Prime', to: '/bosses/skeletron-prime' },
      { id: 'the-destroyer', name: 'The Destroyer', to: '/bosses/the-destroyer' },
      { id: 'the-twins', name: 'The Twins', to: '/bosses/the-twins' },
    ]
    const props: Omit<GatedSectionProps, 'children'> = { id: 'g', as: 'h5', gates }
    // children go in as createElement's own argument (the props object carries none)
    const html = wrap(createElement(GatedSection, props as unknown as GatedSectionProps, createElement('ul')))
    expect(html).toMatch(/>Skeletron Prime<\/a>,<\/span>/)
    expect(html).toMatch(/>The Destroyer<\/a><\/span>/)
    expect(html).toMatch(/<span>and<\/span><span class="inline-flex items-center"><a [^>]*>The Twins<\/a><\/span>/)
  })

  it('GatedSections render nearest gate first, in the engine’s order (B94(5)): a fresh world facing the Eye of Cthulhu, armor', () => {
    const setup: ReadinessSetup = { ...defaultReadinessSetup(), bossId: 'eye-of-cthulhu' }
    const fresh = analysisOf(setup, defeated())
    const panel = wrap(createElement(ImprovePanel, { result: fresh.improve, ctx: segmentContext(page, fresh.analysis.estimates), sprites: null, setUrl: (s) => page.engine.sets.get(s)?.wikiUrl, idPrefix: 'imp' }))
    const armor = /<section[^>]*aria-labelledby="imp-armor"[\s\S]*?(?=<section[^>]*aria-labelledby="imp-accessory")/.exec(panel)?.[0] ?? ''
    expect([...armor.matchAll(/data-gated-section="([^"]+)"/g)].map((m) => m[1])).toEqual(['king-slime', 'wall-of-flesh', 'queen-slime'])
    expect(text(panel)).toContain(copy.IMPROVE_INTRO)
  })
})

describe('SetupPane (UX_SPEC §3.8 SetupPane; AMENDMENTS-001 A4; B69/Q3, Q4)', () => {
  it('boss picker grouped by stage (every boss once), stage, difficulty and class radios, the tracking context', () => {
    const html = renderSetup(PLANTERA, MECHS)
    expect(count(html, /<option value="[a-z-]+"/g)).toBe(bosses.length + 5) // bosses + the 5 stages
    expect(count(html, /<optgroup /g)).toBe(5)
    expect(html).toContain('<option value="plantera" selected="">Plantera</option>')
    expect(count(html, /<input type="radio"[^>]*name="b-difficulty"/g)).toBe(3)
    expect(count(html, /<input type="radio"[^>]*name="b-class"/g)).toBe(5)
    expect(text(html)).toContain(copy.trackingContext(4))
    expect(html).toContain('href="/bosses"')
  })

  it('Expert, Wall of Flesh marked: 6 accessory rows, the 6th the Demon Heart slot with its assumption chip', () => {
    const html = renderSetup(PLANTERA, MECHS)
    expect(count(html, /data-slot="accessory-\d"/g)).toBe(6)
    expect(html).toMatch(/data-slot="accessory-5"[\s\S]*?data-assumption-chip="assumes Demon Heart"/)
    expect(html).not.toContain('demon-heart-locked')
  })

  it('Expert, nothing marked: the Demon Heart slot is locked — ONE sentence carries it, the Wall of Flesh linked in it, no badge beside it (B96c); Classic has 5 slots and no such slot', () => {
    const locked = renderSetup(PLANTERA, defeated())
    const slot = /<div data-slot="demon-heart-locked"[\s\S]*?(?=<div data-slot=)/.exec(locked)?.[0] ?? ''
    expect(slot).toContain('href="/bosses/wall-of-flesh"')
    expect(slot).not.toContain('data-gate=')
    expect(text(slot)).toContain('Opens once the Wall of Flesh is marked defeated.')
    const classic = renderSetup({ ...PLANTERA, difficulty: 'classic' }, MECHS)
    expect(count(classic, /data-slot="accessory-\d"/g)).toBe(5)
    expect(classic).not.toContain('Demon Heart')
  })

  it('slot status follows tracked progress: gated → counted (owned, B94(1)) with GateBadges; Unknown → counted with its marker; conditions → chips', () => {
    const html = renderSetup({ ...PLANTERA, loadout: { ...PLANTERA.loadout, altWeapon: id('Enchanted Boomerang') } }, MECHS)
    const wings = /<div data-slot="accessory-2"[\s\S]*?(?=<div data-slot=)/.exec(html)?.[0] ?? ''
    expect(wings).toContain('data-availability="gated"')
    // ONE gate chip names every boss, joined by "and" (all are needed), on its own row; "counted" is its own line (B96c)
    expect(wings).toContain('data-gate-group="plantera+queen-bee"')
    expect(wings).toMatch(/<p class="flex flex-wrap[^"]*"><span>Availability:<\/span><span data-gate-group="plantera\+queen-bee"[\s\S]*?<span class="sr-only">Available <\/span>After<span class="sr-only"> you defeat<\/span> Plantera and Queen Bee<\/span><\/span><\/p><p>Counted because it’s in your loadout\.<\/p>/)
    expect(wings).not.toContain('data-gate=')
    expect(text(wings)).toContain(copy.COUNTED_AS_YOURS)
    expect(wings).not.toContain('data-not-counted')
    const sickle = /<div data-slot="mainWeapon"[\s\S]*?(?=<div data-slot=)/.exec(html)?.[0] ?? ''
    expect(sickle).toContain('data-availability="unknown"')
    expect(sickle).toContain('data-unknown-field="gatedBy"')
    expect(text(sickle)).toContain(copy.COUNTED_AS_YOURS)
    const boomerang = /<div data-slot="altWeapon"[\s\S]*?(?=<div data-slot=)/.exec(html)?.[0] ?? ''
    expect(boomerang).toMatch(/data-condition-chip="Nighttime"[^>]*>[\s\S]*?Requires:/)
    expect(boomerang).not.toContain('data-not-counted')
  })

  it('every slot is a ≥44px button named for what it holds; filled slots have a named remove button; validation errors are tied to their field', () => {
    const html = renderSetup(PLANTERA, MECHS, { errors: { boss: true, empty: true } })
    expect(html).toContain('aria-label="Main weapon: Death Sickle. Change"')
    expect(html).toContain('aria-label="Alt weapon: empty. Add an item"')
    expect(html).toContain('aria-label="Remove Death Sickle from main weapon"')
    expect(html).toMatch(/<select id="b"[^>]*aria-invalid="true" aria-describedby="be"/)
    expect(html).toMatch(/<p id="be"[^>]*>Choose a boss to analyze\.<\/p>/)
    expect(html).toMatch(/<p id="le" role="alert"[^>]*>Add at least one item to your loadout first\.<\/p>/)
  })
})

describe('world evil "Both" (AMENDMENTS-015 B96a): the pane counts actual marks; nothing marked is named as a gate anywhere', () => {
  const both = (...ids: string[]): TrackedProgress => ({ worldEvil: null, nodeStates: Object.fromEntries(ids.map((n) => [n, 'defeated' as const])) })
  const WORM: ReadinessSetup = { ...defaultReadinessSetup('late-prehm'), bossId: 'skeletron', loadout: { ...defaultReadinessSetup().loadout, accessories: [id('Worm Scarf'), null, null, null, null, null, null] } }
  const slot0 = (html: string) => /<div data-slot="accessory-0"[\s\S]*?(?=<div data-slot=)/.exec(html)?.[0] ?? ''
  const ALL_BOSSES = progression.nodes.filter((n) => n.kind === 'boss').map((n) => n.id)

  it('the repro — the Eater of Worlds marked on its page: the pane counts it, says in its own sentence that either evil boss counts once marked, and the Worm Scarf slot carries no gate', () => {
    const before = renderSetup(WORM, both())
    expect(text(before)).toContain(copy.trackingContext(0))
    expect(slot0(before)).toContain('data-gate-group="eater-of-worlds"')
    const html = renderSetup(WORM, both('eater-of-worlds'))
    expect(html).toContain('data-marked-count="1"')
    expect(text(html)).toContain(copy.trackingContext(1))
    expect(text(html)).toContain(copy.worldContext(null))
    expect(text(html)).not.toContain('stay gated')
    expect(html).not.toContain('data-off-world')
    expect(slot0(html)).not.toContain('data-gate')
    expect(slot0(html)).not.toContain('data-availability')
  })

  it('a full clear says 18 (every boss as marked, both evil bosses included); a chosen world evil still counts the other world’s mark and says apart why it doesn’t open anything', () => {
    expect(ALL_BOSSES).toHaveLength(18)
    expect(text(renderSetup(WORM, both(...ALL_BOSSES)))).toContain('Availability follows the 18 bosses marked defeated on the boss map.')
    const crimson = renderSetup(WORM, { worldEvil: 'crimson', nodeStates: { 'eater-of-worlds': 'defeated' } })
    expect(text(crimson)).toContain(copy.trackingContext(1))
    expect(text(crimson)).toContain('Eater of Worlds is marked defeated but isn’t your chosen world evil (Crimson), so items that need it stay gated.')
    expect(slot0(crimson)).toContain('data-gate-group="eater-of-worlds"')
  })

  it('the analysis and Improve My Build: no GatedSection heading, badge or line names the marked Eater of Worlds; before marking it, one does (not vacuous)', () => {
    const render = (progress: TrackedProgress, setup: ReadinessSetup) => {
      const { analysis, improve } = analysisOf(setup, progress)
      return wrap(createElement(AnalysisPane, { page, analysis, improve, analyzedSetup: setup, stale: null, hasItems: true, improveOpen: true, onToggleImprove: () => {}, onReanalyze: () => {}, onGuidedAdd: () => {}, ids: IDS }))
    }
    // the owned Worm Scarf: named with its gate before the mark, not after
    expect(render(both('eye-of-cthulhu'), WORM)).toContain('href="/bosses/eater-of-worlds"')
    expect(render(both('eye-of-cthulhu', 'eater-of-worlds'), WORM)).not.toContain('href="/bosses/eater-of-worlds"')
    // the suggestions (an empty loadout leaves every slot open to them)
    const EMPTY: ReadinessSetup = { ...WORM, loadout: defaultReadinessSetup().loadout }
    const before = render(both('eye-of-cthulhu'), EMPTY)
    expect(before).toContain('data-gated-section="eater-of-worlds"')
    const after = render(both('eye-of-cthulhu', 'eater-of-worlds'), EMPTY)
    expect(after).not.toMatch(/data-gated-section="[^"]*eater-of-worlds/)
    expect(after).not.toMatch(/data-gate(-group)?="[^"]*(eater-of-worlds|Eater of Worlds)/)
    for (const m of after.matchAll(/<h5 id="[^"]*-after-[^"]*"[\s\S]*?<\/h5>/g)) expect(text(m[0])).not.toContain('Eater of Worlds')
    expect(after).not.toContain('href="/bosses/eater-of-worlds"') // not even as a linked gate in a sentence
  })
})

describe('a chosen world evil (AMENDMENTS-015 B97a): Improve shows nothing behind the other world’s evil boss; "Not shown" counts it', () => {
  const EMPTY: ReadinessSetup = { ...defaultReadinessSetup('late-prehm'), bossId: 'skeletron' }
  const crimson = (...ids: string[]): TrackedProgress => ({ worldEvil: 'crimson', nodeStates: Object.fromEntries(ids.map((n) => [n, 'defeated' as const])) })
  const renderImprove = (progress: TrackedProgress) => {
    const { analysis, improve } = analysisOf(EMPTY, progress)
    return wrap(createElement(AnalysisPane, { page, analysis, improve, analyzedSetup: EMPTY, stale: null, hasItems: true, improveOpen: true, onToggleImprove: () => {}, onReanalyze: () => {}, onGuidedAdd: () => {}, ids: IDS }))
  }
  const disclosures = (html: string) => [...html.matchAll(/<p data-improve-disclosure=""[^>]*>([\s\S]*?)<\/p>/g)].map((m) => text(m[1]))

  it('Crimson, the Eater of Worlds unmarked or marked: no GatedSection names it, a disclosure counts and names it; marked, the setup pane keeps its sentence', () => {
    for (const progress of [crimson('eye-of-cthulhu'), crimson('eye-of-cthulhu', 'eater-of-worlds')]) {
      const html = renderImprove(progress)
      expect(html).not.toMatch(/data-gated-section="[^"]*eater-of-worlds/)
      for (const m of html.matchAll(/<h5 id="[^"]*-after-[^"]*"[\s\S]*?<\/h5>/g)) expect(text(m[0])).not.toContain('Eater of Worlds')
      expect(disclosures(html).some((d) => /\b\d+ that needs? the other world’s evil boss \( ?Eater of Worlds ?\)/.test(d))).toBe(true)
      for (const d of disclosures(html)) expect(auditCopy(d), d).toBeUndefined()
    }
    // "Both", same marks: the Eater of Worlds heads a GatedSection and no disclosure mentions the other world (not vacuous)
    const both = renderImprove({ worldEvil: null, nodeStates: { 'eye-of-cthulhu': 'defeated' } })
    expect(both).toMatch(/data-gated-section="eater-of-worlds"/)
    expect(disclosures(both).join(' ')).not.toContain('other world')
    expect(text(renderSetup(EMPTY, crimson('eye-of-cthulhu', 'eater-of-worlds')))).toContain(copy.offWorldMarks(['Eater of Worlds'], 'Crimson'))
  })
})

describe('wording and placement (AMENDMENTS-015 B96c/d)', () => {
  it('gate badges never sit inside a sentence: the line names its items; each gated one follows on its own row, badges joined by "and"', () => {
    const { analysis } = analysisOf(PLANTERA, MECHS)
    for (const factor of analysis.factors) {
      const html = wrap(createElement(ReadinessFactorCard, { factor, ctx: segmentContext(page, analysis.estimates), headingId: `f-${factor.id}` }))
      for (const m of html.matchAll(/<p class="py-0\.5[^"]*">([\s\S]*?)<\/p>/g)) expect(m[1], factor.id).not.toContain('data-gate')
    }
    const mobility = analysis.factors.find((f) => f.id === 'mobility') as ReadinessAnalysis['factors'][number]
    const html = wrap(createElement(ReadinessFactorCard, { factor: mobility, ctx: segmentContext(page, analysis.estimates), headingId: 'f3' }))
    expect(html).toMatch(new RegExp(`data-gate-note="${id('Leaf Wings')}"[^>]*><span>Leaf Wings:</span><span data-gate-group="plantera\\+queen-bee"[\\s\\S]*?After<span class="sr-only"> you defeat</span> Plantera and Queen Bee</span>`))
    // the summary repeats the line, and its gated items follow it the same way
    const pane = renderAnalysis()
    const easier = /<div data-summary="easier"[\s\S]*?<\/ul><\/div>/.exec(pane)?.[0] ?? ''
    for (const m of easier.matchAll(/<li [^>]*>([\s\S]*?)<\/li>/g)) expect(m[1].split('data-gate-note')[0]).not.toContain('data-gate')
    // three gates stay one chip: "After Skeletron Prime, The Destroyer and The Twins"
    expect(copy.gateNames(['Skeletron Prime', 'The Destroyer', 'The Twins'])).toBe('Skeletron Prime, The Destroyer and The Twins')
    expect(copy.gateNames(['Plantera'])).toBe('Plantera')
  })

  it('a line’s source icons: one per article, none for an article the line already links inline (the potion named and linked in its own line)', () => {
    const setup: ReadinessSetup = { ...defaultReadinessSetup(), bossId: 'king-slime', loadout: { ...defaultReadinessSetup().loadout, accessories: [id('Hermes Boots'), null, null, null, null, null, null], buffs: [id('Ironskin Potion'), id('Healing Potion')] } }
    const { analysis, improve } = analysisOf(setup, defeated())
    const html = renderAnalysis({ analysis, improve, analyzedSetup: setup })
    const lines = html.match(/<li data-line="[\s\S]*?<\/li>/g) ?? []
    expect(lines.length).toBeGreaterThan(10)
    for (const li of lines) {
      const icons = [...li.matchAll(/<a href="([^"]+)"[^>]*data-source-link=""/g)].map((m) => m[1])
      const inline = [...li.matchAll(/<a href="(https:[^"]+)"(?![^>]*data-source-link)[^>]*>/g)].map((m) => m[1])
      expect(new Set(icons).size, li.slice(0, 60)).toBe(icons.length)
      for (const url of icons) expect(inline, li.slice(0, 60)).not.toContain(url)
    }
    const healing = /<li data-line="preparation\.healing"[\s\S]*?<\/li>/.exec(html)?.[0] ?? ''
    // P6 encyclopedia: the potion named in its line links its item page; its wiki article is the line's one source icon
    expect(healing).toContain('href="/items/188"')
    expect([...healing.matchAll(/<a href="([^"]+)"[^>]*data-source-link=""/g)].map((m) => m[1])).toEqual(['https://terraria.wiki.gg/wiki/Healing_Potion'])
  })

  it('plural boss names read right on screen and to screen readers: "The Twins charge at you", "the article about The Twins" — never "the The …"', () => {
    const setup: ReadinessSetup = { ...PLANTERA, bossId: 'the-twins', class: 'ranged', loadout: { ...PLANTERA.loadout, mainWeapon: id('Megashark') } }
    const { analysis, improve } = analysisOf(setup, defeated('wall-of-flesh'))
    const html = renderAnalysis({ analysis, improve, analyzedSetup: setup })
    expect(text(html)).toContain('The Twins charge at you.')
    expect(text(html)).toContain('The Twins fly.')
    expect(text(html)).not.toMatch(/The Twins (charges|flies|fires|is|has)\b/)
    expect(html).toContain('Source: the article about The Twins on terraria.wiki.gg')
    expect(html).not.toMatch(/\bthe The\b/)
    expect(copy.sourceArticle('The Destroyer')).toBe('Source: the article about The Destroyer')
  })

  it('layout (md+): whichever pane is shorter follows the longer one — the setup (end-aligned, sticky bottom) keeps its actions in view beside a long analysis; the Ready card (sticky top) carries its own Analyze button beside a long setup', () => {
    const setupTag = /<section[^>]*data-setup=""[^>]*>/.exec(renderSetup(PLANTERA, MECHS))?.[0] ?? ''
    expect(setupTag).toMatch(/\bmd:sticky\b/)
    expect(setupTag).toMatch(/\bmd:bottom-\[/)
    expect(setupTag).toMatch(/\bmd:self-end\b/)
    expect(setupTag).not.toMatch(/overflow-y-auto/) // no nested scroll area
    const analyzedTag = /<section[^>]*data-analysis-state="analyzed"[^>]*>/.exec(renderAnalysis())?.[0] ?? ''
    expect(analyzedTag).toMatch(/\bmd:sticky\b[^"]*\bmd:self-end\b/)
    const ready = wrap(createElement(AnalysisPane, { page, stale: null, hasItems: true, improveOpen: false, onToggleImprove: () => {}, onReanalyze: () => {}, onAnalyze: () => {}, onGuidedAdd: () => {}, ids: IDS }))
    expect(/<section[^>]*data-analysis-state="ready"[^>]*>/.exec(ready)?.[0]).toMatch(/\bmd:sticky md:top-20\b/)
    expect(ready).toMatch(/<button type="button" data-ready-analyze=""[^>]*>Analyze My Build<\/button>/)
  })
})

describe('the picker filter over the shared search index (Feature A AC1)', () => {
  const setup = PLANTERA
  it('each slot asks the index for its entity types and keeps only what fits (armor by slot, no duplicate accessories, potions only)', () => {
    expect([...searchTypes({ kind: 'helmet' })]).toEqual(['armor'])
    expect([...searchTypes({ kind: 'ammo' })].sort()).toEqual(['item', 'weapon'])
    expect(fits({ kind: 'helmet' }, id('Hallowed Mask'), page.engine, setup)).toBe(true)
    expect(fits({ kind: 'helmet' }, id('Hallowed Plate Mail'), page.engine, setup)).toBe(false)
    expect(fits({ kind: 'accessory', index: 3 }, id('Warrior Emblem'), page.engine, setup)).toBe(false) // already in slot 1
    expect(fits({ kind: 'accessory', index: 0 }, id('Warrior Emblem'), page.engine, setup)).toBe(true) // its own slot
    expect(fits({ kind: 'buffs' }, id('Ironskin Potion'), page.engine, setup)).toBe(true)
    expect(fits({ kind: 'buffs' }, id('Wooden Arrow'), page.engine, setup)).toBe(false)
    expect(fits({ kind: 'summon' }, id('Finch Staff'), page.engine, setup)).toBe(true)
    expect(fits({ kind: 'summon' }, id('Death Sickle'), page.engine, setup)).toBe(false)
  })

  it('small pools (potions, ammo) list every item before typing; big ones (weapons) ask for a search', () => {
    expect(slotPool({ kind: 'buffs' }, page.engine, setup).length).toBeLessThanOrEqual(LIST_ALL_MAX)
    expect(slotPool({ kind: 'mainWeapon' }, page.engine, setup).length).toBeGreaterThan(LIST_ALL_MAX)
  })

  it('before typing in a big pool (B96d — never a blank sheet): the recently viewed items that fit the slot, newest first, deduped; else the hint', () => {
    const refs = ['boss:plantera', `i:${id('Terra Blade')}`, `i:${id('Hallowed Mask')}`, `i:${id('Death Sickle')}`, `i:${id('Terra Blade')}`]
    expect(recentFits(refs, { kind: 'mainWeapon' }, page.engine, setup)).toEqual([id('Terra Blade'), id('Death Sickle')])
    expect(recentFits(refs, { kind: 'helmet' }, page.engine, setup)).toEqual([id('Hallowed Mask')])
    expect(recentFits(refs, { kind: 'accessory', index: 3 }, page.engine, setup)).toEqual([])
    expect(recentFits(Array.from({ length: 20 }, (_, i) => `i:${slotPool({ kind: 'mainWeapon' }, page.engine, setup)[i]}`), { kind: 'mainWeapon' }, page.engine, setup)).toHaveLength(8)
    expect(copy.PICKER_START_TITLE.length).toBeGreaterThan(0)
  })

  it('staleness: setup edits, then marked bosses; hasAnyItem ignores accessory slots the difficulty lacks', () => {
    const snap = { setup: PLANTERA, progress: MECHS, at: '2026-10-14T12:00:00.000Z' }
    expect(staleReason(snap, PLANTERA, MECHS)).toBeNull()
    expect(staleReason(snap, { ...PLANTERA, class: 'ranged' }, MECHS)).toBe('setup')
    expect(staleReason(snap, { ...PLANTERA, stage: 'endgame' }, MECHS)).toBeNull() // the stage is context only (B97b)
    expect(staleReason(snap, PLANTERA, defeated('wall-of-flesh'))).toBe('progress')
    expect(staleReason({ setup: PLANTERA, at: snap.at }, PLANTERA, defeated())).toBeNull() // no pinned progress yet
    const onlySeventh = { ...defaultReadinessSetup(), loadout: { ...defaultReadinessSetup().loadout, accessories: [null, null, null, null, null, null, 7] } }
    expect(hasAnyItem(onlySeventh)).toBe(false)
    expect(hasAnyItem({ ...onlySeventh, difficulty: 'master' })).toBe(true)
  })
})

describe('entry points (PRD §9 Feature A AC5): the map card links the checker for a boss with a page', () => {
  it('BossFocusCard: "Check readiness" → /readiness?boss=<id>; none for a milestone', () => {
    const graph = buildMapGraph(progression, bosses)
    const card = (nodeId: string, pageHref?: string) =>
      wrap(createElement(BossFocusCard, { id: 'card', graph, nodeId, sprites: null, worldEvil: null, nodeStates: {}, pageHref, onClose: () => {}, onJump: () => {} }))
    const link = /<a [^>]*data-readiness-link="plantera"[^>]*>[\s\S]*?<\/a>/.exec(card('plantera', '/bosses/plantera'))?.[0] ?? ''
    expect(link).toContain('href="/readiness?boss=plantera"')
    expect(link).toContain('Check readiness<span class="sr-only"> for Plantera</span>')
    expect(card('hardmode')).not.toContain('data-readiness-link')
  })
})

describe('copy audit (SCORING_SPEC §8.4; PRD §9 AC3; UX_SPEC §10.3): every UI string and the rendered panes', () => {
  const samples: string[] = [
    ...Object.values(copy).flatMap((v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? (v as string[]) : typeof v === 'object' && v ? Object.values(v as Record<string, string>) : [])),
    copy.trackingContext(0),
    copy.trackingContext(1),
    copy.trackingContext(7),
    copy.worldContext('Crimson'),
    copy.worldContext(null),
    copy.stageNote('Endgame', 'Early Hardmode', 'ahead'),
    copy.stageNote('Early Pre-Hardmode', 'Mid-Hardmode', 'behind'),
    copy.inactiveSlots(2, 'Classic'),
    copy.notCountedIntro(1),
    copy.notCountedIntro(3),
    copy.analysisTitle('Plantera'),
    copy.analysisMeta('Expert', 'Melee'),
    copy.offWorldMarks(['Eater of Worlds'], 'Crimson'),
    copy.offWorldMarks(['Eater of Worlds', 'Brain of Cthulhu'], 'Crimson'),
    copy.analysisPendingTitle('Skeletron'),
    copy.previousAnalysis('Plantera'),
    copy.pickerRecentCount(3, 488, 'weapons'),
    copy.sourceArticle('The Twins'),
    copy.computedFrom(1, 2),
    copy.unknownInputs(['x']),
    copy.pickerHint(488, 'weapons'),
    copy.pickerNone('zzz'),
    copy.pickerCount(3),
    copy.bossCta('Plantera'),
    copy.changeSlot('Helmet', 'Hallowed Mask'),
    copy.emptySlot('Helmet'),
    copy.removeFrom('Hallowed Mask', 'Helmet'),
    copy.constantsFooter(2),
  ]

  it.each(samples.map((s) => [s]))('%s', (line) => {
    expect(auditCopy(line)).toBeUndefined()
  })

  it('the rendered panes, in many states, with the verbatim wiki quotes removed', () => {
    const states: Array<[ReadinessSetup, TrackedProgress]> = [
      [PLANTERA, MECHS],
      [PLANTERA, defeated()],
      [{ ...PLANTERA, bossId: 'eye-of-cthulhu', difficulty: 'classic' }, defeated()],
      [{ ...PLANTERA, bossId: 'the-twins', class: 'ranged' }, defeated('wall-of-flesh')],
      [{ ...PLANTERA, bossId: 'moon-lord', class: 'summon', difficulty: 'master' }, defeated('wall-of-flesh', 'plantera', 'golem')],
      [{ ...defaultReadinessSetup(), bossId: 'king-slime', loadout: { ...defaultReadinessSetup().loadout, buffs: [id('Ironskin Potion'), id('Healing Potion')] } }, defeated()],
    ]
    for (const [setup, progress] of states) {
      const { analysis, improve } = analysisOf(setup, progress)
      const pane = wrap(createElement(AnalysisPane, { page, analysis, improve, analyzedSetup: setup, analyzedAt: '2026-10-14T12:00:00.000Z', stale: 'setup', hasItems: true, improveOpen: true, onToggleImprove: () => {}, onReanalyze: () => {}, onGuidedAdd: () => {}, ids: IDS }))
      const setupHtml = renderSetup(setup, progress, { errors: { boss: true, empty: true }, stageNote: copy.stageNote('Endgame', 'Early Hardmode', 'ahead'), inactiveSlotItems: 1 })
      for (const html of [pane, setupHtml]) {
        const own = ownText(html)
        expect(auditCopy(own), `${setup.bossId}: ${auditCopy(own)}`).toBeUndefined()
      }
    }
  })
})
