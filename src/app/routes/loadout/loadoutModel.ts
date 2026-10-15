/**
 * Loadout builder page model (PRD P4-S2; UX_SPEC §1 `/loadout?step=1..4`, `?build=:localId`, §3.5,
 * §4(c), §6): pure helpers between the URL, the engine (src/scoring/recommend.ts) and the views. No
 * React.
 *
 * URL state is the draft: every input and every swap lives in the query string, so a reload, the back
 * button or a shared link restores the exact loadout (`?step=2&class=ranged&goal=boss&main=434`).
 * An ABSENT input means "skipped — use the default" (noted in Step 3). Saved builds live in
 * tc.v1.builds; `build=<id>` marks the draft as editing one.
 *
 *   step=1..4 · stage · class · difficulty · goal · boss · owned=<id>,<id> ·
 *   main · alt · armor=<helmet>.<chest>.<legs> (- for none) · acc1..acc7 · ammo1 · ammo2 · buff1..buff3 ·
 *   summon (an item id, or "none" = deliberately empty) · build=<buildId> ·
 *   surprise=<seed> (P4-S4 Surprise Me: unfixed slots drawn at random) · vs=<buildId> (Step 4: the saved
 *   build compared with the draft) · view=builds (the saved-builds list, a builder sub-view)
 */
import type { Difficulty, Goal, LoadoutClass } from '../../../schemas'
import { ACCESSORY_SLOT_IDS, AMMO_SLOT_IDS, BUFF_SLOT_IDS, isSeed, SEED_MAX, SLOT_IDS, type BuilderData, type BuilderInput, type BuilderResult, type Pin, type Pins, type SlotId } from '../../../scoring/recommend'
import type { TrackedProgress } from '../../../scoring/progress'
import { SLOT_COUNT } from '../../../scoring/constants'
import { BUILD_GOALS, type BuildGoal, type SavedBuild } from '../../../storage/builds'
import { READINESS_CLASSES, READINESS_DIFFICULTIES, STORED_ACCESSORY_SLOTS, type ReadinessLoadout } from '../../../storage/readiness'
import type { BuildDraft } from '../../buildsStore'
import { getStageInfo, isStage, type Stage } from '../../stages'
import * as copy from './loadoutCopy'
import { BUILDS_VIEW_HREF, buildOpenHref, LOADOUT_PATH } from './loadoutLinks'

export { BUILDS_VIEW_HREF, buildOpenHref, LOADOUT_PATH }
export const STEP_COUNT = 4
export type Step = 1 | 2 | 3 | 4
export const STEPS: readonly Step[] = [1, 2, 3, 4]

/** The draft as the URL holds it. Absent inputs are skipped (defaults apply). */
export interface LoadoutState {
  step: Step
  stage?: Stage
  cls?: LoadoutClass
  difficulty?: Difficulty
  goal?: Goal
  boss?: string
  owned: number[]
  pins: Pins
  build?: string
  /** Surprise Me's seed (SCORING_SPEC §4.8): the slots no pin fixes are drawn at random. */
  surprise?: number
  /** Step 4: the saved build shown beside the draft. */
  vs?: string
  /** The saved-builds list instead of the wizard. */
  view?: 'builds'
}

export const EMPTY_STATE: LoadoutState = { step: 1, owned: [], pins: {} }

/** A fresh Surprise Me seed (1 … 2^32 − 1). */
export const newSeed = (random: () => number = Math.random): number => 1 + Math.floor(random() * SEED_MAX)

/** SCORING_SPEC §4 defaults: stage from settings else Early Pre-HM; melee; Classic; balanced; no boss. */
export const DEFAULTS = { cls: 'melee', difficulty: 'classic', goal: 'balanced' } as const satisfies { cls: LoadoutClass; difficulty: Difficulty; goal: Goal }
/** Owned items a link may carry. */
export const OWNED_MAX = 40

export interface EffectiveInputs {
  stage: Stage
  cls: LoadoutClass
  difficulty: Difficulty
  goal: Goal
  bossId: string | null
  owned: number[]
  skipped: { stage: boolean; cls: boolean; difficulty: boolean; goal: boolean; boss: boolean }
}

