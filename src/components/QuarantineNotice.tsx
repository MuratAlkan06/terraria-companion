import { ChevronDown, CircleAlert, CircleCheck, Trash2, X } from 'lucide-react'
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { DOMAIN_LABEL, formatBytes, formatWhen, mergeSummary, nounWith, plainFailure, summarize } from '../app/dataDomains'
import { useQuarantineRecords, useQuarantineStore, useQuarantineVisible } from '../app/quarantineStore'
import { decodeRaw, type DomainKey } from '../storage'
import { canMerge } from '../storage/merge'
import type { QuarantineRecord, RestoreResult } from '../storage/quarantine'
import { cx } from './cx'
import { choiceIntro, choiceMerge, choiceReplace, copyName, DISCARD_ACTION, DISCARD_TITLE, discardBody, discarded, GONE, noticeText, noun, originLine, replaceAction, replaceBody, replaceTitle, restoreMessage } from './quarantineCopy'

/**
 * QuarantineNotice (UX_SPEC §3.1, §5.6; ADR D6; AMENDMENTS-016 B108/B109 → P7-S2): "Some saved data
 * couldn't be read and was set aside (not deleted)", with its actions — the ONE implementation every
 * surface uses (page notices for their own domains, the shell's for app-wide settings / progress /
 * recently viewed, the data page's for all):
 * - View details: per set-aside copy, what it is, where it came from (this browser, or a backup file's
 *   name and date — AMENDMENTS-016 B125(b)), when it was set aside, why it can't be read (checked again
 *   now, plain words + the technical message) and its size; the saved text itself one more tap away.
 * - Try restore: re-reads the copy with this version's decoder. Success puts it back (asking merge or
 *   replace when the domain holds data saved since, each option stating its effect in counts — replace
 *   confirms first, naming both sides); failure keeps it set aside and says why. Outcomes count only
 *   content changes and lead with a copy that stays set aside (B125(a)).
 * - Discard permanently: ConfirmDialog (destructive), then the copy is deleted.
 * One copy: the actions sit on the notice; several: each copy carries its own in the details. A file's
 * part is never described with the surface's sentence about this browser's own data.
 *
 * Shown while copies of `domains` exist (they persist across reloads until restored or discarded), while
 * an outcome for them is on screen, or — where storage can't list its keys (server render, tests) — when
 * the owning store reports a quarantined load (`active`). Outcomes are announced (polite) and take focus
 * when the control that caused them is gone; ConfirmDialog loads on demand (kept out of the shell bundle).
 */
export const QUARANTINE_MESSAGE = 'Some saved data couldn’t be read and was set aside (not deleted).'

const ConfirmDialog = lazy(() => import('./ConfirmDialog').then((m) => ({ default: m.ConfirmDialog })))

const LINK_BUTTON = 'inline-flex min-h-tap items-center gap-1.5 font-semibold text-link underline decoration-1 underline-offset-4 hover:text-accent-strong'

export interface QuarantineNoticeProps {
  domains: readonly DomainKey[]
  /** The owning store's load was quarantined (used where storage can't list its copies). */
  active?: boolean
  /** The surface's own sentence (default: UX_SPEC §5.6's). */
  message?: string
  className?: string
}

export function QuarantineNotice({ domains, active = false, message = QUARANTINE_MESSAGE, className }: QuarantineNoticeProps) {
  const visible = useQuarantineVisible(domains, active)
  return visible ? <QuarantinePanel domains={domains} message={message} className={className} /> : null
}

type Dialog = { kind: 'discard'; record: QuarantineRecord } | { kind: 'replace'; record: QuarantineRecord; here: string; incoming: string }

/** A merge-or-replace choice for one copy: both sides summarized, and what a merge would do. */
interface Choice {
  record: QuarantineRecord
  mergeable: boolean
  here: string
  incoming: string
  merge: string | null
  /** A merge would keep this browser's version of something, so the copy would stay set aside. */
  keepsCopy: boolean
}

