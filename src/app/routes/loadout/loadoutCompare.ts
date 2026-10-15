/**
 * Step 4 "Compare & Save" model (PRD P4-S4 AC1/AC2; UX_SPEC §3.5 Step4 CompareView; SCORING_SPEC §5.3)
 * and the Step 3 profile bars (PRD P4-S3 AC2). Pure helpers, no React.
 *
 * - The saved build is shown AS SAVED: every stored item pinned and every empty slot kept empty, so the
 *   current recommendation never fills a slot it holds empty (opening it in the builder may — B107). Its
 *   figures are re-scored against the current data and the tracked progress, like the draft's.
 * - Slot diffs tell user-emptied slots apart from ones the recommendation left unfilled (B106 v2 marker;
 *   a v1 build's empty slots read as emptied, its empty ammo as unfilled — the reopen rules).
 * - Differences are stated as differences (draft − saved), never as one side ahead of the other.
 */
import { contributionCopy, POINTS_WORD } from '../../../scoring/builderCopy'
import { compareLoadouts, type BuildProfile, type Contribution, type GoalComparison, type ProfileComponent } from '../../../scoring/goals'
import type { TrackedProgress } from '../../../scoring/progress'
import { recommendLoadout, SLOT_IDS, type BuilderData, type BuilderResult, type Pins, type RecommendOptions, type SlotId, type SlotResult } from '../../../scoring/recommend'
import { oneDecimal, whole } from '../../../scoring/readinessCopy'
import type { Goal } from '../../../schemas'
import type { SavedBuild } from '../../../storage/builds'
import * as copy from './loadoutCopy'
import { effectiveInputs, engineInput, pinsFromBuild, savedEmptiedSlots, slotLabel, stateFromBuild, type EffectiveInputs } from './loadoutModel'

/** A saved build as pins that hold it exactly: its items, and every other slot kept empty. */
export function frozenPinsFromBuild(build: SavedBuild, data: Pick<BuilderData, 'weapons' | 'items'>): Pins {
  const pins: Partial<Record<SlotId, Pins[SlotId]>> = { ...pinsFromBuild(build, data) }
  for (const slot of SLOT_IDS) if (!pins[slot]) pins[slot] = { kind: 'empty' }
  return pins
}

export interface SavedRun {
  build: SavedBuild
  eff: EffectiveInputs
  result: BuilderResult
}

/** A saved build scored as saved (its own stage, class, difficulty, goal, target boss and owned list; today's data and tracked progress). */
export function runSavedBuild(build: SavedBuild, data: BuilderData, progress: TrackedProgress, options: RecommendOptions = {}): SavedRun {
  const eff = effectiveInputs(stateFromBuild(build, data), build.stage)
  return { build, eff, result: recommendLoadout(engineInput(eff, progress, frozenPinsFromBuild(build, data)), data, options) }
}

// --- slot by slot -------------------------------------------------------------------------------------------

export type SideSlot =
  | { kind: 'item'; key: string; id: number; name: string; pieces?: readonly [number, number, number] }
  | { kind: 'emptied' | 'unfilled' | 'locked' | 'no-slot' | 'no-ammo' }

export type SlotDiffStatus = keyof typeof copy.SLOT_STATUS

export interface SlotDiffRow {
  slot: SlotId
  label: string
  draft: SideSlot
  saved: SideSlot
  status: SlotDiffStatus
}

function sideOf(result: BuilderResult, slot: SlotId, emptied: (slot: SlotId) => boolean): SideSlot {
  const s: SlotResult | undefined = result.slots.find((x) => x.id === slot)
  if (!s) return { kind: 'no-slot' }
  if (s.pick) return { kind: 'item', key: s.pick.key, id: s.pick.id, name: s.pick.name, ...(s.pick.pieces ? { pieces: s.pick.pieces } : {}) }
  if (s.state === 'locked') return { kind: 'locked' }
  if (s.group === 'ammo' && !s.ammoClass) return { kind: 'no-ammo' }
  return { kind: emptied(slot) ? 'emptied' : 'unfilled' }
}

/** The draft's side of a slot: user-emptied = pinned empty. */
export const draftSide = (result: BuilderResult, pins: Pins, slot: SlotId): SideSlot => sideOf(result, slot, (id) => pins[id]?.kind === 'empty')

/** The saved build's side of a slot: user-emptied = listed by the build (v2), or every non-ammo empty slot of a v1 build. */
export function savedSide(run: SavedRun, slot: SlotId): SideSlot {
  const emptied = new Set(savedEmptiedSlots(run.build))
  return sideOf(run.result, slot, (id) => emptied.has(id))
}

const sameItem = (a: SideSlot, b: SideSlot): boolean => {
  if (a.kind !== 'item' || b.kind !== 'item') return false
  if (a.pieces || b.pieces) return (a.pieces ?? []).join('.') === (b.pieces ?? []).join('.')
  return a.id === b.id
}

