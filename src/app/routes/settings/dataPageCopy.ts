/**
 * The data page's words (P7-S2; UX_SPEC §5.6/§5.7 honesty conventions): one place, so the copy audit
 * (src/scoring/copyAudit.ts — no outcome promises, no forward promises) runs over every sentence.
 */
import type { DecodeFailure, DomainKey } from '../../../storage'
import type { BackupReadError, ImportOutcome } from '../../../storage/transfer'
import { DOMAIN_LABEL, DOMAIN_NOUN, formatBytes, mergeSummary, nounWith, plainFailure, plural } from '../../dataDomains'

export const DOC_TITLE = 'Your data'
export const TITLE = 'Your data'
export const INTRO =
  'Everything you save on this site — your stage, boss progress, builds, plans, checklists and favorites — is kept in this browser only. Nothing is sent anywhere. Download a backup to keep it safe or to move it to another browser.'

// Back up
export const EXPORT_TITLE = 'Back up'
export const EXPORT_INTRO = 'Downloads one file (JSON) with the parts you pick. “Restore from a backup” below reads it back, here or in another browser.'
export const EXPORT_LEGEND = 'Parts to include'
export const EXPORT_BUTTON = 'Download backup'
export const EXPORT_NOTHING = 'Nothing is saved in this browser, so there is nothing to back up.'
export const EXPORT_NONE_PICKED = 'Pick at least one part to back up.'
export const exportDone = (fileName: string, parts: number, bytes: number) => `Downloaded ${fileName} (${plural(parts, 'part')}, ${formatBytes(bytes)}).`
export const exportSkipped = (domains: readonly DomainKey[]) => `Not included: ${domains.map((d) => DOMAIN_LABEL[d]).join(', ')} (nothing readable saved).`
export const EXPORT_FAILED = 'The browser couldn’t create the download. Nothing was changed.'

// Restore
export const IMPORT_TITLE = 'Restore from a backup'
export const IMPORT_INTRO = 'Pick a backup file made on this site. You’ll see what’s inside and choose, part by part, how it joins what’s saved here — nothing changes until you confirm.'
export const IMPORT_FILE_LABEL = 'Backup file'
export const IMPORT_READING = 'Reading the file…'
export const previewTitle = (fileName: string) => `What’s in ${fileName}`
export const previewMade = (when: string, app: string, appVersion: string, gameVersion: string) => `Made ${when} by ${app} ${appVersion}, with game data ${gameVersion}.`
export const previewGameMismatch = (fileGame: string, siteGame: string) =>
  `This site now uses game data ${siteGame}, not ${fileGame}. Items are stored by their game ids, which stay the same; a few details about them may differ.`
export const previewUnknown = (names: readonly string[]) => `Not known to this version of the site, so skipped: ${names.join(', ')}.`
export const PREVIEW_EMPTY = 'This backup holds nothing to restore.'
export const inFile = (summary: string, when: string) => `In the file: ${summary} · saved ${when}`
export const migratedNote = (from: number, to: number) => ` · format ${from}, updated to ${to} as it’s restored`
export const inBrowser = (summary: string | null) => `In this browser: ${summary ?? 'nothing saved'}`
export const CHOICE_IMPORT = 'Restore it'
export const CHOICE_SKIP = 'Don’t restore it'
export const CHOICE_KEEP = 'Keep this browser’s'
export const CHOICE_REPLACE_SINGLE = 'Replace it with the file’s'
export const choiceMerge = (summary: string) => `Merge: ${summary}`
export const choiceReplace = (fileSummary: string) => `Replace: the file’s ${fileSummary} instead of what’s here`
export const MERGE_RULE = 'Merging keeps everything saved here and adds what’s missing; where both hold the same thing, this browser’s version is kept.'
export const invalidPart = (failure: DecodeFailure) => `Can’t be read. ${plainFailure(failure)} It will be set aside (not restored, not deleted) so you can look at it, or try again after the site updates.`
export const APPLY = 'Restore'
export const CANCEL = 'Cancel'
export const CHOOSE_ANOTHER = 'Restore another file'
export const CONFIRM_TITLE = 'Replace data in this browser?'
/** One part a confirmed restore replaces: its name, what's here now and what the file holds (summaries). */
export interface ReplaceRow {
  label: string
  here: string
  file: string
}
/** Both sides of every replacement (AMENDMENTS-016 B125(d)): what's deleted here, and what takes its place. */
export const confirmBody = (rows: readonly ReplaceRow[]) =>
  `${rows.map((r) => `${r.label}: what’s saved here now (${r.here}) is deleted; the file’s (${r.file}) takes its place.`).join(' ')} This can’t be undone.`
export const CONFIRM_EXTRA = 'Parts set to merge or keep aren’t affected by this.'
export const CONFIRM_ACTION = 'Replace and restore'

