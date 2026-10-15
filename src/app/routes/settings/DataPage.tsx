import { Check, DatabaseBackup, Download, FileUp, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react'
import { buttonClass } from '../../../components/buttonStyles'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { cx } from '../../../components/cx'
import { PixelPanel } from '../../../components/PixelPanel'
import { QuarantineNotice } from '../../../components/QuarantineNotice'
import { meta } from '../../../data/meta'
import { DOMAIN_KEYS, domainVersion, loadDomain, type DomainData, type DomainKey } from '../../../storage'
import { subscribeStorage } from '../../../storage/events'
import { canMerge } from '../../../storage/merge'
import { applyBackup, BACKUP_MAX_BYTES, byteLength, clearDomain, currentDomainData, defaultChoice, readBackup, readStored, type BackupContents, type ImportChoice, type ImportOutcome, type StoredDomain } from '../../../storage/transfer'
import { DOMAIN_DESCRIPTION, DOMAIN_LABEL, formatWhen, summarize } from '../../dataDomains'
import { useQuarantineStore } from '../../quarantineStore'
import { useDocumentTitle } from '../../useDocumentTitle'
import * as copy from './dataPageCopy'
import { partOptions, prepareBackup, replaceRows, resultCounts, type Current } from './dataPageModel'

/**
 * /settings/data (P7-S2; REQUIREMENTS §12 extras "build export/import"; UX_SPEC §1 `/builds` export/import,
 * §5.6, §5.7, §6, §9): everything this site saved in this browser.
 * - Back up: one JSON file (versioned envelope with the app and game-data versions and the date) holding
 *   the parts picked (all by default), handed to the browser as a download — no network.
 * - Restore from a backup: file picker → every part validated with the load path's decoder → a preview
 *   (what's in the file, counts, dates, versions; what's here) → per part merge / replace / skip → apply.
 *   Replacing data that exists asks first (ConfirmDialog, naming both sides — AMENDMENTS-016 B125(d)).
 *   Unreadable parts are set aside with the file's name and date (B125(b)), never dropped; the result
 *   leads with them, counts only parts whose content changed (B125(a)), and lists every part's outcome,
 *   unknown parts included (B125(c)). Stores refresh live (storage events).
 * - Saved in this browser: each part's contents, size, last save and set-aside copies; Clear
 *   (ConfirmDialog, destructive).
 * - The QuarantineNotice for every domain (the shell's app-wide one steps aside here).
 * Focus: a read error focuses the file field (UX_SPEC §9); the preview and the result take focus at their
 * headings; a clear is announced and focus lands on that part's name.
 */
export const TITLE_ID = 'data-title'

export default function DataPage() {
  useDocumentTitle(copy.DOC_TITLE)
  // Re-read storage whenever it changes (an import, a clear, a restore, a set-aside copy).
  const [version, setVersion] = useState(0)
  useEffect(() => subscribeStorage(() => setVersion((v) => v + 1)), [])
  const stored = useMemo(() => {
    void version
    return DOMAIN_KEYS.map((d) => readStored(d))
  }, [version])
  // A part that can't be read is set aside now, as any load would (it then shows in the notice).
  useEffect(() => {
    for (const s of stored) if (s.state === 'unreadable') loadDomain(s.domain)
  }, [stored])

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 md:py-10">
      <header className="space-y-3">
        <h1 id={TITLE_ID} tabIndex={-1} className="flex items-center gap-3 font-display text-base leading-relaxed text-accent text-shadow-pixel focus:outline-none md:text-2xl">
          <DatabaseBackup aria-hidden="true" className="size-6 shrink-0 md:size-8" />
          {copy.TITLE}
        </h1>
        <p className="max-w-prose text-fg-muted">{copy.INTRO}</p>
      </header>
      <QuarantineNotice domains={DOMAIN_KEYS} />
      <ExportSection stored={stored} />
      <ImportSection />
      <StoredSection stored={stored} />
    </div>
  )
}

const SECTION_TITLE = 'font-display text-sm leading-relaxed text-accent text-shadow-pixel md:text-base'
const LINK_BUTTON = 'inline-flex min-h-tap items-center gap-1.5 font-semibold text-link underline decoration-1 underline-offset-4 hover:text-accent-strong'

// ---------------------------------------------------------------------------------------------
// Back up

