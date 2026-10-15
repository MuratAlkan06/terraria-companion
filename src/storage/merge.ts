/**
 * Merging a domain's stored data with incoming data (P7-S2: importing a backup, restoring a set-aside
 * copy). One rule for every domain: MERGE keeps everything this browser has and adds what it lacks;
 * where both hold the same thing (a build or plan id, a boss's mark, a favorite, a checklist entry) THIS
 * browser's version is kept — counted, so the caller can say so. The two single-record domains (settings,
 * the readiness setup) have nothing to add: they are replaced or kept, never merged.
 *
 * Exceptions, each by the domain's own meaning: recently viewed keeps the later visit of a page and the
 * newest RECENT_MAX entries (older ones beyond the cap are counted as dropped); checklists are unions of
 * checks (two checks of one entry are the same check).
 *
 * Pure and dependency-free (the shell bundle carries it for the quarantine notice's restore).
 */
import type { SavedBuild } from './builds'
import type { DomainData, DomainKey } from './index'
import type { SavedPlan } from './plans'
import type { NodeState } from './progress'
import { RECENT_MAX } from './recent'

export type MergeMode = 'merge' | 'replace'

/**
 * Units of incoming data (builds, plans, boss marks, favorites, checks, recent pages) by what merging
 * did with them: `added` (this browser lacked it), `same` (already here, identical), `kept` (already here
 * but different — this browser's version was kept, the incoming one not applied), `dropped` (recently
 * viewed only: beyond the list's cap).
 */
export interface MergeReport {
  added: number
  same: number
  kept: number
  dropped: number
  /** Progress only: what happened to the incoming world-evil choice. */
  worldEvil?: 'added' | 'same' | 'kept'
}

export interface Merged<T> {
  data: T
  report: MergeReport
}

/** Domains holding one record (no units to add): replaced or kept, never merged. */
export const SINGLE_RECORD_DOMAINS: readonly DomainKey[] = ['settings', 'readiness']

export const canMerge = (domain: DomainKey): boolean => !SINGLE_RECORD_DOMAINS.includes(domain)

const report = (): MergeReport => ({ added: 0, same: 0, kept: 0, dropped: 0 })
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** How many units `data` holds (0 for an empty domain; single-record domains count 1 when set). */
export function unitCount<K extends DomainKey>(domain: K, data: DomainData<K>): number {
  const d = data as DomainData<DomainKey>
  switch (domain) {
    case 'settings': {
      const s = d as DomainData<'settings'>
      return s.selectedStage !== null || s.spriteFallback || s.labIgnoreManaDefault ? 1 : 0
    }
    case 'readiness': {
      const r = d as DomainData<'readiness'>
      const l = r.loadout
      const items = [l.mainWeapon, l.altWeapon, l.helmet, l.chest, l.legs, l.summon, ...l.accessories].filter((x) => x !== null).length + l.ammo.length + l.buffs.length
      return r.bossId !== null || items > 0 || r.analyzedAt !== null ? 1 : 0
    }
    case 'progress': {
      const p = d as DomainData<'progress'>
      return Object.keys(p.nodeStates).length
    }
    case 'builds':
      return (d as DomainData<'builds'>).builds.length
    case 'plans':
      return (d as DomainData<'plans'>).plans.length
    case 'favorites':
      return new Set((d as DomainData<'favorites'>).refs).size
    case 'recent':
      return (d as DomainData<'recent'>).entries.length
    case 'checklists':
      return Object.values((d as DomainData<'checklists'>).byKey).reduce((n, ids) => n + new Set(ids).size, 0)
  }
  return 0
}