export function readError(error: BackupReadError): string {
  switch (error.kind) {
    case 'empty':
      return 'That file is empty.'
    case 'too-large':
      return `That file is too large to be a backup from this site (${formatBytes(error.bytes)}).`
    case 'not-json':
      return 'That file isn’t a backup from this site: it isn’t valid JSON.'
    case 'not-backup':
      return 'That file isn’t a Terraria Companion backup.'
    case 'future-version':
      return `This backup was made by a newer version of the site (backup format ${error.version}; this version reads format ${error.supported}). Nothing was restored. Reload the site to get its newest version, then try again.`
  }
}

export const RESULT_TITLE = 'Restore finished'
/**
 * The result's headline (AMENDMENTS-016 B125(a)): `changed` counts only parts whose CONTENT changed (an
 * identical part or an empty merge isn't a change); anything set aside leads; refused saves are said too.
 */
export function resultIntro(changed: number, setAside = 0, failed = 0): string {
  const sentences: string[] = []
  if (setAside > 0) {
    sentences.push(
      setAside === 1
        ? '1 part of the file couldn’t be read, so it was set aside — not restored, not deleted (the notice at the top of this page has it).'
        : `${plural(setAside, 'part')} of the file couldn’t be read, so they were set aside — not restored, not deleted (the notice at the top of this page has them).`,
    )
  }
  if (changed > 0) sentences.push(`${plural(changed, 'part')} of this browser’s data changed — every page shows it now.`)
  else sentences.push(setAside === 0 ? 'Nothing in this browser changed.' : `Apart from ${setAside === 1 ? 'that copy' : 'those copies'}, nothing in this browser changed.`)
  if (failed > 0) sentences.push(`${plural(failed, 'part')} couldn’t be saved: this browser’s storage refused ${failed === 1 ? 'it' : 'them'}.`)
  return sentences.join(' ')
}

export function outcomeLine(outcome: ImportOutcome, fileSummary?: string): string {
  const label = DOMAIN_LABEL[outcome.domain]
  const holds = fileSummary ? ` (${fileSummary})` : ''
  switch (outcome.outcome) {
    case 'imported':
      return outcome.changed ? `${label}: restored${holds}.` : `${label}: nothing to restore${holds}; this browser’s is unchanged.`
    case 'merged':
      return `${label}: merged — ${mergeSummary(outcome.domain, outcome.report)}${outcome.changed ? '' : '; nothing here changed'}.`
    case 'replaced':
      return outcome.changed ? `${label}: replaced with the backup’s${holds}.` : `${label}: the backup’s${holds} matches what’s saved here; nothing changed.`
    case 'skipped':
      return `${label}: not restored; this browser’s is unchanged.`
    case 'set-aside':
      return `${label}: the file’s part couldn’t be read, so it was set aside — not restored, not deleted; this browser’s is unchanged. ${plainFailure(outcome.failure)} The notice at the top of this page has its details.`
    case 'failed':
      return `${label}: not restored — this browser’s storage refused the save (it may be full). Nothing changed for this part.`
  }
}

/** Parts of the file this version doesn't know, repeated in the result so it is a complete record (B125(c)). */
export const resultUnknown = (names: readonly string[]) => `Not known to this version of the site, so not restored: ${names.join(', ')}.`

// Saved in this browser
export const STORED_TITLE = 'Saved in this browser'
export const STORED_INTRO = 'Sizes are of the saved text. Clearing a part deletes it from this browser for good — back it up first if you may want it.'
export const NOTHING_SAVED = 'Nothing saved'
export const storedLine = (summary: string, bytes: number, when: string) => `${summary} · ${formatBytes(bytes)} · saved ${when}`
/** A part's row also acknowledges its set-aside copies (so "Nothing saved" never hides one). */
export const withCopies = (line: string, copies: number) => (copies > 0 ? `${line} · ${plural(copies, 'set-aside copy', 'set-aside copies')} (in the notice at the top of this page)` : line)
export const unreadableLine = (bytes: number) => `Can’t be read (${formatBytes(bytes)}); it is set aside the next time the site reads it.`
export const clearLabel = (domain: DomainKey) => `Clear ${DOMAIN_LABEL[domain].toLowerCase()}`
export const CLEAR_BUTTON = 'Clear…'
export const clearTitle = (domain: DomainKey) => `Clear your ${DOMAIN_NOUN[domain].text}?`
export const clearBody = (domain: DomainKey, summary: string) => `Deletes your ${DOMAIN_NOUN[domain].text} (${summary}) from this browser. This can’t be undone.`
export const CLEAR_EXTRA = 'Your other saved data isn’t affected. To keep a copy, back it up first.'
export const clearAction = (domain: DomainKey) => `Clear ${DOMAIN_NOUN[domain].text}`
export const cleared = (domain: DomainKey) => `Your ${nounWith(domain, 'was', 'were')} cleared from this browser.`
export const CLEAR_FAILED = 'This browser’s storage refused the change. Nothing was cleared.'
export const quarantineCount = (count: number, bytes: number) => `Set-aside copies: ${count.toLocaleString('en-US')} (${formatBytes(bytes)}) — the notice at the top of this page lists them, with their actions.`