export function effectiveInputs(state: LoadoutState, defaultStage: Stage | null): EffectiveInputs {
  return {
    stage: state.stage ?? defaultStage ?? 'early-prehm',
    cls: state.cls ?? DEFAULTS.cls,
    difficulty: state.difficulty ?? DEFAULTS.difficulty,
    goal: state.goal ?? DEFAULTS.goal,
    bossId: state.boss ?? null,
    owned: state.owned,
    skipped: { stage: state.stage === undefined, cls: state.cls === undefined, difficulty: state.difficulty === undefined, goal: state.goal === undefined, boss: state.boss === undefined },
  }
}

export function engineInput(eff: EffectiveInputs, progress: TrackedProgress, pins: Pins, seed?: number): BuilderInput {
  return { stage: eff.stage, cls: eff.cls, difficulty: eff.difficulty, goal: eff.goal, bossId: eff.bossId, owned: eff.owned, progress, pins, ...(seed !== undefined ? { seed } : {}) }
}

// --- URL --------------------------------------------------------------------------------------------------

/** URL param per pin slot (1-based accessory / ammo / potion numbers, as people count). */
export const PIN_PARAMS: Readonly<Record<SlotId, string>> = {
  main: 'main',
  alt: 'alt',
  armor: 'armor',
  ...(Object.fromEntries(ACCESSORY_SLOT_IDS.map((id, i) => [id, `acc${i + 1}`])) as Record<(typeof ACCESSORY_SLOT_IDS)[number], string>),
  ...(Object.fromEntries(AMMO_SLOT_IDS.map((id, i) => [id, `ammo${i + 1}`])) as Record<(typeof AMMO_SLOT_IDS)[number], string>),
  ...(Object.fromEntries(BUFF_SLOT_IDS.map((id, i) => [id, `buff${i + 1}`])) as Record<(typeof BUFF_SLOT_IDS)[number], string>),
  summon: 'summon',
}
const PIN_SLOTS = Object.keys(PIN_PARAMS) as SlotId[]

const ITEM_ID = /^[1-9]\d{0,8}$/
const BUILD_ID = /^[A-Za-z0-9-]{8,64}$/
const isClass = (v: string | null): v is LoadoutClass => v !== null && (READINESS_CLASSES as readonly string[]).includes(v)
const isDifficulty = (v: string | null): v is Difficulty => v !== null && (READINESS_DIFFICULTIES as readonly string[]).includes(v)
const isGoal = (v: string | null): v is BuildGoal => v !== null && (BUILD_GOALS as readonly string[]).includes(v)

function parsePin(slot: SlotId, raw: string): Pin | undefined {
  if (raw === 'none') return { kind: 'empty' }
  if (slot === 'armor') {
    const parts = raw.split('.')
    if (parts.length !== 3 || !parts.every((p) => p === '-' || ITEM_ID.test(p)) || parts.every((p) => p === '-')) return undefined
    const [helmet, chest, legs] = parts.map((p) => (p === '-' ? null : Number(p)))
    return { kind: 'armor', helmet, chest, legs }
  }
  return ITEM_ID.test(raw) ? { kind: 'item', id: Number(raw) } : undefined
}

function pinValue(pin: Pin): string {
  if (pin.kind === 'empty') return 'none'
  if (pin.kind === 'item') return String(pin.id)
  return [pin.helmet, pin.chest, pin.legs].map((x) => (x === null ? '-' : String(x))).join('.')
}

