/**
 * P7-S2 data page (/settings/data): the back-up list (every saved part, all picked by default), the restore
 * preview (what's in the file vs here, the per-part choices, unreadable parts said before anything
 * changes), the result (every part's outcome), the saved-data list (size, last save, Clear), which choices
 * need confirming, and a copy audit over every sentence.
 */
import { Tooltip } from 'radix-ui'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { QUARANTINE_MESSAGE } from '../../../components/QuarantineNotice'
import * as qcopy from '../../../components/quarantineCopy'
import { auditCopy } from '../../../scoring/copyAudit'
import { DOMAIN_KEYS, saveDomain, storageKey, type DomainKey } from '../../../storage'
import { LOCAL_ORIGIN, type QuarantineOrigin, type QuarantineRecord } from '../../../storage/quarantine'
import { AT, DATA, envelopeText, memoryBackend } from '../../../storage/testing/storageFixtures'
import { applyBackup, createBackup, readBackup, readStored, type BackupContents, type ImportChoice, type ImportOutcome } from '../../../storage/transfer'
import { ExportSection, ImportPreview, ImportResult, StoredSection } from './DataPage'
import * as copy from './dataPageCopy'
import { partOptions, prepareBackup, replaceRows, replacing, resultCounts } from './dataPageModel'

const wrap = (el: ReactElement) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Tooltip.Provider, null, el)))
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
const META = { now: new Date('2026-10-15T12:00:00.000Z'), app: 'Terraria Companion', appVersion: '0.1.0', gameVersion: '1.4.5.8' }

function sourceBackend() {
  const b = memoryBackend()
  for (const d of DOMAIN_KEYS) saveDomain(d, DATA[d] as never, b, new Date(AT))
  return b
}
function backupOf(json: string): BackupContents {
  const r = readBackup(json)
  if (!r.ok) throw new Error('unreadable')
  return r.backup
}

describe('Back up', () => {
  it('lists every part that holds data, each picked by default, with what it holds', () => {
    const b = memoryBackend({ [storageKey('builds')]: envelopeText(DATA.builds, 2), [storageKey('favorites')]: envelopeText(DATA.favorites) })
    const html = wrap(createElement(ExportSection, { stored: DOMAIN_KEYS.map((d) => readStored(d, b)) }))
    expect([...html.matchAll(/data-export-domain="([a-z]+)"/g)].map((m) => m[1])).toEqual(['builds', 'favorites'])
    // React writes `checked` after the other attributes
    expect(html.match(/<input[^>]*type="checkbox"[^>]*checked=""/g)).toHaveLength(2)
    expect(text(html)).toContain('Saved builds 1 build')
    expect(html).toContain('data-export-download')
    expect(html).toMatch(/<p role="status"[^>]*data-export-status/)
  })

  it('nothing saved: says so, no download button', () => {
    const html = wrap(createElement(ExportSection, { stored: DOMAIN_KEYS.map((d) => readStored(d, memoryBackend())) }))
    expect(text(html)).toContain(copy.EXPORT_NOTHING)
    expect(html).not.toContain('data-export-download')
  })

  it('the file is stamped with the app’s name and package version and the game-data version', () => {
    const { backup, fileName } = prepareBackup(['favorites'], META.now)
    expect(backup.file).toMatchObject({ app: 'Terraria Companion', appVersion: '0.1.0', gameVersion: '1.4.5.8', exportedAt: META.now.toISOString() })
    expect(fileName).toMatch(/^terraria-companion-backup-2026-10-\d\d\.json$/)
  })
})

