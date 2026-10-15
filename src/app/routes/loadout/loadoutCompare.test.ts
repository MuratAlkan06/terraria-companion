/* Loadout Builder P4-S3/S4 UI (PRD P4-S3 AC1/AC2, P4-S4 AC1–AC4; UX_SPEC §1, §3.5 Step3/Step4, §5.2, §8;
 * SCORING_SPEC §4.8, §5.3; AMENDMENTS-016 B106 queue): the URL's new state (surprise seed, the compared
 * build, the builds view), the comparison model (a saved build AS SAVED — never refilled; slot diffs with
 * emptied vs unfilled told apart; differences stated, not judged), the Step 3 bars (stated scales,
 * est. chips on reference figures, past-the-end said in words) and per-item contributions, Step 4
 * "Compare & Save" (profile rows, goal fit + its breakdown, slot by slot, Surprise Me, the readiness
 * import link), the saved-builds view and the copy audit over all of it. Live data via accessors only —
 * the dataset may be regenerated under these tests. */
import { Tooltip } from 'radix-ui'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import type { Accessory, ArmorPiece, ArmorSet, Boss, Buff, Condition, Item, ProgressionEdge, ProgressionNode, Weapon } from '../../../data-access/types'
import accessoriesJson from '../../../data/accessories.detail.json'
import armorJson from '../../../data/armor.detail.json'
import setsJson from '../../../data/armor-sets.json'
import bossesJson from '../../../data/bosses.json'
import buffsJson from '../../../data/buffs.json'
import conditionsJson from '../../../data/conditions.json'
import itemUniverseJson from '../../../data/item-universe.json'
import itemsJson from '../../../data/items.detail.json'
import progressionJson from '../../../data/progression.json'
import weaponsJson from '../../../data/weapons.detail.json'
import { auditCopy } from '../../../scoring/copyAudit'
import type { TrackedProgress } from '../../../scoring/progress'
import { recommendLoadout, SEED_MAX, type BuilderResult, type Pins } from '../../../scoring/recommend'
import { profileReferences, type ProfileReference, type ReferencedComponent } from '../../../scoring/references'
import { BUILD_GOALS, buildItemIds, type SavedBuild } from '../../../storage/builds'
import { assembleReadinessData } from '../bosses/readiness/readinessData'
import { BuildsView } from './BuildsView'
import { barScale, contributionParts, deltaText, diffSlots, differingSlots, frozenPinsFromBuild, goalFit, profileRows, runSavedBuild } from './loadoutCompare'
import * as copy from './loadoutCopy'
import { ProfileBar, SurpriseBanner } from './LoadoutBits'
import { BUILDS_VIEW_HREF, buildOpenHref } from './loadoutLinks'
import { draftFrom, effectiveInputs, engineInput, loadoutSearch, newSeed, parseLoadoutSearch, stateFromBuild, withInputs, withPin, type LoadoutState } from './loadoutModel'
import { Alternatives, LoadoutStep, type LoadoutStepProps } from './LoadoutStep'
import { SaveStep, type SaveStepProps } from './SaveStep'
import { WhyStep } from './WhyStep'