/** Parses the query; what it can't use is said (a notice per kind), never silently dropped. */
export function parseLoadoutSearch(params: URLSearchParams, isBoss: (id: string) => boolean): { state: LoadoutState; notices: string[] } {
  const problems = new Set<string>()
  const value = (key: string) => {
    const v = params.get(key)
    return v === null || v === '' ? null : v
  }
  const pick = <T extends string>(key: string, ok: (v: string) => boolean): T | undefined => {
    const v = value(key)
    if (v === null) return undefined
    if (ok(v)) return v as T
    problems.add(copy.LINK_VALUES)
    return undefined
  }
  const stepRaw = value('step')
  const step = stepRaw !== null && /^[1-4]$/.test(stepRaw) ? (Number(stepRaw) as Step) : 1
  if (stepRaw !== null && step === 1 && stepRaw !== '1') problems.add(copy.LINK_VALUES)
  const stage = pick<Stage>('stage', isStage)
  const cls = pick<LoadoutClass>('class', isClass)
  const difficulty = pick<Difficulty>('difficulty', isDifficulty)
  const goal = pick<Goal>('goal', isGoal)
  const bossRaw = value('boss')
  let boss: string | undefined
  if (bossRaw !== null) {
    if (isBoss(bossRaw)) boss = bossRaw
    else problems.add(copy.LINK_BOSS)
  }
  const owned: number[] = []
  for (const part of (value('owned') ?? '').split(',')) {
    if (part === '') continue
    if (!ITEM_ID.test(part)) problems.add(copy.LINK_ITEMS)
    else if (!owned.includes(Number(part)) && owned.length < OWNED_MAX) owned.push(Number(part))
  }
  const pins: Partial<Record<SlotId, Pin>> = {}
  for (const slot of PIN_SLOTS) {
    const raw = value(PIN_PARAMS[slot])
    if (raw === null) continue
    const pin = parsePin(slot, raw)
    if (pin) pins[slot] = pin
    else problems.add(copy.LINK_ITEMS)
  }
  const buildRaw = value('build')
  const build = buildRaw !== null && BUILD_ID.test(buildRaw) ? buildRaw : undefined
  if (buildRaw !== null && !build) problems.add(copy.LINK_VALUES)
  const surpriseRaw = value('surprise')
  const surprise = surpriseRaw !== null && /^\d{1,10}$/.test(surpriseRaw) && isSeed(Number(surpriseRaw)) ? Number(surpriseRaw) : undefined
  if (surpriseRaw !== null && surprise === undefined) problems.add(copy.LINK_VALUES)
  const vsRaw = value('vs')
  const vs = vsRaw !== null && BUILD_ID.test(vsRaw) ? vsRaw : undefined
  if (vsRaw !== null && !vs) problems.add(copy.LINK_VALUES)
  const viewRaw = value('view')
  const view = viewRaw === 'builds' ? viewRaw : undefined
  if (viewRaw !== null && !view) problems.add(copy.LINK_VALUES)
  const state: LoadoutState = {
    step,
    ...(stage ? { stage } : {}),
    ...(cls ? { cls } : {}),
    ...(difficulty ? { difficulty } : {}),
    ...(goal ? { goal } : {}),
    ...(boss ? { boss } : {}),
    owned,
    pins,
    ...(build ? { build } : {}),
    ...(surprise !== undefined ? { surprise } : {}),
    ...(vs ? { vs } : {}),
    ...(view ? { view } : {}),
  }
  return { state, notices: [...problems].map(copy.linkIgnored) }
}

/** The query string for a state ("" for the empty draft at step 1). Values use a URL-safe charset, kept literal. */
export function loadoutSearch(state: LoadoutState): string {
  const parts: string[] = []
  const add = (k: string, v: string | undefined) => {
    if (v !== undefined) parts.push(`${k}=${v}`)
  }
  if (state.step !== 1) add('step', String(state.step))
  add('stage', state.stage)
  add('class', state.cls)
  add('difficulty', state.difficulty)
  add('goal', state.goal)
  add('boss', state.boss)
  if (state.owned.length > 0) add('owned', state.owned.join(','))
  for (const slot of PIN_SLOTS) {
    const pin = state.pins[slot]
    if (pin) add(PIN_PARAMS[slot], pinValue(pin))
  }
  add('build', state.build)
  add('surprise', state.surprise === undefined ? undefined : String(state.surprise))
  add('vs', state.vs)
  add('view', state.view)
  return parts.length > 0 ? `?${parts.join('&')}` : ''
}