function QuarantinePanel({ domains, message, className }: { domains: readonly DomainKey[]; message: string; className?: string }) {
  const records = useQuarantineRecords(domains)
  const outcome = useQuarantineStore((s) => (s.outcome && s.outcome.domains.some((d) => domains.includes(d)) ? s.outcome : null))
  const restore = useQuarantineStore((s) => s.restore)
  const discard = useQuarantineStore((s) => s.discard)
  const setOutcome = useQuarantineStore((s) => s.setOutcome)
  const clearOutcome = useQuarantineStore((s) => s.clearOutcome)
  const source = useId()
  const detailsId = `${source}details`
  const [open, setOpen] = useState(false)
  const [choice, setChoice] = useState<Choice | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const outcomeRef = useRef<HTMLParagraphElement>(null)
  const choiceRef = useRef<HTMLParagraphElement>(null)
  // The dialog was confirmed (focus goes to the outcome) rather than cancelled (back to its trigger).
  const confirmedRef = useRef(false)
  const single = records.length === 1 ? records[0] : null
  // The warning stands while copies exist (or, unlisted, while the store says so) — not beside an outcome that resolved them.
  const warning = records.length > 0 || !outcome

  // A new outcome from this notice takes focus when the control that caused it is gone (restored or
  // discarded copies take their buttons with them); otherwise the polite region announces it.
  useEffect(() => {
    if (!outcome || outcome.source !== source) return
    const active = document.activeElement
    if (!active || active === document.body || !panelRef.current?.contains(active)) outcomeRef.current?.focus()
  }, [outcome, source])

  useEffect(() => {
    if (choice) choiceRef.current?.focus()
  }, [choice])

  const report = (result: RestoreResult, record: QuarantineRecord) => {
    if (!result.ok && result.reason === 'needs-choice') {
      const { domain } = record
      setChoice({
        record,
        mergeable: result.mergeable,
        here: summarize(domain, result.current),
        incoming: summarize(domain, result.incoming),
        merge: result.merge ? mergeSummary(domain, result.merge) : null,
        keepsCopy: (result.merge?.kept ?? 0) > 0,
      })
      return
    }
    setChoice(null)
    setOutcome({ domains: [record.domain], source, ...restoreMessage(result, record.domain, record.origin) })
  }
  const tryRestore = (record: QuarantineRecord) => {
    clearOutcome()
    report(restore(record.key, null), record)
  }
  const openDialog = (next: Dialog) => {
    confirmedRef.current = false
    setDialog(next)
    setDialogOpen(true)
  }
  const confirm = () => {
    if (!dialog) return
    confirmedRef.current = true
    const { record } = dialog
    if (dialog.kind === 'replace') {
      report(restore(record.key, 'replace'), record)
      return
    }
    const removed = discard(record.key)
    setChoice(null)
    setOutcome({ domains: [record.domain], source, tone: removed ? 'done' : 'warn', message: removed ? discarded(record) : GONE })
  }

  // Several copies: each action's name says which copy (one aria-label, so no browser adds a stray space).
  // Discard carries the app's destructive trigger mark (the trash icon, as Clear and Delete do).
  const actions = (record: QuarantineRecord, named: boolean) => (
    <>
      <button type="button" className={LINK_BUTTON} onClick={() => tryRestore(record)} aria-label={named ? `Try restore: ${copyName(record)}` : undefined} data-quarantine-restore="">
        Try restore
      </button>
      <button type="button" className={LINK_BUTTON} onClick={() => openDialog({ kind: 'discard', record })} aria-label={named ? `${DISCARD_ACTION}: ${copyName(record)}` : undefined} data-quarantine-discard="">
        <Trash2 aria-hidden="true" className="size-4 shrink-0" />
        {DISCARD_ACTION}
      </button>
    </>
  )
  const choiceFor = (record: QuarantineRecord) =>
    choice && choice.record.key === record.key ? <RestoreChoice choice={choice} choiceRef={choiceRef} onMerge={() => report(restore(record.key, 'merge'), record)} onReplace={() => openDialog({ kind: 'replace', record, here: choice.here, incoming: choice.incoming })} onCancel={() => setChoice(null)} /> : null

  return (
    <div
      ref={panelRef}
      // Resolved (only a success outcome left): the success tone, not the warning's.
      className={cx('space-y-1 border-2 px-3 py-2 text-sm', !warning && outcome?.tone === 'done' ? 'border-forest-700 bg-forest-900' : 'border-earth-600 bg-earth-900', className)}
      data-quarantine=""
      data-quarantine-domains={domains.join(' ')}
    >
      {warning ? (
        <p role="status" className="flex gap-2 py-1">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-gate" />
          {/* One text run (a single flex item): this browser's copies (the surface's sentence, counted when
              several), then a backup file's parts in their own words. */}
          {noticeText(message, records)}
        </p>
      ) : null}
      {records.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center gap-x-5">
            <button type="button" aria-expanded={open} aria-controls={detailsId} className={cx(LINK_BUTTON, 'group')} onClick={() => setOpen((o) => !o)} data-quarantine-details-toggle="">
              <ChevronDown aria-hidden="true" className={cx('size-4 shrink-0', open && 'rotate-180')} />
              {open ? 'Hide details' : 'View details'}
            </button>
            {single ? actions(single, false) : null}
          </div>
          {single ? choiceFor(single) : null}
          <div id={detailsId} hidden={!open} className="space-y-3 pt-1">
            {open
              ? records.map((record) => (
                  <RecordDetails key={record.key} record={record}>
                    {single ? null : (
                      <>
                        <div className="flex flex-wrap gap-x-5">{actions(record, true)}</div>
                        {choiceFor(record)}
                      </>
                    )}
                  </RecordDetails>
                ))
              : null}
          </div>
        </>
      ) : null}
      {/* Always mounted while the notice is, so a new outcome is announced. */}
      <div role="status">
        {outcome ? (
          <div className={cx('flex items-start gap-2', warning && 'border-t-2 border-earth-600 pt-1')} data-quarantine-outcome={outcome.tone}>
            {outcome.tone === 'done' ? <CircleCheck aria-hidden="true" className="mt-3 size-4 shrink-0 text-success" /> : <CircleAlert aria-hidden="true" className="mt-3 size-4 shrink-0 text-negative" />}
            <p ref={outcomeRef} tabIndex={-1} className="min-w-0 flex-1 py-2 focus:outline-none">
              {outcome.message}
            </p>
            <button type="button" onClick={clearOutcome} className="grid min-h-tap min-w-tap shrink-0 place-items-center text-fg-muted transition-colors duration-(--dur-press) hover:text-fg">
              <X aria-hidden="true" className="size-4" />
              <span className="sr-only">Dismiss</span>
            </button>
          </div>
        ) : null}
      </div>
      {dialog ? (
        <Suspense fallback={null}>
          <ConfirmDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            title={dialog.kind === 'discard' ? DISCARD_TITLE : replaceTitle(dialog.record.domain)}
            description={dialog.kind === 'discard' ? discardBody(dialog.record) : replaceBody(dialog.record.origin, dialog.here, dialog.incoming)}
            confirmLabel={dialog.kind === 'discard' ? DISCARD_ACTION : replaceAction(dialog.record.domain)}
            onConfirm={confirm}
            // Cancelled: back to the button that opened it (Radix's default). Confirmed: that button may be gone — the outcome says what happened.
            returnFocus={() => (confirmedRef.current ? (outcomeRef.current ?? document.getElementById('main')) : null)}
          >
            {dialog.kind === 'discard' ? `Your current ${nounWith(dialog.record.domain, 'isn’t', 'aren’t')} affected.` : canMerge(dialog.record.domain) ? 'Merge keeps both instead.' : null}
          </ConfirmDialog>
        </Suspense>
      ) : null}
    </div>
  )
}

