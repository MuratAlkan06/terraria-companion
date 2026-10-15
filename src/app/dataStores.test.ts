/**
 * P7-S2 live refresh + quarantine store: every store re-reads its domain when an import / restore / clear
 * changes it underneath (and only for its own backend); the app-wide quarantine store lists copies and
 * follows set-aside / discard / restore; the shared QuarantineNotice renders its message and actions.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { QuarantineNotice, QUARANTINE_MESSAGE } from '../components/QuarantineNotice'
import { restoreMessage } from '../components/quarantineCopy'
import { auditCopy } from '../scoring/copyAudit'
import { DOMAIN_KEYS, loadDomain, saveDomain, storageKey } from '../storage'
import { emitStorage } from '../storage/events'
import { setAside } from '../storage/quarantine'
import { AT, DATA, envelopeText, memoryBackend } from '../storage/testing/storageFixtures'
import { applyBackup, clearDomain, createBackup, readBackup } from '../storage/transfer'
import { createChecklistStore } from './routes/guides/checklistStore'
import { createPrepChecklistStore } from './routes/bosses/prepChecklistStore'
import { createPlansStore } from './routes/plan/plansStore'
import { createBuildsStore } from './buildsStore'
import { DOMAIN_LABEL, DOMAIN_NOUN, mergeSummary, nounWith, plainFailure, summarize } from './dataDomains'
import { createFavoritesStore } from './favoritesStore'
import { createProgressStore } from './progressStore'
import { createQuarantineStore } from './quarantineStore'
import { createReadinessStore } from './readinessStore'
import { useSettingsStore } from './settingsStore'

const NOW = new Date('2026-10-15T12:00:00.000Z')
const META = { now: NOW, app: 'Terraria Companion', appVersion: '0.1.0', gameVersion: '1.4.5.8' }

function importAll(into: ReturnType<typeof memoryBackend>) {
  const source = memoryBackend()
  for (const d of DOMAIN_KEYS) saveDomain(d, DATA[d] as never, source, new Date(AT))
  const read = readBackup(createBackup(DOMAIN_KEYS, META, source).json)
  if (!read.ok) throw new Error('backup unreadable')
  return applyBackup(read.backup, {}, into, NOW)
}

describe('stores refresh live when their domain changes outside them', () => {
  it('builds, plans, favorites, progress, readiness and both checklist stores pick up an import at once', () => {
    const b = memoryBackend()
    const stores = {
      builds: createBuildsStore(b),
      plans: createPlansStore(b),
      favorites: createFavoritesStore(b),
      progress: createProgressStore(b),
      readiness: createReadinessStore(b),
      guides: createChecklistStore(b),
      prep: createPrepChecklistStore(b),
    }
    expect(stores.builds.getState().builds).toEqual([])
    importAll(b)
    expect(stores.builds.getState().builds).toEqual(DATA.builds.builds)
    expect(stores.plans.getState().plans).toEqual(DATA.plans.plans)
    expect(stores.favorites.getState().refs).toEqual(DATA.favorites.refs)
    expect(stores.progress.getState().progress).toEqual(DATA.progress)
    // imported marks count as already shown on the map (no cascade replay)
    expect(stores.progress.getState().shownNodeStates).toBe(stores.progress.getState().progress.nodeStates)
    expect(stores.readiness.getState().setup).toMatchObject({ bossId: 'plantera', stage: 'mid-hm' })
    expect(stores.guides.getState().byKey).toEqual(DATA.checklists.byKey)
    expect(stores.prep.getState().byKey).toEqual(DATA.checklists.byKey)
    for (const s of Object.values(stores)) expect((s.getState() as { loadStatus: string }).loadStatus).toBe('loaded')
  })

  it('a clear empties the store; a failed save’s flag resets because storage is the truth again', () => {
    const b = memoryBackend({ [storageKey('builds')]: envelopeText(DATA.builds, 2) })
    const store = createBuildsStore(b)
    b.failWrites(true)
    store.getState().remove('bfixture01')
    expect(store.getState()).toMatchObject({ builds: [], persistError: true })
    b.failWrites(false)
    expect(clearDomain('builds', b)).toBe(true)
    expect(store.getState()).toMatchObject({ builds: [], persistError: false, loadStatus: 'empty' })
  })

  it('only the store’s own backend and domains count', () => {
    const mine = memoryBackend({ [storageKey('favorites')]: envelopeText(DATA.favorites) })
    const other = memoryBackend()
    const store = createFavoritesStore(mine)
    mine.removeItem(storageKey('favorites'))
    emitStorage({ type: 'changed', domains: ['favorites'] }, other)
    emitStorage({ type: 'changed', domains: ['builds'] }, mine)
    expect(store.getState().refs).toEqual(DATA.favorites.refs)
    emitStorage({ type: 'changed', domains: ['favorites'] }, mine)
    expect(store.getState().refs).toEqual([])
  })

  it('the settings store (default backend) re-reads too: an unsaved in-memory stage gives way to what is stored', () => {
    useSettingsStore.getState().setStage('endgame')
    expect(useSettingsStore.getState().settings.selectedStage).toBe('endgame')
    emitStorage({ type: 'changed', domains: ['settings'] }, undefined)
    // no localStorage under test: stored = nothing → defaults
    expect(useSettingsStore.getState()).toMatchObject({ settings: { selectedStage: null }, persistError: false })
  })
})

describe('quarantine store (app-wide)', () => {
  it('lists copies at start and follows set-aside, restore and discard', () => {
    const copy = `tc.quarantine.builds.${AT}`
    const b = memoryBackend({ [copy]: envelopeText(DATA.builds, 2) })
    const q = createQuarantineStore(b)
    const builds = createBuildsStore(b)
    expect(q.getState()).toMatchObject({ listable: true, records: [{ key: copy, domain: 'builds' }] })

    const k2 = setAside('plans', '{"v":1', b, NOW)
    expect(q.getState().records.map((r) => r.key)).toEqual([copy, k2])

    expect(q.getState().restore(copy, null)).toEqual({ ok: true, domain: 'builds', how: 'restored', changed: true, keptCopy: false })
    expect(builds.getState().builds).toEqual(DATA.builds.builds)
    expect(q.getState().records.map((r) => r.key)).toEqual([k2])

    expect(q.getState().discard(k2)).toBe(true)
    expect(q.getState().records).toEqual([])
    expect(b.dump()).toEqual({ [storageKey('builds')]: expect.any(String) })
  })

  it('a store’s load that sets data aside appears in the list immediately', () => {
    const b = memoryBackend({ [storageKey('favorites')]: '{"v":1,' })
    const q = createQuarantineStore(b)
    expect(q.getState().records).toEqual([])
    const store = createFavoritesStore(b)
    expect(store.getState().loadStatus).toBe('quarantined')
    expect(q.getState().records.map((r) => r.domain)).toEqual(['favorites'])
  })

  it('unlisted storage (server render, tests) reports listable: false; outcomes carry ids and clear', () => {
    const q = createQuarantineStore(null)
    expect(q.getState()).toMatchObject({ listable: false, records: [] })
    q.getState().setOutcome({ domains: ['builds'], tone: 'done', message: 'x', source: 's' })
    q.getState().setOutcome({ domains: ['builds'], tone: 'done', message: 'y', source: 's' })
    expect(q.getState().outcome).toMatchObject({ id: 2, message: 'y' })
    q.getState().clearOutcome()
    expect(q.getState().outcome).toBeNull()
  })
})

describe('QuarantineNotice (shared; UX_SPEC §5.6)', () => {
  it('renders the surface’s message as a polite status where storage can’t be listed and the store says so; nothing otherwise', () => {
    const html = renderToStaticMarkup(createElement(QuarantineNotice, { domains: ['builds'], active: true, message: 'Some saved builds couldn’t be read.' }))
    expect(html).toMatch(/<p role="status"[^>]*>(<svg[\s\S]*?<\/svg>)?Some saved builds couldn’t be read\./)
    expect(html).toContain('data-quarantine=""')
    expect(renderToStaticMarkup(createElement(QuarantineNotice, { domains: ['builds'] }))).toBe('')
    expect(QUARANTINE_MESSAGE).toBe('Some saved data couldn’t be read and was set aside (not deleted).')
  })

  it('restore outcomes in words, for every result kind', () => {
    expect(restoreMessage({ ok: true, domain: 'builds', how: 'restored', changed: true, keptCopy: false }, 'builds').message).toBe('Restored your saved builds from the set-aside copy.')
    expect(restoreMessage({ ok: true, domain: 'progress', how: 'replaced', changed: true, keptCopy: false }, 'progress').message).toBe('Replaced your boss progress with the set-aside copy.')
    // B125(a): a copy that stays set aside leads the summary
    const merged = restoreMessage({ ok: true, domain: 'builds', how: 'merged', report: { added: 2, same: 1, kept: 1, dropped: 0 }, changed: true, keptCopy: true }, 'builds')
    expect(merged).toEqual({ tone: 'done', message: 'The copy stays set aside — some of it differs from what’s here, so nothing in it is lost. Merged the set-aside copy into your saved builds: 2 builds added · 1 already here · 1 different here, this browser’s kept.' })
    expect(restoreMessage({ ok: false, reason: 'unreadable', failure: { kind: 'json', message: 'x' } }, 'settings')).toEqual({ tone: 'warn', message: 'It still can’t be read. The saved text is damaged: it isn’t valid JSON. It stays set aside.' })
    expect(restoreMessage({ ok: false, reason: 'save-failed', message: 'x' }, 'plans').tone).toBe('warn')
    expect(restoreMessage({ ok: false, reason: 'gone' }, 'plans').message).toMatch(/isn’t here any more/)
  })
})

describe('domain words', () => {
  it('labels, nouns with agreeing verbs, summaries, failure reasons — all pass the copy audit', () => {
    expect(nounWith('progress', 'has', 'have')).toBe('boss progress has')
    expect(nounWith('builds', 'has', 'have')).toBe('saved builds have')
    const summaries = DOMAIN_KEYS.map((d) => summarize(d, DATA[d] as never))
    expect(summaries).toEqual(['Stage: Early Hardmode', '2 bosses marked · Crimson world', '1 build', '1 plan', 'A boss chosen · 1 item', '3 checks on 2 checklists', '2 favorites', '1 page'])
    expect(summarize('progress', { worldEvil: null, nodeStates: {} })).toBe('No bosses marked')
    expect(summarize('readiness', { ...DATA.readiness, bossId: null, loadout: { ...DATA.readiness.loadout, mainWeapon: null } })).toBe('Default setup')
    expect(mergeSummary('recent', { added: 1, same: 0, kept: 0, dropped: 3 })).toBe('1 page added · 3 older pages left out (the list keeps 20)')
    const texts = [
      ...summaries,
      ...Object.values(DOMAIN_LABEL),
      ...Object.values(DOMAIN_NOUN).map((n) => n.text),
      ...(['json', 'envelope', 'invalid'] as const).map((kind) => plainFailure({ kind, message: '', version: 1 } as never)),
      plainFailure({ kind: 'future-version', message: '', version: 3, supported: 2 }),
      mergeSummary('progress', { added: 1, same: 2, kept: 3, dropped: 0, worldEvil: 'kept' }),
    ]
    for (const t of texts) expect(auditCopy(t), t).toBeUndefined()
  })

  it('loadDomain behavior is unchanged by the shared decoder (older versions migrate, the rest quarantine)', () => {
    const b = memoryBackend({ [storageKey('builds')]: envelopeText(DATA.builds, 1) })
    expect(loadDomain('builds', b)).toEqual({ kind: 'loaded', data: DATA.builds, migratedFrom: 1 })
  })
})
