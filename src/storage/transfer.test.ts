/**
 * P7-S2 backups (src/storage/transfer.ts): export → import round trip for every domain, merge vs replace
 * vs skip, unreadable parts set aside (never dropped, never applied), version handling (older parts
 * migrated; a part from a newer app version set aside; a newer BACKUP format rejected whole), strict file
 * shape, unknown domains skipped and listed, storage failures reported per part, and the change events
 * that refresh stores live.
 */
import { describe, expect, it } from 'vitest'
import { meta } from '../data/meta'
import { subscribeStorage, type StorageEvent } from './events'
import { DOMAIN_KEYS, domainVersion, loadDomain, saveDomain, storageKey, type DomainKey } from './index'
import { listQuarantine } from './quarantine'
import { AT, DATA, envelopeText, memoryBackend } from './testing/storageFixtures'
import { applyBackup, BACKUP_FORMAT, BACKUP_VERSION, backupFileName, clearDomain, createBackup, defaultChoice, readBackup, readStored, type BackupContents, type ImportChoice } from './transfer'

const NOW = new Date('2026-10-15T12:00:00.000Z')
const META = { now: NOW, app: 'Terraria Companion', appVersion: '0.1.0', gameVersion: meta.gameVersion }

function fullBackend() {
  const b = memoryBackend()
  for (const d of DOMAIN_KEYS) saveDomain(d, DATA[d] as never, b, new Date(AT))
  return b
}

function read(text: string): BackupContents {
  const r = readBackup(text)
  if (!r.ok) throw new Error(`unreadable: ${JSON.stringify(r.error)}`)
  return r.backup
}

const fileWith = (domains: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ format: BACKUP_FORMAT, v: 1, exportedAt: AT, app: 'Terraria Companion', appVersion: '0.1.0', gameVersion: '1.4.5.8', domains, ...extra })

describe('export (createBackup)', () => {
  it('writes the versioned file envelope: format, v, date, app + version, game version, one ADR D6 envelope per domain', () => {
    const { file, json, included, skipped } = createBackup(DOMAIN_KEYS, META, fullBackend())
    expect(file).toMatchObject({ format: 'terraria-companion-backup', v: BACKUP_VERSION, exportedAt: NOW.toISOString(), app: 'Terraria Companion', appVersion: '0.1.0', gameVersion: '1.4.5.8' })
    expect(Object.keys(file.domains)).toEqual(DOMAIN_KEYS)
    for (const d of DOMAIN_KEYS) expect(file.domains[d]).toEqual({ v: domainVersion(d), savedAt: AT, gameVersion: '1.4.5.8', data: DATA[d] })
    expect(included).toEqual(DOMAIN_KEYS)
    expect(skipped).toEqual([])
    expect(JSON.parse(json)).toEqual(file)
  })

  it('only the picked domains; nothing-saved and unreadable ones are skipped with their reason (storage untouched)', () => {
    const b = memoryBackend({ [storageKey('builds')]: '{not json', [storageKey('favorites')]: envelopeText(DATA.favorites) })
    const before = b.dump()
    const { file, included, skipped } = createBackup(['favorites', 'builds', 'plans'], META, b)
    expect(included).toEqual(['favorites'])
    expect(skipped.map((s) => `${s.domain}:${s.reason}`)).toEqual(['builds:unreadable', 'plans:nothing-saved'])
    expect(Object.keys(file.domains)).toEqual(['favorites'])
    expect(b.dump()).toEqual(before)
  })

  it('re-encodes an older stored version at the current one (v1 builds → v2)', () => {
    const v1 = { builds: [{ ...DATA.builds.builds[0], targetBoss: undefined, ownedIds: undefined, emptiedSlots: undefined }] }
    const legacy = JSON.parse(JSON.stringify(v1))
    const b = memoryBackend({ [storageKey('builds')]: envelopeText(legacy, 1) })
    expect(createBackup(['builds'], META, b).file.domains.builds).toMatchObject({ v: 2, data: legacy })
  })

  it('file name carries the local date', () => {
    expect(backupFileName(new Date(2026, 0, 5, 23, 59))).toBe('terraria-companion-backup-2026-01-05.json')
  })
})

