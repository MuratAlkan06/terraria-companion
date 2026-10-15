/* Loadout Builder UI (PRD P4-S2 AC1–AC5; UX_SPEC §1, §3.5, §4(c), §5, §6, §8, §10.3): URL state (the
 * draft: parse ⇄ serialize, skipped inputs, link notices), defaults, saved builds ⇄ pins (load round
 * trip, unsaved changes), each step's markup (StepWizard, inputs with skips, the slot cards with
 * score figures + est. chips + tooltips + links, the Demon Heart slot, pinned gated picks, Step 3's
 * profile / gated track / assumptions, Step 4's save + saved builds + quarantine), the B101 qualifier
 * parity with the comparison, the compare entry point, and the copy audit over every UI string and
 * the rendered steps (wiki quotes removed). Live data is read through accessors only — the dataset
 * may be regenerated under these tests. */
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
import { getField } from '../../../schemas/getField'
import * as builderCopy from '../../../scoring/builderCopy'
import { availabilityOf } from '../../../scoring/candidates'
import { auditCopy } from '../../../scoring/copyAudit'
import { plain } from '../../../scoring/readinessCopy'
import { effectiveProgress, type TrackedProgress } from '../../../scoring/progress'
import { weaponProfile } from '../../../scoring/proxies'
import { recommendLoadout, weaponCaveats, type BuilderResult, type PickScore, type Pins } from '../../../scoring/recommend'
import type { SavedBuild } from '../../../storage/builds'
import { assembleReadinessData } from '../bosses/readiness/readinessData'
import * as compareCopy from '../db/compare/compareCopy'
import { dppCaveats } from '../db/compare/compareModel'
import { InputsStep, type InputsStepProps } from './InputsStep'
import * as copy from './loadoutCopy'
import { builderHrefFor } from './loadoutLinks'
import { NoAmmoLine } from './LoadoutBits'
import { OwnedOptionAvailability } from './OwnedPicker'
import {
  blocksLeave,
  defaultBuildName,
  draftFrom,
  effectiveInputs,
  EMPTY_STATE,
  engineInput,
  hasUnsavedChanges,
  loadoutHref,
  loadoutSearch,
  parseLoadoutSearch,
  pinsFromBuild,
  slotLabel,
  stageAwaiting,
  stateFromBuild,
  weaponIds,
  withInputs,
  withPin,
  withSkipped,
  type LoadoutState,
} from './loadoutModel'
import { Alternatives, LoadoutStep, type LoadoutStepProps } from './LoadoutStep'
import { SaveStep, type SaveStepProps } from './SaveStep'
import { StepNav } from './StepNav'
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
const run = (state: LoadoutState, progress: TrackedProgress = NONE, stage: 'early-prehm' | null = null): { eff: ReturnType<typeof effectiveInputs>; result: BuilderResult } => {
  const eff = effectiveInputs(state, stage)
  return { eff, result: recommendLoadout(engineInput(eff, progress, state.pins), page.engine) }
}