describe('Restore: preview', () => {
  const full = backupOf(createBackup(DOMAIN_KEYS, META, sourceBackend()).json)
  const nothingHere = Object.fromEntries(DOMAIN_KEYS.map((d) => [d, null]))

  it('options per part: nothing here → restore / don’t; mergeable → merge (with its effect) / replace / don’t; single record → keep / replace', () => {
    const builds = full.parts.find((p) => p.domain === 'builds')
    const settings = full.parts.find((p) => p.domain === 'settings')
    if (builds?.status !== 'valid' || settings?.status !== 'valid') throw new Error('fixture')
    expect(partOptions(builds, null).map((o) => o.value)).toEqual(['replace', 'skip'])
    const merge = partOptions(builds, { builds: [{ ...DATA.builds.builds[0], buildId: 'bmine00001' }] })
    expect(merge.map((o) => o.value)).toEqual(['merge', 'replace', 'skip'])
    expect(merge[0].label).toBe('Merge: 1 build added')
    expect(merge[1].label).toBe('Replace: the file’s 1 build instead of what’s here')
    expect(partOptions(settings, DATA.settings).map((o) => `${o.value}:${o.label}`)).toEqual(['skip:Keep this browser’s', 'replace:Replace it with the file’s'])
  })

  it('renders file facts, each part’s contents vs this browser’s, and the chosen option checked', () => {
    const current = { ...nothingHere, builds: { builds: [{ ...DATA.builds.builds[0], buildId: 'bmine00001' }] } }
    const choices = { ...Object.fromEntries(DOMAIN_KEYS.map((d) => [d, 'replace'])), builds: 'merge' } as const
    const html = wrap(createElement(ImportPreview, { fileName: 'backup.json', backup: full, current, choices, onChoice: () => {}, onApply: () => {}, onCancel: () => {} }))
    const t = text(html)
    expect(t).toContain('What’s in backup.json')
    expect(t).toContain('by Terraria Companion 0.1.0, with game data 1.4.5.8')
    expect(t).toContain('In the file: 1 build · saved')
    expect(t).toContain('In this browser: 1 build')
    expect(t).toContain('In this browser: nothing saved')
    expect(t).toContain(copy.MERGE_RULE)
    expect([...html.matchAll(/data-import-part="([a-z]+)"/g)].map((m) => m[1])).toEqual(DOMAIN_KEYS)
    const buildsRadios = (html.match(/<input[^>]*>/g) ?? []).filter((tag) => tag.includes('name="data-choice-builds"'))
    expect(buildsRadios.filter((tag) => tag.includes('checked=""')).map((tag) => /value="([a-z]+)"/.exec(tag)?.[1])).toEqual(['merge'])
    expect(buildsRadios).toHaveLength(3)
    // every choice is a labelled radio inside a fieldset named by the part
    expect(html.match(/<fieldset/g)).toHaveLength(DOMAIN_KEYS.length)
    expect(html).toContain('<legend class="font-semibold">Saved builds</legend>')
  })

  it('unreadable parts are said before anything changes; a game-data mismatch and unknown parts are noted', () => {
    const file = JSON.parse(createBackup(['favorites'], META, sourceBackend()).json)
    file.gameVersion = '1.4.4.9'
    file.domains.plans = { v: 4, savedAt: AT, gameVersion: '1.4.5.8', data: {} }
    file.domains.profiles = {}
    const backup = backupOf(JSON.stringify(file))
    const t = text(wrap(createElement(ImportPreview, { fileName: 'b.json', backup, current: nothingHere, choices: { favorites: 'replace' }, onChoice: () => {}, onApply: () => {}, onCancel: () => {} })))
    expect(t).toContain('Can’t be read. It was saved by a newer version of this site (format 4; this version reads up to format 1). It will be set aside (not restored, not deleted)')
    expect(t).toContain('This site now uses game data 1.4.5.8, not 1.4.4.9.')
    expect(t).toContain('Not known to this version of the site, so skipped: profiles.')
  })

  it('only replacing data this browser holds needs confirming', () => {
    const current = { ...nothingHere, settings: DATA.settings, builds: DATA.builds }
    expect(replacing(full, current, { settings: 'skip', builds: 'merge', plans: 'replace' })).toEqual([])
    expect(replacing(full, current, { settings: 'replace', builds: 'replace', plans: 'replace' })).toEqual(['settings', 'builds'])
  })

  it('B125(d): the replace confirm states both sides — what’s deleted here and what takes its place', () => {
    const two = { builds: [{ ...DATA.builds.builds[0], buildId: 'bmine00001' }, { ...DATA.builds.builds[0], buildId: 'bmine00002' }] }
    const current = { ...nothingHere, settings: { ...DATA.settings, selectedStage: 'endgame' as const }, builds: two }
    const rows = replaceRows(full, current, { settings: 'replace', builds: 'replace', plans: 'replace' })
    expect(rows).toEqual([
      { label: 'Settings', here: 'Stage: Endgame', file: 'Stage: Early Hardmode' },
      { label: 'Saved builds', here: '2 builds', file: '1 build' },
    ])
    expect(copy.confirmBody(rows)).toBe(
      'Settings: what’s saved here now (Stage: Endgame) is deleted; the file’s (Stage: Early Hardmode) takes its place. Saved builds: what’s saved here now (2 builds) is deleted; the file’s (1 build) takes its place. This can’t be undone.',
    )
    // the set-aside copy's replace names both sides too, by its origin
    expect(qcopy.replaceBody(LOCAL_ORIGIN, '2 builds', '1 build')).toBe('What’s saved here now (2 builds) is deleted; the set-aside copy (1 build) takes its place. This can’t be undone.')
    expect(qcopy.replaceBody({ kind: 'import', fileName: 'b.json', exportedAt: AT }, '2 builds', '1 build')).toBe('What’s saved here now (2 builds) is deleted; the set-aside part of “b.json” (1 build) takes its place. This can’t be undone.')
  })

  it('an empty backup says so and offers no Restore button', () => {
    const backup = backupOf(JSON.stringify({ format: 'terraria-companion-backup', v: 1, exportedAt: AT, app: 'x', appVersion: '1', gameVersion: '1.4.5.8', domains: {} }))
    const html = wrap(createElement(ImportPreview, { fileName: 'e.json', backup, current: {}, choices: {}, onChoice: () => {}, onApply: () => {}, onCancel: () => {} }))
    expect(text(html)).toContain(copy.PREVIEW_EMPTY)
    expect(html).not.toContain('data-import-apply')
  })
})