describe('import round trip (every domain)', () => {
  it.each(DOMAIN_KEYS)('%s: export → wipe → import restores it exactly', (domain) => {
    const json = createBackup([domain], META, fullBackend()).json
    const fresh = memoryBackend()
    const backup = read(json)
    expect(backup.parts).toHaveLength(1)
    expect(backup.parts[0]).toMatchObject({ domain, status: 'valid', v: domainVersion(domain), savedAt: AT })
    expect(applyBackup(backup, {}, fresh, NOW)).toEqual([{ domain, outcome: 'imported', changed: true }])
    expect(loadDomain(domain, fresh)).toEqual({ kind: 'loaded', data: DATA[domain] })
  })

  it('all domains at once into an empty browser, in DOMAIN_KEYS order; one change event for the written domains', () => {
    const fresh = memoryBackend()
    const events: StorageEvent[] = []
    const off = subscribeStorage((e, at) => {
      if (at === fresh) events.push(e)
    })
    const outcomes = applyBackup(read(createBackup(DOMAIN_KEYS, META, fullBackend()).json), {}, fresh, NOW)
    off()
    expect(outcomes.map((o) => `${o.domain}:${o.outcome}`)).toEqual(DOMAIN_KEYS.map((d) => `${d}:imported`))
    for (const d of DOMAIN_KEYS) expect(loadDomain(d, fresh)).toEqual({ kind: 'loaded', data: DATA[d] })
    expect(events).toEqual([{ type: 'changed', domains: DOMAIN_KEYS }])
  })
})

describe('merge vs replace vs skip', () => {
  const here = () => {
    const b = memoryBackend()
    saveDomain('builds', { builds: [{ ...DATA.builds.builds[0], buildId: 'bmine00001', name: 'Mine' }] }, b)
    saveDomain('settings', { ...DATA.settings, selectedStage: 'endgame' }, b)
    saveDomain('progress', { worldEvil: 'corruption', nodeStates: { skeletron: 'defeated' } }, b)
    return b
  }
  const backup = () => read(createBackup(['settings', 'progress', 'builds'], META, fullBackend()).json)

  it('defaults: nothing here → take the file’s; mergeable → merge; a single record already set → keep it', () => {
    expect(defaultChoice('builds', false)).toBe('replace')
    expect(defaultChoice('builds', true)).toBe('merge')
    expect(defaultChoice('settings', true)).toBe('skip')
    expect(defaultChoice('readiness', false)).toBe('replace')
    const b = here()
    const outcomes = applyBackup(backup(), {}, b, NOW)
    expect(outcomes.map((o) => `${o.domain}:${o.outcome}`)).toEqual(['settings:skipped', 'progress:merged', 'builds:merged'])
    expect(loadDomain('settings', b)).toMatchObject({ data: { selectedStage: 'endgame' } })
    expect(loadDomain('builds', b)).toMatchObject({ data: { builds: [{ buildId: 'bmine00001' }, { buildId: 'bfixture01' }] } })
    expect(outcomes[1]).toEqual({ domain: 'progress', outcome: 'merged', report: { added: 1, same: 0, kept: 1, dropped: 0, worldEvil: 'kept' }, changed: true })
  })

  it('replace: the file’s data replaces this browser’s; skip leaves it untouched', () => {
    const b = here()
    const outcomes = applyBackup(backup(), { settings: 'replace', progress: 'skip', builds: 'replace' }, b, NOW)
    expect(outcomes.map((o) => `${o.domain}:${o.outcome}`)).toEqual(['settings:replaced', 'progress:skipped', 'builds:replaced'])
    expect(loadDomain('settings', b)).toEqual({ kind: 'loaded', data: DATA.settings })
    expect(loadDomain('builds', b)).toEqual({ kind: 'loaded', data: DATA.builds })
    expect(loadDomain('progress', b)).toMatchObject({ data: { worldEvil: 'corruption', nodeStates: { skeletron: 'defeated' } } })
  })

  it('a "merge" asked of a single record keeps this browser’s (never a silent replace)', () => {
    const b = here()
    expect(applyBackup(backup(), { settings: 'merge' }, b, NOW)[0]).toEqual({ domain: 'settings', outcome: 'skipped' })
    expect(loadDomain('settings', b)).toMatchObject({ data: { selectedStage: 'endgame' } })
  })

  it('a refused write is reported per part, with nothing changed for it', () => {
    const b = here()
    const before = b.dump()
    b.failWrites(true)
    const outcomes = applyBackup(backup(), { settings: 'replace' }, b, NOW)
    expect(outcomes.map((o) => o.outcome)).toEqual(['failed', 'failed', 'failed'])
    expect(b.dump()).toEqual(before)
  })
})