function RestoreChoice({ choice, choiceRef, onMerge, onReplace, onCancel }: { choice: Choice; choiceRef: RefObject<HTMLParagraphElement | null>; onMerge: () => void; onReplace: () => void; onCancel: () => void }) {
  const id = useId()
  const { record } = choice
  return (
    <div role="group" aria-labelledby={id} className="space-y-1 border-l-4 border-gold-600 py-1 pl-3" data-quarantine-choice="">
      <p id={id} ref={choiceRef} tabIndex={-1} className="focus:outline-none">
        {choiceIntro(record.domain, record.origin, choice.here, choice.incoming)}
      </p>
      {/* What each option does, in counts (B125(f)). */}
      <ul className="list-disc space-y-0.5 pl-5" data-quarantine-choice-effects="">
        {choice.mergeable && choice.merge ? <li>{choiceMerge(choice.merge, choice.keepsCopy)}</li> : null}
        <li>{choiceReplace(record.origin, choice.here, choice.incoming)}</li>
      </ul>
      <div className="flex flex-wrap gap-x-5">
        {choice.mergeable ? (
          <button type="button" className={LINK_BUTTON} onClick={onMerge} data-quarantine-merge="">
            Merge
          </button>
        ) : null}
        <button type="button" className={LINK_BUTTON} onClick={onReplace} data-quarantine-replace="">
          Replace current…
        </button>
        <button type="button" className={LINK_BUTTON} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

/** One copy's details: what, where from, when, why (re-checked now), size, and the saved text. */
function RecordDetails({ record, children }: { record: QuarantineRecord; children?: ReactNode }) {
  const decoded = useMemo(() => decodeRaw(record.domain, record.raw), [record.domain, record.raw])
  const text = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(record.raw), null, 2)
    } catch {
      return record.raw
    }
  }, [record.raw])
  const bytes = useMemo(() => new TextEncoder().encode(record.raw).length, [record.raw])
  return (
    <div className="space-y-2 border-t-2 border-earth-600 pt-2" data-quarantine-record={record.key}>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        <dt className="text-fg-muted">What</dt>
        <dd>
          {DOMAIN_LABEL[record.domain]} <span className="text-fg-muted">({formatBytes(bytes)})</span>
        </dd>
        <dt className="text-fg-muted">From</dt>
        <dd data-quarantine-origin={record.origin.kind}>{originLine(record)}</dd>
        <dt className="text-fg-muted">When</dt>
        <dd>{record.at ? `Set aside ${formatWhen(record.at)}` : 'It couldn’t be copied aside (storage may be full), so it is still in place.'}</dd>
        <dt className="text-fg-muted">Why</dt>
        <dd className="space-y-1">
          {decoded.ok ? (
            <p>It reads with this version of the site now — Try restore puts it back.</p>
          ) : (
            <>
              <p>{plainFailure(decoded.failure)}</p>
              <p className="text-fg-muted">
                Checked again just now: <code className="break-words font-mono text-xs">{decoded.failure.message}</code>
              </p>
            </>
          )}
        </dd>
      </dl>
      <details className="group">
        <summary className={cx(LINK_BUTTON, 'cursor-pointer [&::-webkit-details-marker]:hidden')}>
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 group-open:rotate-180" />
          Saved text
        </summary>
        <pre tabIndex={0} aria-label={`Saved text of the set-aside ${noun(record.domain)}`} className="mt-1 max-h-64 overflow-auto border-2 border-earth-600 bg-night-950 p-2 font-mono text-xs wrap-anywhere whitespace-pre-wrap text-fg">
          {text}
        </pre>
      </details>
      {children}
    </div>
  )
}
