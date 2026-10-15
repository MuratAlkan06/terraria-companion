/**
 * P7-S2 merge rules (src/storage/merge.ts): one rule — merging keeps everything here and adds what's
 * missing; where both hold the same thing, this browser's version is kept and COUNTED (never silent).
 */
import { describe, expect, it } from 'vitest'
import { DOMAIN_KEYS, type DomainKey } from './index'
import { canMerge, isEmptyData, mergeDomain, SINGLE_RECORD_DOMAINS, unitCount } from './merge'
import { RECENT_MAX } from './recent'
import { AT, DATA, LATER } from './testing/storageFixtures'

describe('merge rules', () => {
  it('settings and the readiness setup are single records: replace or keep, never merged', () => {
    expect(SINGLE_RECORD_DOMAINS).toEqual(['settings', 'readiness'])
    for (const d of DOMAIN_KEYS) expect(canMerge(d)).toBe(d !== 'settings' && d !== 'readiness')
    expect(() => mergeDomain('settings', DATA.settings, DATA.settings)).toThrow(/never merge/)
  })

  it('builds / plans: added by id; identical → same; different → this browser’s kept (counted)', () => {
    const mine = DATA.builds.builds[0]
    const other = { ...mine, buildId: 'bfixture02', name: 'Other' }
    const changed = { ...mine, name: 'Renamed elsewhere' }
    const { data, report } = mergeDomain('builds', { builds: [mine] }, { builds: [changed, other, mine] })
    expect(data.builds.map((b) => b.buildId)).toEqual(['bfixture01', 'bfixture02'])
    expect(data.builds[0].name).toBe('Melee test')
    expect(report).toEqual({ added: 1, same: 1, kept: 1, dropped: 0 })
    const plans = mergeDomain('plans', DATA.plans, DATA.plans)
    expect(plans.report).toEqual({ added: 0, same: 1, kept: 0, dropped: 0 })
  })

  it('progress: marks added, conflicting marks keep this browser’s, world evil kept unless unset here', () => {
    const { data, report } = mergeDomain('progress', { worldEvil: null, nodeStates: { skeletron: 'defeated' } }, DATA.progress)
    expect(data).toEqual({ worldEvil: 'crimson', nodeStates: { skeletron: 'defeated', 'eye-of-cthulhu': 'defeated' } })
    expect(report).toEqual({ added: 1, same: 0, kept: 1, dropped: 0, worldEvil: 'added' })
    expect(mergeDomain('progress', { worldEvil: 'corruption', nodeStates: {} }, DATA.progress).data.worldEvil).toBe('corruption')
    expect(mergeDomain('progress', { worldEvil: 'corruption', nodeStates: {} }, DATA.progress).report.worldEvil).toBe('kept')
  })

  it('favorites append missing refs in order; checklists are unions of checks', () => {
    expect(mergeDomain('favorites', { refs: ['boss:plantera'] }, DATA.favorites)).toEqual({ data: { refs: ['boss:plantera', 'i:4956'] }, report: { added: 1, same: 1, kept: 0, dropped: 0 } })
    const lists = mergeDomain('checklists', { byKey: { 'guide:new-world': ['b', 'c'] } }, DATA.checklists)
    expect(lists.data.byKey).toEqual({ 'guide:new-world': ['b', 'c', 'a'], 'boss:king-slime:prep': ['p-00000001'] })
    expect(lists.report).toEqual({ added: 2, same: 1, kept: 0, dropped: 0 })
  })

  it('recently viewed: the later visit of a page wins, newest first, capped — cut pages are counted', () => {
    const merged = mergeDomain('recent', { entries: [{ ref: 'i:4956', viewedAt: LATER }] }, DATA.recent)
    expect(merged.data.entries).toEqual([{ ref: 'i:4956', viewedAt: LATER }])
    expect(merged.report).toMatchObject({ added: 0, same: 1, dropped: 0 })
    const many = (prefix: number, at: string) => Array.from({ length: RECENT_MAX }, (_, i) => ({ ref: `i:${prefix + i}`, viewedAt: at }))
    const capped = mergeDomain('recent', { entries: many(100, LATER) }, { entries: many(200, AT) })
    expect(capped.data.entries).toHaveLength(RECENT_MAX)
    expect(capped.data.entries.every((e) => e.viewedAt === LATER)).toBe(true)
    expect(capped.report).toMatchObject({ added: RECENT_MAX, dropped: RECENT_MAX })
  })

  it('unit counts and emptiness per domain', () => {
    const counts = Object.fromEntries(DOMAIN_KEYS.map((d) => [d, unitCount(d as DomainKey, DATA[d] as never)]))
    expect(counts).toEqual({ settings: 1, progress: 2, builds: 1, plans: 1, readiness: 1, checklists: 3, favorites: 2, recent: 1 })
    expect(isEmptyData('settings', { selectedStage: null, spriteFallback: false, labIgnoreManaDefault: false })).toBe(true)
    expect(isEmptyData('progress', { worldEvil: 'crimson', nodeStates: {} })).toBe(false)
    expect(isEmptyData('builds', { builds: [] })).toBe(true)
  })
})
