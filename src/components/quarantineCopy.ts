/**
 * QuarantineNotice's sentences (./QuarantineNotice.tsx): restore outcomes, choices and confirmations in
 * words. Separate so the component file exports components only, and tests can pin the wording.
 *
 * AMENDMENTS-016 B125: every sentence names a copy by its ORIGIN — this browser's own data, or a part of
 * a backup file (its name and date) — so a file's bad part never reads as damage here (b); restore
 * summaries count only content changes and lead with anything that stays set aside (a); replacing states
 * both sides (d); a merge-or-replace choice states each option's effect in counts (f).
 */
import { DOMAIN_LABEL, DOMAIN_NOUN, formatWhen, mergeSummary, plainFailure } from '../app/dataDomains'
import type { DomainKey } from '../storage'
import { LOCAL_ORIGIN, type QuarantineOrigin, type QuarantineRecord, type RestoreResult } from '../storage/quarantine'

export const noun = (domain: DomainKey): string => DOMAIN_NOUN[domain].text

export const GONE = 'That copy isn’t here any more (another tab may have restored or discarded it).'

const cap = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

/** The file a copy came from: “name.json”, or "a backup file" when its name wasn't known. */
const fileOf = (origin: Extract<QuarantineOrigin, { kind: 'import' }>): string => (origin.fileName ? `“${origin.fileName}”` : 'a backup file')

/** A copy named where its domain is already said: "the set-aside copy" / "the set-aside part of “b.json”". */
export const copyShort = (origin: QuarantineOrigin = LOCAL_ORIGIN): string => (origin.kind === 'import' ? `the set-aside part of ${fileOf(origin)}` : 'the set-aside copy')

/** A copy's name for its actions' accessible names: "Saved builds, set aside …" / "Saved builds from b.json, set aside …". */
export function copyName(record: QuarantineRecord): string {
  const from = record.origin.kind === 'import' ? ` from ${record.origin.fileName ?? 'a backup file'}` : ''
  return `${DOMAIN_LABEL[record.domain]}${from}${record.at ? `, set aside ${formatWhen(record.at)}` : ''}`
}

/** Where a copy came from, for its details (B125(b)). */
export function originLine(record: QuarantineRecord): string {
  const { origin } = record
  if (origin.kind === 'import') {
    return `The backup file ${fileOf(origin)} (made ${formatWhen(origin.exportedAt)}). This part of it couldn’t be read when the file was restored, so it wasn’t applied — this browser’s own data wasn’t changed by it.`
  }
  return 'This browser’s own saved data: it couldn’t be read when the site loaded it.'
}

/**
 * The notice's sentence: the surface's own (about this browser's data) for local copies, a file's for
 * imported ones — never the local sentence for a file's part.
 */
export function noticeText(message: string, records: readonly QuarantineRecord[]): string {
  const local = records.filter((r) => r.origin.kind === 'local').length
  const imported = records.flatMap((r) => (r.origin.kind === 'import' ? [r.origin] : []))
  const files = new Set(imported.map((o) => o.fileName)).size
  const sentences: string[] = []
  if (local > 0 || imported.length === 0) sentences.push(local > 1 ? `${message} ${local} copies are set aside.` : message)
  if (imported.length === 1) sentences.push('Part of a backup file couldn’t be read, so it was set aside (not restored, not deleted). Nothing saved in this browser was changed by it.')
  else if (imported.length > 1) sentences.push(`${imported.length} parts of ${files === 1 ? 'a backup file' : 'backup files'} couldn’t be read, so they were set aside (not restored, not deleted). Nothing saved in this browser was changed by them.`)
  return sentences.join(' ')
}