export const loadoutHref = (state: Partial<LoadoutState> = {}): string => `${LOADOUT_PATH}${loadoutSearch({ ...EMPTY_STATE, ...state })}`

/** A count of the user's own picks (swaps) in the draft. */
export const pinCount = (pins: Pins): number => Object.keys(pins).length

/**
 * AMENDMENTS-016 B108(c) M4: a draft that fixes picks but names no stage — compare's "Open in Builder"
 * — waits for the stage at Step 1 instead of silently defaulting it. Until the stage is chosen, setting
 * it (or the difficulty, goal or boss) keeps those picks — the point of the link; a class change
 * rebuilds without them (the item was fixed for its class). Once the stage is chosen, any input change
 * rebuilds as usual (with the advance warning).
 */
export const stageAwaiting = (state: LoadoutState): boolean => state.stage === undefined && pinCount(state.pins) > 0 && state.build === undefined

/**
 * The input change Step 1 / the regenerate bar applies: a rebuild resets every fixed pick (stage
 * legality, AMENDMENTS-016 B106), except the first stage choice of an awaiting draft (B108(c)).
 */
export function withInputs(state: LoadoutState, change: Partial<Pick<LoadoutState, 'stage' | 'cls' | 'difficulty' | 'goal' | 'boss'>>): { next: LoadoutState; reset: number } {
  const keep = stageAwaiting(state) && !('cls' in change)
  return { next: { ...state, ...change, pins: keep ? state.pins : {} }, reset: keep ? 0 : pinCount(state.pins) }
}

/** "Skip — use default" on an input: the same rule as changing it (an awaiting draft keeps its picks unless the class goes). */
export function withSkipped(state: LoadoutState, field: 'stage' | 'cls' | 'difficulty' | 'goal' | 'boss'): { next: LoadoutState; reset: number } {
  const { [field]: _dropped, ...rest } = state
  const keep = stageAwaiting(state) && field !== 'cls'
  return { next: { ...(rest as LoadoutState), pins: keep ? state.pins : {} }, reset: keep ? 0 : pinCount(state.pins) }
}

/**
 * UX_SPEC §6 leave guard (B108 H5): only a navigation that LEAVES the builder (another path) while a
 * saved build has unsaved changes. Steps, swaps, Back / Forward within the builder and link restores
 * change only the query, so they are never blocked.
 */
export const blocksLeave = (unsaved: boolean, current: { pathname: string }, next: { pathname: string }): boolean => unsaved && current.pathname !== next.pathname

// --- saved builds ------------------------------------------------------------------------------------------

/**
 * The slots a saved build reopens as user-emptied (AMENDMENTS-016 B106). A v2 build lists them. A v1
 * build has no marker: every stored null reads as deliberately empty (DATA_SCHEMA_SPEC §8a) — each slot
 * the difficulty has, and the potion positions past its stored potions — exactly as v1 builds always
 * reopened.
 */
export function savedEmptiedSlots(build: Pick<SavedBuild, 'emptiedSlots' | 'slots' | 'difficulty'>): SlotId[] {
  if (build.emptiedSlots) return [...build.emptiedSlots]
  const s = build.slots
  const empty = new Set<SlotId>()
  if (s.mainWeapon === null) empty.add('main')
  if (s.altWeapon === null) empty.add('alt')
  if (s.helmet === null && s.chest === null && s.legs === null) empty.add('armor')
  ACCESSORY_SLOT_IDS.slice(0, SLOT_COUNT[build.difficulty]).forEach((slot, i) => {
    if ((s.accessories[i] ?? null) === null) empty.add(slot)
  })
  BUFF_SLOT_IDS.forEach((slot, i) => {
    if (s.buffs[i] === undefined) empty.add(slot)
  })
  if (s.summon === null) empty.add('summon')
  return SLOT_IDS.filter((slot) => empty.has(slot))
}