/** True when `data` holds nothing a user saved (nothing would be lost by replacing it). */
export function isEmptyData<K extends DomainKey>(domain: K, data: DomainData<K>): boolean {
  if (domain === 'progress') {
    const p = data as DomainData<'progress'>
    return p.worldEvil === null && Object.keys(p.nodeStates).length === 0
  }
  return unitCount(domain, data) === 0
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** JSON with every object's keys sorted and no whitespace (arrays keep their order). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isPlainObject(value)) {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * Whether saving `next` changes what `domain` holds (AMENDMENTS-016 B125(a)): `before` is the data held
 * now, null when nothing (or only empty data) is saved. An identical rewrite, or an empty merge, is no change.
 */
export function contentChanged<K extends DomainKey>(domain: K, before: DomainData<K> | null, next: DomainData<K>): boolean {
  return before === null ? !isEmptyData(domain, next) : canonicalJson(before) !== canonicalJson(next)
}

function byId<T>(current: readonly T[], incoming: readonly T[], idOf: (x: T) => string): Merged<T[]> {
  const r = report()
  const here = new Map(current.map((x) => [idOf(x), x]))
  const out = [...current]
  for (const item of incoming) {
    const mine = here.get(idOf(item))
    if (mine === undefined) {
      out.push(item)
      here.set(idOf(item), item)
      r.added++
    } else if (same(mine, item)) r.same++
    else r.kept++
  }
  return { data: out, report: r }
}

function mergeProgress(current: DomainData<'progress'>, incoming: DomainData<'progress'>): Merged<DomainData<'progress'>> {
  const r = report()
  const nodeStates: Record<string, NodeState> = { ...current.nodeStates }
  for (const [node, state] of Object.entries(incoming.nodeStates)) {
    const mine = current.nodeStates[node]
    if (mine === undefined) {
      nodeStates[node] = state
      r.added++
    } else if (mine === state) r.same++
    else r.kept++
  }
  if (incoming.worldEvil !== null) r.worldEvil = current.worldEvil === null ? 'added' : current.worldEvil === incoming.worldEvil ? 'same' : 'kept'
  return { data: { worldEvil: current.worldEvil ?? incoming.worldEvil, nodeStates }, report: r }
}

function mergeRecent(current: DomainData<'recent'>, incoming: DomainData<'recent'>): Merged<DomainData<'recent'>> {
  const r = report()
  const latest = new Map(current.entries.map((e) => [e.ref, e]))
  for (const entry of incoming.entries) {
    const mine = latest.get(entry.ref)
    if (mine === undefined) r.added++
    else r.same++
    if (mine === undefined || Date.parse(entry.viewedAt) > Date.parse(mine.viewedAt)) latest.set(entry.ref, entry)
  }
  const all = [...latest.values()].sort((a, b) => Date.parse(b.viewedAt) - Date.parse(a.viewedAt))
  const kept = all.slice(0, RECENT_MAX)
  // The newest RECENT_MAX pages across both lists stay; every page the cap cuts (from either) is counted.
  r.dropped = all.length - kept.length
  return { data: { entries: kept }, report: r }
}

function mergeFavorites(current: DomainData<'favorites'>, incoming: DomainData<'favorites'>): Merged<DomainData<'favorites'>> {
  const r = report()
  const refs = [...current.refs]
  const here = new Set(current.refs)
  for (const ref of new Set(incoming.refs)) {
    if (here.has(ref)) r.same++
    else {
      refs.push(ref)
      here.add(ref)
      r.added++
    }
  }
  return { data: { refs }, report: r }
}

function mergeChecklists(current: DomainData<'checklists'>, incoming: DomainData<'checklists'>): Merged<DomainData<'checklists'>> {
  const r = report()
  const byKey: Record<string, string[]> = Object.fromEntries(Object.entries(current.byKey).map(([k, ids]) => [k, [...ids]]))
  for (const [key, ids] of Object.entries(incoming.byKey)) {
    const list = byKey[key] ?? []
    const here = new Set(list)
    for (const id of new Set(ids)) {
      if (here.has(id)) r.same++
      else {
        list.push(id)
        here.add(id)
        r.added++
      }
    }
    if (list.length > 0) byKey[key] = list
  }
  return { data: { byKey }, report: r }
}

/**
 * `incoming` merged into `current` by the rule above. Single-record domains can't merge: callers check
 * `canMerge` first (this throws for them, so a caller bug never silently replaces).
 */
export function mergeDomain<K extends DomainKey>(domain: K, current: DomainData<K>, incoming: DomainData<K>): Merged<DomainData<K>> {
  type Any = DomainData<DomainKey>
  const c = current as Any
  const i = incoming as Any
  let merged: Merged<Any>
  switch (domain) {
    case 'progress':
      merged = mergeProgress(c as DomainData<'progress'>, i as DomainData<'progress'>)
      break
    case 'recent':
      merged = mergeRecent(c as DomainData<'recent'>, i as DomainData<'recent'>)
      break
    case 'favorites':
      merged = mergeFavorites(c as DomainData<'favorites'>, i as DomainData<'favorites'>)
      break
    case 'checklists':
      merged = mergeChecklists(c as DomainData<'checklists'>, i as DomainData<'checklists'>)
      break
    case 'builds': {
      const m = byId<SavedBuild>((c as DomainData<'builds'>).builds, (i as DomainData<'builds'>).builds, (b) => b.buildId)
      merged = { data: { builds: m.data }, report: m.report }
      break
    }
    case 'plans': {
      const m = byId<SavedPlan>((c as DomainData<'plans'>).plans, (i as DomainData<'plans'>).plans, (p) => p.planId)
      merged = { data: { plans: m.data }, report: m.report }
      break
    }
    default:
      throw new TypeError(`${domain}: holds one record — replace or keep it, never merge`)
  }
  return merged as Merged<DomainData<K>>
}