const byId = <T extends { id: K }, K>(list: readonly T[]) => new Map(list.map((x) => [x.id, x]))
const bosses = bossesJson as unknown as Boss[]
const progression = progressionJson as { nodes: ProgressionNode[]; edges: ProgressionEdge[] }
const weapons = weaponsJson as unknown as Weapon[]
const page = assembleReadinessData({
  map: { progression: { ...progression, nodeById: byId(progression.nodes) }, bosses, sprites: null },
  weapons: byId(weapons),
  armor: byId(armorJson as unknown as ArmorPiece[]),
  accessories: byId(accessoriesJson as unknown as Accessory[]),
  sets: byId(setsJson as unknown as ArmorSet[]),
  items: itemsJson as unknown as Item[],
  buffs: buffsJson as unknown as Buff[],
  conditions: { byId: byId(conditionsJson as unknown as Condition[]) },
  names: { byId: new Map(itemUniverseJson.items.flatMap((i) => (i.name ? [[i.id, i.name] as const] : []))), bySlug: new Map() },
})
const isBoss = (id: string) => page.engine.bosses.has(id)
const NONE: TrackedProgress = { worldEvil: null, nodeStates: {} }
const parse = (search: string) => parseLoadoutSearch(new URLSearchParams(search), isBoss)
const run = (state: LoadoutState, progress: TrackedProgress = NONE) => {
  const eff = effectiveInputs(state, null)
  return { eff, result: recommendLoadout(engineInput(eff, progress, state.pins, state.surprise), page.engine) }
}
const wrap = (el: ReactElement) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Tooltip.Provider, null, el)))
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
/** Our own words: verbatim wiki texts (“…”) and the UnknownValue marker's §5.3 wording removed. */
const ownText = (html: string) => text(html.replace(/<(button|span)[^>]*data-unknown-field="[^"]*"[^>]*>Unknown<span class="sr-only">[^<]*<\/span><\/\1>/g, ' Unknown ')).replace(/“[^”]*”/g, ' ')
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length
const WINNER = /\bbetter\b|\bwinner\b|\bwins?\b|\bstronger\b|\bweaker\b|\bworse\b|\bahead\b|\bbest\b|\brecommended build\b/i
const stamp = { createdAt: '2026-10-14T12:00:00.000Z', updatedAt: '2026-10-14T12:00:00.000Z' }

/** A saved build from a draft state (Save's own path, draftFrom). */
function saveOf(state: LoadoutState, buildId: string, name = 'Saved one', progress: TrackedProgress = NONE): SavedBuild {
  const { eff, result } = run(state, progress)
  return { ...draftFrom(name, eff, result, state.pins), buildId, ...stamp }
}

describe('URL state: the surprise seed, the compared build and the builds view (UX_SPEC §10.11 deep links restore state)', () => {
  it('round-trip through the query string; absent by default', () => {
    const state: LoadoutState = { step: 4, cls: 'ranged', owned: [], pins: {}, build: 'b-test-0001', surprise: 123456789, vs: 'b-test-0002' }
    const search = loadoutSearch(state)
    expect(search).toBe('?step=4&class=ranged&build=b-test-0001&surprise=123456789&vs=b-test-0002')
    expect(parse(search)).toEqual({ state, notices: [] })
    expect(parse('?view=builds')).toEqual({ state: { step: 1, owned: [], pins: {}, view: 'builds' }, notices: [] })
    expect(BUILDS_VIEW_HREF).toBe('/loadout?view=builds')
    expect(loadoutSearch({ step: 1, owned: [], pins: {}, view: 'builds' })).toBe('?view=builds')
    expect(buildOpenHref('b-test-0001')).toBe('/loadout?build=b-test-0001')
  })

  it('what a link can’t use is said, never silently dropped: a seed out of range, a bad build id, an unknown view', () => {
    for (const bad of [`?surprise=${SEED_MAX + 1}`, '?surprise=-1', '?surprise=1e3', '?vs=x', '?view=list']) {
      const { state, notices } = parse(bad)
      expect(notices, bad).toEqual([copy.linkIgnored(copy.LINK_VALUES)])
      expect([state.surprise, state.vs, state.view], bad).toEqual([undefined, undefined, undefined])
    }
  })

  it('a fresh seed is an unsigned 32-bit integer ≥ 1; an input change keeps the draw (re-drawn for the new inputs, legally)', () => {
    expect(newSeed(() => 0)).toBe(1)
    expect(newSeed(() => 0.999999999)).toBeLessThanOrEqual(SEED_MAX)
    const state: LoadoutState = { step: 2, stage: 'early-hm', owned: [], pins: {}, surprise: 9 }
    expect(withInputs(state, { stage: 'mid-hm' }).next.surprise).toBe(9)
  })
})

describe('the comparison model (PRD P4-S4 AC1; SCORING_SPEC §5.3)', () => {
  const base: LoadoutState = { step: 2, stage: 'early-prehm', cls: 'melee', difficulty: 'expert', goal: 'boss', owned: [], pins: {} }
  const saved = saveOf(base, 'b-test-0101')

  it('a saved build is scored AS SAVED: every stored slot back, no slot refilled — even when tracked progress opens more (the Wall of Flesh marked: the Demon Heart slot stays as saved)', () => {
    const wof: TrackedProgress = { worldEvil: null, nodeStates: { 'wall-of-flesh': 'defeated' } }
    for (const progress of [NONE, wof]) {
      const r = runSavedBuild(saved, page.engine, progress)
      expect(r.result.loadout).toEqual(saved.slots)
      expect(r.result.notices).toEqual([])
    }
    // frozen pins: every slot holds a pin; the stored empties are pinned empty
    const pins = frozenPinsFromBuild(saved, page.engine)
    expect(Object.keys(pins).sort()).toEqual(['acc0', 'acc1', 'acc2', 'acc3', 'acc4', 'acc5', 'acc6', 'alt', 'ammo0', 'ammo1', 'armor', 'buff0', 'buff1', 'buff2', 'main', 'summon'])
  })

  it('a swap shows as a "Different" row; nothing else differs; the profile delta is stated draft − saved', () => {
    const opened = stateFromBuild(saved, page.engine)
    const main = run(opened).result.slots.find((s) => s.id === 'main')
    // not the saved alt: pinning that as main would move the alt too
    const other = main?.alternatives.find((a) => a.id !== saved.slots.altWeapon)
    if (!other) throw new Error('no alternative main weapon at Early Pre-Hardmode')
    const pins = withPin(opened.pins, 'main', { kind: 'item', id: other.id })
    const draft = run({ ...opened, pins }).result
    const rows = diffSlots({ result: draft, pins }, runSavedBuild(saved, page.engine, NONE))
    const changed = rows.filter((r) => r.status !== 'same' && r.status !== 'both-empty')
    expect(changed.map((r) => r.slot)).toEqual(['main'])
    expect(changed[0]).toMatchObject({ status: 'changed', draft: { kind: 'item', id: other.id }, saved: { kind: 'item', id: saved.slots.mainWeapon } })
    expect(differingSlots(rows)).toBe(1)
    const edo = profileRows(draft.profile, runSavedBuild(saved, page.engine, NONE).result.profile).find((r) => r.id === 'estDamage')
    const d = draft.profile.components[0].value as number
    const s = runSavedBuild(saved, page.engine, NONE).result.profile.components[0].value as number
    expect(edo?.delta).toBeCloseTo(d - s, 10)
    expect(edo?.deltaText).toBe(deltaText('estDamage', d - s))
    expect(edo?.deltaText).toMatch(/^[+−][\d,.]+$/)
  })

  it('emptied slots: user-emptied in the draft vs an item saved; on the saved side, emptied-by-you told apart from left-empty-by-the-recommendation', () => {
    const draftState: LoadoutState = { ...stateFromBuild(saved, page.engine), pins: withPin(stateFromBuild(saved, page.engine).pins, 'acc0', { kind: 'empty' }) }
    const draft = run(draftState).result
    const rows = diffSlots({ result: draft, pins: draftState.pins }, runSavedBuild(saved, page.engine, NONE))
    expect(rows.find((r) => r.slot === 'acc0')).toMatchObject({ status: 'saved-only', draft: { kind: 'emptied' }, saved: { kind: 'item' } })

    // a v2 build with a user-emptied summon slot and a slot the recommendation left unfilled
    const v2State: LoadoutState = { ...base, pins: { summon: { kind: 'empty' } } }
    const v2 = saveOf(v2State, 'b-test-0102')
    expect(v2.emptiedSlots).toEqual(['summon'])
    const v2Run = runSavedBuild(v2, page.engine, NONE)
    const unfilled = v2Run.result.slots.filter((s) => s.state === 'empty' && !(s.group === 'ammo' && !s.ammoClass) && s.id !== 'summon').map((s) => s.id)
    expect(unfilled.length).toBeGreaterThan(0)
    const fresh = run(base)
    const rows2 = diffSlots({ result: fresh.result, pins: {} }, v2Run)
    expect(rows2.find((r) => r.slot === 'summon')?.saved.kind).toBe('emptied')
    for (const id of unfilled) expect(rows2.find((r) => r.slot === id)?.saved.kind, id).toBe('unfilled')
    // the same build as v1 (no marker): every stored empty slot reads as emptied (ammo aside), as v1 builds always reopened
    const { emptiedSlots: _e, ...v1 } = v2
    const rows3 = diffSlots({ result: fresh.result, pins: {} }, runSavedBuild(v1, page.engine, NONE))
    for (const id of unfilled.filter((x) => !x.startsWith('ammo'))) expect(rows3.find((r) => r.slot === id)?.saved.kind, id).toBe('emptied')
  })

  it('different difficulties: a slot one build lacks reads "No such slot"; a locked Demon Heart slot reads locked', () => {
    const classic = saveOf({ ...base, difficulty: 'classic' }, 'b-test-0103')
    const draft = run({ ...base, difficulty: 'master' })
    const rows = diffSlots({ result: draft.result, pins: {} }, runSavedBuild(classic, page.engine, NONE))
    expect(rows.find((r) => r.slot === 'acc5')?.saved.kind).toBe('no-slot')
    expect(rows.find((r) => r.slot === 'acc6')?.draft.kind).toBe('locked')
    expect(rows.find((r) => r.slot === 'acc6')?.status).toBe('both-empty')
  })

  it('profile rows: each bar runs to the higher of the two (class synergy to 100); deltas in the figure’s own precision; "same" when equal', () => {
    const a = run({ ...base, goal: 'boss' }).result.profile
    const b = run({ ...base, goal: 'mobility' }).result.profile
    for (const row of profileRows(a, b)) {
      const max = row.id === 'classSynergy' ? 100 : Math.max(row.draft.value ?? 0, row.saved.value ?? 0)
      if (row.draft.value !== undefined && max > 0) expect(row.draftBar).toBeCloseTo(row.draft.value / max, 10)
      if (row.saved.value !== undefined && max > 0) expect(row.savedBar).toBeCloseTo(row.saved.value / max, 10)
      if (row.id !== 'classSynergy' && max > 0) expect(Math.max(row.draftBar ?? 0, row.savedBar ?? 0)).toBe(1)
    }
    expect([deltaText('defense', 3), deltaText('defense', -2), deltaText('mobility', 2.5), deltaText('mobility', 0), deltaText('estDamage', 0.04), deltaText('estDamage', undefined)]).toEqual(['+3', '−2', '+2.5', copy.DELTA_SAME, copy.DELTA_SAME, copy.DELTA_NONE])
  })
})

describe('PRD P4-S3 AC2 / AMENDMENTS-016 B113a: the profile as labelled bars against a pick-independent reference, with a tick', () => {
  const state: LoadoutState = { step: 3, stage: 'early-hm', cls: 'ranged', difficulty: 'expert', goal: 'balanced', owned: [], pins: {} }
  const { eff, result } = run(state)
  const references = profileReferences(engineInput(eff, NONE, {}), page.engine)
  const html = wrap(createElement(WhyStep, { page, result, eff, references }))
  const card = (id: string, out = html) => new RegExp(`data-component="${id}"[\\s\\S]*?</li>`).exec(out)?.[0] ?? ''

  it('every computed figure has a bar and says what it is measured against: the tick’s figure (est.), the highest found among verified-obtainable gear; class synergy 0 to 100', () => {
    expect(text(html)).toContain(copy.PROFILE_BARS_NOTE)
    for (const c of result.profile.components) {
      if (c.value === undefined) {
        expect(card(c.id), c.id).not.toContain('data-figure-bar')
        continue
      }
      const ref = c.id === 'classSynergy' ? undefined : references[c.id]
      if (ref && (ref.value === undefined || ref.value <= 0)) {
        expect(card(c.id), c.id).toContain('data-bar-none')
        continue
      }
      expect(card(c.id), c.id).toContain(`data-figure-bar="${c.id}"`)
      const caption = text(/data-bar-scale=""[\s\S]*?<\/p>/.exec(card(c.id))?.[0] ?? '')
      if (c.id === 'classSynergy') expect(caption).toContain(copy.BAR_OF_100)
      else {
        const id = c.id as ReferencedComponent
        expect(caption, c.id).toContain(copy.BAR_TICK_LEAD)
        expect(caption, c.id).toContain(ref?.text)
        expect(caption, c.id).toContain(copy.BAR_TICK_BASIS[id].trim())
        // the reference figure is an estimate too: its own est. chip, with its own words
        expect(card(c.id), c.id).toContain(`data-estimate="${copy.referenceContext(copy.REFERENCE_WHAT[id])}"`)
        // the tick marks the reference; the bar is full only when the loadout reaches it
        const scale = barScale(c.value, ref?.value)
        expect(card(c.id), c.id).toContain(`data-bar-tick="${scale?.tick.toFixed(3)}"`)
        expect(card(c.id), c.id).toContain(`data-bar="${scale?.fill.toFixed(3)}"`)
        if (scale && scale.fill >= 1 - 1e-9 && !scale.past) expect(text(card(c.id)), c.id).toContain(copy.BAR_REACHED)
      }
    }
  })

  it('B113a: the reviewer’s four sampled inputs show defense / survivability bars short of their ticks where the data has more (full only when earned)', () => {
    const combos: LoadoutState[] = [
      { step: 3, stage: 'mid-hm', cls: 'melee', difficulty: 'expert', goal: 'survivability', owned: [], pins: {} },
      { step: 3, stage: 'mid-hm', cls: 'melee', difficulty: 'expert', goal: 'balanced', owned: [], pins: {} },
      { step: 3, stage: 'early-hm', cls: 'ranged', difficulty: 'expert', goal: 'max-damage', owned: [], pins: {} },
      { step: 3, stage: 'early-prehm', cls: 'magic', difficulty: 'expert', goal: 'mobility', owned: [], pins: {} },
    ]
    let short = 0
    for (const st of combos) {
      const r = run(st)
      const refs = profileReferences(engineInput(r.eff, NONE, {}), page.engine)
      const out = wrap(createElement(WhyStep, { page, result: r.result, eff: r.eff, references: refs }))
      for (const id of ['defense', 'survivability'] as const) {
        const fill = Number(/data-bar="([\d.]+)"/.exec(card(id, out))?.[1])
        const v = r.result.profile.components.find((c) => c.id === id)?.value as number
        if (fill < 1) {
          short++
          expect(refs[id].value as number, `${st.goal}/${id}`).toBeGreaterThan(v)
          expect(text(card(id, out))).not.toContain(copy.BAR_REACHED)
        } else {
          // full = earned: the loadout holds the reference's own figure, and the bar says so
          expect(v, `${st.goal}/${id}`).toBe(refs[id].value)
          expect(text(card(id, out))).toContain(copy.BAR_REACHED)
        }
      }
    }
    expect(short).toBeGreaterThanOrEqual(6)
  })

  it('a figure past its reference: the bar runs to the figure, the tick sits inside, and the words say so (a gated weapon pinned at Early Pre-Hardmode)', () => {
    const gated = weapons.find((w) => w.damageClass === 'melee' && w.gatedBy?.bosses.includes('moon-lord'))
    if (!gated) throw new Error('no Moon Lord-gated melee weapon')
    const pinned: LoadoutState = { step: 3, stage: 'early-prehm', cls: 'melee', owned: [], pins: { main: { kind: 'item', id: gated.id } } }
    const r = run(pinned)
    const refs = profileReferences(engineInput(r.eff, NONE, pinned.pins), page.engine)
    const edo = r.result.profile.components[0]
    if (edo.value === undefined || refs.estDamage.value === undefined) throw new Error('both computed')
    expect(edo.value).toBeGreaterThan(refs.estDamage.value)
    const out = wrap(createElement(WhyStep, { page, result: r.result, eff: r.eff, references: refs }))
    const c = /data-component="estDamage"[\s\S]*?<\/li>/.exec(out)?.[0] ?? ''
    expect(c).toContain('data-bar-past=""')
    expect(c).toContain('data-bar="1.000"')
    expect(c).toContain(`data-bar-tick="${(refs.estDamage.value / edo.value).toFixed(3)}"`)
    expect(text(c)).toContain(copy.BAR_PAST_END)
  })

  it('no reference figure → no bar, said in words; barScale guards against a zero end and puts the tick at the reference', () => {
    const noRef: Record<ReferencedComponent, ProfileReference> = {
      ...references,
      estDamage: { text: '', unit: '', assumptions: [], gear: [] },
      mobility: { ...references.mobility, value: 0, text: '0.0' },
    }
    const out = wrap(createElement(WhyStep, { page, result, eff, references: noRef }))
    expect(text(out)).toContain(copy.barNoReference(copy.BAR_NONE_WORD.estDamage))
    expect(text(out)).toContain(copy.barZeroReference(copy.BAR_NONE_WORD.mobility))
    expect([barScale(5, 0), barScale(undefined, 10), barScale(5, 10), barScale(10, 10), barScale(15, 10)]).toEqual([
      undefined,
      undefined,
      { fill: 0.5, tick: 1, past: false },
      { fill: 1, tick: 1, past: false },
      { fill: 1, tick: 10 / 15, past: true },
    ])
    expect(wrap(createElement(ProfileBar, { fill: 0.25 }))).toContain('scaleX(0.25)')
    expect(wrap(createElement(ProfileBar, { fill: 0.25, tick: 1 }))).toContain('data-bar-tick="1.000"')
  })

  it('PRD P4-S3 AC1: "What each piece of gear adds" lists every armor piece, set bonus, accessory and potion with its counted points', () => {
    expect(count(html, /data-contribution="/g)).toBe(result.profile.contributions.length)
    for (const c of result.profile.contributions) expect(text(html)).toContain(contributionParts(c).join(' · '))
    expect(contributionParts({ name: 'x', kind: 'accessory', points: { off: 0, def: 0, mob: 0, surv: 0 }, otherClass: 0, unscored: 0 })).toEqual(['adds no counted points'])
    expect(contributionParts({ name: 'x', kind: 'armor', defense: 2, points: { off: 5, def: 0, mob: 0, surv: 1.5 }, otherClass: 10, unscored: 2 })).toEqual(['2 defense', '5 offense points', '1.5 survivability points', '10 points for another class, not counted', '2 effects not scored'])
  })
})

describe('Step 4 — Compare & Save (PRD P4-S4 AC1/AC2; UX_SPEC §3.5 Step4)', () => {
  const base: LoadoutState = { step: 4, stage: 'early-prehm', cls: 'melee', difficulty: 'expert', goal: 'boss', owned: [], pins: {} }
  const saved = saveOf({ ...base, step: 2 }, 'b-test-0201', 'Plain melee')
  const opened = stateFromBuild(saved, page.engine, 4)
  const swapTo = run(opened).result.slots.find((s) => s.id === 'main')?.alternatives.find((a) => a.id !== saved.slots.altWeapon)
  if (!swapTo) throw new Error('no alternative main')
  const pins: Pins = withPin(opened.pins, 'main', { kind: 'item', id: swapTo.id })
  const draft = run({ ...opened, pins })
  const savedRun = runSavedBuild(saved, page.engine, NONE)
  const props = (o: Partial<SaveStepProps> = {}): SaveStepProps => ({
    builds: [saved],
    loadStatus: 'loaded',
    persistError: false,
    editing: saved,
    editingMissing: false,
    unsaved: true,
    defaultName: 'x',
    weaponIds: [],
    openHref: (b) => `/loadout?build=${b.buildId}`,
    onSave: () => {},
    onExport: () => {},
    onDelete: () => {},
    compare: { page, draft: { result: draft.result, pins, eff: draft.eff }, saved: savedRun, vsMissing: false, onCompare: () => {} },
    surprise: { fixedPicks: Object.keys(pins).length, drawn: null, seeHref: '/loadout?step=2', onSurprise: () => {} },
    ...o,
  })
  const html = wrap(createElement(SaveStep, props()))
  const comparison = /data-comparison="b-test-0201"[\s\S]*$/.exec(html)?.[0] ?? ''

  it('AC1: the two builds side by side — five figures (each build’s value, est. chip and bar) plus the set bonus, the difference stated draft − saved', () => {
    expect([...comparison.matchAll(/data-compare-figure="([a-zA-Z]+)"/g)].map((m) => m[1])).toEqual(['estDamage', 'defense', 'mobility', 'survivability', 'classSynergy', 'setBonus'])
    for (const row of profileRows(draft.result.profile, savedRun.result.profile)) {
      const li = new RegExp(`data-compare-figure="${row.id}"[\\s\\S]*?</li>`).exec(comparison)?.[0] ?? ''
      expect(li, row.id).toContain(`data-delta="${row.deltaText}"`)
      expect(text(li), row.id).toContain(copy.deltaLine(row.deltaText))
      expect(count(li, /data-figure-side="/g), row.id).toBe(2)
      expect(count(li, /data-estimate="/g), row.id).toBe([row.draft, row.saved].filter((c) => c.value !== undefined && c.estimate).length)
    }
    expect(text(comparison)).toContain(copy.COMPARE_EDITING)
    expect(text(comparison)).toContain('Plain melee')
  })

  it('AC2 / B113b: the goal fit is ONE signed difference with its est. chip ("Under … weights: saved +24.4" or "same"); the weighted sums are on demand', () => {
    expect(comparison).toContain(`data-goal-fit="${draft.eff.goal}"`)
    expect(count(comparison, /data-fit-difference="/g)).toBe(1)
    expect(comparison).not.toContain('data-fit-side')
    const cmp = goalFit(draft.result.profile, savedRun.result.profile, draft.eff.goal)
    const line = text(/data-fit-difference="[^"]*"[\s\S]*?<\/p>/.exec(comparison)?.[0] ?? '')
    expect(line).toContain(copy.fitUnder(copy.GOAL_NAMES[draft.eff.goal]))
    const d = cmp.difference
    if (!d) throw new Error('both builds have a weighted sum')
    expect(line).toContain(d.sign === 0 ? copy.FIT_SAME : copy.fitLeaning(d.sign > 0 ? copy.FIT_SIDE.saved : copy.FIT_SIDE.draft, d.text))
    expect(comparison).toMatch(/data-fit-difference="[^"]*"[\s\S]*?data-estimate="/)
    expect(comparison).toContain('data-fit-toggle=""')
    expect(comparison).not.toContain('data-fit-breakdown')
    // the goal choice: six goals as radio chips, the draft's goal chosen
    const fit = /data-goal-fit[\s\S]*?data-fit-toggle/.exec(comparison)?.[0] ?? ''
    expect(count(fit, /type="radio"/g)).toBe(6)
  })

  it('B113b: a dominating build (a Surprise draw beside its saved build, the review’s case) shows no 100.0 anywhere; a tie reads "same"', () => {
    const surprise = run({ ...base, step: 4, surprise: 7 })
    for (const [a, b] of [
      [surprise.result.profile, savedRun.result.profile],
      [savedRun.result.profile, savedRun.result.profile],
    ] as const) {
      for (const goal of BUILD_GOALS) {
        const cmp = goalFit(a, b, goal)
        for (const x of cmp.builds) {
          expect(x.fit?.text).not.toBe('100.0')
          expect(x.fit?.formulaText ?? '').not.toMatch(/= 100\.0$/)
        }
      }
    }
    const tie = goalFit(savedRun.result.profile, savedRun.result.profile, 'survivability')
    expect(tie.difference?.sign).toBe(0)
    const tieHtml = wrap(createElement(SaveStep, props({ compare: { page, draft: { result: savedRun.result, pins: {}, eff: savedRun.eff }, saved: savedRun, vsMissing: false, onCompare: () => {} } })))
    expect(text(/data-fit-difference="0"[\s\S]*?<\/p>/.exec(tieHtml)?.[0] ?? '')).toContain(`${copy.fitUnder(copy.GOAL_NAMES[savedRun.eff.goal])} ${copy.FIT_SAME}`)
  })

  it('slot by slot: the swap is the one "Different" row; each row names what both sides hold', () => {
    expect(comparison).toContain('data-slots-differ="1"')
    expect(comparison).toMatch(/data-slot-diff="main" data-status="changed"/)
    expect(count(comparison, /data-status="changed"/g)).toBe(1)
    expect(text(comparison)).toContain(copy.slotsDiffer(1))
    // Open + Analyze for the compared build
    expect(comparison).toContain('href="/loadout?build=b-test-0201"')
    expect(comparison).toContain('href="/readiness?build=b-test-0201"')
  })

  it('no winner language anywhere in the step: no "best", "better", "wins", no build singled out', () => {
    const t = ownText(html)
    expect(auditCopy(t), auditCopy(t)).toBeUndefined()
    expect(t).not.toMatch(WINNER)
  })

  it('compare picker: the saved builds in a select with an explicit show button; no builds → the designed empty line; a missing `vs` is said', () => {
    expect(html).toMatch(/<select[^>]*>[\s\S]*?<option value="b-test-0201"( selected="")?>Plain melee<\/option>/)
    expect(html).toContain('data-compare-show=""')
    const none = wrap(createElement(SaveStep, props({ builds: [], editing: undefined, compare: { page, draft: { result: draft.result, pins, eff: draft.eff }, vsMissing: true, onCompare: () => {} } })))
    expect(text(none)).toContain(copy.COMPARE_NO_BUILDS)
    expect(text(none)).toContain(copy.COMPARE_MISSING)
    expect(none).not.toContain('data-comparison=')
  })

  it('Surprise Me: the button with its explanation; warned before it replaces fixed picks; said visibly after, with the way to step 2', () => {
    expect(html).toContain('data-surprise=""')
    expect(text(html)).toContain(copy.SURPRISE_INTRO)
    expect(text(html)).toContain(copy.surpriseWarning(Object.keys(pins).length))
    expect(html).toMatch(/<button[^>]*aria-describedby="[^"]+"[^>]*data-surprise=""/)
    const after = wrap(createElement(SaveStep, props({ surprise: { fixedPicks: 0, drawn: copy.surpriseDrawn(3), seeHref: '/loadout?step=2&surprise=5', onSurprise: () => {} } })))
    expect(text(after)).toContain(copy.surpriseDrawn(3))
    expect(after).toContain('href="/loadout?step=2&amp;surprise=5"')
    expect(text(after)).toContain(copy.SURPRISE_AGAIN)
    expect(after).not.toContain('data-rebuild-warning')
  })

  it('the readiness import: "Analyze this build" while editing a saved build (saved version said when there are unsaved changes); a new draft is asked to save first', () => {
    expect(html).toContain('data-readiness-import="b-test-0201"')
    expect(html).toContain('href="/readiness?build=b-test-0201"')
    expect(text(html)).toContain(copy.ANALYZE_SAVED_VERSION)
    const fresh = wrap(createElement(SaveStep, props({ editing: undefined, unsaved: false })))
    expect(fresh).not.toContain('data-readiness-import')
    expect(text(fresh)).toContain(copy.ANALYZE_SAVE_FIRST)
    // each saved build: Open, Compare, Analyze, Delete; and the full list
    expect(html).toContain('data-compare-build="b-test-0201"')
    expect(html).toContain('data-analyze="b-test-0201"')
    expect(html).toContain(`href="${BUILDS_VIEW_HREF}"`)
    // from a draft, the list keeps it: its way back returns to the same draft
    const kept = wrap(createElement(SaveStep, props({ buildsHref: '/loadout?step=4&main=98&view=builds' })))
    expect(/<a[^>]*data-all-builds=""[^>]*>/.exec(kept)?.[0]).toContain('href="/loadout?step=4&amp;main=98&amp;view=builds"')
  })
})

describe('Surprise Me in the steps (PRD P4-S4 AC3)', () => {
  const state: LoadoutState = { step: 2, stage: 'early-hm', cls: 'ranged', difficulty: 'expert', goal: 'boss', owned: [], pins: {}, surprise: 424242 }
  const { eff, result } = run(state)
  const stepProps: LoadoutStepProps = { page, result, eff, pins: {}, headingId: 'h', onRegenerate: () => {}, onSwap: () => {}, onUse: () => {}, onReset: () => {}, onResetAll: () => {} }
  const html = wrap(createElement(LoadoutStep, stepProps))

  it('every drawn pick is tagged "random draw" on its card and says it was drawn, not ranked; drawn accessory cards name no quota', () => {
    const drawn = result.slots.filter((s) => s.pick?.source === 'random')
    expect(drawn.length).toBeGreaterThan(3)
    expect(count(html, /data-random=""/g)).toBe(drawn.length)
    expect(text(html)).toContain('Drawn at random by Surprise Me from')
    for (const s of result.slots.filter((x) => x.group === 'accessories' && x.random)) {
      const c = new RegExp(`<article[^>]*data-slot="${s.id}"[\\s\\S]*?</article>`).exec(html)?.[0] ?? ''
      expect(c, s.id).not.toMatch(/ slot<\/span>/)
    }
    const t = ownText(html)
    expect(auditCopy(t), auditCopy(t)).toBeUndefined()
    expect(t).not.toMatch(/\bbest\b/i)
    // a drawn pick's list is never "next-highest" (it wasn't ranked): "other candidates, highest first", the higher ones marked
    const main = result.slots.find((s) => s.id === 'main')
    if (!main?.pick) throw new Error('main drawn')
    const alts = wrap(createElement(Alternatives, { ...stepProps, slot: main, label: copy.SLOT_LABELS.main }))
    expect(text(alts)).toContain(copy.ALTERNATIVES_PINNED)
    expect(text(alts)).not.toContain(copy.ALTERNATIVES)
    expect(count(alts, /data-higher=""/g)).toBe(main.alternatives.filter((a) => a.higher).length)
  })

  it('the banner says the draft is random, not ranked; "Draw again" is warned when fixed picks exist; "Back to the recommendation"', () => {
    const banner = wrap(createElement(SurpriseBanner, { fixedPicks: 2, onDrawAgain: () => {}, onBack: () => {} }))
    expect(text(banner)).toContain(copy.SURPRISE_BANNER)
    expect(text(banner)).toContain(copy.surpriseWarning(2))
    expect(banner).toMatch(/<button[^>]*aria-describedby="[^"]+"[^>]*data-surprise-again=""/)
    expect(banner).toContain('data-surprise-back=""')
    expect(wrap(createElement(SurpriseBanner, { fixedPicks: 0, onDrawAgain: () => {}, onBack: () => {} }))).not.toContain('data-rebuild-warning')
  })

  it('saving a drawn draft saves its slots; reopened, every slot comes back as saved', () => {
    const b: SavedBuild = { ...draftFrom('Lucky', eff, result, {}), buildId: 'b-test-0301', ...stamp }
    expect(b.slots).toEqual(result.loadout)
    expect(run(stateFromBuild(b, page.engine)).result.loadout).toEqual(result.loadout)
  })
})

describe('the saved-builds view (PRD P4-S4 AC4; UX_SPEC §1 /builds as `?view=builds`, §5.2)', () => {
  const a = saveOf({ step: 2, stage: 'early-hm', cls: 'ranged', difficulty: 'expert', goal: 'boss', boss: 'plantera', owned: [], pins: {} }, 'b-test-0401', 'Ranged for Plantera')
  const b = { ...saveOf({ step: 2, stage: 'early-prehm', cls: 'melee', owned: [], pins: {} }, 'b-test-0402', 'Starter melee'), updatedAt: '2026-10-15T09:00:00.000Z' }
  const view = (builds: SavedBuild[]) =>
    wrap(createElement(BuildsView, { page, builds, loadStatus: 'loaded', persistError: false, headingId: 'h', backHref: '/loadout', openHref: (x) => `/loadout?build=${x.buildId}`, onDelete: () => {}, onExport: () => {}, onImport: (r) => ({ ...r, ...stamp, buildId: 'b-test-new1' }) }))

  it('newest first, each with its inputs, target boss, an equip preview of the slots as saved, Open, Analyze and Delete', () => {
    const html = view([a, b])
    expect([...html.matchAll(/data-build-card="([^"]+)"/g)].map((m) => m[1])).toEqual(['b-test-0402', 'b-test-0401'])
    expect(text(html)).toContain(copy.madeFor('Plantera'))
    expect(text(html)).toContain(copy.buildsCount(2))
    for (const build of [a, b]) {
      const card = new RegExp(`data-build-card="${build.buildId}"[\\s\\S]*?</article>`).exec(html)?.[0] ?? ''
      expect(card).toContain(`aria-label="${copy.previewLabel(build.name)}"`)
      expect(count(card, /data-state="closed"/g), build.name).toBe(buildItemIds(build).length)
      expect(card).toContain(`href="/loadout?build=${build.buildId}"`)
      expect(card).toContain(`href="/readiness?build=${build.buildId}"`)
      expect(card).toContain(`data-delete="${build.buildId}"`)
    }
    const t = ownText(html)
    expect(auditCopy(t), auditCopy(t)).toBeUndefined()
  })

  it('empty: the designed one-line invitation with a single call to action; quarantine is said', () => {
    const html = view([])
    expect(html).toContain('data-builds-empty=""')
    expect(text(html)).toContain(copy.BUILDS_EMPTY)
    expect(html).toContain('href="/loadout"')
    const q = wrap(createElement(BuildsView, { page, builds: [], loadStatus: 'quarantined', persistError: true, headingId: 'h', backHref: '/loadout', openHref: () => '', onDelete: () => {}, onExport: () => {}, onImport: (r) => ({ ...r, ...stamp, buildId: 'b-test-new1' }) }))
    expect(text(q)).toContain(copy.QUARANTINE_NOTICE)
    expect(text(q)).toContain(copy.PERSIST_ERROR_NOTICE)
  })
})

describe('copy audit over the rendered P4-S3/S4 surfaces (UX_SPEC §10.3)', () => {
  it('Step 3 with bars + contributions, and Step 4 comparisons in three class / goal combos — no outcome, odds, forward-promise or winner wording', () => {
    const combos: LoadoutState[] = [
      { step: 3, stage: 'mid-hm', cls: 'summon', difficulty: 'master', goal: 'survivability', boss: 'plantera', owned: [], pins: {} },
      { step: 3, stage: 'endgame', cls: 'magic', difficulty: 'classic', goal: 'mobility', owned: [], pins: {}, surprise: 77 },
      { step: 3, stage: 'early-prehm', cls: 'hybrid', difficulty: 'expert', goal: 'max-damage', owned: [], pins: {} },
    ]
    for (const state of combos) {
      const { eff, result }: { eff: ReturnType<typeof effectiveInputs>; result: BuilderResult } = run(state)
      const why = wrap(createElement(WhyStep, { page, result, eff, references: profileReferences(engineInput(eff, NONE, {}), page.engine) }))
      const other = saveOf({ ...state, goal: 'balanced', surprise: 5 }, 'b-test-0501', 'Other')
      const step4 = wrap(
        createElement(SaveStep, {
          builds: [other],
          loadStatus: 'loaded',
          persistError: false,
          editingMissing: false,
          unsaved: false,
          defaultName: 'x',
          weaponIds: [],
          openHref: () => '',
          onSave: () => {},
          onExport: () => {},
          onDelete: () => {},
          compare: { page, draft: { result, pins: state.pins, eff }, saved: runSavedBuild(other, page.engine, NONE), vsMissing: false, onCompare: () => {} },
          surprise: { fixedPicks: 0, drawn: null, seeHref: '', onSurprise: () => {} },
        }),
      )
      for (const out of [why, step4]) {
        const t = ownText(out)
        expect(auditCopy(t), `${state.cls}: ${auditCopy(t)}`).toBeUndefined()
        expect(t).not.toMatch(WINNER)
      }
    }
  })
})