/**
 * A saved build as pins: every filled slot holds exactly what was saved, and each slot the user emptied
 * reopens pinned empty ("kept empty"). A slot the recommendation had left unfilled (v2: null, not listed
 * as emptied) is left to the recommendation again, which says why it is empty. Ammo returns to the slot
 * whose weapon fires it, and potions to their positions around the emptied ones (LoadoutSlots.ammo and
 * .buffs are plain lists).
 */
export function pinsFromBuild(build: SavedBuild, data: Pick<BuilderData, 'weapons' | 'items'>): Pins {
  const s = build.slots
  const emptied = new Set(savedEmptiedSlots(build))
  const pins: Partial<Record<SlotId, Pin>> = {}
  const put = (slot: SlotId, id: number | null) => {
    if (id !== null) pins[slot] = { kind: 'item', id }
    else if (emptied.has(slot)) pins[slot] = { kind: 'empty' }
  }
  put('main', s.mainWeapon)
  put('alt', s.altWeapon)
  if (s.helmet !== null || s.chest !== null || s.legs !== null) pins.armor = { kind: 'armor', helmet: s.helmet, chest: s.chest, legs: s.legs }
  else if (emptied.has('armor')) pins.armor = { kind: 'empty' }
  put('summon', s.summon)
  ACCESSORY_SLOT_IDS.slice(0, SLOT_COUNT[build.difficulty]).forEach((slot, i) => put(slot, s.accessories[i] ?? null))
  const potions = [...s.buffs]
  BUFF_SLOT_IDS.forEach((slot) => put(slot, emptied.has(slot) ? null : (potions.shift() ?? null)))
  const ammoClassOf = (id: number | null) => (id === null ? undefined : data.weapons.get(id)?.ammoClass)
  const ammoOf = (id: number) => (data.items.get(id) ?? data.weapons.get(id))?.ammoStats?.ammoClass
  const mainClass = ammoClassOf(s.mainWeapon)
  const altClass = ammoClassOf(s.altWeapon)
  // An ammo slot saved empty and not marked emptied (every v1 one) is left to the recommendation: its
  // emptiness is almost always "none obtainable", and the engine says so.
  const mainAmmo = mainClass ? s.ammo.find((id) => ammoOf(id) === mainClass) : undefined
  const altAmmo = altClass && altClass !== mainClass ? s.ammo.find((id) => ammoOf(id) === altClass) : undefined
  put('ammo0', emptied.has('ammo0') ? null : (mainAmmo ?? null))
  put('ammo1', emptied.has('ammo1') ? null : (altAmmo ?? null))
  return pins
}

/** The draft state that opens a saved build (Step 2): its inputs — target boss and owned items too (v2) — and its slots. */
export function stateFromBuild(build: SavedBuild, data: Pick<BuilderData, 'weapons' | 'items'>, step: Step = 2): LoadoutState {
  return {
    step,
    stage: build.stage,
    cls: build.class,
    difficulty: build.difficulty,
    ...(build.goal ? { goal: build.goal } : {}),
    ...(build.targetBoss ? { boss: build.targetBoss } : {}),
    owned: [...(build.ownedIds ?? [])],
    pins: pinsFromBuild(build, data),
    build: build.buildId,
  }
}

const normalizeSlots = (l: ReadinessLoadout): ReadinessLoadout => ({ ...l, accessories: [...l.accessories, ...Array(STORED_ACCESSORY_SLOTS).fill(null)].slice(0, STORED_ACCESSORY_SLOTS) })

/** The slots the user emptied (pinned empty) among the loadout's slots — what tells them apart from unfilled ones. */
export function emptiedSlots(pins: Pins, result: BuilderResult): SlotId[] {
  return SLOT_IDS.filter((slot) => pins[slot]?.kind === 'empty' && result.slots.some((s) => s.id === slot))
}

/**
 * What Save writes (SavedBuild v2 minus id/timestamps, AMENDMENTS-016 B106): the inputs — the target
 * boss and the owned items included — the loadout the slots hold, and which empty slots the user emptied.
 */