describe('Restore: result', () => {
  const headline = (html: string) => text(/<p[^>]*data-import-headline=""[^>]*>([\s\S]*?)<\/p>/.exec(html)?.[1] ?? '').trim()

  it('lists every part’s outcome — restored, merged with counts, replaced, kept, set aside, refused — and the unknown parts', () => {
    const file = JSON.parse(createBackup(DOMAIN_KEYS, META, sourceBackend()).json)
    file.domains.profiles = {}
    const backup = backupOf(JSON.stringify(file))
    const outcomes: ImportOutcome[] = [
      { domain: 'settings', outcome: 'skipped' },
      { domain: 'progress', outcome: 'merged', report: { added: 1, same: 1, kept: 0, dropped: 0 }, changed: true },
      { domain: 'builds', outcome: 'replaced', changed: true },
      { domain: 'plans', outcome: 'imported', changed: true },
      { domain: 'favorites', outcome: 'set-aside', key: 'k', failure: { kind: 'invalid', message: 'x', version: 1 } },
      { domain: 'recent', outcome: 'failed', message: 'quota' },
    ]
    const html = wrap(createElement(ImportResult, { backup, outcomes, onReset: () => {} }))
    const t = text(html)
    expect(headline(html)).toBe(
      '1 part of the file couldn’t be read, so it was set aside — not restored, not deleted (the notice at the top of this page has it). 3 parts of this browser’s data changed — every page shows it now. 1 part couldn’t be saved: this browser’s storage refused it.',
    )
    expect(t).toContain('Settings: not restored; this browser’s is unchanged.')
    expect(t).toContain('Boss progress: merged — 1 boss mark added · 1 already here.')
    expect(t).toContain('Saved builds: replaced with the backup’s (1 build).')
    expect(t).toContain('Plans: restored (1 plan).')
    expect(t).toContain('Favorites: the file’s part couldn’t be read, so it was set aside — not restored, not deleted; this browser’s is unchanged.')
    expect(t).toContain('Recently viewed: not restored — this browser’s storage refused the save')
    // B125(c): the skipped unknown part is repeated here, so the result is a complete record
    expect(html).toContain('data-import-outcome="unknown"')
    expect(t).toContain('Not known to this version of the site, so not restored: profiles.')
  })

  it('B125(a) headline math: an identical re-import says nothing changed; empty merges and identical rewrites aren’t counted', () => {
    const here = sourceBackend()
    const backup = backupOf(createBackup(DOMAIN_KEYS, META, here).json)
    const replaceAll = Object.fromEntries(DOMAIN_KEYS.map((d) => [d, 'replace'])) as Partial<Record<DomainKey, ImportChoice>>
    for (const choices of [{}, replaceAll]) {
      const outcomes = applyBackup(backup, choices, here, META.now)
      expect(resultCounts(outcomes)).toEqual({ changed: 0, setAside: 0, failed: 0 })
      const html = wrap(createElement(ImportResult, { backup, outcomes, onReset: () => {} }))
      expect(headline(html)).toBe('Nothing in this browser changed.')
      expect(html).not.toContain('data-import-changed="true"')
    }
    const lines = [
      copy.outcomeLine({ domain: 'builds', outcome: 'merged', report: { added: 0, same: 1, kept: 0, dropped: 0 }, changed: false }),
      copy.outcomeLine({ domain: 'builds', outcome: 'replaced', changed: false }, '1 build'),
      copy.outcomeLine({ domain: 'plans', outcome: 'imported', changed: false }, '0 plans'),
    ]
    expect(lines).toEqual([
      'Saved builds: merged — 0 builds added · 1 already here; nothing here changed.',
      'Saved builds: the backup’s (1 build) matches what’s saved here; nothing changed.',
      'Plans: nothing to restore (0 plans); this browser’s is unchanged.',
    ])
    // an empty merge next to a real one: only the real one counts
    expect(
      resultCounts([
        { domain: 'builds', outcome: 'merged', report: { added: 0, same: 3, kept: 0, dropped: 0 }, changed: false },
        { domain: 'favorites', outcome: 'merged', report: { added: 2, same: 0, kept: 0, dropped: 0 }, changed: true },
        { domain: 'settings', outcome: 'replaced', changed: false },
      ]),
    ).toEqual({ changed: 1, setAside: 0, failed: 0 })
  })

  it('B125(a): anything set aside leads the headline, before what changed', () => {
    expect(copy.resultIntro(0, 1)).toBe('1 part of the file couldn’t be read, so it was set aside — not restored, not deleted (the notice at the top of this page has it). Apart from that copy, nothing in this browser changed.')
    const many = copy.resultIntro(2, 3)
    expect(many.indexOf('3 parts of the file couldn’t be read')).toBe(0)
    expect(many.indexOf('2 parts of this browser’s data changed')).toBeGreaterThan(0)
    expect(copy.resultIntro(0, 2)).toContain('Apart from those copies, nothing in this browser changed.')
    expect(copy.resultIntro(1)).toBe('1 part of this browser’s data changed — every page shows it now.')
  })
})