/** Hands `text` to the browser as a file download (no network). */
function download(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  // Some browsers start the download asynchronously: keep the URL alive briefly.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function ExportSection({ stored }: { stored: readonly StoredDomain[] }) {
  const readable = stored.filter((s) => s.state === 'readable')
  const [excluded, setExcluded] = useState<ReadonlySet<DomainKey>>(new Set())
  // Tied to the list it was made for: once what's saved changes (a clear, a restore) it no longer describes it.
  const [result, setStatus] = useState<{ tone: 'done' | 'warn'; text: string; list: readonly StoredDomain[] } | null>(null)
  const status = result?.list === stored ? result : null
  const firstBoxRef = useRef<HTMLInputElement>(null)
  const picked = readable.filter((s) => !excluded.has(s.domain)).map((s) => s.domain)

  const onDownload = () => {
    if (picked.length === 0) {
      setStatus({ tone: 'warn', text: copy.EXPORT_NONE_PICKED, list: stored })
      firstBoxRef.current?.focus()
      return
    }
    const { backup, fileName } = prepareBackup(picked)
    try {
      download(backup.json, fileName)
    } catch {
      setStatus({ tone: 'warn', text: copy.EXPORT_FAILED, list: stored })
      return
    }
    const skipped = backup.skipped.map((s) => s.domain)
    setStatus({ tone: 'done', text: [copy.exportDone(fileName, backup.included.length, byteLength(backup.json)), skipped.length ? copy.exportSkipped(skipped) : ''].filter(Boolean).join(' '), list: stored })
  }

  return (
    <PixelPanel as="section" aria-labelledby="data-export-title" className="space-y-3" data-data-export="">
      <h2 id="data-export-title" className={SECTION_TITLE}>
        {copy.EXPORT_TITLE}
      </h2>
      {readable.length === 0 ? (
        <p className="text-fg-muted">{copy.EXPORT_NOTHING}</p>
      ) : (
        <>
          <p className="text-sm text-fg-muted">{copy.EXPORT_INTRO}</p>
          <fieldset className="min-w-0">
            <legend className="sr-only">{copy.EXPORT_LEGEND}</legend>
            <ul className="-mx-2 space-y-0.5">
              {readable.map((s, i) => {
                const id = `data-export-${s.domain}`
                const on = !excluded.has(s.domain)
                return (
                  <li key={s.domain}>
                    <label htmlFor={id} className="flex min-h-tap items-start gap-3 px-2 py-2 transition-colors duration-(--dur-ui) hover:bg-night-700">
                      <span className="relative mt-px grid size-6 shrink-0 place-items-center">
                        <input
                          ref={i === 0 ? firstBoxRef : undefined}
                          id={id}
                          type="checkbox"
                          checked={on}
                          data-export-domain={s.domain}
                          onChange={(event) => {
                            const checked = event.currentTarget.checked
                            setExcluded((prev) => {
                              const next = new Set(prev)
                              if (checked) next.delete(s.domain)
                              else next.add(s.domain)
                              return next
                            })
                          }}
                          className="peer absolute inset-0 m-0 size-6 cursor-pointer appearance-none border-2 border-border-strong bg-night-900 shadow-pixel checked:border-forest-400 checked:bg-primary"
                        />
                        <Check aria-hidden="true" strokeWidth={3} className="pointer-events-none relative size-4 text-primary-fg opacity-0 peer-checked:opacity-100" />
                      </span>
                      <span className="min-w-0 leading-snug">
                        <span className="font-semibold">{DOMAIN_LABEL[s.domain]}</span>
                        <span className="block text-sm text-fg-muted">{s.state === 'readable' ? summarize(s.domain, s.data) : null}</span>
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </fieldset>
          <button type="button" onClick={onDownload} className={buttonClass('primary')} data-export-download="">
            <Download aria-hidden="true" className="size-5" />
            {copy.EXPORT_BUTTON}
          </button>
        </>
      )}
      <p role="status" className={cx('text-sm', status?.tone === 'warn' ? 'text-negative' : 'text-success')} data-export-status="">
        {status?.text ?? ''}
      </p>
    </PixelPanel>
  )
}

// ---------------------------------------------------------------------------------------------
// Restore


type ImportState =
  | { step: 'idle'; error?: string }
  | { step: 'preview'; fileName: string; backup: BackupContents; current: Current; choices: Partial<Record<DomainKey, ImportChoice>> }
  | { step: 'done'; fileName: string; backup: BackupContents; outcomes: ImportOutcome[] }

export function ImportSection() {
  const [state, setState] = useState<ImportState>({ step: 'idle' })
  const [reading, setReading] = useState(false)
  // The replace confirmation's text, kept while it closes (the preview it came from is gone by then).
  const [confirm, setConfirm] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const errorId = useId()

  useEffect(() => {
    if (state.step !== 'idle') headingRef.current?.focus()
  }, [state.step])

  const fail = (error: string) => {
    setState({ step: 'idle', error })
    // UX_SPEC §9: an import error focuses the invalid field.
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    if (file.size > BACKUP_MAX_BYTES) return fail(copy.readError({ kind: 'too-large', bytes: file.size }))
    setReading(true)
    let text: string
    try {
      text = await file.text()
    } catch {
      setReading(false)
      return fail(copy.readError({ kind: 'not-json', message: 'unreadable file' }))
    }
    setReading(false)
    const read = readBackup(text, file.name)
    if (!read.ok) return fail(copy.readError(read.error))
    const current: Current = {}
    const choices: Partial<Record<DomainKey, ImportChoice>> = {}
    for (const part of read.backup.parts) {
      if (part.status !== 'valid') continue
      current[part.domain] = currentDomainData(part.domain)
      choices[part.domain] = defaultChoice(part.domain, current[part.domain] !== null)
    }
    setState({ step: 'preview', fileName: file.name, backup: read.backup, current, choices })
  }

  const apply = () => {
    if (state.step !== 'preview') return
    const outcomes = applyBackup(state.backup, state.choices)
    setState({ step: 'done', fileName: state.fileName, backup: state.backup, outcomes })
  }

  const reset = () => {
    setState({ step: 'idle' })
    if (inputRef.current) inputRef.current.value = ''
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const error = state.step === 'idle' ? state.error : undefined
  return (
    <PixelPanel as="section" aria-labelledby="data-import-title" className="space-y-3" data-data-import="">
      <h2 id="data-import-title" className={SECTION_TITLE}>
        {copy.IMPORT_TITLE}
      </h2>
      <p className="text-sm text-fg-muted">{copy.IMPORT_INTRO}</p>
      {state.step === 'idle' ? (
        <div className="space-y-2">
          <label htmlFor="data-import-file" className="flex items-center gap-2 font-semibold">
            <FileUp aria-hidden="true" className="size-4 text-accent" />
            {copy.IMPORT_FILE_LABEL}
          </label>
          <input
            ref={inputRef}
            id="data-import-file"
            type="file"
            accept=".json,application/json"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => void onFile(event.currentTarget.files?.[0])}
            data-import-file=""
            className={cx(
              'block w-full min-w-0 cursor-pointer text-sm text-fg-muted',
              'file:mr-3 file:min-h-tap file:cursor-pointer file:border-2 file:border-border-strong file:bg-surface-raised file:px-4 file:font-semibold file:text-fg file:shadow-pixel hover:file:bg-night-700',
              error && 'outline-2 outline-offset-2 outline-negative outline-solid',
            )}
          />
          <p role="status" className="text-sm text-fg-muted">
            {reading ? copy.IMPORT_READING : ''}
          </p>
          {error ? (
            <p id={errorId} role="alert" className="text-sm text-negative" data-import-error="">
              {error}
            </p>
          ) : null}
        </div>
      ) : state.step === 'preview' ? (
        <ImportPreview
          fileName={state.fileName}
          backup={state.backup}
          current={state.current}
          choices={state.choices}
          headingRef={headingRef}
          onChoice={(domain, choice) => setState({ ...state, choices: { ...state.choices, [domain]: choice } })}
          onApply={() => {
            const rows = replaceRows(state.backup, state.current, state.choices)
            if (rows.length === 0) return apply()
            setConfirm(copy.confirmBody(rows))
            setConfirmOpen(true)
          }}
          onCancel={reset}
        />
      ) : (
        <ImportResult backup={state.backup} outcomes={state.outcomes} headingRef={headingRef} onReset={reset} />
      )}
      {confirm !== null ? (
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={copy.CONFIRM_TITLE}
          description={confirm}
          confirmLabel={copy.CONFIRM_ACTION}
          onConfirm={apply}
          // Confirmed: the result's heading; cancelled: the preview's (Restore stays where it was, just below).
          returnFocus={() => headingRef.current}
        >
          {copy.CONFIRM_EXTRA}
        </ConfirmDialog>
      ) : null}
    </PixelPanel>
  )
}

const RADIO_CARD = cx(
  'flex min-h-tap cursor-pointer items-center gap-3 border-2 px-3 py-1.5 text-sm',
  'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring peer-focus-visible:outline-solid',
)

export interface ImportPreviewProps {
  fileName: string
  backup: BackupContents
  current: Current
  choices: Partial<Record<DomainKey, ImportChoice>>
  headingRef?: RefObject<HTMLHeadingElement | null>
  onChoice: (domain: DomainKey, choice: ImportChoice) => void
  onApply: () => void
  onCancel: () => void
}

export function ImportPreview({ fileName, backup, current, choices, headingRef, onChoice, onApply, onCancel }: ImportPreviewProps) {
  const anyMerge = backup.parts.some((p) => p.status === 'valid' && current[p.domain] && canMerge(p.domain))
  return (
    <section aria-labelledby="data-preview-title" className="space-y-3 border-t-2 border-panel-border pt-3" data-import-preview="">
      <h3 id="data-preview-title" ref={headingRef} tabIndex={-1} className="font-semibold break-words focus:outline-none">
        {copy.previewTitle(fileName)}
      </h3>
      <p className="text-sm text-fg-muted">{copy.previewMade(formatWhen(backup.exportedAt), backup.app, backup.appVersion, backup.gameVersion)}</p>
      {backup.gameVersion !== meta.gameVersion ? <p className="text-sm text-fg-muted">{copy.previewGameMismatch(backup.gameVersion, meta.gameVersion)}</p> : null}
      {backup.unknown.length > 0 ? <p className="text-sm" data-import-unknown="">{copy.previewUnknown(backup.unknown)}</p> : null}
      {backup.parts.length === 0 ? <p>{copy.PREVIEW_EMPTY}</p> : null}
      {anyMerge ? <p className="text-sm text-fg-muted">{copy.MERGE_RULE}</p> : null}
      <ul className="space-y-3">
        {backup.parts.map((part) => (
          <li key={part.domain} className="border-2 border-panel-border bg-night-900 p-3" data-import-part={part.domain} data-import-status={part.status}>
            {part.status === 'valid' ? (
              <fieldset className="min-w-0 space-y-2">
                <legend className="font-semibold">{DOMAIN_LABEL[part.domain]}</legend>
                <p className="text-sm">
                  {copy.inFile(summarize(part.domain, part.data), formatWhen(part.savedAt))}
                  {part.v < domainVersion(part.domain) ? copy.migratedNote(part.v, domainVersion(part.domain)) : null}
                </p>
                <p className="text-sm text-fg-muted">{copy.inBrowser(current[part.domain] ? summarize(part.domain, current[part.domain] as DomainData<DomainKey>) : null)}</p>
                <div className="grid gap-1.5">
                  {partOptions(part, current[part.domain]).map((option) => {
                    const id = `data-choice-${part.domain}-${option.value}`
                    const on = choices[part.domain] === option.value
                    return (
                      <div key={option.value} className="relative">
                        <input type="radio" id={id} name={`data-choice-${part.domain}`} value={option.value} checked={on} onChange={() => onChoice(part.domain, option.value)} className="peer sr-only" data-import-choice={option.value} />
                        <label htmlFor={id} className={cx(RADIO_CARD, on ? 'border-gold-500 bg-night-800 text-fg' : 'border-panel-border bg-panel text-fg-muted hover:border-border-strong')}>
                          <span aria-hidden="true" className={cx('grid size-4 shrink-0 place-items-center rounded-full border-2', on ? 'border-gold-400' : 'border-border-strong')}>
                            {on ? <span className="size-2 rounded-full bg-gold-400" /> : null}
                          </span>
                          {option.label}
                        </label>
                      </div>
                    )
                  })}
                </div>
              </fieldset>
            ) : (
              <div className="space-y-1">
                <p className="font-semibold">{DOMAIN_LABEL[part.domain]}</p>
                <p className="text-sm">{copy.invalidPart(part.failure)}</p>
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-3">
        {backup.parts.length > 0 ? (
          <button type="button" onClick={onApply} className={buttonClass('primary')} data-import-apply="">
            <RotateCcw aria-hidden="true" className="size-5" />
            {copy.APPLY}
          </button>
        ) : null}
        <button type="button" onClick={onCancel} className={buttonClass('secondary')} data-import-cancel="">
          {copy.CANCEL}
        </button>
      </div>
    </section>
  )
}

export function ImportResult({ backup, outcomes, headingRef, onReset }: { backup: BackupContents; outcomes: readonly ImportOutcome[]; headingRef?: RefObject<HTMLHeadingElement | null>; onReset: () => void }) {
  const counts = resultCounts(outcomes)
  const fileSummary = (domain: DomainKey) => {
    const part = backup.parts.find((p) => p.domain === domain)
    return part?.status === 'valid' ? summarize(domain, part.data) : undefined
  }
  return (
    <section aria-labelledby="data-result-title" className="space-y-3 border-t-2 border-panel-border pt-3" data-import-result="">
      <h3 id="data-result-title" ref={headingRef} tabIndex={-1} className="font-semibold focus:outline-none">
        {copy.RESULT_TITLE}
      </h3>
      <p className="text-sm" data-import-headline="">
        {copy.resultIntro(counts.changed, counts.setAside, counts.failed)}
      </p>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {outcomes.map((o) => (
          <li key={o.domain} data-import-outcome={o.outcome} data-domain={o.domain} data-import-changed={'changed' in o ? String(o.changed) : undefined} className={o.outcome === 'failed' || o.outcome === 'set-aside' ? 'text-negative' : undefined}>
            {copy.outcomeLine(o, fileSummary(o.domain))}
          </li>
        ))}
        {backup.unknown.length > 0 ? <li data-import-outcome="unknown">{copy.resultUnknown(backup.unknown)}</li> : null}
      </ul>
      <button type="button" onClick={onReset} className={buttonClass('secondary')} data-import-again="">
        <FileUp aria-hidden="true" className="size-5" />
        {copy.CHOOSE_ANOTHER}
      </button>
    </section>
  )
}

// ---------------------------------------------------------------------------------------------
// Saved in this browser

export function StoredSection({ stored }: { stored: readonly StoredDomain[] }) {
  const records = useQuarantineStore((s) => s.records)
  // The part being cleared and its summary, kept while the dialog closes (the row changes underneath).
  const [clearing, setClearing] = useState<{ domain: DomainKey; summary: string } | null>(null)
  const [open, setOpen] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const clearedRef = useRef<DomainKey | null>(null)
  const setAsideBytes = records.reduce((n, r) => n + byteLength(r.raw), 0)

  const onConfirm = () => {
    if (!clearing) return
    const ok = clearDomain(clearing.domain)
    clearedRef.current = ok ? clearing.domain : null
    setAnnouncement(ok ? copy.cleared(clearing.domain) : copy.CLEAR_FAILED)
  }

  return (
    <PixelPanel as="section" aria-labelledby="data-stored-title" className="space-y-3" data-data-stored="">
      <h2 id="data-stored-title" className={SECTION_TITLE}>
        {copy.STORED_TITLE}
      </h2>
      <p className="text-sm text-fg-muted">{copy.STORED_INTRO}</p>
      <ul className="divide-y-2 divide-panel-border border-y-2 border-panel-border">
        {stored.map((s) => (
          <li key={s.domain} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2" data-stored-domain={s.domain} data-stored-state={s.state}>
            <div className="min-w-0 flex-1 basis-56">
              <p id={`data-stored-${s.domain}`} tabIndex={-1} className="font-semibold focus:outline-none">
                {DOMAIN_LABEL[s.domain]}
              </p>
              <p className="text-sm text-fg-muted">{DOMAIN_DESCRIPTION[s.domain]}</p>
              <p className="text-sm tabular-nums">
                {copy.withCopies(s.state === 'none' ? copy.NOTHING_SAVED : s.state === 'readable' ? copy.storedLine(summarize(s.domain, s.data), s.bytes, formatWhen(s.savedAt)) : copy.unreadableLine(s.bytes), records.filter((r) => r.domain === s.domain).length)}
              </p>
            </div>
            {s.state === 'readable' ? (
              <button
                type="button"
                onClick={() => {
                  clearedRef.current = null
                  setClearing({ domain: s.domain, summary: summarize(s.domain, s.data) })
                  setOpen(true)
                }}
                className={cx(LINK_BUTTON, 'shrink-0')}
                data-clear-domain={s.domain}
              >
                <Trash2 aria-hidden="true" className="size-4" />
                {copy.CLEAR_BUTTON}
                <span className="sr-only"> {DOMAIN_LABEL[s.domain]}</span>
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {records.length > 0 ? <p className="text-sm text-fg-muted">{copy.quarantineCount(records.length, setAsideBytes)}</p> : null}
      <p role="status" className="sr-only" data-clear-status="">
        {announcement}
      </p>
      {clearing ? (
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title={copy.clearTitle(clearing.domain)}
          description={copy.clearBody(clearing.domain, clearing.summary)}
          confirmLabel={copy.clearAction(clearing.domain)}
          onConfirm={onConfirm}
          // Confirmed: the part's Clear button is gone (nothing saved) — land on its name. Cancelled: back to Clear.
          returnFocus={() => (clearedRef.current ? document.getElementById(`data-stored-${clearedRef.current}`) : null)}
        >
          {copy.CLEAR_EXTRA}
        </ConfirmDialog>
      ) : null}
    </PixelPanel>
  )
}
