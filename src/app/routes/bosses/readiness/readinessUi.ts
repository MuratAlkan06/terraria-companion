/**
 * Readiness page model (PRD P5-S6/S7; UX_SPEC §3.8): pure helpers between the store, the engine and
 * the view — which items fit which slot (the picker's filter over the shared search index), each
 * slot's pool for an empty query, staleness of a shown analysis, and the engine input. No React.
 */
import type { SearchDocType } from '../../../../schemas'
import { DEMON_HEART_SLOT_INDEX, SLOT_COUNT } from '../../../../scoring/constants'
import { trackedDefeats, type ProgressionGraphLike, type TrackedProgress } from '../../../../scoring/progress'
import { isSummonStaff } from '../../../../scoring/proxies'
import type { ReadinessData, ReadinessInput } from '../../../../scoring/readiness'
import type { ReadinessSetup } from '../../../../storage/readiness'
import { sameInputs, sameProgress, type ListSlot, type ReadinessSnapshot, type SingleSlot } from '../../../readinessStore'
import { armorSetHref } from '../../db/armor/armorNav'
import type { ReadinessPageData } from './readinessData'
import type { SegmentContext } from './ReadinessFactorCard'
import { accessoryLabel, ANNOUNCE_READY, DEMON_HEART_SLOT, PICKER_WHAT, SLOT_LABELS } from './readinessUiCopy'

/** How the views resolve a line's segments: item pages, condition articles, set pages, node names, AssumptionsTips. */
export function segmentContext(page: ReadinessPageData, estimates: SegmentContext['estimates']): SegmentContext {
  return {
    info: page.info,
    conditions: page.conditions,
    estimates,
    // PRD P6-S1 (AMENDMENTS-016 B131(b)): a set links its page in-app — never a dead link for a set the data lacks
    setHref: (id) => (page.engine.sets.has(id) ? armorSetHref(id) : undefined),
    bossName: (id) => page.graph.nodeById.get(id)?.name ?? id,
  }
}

/** A slot the picker fills. */
export type PickerTarget = { kind: SingleSlot } | { kind: 'accessory'; index: number } | { kind: ListSlot }

export const targetKey = (t: PickerTarget): string => (t.kind === 'accessory' ? `accessory-${t.index}` : t.kind)

export function targetLabel(t: PickerTarget, difficulty: ReadinessSetup['difficulty']): string {
  if (t.kind === 'accessory') return t.index === DEMON_HEART_SLOT_INDEX[difficulty] ? DEMON_HEART_SLOT : accessoryLabel(t.index + 1)
  if (t.kind === 'ammo') return 'Ammo'
  if (t.kind === 'buffs') return 'Potion'
  return SLOT_LABELS[t.kind]
}

type PoolKind = keyof typeof PICKER_WHAT

export function poolKind(t: PickerTarget): PoolKind {
  switch (t.kind) {
    case 'mainWeapon':
    case 'altWeapon':
      return 'weapon'
    case 'summon':
      return 'summon'
    case 'helmet':
      return 'head'
    case 'chest':
      return 'chest'
    case 'legs':
      return 'legs'
    case 'accessory':
      return 'accessory'
    case 'ammo':
      return 'ammo'
    case 'buffs':
      return 'potion'
  }
}

/** The search index's entity types to ask for (SearchDoc.type), filtered further by `fits`. */
export function searchTypes(t: PickerTarget): ReadonlySet<SearchDocType> {
  switch (poolKind(t)) {
    case 'weapon':
    case 'summon':
      return new Set<SearchDocType>(['weapon'])
    case 'head':
    case 'chest':
    case 'legs':
      return new Set<SearchDocType>(['armor'])
    case 'accessory':
      return new Set<SearchDocType>(['accessory'])
    case 'ammo':
      return new Set<SearchDocType>(['item', 'weapon']) // dual-role ammo (Snowball) is a weapon record
    case 'potion':
      return new Set<SearchDocType>(['item'])
  }
}

/** Does item `id` fit slot `t` (and isn't already in it)? */
export function fits(t: PickerTarget, id: number, data: ReadinessData, setup: ReadinessSetup): boolean {
  const { loadout } = setup
  switch (poolKind(t)) {
    case 'weapon':
      return data.weapons.has(id)
    case 'summon': {
      const w = data.weapons.get(id)
      return w !== undefined && isSummonStaff(w)
    }
    case 'head':
      return data.armor.get(id)?.slot === 'head'
    case 'chest':
      return data.armor.get(id)?.slot === 'chest'
    case 'legs':
      return data.armor.get(id)?.slot === 'legs'
    case 'accessory': {
      if (!data.accessories.has(id)) return false
      const slots = SLOT_COUNT[setup.difficulty]
      const self = t.kind === 'accessory' ? t.index : -1
      return !loadout.accessories.slice(0, slots).some((x, i) => x === id && i !== self)
    }
    case 'ammo':
      return (data.items.get(id)?.ammoStats ?? data.weapons.get(id)?.ammoStats) !== undefined && !loadout.ammo.includes(id)
    case 'potion':
      return data.items.get(id)?.category === 'potion' && !loadout.buffs.includes(id)
  }
}

