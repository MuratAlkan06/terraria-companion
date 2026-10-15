/**
 * The data page's logic (P7-S2), apart from its components: the backup file it hands to the browser, the
 * options each restorable part offers, which choices replace data this browser holds (those confirm, both
 * sides stated), and the result headline's counts.
 */
import { version as APP_VERSION } from '../../../../package.json'
import { meta } from '../../../data/meta'
import type { DomainData, DomainKey } from '../../../storage'
import { canMerge, mergeDomain } from '../../../storage/merge'
import { backupFileName, createBackup, type BackupBuild, type BackupContents, type BackupPart, type ImportChoice, type ImportOutcome } from '../../../storage/transfer'
import { DOMAIN_LABEL, mergeSummary, summarize } from '../../dataDomains'
import { SITE } from '../../site'
import * as copy from './dataPageCopy'

/** This browser's data per part of a backup being previewed (null: nothing saved here). */
export type Current = Partial<Record<DomainKey, DomainData<DomainKey> | null>>

/** A backup of `picked` as stored now, stamped with this app's name, version and game-data version. */
export function prepareBackup(picked: readonly DomainKey[], now: Date = new Date()): { backup: BackupBuild; fileName: string } {
  return { backup: createBackup(picked, { now, app: SITE.name, appVersion: APP_VERSION, gameVersion: meta.gameVersion }), fileName: backupFileName(now) }
}

/** Parts whose choice replaces data this browser holds (the confirm dialog's list). */
export function replacing(backup: BackupContents, current: Current, choices: Partial<Record<DomainKey, ImportChoice>>): DomainKey[] {
  return backup.parts.filter((p) => p.status === 'valid' && current[p.domain] && choices[p.domain] === 'replace').map((p) => p.domain)
}

/** The confirm dialog's rows: each replaced part with both sides — what's here now and the file's (B125(d)). */
export function replaceRows(backup: BackupContents, current: Current, choices: Partial<Record<DomainKey, ImportChoice>>): copy.ReplaceRow[] {
  return replacing(backup, current, choices).flatMap((domain) => {
    const part = backup.parts.find((p) => p.domain === domain)
    const here = current[domain]
    return part?.status === 'valid' && here ? [{ label: DOMAIN_LABEL[domain], here: summarize(domain, here), file: summarize(domain, part.data) }] : []
  })
}

/**
 * The result headline's counts (B125(a)): parts whose content changed (not empty merges or identical
 * rewrites), parts set aside, and parts storage refused.
 */
export function resultCounts(outcomes: readonly ImportOutcome[]): { changed: number; setAside: number; failed: number } {
  return {
    changed: outcomes.filter((o) => (o.outcome === 'imported' || o.outcome === 'merged' || o.outcome === 'replaced') && o.changed).length,
    setAside: outcomes.filter((o) => o.outcome === 'set-aside').length,
    failed: outcomes.filter((o) => o.outcome === 'failed').length,
  }
}

/** The options a valid part offers, given what this browser holds. */
export function partOptions(part: Extract<BackupPart, { status: 'valid' }>, current: DomainData<DomainKey> | null | undefined): { value: ImportChoice; label: string }[] {
  if (!current) {
    return [
      { value: 'replace', label: copy.CHOICE_IMPORT },
      { value: 'skip', label: copy.CHOICE_SKIP },
    ]
  }
  if (!canMerge(part.domain)) {
    return [
      { value: 'skip', label: copy.CHOICE_KEEP },
      { value: 'replace', label: copy.CHOICE_REPLACE_SINGLE },
    ]
  }
  return [
    { value: 'merge', label: copy.choiceMerge(mergeSummary(part.domain, mergeDomain(part.domain, current, part.data).report)) },
    { value: 'replace', label: copy.choiceReplace(summarize(part.domain, part.data)) },
    { value: 'skip', label: copy.CHOICE_SKIP },
  ]
}