describe('Saved in this browser', () => {
  it('every domain: what it is, its contents, size and last save; Clear only where something is saved', () => {
    const b = memoryBackend({ [storageKey('plans')]: envelopeText(DATA.plans) })
    const html = wrap(createElement(StoredSection, { stored: DOMAIN_KEYS.map((d) => readStored(d, b)) }))
    expect([...html.matchAll(/data-stored-domain="([a-z]+)" data-stored-state="([a-z]+)"/g)].map((m) => `${m[1]}:${m[2]}`)).toEqual(DOMAIN_KEYS.map((d) => `${d}:${d === 'plans' ? 'readable' : 'none'}`))
    const t = text(html)
    expect(t).toMatch(/1 plan · \d+ bytes · saved Oct 1\d, 2026/)
    expect(t.match(/Nothing saved/g)).toHaveLength(7)
    expect([...html.matchAll(/data-clear-domain="([a-z]+)"/g)].map((m) => m[1])).toEqual(['plans'])
    expect(t).toContain('Clear… Plans')
  })

  it('B125(f): a row’s line acknowledges its set-aside copies (rendered: dataQuarantine.test.ts)', () => {
    expect(copy.withCopies(copy.NOTHING_SAVED, 2)).toBe('Nothing saved · 2 set-aside copies (in the notice at the top of this page)')
    expect(copy.withCopies(copy.NOTHING_SAVED, 0)).toBe('Nothing saved')
  })
})

const FROM_FILE: QuarantineOrigin = { kind: 'import', fileName: 'terraria-companion-backup-2026-10-14.json', exportedAt: AT }
function record(domain: DomainKey, origin: QuarantineOrigin, key = `tc.quarantine.${domain}.2026-10-15T12:00:00.000Z`): QuarantineRecord {
  return { key, domain, at: '2026-10-15T12:00:00.000Z', raw: '{"v":9}', origin, stuck: false }
}