export function draftFrom(name: string, eff: EffectiveInputs, result: BuilderResult, pins: Pins): BuildDraft {
  return {
    name: name.trim(),
    stage: eff.stage,
    class: eff.cls,
    difficulty: eff.difficulty,
    goal: eff.goal,
    slots: normalizeSlots(result.loadout),
    ...(eff.bossId !== null ? { targetBoss: eff.bossId } : {}),
    ownedIds: [...eff.owned],
    emptiedSlots: emptiedSlots(pins, result),
  }
}

/** UX_SPEC §6 "Unsaved changes": the draft's inputs, slots or emptied slots differ from the saved build. */
export function hasUnsavedChanges(build: SavedBuild, eff: EffectiveInputs, result: BuilderResult, pins: Pins): boolean {
  const a = draftFrom(build.name, eff, result, pins)
  const ids = (list: readonly number[]) => [...list].sort((x, y) => x - y).join(',')
  const savedEmptied = savedEmptiedSlots(build).filter((slot) => result.slots.some((s) => s.id === slot))
  return (
    a.stage !== build.stage ||
    a.class !== build.class ||
    a.difficulty !== build.difficulty ||
    a.goal !== (build.goal ?? DEFAULTS.goal) ||
    (a.targetBoss ?? null) !== (build.targetBoss ?? null) ||
    ids(a.ownedIds ?? []) !== ids(build.ownedIds ?? []) ||
    (a.emptiedSlots ?? []).join(',') !== savedEmptied.join(',') ||
    JSON.stringify(a.slots) !== JSON.stringify(normalizeSlots(build.slots))
  )
}

/** "Ranged · Early Hardmode · Boss fight". */
export function defaultBuildName(eff: EffectiveInputs): string {
  return [copy.CLASS_NAMES[eff.cls], getStageInfo(eff.stage).label, copy.GOAL_NAMES[eff.goal]].join(' · ')
}

/** The loadout's weapons for the comparison link (main, then alt). */
export function weaponIds(result: BuilderResult): number[] {
  return [result.loadout.mainWeapon, result.loadout.altWeapon].filter((x): x is number => x !== null)
}

/** The display label of a slot. */
export function slotLabel(slot: SlotId, demonHeart = false): string {
  if (slot === 'main' || slot === 'alt' || slot === 'armor' || slot === 'summon') return copy.SLOT_LABELS[slot]
  const accessory = (ACCESSORY_SLOT_IDS as readonly string[]).indexOf(slot)
  if (accessory >= 0) return demonHeart ? copy.DEMON_HEART_SLOT : copy.accessoryLabel(accessory + 1)
  const ammo = (AMMO_SLOT_IDS as readonly string[]).indexOf(slot)
  if (ammo >= 0) return copy.ammoLabel(ammo + 1)
  return copy.buffLabel((BUFF_SLOT_IDS as readonly string[]).indexOf(slot) + 1)
}

/** DOM id of a slot's card (the overview jumps to it; focus returns to its Swap button). */
export const slotCardId = (slot: SlotId) => `loadout-slot-${slot}`
export const swapButtonId = (slot: SlotId) => `loadout-swap-${slot}`
export const stepHeadingId = (step: Step) => `loadout-step-${step}`
/** The builds view's heading (focus lands there when the view opens). */
export const BUILDS_HEADING_ID = 'loadout-builds'
/** A saved build's card heading in the builds view (focus lands there after an import adds it). */
export const buildHeadingId = (buildId: string) => `build-${buildId}`
/** Step 4's comparison block (focus lands there when a saved build's "Compare" opens it). */
export const COMPARISON_ID = 'loadout-comparison'

/** Pins that follow a weapon: its ammo slot. Swapping a weapon drops them (they would no longer fit). */
export function withPin(pins: Pins, slot: SlotId, pin: Pin | undefined): Pins {
  const next: Partial<Record<SlotId, Pin>> = { ...pins }
  if (pin) next[slot] = pin
  else delete next[slot]
  if (slot === 'main') delete next.ammo0
  if (slot === 'alt') delete next.ammo1
  return next
}