/** Every item that fits the slot (sorted by name): the empty-query list for small pools, and the count. */
export function slotPool(t: PickerTarget, data: ReadinessData, setup: ReadinessSetup): number[] {
  const ids = [...data.weapons.keys(), ...data.armor.keys(), ...data.accessories.keys(), ...data.items.keys()]
  const nameOf = (id: number) => data.weapons.get(id)?.name ?? data.armor.get(id)?.name ?? data.accessories.get(id)?.name ?? data.items.get(id)?.name ?? ''
  return [...new Set(ids)].filter((id) => fits(t, id, data, setup)).sort((a, b) => nameOf(a).localeCompare(nameOf(b)) || a - b)
}

/** Pools at most this big list every item before typing; bigger ones ask for a search. */
export const LIST_ALL_MAX = 100

/** Parses a SearchDoc ref ("i:1327") to an item id. */
export const refItemId = (ref: string): number | undefined => (/^i:\d+$/.test(ref) ? Number(ref.slice(2)) : undefined)

/** Recently viewed items (tc.v1.recent refs, newest first) that fit the slot: a big pool's starter list before typing (B96d). */
export function recentFits(refs: readonly string[], t: PickerTarget, data: ReadinessData, setup: ReadinessSetup, max = 8): number[] {
  const out: number[] = []
  for (const ref of refs) {
    const id = refItemId(ref)
    if (id === undefined || out.includes(id) || !fits(t, id, data, setup)) continue
    out.push(id)
    if (out.length >= max) break
  }
  return out
}

/**
 * The bosses marked defeated on the map, as marked (AMENDMENTS-015 B96a: the setup pane counts and
 * names ACTUAL marks), and those of them a chosen world evil leaves out (the other world's evil boss —
 * said in its own sentence, never silently dropped). Under "Both" every mark counts.
 */
export function markedDefeats(graph: ProgressionGraphLike, progress: TrackedProgress): { marked: string[]; offWorld: string[] } {
  const kind = new Map(graph.nodes.map((n) => [n.id, n.kind]))
  const marked = Object.entries(progress.nodeStates)
    .filter(([id, state]) => state === 'defeated' && kind.get(id) === 'boss')
    .map(([id]) => id)
  const counted = trackedDefeats(graph, progress)
  return { marked, offWorld: marked.filter((id) => !counted.has(id)) }
}

/** Why the shown analysis is out of date (UX_SPEC §6), or null when it matches the inputs. */
export function staleReason(snapshot: ReadinessSnapshot | null, setup: ReadinessSetup, progress: TrackedProgress): 'setup' | 'progress' | null {
  if (!snapshot) return null
  if (!sameInputs(snapshot.setup, setup)) return 'setup'
  if (snapshot.progress && !sameProgress(snapshot.progress, progress)) return 'progress'
  return null
}

/**
 * The page's polite region text (AMENDMENTS-015 B98): "Analysis ready." is withdrawn once the analysis it
 * announced is out of date or cleared, so the region never keeps a claim that's no longer true for anyone
 * reading it later. Emptying the region isn't announced; other messages (an import) stay as said.
 */
export function liveAnnouncement(announcement: string, analysisCurrent: boolean): string {
  return announcement === ANNOUNCE_READY && !analysisCurrent ? '' : announcement
}

export function engineInput(setup: ReadinessSetup, progress: TrackedProgress, prepDone?: number): ReadinessInput {
  return { bossId: setup.bossId, difficulty: setup.difficulty, cls: setup.class, loadout: setup.loadout, progress, ...(prepDone !== undefined ? { prepDone } : {}) }
}

/** Anything in the loadout's active slots. */
export function hasAnyItem(setup: ReadinessSetup): boolean {
  const l = setup.loadout
  return [l.mainWeapon, l.altWeapon, l.helmet, l.chest, l.legs, l.summon, ...l.accessories.slice(0, SLOT_COUNT[setup.difficulty])].some((x) => x !== null) || l.ammo.length > 0 || l.buffs.length > 0
}