describe('set-aside copies name their origin (B125(b))', () => {
  it('local and imported copies together: each in its own words, counted', () => {
    const records = [record('builds', LOCAL_ORIGIN, 'a'), record('builds', LOCAL_ORIGIN, 'b'), record('builds', FROM_FILE, 'c'), record('plans', FROM_FILE, 'd')]
    expect(qcopy.noticeText(QUARANTINE_MESSAGE, records)).toBe(
      `${QUARANTINE_MESSAGE} 2 copies are set aside. 2 parts of a backup file couldn’t be read, so they were set aside (not restored, not deleted). Nothing saved in this browser was changed by them.`,
    )
    expect(qcopy.noticeText(QUARANTINE_MESSAGE, [record('builds', LOCAL_ORIGIN)])).toBe(QUARANTINE_MESSAGE)
    expect(qcopy.noticeText(QUARANTINE_MESSAGE, [])).toBe(QUARANTINE_MESSAGE)
    expect(qcopy.noticeText(QUARANTINE_MESSAGE, [record('builds', FROM_FILE, 'a'), record('plans', { ...FROM_FILE, fileName: 'other.json' }, 'b')])).toContain('2 parts of backup files couldn’t be read')
  })

  it('details, names, outcomes and the discard confirm say where a copy came from', () => {
    const imported = record('plans', FROM_FILE)
    const local = record('plans', LOCAL_ORIGIN)
    expect(qcopy.originLine(imported)).toMatch(/^The backup file “terraria-companion-backup-2026-10-14\.json” \(made Oct 14, 2026, .+\)\. This part of it couldn’t be read when the file was restored, so it wasn’t applied — this browser’s own data wasn’t changed by it\.$/)
    expect(qcopy.originLine(local)).toBe('This browser’s own saved data: it couldn’t be read when the site loaded it.')
    expect(qcopy.copyName(imported)).toMatch(/^Plans from terraria-companion-backup-2026-10-14\.json, set aside Oct 15, 2026/)
    expect(qcopy.copyName(local)).toMatch(/^Plans, set aside Oct 15, 2026/)
    expect(qcopy.discardBody(imported)).toMatch(/^The set-aside part of “terraria-companion-backup-2026-10-14\.json” \(Plans, set aside .+\) is deleted from this browser; the file itself isn’t touched\. This can’t be undone\.$/)
    expect(qcopy.discarded(imported)).toBe('Discarded the set-aside part of “terraria-companion-backup-2026-10-14.json” (Plans).')
    expect(qcopy.discarded(local)).toBe('Discarded the set-aside copy of your plans.')
    expect(qcopy.restoreMessage({ ok: true, domain: 'plans', how: 'restored', changed: true, keptCopy: false }, 'plans', FROM_FILE).message).toBe('Restored your plans from the set-aside part of “terraria-companion-backup-2026-10-14.json”.')
  })

  it('Try restore summaries: only content changes, a kept copy first; the choice states each option in counts', () => {
    const report = { added: 0, same: 2, kept: 0, dropped: 0 }
    expect(qcopy.restoreMessage({ ok: true, domain: 'builds', how: 'merged', report, changed: false, keptCopy: false }, 'builds').message).toBe(
      'Nothing in your saved builds changed: everything in the set-aside copy is already here (0 builds added · 2 already here), so the copy was removed.',
    )
    expect(qcopy.restoreMessage({ ok: true, domain: 'settings', how: 'replaced', changed: false, keptCopy: false }, 'settings').message).toBe(
      'Nothing in your settings changed: the set-aside copy holds nothing that isn’t already here, so it was removed.',
    )
    const keptOnly = qcopy.restoreMessage({ ok: true, domain: 'builds', how: 'merged', report: { added: 0, same: 0, kept: 1, dropped: 0 }, changed: false, keptCopy: true }, 'builds', FROM_FILE).message
    expect(keptOnly).toBe('The set-aside part of “terraria-companion-backup-2026-10-14.json” stays set aside — some of it differs from what’s here, so nothing in it is lost. Nothing in your saved builds changed: 0 builds added · 1 different here, this browser’s kept.')
    expect(qcopy.choiceIntro('builds', LOCAL_ORIGIN, '2 builds', '3 builds')).toBe('Your saved builds here now: 2 builds. The set-aside copy: 3 builds.')
    expect(qcopy.choiceMerge('1 build added · 2 already here')).toBe('Merge: 1 build added · 2 already here — where both hold the same thing, this browser’s version is kept.')
    expect(qcopy.choiceMerge('2 builds added · 1 different here, this browser’s kept', true)).toBe(
      'Merge: 2 builds added · 1 different here, this browser’s kept — where both hold the same thing, this browser’s version is kept, and the copy stays set aside so nothing in it is lost.',
    )
    expect(qcopy.choiceReplace(LOCAL_ORIGIN, '2 builds', '3 builds')).toBe('Replace: what’s saved here now (2 builds) is deleted; the set-aside copy (3 builds) takes its place.')
  })
})

