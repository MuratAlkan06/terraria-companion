/**
 * Words for the saved-data domains (P7-S2): their names, what each holds, one-line summaries of their
 * contents, sizes and dates, and plain-language reasons a payload couldn't be read. Shared by the
 * quarantine notice (shell bundle — keep it light) and the data page.
 */
import type { DecodeFailure, DomainData, DomainKey } from '../storage'
import type { MergeReport } from '../storage/merge'
import { RECENT_MAX } from '../storage/recent'
import { getStageInfo } from './stages'

export const DOMAIN_LABEL: Record<DomainKey, string> = {
  settings: 'Settings',
  progress: 'Boss progress',
  builds: 'Saved builds',
  plans: 'Plans',
  readiness: 'Readiness setup',
  checklists: 'Checklists',
  favorites: 'Favorites',
  recent: 'Recently viewed',
}

export const DOMAIN_DESCRIPTION: Record<DomainKey, string> = {
  settings: 'Your game stage',
  progress: 'Bosses marked defeated or skipped, and your world evil',
  builds: 'Loadouts saved from the builder',
  plans: 'Item plans with owned amounts and checked steps',
  readiness: 'The readiness checker’s last boss, class and loadout',
  checklists: 'Checks on boss prep and guide checklists',
  favorites: 'Starred weapons, bosses and items',
  recent: 'Pages you opened lately (the homepage rail)',
}

/** How sentences name each domain's data ("your saved builds have…", "your boss progress has…"). */
export const DOMAIN_NOUN: Record<DomainKey, { text: string; many: boolean }> = {
  settings: { text: 'settings', many: true },
  progress: { text: 'boss progress', many: false },
  builds: { text: 'saved builds', many: true },
  plans: { text: 'plans', many: true },
  readiness: { text: 'readiness setup', many: false },
  checklists: { text: 'checklist checks', many: true },
  favorites: { text: 'favorites', many: true },
  recent: { text: 'recently viewed list', many: false },
}

/** `domain`'s noun with a verb agreeing with it: nounWith('progress', 'has', 'have') → "boss progress has". */
export const nounWith = (domain: DomainKey, one: string, many: string): string => `${DOMAIN_NOUN[domain].text} ${DOMAIN_NOUN[domain].many ? many : one}`

export const plural =(n: number, one: string, many = `${one}s`): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

const WORLD_EVIL_LABEL = { corruption: 'Corruption', crimson: 'Crimson' } as const

/** What a domain's data holds, in one short line ("3 builds", "Stage: Early Hardmode"). */
export function summarize(domain: DomainKey, data: DomainData<DomainKey>): string {
  switch (domain) {
    case 'settings': {
      const { selectedStage } = data as DomainData<'settings'>
      return selectedStage ? `Stage: ${getStageInfo(selectedStage).label}` : 'No stage picked'
    }
    case 'progress': {
      const { worldEvil, nodeStates } = data as DomainData<'progress'>
      const marked = Object.keys(nodeStates).length
      const world = worldEvil ? `${WORLD_EVIL_LABEL[worldEvil]} world` : null
      if (marked === 0) return world ? `${world}, no bosses marked` : 'No bosses marked'
      return [plural(marked, 'boss', 'bosses') + ' marked', world].filter(Boolean).join(' · ')
    }
    case 'builds':
      return plural((data as DomainData<'builds'>).builds.length, 'build')
    case 'plans': {
      const { plans } = data as DomainData<'plans'>
      const done = plans.filter((p) => p.status === 'done').length
      return done > 0 ? `${plural(plans.length, 'plan')} (${done.toLocaleString('en-US')} done)` : plural(plans.length, 'plan')
    }
    case 'readiness': {
      const { bossId, loadout, analyzedAt } = data as DomainData<'readiness'>
      const items = [loadout.mainWeapon, loadout.altWeapon, loadout.helmet, loadout.chest, loadout.legs, loadout.summon, ...loadout.accessories].filter((x) => x !== null).length + loadout.ammo.length + loadout.buffs.length
      if (!bossId && items === 0) return 'Default setup'
      return [bossId ? 'A boss chosen' : 'No boss chosen', plural(items, 'item'), analyzedAt ? 'analyzed' : null].filter(Boolean).join(' · ')
    }
    case 'checklists': {
      const { byKey } = data as DomainData<'checklists'>
      const lists = Object.keys(byKey).length
      const checks = Object.values(byKey).reduce((n, ids) => n + new Set(ids).size, 0)
      return lists === 0 ? 'No checks' : `${plural(checks, 'check')} on ${plural(lists, 'checklist')}`
    }
    case 'favorites':
      return plural(new Set((data as DomainData<'favorites'>).refs).size, 'favorite')
    case 'recent':
      return plural((data as DomainData<'recent'>).entries.length, 'page')
  }
  return ''
}

/** What a merge counts in each mergeable domain (singular, plural). */
const UNIT: Partial<Record<DomainKey, readonly [string, string]>> = {
  progress: ['boss mark', 'boss marks'],
  builds: ['build', 'builds'],
  plans: ['plan', 'plans'],
  checklists: ['check', 'checks'],
  favorites: ['favorite', 'favorites'],
  recent: ['page', 'pages'],
}

/**
 * A merge's effect in words: "2 builds added · 1 already here · 1 kept as this browser’s version".
 * Every non-zero count is said (nothing a merge skipped goes unmentioned).
 */
export function mergeSummary(domain: DomainKey, report: MergeReport): string {
  const [one, many] = UNIT[domain] ?? ['item', 'items']
  const parts = [`${plural(report.added, one, many)} added`]
  if (report.same > 0) parts.push(`${report.same.toLocaleString('en-US')} already here`)
  if (report.kept > 0) parts.push(`${report.kept.toLocaleString('en-US')} different here, this browser’s kept`)
  if (report.dropped > 0) parts.push(`${plural(report.dropped, 'older page')} left out (the list keeps ${RECENT_MAX})`)
  if (report.worldEvil === 'added') parts.push('world evil added')
  if (report.worldEvil === 'kept') parts.push('world evil differs, this browser’s kept')
  return parts.join(' · ')
}

/** "512 bytes", "1.2 KB", "1.3 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return plural(bytes, 'byte')
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** A stored ISO date-time, in the reader's locale ("Oct 15, 2026, 4:37 AM"). */
export const formatWhen = (iso: string): string => new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })

/** Why a payload couldn't be read, in plain words (the technical message is shown beside it). */
export function plainFailure(failure: DecodeFailure): string {
  switch (failure.kind) {
    case 'json':
      return 'The saved text is damaged: it isn’t valid JSON.'
    case 'envelope':
      return 'It isn’t in the format this site saves data in.'
    case 'future-version':
      return `It was saved by a newer version of this site (format ${failure.version}; this version reads up to format ${failure.supported}).`
    case 'invalid':
      return 'Some of its values don’t match what this version of the site accepts.'
  }
}