const wrap = (el: ReactElement) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Tooltip.Provider, null, el)))
const text = (html: string) =>
  html
    .replace(/<span data-quote="">[\s\S]*?<\/span>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
/**
 * Our own words: verbatim wiki effect texts (rendered in “…” quotes) removed, and UnknownValue markers,
 * whose wording is UX_SPEC §5.3's own ("Not yet verified …") — the readiness tests' precedent.
 */
const ownText = (html: string) =>
  text(html.replace(/<(button|span)[^>]*data-unknown-field="[^"]*"[^>]*>Unknown<span class="sr-only">[^<]*<\/span><\/\1>/g, ' Unknown ')).replace(/“[^”]*”/g, ' ')
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length

describe('URL state: the draft (UX_SPEC §1 /loadout?step=1..4; §10.11 deep links restore state)', () => {
  it('an empty query is the default draft at step 1; absent inputs are skipped (defaults apply)', () => {
    expect(parse('')).toEqual({ state: EMPTY_STATE, notices: [] })
    expect(loadoutSearch(EMPTY_STATE)).toBe('')
    expect(effectiveInputs(EMPTY_STATE, null)).toEqual({
      stage: 'early-prehm',
      cls: 'melee',
      difficulty: 'classic',
      goal: 'balanced',
      bossId: null,
      owned: [],
      skipped: { stage: true, cls: true, difficulty: true, goal: true, boss: true },
    })
    // SCORING_SPEC §4: the stage default comes from the stage setting
    expect(effectiveInputs(EMPTY_STATE, 'mid-hm').stage).toBe('mid-hm')
  })

  it('every input, swap and the edited build round-trip through the query string (values kept literal)', () => {
    const state: LoadoutState = {
      step: 3,
      stage: 'early-hm',
      cls: 'ranged',
      difficulty: 'expert',
      goal: 'boss',
      boss: 'plantera',
      owned: [434, 197],
      pins: { main: { kind: 'item', id: 434 }, armor: { kind: 'armor', helmet: 4982, chest: null, legs: 4984 }, acc2: { kind: 'empty' }, buff0: { kind: 'item', id: 292 } },
      build: 'b12345678',
    }
    const search = loadoutSearch(state)
    expect(search).toBe('?step=3&stage=early-hm&class=ranged&difficulty=expert&goal=boss&boss=plantera&owned=434,197&main=434&armor=4982.-.4984&acc3=none&buff1=292&build=b12345678')
    expect(parse(search)).toEqual({ state, notices: [] })
    expect(loadoutHref({ step: 2, cls: 'magic' })).toBe('/loadout?step=2&class=magic')
  })

  it('what a link can’t use is said once per kind, never silently dropped; owned ids are deduplicated', () => {
    const { state, notices } = parse('?step=9&stage=hardmode&class=thrower&boss=nobody&owned=1,1,x,2&main=zenith&armor=1.2&build=no')
    expect(state).toEqual({ step: 1, owned: [1, 2], pins: {} })
    expect(notices).toEqual([copy.linkIgnored(copy.LINK_VALUES), copy.linkIgnored(copy.LINK_BOSS), copy.linkIgnored(copy.LINK_ITEMS)])
  })

  it('swapping a weapon drops its ammo pin (it would no longer fit); clearing a pin restores the recommendation', () => {
    const pins: Pins = { main: { kind: 'item', id: 1 }, ammo0: { kind: 'item', id: 97 }, ammo1: { kind: 'item', id: 97 } }
    expect(withPin(pins, 'main', { kind: 'item', id: 2 })).toEqual({ main: { kind: 'item', id: 2 }, ammo1: { kind: 'item', id: 97 } })
    expect(withPin(pins, 'alt', undefined)).toEqual({ main: { kind: 'item', id: 1 }, ammo0: { kind: 'item', id: 97 } })
  })
})

describe('saved builds ⇄ the draft (UX_SPEC §6 "Edit saved build"; AMENDMENTS-016 B106 v2)', () => {
  const state: LoadoutState = { step: 2, stage: 'early-hm', cls: 'ranged', difficulty: 'expert', goal: 'boss', owned: [], pins: {} }
  const { eff, result } = run(state)
  const stamp = { createdAt: '2026-10-14T12:00:00.000Z', updatedAt: '2026-10-14T12:00:00.000Z' }
  const build: SavedBuild = { ...draftFrom(defaultBuildName(eff), eff, result, state.pins), buildId: 'b-test-0001', ...stamp }
  /** Slots the recommendation left empty that the user did not empty (not locked). */
  const unfilled = (r: BuilderResult, pins: Pins) => r.slots.filter((s) => s.state === 'empty' && pins[s.id] === undefined).map((s) => s.id)
  const slotOf = (r: BuilderResult, id: string) => r.slots.find((s) => s.id === id)
  const KEPT_EMPTY = builderCopy.empty.pinnedEmpty()

  it('Save writes the inputs and the loadout the slots hold (7 accessory entries); the default name reads class · stage · goal', () => {
    expect(build).toMatchObject({ name: 'Ranged · Early Hardmode · Boss fight', stage: 'early-hm', class: 'ranged', difficulty: 'expert', goal: 'boss' })
    expect(build.slots.accessories).toHaveLength(7)
    expect(build.slots).toEqual({ ...result.loadout })
    // v2: no target boss chosen → none written; the owned list and the emptied-slot marker always (here: empty)
    expect('targetBoss' in build).toBe(false)
    expect(build).toMatchObject({ ownedIds: [], emptiedSlots: [] })
  })

  it('opening a saved build pins every filled slot as saved: the engine returns exactly those slots, and nothing reads as unsaved', () => {
    const opened = stateFromBuild(build, page.engine)
    expect(opened).toMatchObject({ step: 2, stage: 'early-hm', cls: 'ranged', difficulty: 'expert', goal: 'boss', owned: [], build: 'b-test-0001' })
    expect(opened.boss).toBeUndefined()
    const again = run(opened)
    expect(again.result.loadout).toEqual(build.slots)
    expect(again.result.notices).toEqual([])
    expect(hasUnsavedChanges(build, again.eff, again.result, opened.pins)).toBe(false)
    // every filled slot is pinned; nothing was emptied by the user, so no slot reopens "kept empty"
    const pins = pinsFromBuild(build, page.engine)
    expect(Object.keys(pins).length).toBeGreaterThanOrEqual(12)
    expect(Object.values(pins).filter((p) => p?.kind === 'empty')).toEqual([])
  })

  it('B106 v2 round trip: the target boss, the owned items and every slot restore; user-emptied slots reopen "kept empty", unfilled ones go back to the recommendation', () => {
    const drafted: LoadoutState = { ...state, boss: 'plantera', owned: [434, 197], pins: { acc2: { kind: 'empty' }, summon: { kind: 'empty' } } }
    const before = run(drafted)
    const left = unfilled(before.result, drafted.pins)
    // the scenario needs a slot the recommendation itself left empty (the distinction under test)
    expect(left.length).toBeGreaterThan(0)
    const saved: SavedBuild = { ...draftFrom('Plantera prep', before.eff, before.result, drafted.pins), buildId: 'b-test-0002', ...stamp }
    expect(saved).toMatchObject({ targetBoss: 'plantera', ownedIds: [434, 197], emptiedSlots: ['acc2', 'summon'] })
    expect(saved.slots.accessories[2]).toBeNull()
    expect(saved.slots.summon).toBeNull()

    const opened = stateFromBuild(saved, page.engine)
    expect(opened).toMatchObject({ boss: 'plantera', owned: [434, 197], build: 'b-test-0002' })
    expect([opened.pins.acc2, opened.pins.summon]).toEqual([{ kind: 'empty' }, { kind: 'empty' }])
    for (const id of left) expect(opened.pins[id], id).toBeUndefined()
    // the Open link carries all of it (boss and owned included) and parses back to the same draft
    expect(parse(loadoutSearch(opened))).toEqual({ state: opened, notices: [] })

    const again = run(opened)
    expect(again.eff).toMatchObject({ bossId: 'plantera', owned: [434, 197] })
    expect(again.result.loadout).toEqual(saved.slots)
    expect(again.result.notices).toEqual([])
    expect(hasUnsavedChanges(saved, again.eff, again.result, opened.pins)).toBe(false)
    // shown apart: the emptied slots say "kept empty" and offer the recommendation back; the unfilled ones say why they are empty
    for (const id of ['acc2', 'summon']) expect(slotOf(again.result, id)?.empty, id).toEqual(KEPT_EMPTY)
    for (const id of left) expect(slotOf(again.result, id)?.empty, id).not.toEqual(KEPT_EMPTY)
    const { html } = stepTwo(opened)
    const card = (id: string) => new RegExp(`<article[^>]*data-slot="${id}"[\\s\\S]*?</article>`).exec(html)?.[0] ?? ''
    for (const id of ['acc2', 'summon']) expect(card(id), id).toMatch(new RegExp(`data-state="empty"[\\s\\S]*?data-reset="${id}"`))
    for (const id of left) {
      expect(card(id), id).toContain('data-state="empty"')
      expect(card(id), id).not.toContain('data-reset=')
    }
  })

  it('B106: a v1 build (no target boss, owned list or marker) reopens as it always did — every stored empty slot deliberately empty', () => {
    const { targetBoss: _t, ownedIds: _o, emptiedSlots: _e, ...v1 } = build
    const left = unfilled(result, state.pins)
    expect(left.length).toBeGreaterThan(0)
    const opened = stateFromBuild(v1, page.engine)
    expect(opened.boss).toBeUndefined()
    expect(opened.owned).toEqual([])
    // ammo slots saved empty stay with the recommendation (unchanged v1 rule); every other empty slot is pinned empty
    for (const id of left) expect(opened.pins[id], id).toEqual(id.startsWith('ammo') ? undefined : { kind: 'empty' })
    const again = run(opened)
    expect(again.result.loadout).toEqual(v1.slots)
    expect(hasUnsavedChanges(v1, again.eff, again.result, opened.pins)).toBe(false)
    // saving it again writes v2, carrying v1's meaning of those nulls into the marker
    expect([...(draftFrom(v1.name, again.eff, again.result, opened.pins).emptiedSlots ?? [])].sort()).toEqual(left.filter((id) => !id.startsWith('ammo')).sort())
  })

  it('a changed slot, input, target boss, owned list or emptied slot reads as "Unsaved changes" (owned order aside)', () => {
    const opened = stateFromBuild(build, page.engine)
    const swapped = run({ ...opened, pins: withPin(opened.pins, 'summon', { kind: 'empty' }) })
    expect(hasUnsavedChanges(build, swapped.eff, swapped.result, withPin(opened.pins, 'summon', { kind: 'empty' }))).toBe(true)
    const regoal = run({ ...opened, goal: 'mobility' })
    expect(hasUnsavedChanges(build, regoal.eff, regoal.result, opened.pins)).toBe(true)
    const targeted = run({ ...opened, boss: 'plantera' })
    expect(hasUnsavedChanges(build, targeted.eff, targeted.result, opened.pins)).toBe(true)
    const owning = run({ ...opened, owned: [434] })
    expect(hasUnsavedChanges(build, owning.eff, owning.result, opened.pins)).toBe(true)
    // marking an unfilled slot emptied changes no slot, only the marker — still a change to save
    const left = unfilled(result, state.pins)[0]
    const marked = withPin(opened.pins, left, { kind: 'empty' })
    const markedRun = run({ ...opened, pins: marked })
    expect(markedRun.result.loadout).toEqual(build.slots)
    expect(hasUnsavedChanges(build, markedRun.eff, markedRun.result, marked)).toBe(true)
    // the owned list is a set: its order is not a change
    const saved: SavedBuild = { ...build, ownedIds: [434, 197] }
    const reordered = run({ ...stateFromBuild(saved, page.engine), owned: [197, 434] })
    expect(hasUnsavedChanges(saved, reordered.eff, reordered.result, stateFromBuild(saved, page.engine).pins)).toBe(false)
  })

  it('the comparison link carries the loadout’s weapons (main, alt)', () => {
    expect(weaponIds(result)).toEqual([result.loadout.mainWeapon, result.loadout.altWeapon].filter((x) => x !== null))
  })
})

describe('Step 1 — inputs (PRD P4-S2 AC1: every input skippable; CTA always enabled)', () => {
  const props = (state: LoadoutState): InputsStepProps => ({
    page,
    state,
    eff: effectiveInputs(state, null),
    stageFromSettings: false,
    onSet: () => {},
    onSkip: () => {},
    onOpenOwned: () => {},
    onRemoveOwned: () => {},
    onBuild: () => {},
    ownedButtonId: 'owned-add',
  })

  it('all skipped: each field shows its default; no Skip buttons; the CTA is an enabled button', () => {
    const html = wrap(createElement(InputsStep, props(EMPTY_STATE)))
    for (const field of ['stage', 'cls', 'difficulty', 'goal', 'boss']) expect(html).toContain(`data-default="${field}"`)
    expect(html).not.toContain('data-skip=')
    expect(text(html)).toContain(copy.defaultNote(copy.CLASS_NAMES.melee))
    expect(html).toMatch(/<button type="button"[^>]*data-build-cta=""/)
    expect(html).not.toMatch(/data-build-cta=""[^>]*disabled/)
    // the five stages, five classes, three difficulties and six goals as radio chips
    expect(count(html, /type="radio"/g)).toBe(5 + 5 + 3 + 6)
    // the boss list: every boss, plus "No particular boss"
    expect(count(html, /<option /g)).toBe(bosses.length + 1)
  })

  it('a set field offers "Skip — use default"; owned gear is listed with its remove button', () => {
    const html = wrap(createElement(InputsStep, props({ ...EMPTY_STATE, cls: 'magic', goal: 'boss', owned: [weapons[0].id] })))
    expect(html).toContain('data-skip="cls"')
    expect(html).toContain('data-skip="goal"')
    expect(html).toContain('data-default="stage"')
    expect(html).toContain(`data-owned-item="${weapons[0].id}"`)
    expect(html).toContain(`aria-label="${copy.ownedRemove(weapons[0].name)}"`)
  })
})

describe('StepWizard (UX_SPEC §3.5): four numbered steps, the current one marked', () => {
  it('links every step, preserving the draft; aria-current="step" on the current one', () => {
    const html = wrap(createElement(StepNav, { step: 2, hrefFor: (n) => `/loadout?step=${n}&class=ranged` }))
    expect(count(html, /data-step-link="/g)).toBe(4)
    expect(html).toMatch(/aria-current="step"[^>]*data-step-link="2"/)
    expect(text(html)).toContain('Step 2 of 4: Loadout')
    // UX_SPEC §3.5: P4-S4 makes step 4 "Compare & Save"
    expect(Object.values(copy.STEP_NAMES)).toEqual(['Inputs', 'Loadout', 'Why it works', 'Compare & Save'])
    expect(html).toContain('href="/loadout?step=3&amp;class=ranged"')
  })
})

function stepTwoProps(state: LoadoutState, progress: TrackedProgress = NONE): LoadoutStepProps {
  const { eff, result } = run(state, progress)
  return { page, result, eff, pins: state.pins, headingId: 'h', onRegenerate: () => {}, onSwap: () => {}, onUse: () => {}, onReset: () => {}, onResetAll: () => {} }
}

function stepTwo(state: LoadoutState, progress: TrackedProgress = NONE) {
  const props = stepTwoProps(state, progress)
  return { html: wrap(createElement(LoadoutStep, props)), result: props.result, eff: props.eff }
}

function inputProps(state: LoadoutState): InputsStepProps {
  return {
    page,
    state,
    eff: effectiveInputs(state, null),
    stageFromSettings: false,
    onSet: () => {},
    onSkip: () => {},
    onOpenOwned: () => {},
    onRemoveOwned: () => {},
    onBuild: () => {},
    ownedButtonId: 'owned-add',
  }
}

describe('Step 2 — the loadout (PRD P4-S2 AC2–AC5; UX_SPEC §3.5, §8)', () => {
  const { html, result } = stepTwo({ step: 2, stage: 'early-hm', cls: 'ranged', difficulty: 'expert', goal: 'boss', owned: [], pins: {} })

  it('AC2: a card per slot — main + alt, the armor set, every accessory slot of the difficulty, ammo, potions, summon — each with a rationale or the reason it is empty', () => {
    expect([...html.matchAll(/data-slot="([a-z0-9]+)" data-state/g)].map((m) => m[1])).toEqual(result.slots.map((s) => s.id))
    expect(result.slots.filter((s) => s.group === 'accessories')).toHaveLength(6)
    for (const s of result.slots) {
      if (s.pick) expect(html, s.id).toMatch(new RegExp(`data-slot="${s.id}"[\\s\\S]*?data-rationale=""`))
      else expect(html, s.id).toMatch(new RegExp(`data-slot="${s.id}"[\\s\\S]*?data-empty=""`))
    }
  })

  it('AC3: every pick links its real record — weapons to their page, the rest to their wiki article', () => {
    for (const s of result.slots) {
      if (!s.pick) continue
      expect(html).toContain(`data-item-link="${s.pick.id}"`)
      if (page.engine.weapons.has(s.pick.id)) expect(html).toContain(`href="/weapons/${s.pick.id}"`)
    }
  })

  it('an armor SET (pick and alternatives) links its set page — never its helmet’s anchor — as the readiness checker does', () => {
    const armor = result.slots.find((s) => s.id === 'armor')
    if (!armor) throw new Error('armor slot')
    // the alternatives list renders inside the opened card
    const alts = wrap(createElement(Alternatives, { ...stepTwoProps({ step: 2, stage: 'early-hm', cls: 'ranged', difficulty: 'expert', goal: 'boss', owned: [], pins: {} }), slot: armor, label: copy.SLOT_LABELS.armor }))
    const both = html + alts
    const sets = [...(armor.pick ? [armor.pick] : []), ...armor.alternatives].filter((o) => o.setId)
    expect(sets.length).toBeGreaterThan(1)
    for (const o of sets) {
      const tags = [...both.matchAll(new RegExp(`<a [^>]*data-set-ref="${o.setId}"[^>]*>`, 'g'))].map((m) => m[0])
      expect(tags.length, o.key).toBeGreaterThan(0)
      for (const tag of tags) {
        expect(tag, o.key).toContain(`href="/armor/${o.setId}"`)
        expect(tag, o.key).toContain(`data-item-link="${o.id}"`)
      }
    }
  })

  it('AC5: the equip-screen overview: an ItemSlot per filled slot (armor: its three pieces), each a Tooltip trigger; B108 M6: every square — empty and locked too — names its slot and jumps to its card', () => {
    const overview = /data-overview=""[\s\S]*?Tap a slot/.exec(html)?.[0] ?? ''
    const filled = result.slots.filter((s) => s.pick && s.id !== 'armor').length + (result.slots.find((s) => s.id === 'armor')?.pick?.pieces?.filter((x) => x > 0).length ?? 0)
    const squares = result.slots.filter((s) => s.id !== 'armor' && (s.group !== 'ammo' || s.state === 'pick')).length + 3
    expect(count(overview, /data-state="closed"/g)).toBe(filled)
    // every square is a button (aria-pressed): filled ones are tooltip triggers named "slot: item", the rest name their slot
    expect(count(overview, /aria-pressed=/g)).toBe(squares)
    const main = result.slots.find((s) => s.id === 'main')?.pick
    if (main) expect(overview).toContain(`aria-label="${copy.overviewFilled(copy.SLOT_LABELS.main, page.info(main.id).name)}"`)
    for (const s of result.slots.filter((x) => x.state === 'empty' && x.group !== 'ammo')) {
      expect(overview, s.id).toContain(`aria-label="${copy.overviewEmpty(slotLabel(s.id))}"`)
    }
    // the empty-square placeholders are told apart by a visible short name
    const early = stepTwo({ step: 2, stage: 'early-prehm', cls: 'melee', difficulty: 'master', goal: 'balanced', owned: [], pins: { alt: { kind: 'empty' } } })
    const earlyOverview = /data-overview=""[\s\S]*?Tap a slot/.exec(early.html)?.[0] ?? ''
    expect(earlyOverview).toMatch(/data-overview="empty" data-overview-slot="alt"[^>]*>[\s\S]*?>Alt<\/span>/)
    expect(earlyOverview).toContain(`aria-label="${copy.overviewLocked(copy.DEMON_HEART_SLOT)}"`)
  })

  it('every "est." chip sits after an estimate with a populated AssumptionsTip; scores show their unit and label', () => {
    const estimates = result.slots.flatMap((s) => [s.pick?.score, ...s.alternatives.map((a) => a.score)]).filter((sc) => sc?.estimate && (sc.assumptions?.length ?? 0) > 0)
    // alternatives render only inside the opened breakdown, so the closed cards carry the picks' chips
    const picked = result.slots.filter((s) => s.pick?.score?.estimate).length
    expect(count(html, /data-estimate="/g)).toBe(picked)
    expect(estimates.length).toBeGreaterThanOrEqual(picked)
    expect(html).toContain(`data-score="dpp"`)
  })

  it('the Demon Heart slot (Expert, Wall of Flesh in progress): filled, with its assumption chip', () => {
    expect(html).toMatch(/data-slot="acc5" data-state="pick"[\s\S]*?data-assumption-chip="assumes Demon Heart"/)
  })

  it('before the Wall of Flesh: the Demon Heart slot is locked with its gate chip, never filled', () => {
    const early = stepTwo({ step: 2, stage: 'early-prehm', cls: 'melee', difficulty: 'master', goal: 'balanced', owned: [], pins: {} })
    expect(early.html).toMatch(/data-slot="acc6" data-state="locked"[\s\S]*?data-gate-group="wall-of-flesh"/)
    expect(early.html).toContain('data-overview="locked"')
  })

  it('a pinned gated item keeps its gate chip (gated items never sit unlabeled among obtainable ones, UX_SPEC §8) and offers "Back to the recommendation"', () => {
    const gated = weapons.find((w) => w.damageClass === 'melee' && w.gatedBy?.bosses.includes('moon-lord'))
    if (!gated) throw new Error('no Moon Lord-gated melee weapon in the data')
    const { html: pinned } = stepTwo({ step: 2, stage: 'early-prehm', owned: [], pins: { main: { kind: 'item', id: gated.id } } })
    expect(pinned).toMatch(/data-slot="main"[\s\S]*?data-pinned=""[\s\S]*?data-gate-group="[^"]*moon-lord[^"]*"[\s\S]*?data-reset="main"/)
  })

  it('PRD P4-S2 AC4: at Early Pre-Hardmode no gate chip appears on a recommended pick (all verified obtainable)', () => {
    const early = stepTwo({ step: 2, stage: 'early-prehm', owned: [], pins: {} })
    expect(early.result.slots.every((s) => !s.pick || s.pick.availability.status === 'yes')).toBe(true)
    // the only gate chip is the locked slot's (none in Classic)
    expect(early.html).not.toContain('data-gate-group=')
  })
})

describe('Step 3 — why it works (SCORING_SPEC §4.7, §5.1; UX_SPEC §3.5 Step3, §8 GatedSection)', () => {
  const { eff, result } = run({ step: 3, stage: 'early-prehm', cls: 'ranged', difficulty: 'expert', goal: 'boss', owned: [], pins: {} })
  const html = wrap(createElement(WhyStep, { page, result, eff }))

  it('the profile: five components, each with the goal’s weight; estDamage carries its est. chip; no composite', () => {
    expect([...html.matchAll(/data-component="([a-zA-Z]+)"/g)].map((m) => m[1])).toEqual(['estDamage', 'defense', 'mobility', 'survivability', 'classSynergy'])
    expect(text(html)).toContain(copy.goalWeight(copy.GOAL_NAMES.boss, 45))
    if (result.profile.components[0].value !== undefined) expect(html).toMatch(/data-component="estDamage"[\s\S]*?data-estimate="estimated damage per second with your gear"/)
    expect(text(html)).toContain(copy.PROFILE_NOTE)
  })

  it('the gated track: one GatedSection per exact set of bosses; every entry names its obtainable-now alternative or says there is none', () => {
    expect(result.gated.length).toBeGreaterThan(0)
    expect(count(html, /data-gated-section="/g)).toBe(result.gated.length)
    const entries = result.gated.flatMap((g) => g.entries)
    expect(count(html, /data-gated-entry="/g)).toBe(entries.length)
    expect(count(html, /data-alternative-now=""/g)).toBe(entries.length)
    for (const g of result.gated) expect(html).toContain(`data-gated-section="${g.missing.join('+')}"`)
    // a gated armor SET names its set page, not its helmet's anchor (as the readiness checker does)
    const sets = entries.filter((e) => e.setId)
    expect(sets.length).toBeGreaterThan(0)
    for (const e of sets) expect(html, e.key).toMatch(new RegExp(`<a [^>]*data-set-ref="${e.setId}"[^>]*href="/armor/${e.setId}"|<a [^>]*href="/armor/${e.setId}"[^>]*data-set-ref="${e.setId}"`))
  })

  it('PRD §9 Feature B AC5: every gated entry links its grind plan (/plan/new?item=:id); an armor set, one per piece', () => {
    const entries = result.gated.flatMap((g) => g.entries)
    for (const e of entries) {
      const ids = e.pieces ? e.pieces.filter((x) => x > 0) : [e.id] // a set without a legs piece leaves the legs slot 0
      for (const id of ids) expect(html).toMatch(new RegExp(`<a [^>]*href="/plan/new\\?item=${id}"[^>]*data-plan-it="${id}"|<a [^>]*data-plan-it="${id}"[^>]*href="/plan/new\\?item=${id}"`))
    }
    expect(count(html, /data-plan-it="/g)).toBe(entries.reduce((n, e) => n + (e.pieces ? e.pieces.filter((x) => x > 0).length : 1), 0))
    // B120: every link says its item's name once — a per-piece link shows the name, so its completion doesn't repeat it
    const links = [...html.matchAll(/<a [^>]*data-plan-it="(\d+)"[^>]*>([\s\S]*?)<\/a>/g)]
    expect(links.length).toBeGreaterThan(0)
    for (const [, id, inner] of links) {
      const name = page.info(Number(id)).name
      expect(text(inner).split(name).length - 1, name).toBe(1)
    }
  })

  it('assumptions: the inputs used (skips marked), every build assumption; the weights version said once (B108 nit: no duplicate footer)', () => {
    const skipped = run({ ...EMPTY_STATE, step: 3 })
    const t = text(wrap(createElement(WhyStep, { page, result: skipped.result, eff: skipped.eff })))
    expect(t).toContain(copy.inputUsed(copy.CLASS_LABEL, copy.CLASS_NAMES.melee, true))
    expect(t).toContain(copy.inputUsed(copy.GOAL_LABEL, copy.GOAL_NAMES.balanced, true))
    for (const a of result.assumptions) expect(html).toContain(`data-assumption="${a.id}"`)
    // the profile's est. tips name the weights too (inside their popovers, closed here): the page text says it once
    expect(count(text(html), /Weights v2/g)).toBe(1)
  })
})

describe('Step 4 — save (UX_SPEC §3.5 Step4, §5.6, §6)', () => {
  const base: SaveStepProps = {
    builds: [],
    loadStatus: 'empty',
    persistError: false,
    editingMissing: false,
    unsaved: false,
    defaultName: 'Ranged · Early Hardmode · Boss fight',
    weaponIds: [434],
    openHref: (b) => `/loadout?build=${b.buildId}`,
    onSave: () => {},
    onExport: () => {},
    onDelete: () => {},
  }
  const build: SavedBuild = {
    buildId: 'b-test-0001',
    name: 'My ranged build',
    createdAt: '2026-10-14T12:00:00.000Z',
    updatedAt: '2026-10-14T12:00:00.000Z',
    stage: 'early-hm',
    class: 'ranged',
    difficulty: 'expert',
    goal: 'boss',
    slots: { mainWeapon: 434, altWeapon: null, helmet: null, chest: null, legs: null, accessories: [null, null, null, null, null, null, null], ammo: [], buffs: [], summon: null },
  }

  it('a new draft: the name prefilled, "Save build", the designed empty list, the comparison link', () => {
    const html = wrap(createElement(SaveStep, base))
    expect(html).toContain('value="Ranged · Early Hardmode · Boss fight"')
    expect(html).toContain('data-save="new"')
    expect(text(html)).toContain(copy.SAVED_EMPTY)
    expect(html).toContain('href="/compare?w=434"')
  })

  it('editing: "Save changes" + "Save as copy", the unsaved-changes line; saved builds listed with Open and Delete', () => {
    const html = wrap(createElement(SaveStep, { ...base, builds: [build], editing: build, unsaved: true, loadStatus: 'loaded' }))
    expect(html).toContain('data-save="overwrite"')
    expect(html).toContain('data-save="copy"')
    expect(html).toContain('data-unsaved=""')
    expect(text(html)).toContain(copy.editing('My ranged build'))
    expect(html).toContain('href="/loadout?build=b-test-0001"')
    expect(html).toContain('data-delete="b-test-0001"')
    expect(text(html)).toContain(copy.buildMeta('Ranged', 'Early Hardmode', 'Expert', 'Boss fight'))
  })

  it('quarantined storage and a failed save are said, never silent (UX_SPEC §5.6)', () => {
    const html = wrap(createElement(SaveStep, { ...base, loadStatus: 'quarantined', persistError: true, editingMissing: true }))
    expect(text(html)).toContain(copy.QUARANTINE_NOTICE)
    expect(text(html)).toContain(copy.PERSIST_ERROR_NOTICE)
    expect(text(html)).toContain(copy.BUILD_MISSING)
  })
})

describe('AMENDMENTS-016 B101a parity: the builder’s DPP qualifiers are the comparison’s', () => {
  it('the engine’s caveats equal compare’s dppCaveats for every weapon, and the qualifier words are identical', () => {
    for (const w of weapons) expect(weaponCaveats(w), w.name).toEqual(dppCaveats(w))
    expect([builderCopy.QUALIFIER_CLICK_THROW, builderCopy.QUALIFIER_CLICK_ATTACK, builderCopy.QUALIFIER_EXPLOSIVE, builderCopy.qualifierUsage('1.5')]).toEqual([
      compareCopy.QUALIFIER_CLICK_THROW,
      compareCopy.QUALIFIER_CLICK_ATTACK,
      compareCopy.QUALIFIER_EXPLOSIVE,
      compareCopy.qualifierUsage('1.5'),
    ])
    const parts = [compareCopy.QUALIFIER_CLICK_THROW, compareCopy.qualifierUsage('1.5'), compareCopy.QUALIFIER_EXPLOSIVE]
    expect(builderCopy.dppQualifier(parts)).toBe(compareCopy.dppQualifier(parts))
  })
})

describe('entry points', () => {
  it('compare’s "Open in Builder" (B99f; B108(c) M4): the weapon fixed in its slot, for its class — at Step 1 with no stage, which then awaits a choice', () => {
    expect(builderHrefFor({ id: 434, damageClass: 'ranged', tags: ['guns'] })).toBe('/loadout?class=ranged&main=434')
    expect(builderHrefFor({ id: 4913, damageClass: 'summon', tags: ['whips'] })).toBe('/loadout?class=summon&main=4913')
    expect(builderHrefFor({ id: 1309, damageClass: 'summon', tags: ['minion-summon-items'] })).toBe('/loadout?class=summon&summon=1309')
    expect(builderHrefFor({ id: 167, damageClass: 'other', tags: ['explosives'] })).toBe('/loadout?class=hybrid&main=167')
    // and the link parses back to that draft: Step 1, the weapon fixed, the stage awaiting
    const { state } = parse('?class=ranged&main=434')
    expect(state).toEqual({ step: 1, cls: 'ranged', owned: [], pins: { main: { kind: 'item', id: 434 } } })
    expect(stageAwaiting(state)).toBe(true)
  })
})

describe('AMENDMENTS-016 B108 fix round (UI)', () => {
  const pinnedLower = (() => {
    const { result } = run({ step: 2, stage: 'early-prehm', cls: 'melee', owned: [], pins: {} })
    const lower = result.slots.find((s) => s.id === 'main')?.alternatives.find((a) => !a.tied)
    if (!lower) throw new Error('no lower-scoring melee alternative at Early Pre-Hardmode')
    return lower
  })()

  it('H1: a rebuild resets fixed picks — warned before, beside the stage / class fields (and in their description), and said VISIBLY after', () => {
    const state: LoadoutState = { step: 2, stage: 'early-hm', cls: 'ranged', owned: [], pins: { main: { kind: 'item', id: pinnedLower.id }, acc0: { kind: 'empty' } } }
    const { html } = stepTwo(state)
    const bar = /data-regenerate=""[\s\S]*?<\/select><\/div><\/div>/.exec(html)?.[0] ?? ''
    expect(bar).toContain('data-rebuild-warning=""')
    expect(text(bar)).toContain(copy.rebuildWarning(2))
    const warnId = /<p id="([^"]+)"[^>]*data-rebuild-warning/.exec(bar)?.[1]
    expect(count(bar, new RegExp(`<select[^>]*aria-describedby="${warnId}"`, 'g'))).toBe(2)
    // no fixed pick, no warning
    expect(stepTwo({ ...state, pins: {} }).html).not.toContain('data-rebuild-warning')
    // after: the notice is visible in the bar (not an sr-only line)
    const after = wrap(createElement(LoadoutStep, { ...stepTwoProps(state), rebuiltNotice: copy.regenerated(2) }))
    const notice = /<div[^>]*data-rebuilt-notice=""[\s\S]*?<\/div>/.exec(after)?.[0] ?? ''
    expect(notice).not.toContain('sr-only')
    expect(text(notice)).toContain(copy.regenerated(2))
    expect(notice).toContain(`aria-label="${copy.REBUILT_DISMISS}"`)
    // the model: any input change resets the fixed picks, and says how many
    expect(withInputs(state, { stage: 'mid-hm' })).toEqual({ next: { ...state, stage: 'mid-hm', pins: {} }, reset: 2 })
    expect(withInputs(state, { cls: 'melee' }).reset).toBe(2)
    // Step 1 says it too
    const inputs = wrap(createElement(InputsStep, { ...inputProps(state), fixedPicks: 2, rebuiltNotice: copy.regenerated(1) }))
    expect(text(inputs)).toContain(copy.inputsWarning(2))
    expect(inputs).toContain('data-rebuilt-notice=""')
  })

  it('H2: under a pinned pick the list reads "other candidates", and the ones scoring above it are marked', () => {
    const state: LoadoutState = { step: 2, stage: 'early-prehm', cls: 'melee', owned: [], pins: { main: { kind: 'item', id: pinnedLower.id } } }
    const { result, html } = stepTwo(state)
    const main = result.slots.find((s) => s.id === 'main')
    if (!main?.pick) throw new Error('main pinned')
    expect(text(html)).toContain(plain(builderCopy.rationale.pinnedBelow()))
    const alts = wrap(createElement(Alternatives, { ...stepTwoProps(state), slot: main, label: copy.SLOT_LABELS.main }))
    expect(text(alts)).toContain(copy.ALTERNATIVES_PINNED)
    expect(text(alts)).not.toContain(copy.ALTERNATIVES)
    expect(count(alts, /data-higher=""/g)).toBe(main.alternatives.filter((a) => a.higher).length)
    expect(main.alternatives.some((a) => a.higher)).toBe(true)
    // a recommended pick keeps "Next-highest candidates", with no "scores higher" tag
    const rec = run({ ...state, pins: {} }).result.slots.find((s) => s.id === 'main')
    if (!rec) throw new Error('main')
    const recAlts = wrap(createElement(Alternatives, { ...stepTwoProps({ ...state, pins: {} }), slot: rec, label: copy.SLOT_LABELS.main }))
    expect(text(recAlts)).toContain(copy.ALTERNATIVES)
    expect(recAlts).not.toContain('data-higher')
  })

  it('H3: owned gear with Unknown availability is counted apart — the slot’s rationale / disclosure and the swap sheet count', () => {
    const ep = effectiveProgress(page.engine.graph, NONE, 'early-prehm')
    const owned = weapons.find((w) => w.damageClass === 'melee' && getField(w, 'gatedBy').status === 'unverified' && weaponProfile(w).ok)
    if (!owned) throw new Error('no melee weapon with Unknown availability and known stats')
    const { result } = run({ step: 2, stage: 'early-prehm', cls: 'melee', owned: [owned.id], pins: {} })
    const main = result.slots.find((s) => s.id === 'main')
    expect(main?.pool).toMatchObject({ owned: 1 })
    expect(plain(main?.disclosure ?? [])).toMatch(/^Scored from \d+ candidates: \d+ verified obtainable at your progress \+ 1 owned \(unverified\)\./)
    expect(plain(main?.pick?.rationale ?? [])).toMatch(/verified obtainable at your progress \+ 1 owned \(unverified\)\./)
    expect(copy.swapCount(41, 41, 1)).toBe('41 candidates: 40 verified obtainable + 1 owned (unverified).')
    expect(copy.swapCount(40, 45, 1)).toBe('40 of 45 candidates shown (44 verified obtainable + 1 owned, unverified) — filter to find more.')
    expect(ep.size).toBe(0)
  })

  it('H4: a summoner’s accessories — no yoyo / arrow effect fills a slot; every 0-point pick is tagged on its card and listed in Step 3', () => {
    const state: LoadoutState = { step: 2, stage: 'early-prehm', cls: 'summon', difficulty: 'master', goal: 'balanced', owned: [], pins: {} }
    const { html, result, eff } = stepTwo(state)
    const accessories = result.slots.filter((s) => s.group === 'accessories')
    for (const s of accessories) expect(plain(s.pick?.rationale ?? []), s.id).not.toMatch(/yoyo|arrow/i)
    const zero = result.slots.filter((s) => s.pick?.zeroPoints)
    expect(zero.length).toBeGreaterThan(0)
    for (const s of zero) expect(html, s.id).toMatch(new RegExp(`data-slot="${s.id}"[\\s\\S]*?data-zero-points=""`))
    expect(count(html, /data-zero-points=""/g)).toBe(zero.length)
    const why = wrap(createElement(WhyStep, { page, result, eff }))
    for (const s of zero) expect(why, s.id).toContain(`data-zero-point="${s.id}"`)
    expect(text(why)).toContain(copy.zeroPointLine(slotLabel(zero[0].id)))
  })

  it('H5: the leave guard blocks only a navigation that leaves the builder, and only with unsaved changes', () => {
    expect(blocksLeave(true, { pathname: '/loadout' }, { pathname: '/bosses' })).toBe(true)
    // steps, swaps, Back / Forward inside the builder change only the query
    expect(blocksLeave(true, { pathname: '/loadout' }, { pathname: '/loadout' })).toBe(false)
    expect(blocksLeave(false, { pathname: '/loadout' }, { pathname: '/bosses' })).toBe(false)
    for (const t of [copy.LEAVE_TITLE, copy.leaveBody('My build'), copy.LEAVE_KEEP, copy.LEAVE, copy.STAY]) expect(auditCopy(t), t).toBeUndefined()
  })

  it('M2: the summary line names the boss being prepared for', () => {
    expect(copy.loadoutMeta('Ranged', 'Early Hardmode', 'Expert', 'Boss fight', 'Plantera')).toBe('Ranged · Early Hardmode · Expert Mode · Boss fight · Preparing for Plantera')
    expect(copy.loadoutMeta('Ranged', 'Early Hardmode', 'Expert', 'Boss fight')).toBe('Ranged · Early Hardmode · Expert Mode · Boss fight')
  })

  it('M3: a reopened build reads as the recommendation where it is one, and an owned-Unknown pick keeps its "you own this" chip', () => {
    const owned = weapons.find((w) => w.damageClass === 'melee' && getField(w, 'gatedBy').status === 'unverified' && weaponProfile(w).ok)
    if (!owned) throw new Error('no owned candidate')
    const draft: LoadoutState = { step: 2, stage: 'early-hm', cls: 'melee', difficulty: 'expert', goal: 'boss', owned: [owned.id], pins: { main: { kind: 'item', id: owned.id } } }
    const before = run(draft)
    const saved: SavedBuild = { ...draftFrom('Reopen', before.eff, before.result, draft.pins), buildId: 'b-test-0009', createdAt: '2026-10-14T12:00:00.000Z', updatedAt: '2026-10-14T12:00:00.000Z' }
    const opened = stateFromBuild(saved, page.engine)
    const { html, result } = stepTwo(opened)
    expect(html).toMatch(/data-slot="main"[\s\S]*?data-owned=""/)
    for (const s of result.slots) {
      if (!s.pick || s.id === 'main') continue
      expect(plain(s.pick.rationale), s.id).toMatch(/^Your pick, and also the recommendation\. /)
    }
  })

  it('M4: a draft that fixes a weapon but names no stage waits for the stage at Step 1 — prompted, nothing pre-chosen — and choosing it keeps the weapon', () => {
    const zenith = weapons.find((w) => w.name === 'Zenith') ?? weapons[0]
    const { state } = parse(builderHrefFor(zenith).replace('/loadout', ''))
    const html = wrap(createElement(InputsStep, { ...inputProps(state), stageAwaiting: stageAwaiting(state), pinnedItemName: zenith.name }))
    const stage = /<fieldset[^>]*data-awaiting=""[\s\S]*?<\/fieldset>/.exec(html)?.[0] ?? ''
    expect(stage).toContain('data-stage-prompt=""')
    expect(text(stage)).toContain(copy.stagePrompt(zenith.name))
    expect(text(stage)).toContain(copy.stageAwaitingFallback('Early Pre-Hardmode'))
    expect(stage).not.toMatch(/type="radio"[^>]*checked/)
    expect(stage).not.toContain('data-default="stage"')
    // the first stage choice keeps the weapon; afterwards it's an ordinary rebuild
    const chosen = withInputs(state, { stage: 'endgame' })
    expect(chosen).toEqual({ next: { ...state, stage: 'endgame' }, reset: 0 })
    expect(stageAwaiting(chosen.next)).toBe(false)
    expect(withInputs(chosen.next, { stage: 'mid-hm' }).reset).toBe(1)
    // while awaiting, difficulty / goal / boss (and their skips) keep it too; a class change rebuilds (the weapon was fixed for its class)
    expect(withInputs(state, { goal: 'boss' })).toEqual({ next: { ...state, goal: 'boss' }, reset: 0 })
    expect(withInputs(state, { difficulty: 'master' }).reset).toBe(0)
    expect(withInputs(state, { cls: 'magic' }).reset).toBe(1)
    expect(withSkipped(state, 'cls').reset).toBe(1)
    expect(withSkipped({ ...state, goal: 'boss' }, 'goal')).toEqual({ next: state, reset: 0 })
    // the awaiting state warns about exactly that, up front
    const warned = wrap(createElement(InputsStep, { ...inputProps(state), stageAwaiting: true, pinnedItemName: zenith.name, fixedPicks: 1 }))
    expect(text(warned)).toContain(copy.awaitingWarning(zenith.name))
    // a saved build never awaits (it carries its stage)
    expect(stageAwaiting({ ...state, build: 'b-test-0001' })).toBe(false)
  })

  it('M5 / M6 / M7 / M8: 768+ side by side; pick names are 44px targets; stepper numerals ≥ 14px', () => {
    const { html, result } = stepTwo({ step: 2, stage: 'early-hm', cls: 'ranged', owned: [], pins: {} })
    expect(html).toContain('md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]')
    expect(html).toContain('md:sticky')
    const main = result.slots.find((s) => s.id === 'main')?.pick
    if (!main) throw new Error('main')
    expect(html).toMatch(new RegExp(`<a[^>]*class="[^"]*min-h-tap[^"]*"[^>]*data-item-link="${main.id}"`))
    const nav = wrap(createElement(StepNav, { step: 2, hrefFor: (n) => `/loadout?step=${n}` }))
    expect(count(nav, /font-display text-sm/g)).toBe(4)
    expect(nav).not.toContain('text-[0.625rem]')
  })

  it('M9: an ammo weapon scored without ammo says so in its row', () => {
    const score = { kind: 'dpp', value: 1, text: '1', label: 'x', formulaText: 'x', terms: [], effects: [], noAmmo: true } satisfies PickScore
    expect(text(wrap(createElement(NoAmmoLine, { score })))).toContain(copy.NO_AMMO)
    expect(wrap(createElement(NoAmmoLine, { score: { ...score, noAmmo: undefined } }))).toBe('')
  })

  it('M11: every profile figure with a value carries its est. chip', () => {
    const { result, eff } = run({ step: 3, stage: 'early-hm', cls: 'ranged', difficulty: 'expert', goal: 'boss', owned: [], pins: {} })
    const why = wrap(createElement(WhyStep, { page, result, eff }))
    for (const c of result.profile.components) {
      const card = new RegExp(`data-component="${c.id}"[\\s\\S]*?</li>`).exec(why)?.[0] ?? ''
      if (c.value === undefined) expect(card, c.id).not.toContain('data-estimate=')
      else expect(card, c.id).toContain(`data-estimate="${builderCopy.profileCopy.estimateContext[c.estimate ?? 'edo']}"`)
    }
  })

  it('nit: each owned item says what the builder’s progress makes of it (Unknown: counted because owned; gated: kept apart)', () => {
    const unknown = weapons.find((w) => getField(w, 'gatedBy').status === 'unverified' && weaponProfile(w).ok)
    const gated = weapons.find((w) => w.gatedBy?.bosses.includes('moon-lord'))
    if (!unknown || !gated) throw new Error('fixtures')
    const state: LoadoutState = { ...EMPTY_STATE, owned: [unknown.id, gated.id] }
    const html = wrap(createElement(InputsStep, { ...inputProps(state), ep: effectiveProgress(page.engine.graph, NONE, 'early-prehm') }))
    expect(html).toMatch(new RegExp(`data-owned-item="${unknown.id}" data-owned-status="unknown"[\\s\\S]*?${copy.OWNED_STATUS.unknown}`))
    expect(html).toMatch(new RegExp(`data-owned-item="${gated.id}" data-owned-status="gated"[\\s\\S]*?data-gate-group="[^"]*moon-lord[\\s\\S]*?${copy.OWNED_STATUS.gated}`))
  })

  it('nit: every add-gear match says what the builder’s progress makes of it, as the picker’s hint promises — verified obtainable too, not only gated / Unknown', () => {
    const firecracker = weapons.find((w) => w.name === 'Firecracker')
    const unknown = weapons.find((w) => getField(w, 'gatedBy').status === 'unverified')
    if (!firecracker || !unknown) throw new Error('fixtures')
    const bossName = (id: string) => page.graph.nodeById.get(id)?.name ?? id
    const row = (w: Weapon, stage: 'early-prehm' | 'early-hm') =>
      wrap(createElement(OwnedOptionAvailability, { availability: availabilityOf(w, page.engine.graph, effectiveProgress(page.engine.graph, NONE, stage)), bossName }))
    const yes = row(firecracker, 'early-hm')
    expect(yes).toContain('data-owned-option-status="yes"')
    expect(text(yes).trim()).toBe(copy.OWNED_PICKER_YES)
    expect(row(firecracker, 'early-prehm')).toMatch(/data-gate-group="[^"]*wall-of-flesh/)
    const u = row(unknown, 'early-hm')
    expect(u).toContain('data-owned-option-status="unknown"')
    expect(text(u)).toContain(copy.AVAILABILITY_WORD)
    expect(copy.OWNED_PICKER_START_BODY).toMatch(/verified obtainable at your progress/)
  })

  it('H2 residual: beside a pinned main scoring below it, the alt card says it outscores the pick (the review repro: summon, Durendal owned, Starcrash pinned)', () => {
    const id = (name: string) => weapons.find((w) => w.name === name)?.id ?? -1
    const state: LoadoutState = { step: 2, stage: 'early-hm', cls: 'summon', owned: [id('Durendal')], pins: { main: { kind: 'item', id: id('Starcrash') } } }
    const { html, result } = stepTwo(state)
    expect(result.slots.find((s) => s.id === 'alt')?.pick?.name).toBe('Durendal')
    expect(text(html)).toContain(plain(builderCopy.rationale.altSameType(true)))
    expect(text(html)).not.toContain(plain(builderCopy.rationale.altSameType()))
    // unpinned: the alt keeps its "next-highest" line
    expect(text(stepTwo({ ...state, pins: {} }).html)).toContain(plain(builderCopy.rationale.altSameType()))
  })

  it('nit: a 0-point pick reads "not scored" — never "for your class", which a class-less effect (regeneration, the time) isn’t scored for either', () => {
    expect(copy.ZERO_POINTS_TAG).toBe('not scored')
    expect(copy.zeroPointLine('Accessory 2')).toBe('(accessory 2): 0 counted points — its effects aren’t scored.')
    expect(plain(builderCopy.rationale.accessorySpecial('def', 'Slowly regenerates life'))).toMatch(/This one adds 0 counted points — its effect is not scored: Slowly regenerates life\.?$/)
  })
})

describe('copy audit (SCORING_SPEC §8.4; UX_SPEC §10.3): no "best", outcome, odds or forward-promise wording', () => {
  /** Representative calls of every template in the copy module (a new template must be added here). */
  const SAMPLES: Record<string, () => string[]> = {
    stepOf: () => [copy.stepOf(2, 4)],
    nextTo: () => [copy.nextTo('Loadout')],
    backTo: () => [copy.backTo('Inputs')],
    skipFor: () => [copy.skipFor('Class')],
    defaultNote: () => [copy.defaultNote('Melee')],
    ownedRemove: () => [copy.ownedRemove('Zenith')],
    regenerated: () => [copy.regenerated(0), copy.regenerated(1), copy.regenerated(3)],
    rebuildWarning: () => [copy.rebuildWarning(1), copy.rebuildWarning(4)],
    inputsWarning: () => [copy.inputsWarning(1), copy.inputsWarning(2)],
    stagePrompt: () => [copy.stagePrompt('Zenith')],
    awaitingWarning: () => [copy.awaitingWarning('Zenith')],
    stageAwaitingFallback: () => [copy.stageAwaitingFallback('Early Pre-Hardmode')],
    loadoutMeta: () => [copy.loadoutMeta('Ranged', 'Early Hardmode', 'Expert', 'Boss fight'), copy.loadoutMeta('Ranged', 'Early Hardmode', 'Expert', 'Boss fight', 'Plantera')],
    preparingFor: () => [copy.preparingFor('Plantera')],
    accessoryShort: () => [copy.accessoryShort(3)],
    ammoShort: () => [copy.ammoShort(1)],
    buffShort: () => [copy.buffShort(2)],
    overviewFilled: () => [copy.overviewFilled('Main weapon', 'Zenith')],
    overviewEmpty: () => [copy.overviewEmpty('Accessory 3')],
    overviewLocked: () => [copy.overviewLocked('Demon Heart slot')],
    zeroPointLine: () => [copy.zeroPointLine('Accessory 2')],
    leaveBody: () => [copy.leaveBody('My build')],
    accessoryLabel: () => [copy.accessoryLabel(3)],
    ammoLabel: () => [copy.ammoLabel(1)],
    buffLabel: () => [copy.buffLabel(2)],
    quotaTag: () => [copy.quotaTag('offense')],
    weightTerm: () => [copy.weightTerm('0.45', '9')],
    useThisSr: () => [copy.useThisSr('Zenith', 'Main weapon')],
    swapSr: () => [copy.swapSr('Main weapon')],
    resetPickSr: () => [copy.resetPickSr('Main weapon')],
    NOT_SCORED_PIN: () => [copy.NOT_SCORED_PIN('damage')],
    swapsCount: () => [copy.swapsCount(1), copy.swapsCount(4)],
    swapTitle: () => [copy.swapTitle('Accessory 2')],
    swapCount: () => [copy.swapCount(3, 3), copy.swapCount(40, 48), copy.swapCount(41, 41, 1), copy.swapCount(40, 45, 1)],
    swapped: () => [copy.swapped('Zenith', 'Main weapon')],
    emptied: () => [copy.emptied('Main weapon')],
    resetDone: () => [copy.resetDone('Main weapon')],
    goalWeight: () => [copy.goalWeight('Boss fight', 45)],
    setBonusActive: () => [copy.setBonusActive('Hallowed armor')],
    notScoredFrom: () => [copy.notScoredFrom('Shield of Cthulhu')],
    mismatchesTitle: () => [copy.mismatchesTitle('ranged')],
    inputUsed: () => [copy.inputUsed('Class', 'Melee', true), copy.inputUsed('Class', 'Ranged', false)],
    ownedCount: () => [copy.ownedCount(0), copy.ownedCount(1), copy.ownedCount(3)],
    savedAnnounce: () => [copy.savedAnnounce('My build')],
    copyName: () => [copy.copyName('My build')],
    editing: () => [copy.editing('My build')],
    openSr: () => [copy.openSr('My build')],
    deleteSr: () => [copy.deleteSr('My build')],
    DELETE_TITLE: () => [copy.DELETE_TITLE('My build')],
    deleted: () => [copy.deleted('My build')],
    buildMeta: () => [copy.buildMeta('Ranged', 'Early Hardmode', 'Expert', 'Boss fight'), copy.buildMeta('Melee', 'Endgame', 'Classic', undefined)],
    updatedOn: () => [copy.updatedOn('Oct 14, 2026')],
    ownedPickerCount: () => [copy.ownedPickerCount(1), copy.ownedPickerCount(5)],
    ownedPickerNone: () => [copy.ownedPickerNone('zen')],
    ownedAdded: () => [copy.ownedAdded('Zenith')],
    ownedRemoved: () => [copy.ownedRemoved('Zenith')],
    linkIgnored: () => [copy.linkIgnored(copy.LINK_BOSS)],
    // P4-S3 / P4-S4
    compareThisSr: () => [copy.compareThisSr('My build')],
    analyzeBuildSr: () => [copy.analyzeBuildSr('My build')],
    deltaLine: () => [copy.deltaLine('+3'), copy.deltaLine(copy.DELTA_SAME)],
    fitDropped: () => [copy.fitDropped('Estimated damage per second')],
    FIT_FOOTER: () => [copy.FIT_FOOTER(2)],
    compareContext: () => [copy.compareContext(copy.COMPARE_WHAT.defense, 'My build')],
    comparing: () => [copy.comparing('My build')],
    comparisonRegion: () => [copy.comparisonRegion('My build')],
    slotsDiffer: () => [copy.slotsDiffer(0), copy.slotsDiffer(1), copy.slotsDiffer(5)],
    surpriseWarning: () => [copy.surpriseWarning(1), copy.surpriseWarning(3)],
    surpriseDrawn: () => [copy.surpriseDrawn(0), copy.surpriseDrawn(1), copy.surpriseDrawn(4)],
    barNoReference: () => [copy.barNoReference(copy.BAR_NONE_WORD.estDamage)],
    barZeroReference: () => [copy.barZeroReference(copy.BAR_NONE_WORD.mobility)],
    referenceContext: () => [copy.referenceContext(copy.REFERENCE_WHAT.mobility)],
    // AMENDMENTS-016 B113b
    fitUnder: () => [copy.fitUnder('Survivability')],
    fitLeaning: () => [copy.fitLeaning(copy.FIT_SIDE.saved, '24.4'), copy.fitLeaning(copy.FIT_SIDE.draft, '0.1')],
    fitSum: () => [copy.fitSum('(0.35 × 60.0) ÷ 0.35 = 60.0')],
    buildsCount: () => [copy.buildsCount(1), copy.buildsCount(4)],
    madeFor: () => [copy.madeFor('Plantera')],
    previewLabel: () => [copy.previewLabel('My build')],
  }

  function allCopy(): string[] {
    const out: string[] = []
    const walk = (key: string, value: unknown) => {
      if (typeof value === 'string') out.push(value)
      else if (typeof value === 'function') {
        const sample = SAMPLES[key]
        if (!sample) throw new Error(`copy.${key}: add representative calls to SAMPLES`)
        out.push(...sample())
      } else if (typeof value === 'object' && value) {
        for (const [k, v] of Object.entries(value)) {
          if (typeof v === 'function') out.push((v as (...a: unknown[]) => string)(3, 'x'))
          else walk(`${key}.${k}`, v)
        }
      }
    }
    for (const [key, value] of Object.entries(copy)) walk(key, value)
    return out
  }

  it('every UI string', () => {
    const strings = allCopy()
    expect(strings.length).toBeGreaterThan(150)
    for (const s of strings) expect(auditCopy(s), s).toBeUndefined()
  })

  it('the rendered steps, in two goal / class combos and a pinned state (wiki quotes removed)', () => {
    const states: LoadoutState[] = [
      { step: 2, stage: 'early-hm', cls: 'ranged', difficulty: 'expert', goal: 'boss', owned: [], pins: {} },
      { step: 2, stage: 'mid-hm', cls: 'summon', difficulty: 'master', goal: 'survivability', boss: 'plantera', owned: [], pins: {} },
      { step: 2, stage: 'early-prehm', cls: 'hybrid', difficulty: 'classic', goal: 'exploration', owned: [], pins: { main: { kind: 'item', id: weapons[0].id }, acc0: { kind: 'empty' } } },
      // B108: a summoner (0-point picks named) with a target boss, and a pinned build
      { step: 2, stage: 'early-prehm', cls: 'summon', difficulty: 'master', goal: 'balanced', boss: 'eye-of-cthulhu', owned: [], pins: { alt: { kind: 'empty' } } },
    ]
    for (const state of states) {
      const { html, result, eff } = stepTwo(state)
      const why = wrap(createElement(WhyStep, { page, result, eff }))
      for (const out of [html, why]) {
        const t = ownText(out)
        expect(auditCopy(t), auditCopy(t)).toBeUndefined()
      }
    }
  })
})