describe('copy audit (no outcome or forward promises)', () => {
  it('every data-page sentence passes', () => {
    const samples: string[] = []
    for (const value of Object.values(copy)) {
      if (typeof value === 'string') samples.push(value)
    }
    samples.push(
      copy.exportDone('f.json', 3, 2048),
      copy.exportSkipped(['builds']),
      copy.previewTitle('f.json'),
      copy.previewMade('Oct 15', 'Terraria Companion', '0.1.0', '1.4.5.8'),
      copy.previewGameMismatch('1.4.4.9', '1.4.5.8'),
      copy.previewUnknown(['profiles']),
      copy.inFile('1 build', 'Oct 15'),
      copy.migratedNote(1, 2),
      copy.inBrowser(null),
      copy.choiceMerge('1 build added'),
      copy.choiceReplace('1 build'),
      copy.invalidPart({ kind: 'json', message: 'x' }),
      copy.confirmBody([{ label: 'Saved builds', here: '2 builds', file: '1 build' }]),
      ...[0, 1, 2].flatMap((changed) => [0, 1, 2].flatMap((setAside) => [0, 1, 2].map((failed) => copy.resultIntro(changed, setAside, failed)))),
      ...([true, false] as const).flatMap((changed) => [
        copy.outcomeLine({ domain: 'builds', outcome: 'imported', changed }, '1 build'),
        copy.outcomeLine({ domain: 'builds', outcome: 'merged', report: { added: 1, same: 1, kept: 1, dropped: 0 }, changed }),
        copy.outcomeLine({ domain: 'builds', outcome: 'replaced', changed }, '1 build'),
      ]),
      copy.outcomeLine({ domain: 'builds', outcome: 'skipped' }),
      copy.outcomeLine({ domain: 'builds', outcome: 'set-aside', key: 'k', failure: { kind: 'future-version', message: '', version: 3, supported: 2 } }),
      copy.outcomeLine({ domain: 'builds', outcome: 'failed', message: 'x' }),
      copy.resultUnknown(['profiles']),
      copy.storedLine('1 build', 300, 'Oct 15'),
      copy.withCopies(copy.NOTHING_SAVED, 1),
      copy.withCopies(copy.NOTHING_SAVED, 3),
      copy.unreadableLine(20),
      copy.quarantineCount(2, 4000),
      // the set-aside copies' words (QuarantineNotice), both origins
      ...[LOCAL_ORIGIN, FROM_FILE, { ...FROM_FILE, fileName: null }].flatMap((origin) => {
        const r = record('builds', origin)
        return [
          qcopy.originLine(r),
          qcopy.copyName(r),
          qcopy.discardBody(r),
          qcopy.discarded(r),
          qcopy.noticeText(QUARANTINE_MESSAGE, [r, r]),
          qcopy.choiceIntro('builds', origin, '2 builds', '1 build'),
          qcopy.choiceReplace(origin, '2 builds', '1 build'),
          qcopy.replaceBody(origin, '2 builds', '1 build'),
          ...([true, false] as const).flatMap((changed) =>
            ([true, false] as const).flatMap((keptCopy) => [
              qcopy.restoreMessage({ ok: true, domain: 'builds', how: 'merged', report: { added: 1, same: 1, kept: keptCopy ? 1 : 0, dropped: 0 }, changed, keptCopy }, 'builds', origin).message,
              qcopy.restoreMessage({ ok: true, domain: 'builds', how: 'replaced', changed, keptCopy: false }, 'builds', origin).message,
              qcopy.restoreMessage({ ok: true, domain: 'builds', how: 'restored', changed, keptCopy: false }, 'builds', origin).message,
            ]),
          ),
        ]
      }),
      qcopy.choiceMerge('1 build added'),
      qcopy.choiceMerge('1 build added', true),
      qcopy.replaceTitle('builds'),
      qcopy.replaceAction('builds'),
      qcopy.DISCARD_TITLE,
      qcopy.DISCARD_ACTION,
      ...DOMAIN_KEYS.flatMap((d) => [copy.clearLabel(d), copy.clearTitle(d), copy.clearBody(d, 'x'), copy.clearAction(d), copy.cleared(d)]),
      ...(['empty', 'not-json', 'not-backup'] as const).map((kind) => copy.readError({ kind, message: '' } as never)),
      copy.readError({ kind: 'too-large', bytes: 9e6 }),
      copy.readError({ kind: 'future-version', version: 2, supported: 1 }),
    )
    for (const s of samples) expect(auditCopy(s), s).toBeUndefined()
    expect(copy.cleared('progress')).toBe('Your boss progress was cleared from this browser.')
    expect(copy.cleared('builds')).toBe('Your saved builds were cleared from this browser.')
  })
})