describe('only content changes count (AMENDMENTS-016 B125(a))', () => {
  const changedOf = (o: { outcome: string; changed?: boolean }) => `${o.outcome}:${o.changed ?? '-'}`

  it.each([
    ['the defaults (merge / keep)', {}],
    ['merge everything', { settings: 'skip', progress: 'merge', checklists: 'merge', favorites: 'merge', recent: 'merge', builds: 'merge', plans: 'merge', readiness: 'skip' }],
    ['replace everything', Object.fromEntries(DOMAIN_KEYS.map((d) => [d, 'replace'])) as Partial<Record<DomainKey, ImportChoice>>],
  ] as const)('re-importing a backup of this very browser (%s): nothing changed, nothing written, no change event', (_label, choices) => {
    const b = fullBackend()
    const before = b.dump()
    const backup = read(createBackup(DOMAIN_KEYS, META, b).json)
    const events: StorageEvent[] = []
    const off = subscribeStorage((e, at) => {
      if (at === b) events.push(e)
    })
    const outcomes = applyBackup(backup, choices, b, NOW)
    off()
    expect(outcomes.every((o) => !('changed' in o) || o.changed === false)).toBe(true)
    expect(outcomes.filter((o) => o.outcome !== 'skipped')).not.toHaveLength(0)
    expect(b.dump()).toEqual(before)
    expect(events).toEqual([])
  })

  it('an empty merge (everything already here) and an empty part into nothing are not changes; a real addition is', () => {
    const b = memoryBackend()
    saveDomain('builds', DATA.builds, b)
    saveDomain('favorites', DATA.favorites, b)
    const file = read(
      fileWith({
        builds: { v: 2, savedAt: AT, gameVersion: '1.4.5.8', data: DATA.builds },
        favorites: { v: 1, savedAt: AT, gameVersion: '1.4.5.8', data: { refs: ['boss:plantera', 'i:1'] } },
        plans: { v: domainVersion('plans'), savedAt: AT, gameVersion: '1.4.5.8', data: { plans: [] } },
      }),
    )
    const outcomes = applyBackup(file, {}, b, NOW)
    expect(outcomes.map(changedOf)).toEqual(['merged:false', 'imported:false', 'merged:true'])
    expect(outcomes[0]).toMatchObject({ report: { added: 0, same: 1 } })
    expect(loadDomain('plans', b)).toEqual({ kind: 'empty' })
    expect(loadDomain('favorites', b)).toMatchObject({ data: { refs: ['i:4956', 'boss:plantera', 'i:1'] } })
  })
})

describe('the file’s name rides along (B125(b))', () => {
  it('readBackup keeps the file name; an unreadable part is set aside with that name and the file’s date', () => {
    const backup = read(fileWith({ plans: { v: 1, savedAt: AT, gameVersion: 'x', data: { plans: 'no' } } }))
    expect(backup.fileName).toBeNull()
    const named = readBackup(fileWith({ plans: { v: 1, savedAt: AT, gameVersion: 'x', data: { plans: 'no' } } }), 'my-backup.json')
    if (!named.ok) throw new Error('unreadable')
    expect(named.backup.fileName).toBe('my-backup.json')
    const b = memoryBackend()
    applyBackup(named.backup, {}, b, NOW)
    expect(listQuarantine(b)).toMatchObject([{ domain: 'plans', origin: { kind: 'import', fileName: 'my-backup.json', exportedAt: AT } }])
  })
})

describe('unreadable parts are set aside (quarantined), never applied or dropped', () => {
  it('a part failing validation and a part from a newer app version: reported in the preview, set aside on apply', () => {
    const bad = { v: 1, savedAt: AT, gameVersion: '1.4.5.8', data: { refs: ['not a ref'] } }
    const newer = { v: 7, savedAt: AT, gameVersion: '1.4.5.8', data: { builds: [] } }
    const backup = read(fileWith({ favorites: bad, builds: newer, settings: { v: 1, savedAt: AT, gameVersion: '1.4.5.8', data: DATA.settings } }))
    expect(backup.parts.map((p) => `${p.domain}:${p.status}`)).toEqual(['settings:valid', 'builds:invalid', 'favorites:invalid'])
    expect(backup.parts[1]).toMatchObject({ status: 'invalid', failure: { kind: 'future-version', version: 7, supported: 2 } })
    expect(backup.parts[2]).toMatchObject({ status: 'invalid', failure: { kind: 'invalid' } })

    const b = memoryBackend({ [storageKey('favorites')]: envelopeText(DATA.favorites) })
    const outcomes = applyBackup(backup, {}, b, NOW)
    expect(outcomes.map((o) => `${o.domain}:${o.outcome}`)).toEqual(['settings:imported', 'builds:set-aside', 'favorites:set-aside'])
    // the current favorites are untouched; the unreadable parts sit under tc.quarantine.* as they were in the file
    expect(loadDomain('favorites', b)).toEqual({ kind: 'loaded', data: DATA.favorites })
    expect(loadDomain('builds', b)).toEqual({ kind: 'empty' })
    const copies = listQuarantine(b) ?? []
    expect(copies.map((c) => c.domain)).toEqual(['builds', 'favorites'])
    expect(JSON.parse(copies[0].raw)).toEqual(newer)
    expect(JSON.parse(copies[1].raw)).toEqual(bad)
  })

  it('a set-aside part storage refuses is reported as failed, with its reason', () => {
    const b = memoryBackend()
    b.failWrites(true)
    const backup = read(fileWith({ plans: { v: 1, savedAt: AT, gameVersion: 'x', data: { plans: 'no' } } }))
    expect(applyBackup(backup, {}, b, NOW)).toMatchObject([{ domain: 'plans', outcome: 'failed', failure: { kind: 'invalid' } }])
  })
})