/** Every slot either build has, in slot order, with what each side holds and how they differ. */
export function diffSlots(draft: { result: BuilderResult; pins: Pins }, saved: SavedRun): SlotDiffRow[] {
  const rows: SlotDiffRow[] = []
  for (const slot of SLOT_IDS) {
    const d = draftSide(draft.result, draft.pins, slot)
    const s = savedSide(saved, slot)
    if ((d.kind === 'no-slot' || d.kind === 'no-ammo') && (s.kind === 'no-slot' || s.kind === 'no-ammo')) continue
    const demonHeart = [draft.result, saved.result].some((r) => r.slots.find((x) => x.id === slot)?.demonHeart)
    const status: SlotDiffStatus =
      d.kind === 'item' && s.kind === 'item' ? (sameItem(d, s) ? 'same' : 'changed') : d.kind === 'item' ? 'draft-only' : s.kind === 'item' ? 'saved-only' : 'both-empty'
    rows.push({ slot, label: slotLabel(slot, demonHeart), draft: d, saved: s, status })
  }
  return rows
}

export const differingSlots = (rows: readonly SlotDiffRow[]): number => rows.filter((r) => r.status !== 'same' && r.status !== 'both-empty').length

// --- profile, side by side ------------------------------------------------------------------------------------

export interface ProfileCompareRow {
  id: ProfileComponent['id']
  label: string
  draft: ProfileComponent
  saved: ProfileComponent
  /** Draft − saved, when both are computed. */
  delta?: number
  deltaText: string
  /** Bar lengths 0–1: each figure against the higher of the two (class synergy: against 100). */
  draftBar?: number
  savedBar?: number
}

/** "+3", "−4.5", "same" — the figure's own precision (defense and synergy whole, the rest one decimal). */
export function deltaText(id: ProfileComponent['id'], delta: number | undefined): string {
  if (delta === undefined) return copy.DELTA_NONE
  const fmt = id === 'defense' || id === 'classSynergy' ? whole : oneDecimal
  const text = fmt(Math.abs(delta))
  if (Number(text.replace(/,/g, '')) === 0) return copy.DELTA_SAME
  return `${delta > 0 ? '+' : '−'}${text}`
}

const bar = (value: number | undefined, max: number): number | undefined => (value === undefined || max <= 0 ? undefined : Math.max(0, Math.min(1, value / max)))

export function profileRows(draft: BuildProfile, saved: BuildProfile): ProfileCompareRow[] {
  return draft.components.map((d) => {
    const s = saved.components.find((c) => c.id === d.id) as ProfileComponent
    const both = d.value !== undefined && s.value !== undefined
    const delta = both ? (d.value as number) - (s.value as number) : undefined
    const max = d.id === 'classSynergy' ? 100 : Math.max(d.value ?? 0, s.value ?? 0)
    const draftBar = bar(d.value, max)
    const savedBar = bar(s.value, max)
    return { id: d.id, label: d.label, draft: d, saved: s, ...(delta !== undefined ? { delta } : {}), deltaText: deltaText(d.id, delta), ...(draftBar !== undefined ? { draftBar } : {}), ...(savedBar !== undefined ? { savedBar } : {}) }
  })
}

/**
 * The goal fit of the two builds under `goal` (SCORING_SPEC §5.3; AMENDMENTS-016 B113b): [draft, saved],
 * led by ONE signed difference (saved − draft) worded with the two sides' names.
 */
export const goalFit = (draft: BuildProfile, saved: BuildProfile, goal: Goal): GoalComparison => compareLoadouts([draft, saved], goal, [copy.FIT_SIDE.draft, copy.FIT_SIDE.saved])

// --- the Step 3 bars (PRD P4-S3 AC2; AMENDMENTS-016 B113a) -------------------------------------------------------

export interface BarScale {
  /** 0–1 fill: the figure against the larger of itself and the reference. */
  fill: number
  /** 0–1 position of the reference tick (1 = the bar's end, unless the figure goes past it). */
  tick: number
  /** The figure goes past the reference (the bar runs to the figure, the tick sits inside; said in words). */
  past: boolean
}

/**
 * A figure against its reference (`end`): the bar runs from 0 to the larger of the two, the reference
 * marked by a tick — full only when the figure reaches the reference. Undefined when there is nothing to
 * scale against (no figure, or a reference of 0 or less).
 */
export function barScale(value: number | undefined, end: number | undefined): BarScale | undefined {
  if (value === undefined || end === undefined || end <= 0) return undefined
  const past = value > end + 1e-9
  const top = past ? value : end
  return { fill: Math.max(0, Math.min(1, value / top)), tick: Math.min(1, end / top), past }
}

// --- what each piece adds (PRD P4-S3 AC1) ----------------------------------------------------------------------

const fmtPoints = (n: number) => String(Number(n.toFixed(2)))

/** "2 defense · 5 offense points · 1 effect not scored" (PRD P4-S3 AC1). */
export function contributionParts(c: Contribution): string[] {
  const parts: string[] = []
  if (c.defense !== undefined && c.defense !== 0) parts.push(contributionCopy.defense(fmtPoints(c.defense)))
  for (const k of ['off', 'def', 'mob', 'surv'] as const) if (c.points[k] !== 0) parts.push(contributionCopy.points(fmtPoints(c.points[k]), POINTS_WORD[k]))
  if (c.otherClass > 0) parts.push(contributionCopy.otherClass(fmtPoints(c.otherClass)))
  if (c.unscored > 0) parts.push(contributionCopy.unscored(c.unscored))
  return parts.length > 0 ? parts : [contributionCopy.nothing]
}
