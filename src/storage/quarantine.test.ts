/**
 * P7-S2 set-aside copies (src/storage/quarantine.ts; ADR D6; UX_SPEC §5.6): listing, Try restore (success
 * restores; failure keeps the copy and says why; data saved since asks merge or replace), Discard, copies
 * storage couldn't copy aside ("stuck"), and the shared decoder's failure kinds.
 */
import { describe, expect, it } from 'vitest'
import { subscribeStorage, type StorageEvent } from './events'
import { decodeEnvelope, decodeRaw, loadDomain, quarantineKey, saveDomain, storageKey, type StorageBackend } from './index'
import { checkRestore, discardQuarantine, domainOfCopy, listQuarantine, LOCAL_ORIGIN, parseQuarantineKey, restoreQuarantine, setAside, SET_ASIDE_FORMAT, unwrapCopy, wrapCopy, type QuarantineOrigin } from './quarantine'
import { AT, DATA, envelopeText, memoryBackend } from './testing/storageFixtures'

const NOW = new Date('2026-10-15T12:00:00.000Z')
const T1 = '2026-10-15T08:00:00.000Z'
const T2 = '2026-10-15T09:00:00.000Z'

function events(backend: StorageBackend) {
  const seen: StorageEvent[] = []
  const off = subscribeStorage((e, at) => {
    if (at === backend) seen.push(e)
  })
  return { seen, off }
}

describe('the shared decoder (load, import and restore read alike)', () => {
  it.each([
    ['json', '{nope'],
    ['envelope', JSON.stringify({ v: 1, data: {} })],
    ['future-version', envelopeText(DATA.settings, 2)],
    ['invalid', envelopeText({ ...DATA.settings, selectedStage: 'hardmode' })],
  ])('%s failures are told apart', (kind, raw) => {
    const decoded = decodeRaw('settings', raw)
    expect(decoded.ok).toBe(false)
    if (!decoded.ok) expect(decoded.failure.kind).toBe(kind)
  })

  it('a readable envelope decodes with its own version, date and game version', () => {
    expect(decodeEnvelope('favorites', JSON.parse(envelopeText(DATA.favorites, 1, AT, '1.4.4.9')))).toEqual({ ok: true, data: DATA.favorites, v: 1, savedAt: AT, gameVersion: '1.4.4.9' })
  })
})

describe('listing set-aside copies', () => {
  it('lists tc.quarantine.<domain>.<ISO> copies oldest first, ignoring every other key', () => {
    const b = memoryBackend({
      [`tc.quarantine.builds.${T2}`]: 'b2',
      [`tc.quarantine.settings.${T1}`]: 's1',
      'tc.quarantine.unknowndomain.2026-10-15T08:00:00.000Z': 'x',
      'tc.quarantine.builds.not-a-date': 'x',
      [storageKey('builds')]: envelopeText(DATA.builds, 2),
    })
    expect(listQuarantine(b)).toEqual([
      { key: `tc.quarantine.settings.${T1}`, domain: 'settings', at: T1, raw: 's1', origin: LOCAL_ORIGIN, stuck: false },
      { key: `tc.quarantine.builds.${T2}`, domain: 'builds', at: T2, raw: 'b2', origin: LOCAL_ORIGIN, stuck: false },
    ])
  })

  it('null where the backend can’t list its keys (the notice then relies on the store’s load status)', () => {
    const plain: StorageBackend = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
    expect(listQuarantine(plain)).toBeNull()
    expect(listQuarantine(null)).toBeNull()
  })

  it('parses copy keys', () => {
    expect(parseQuarantineKey(quarantineKey('plans', NOW))).toEqual({ domain: 'plans', at: NOW.toISOString() })
    expect(parseQuarantineKey('tc.v1.plans')).toBeNull()
    expect(domainOfCopy('tc.v1.plans')).toBe('plans')
    expect(domainOfCopy('tc.v1.nope')).toBeNull()
  })

  it('a payload storage refused to copy aside stays listed (stuck, at its own key) while it is unreadable', () => {
    const map = new Map([[storageKey('favorites'), '{broken']])
    const b: StorageBackend = {
      getItem: (k) => map.get(k) ?? null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError')
      },
      removeItem: (k) => void map.delete(k),
      key: (i) => [...map.keys()][i] ?? null,
      get length() {
        return map.size
      },
    }
    expect(loadDomain('favorites', b, NOW)).toEqual({ kind: 'quarantined', key: storageKey('favorites') })
    expect(listQuarantine(b)).toEqual([{ key: storageKey('favorites'), domain: 'favorites', at: null, raw: '{broken', origin: LOCAL_ORIGIN, stuck: true }])
    // discarding it removes the payload in place; the domain reads as empty again
    expect(discardQuarantine(storageKey('favorites'), b)).toBe(true)
    expect(listQuarantine(b)).toEqual([])
    expect(loadDomain('favorites', b)).toEqual({ kind: 'empty' })
  })
})