/** The outcome sentence for a restore attempt (exported for tests). */
export function restoreMessage(result: RestoreResult, domain: DomainKey, origin: QuarantineOrigin = LOCAL_ORIGIN): { tone: 'done' | 'warn'; message: string } {
  if (result.ok) {
    const copy = copyShort(origin)
    const summary = result.how === 'merged' && result.report ? mergeSummary(domain, result.report) : null
    // Anything still set aside leads (B125(a)).
    const kept = result.keptCopy ? `${origin.kind === 'import' ? cap(copy) : 'The copy'} stays set aside — some of it differs from what’s here, so nothing in it is lost. ` : ''
    if (!result.changed) {
      if (result.keptCopy) return { tone: 'done', message: `${kept}Nothing in your ${noun(domain)} changed${summary ? `: ${summary}` : ''}.` }
      if (summary) return { tone: 'done', message: `Nothing in your ${noun(domain)} changed: everything in ${copy} is already here (${summary}), so the copy was removed.` }
      return { tone: 'done', message: `Nothing in your ${noun(domain)} changed: ${copy} holds nothing that isn’t already here, so it was removed.` }
    }
    if (summary) return { tone: 'done', message: `${kept}Merged ${copy} into your ${noun(domain)}: ${summary}.` }
    if (result.how === 'replaced') return { tone: 'done', message: `Replaced your ${noun(domain)} with ${copy}.` }
    return { tone: 'done', message: `Restored your ${noun(domain)} from ${copy}.` }
  }
  switch (result.reason) {
    case 'unreadable':
      return { tone: 'warn', message: `It still can’t be read. ${plainFailure(result.failure)} It stays set aside.` }
    case 'save-failed':
      return { tone: 'warn', message: 'Couldn’t write it back: this browser’s storage refused the save (it may be full). It stays set aside.' }
    case 'gone':
      return { tone: 'warn', message: GONE }
    case 'needs-choice':
      return { tone: 'warn', message: 'Choose how to restore it.' }
  }
}

// Merge or replace (Try restore into data saved since): both sides, each option's effect in counts.
export const choiceIntro = (domain: DomainKey, origin: QuarantineOrigin, here: string, incoming: string): string =>
  `Your ${noun(domain)} here now: ${here}. ${cap(copyShort(origin))}: ${incoming}.`
export const choiceMerge = (summary: string, keepsCopy = false): string =>
  `Merge: ${summary} — where both hold the same thing, this browser’s version is kept${keepsCopy ? ', and the copy stays set aside so nothing in it is lost' : ''}.`
export const choiceReplace = (origin: QuarantineOrigin, here: string, incoming: string): string => `Replace: ${replaceSides(origin, here, incoming)}`
const replaceSides = (origin: QuarantineOrigin, here: string, incoming: string): string => `what’s saved here now (${here}) is deleted; ${copyShort(origin)} (${incoming}) takes its place.`

export const replaceTitle = (domain: DomainKey): string => `Replace your ${noun(domain)}?`
export const replaceBody = (origin: QuarantineOrigin, here: string, incoming: string): string => `${cap(replaceSides(origin, here, incoming))} This can’t be undone.`
export const replaceAction = (domain: DomainKey): string => `Replace ${noun(domain)}`

export const DISCARD_TITLE = 'Discard this copy permanently?'
export const DISCARD_ACTION = 'Discard permanently'
export function discardBody(record: QuarantineRecord): string {
  const when = record.at ? formatWhen(record.at) : null
  if (record.origin.kind === 'import') {
    return `The set-aside part of ${fileOf(record.origin)} (${DOMAIN_LABEL[record.domain]}${when ? `, set aside ${when}` : ''}) is deleted from this browser; the file itself isn’t touched. This can’t be undone.`
  }
  return `The set-aside copy of your ${noun(record.domain)}${when ? ` (set aside ${when})` : ''} is deleted from this browser. This can’t be undone.`
}
export const discarded = (record: QuarantineRecord): string =>
  record.origin.kind === 'import' ? `Discarded the set-aside part of ${fileOf(record.origin)} (${DOMAIN_LABEL[record.domain]}).` : `Discarded the set-aside copy of your ${noun(record.domain)}.`