describe('version handling and file shape', () => {
  it('an older part is migrated on import (builds v1 → v2) and written at the current version', () => {
    const legacy = { builds: [{ buildId: 'blegacy001', name: 'Old', createdAt: AT, updatedAt: AT, stage: 'endgame', class: 'magic', difficulty: 'classic', slots: DATA.builds.builds[0].slots }] }
    const backup = read(fileWith({ builds: { v: 1, savedAt: AT, gameVersion: '1.4.4.9', data: legacy } }))
    expect(backup.parts[0]).toMatchObject({ status: 'valid', v: 1, gameVersion: '1.4.4.9' })
    const b = memoryBackend()
    applyBackup(backup, {}, b, NOW)
    expect(JSON.parse(b.dump()[storageKey('builds')])).toMatchObject({ v: 2, data: legacy })
  })

  it('a NEWER backup format is rejected whole, before its shape is read', () => {
    expect(readBackup(fileWith({}, { v: 2 }))).toEqual({ ok: false, error: { kind: 'future-version', version: 2, supported: 1 } })
    expect(readBackup(JSON.stringify({ format: BACKUP_FORMAT, v: 3, anything: true }))).toEqual({ ok: false, error: { kind: 'future-version', version: 3, supported: 1 } })
  })

  it.each([
    ['empty', '   ', 'empty'],
    ['not JSON', '{oops', 'not-json'],
    ['another app’s JSON', JSON.stringify({ hello: 'world' }), 'not-backup'],
    ['a bare stored envelope', envelopeText(DATA.settings), 'not-backup'],
    ['a bad version', fileWith({}, { v: 0 }), 'not-backup'],
    ['an extra top-level key', fileWith({}, { extra: 1 }), 'not-backup'],
    ['a missing key', JSON.stringify({ format: BACKUP_FORMAT, v: 1, exportedAt: AT, app: 'x', appVersion: 'y', domains: {} }), 'not-backup'],
    ['domains as a list', fileWith([] as unknown as Record<string, unknown>), 'not-backup'],
    ['a bad date', fileWith({}, { exportedAt: 'yesterday' }), 'not-backup'],
  ])('rejects %s', (_label, text, kind) => {
    const r = readBackup(text)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe(kind)
  })

  it('rejects a file larger than any backup this site can hold', () => {
    const r = readBackup(fileWith({}, { app: 'x'.repeat(5 * 1024 * 1024) }))
    expect(r.ok === false && r.error.kind).toBe('too-large')
  })

  it('domains this version doesn’t know are listed and skipped; an empty backup holds no parts', () => {
    const backup = read(fileWith({ profiles: { v: 1 }, favorites: { v: 1, savedAt: AT, gameVersion: '1.4.5.8', data: DATA.favorites } }))
    expect(backup.unknown).toEqual(['profiles'])
    expect(backup.parts.map((p) => p.domain)).toEqual(['favorites'])
    expect(read(fileWith({})).parts).toEqual([])
  })
})

describe('the data page’s reads and clears', () => {
  it('readStored: none / readable (size, last save, data) / unreadable (size, reason) — never sets anything aside', () => {
    const b = memoryBackend({ [storageKey('favorites')]: envelopeText(DATA.favorites), [storageKey('plans')]: '{"v":1' })
    expect(readStored('builds', b)).toEqual({ domain: 'builds', state: 'none' })
    expect(readStored('favorites', b)).toEqual({ domain: 'favorites', state: 'readable', bytes: envelopeText(DATA.favorites).length, savedAt: AT, data: DATA.favorites })
    expect(readStored('plans', b)).toMatchObject({ domain: 'plans', state: 'unreadable', bytes: 6, failure: { kind: 'json' } })
    expect(Object.keys(b.dump()).some((k) => k.startsWith('tc.quarantine.'))).toBe(false)
  })

  it('clearDomain deletes one domain only and announces the change', () => {
    const b = fullBackend()
    const seen: DomainKey[][] = []
    const off = subscribeStorage((e, at) => {
      if (at === b && e.type === 'changed') seen.push([...e.domains])
    })
    expect(clearDomain('builds', b)).toBe(true)
    off()
    expect(loadDomain('builds', b)).toEqual({ kind: 'empty' })
    expect(loadDomain('plans', b)).toEqual({ kind: 'loaded', data: DATA.plans })
    expect(seen).toEqual([['builds']])
    expect(clearDomain('builds', null)).toBe(false)
  })
})
