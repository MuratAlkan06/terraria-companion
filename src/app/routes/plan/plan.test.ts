/* Feature B UI + persistence (PRD P6-S5/S6, §9 Feature B AC1–AC5; UX_SPEC §3.9, §5.2/§5.6, §6, §7, §8;
 * DATA_SCHEMA_SPEC §8a PlansV1): the tc.v1.plans store round trip (create, check, owned, choice, data update,
 * done ↔ active, delete) through a fresh hydrate, quarantine of unreadable payloads, parity with the Zod
 * schema; the tree / checklist / header rendered from the real dataset (Night's Edge, Zenith, a goal with no
 * known source, the Unknown-heavy and done states, data drift); the entry points (item and weapon pages); and
 * the copy audit over every plan string and the rendered markup (wiki text removed). */
import { Tooltip } from 'radix-ui'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { beforeAll, describe, expect, it } from 'vitest'
import { meta } from '../../../data/meta'
import { PlansV1 } from '../../../schemas/persistence'
import { auditCopy } from '../../../scoring/copyAudit'
import { loadDomain, saveDomain, storageKey, type StorageBackend } from '../../../storage'
import type { SavedPlan } from '../../../storage/plans'
import { ItemDetailView } from '../db/items/ItemDetailView'
import { WeaponDetailView } from '../db/weapons/WeaponDetailView'
import { hasRoute } from '../../routes'
import { generateSteps, planView, progressBasis, type PlanState } from './planModel'
import { loadPlanBase, makeInfo, planLookup, resolvePlanGraph, stepNames, type PlanBase } from './planData'
import * as copy from './planCopy'
import { planHref, planNewHref } from './planLinks'
import { PlanChecklist } from './PlanChecklist'
import { PlanDetail } from './PlanDetail'
import { createPlansStore } from './plansStore'
import { computeDemand, defaultSelection, itemKey, type PlanGraph, type PlanItemNode } from './planTree'
import { PlanTreeView, type PlanCtx } from './PlanTreeView'
import { OwnedQtyInput, RouteFacts } from './PlanBits'
import { choiceAnnouncement } from './planAnnouncements'
import { planSummary } from './planSummary'
import { PlanCardProgress } from './PlansPage'
import { routeLine } from './planText'
import { idOf, RECORDS } from './planTestData'
import type { PlanComputation } from './usePlan'
import type { Item, Weapon } from '../../../data-access/types'

const wrap = (node: ReactNode) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Tooltip.Provider, null, node)))
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ')
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length

function memoryBackend(seed: Record<string, string> = {}): StorageBackend & { dump: () => Record<string, string> } {
  const map = new Map(Object.entries(seed))
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, String(v)), removeItem: (k) => void map.delete(k), dump: () => Object.fromEntries(map) }
}
const NOW = new Date('2026-10-15T12:00:00.000Z')
const later = (min: number) => new Date(NOW.getTime() + min * 60_000)

// --- the real dataset through the app's own loaders --------------------------------------------------

let base: PlanBase
beforeAll(async () => {
  base = await loadPlanBase()
}, 60_000)

const NONE_PROGRESS = { worldEvil: null, nodeStates: {} }

async function computation(goal: number, choices: Record<string, string> = {}, state: PlanState = { owned: {}, checkedStepIds: [] }, opts: { choose?: boolean; progress?: typeof NONE_PROGRESS } = {}): Promise<PlanComputation & { graph: PlanGraph }> {
  const graph = await resolvePlanGraph(base, goal, 1, choices)
  const prog = base.acquisition.progression
  if (!prog) throw new Error('progression not loaded')
  const steps = generateSteps(graph, prog, stepNames(base, graph), planLookup(base))
  const basis = progressBasis(prog, opts.progress ?? NONE_PROGRESS, null)
  const view = planView(graph, steps, state, prog, basis)
  const byKey = new Map(view.steps.filter((s) => s.step.kind !== 'defeat-boss').map((s) => [s.step.refs[0], s]))
  const ctx: PlanCtx = { base, graph, structural: computeDemand(graph), view, basis, info: makeInfo(base, graph), stepOf: (k) => byKey.get(k), ...(opts.choose ? { choose: () => {} } : {}) }
  return { ctx, steps, basis, loading: false, error: undefined, retry: () => {}, graph }
}

function savedPlan(goal: number, steps: SavedPlan['snapshot']['steps'], extra: Partial<SavedPlan> = {}): SavedPlan {
  return { planId: 'p-test-0001', targetItemId: goal, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), status: 'active', stageAtCreation: null, snapshot: { generatedAt: NOW.toISOString(), gameVersion: meta.gameVersion, steps }, owned: {}, checkedStepIds: [], ...extra }
}

const NE = idOf("Night's Edge")

// --- persistence ---------------------------------------------------------------------------------------

