import { Check, CircleAlert } from 'lucide-react'
import { cx } from '../../../components/cx'
import { PixelPanel } from '../../../components/PixelPanel'
import { getStageInfo } from '../../stages'
import { checkedIn, progressLabel, useChecklistStore, type ChecklistProgress, type ChecklistState } from './checklistStore'
import { checklistKey, type Guide } from './guideModel'

/**
 * A guide's interactive checklist (PRD P6-S8 AC3; UX_SPEC §3.10): native checkboxes, every change
 * saved to tc.v1.checklists at once (no save button). Independent of the guide's link data, so it
 * works while that loads. A stored payload that couldn't be read was set aside by the storage
 * module; the panel says so (UX_SPEC §5.6 wording) instead of silently starting over.
 */
export const CHECKLIST_ID = 'guide-checklist'
const TITLE_ID = 'guide-checklist-title'

export const QUARANTINE_NOTICE = 'Some saved data couldn’t be read and was set aside (not deleted).'
export const PERSIST_ERROR_NOTICE = 'Couldn’t save to this browser’s storage. Your checks stay until you leave or reload the page.'

/** Thin pixel progress bar (decorative: the text label carries the value). */
export function ProgressBar({ done, total, className }: ChecklistProgress & { className?: string }) {
  return (
    <span aria-hidden="true" className={cx('block h-2 border border-panel-border bg-night-950', className)}>
      <span
        className="block h-full origin-left bg-forest-400 transition-transform duration-(--dur-ui) ease-out-strong"
        style={{ transform: `scaleX(${total === 0 ? 0 : done / total})` }}
      />
    </span>
  )
}

export function GuideChecklist({ guide, className }: { guide: Guide; className?: string }) {
  const byKey = useChecklistStore((s) => s.byKey)
  const loadStatus = useChecklistStore((s) => s.loadStatus)
  const persistError = useChecklistStore((s) => s.persistError)
  const setChecked = useChecklistStore((s) => s.setChecked)
  return (
    <ChecklistView
      guide={guide}
      byKey={byKey}
      quarantined={loadStatus === 'quarantined'}
      persistError={persistError}
      onChange={(entryId, checked) => setChecked(checklistKey(guide.slug), entryId, checked)}
      className={className}
    />
  )
}

export interface ChecklistViewProps {
  guide: Guide
  byKey: ChecklistState['byKey']
  quarantined: boolean
  persistError: boolean
  onChange: (entryId: string, checked: boolean) => void
  className?: string
}

/** The checklist panel itself, driven by props (the container above binds it to the store). */
export function ChecklistView({ guide, byKey, quarantined, persistError, onChange, className }: ChecklistViewProps) {
  const checked = checkedIn(
    byKey,
    checklistKey(guide.slug),
    guide.checklist.map((entry) => entry.id),
  )
  const progress = { done: checked.size, total: guide.checklist.length }
  const complete = progress.done === progress.total

  return (
    <PixelPanel as="section" id={CHECKLIST_ID} aria-labelledby={TITLE_ID} className={cx('scroll-mt-24 space-y-3', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={TITLE_ID} className="font-display text-sm leading-relaxed text-accent text-shadow-pixel">
          Checklist
        </h2>
        <p role="status" className={cx('inline-flex items-center gap-1.5 text-sm font-semibold tabular-nums', complete ? 'text-success' : 'text-fg')}>
          {complete ? <Check aria-hidden="true" className="size-4" strokeWidth={3} /> : null}
          {progressLabel(progress)}
        </p>
      </div>
      <ProgressBar {...progress} />
      {quarantined ? (
        <p role="status" className="flex gap-2 border-2 border-earth-600 bg-earth-900 p-2 text-sm">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-gate" />
          {QUARANTINE_NOTICE}
        </p>
      ) : null}
      <ul className="-mx-2 space-y-0.5">
        {guide.checklist.map((entry) => {
          const isChecked = checked.has(entry.id)
          const inputId = `check-${guide.slug}-${entry.id}`
          return (
            <li key={entry.id}>
              <label
                htmlFor={inputId}
                className="flex min-h-tap items-start gap-3 px-2 py-2.5 transition-colors duration-(--dur-ui) hover:bg-night-700"
              >
                <span className="relative mt-px grid size-6 shrink-0 place-items-center">
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={isChecked}
                    data-entry={entry.id}
                    onChange={(event) => onChange(entry.id, event.currentTarget.checked)}
                    className="peer absolute inset-0 m-0 size-6 cursor-pointer appearance-none border-2 border-border-strong bg-night-900 shadow-pixel checked:border-forest-400 checked:bg-primary"
                  />
                  <Check
                    aria-hidden="true"
                    strokeWidth={3}
                    className="pointer-events-none relative size-4 text-primary-fg opacity-0 peer-checked:opacity-100"
                  />
                </span>
                <span className={cx('leading-snug', isChecked && 'text-fg-muted line-through decoration-1')}>{entry.text}</span>
              </label>
            </li>
          )
        })}
      </ul>
      {persistError ? (
        <p role="status" className="flex gap-2 text-sm text-negative">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {PERSIST_ERROR_NOTICE}
        </p>
      ) : null}
      <p className="text-xs text-fg-muted">Saved in this browser only, for this guide.</p>
    </PixelPanel>
  )
}

/** Game-stage band chip: "Early Pre-Hardmode", or a range "Early Pre-HM → Late Pre-HM". */
export function StageBand({ stages, short = false, className }: { stages: Guide['stages']; short?: boolean; className?: string }) {
  const first = getStageInfo(stages[0])
  const last = getStageInfo(stages[stages.length - 1])
  const label = (info: typeof first) => (short ? info.shortLabel : info.label)
  return (
    <span
      className={cx(
        'inline-flex flex-wrap items-center gap-x-1 border-2 border-stone-600 bg-night-900 px-1.5 text-xs leading-5 font-semibold text-fg',
        className,
      )}
    >
      <span className="sr-only">Game stage: </span>
      <span className="whitespace-nowrap">{label(first)}</span>
      {last.id !== first.id ? (
        <>
          <span aria-hidden="true">→</span>
          <span className="sr-only"> to </span>
          <span className="whitespace-nowrap">{label(last)}</span>
        </>
      ) : null}
    </span>
  )
}