describe('set aside and discard', () => {
  it('setAside never touches the domain’s own data and never overwrites an earlier copy', () => {
    const b = memoryBackend({ [storageKey('builds')]: envelopeText(DATA.builds, 2) })
    const { seen, off } = events(b)
    const k1 = setAside('builds', 'one', b, NOW)
    const k2 = setAside('builds', 'two', b, NOW)
    off()
    expect(k1).toBe(`tc.quarantine.builds.${NOW.toISOString()}`)
    expect(k2).toBe('tc.quarantine.builds.2026-10-15T12:00:00.001Z')
    expect(b.dump()[k1]).toBe('one')
    expect(loadDomain('builds', b)).toEqual({ kind: 'loaded', data: DATA.builds })
    expect(seen).toEqual([
      { type: 'quarantine', domain: 'builds' },
      { type: 'quarantine', domain: 'builds' },
    ])
  })

  it('a load that sets a payload aside announces it', () => {
    const b = memoryBackend({ [storageKey('plans')]: '{"v":1' })
    const { seen, off } = events(b)
    loadDomain('plans', b, NOW)
    off()
    expect(seen).toEqual([{ type: 'quarantine', domain: 'plans' }])
  })

  it('discard deletes the copy for good; a copy already gone reports false', () => {
    const key = `tc.quarantine.plans.${T1}`
    const b = memoryBackend({ [key]: 'x', [storageKey('plans')]: envelopeText(DATA.plans) })
    expect(discardQuarantine(key, b)).toBe(true)
    expect(b.dump()).toEqual({ [storageKey('plans')]: envelopeText(DATA.plans) })
    expect(discardQuarantine(key, b)).toBe(false)
  })
})