describe('tc.v1.plans (DATA_SCHEMA_SPEC §8a; PRD P6-S6 AC3, §9 Feature B AC4)', () => {
  const step = { stepId: 'craft-0d48112d', kind: 'craft' as const, text: "Craft 1 Night's Edge", itemId: NE, amount: 1, groupKey: 'craft', refs: [`i:${NE}`, 'rcp:273-889ff89d'] }
  const draft = { targetItemId: NE, targetAmount: 1, stageAtCreation: null, steps: [step], choices: {} }

  it('every action saves immediately and a fresh hydrate restores it exactly; several plans coexist, newest first', () => {
    const backend = memoryBackend()
    let n = 0
    const store = createPlansStore(backend, () => `plan${String(++n).padStart(6, '0')}`)
    const a = store.getState().create(draft, NOW)
    const b = store.getState().create({ ...draft, targetItemId: 4956, targetAmount: 3, stageAtCreation: 'early-hm' }, later(1))
    store.getState().setChecked(a.planId, step.stepId, true, later(2))
    store.getState().setOwned(a.planId, 'i:57', 10, later(3))
    store.getState().setOwned(a.planId, 'grp:any-iron-bar', 4, later(3))
    store.getState().setChoice(a.planId, `i:${NE}`, 'craft:273-ece382b6', [step], later(4))
    const reread = createPlansStore(backend).getState()
    expect(reread.loadStatus).toBe('loaded')
    expect(reread.plans.map((p) => p.planId)).toEqual([b.planId, a.planId])
    expect(reread.plans[1]).toMatchObject({ checkedStepIds: [step.stepId], owned: { 'i:57': 10, 'grp:any-iron-bar': 4 }, choices: { [`i:${NE}`]: 'craft:273-ece382b6' }, updatedAt: later(4).toISOString() })
    expect(reread.plans[0]).toMatchObject({ targetAmount: 3, stageAtCreation: 'early-hm' })
    expect(JSON.parse(backend.dump()[storageKey('plans')])).toMatchObject({ v: 1, gameVersion: meta.gameVersion })
  })

  it('un-check, owned 0, "Decide later", status, data update (drops vanished check marks) and delete', () => {
    const backend = memoryBackend()
    const store = createPlansStore(backend, () => 'plan000001')
    const p = store.getState().create(draft, NOW)
    const s = store.getState()
    s.setChecked(p.planId, step.stepId, true)
    s.setChecked(p.planId, 'gone-step', true)
    s.setChecked(p.planId, step.stepId, false)
    expect(store.getState().plans[0].checkedStepIds).toEqual(['gone-step'])
    s.setOwned(p.planId, 'i:57', 3)
    s.setOwned(p.planId, 'i:57', 0)
    expect(store.getState().plans[0].owned).toEqual({})
    s.setChoice(p.planId, 'i:1', 'craft:x', [step])
    s.setChoice(p.planId, 'i:1', null, [step])
    expect(store.getState().plans[0].choices).toBeUndefined()
    s.setStatus(p.planId, 'done')
    expect(createPlansStore(backend).getState().plans[0].status).toBe('done')
    s.updateSnapshot(p.planId, [step])
    expect(store.getState().plans[0].checkedStepIds).toEqual([])
    s.remove(p.planId)
    expect(createPlansStore(backend).getState().plans).toEqual([])
  })

  const valid = { plans: [savedPlan(NE, [step], { owned: { 'i:57': 2 }, checkedStepIds: [step.stepId], choices: { 'grp:any-iron-bar': 'i:22' }, targetAmount: 2 })] }
  const bad: Array<[string, unknown]> = [
    ['an unknown step kind', { plans: [savedPlan(NE, [{ ...step, kind: 'farm' as never }])] }],
    ['no steps', { plans: [savedPlan(NE, [])] }],
    ['a short plan id', { plans: [{ ...savedPlan(NE, [step]), planId: 'p1' }] }],
    ['a negative owned quantity', { plans: [savedPlan(NE, [step], { owned: { 'i:57': -1 } })] }],
    ['a choice keyed by something that is not a plan node', { plans: [savedPlan(NE, [step], { choices: { 'boss:plantera': 'x' } })] }],
    ['an unexpected key', { plans: [{ ...savedPlan(NE, [step]), extra: 1 }] }],
    ['a step ref that is not a typed ref', { plans: [savedPlan(NE, [{ ...step, refs: ['nonsense'] }])] }],
  ]

  it('the hand-written validator and the Zod PlansV1 agree (valid passes both; each invalid fails both)', () => {
    const envelope = (data: unknown) => ({ v: 1, savedAt: NOW.toISOString(), gameVersion: meta.gameVersion, data })
    expect(PlansV1.safeParse(envelope(valid)).success).toBe(true)
    const backend = memoryBackend({ [storageKey('plans')]: JSON.stringify(envelope(valid)) })
    expect(loadDomain('plans', backend)).toEqual({ kind: 'loaded', data: valid })
    for (const [label, data] of bad) {
      expect(PlansV1.safeParse(envelope(data)).success, label).toBe(false)
      const b = memoryBackend({ [storageKey('plans')]: JSON.stringify(envelope(data)) })
      expect(loadDomain('plans', b, NOW).kind, label).toBe('quarantined')
    }
    // stricter than the Zod shape (as tc.v1.builds): plan ids are unique in the list
    const dup = memoryBackend({ [storageKey('plans')]: JSON.stringify(envelope({ plans: [savedPlan(NE, [step]), savedPlan(NE, [step])] })) })
    expect(loadDomain('plans', dup, NOW).kind).toBe('quarantined')
  })

  it('an unreadable payload is quarantined (set aside, never deleted) and the store starts empty, saying so', () => {
    const raw = '{not json'
    const backend = memoryBackend({ [storageKey('plans')]: raw })
    const store = createPlansStore(backend)
    expect(store.getState()).toMatchObject({ plans: [], loadStatus: 'quarantined' })
    expect(Object.values(backend.dump())).toContain(raw)
    expect(Object.keys(backend.dump()).some((k) => k.startsWith('tc.quarantine.plans.'))).toBe(true)
  })

  it('a failed save keeps the change for this session and flags it', () => {
    const backend: StorageBackend = { getItem: () => null, setItem: () => { throw new DOMException('full', 'QuotaExceededError') }, removeItem: () => {} }
    const store = createPlansStore(backend, () => 'plan000001')
    store.getState().create(draft, NOW)
    expect(store.getState()).toMatchObject({ persistError: true })
    expect(store.getState().plans).toHaveLength(1)
  })

  it('refuses to persist an invalid plan (never writes what it couldn’t read back)', () => {
    const backend = memoryBackend()
    expect(() => saveDomain('plans', { plans: [savedPlan(NE, [])] }, backend)).toThrow(TypeError)
    expect(backend.dump()).toEqual({})
  })
})

// --- views -----------------------------------------------------------------------------------------------

describe("the plan views — Night's Edge (PRD P6-S5 AC2, §9 Feature B AC1/AC2; UX_SPEC §3.9)", () => {
  it('the tree: every item once with its quantity, how it is got, its link and availability; choices offered where ways differ', async () => {
    const { ctx, graph } = await computation(NE, {}, undefined, { choose: true })
    const html = wrap(createElement(PlanTreeView, { ctx, idPrefix: 't' }))
    expect(count(html, /data-plan-node="/g)).toBe(graph.nodes.size)
    expect(text(html)).toMatch(/Night's Edge × 1 Craft at Demon or Crimson Altar · recipe 1 of 2/)
    expect(text(html)).toContain('Demonite Ore × 30')
    expect(text(html)).toContain('Hellstone Bar × 20')
    // links: weapons in-app, Items in-app (P6 encyclopedia)
    expect(html).toContain(`href="/weapons/${NE}"`)
    expect(html).toContain(`href="/items/${idOf('Demonite Bar')}"`)
    // open nodes offer the chooser; the goal's recipe can be changed
    expect(html).toContain(`data-choose="i:${idOf('Hellstone Bar')}"`)
    expect(html).toContain(`data-choose="i:${NE}"`)
    // Unknown gating rendered as Unknown, verified-and-satisfied as "Obtainable now" — never a third invented state
    expect(html).toContain('data-unknown-field="gatedBy"')
    expect(html).toContain('data-availability="yes"')
    // 44px expand buttons: a static name, the state said once by aria-expanded (B118(j))
    expect(html).toMatch(/<button[^>]*aria-expanded="true"[^>]*aria-label="What goes into Night&#x27;s Edge"/)
    expect(html).not.toMatch(/aria-label="(Collapse|Expand) /)
  })

  it('read-only (the preview): no chooser, and the copy says the choice comes with the saved plan', async () => {
    const { ctx } = await computation(NE)
    const html = wrap(createElement(PlanTreeView, { ctx, idPrefix: 't' }))
    expect(html).not.toContain('data-choose=')
    expect(text(html)).toContain(copy.severalWays(2, false))
  })

  it('the checklist: groups in order, a check box + owned stepper per step, "Where do I find this?" per item, progress counted', async () => {
    const { ctx, steps } = await computation(NE, {}, { owned: { [itemKey(idOf('Demonite Bar'))]: 10 }, checkedStepIds: [] }, { choose: true })
    const html = wrap(createElement(PlanChecklist, { ctx, owned: { [itemKey(idOf('Demonite Bar'))]: 10 }, onCheck: () => {}, onOwned: () => {}, idPrefix: 'c' }))
    const groups = [...html.matchAll(/data-step-group="([^"]+)"/g)].map((m) => m[1])
    expect(groups[0]).toBe('choose')
    expect(groups.at(-1)).toBe('craft')
    // a check box per step the user can check (open / checked); the 2 complete by cause (bars owned, ore no
    // longer needed) carry a check mark and their cause instead (B118(c))
    expect(count(html, /data-step-check="/g)).toBe(steps.length - 2)
    expect(count(html, /data-step-done="/g)).toBe(2)
    expect(count(html, /data-owned-input="/g)).toBe(steps.length)
    expect(count(html, /data-where="/g)).toBe(steps.length)
    // owning the bars covers them and the ore beneath (recalculated, flowing down the plan)
    expect(html).toContain('data-progress="2/11"')
    expect(html).toMatch(/data-step="[^"]+"[^>]*data-status="owned"/)
    expect(html).toMatch(/data-step="[^"]+"[^>]*data-status="covered"/)
    expect(text(html)).toContain(copy.STATUS_TEXT.covered)
    // the stepper: numeric keyboard, ≥44px buttons, labelled
    expect(html).toMatch(/<input[^>]*type="number"[^>]*inputMode="numeric"|<input[^>]*inputmode="numeric"/i)
  })

  it('a route fact sheet: a drop route lists its sources with verified chances (or Unknown), never a ranking', async () => {
    const { graph } = await computation(NE)
    const muramasa = graph.nodes.get(itemKey(idOf('Muramasa')))
    if (muramasa?.kind !== 'item' || !muramasa.record) throw new Error('fixture')
    const html = wrap(createElement(RouteFacts, { record: muramasa.record, route: muramasa.routes[0], base }))
    expect(text(html)).toMatch(/Gold Chest \(Dungeon\) Chance: \d+(\.\d+)?%/)
  })
})

describe('the plan page body: header, notices, states (UX_SPEC §3.9, §5, §7, §8)', () => {
  const render = (plan: SavedPlan, comp: PlanComputation) => wrap(createElement(PlanDetail, { plan, comp, persistError: false, onCheck: () => {}, onOwned: () => {}, onUpdateSnapshot: () => {}, onDelete: () => {} }))

  it("Night's Edge: header progress, the basis of “obtainable now”, Compare routes, delete (confirmed), Tree | Checklist tabs; Unknown-heavy said", async () => {
    const comp = await computation(NE, {}, undefined, { choose: true })
    const html = render(savedPlan(NE, comp.steps), comp)
    expect(html).toContain(`data-header-progress="0/${comp.steps.length}"`)
    expect(text(html)).toContain(copy.BASIS_TITLE)
    expect(text(html)).toContain(copy.basisText(null, [], 0))
    expect(html).toContain('data-compare-routes=""')
    expect(html).toContain('data-delete-plan=""')
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>.*Tree/)
    expect(html).toContain('data-notice="unknown-heavy"')
    const { counts } = comp.ctx.view
    expect(text(html)).toContain(copy.unknownHeavyTitle(counts.unknown, counts.yes + counts.gated + counts.unknown))
    expect(html).not.toContain('data-notice="drift"')
    expect(html).not.toContain('data-notice="done"')
  })

  it('checking the goal completes the plan (banner in the checklist pane, said in the header); a changed data snapshot is reported with an update action', async () => {
    const fresh = await computation(NE)
    const goalStep = fresh.steps.find((s) => s.refs[0] === itemKey(NE))
    if (!goalStep) throw new Error('fixture')
    const done = await computation(NE, {}, { owned: {}, checkedStepIds: [goalStep.stepId] })
    const page = render(savedPlan(NE, done.steps, { checkedStepIds: [goalStep.stepId] }), done)
    // B118(b): the banner lives in the checklist pane's sticky progress strip, not above the panes
    expect(page).not.toContain('data-notice="done"')
    expect(/data-checklist-progress=""[\s\S]*?data-plan-complete=""/.test(page)).toBe(true)
    expect(page).toContain('data-header-done=""')
    const drift = render(savedPlan(NE, fresh.steps.slice(2), { snapshot: { generatedAt: NOW.toISOString(), gameVersion: '1.4.5.7', steps: fresh.steps.slice(2) } }), fresh)
    expect(drift).toContain('data-notice="drift"')
    expect(text(drift)).toContain(copy.driftBody(2, 0, true, '1.4.5.7', meta.gameVersion))
    expect(drift).toContain('data-update-snapshot=""')
  })

  it('a goal with no known source: said plainly, with its wiki source — no route, no farm advice', async () => {
    const noSource = [...RECORDS.values()].find((r) => r._prov.unverifiedFields.includes('acquisition') && base.docs.get(`i:${r.id}`))
    if (!noSource) throw new Error('fixture')
    const comp = await computation(noSource.id)
    const html = render(savedPlan(noSource.id, comp.steps), comp)
    expect(html).toContain('data-notice="no-source"')
    expect(html).toContain('data-no-source=""')
    expect(html).toContain('data-unknown-field="acquisition"')
    expect(html).not.toContain('data-notice="unknown-heavy"')
  })

  it('Zenith (stress): the whole tree renders — every node, each boss a linked step, nothing truncated', async () => {
    const z = idOf('Zenith')
    const comp = await computation(z, {}, undefined, { choose: true })
    const html = render(savedPlan(z, comp.steps), comp)
    expect(count(html, /data-plan-node="/g)).toBe(comp.graph.nodes.size)
    expect(comp.graph.nodes.size).toBeGreaterThan(25)
    expect(html).not.toContain('data-notice="truncated"')
    expect(html).toContain('href="/bosses/moon-lord"')
    expect(count(html, /data-step-kind="defeat-boss"/g)).toBe(comp.steps.filter((s) => s.kind === 'defeat-boss').length)
    // boss steps in progression order: Moon Lord last
    const bosses = comp.steps.filter((s) => s.kind === 'defeat-boss').map((s) => s.nodeId)
    expect(bosses.at(-1)).toBe('moon-lord')
  })

  it('a tracked defeat completes its boss step, said as marked on the boss map', async () => {
    const lum = idOf('Luminite')
    const comp = await computation(lum, {}, undefined, { progress: { worldEvil: null, nodeStates: { 'moon-lord': 'defeated' } } as never })
    const html = render(savedPlan(lum, comp.steps), comp)
    expect(text(html)).toContain(copy.BOSS_TRACKED)
    expect(html).toContain('data-availability="yes"')
  })
})

// --- entry points (PRD §9 Feature B AC5) ---------------------------------------------------------------------

describe('entry points: "What Should I Grind For?" on item and weapon pages (UX_SPEC §3.3, §3.10)', () => {
  it('the planner routes ship, so the CTA links /plan/new?item=:id', () => {
    expect(hasRoute('plan-new')).toBe(true)
    expect(planNewHref(273)).toBe('/plan/new?item=273')
    expect(planHref('p abc')).toBe('/plan/p%20abc')
  })

  it('the weapon page’s ActionRow and the item page’s header carry it', () => {
    const weapon = RECORDS.get(NE) as unknown as Weapon
    const w = wrap(createElement(WeaponDetailView, { weapon, sprites: null, acquisitionData: undefined, acquisition: null }))
    const grind = /<a [^>]*data-grind-link="(\d+)"[^>]*>/.exec(w)?.[0] ?? ''
    expect(grind).toContain(`href="/plan/new?item=${NE}"`)
    expect(text(w)).toContain(copy.GRIND_CTA)
    const bar = RECORDS.get(idOf('Demonite Bar')) as unknown as Item
    const i = wrap(createElement(ItemDetailView, { item: bar, sprites: null, sections: undefined, acquisition: null, usedIn: null }))
    expect(i).toContain(`href="/plan/new?item=${bar.id}"`)
  })
})

// --- copy audit (PRD §9 Feature B AC3; brief: no invented farm advice) ---------------------------------------

/** Plan-specific bans on top of the shared audit: time / effort estimates, farming advice, ranking words. */
const PLAN_BANNED = /\b\d+\s*(?:seconds?|minutes?|mins?|hours?|hrs?)\b|\bfarm(?:ing)? (?:for|it|them|this)\b|\b(?:easy|easier|easiest|fastest|quickest|quickly|optimal|recommended|should farm)\b|\bbest\b/i

function auditPlan(t: string): string | undefined {
  return auditCopy(t) ?? PLAN_BANNED.exec(t)?.[0]
}

/** Every string in planCopy, functions called with sample arguments. */
function allCopy(): string[] {
  const out: string[] = []
  const sample = (fn: (...a: never[]) => unknown) => {
    const args = Array.from({ length: fn.length }, (_, i) => (i === 0 ? 3 : i === 1 ? 2 : 1)) as never[]
    for (const a of [args, ['Night’s Edge', 'Iron Bar', 'Zenith'] as never[], [5, 0, 1, 2] as never[], [null, ['Wall of Flesh'], 2] as never[], ['early', ['A'], 1] as never[]]) {
      try {
        const v = fn(...a)
        if (typeof v === 'string') out.push(v)
        else if (v && typeof v === 'object') out.push(...Object.values(v).filter((x): x is string => typeof x === 'string'))
      } catch {
        /* not this signature */
      }
    }
  }
  for (const value of Object.values(copy)) {
    if (typeof value === 'string') out.push(value)
    else if (typeof value === 'function') sample(value as (...a: never[]) => unknown)
    else if (value && typeof value === 'object') out.push(...Object.values(value).filter((x): x is string => typeof x === 'string'))
  }
  return out
}

describe('copy audit: quantities and sources from the data only — no time estimates, farming advice or ranking', () => {
  it('every plan string passes', () => {
    const strings = allCopy()
    expect(strings.length).toBeGreaterThan(100)
    for (const s of strings) expect(auditPlan(s), s).toBeUndefined()
  })

  it('the bans catch what they should (the audit is not vacuous)', () => {
    for (const s of ['Farm for 20 minutes', 'the best route', 'the easiest way', 'about 2 hours', 'fastest drop']) expect(auditPlan(s), s).toBeDefined()
  })

  it('the rendered plans (Night’s Edge, Zenith, Ankh Shield) pass, wiki-quoted text aside', async () => {
    for (const goal of [NE, idOf('Zenith'), idOf('Ankh Shield')]) {
      const comp = await computation(goal, {}, undefined, { choose: true })
      const html = wrap(createElement(PlanDetail, { plan: savedPlan(goal, comp.steps), comp, persistError: true, onCheck: () => {}, onOwned: () => {}, onUpdateSnapshot: () => {}, onDelete: () => {} }))
      // wiki-quoted text and the shared Unknown marker's own wording (src/components/UnknownValue) aside
      const stripped = text(html.replace(/<p data-wiki-text=""[^>]*>[\s\S]*?<\/p>/g, '').replace(/<(button|span)[^>]*data-unknown-field="[^"]*"[^>]*>[\s\S]*?<\/\1>/g, 'Unknown'))
      expect(auditPlan(stripped), String(goal)).toBeUndefined()
    }
  })
})

// --- AMENDMENTS-016 B118 (planner review rulings) ---------------------------------------------------------------

describe('B118 — planner review fixes', () => {
  const renderPage = (plan: SavedPlan, comp: PlanComputation) => wrap(createElement(PlanDetail, { plan, comp, persistError: false, onCheck: () => {}, onOwned: () => {}, onUpdateSnapshot: () => {}, onDelete: () => {} }))
  const renderList = (comp: PlanComputation, owned: Record<string, number> = {}) => wrap(createElement(PlanChecklist, { ctx: comp.ctx, owned, onCheck: () => {}, onOwned: () => {}, idPrefix: 'c' }))
  const stepOf = (comp: PlanComputation, id: number) => comp.steps.find((s) => s.refs[0] === itemKey(id))?.stepId ?? ''

  it('(a) ONE progress semantics: the list counts exactly what the page counts, and never shows "Done" beside a partial count', async () => {
    const bar = itemKey(idOf('Demonite Bar'))
    const fresh = await computation(NE)
    const state = { owned: { [bar]: 10 }, checkedStepIds: [stepOf(fresh, idOf('Muramasa'))] }
    const comp = await computation(NE, {}, state)
    // the stored status is stale ("done") — the list must not trust it
    const plan = savedPlan(NE, comp.steps, { ...state, status: 'done' })
    const { complete, total } = comp.ctx.view
    expect(complete).toBeGreaterThan(1)
    expect(complete).toBeLessThan(total)
    expect(renderPage(plan, comp)).toContain(`data-header-progress="${complete}/${total}"`)
    const summary = planSummary(base, plan, NONE_PROGRESS, null)
    expect(summary).toEqual({ kind: 'progress', complete, total, done: false })
    const card = wrap(createElement(PlanCardProgress, { summary }))
    expect(card).toContain(`data-plan-progress="${complete}/${total}"`)
    expect(text(card)).toContain(`${copy.STATUS_ACTIVE} ${copy.progressLine(complete, total)}`)
    expect(text(card)).not.toContain(copy.STATUS_DONE)
    // the goal checked: "Done" with M of M
    const done = savedPlan(NE, comp.steps, { checkedStepIds: [stepOf(fresh, NE)] })
    const doneCard = wrap(createElement(PlanCardProgress, { summary: planSummary(base, done, NONE_PROGRESS, null) }))
    expect(doneCard).toContain(`data-plan-progress="${total}/${total}"`)
    expect(text(doneCard)).toContain(copy.STATUS_DONE)
    // while it can't be counted yet: neither status nor a number
    expect(text(wrap(createElement(PlanCardProgress, { summary: 'loading' }))).trim()).toBe(copy.COUNTING)
    expect(wrap(createElement(PlanCardProgress, { summary: 'loading' }))).not.toContain(copy.STATUS_DONE)
  })

  it('(b) completion lives in the checklist pane: a sticky strip with the bar, the count and the banner; one bar on the page', async () => {
    const fresh = await computation(NE)
    const done = await computation(NE, {}, { owned: {}, checkedStepIds: [stepOf(fresh, NE)] })
    const list = renderList(done)
    const strip = /<div class="([^"]*)" data-checklist-progress="">([\s\S]*?)<\/div><section/.exec(list)
    // pinned under the site header by its shared height token (B119), not a copied 64px
    expect(strip?.[1]).toMatch(/\bsticky\b.*\btop-header\b/)
    expect(strip?.[2]).toContain('data-plan-complete=""')
    expect(text(strip?.[2] ?? '')).toContain(copy.DONE_TITLE)
    expect(text(strip?.[2] ?? '')).toContain(copy.progressLine(done.ctx.view.total, done.ctx.view.total))
    // not done: no banner
    expect(renderList(fresh)).not.toContain('data-plan-complete')
    // the header keeps the words, the checklist pane the only bar (the 1440 two-bars trim)
    expect(count(renderPage(savedPlan(NE, done.steps), done), /block h-full bg-forest-500/g)).toBe(1)
  })

  it('(c) a step complete by cause is not an unchecked box: a map-defeated boss reads "Complete:" with its cause', async () => {
    const lum = idOf('Luminite')
    const comp = await computation(lum, {}, undefined, { progress: { worldEvil: null, nodeStates: { 'moon-lord': 'defeated' } } as never })
    const html = renderList(comp)
    const boss = /<li data-step="([^"]+)" data-step-kind="defeat-boss" data-status="progress"[\s\S]*?<\/li>/.exec(html)
    expect(boss).not.toBeNull()
    const row = boss?.[0] ?? ''
    expect(row).not.toContain('type="checkbox"')
    expect(row).toContain('data-step-done="progress"')
    expect(text(row)).toContain(`${copy.COMPLETE_SR}Defeat Moon Lord`)
    expect(text(row)).toContain(copy.BOSS_TRACKED)
    // open steps keep a real, unchecked box; a checked step's box is checked
    const ne = await computation(NE)
    const checked = await computation(NE, {}, { owned: {}, checkedStepIds: [stepOf(ne, idOf("Light's Bane"))] })
    const neList = renderList(checked)
    expect(neList).toMatch(new RegExp(`<input id="c-c-${stepOf(ne, idOf("Light's Bane"))}" type="checkbox"[^>]*checked=""`))
    expect(count(neList, /type="checkbox"/g) + count(neList, /data-step-done="/g)).toBe(checked.steps.length)
  })

  it('(d) the circular note names the item the way needs (Glass), in the tree', async () => {
    const glass = idOf('Glass')
    const fresh = await computation(glass)
    const g = fresh.graph.nodes.get(itemKey(glass)) as PlanItemNode
    const comp = await computation(glass, { [itemKey(glass)]: g.routes[0].key }, undefined, { choose: true })
    const t = text(wrap(createElement(PlanTreeView, { ctx: comp.ctx, idPrefix: 't' })))
    expect(t).toContain(copy.circular('Glass', 'Glass Wall'))
    expect(t).not.toMatch(/needs Glass Wall/)
  })

  it('(e) a boss step says which of the plan’s items it was derived from', async () => {
    const comp = await computation(idOf('Luminite'))
    expect(text(renderList(comp))).toContain(copy.bossFor(['Luminite']))
  })

  it('(f) the chooser: drop sources counted as the tree counts them, bosses and stations linked, quantities the tree’s own', async () => {
    const hb = idOf('Hallowed Bar')
    const hallowed = (await computation(hb)).graph.nodes.get(itemKey(hb)) as PlanItemNode
    if (!hallowed.record) throw new Error('fixture')
    const drop = hallowed.routes.find((r) => r.method === 'drop')
    if (!drop) throw new Error('fixture: Hallowed Bar drop route')
    const facts = wrap(createElement(RouteFacts, { record: hallowed.record, route: drop, base }))
    // 6 drop records (3 mechs + their Treasure Bags) are 3 sources — as the tree's "Drops from 3 sources"
    expect(count(facts, /data-drop-source="/g)).toBe(3)
    expect(routeLine(hallowed.record, drop, base)).toBe(copy.dropSources(3))
    for (const boss of ['skeletron-prime', 'the-destroyer', 'the-twins']) expect(facts).toContain(`href="/bosses/${boss}"`)

    // Night's Edge → Hellstone Bar (several ways, none picked): the craft way's needs for THIS plan's 20 bars
    const ne = await computation(NE, {}, undefined, { choose: true })
    const hsb = idOf('Hellstone Bar')
    const node = ne.graph.nodes.get(itemKey(hsb)) as PlanItemNode
    const craft = node.routes.find((r) => r.method === 'craft')
    if (!node.record || !craft?.recipe) throw new Error('fixture: Hellstone Bar recipe')
    const amount = ne.ctx.structural.get(itemKey(hsb))?.total ?? 0
    const chooser = text(wrap(createElement(RouteFacts, { record: node.record, route: craft, base, scale: { amount, name: 'Hellstone Bar' } })))
    const crafts = Math.ceil(amount / craft.recipe.resultAmount)
    expect(chooser).toContain(copy.needsFor(amount, 'Hellstone Bar', crafts))
    // … which are exactly the tree's numbers once that way is in use
    const chosen = await computation(NE, { [itemKey(hsb)]: craft.key })
    for (const ing of craft.recipe.ingredients) {
      if (ing.ref.kind !== 'item') continue
      const words = `${(ing.amount * crafts).toLocaleString('en-US')} ${chosen.ctx.info(itemKey(ing.ref.itemId)).name}`
      expect(chooser).toContain(words)
      expect(chosen.ctx.structural.get(itemKey(ing.ref.itemId))?.total).toBe(ing.amount * crafts)
    }
    // its station links its item page
    const station = craft.recipe.stations.find((s) => s.kind === 'item')
    if (station?.kind === 'item' && base.acquisition.items?.ids.has(station.itemId)) {
      expect(wrap(createElement(RouteFacts, { record: node.record, route: craft, base }))).toContain(`href="/items/${station.itemId}"`)
    }
  })

  it('(g) a pick is announced with what it did and the new count', async () => {
    const fresh = await computation(NE)
    const root = fresh.graph.nodes.get(itemKey(NE)) as PlanItemNode
    const second = root.routes[1]
    const after = await computation(NE, { [itemKey(NE)]: second.key })
    const { complete, total } = after.ctx.view
    expect(choiceAnnouncement(base, after.graph, itemKey(NE), second.key, after.ctx.view)).toBe(copy.routeAnnounce("Night's Edge", `${copy.craftAt('Demon or Crimson Altar')} · ${copy.recipeOf(2, 2)}`, complete, total))
    expect(choiceAnnouncement(base, fresh.graph, itemKey(idOf('Hellstone Bar')), null, fresh.ctx.view)).toBe(copy.laterAnnounce('Hellstone Bar', fresh.ctx.view.complete, fresh.ctx.view.total))
    // "Decide later" on a recipes-only item goes back to its listed recipe — said so, not "a choice again"
    const glass = await computation(idOf('Glass'))
    expect(choiceAnnouncement(base, glass.graph, itemKey(idOf('Glass')), null, glass.ctx.view)).toBe(
      copy.defaultAnnounce('Glass', `${copy.craftAt('Furnace')} · ${copy.recipeOf(3, 3)}`, glass.ctx.view.complete, glass.ctx.view.total),
    )
    const g = glass.graph.nodes.get(itemKey(idOf('Glass'))) as PlanItemNode
    expect(defaultSelection(g.routes, g.heldRoutes)).toEqual(g.selection)
  })

  it('(h) a covered subtree collapses to one note in the tree', async () => {
    const lb = idOf("Light's Bane")
    const fresh = await computation(NE)
    const comp = await computation(NE, {}, { owned: {}, checkedStepIds: [stepOf(fresh, lb)] })
    const html = wrap(createElement(PlanTreeView, { ctx: comp.ctx, idPrefix: 't' }))
    expect(html).toMatch(new RegExp(`data-plan-node="i:${lb}" data-open="false"`))
    expect(html).toContain('data-covered-beneath="2"')
    expect(text(html)).toContain(copy.coveredBeneath('checked', 2))
    // the bars and ore beneath it aren't drawn one "not needed" line each
    expect(html).not.toContain(`data-plan-node="i:${idOf('Demonite Bar')}"`)
    expect(count(html, /data-covered-beneath="/g)).toBe(1)
  })

  it('(i) the quarantine notice says the whole saved set was set aside, valid plans included', () => {
    expect(copy.QUARANTINE).toMatch(/whole saved set was set aside \(not deleted\)/)
    expect(copy.QUARANTINE).toMatch(/including any plans in it that were fine/)
  })

  it('(j) nits: grammar, single accessible names, skipped recipes said inline, wiki words for described ways, no native spinners, a chooser on every multi-way step', async () => {
    expect(copy.unknownCountLine(1, 5)).toMatch(/^1 of the 5 items in this plan has Unknown availability: the dataset can’t confirm whether it is/)
    expect(copy.unknownCountLine(2, 5)).toMatch(/2 of the 5 items in this plan have Unknown/)
    // B120: the last sentence agrees in number too; exactly half isn't titled "Mostly"
    expect(copy.unknownCountLine(1, 2)).toMatch(/ Its step and sources still come from the data\.$/)
    expect(copy.unknownCountLine(2, 5)).toMatch(/ Their steps and sources still come from the data\.$/)
    expect(copy.unknownCountLine(1, 2)).not.toMatch(/Their/)
    expect([copy.unknownHeavyTitle(1, 2), copy.unknownHeavyTitle(3, 6)]).toEqual([copy.UNKNOWN_HALF_TITLE, copy.UNKNOWN_HALF_TITLE])
    expect([copy.unknownHeavyTitle(2, 3), copy.unknownHeavyTitle(7, 11), copy.unknownHeavyTitle(4, 4)]).toEqual([copy.UNKNOWN_HEAVY_TITLE, copy.UNKNOWN_HEAVY_TITLE, copy.UNKNOWN_HEAVY_TITLE])
    expect(copy.UNKNOWN_HALF_TITLE).not.toMatch(/mostly/i)
    const ne = await computation(NE, {}, undefined, { choose: true })
    const page = renderPage(savedPlan(NE, ne.steps), ne)
    // every chooser button has ONE name: "Choose a way to get X" / "Change how to get X" (no "Choose a way — Choose how…")
    for (const m of page.matchAll(/<button[^>]*data-(?:compare-)?choose="[^"]+"[^>]*>([\s\S]*?)<\/button>/g)) expect(text(m[1]).trim()).toMatch(/^(Choose a way to get|Change how to get) \S/)
    expect(text(page)).toContain("Item page for Night's Edge")
    expect(text(page)).not.toMatch(/page — Open the/)
    // checklist groups are plain sections under their headings (not regions named by them)
    expect(page).not.toMatch(/<section aria-labelledby="[^"]*" data-step-group/)
    // Night's Edge (2 recipes) has its chooser in the checklist too
    expect(renderList(ne)).toContain(`data-choose="i:${NE}"`)
    // "recipe 3 of 3" says why recipes 1–2 weren't picked
    const glass = text(wrap(createElement(PlanTreeView, { ctx: (await computation(idOf('Glass'))).ctx, idPrefix: 't' })))
    expect(glass).toContain(copy.skippedNote([copy.skippedReversal(1, 'Glass Wall', 'Glass'), copy.skippedReversal(2, 'Glass Platform', 'Glass')]))
    // Jungle Spores: the wiki's own words, not "another way"
    const tree = wrap(createElement(PlanTreeView, { ctx: ne.ctx, idPrefix: 't' }))
    expect(tree).toMatch(/<p data-wiki-text=""[^>]*>Jungle Spores are /)
    expect(wrap(createElement(OwnedQtyInput, { id: 'x', name: 'Stinger', value: 0, onChange: () => {} }))).toContain('[&amp;::-webkit-inner-spin-button]:appearance-none')
  })

  it('(g)(j) delete feedback: the store carries a one-time message for the list, never persisted', () => {
    const backend = memoryBackend()
    const store = createPlansStore(backend, () => 'plan000001')
    store.getState().setFlash(copy.deletedNotice("Night's Edge"))
    expect(store.getState().flash).toBe("Deleted the plan for Night's Edge.")
    expect(JSON.stringify(backend.dump())).not.toContain('Deleted the plan')
    store.getState().setFlash(null)
    expect(store.getState().flash).toBeNull()
  })
})