describe('Try restore', () => {
  const copy = `tc.quarantine.builds.${T1}`

  it('an unreadable copy stays set aside and the reason is returned (re-checked now)', () => {
    const raw = envelopeText({ builds: [{ ...DATA.builds.builds[0], stage: 'hardmode' }] }, 2)
    const b = memoryBackend({ [copy]: raw })
    expect(checkRestore(copy, b)).toMatchObject({ ok: false, reason: 'unreadable', failure: { kind: 'invalid' } })
    expect(restoreQuarantine(copy, null, b, NOW)).toMatchObject({ ok: false, reason: 'unreadable', failure: { kind: 'invalid', message: expect.stringContaining('builds.0.stage') } })
    expect(b.dump()).toEqual({ [copy]: raw })
  })

  it('a copy that reads now (e.g. after an update) is put back when nothing was saved since; the copy goes; stores are told', () => {
    const b = memoryBackend({ [copy]: envelopeText(DATA.builds, 1) })
    const { seen, off } = events(b)
    expect(checkRestore(copy, b)).toEqual({ ok: true, domain: 'builds', v: 1, currentHasData: false, mergeable: true })
    expect(restoreQuarantine(copy, null, b, NOW)).toEqual({ ok: true, domain: 'builds', how: 'restored', changed: true, keptCopy: false })
    off()
    expect(loadDomain('builds', b)).toEqual({ kind: 'loaded', data: DATA.builds })
    expect(Object.keys(b.dump())).toEqual([storageKey('builds')])
    expect(seen).toEqual([
      { type: 'changed', domains: ['builds'] },
      { type: 'quarantine', domain: 'builds' },
    ])
  })

  it('data saved since: asks for a choice, changing nothing — with both sides and what a merge would do (B125(f))', () => {
    const b = memoryBackend({ [copy]: envelopeText(DATA.builds, 2) })
    const since = { builds: [{ ...DATA.builds.builds[0], buildId: 'bsince0001' }] }
    saveDomain('builds', since, b)
    const before = b.dump()
    expect(checkRestore(copy, b)).toMatchObject({ ok: true, currentHasData: true, mergeable: true })
    expect(restoreQuarantine(copy, null, b, NOW)).toEqual({ ok: false, reason: 'needs-choice', mergeable: true, current: since, incoming: DATA.builds, merge: { added: 1, same: 0, kept: 0, dropped: 0 } })
    expect(b.dump()).toEqual(before)
  })

  it('merge adds what’s missing; a conflict keeps this browser’s version AND the copy (nothing in it lost)', () => {
    const b = memoryBackend({ [copy]: envelopeText(DATA.builds, 2) })
    saveDomain('builds', { builds: [{ ...DATA.builds.builds[0], buildId: 'bsince0001' }] }, b)
    expect(restoreQuarantine(copy, 'merge', b, NOW)).toEqual({ ok: true, domain: 'builds', how: 'merged', report: { added: 1, same: 0, kept: 0, dropped: 0 }, changed: true, keptCopy: false })
    expect(loadDomain('builds', b)).toMatchObject({ data: { builds: [{ buildId: 'bsince0001' }, { buildId: 'bfixture01' }] } })

    const c = memoryBackend({ [copy]: envelopeText(DATA.builds, 2) })
    saveDomain('builds', { builds: [{ ...DATA.builds.builds[0], name: 'Renamed since' }] }, c)
    expect(restoreQuarantine(copy, 'merge', c, NOW)).toMatchObject({ ok: true, how: 'merged', report: { kept: 1 }, changed: false, keptCopy: true })
    expect(c.dump()[copy]).toBeDefined()
    expect(loadDomain('builds', c)).toMatchObject({ data: { builds: [{ name: 'Renamed since' }] } })
  })

  it('replace puts the copy in place of what’s saved; single records can only replace', () => {
    const b = memoryBackend({ [`tc.quarantine.settings.${T1}`]: envelopeText(DATA.settings) })
    const since = { ...DATA.settings, selectedStage: 'endgame' as const }
    saveDomain('settings', since, b)
    expect(restoreQuarantine(`tc.quarantine.settings.${T1}`, 'merge', b, NOW)).toEqual({ ok: false, reason: 'needs-choice', mergeable: false, current: since, incoming: DATA.settings, merge: null })
    expect(restoreQuarantine(`tc.quarantine.settings.${T1}`, 'replace', b, NOW)).toEqual({ ok: true, domain: 'settings', how: 'replaced', changed: true, keptCopy: false })
    expect(loadDomain('settings', b)).toEqual({ kind: 'loaded', data: DATA.settings })
  })

  it('B125(a): a copy identical to what’s here (replace) or with nothing new (merge) changes nothing — no write, no change event; the copy goes', () => {
    for (const mode of ['replace', 'merge'] as const) {
      const b = memoryBackend({ [copy]: envelopeText(DATA.builds, 2) })
      saveDomain('builds', DATA.builds, b, new Date(AT))
      const stored = b.dump()[storageKey('builds')]
      const { seen, off } = events(b)
      const result = restoreQuarantine(copy, mode, b, NOW)
      off()
      expect(result).toMatchObject({ ok: true, changed: false, keptCopy: false })
      if (mode === 'merge') expect(result).toMatchObject({ how: 'merged', report: { added: 0, same: 1, kept: 0 } })
      // untouched: same text, same savedAt
      expect(b.dump()).toEqual({ [storageKey('builds')]: stored })
      expect(seen).toEqual([{ type: 'quarantine', domain: 'builds' }])
    }
  })

  it('a refused write keeps the copy and says so; a vanished copy says it is gone', () => {
    const b = memoryBackend({ [copy]: envelopeText(DATA.builds, 2) })
    b.failWrites(true)
    expect(restoreQuarantine(copy, null, b, NOW)).toMatchObject({ ok: false, reason: 'save-failed' })
    expect(b.dump()[copy]).toBeDefined()
    expect(restoreQuarantine('tc.quarantine.builds.2020-01-01T00:00:00.000Z', null, b, NOW)).toEqual({ ok: false, reason: 'gone' })
    expect(checkRestore('nonsense', b)).toEqual({ ok: false, reason: 'gone' })
  })
})

describe('origin (AMENDMENTS-016 B125(b)): a backup file’s part never reads as this browser’s damage', () => {
  const FROM_FILE: QuarantineOrigin = { kind: 'import', fileName: 'terraria-companion-backup-2026-10-14.json', exportedAt: AT }

  it('round trip: an imported part is stored with its file name and date and listed with them; its text unwrapped', () => {
    const b = memoryBackend()
    const raw = envelopeText({ builds: 'no' }, 2)
    const key = setAside('builds', raw, b, NOW, FROM_FILE)
    expect(JSON.parse(b.dump()[key])).toEqual({ format: SET_ASIDE_FORMAT, v: 1, origin: FROM_FILE, raw })
    expect(listQuarantine(b)).toEqual([{ key, domain: 'builds', at: NOW.toISOString(), raw, origin: FROM_FILE, stuck: false }])
    // a file of unknown name keeps null
    const unnamed = setAside('plans', '{x', b, NOW, { ...FROM_FILE, fileName: null })
    expect(listQuarantine(b)?.find((r) => r.key === unnamed)?.origin).toEqual({ ...FROM_FILE, fileName: null })
  })

  it('copies stored bare (every load’s, and any written before origins existed) are this browser’s; a malformed wrapper is kept as stored', () => {
    expect(unwrapCopy('{broken')).toEqual({ raw: '{broken', origin: LOCAL_ORIGIN })
    const envelope = envelopeText(DATA.builds, 2)
    expect(unwrapCopy(envelope)).toEqual({ raw: envelope, origin: LOCAL_ORIGIN })
    expect(wrapCopy(envelope, LOCAL_ORIGIN)).toBe(envelope)
    for (const bad of [
      { format: SET_ASIDE_FORMAT, v: 2, origin: FROM_FILE, raw: 'x' },
      { format: SET_ASIDE_FORMAT, v: 1, origin: { ...FROM_FILE, kind: 'local' }, raw: 'x' },
      { format: SET_ASIDE_FORMAT, v: 1, origin: FROM_FILE, raw: 'x', extra: 1 },
      { format: SET_ASIDE_FORMAT, v: 1, origin: { ...FROM_FILE, exportedAt: 'later' }, raw: 'x' },
    ]) {
      const stored = JSON.stringify(bad)
      expect(unwrapCopy(stored)).toEqual({ raw: stored, origin: LOCAL_ORIGIN })
    }
    expect(unwrapCopy(wrapCopy('t', FROM_FILE))).toEqual({ raw: 't', origin: FROM_FILE })
  })

  it('an imported copy restores, is discarded and re-checked by its own text (the wrapper is never decoded as data)', () => {
    const b = memoryBackend()
    const key = setAside('builds', envelopeText(DATA.builds, 2), b, NOW, FROM_FILE)
    expect(checkRestore(key, b)).toMatchObject({ ok: true, domain: 'builds', v: 2 })
    expect(restoreQuarantine(key, null, b, NOW)).toEqual({ ok: true, domain: 'builds', how: 'restored', changed: true, keptCopy: false })
    expect(loadDomain('builds', b)).toEqual({ kind: 'loaded', data: DATA.builds })
    const other = setAside('plans', '{"v":1', b, NOW, FROM_FILE)
    expect(restoreQuarantine(other, null, b, NOW)).toMatchObject({ ok: false, reason: 'unreadable', failure: { kind: 'json' } })
    expect(discardQuarantine(other, b)).toBe(true)
    expect(listQuarantine(b)).toEqual([])
  })
})
