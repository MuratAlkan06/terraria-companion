import { CircleAlert, ClipboardCopy, ClipboardList, Columns2, Columns3, Dices, FolderOpen, List, Save, Trash2 } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router'
import { buttonClass } from '../../../components/buttonStyles'
import { PixelPanel } from '../../../components/PixelPanel'
import { QuarantineNotice } from '../../../components/QuarantineNotice'
import { SendToLabButton } from '../../../components/SendToLabButton'
import type { Weapon } from '../../../data-access/types'
import type { BuilderResult, Pins } from '../../../scoring/recommend'
import { BUILD_NAME_MAX, type SavedBuild } from '../../../storage/builds'
import { getStageInfo } from '../../stages'
import { hasRoute } from '../../routes'
import type { ReadinessPageData } from '../bosses/readiness/readinessData'
import { readinessBuildHref } from '../bosses/readiness/readinessLinks'
import { compareHref } from '../db/compare/compareLinks'
import * as text from './buildTextCopy'
import { ComparePanel } from './ComparePanel'
import type { SavedRun } from './loadoutCompare'
import * as copy from './loadoutCopy'
import { FixedPicksWarning, LABEL, FIELD } from './LoadoutBits'
import { BUILDS_VIEW_HREF, type EffectiveInputs } from './loadoutModel'

/**
 * Step 4 — Compare & Save (PRD P4-S4; UX_SPEC §3.5 Step4 CompareView, §4(c), §5.6, §5.7, §6):
 * - Save: name the loadout and save it to this browser (tc.v1.builds). Editing a saved build: "Save
 *   changes" overwrites it, "Save as copy" forks it, and an "Unsaved changes" line says when the draft
 *   differs. The button itself is the confirmation ("Saved ✓" for 2 s, then "Save as copy").
 * - Export as text (P7-S2b, ADR D6): this loadout with the name above, saved or not — what Save would write —
 *   as the readable build text with its `#code:` line (the page's BuildExportDialog).
 * - Compare: the draft beside a saved build (ComparePanel — profile, goal fit, slot by slot).
 * - Surprise Me (AC3, SCORING_SPEC §4.8): a random stage-legal loadout for the same inputs, warned
 *   before it replaces fixed picks and said after.
 * - Take it further: compare the weapons, test the main one in the Lab, and analyze the saved build in
 *   the readiness checker (B106 queue: `/readiness?build=`).
 * - The saved builds, each with Open, Compare, Analyze and Delete (ConfirmDialog, destructive), and the
 *   full list (`?view=builds`).
 */
const BUILDS_DOMAIN = ['builds'] as const

export interface SaveStepProps {
  builds: readonly SavedBuild[]
  loadStatus: 'loaded' | 'empty' | 'quarantined'
  persistError: boolean
  /** The saved build the draft edits (absent: a new one). */
  editing?: SavedBuild
  /** The link names a build this browser doesn't have. */
  editingMissing: boolean
  unsaved: boolean
  defaultName: string
  weaponIds: readonly number[]
  mainWeapon?: Weapon
  openHref: (build: SavedBuild) => string
  onSave: (name: string, mode: 'overwrite' | 'new') => void
  /**
   * Opens the text export of this loadout under `name` (the page owns the dialog). `from`: the pressed button,
   * where focus returns when the export closes (Safari doesn't focus a clicked button).
   */
  onExport: (name: string, from?: HTMLElement) => void
  onDelete: (build: SavedBuild) => void
  /** The comparison (P4-S4): the data, the draft, and the compared build scored as saved. */
  compare?: {
    page: ReadinessPageData
    draft: { result: BuilderResult; pins: Pins; eff: EffectiveInputs }
    saved?: SavedRun
    vsMissing: boolean
    onCompare: (buildId: string | undefined) => void
  }
  /** The saved-builds list for this draft (`?view=builds` with the draft kept, so the list's way back returns to it). */
  buildsHref?: string
  /** Surprise Me (AC3): `fixedPicks` it would replace; `drawn`: the visible notice after a draw (null: none). */
  surprise?: { fixedPicks: number; drawn: string | null; seeHref: string; onSurprise: () => void }
}

/** How long the button says "Saved ✓" (UX_SPEC §4(c)). */
export const SAVED_FLASH_MS = 2000

const dateText = (iso: string) => new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })

export function SaveStep(props: SaveStepProps) {
  const id = useId()
  const { editing } = props
  const [name, setName] = useState(editing?.name ?? props.defaultName)
  const [error, setError] = useState(false)
  const [flash, setFlash] = useState(false)
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(false), SAVED_FLASH_MS)
    return () => clearTimeout(t)
  }, [flash])
  /** The name, or undefined after saying it's required (focus moves to the field). */
  const checkedName = (): string | undefined => {
    const trimmed = name.trim()
    if (trimmed === '') {
      setError(true)
      document.getElementById(`${id}name`)?.focus()
      return undefined
    }
    setError(false)
    return trimmed
  }
  const save = (mode: 'overwrite' | 'new') => {
    const trimmed = checkedName()
    if (trimmed === undefined) return
    const finalName = mode === 'new' && editing && trimmed === editing.name ? copy.copyName(trimmed) : trimmed
    props.onSave(finalName, mode)
    setName(finalName)
    setFlash(true)
  }
  const sorted = [...props.builds].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name))
  const readiness = hasRoute('readiness')
  const surpriseWarnId = `${id}surprise-warning`
  return (
    <div className="space-y-5" data-step-body="4">
      <QuarantineNotice domains={BUILDS_DOMAIN} active={props.loadStatus === 'quarantined'} message={copy.QUARANTINE_NOTICE} />
      {props.persistError ? (
        <p role="status" className="flex gap-2 text-sm text-negative" data-persist-error="">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {copy.PERSIST_ERROR_NOTICE}
        </p>
      ) : null}
      <PixelPanel as="section" aria-labelledby={`${id}save`} className="space-y-4">
        <div className="space-y-1">
          <h3 id={`${id}save`} className="font-display text-sm leading-relaxed text-accent text-shadow-pixel md:text-base">
            {copy.SAVE_TITLE}
          </h3>
          <p className="text-sm text-fg-muted">{copy.SAVE_INTRO}</p>
        </div>
        {props.editingMissing ? <p className="text-sm text-fg-muted" data-build-missing="">{copy.BUILD_MISSING}</p> : null}
        {editing ? (
          <p className="text-sm" data-editing={editing.buildId}>
            {copy.editing(editing.name)} <span className={props.unsaved ? 'font-semibold text-accent' : 'text-fg-muted'} data-unsaved={props.unsaved ? '' : undefined}>{props.unsaved ? copy.UNSAVED : copy.UP_TO_DATE}</span>
          </p>
        ) : null}
        <div className="max-w-md space-y-1">
          <label htmlFor={`${id}name`} className={LABEL}>
            {copy.NAME_LABEL}
          </label>
          <input
            id={`${id}name`}
            type="text"
            value={name}
            maxLength={BUILD_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={error || undefined}
            aria-describedby={error ? `${id}name-error` : undefined}
            className={FIELD}
          />
          {error ? (
            <p id={`${id}name-error`} className="text-sm text-negative">
              {copy.NAME_REQUIRED}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {editing ? (
            <>
              <button type="button" onClick={() => save('overwrite')} className={buttonClass('primary')} data-save="overwrite">
                <Save aria-hidden="true" className="size-5" />
                {flash ? copy.SAVED : copy.SAVE_CHANGES}
              </button>
              <button type="button" onClick={() => save('new')} className={buttonClass('secondary')} data-save="copy">
                {copy.SAVE_COPY}
              </button>
            </>
          ) : (
            <button type="button" onClick={() => save('new')} className={buttonClass('primary')} data-save="new">
              <Save aria-hidden="true" className="size-5" />
              {flash ? copy.SAVED : copy.SAVE}
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              const trimmed = checkedName()
              if (trimmed !== undefined) props.onExport(trimmed, e.currentTarget)
            }}
            aria-describedby={`${id}export-hint`}
            className={buttonClass('secondary')}
            data-export-draft=""
          >
            <ClipboardCopy aria-hidden="true" className="size-5" />
            {text.EXPORT_DRAFT}
          </button>
        </div>
        <p id={`${id}export-hint`} className="text-xs text-fg-muted">
          {text.EXPORT_DRAFT_HINT}
        </p>
      </PixelPanel>

      {props.compare ? (
        <ComparePanel
          page={props.compare.page}
          builds={props.builds}
          draft={props.compare.draft}
          {...(props.compare.saved ? { saved: props.compare.saved } : {})}
          vsMissing={props.compare.vsMissing}
          {...(editing ? { editingId: editing.buildId } : {})}
          onCompare={props.compare.onCompare}
          openHref={props.openHref}
        />
      ) : null}

      {props.surprise ? (
        <PixelPanel as="section" aria-labelledby={`${id}surprise`} className="space-y-3" data-surprise-panel="">
          <h3 id={`${id}surprise`} className="font-display text-sm leading-relaxed text-accent text-shadow-pixel md:text-base">
            {copy.SURPRISE_TITLE}
          </h3>
          <p className="text-sm text-fg-muted">{copy.SURPRISE_INTRO}</p>
          {props.surprise.fixedPicks > 0 ? <FixedPicksWarning id={surpriseWarnId} text={copy.surpriseWarning(props.surprise.fixedPicks)} /> : null}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={props.surprise.onSurprise} aria-describedby={props.surprise.fixedPicks > 0 ? surpriseWarnId : undefined} className={buttonClass('secondary')} data-surprise="">
              <Dices aria-hidden="true" className="size-5" />
              {props.surprise.drawn ? copy.SURPRISE_AGAIN : copy.SURPRISE}
            </button>
            {props.surprise.drawn ? (
              <Link to={props.surprise.seeHref} className="inline-flex min-h-tap items-center px-1 text-sm font-semibold text-link underline decoration-1 underline-offset-4 hover:text-accent-strong" data-surprise-see="">
                {copy.SURPRISE_SEE}
              </Link>
            ) : null}
          </div>
          {props.surprise.drawn ? (
            <p className="border-l-4 border-gold-600 bg-night-900 px-3 py-2 text-sm" data-surprise-drawn="">
              {props.surprise.drawn}
            </p>
          ) : null}
        </PixelPanel>
      ) : null}

      <PixelPanel as="section" aria-labelledby={`${id}next`} className="space-y-3">
        <h3 id={`${id}next`} className="font-display text-sm leading-relaxed text-accent text-shadow-pixel md:text-base">
          {copy.NEXT_STEPS}
        </h3>
        <div className="flex flex-wrap items-center gap-3">
          {hasRoute('compare') && props.weaponIds.length > 0 ? (
            <Link to={compareHref(props.weaponIds)} className={buttonClass('secondary')} data-compare-link="">
              <Columns3 aria-hidden="true" className="size-5" />
              {copy.COMPARE_WEAPONS}
            </Link>
          ) : null}
          {props.mainWeapon ? <SendToLabButton weapon={props.mainWeapon} /> : null}
          {readiness && editing ? (
            <Link to={readinessBuildHref(editing.buildId)} aria-label={copy.analyzeBuildSr(editing.name)} className={buttonClass('secondary')} data-readiness-import={editing.buildId}>
              <ClipboardList aria-hidden="true" className="size-5" />
              {copy.ANALYZE_BUILD}
            </Link>
          ) : null}
        </div>
        {props.weaponIds.length > 0 && hasRoute('compare') ? <p className="text-xs text-fg-muted">{copy.COMPARE_HINT}</p> : null}
        {readiness ? (
          <p className="text-xs text-fg-muted" data-readiness-hint="">
            {editing ? (props.unsaved ? `${copy.ANALYZE_HINT} ${copy.ANALYZE_SAVED_VERSION}` : copy.ANALYZE_HINT) : copy.ANALYZE_SAVE_FIRST}
          </p>
        ) : null}
      </PixelPanel>

      <PixelPanel as="section" aria-labelledby={`${id}saved`} className="space-y-3" data-saved-builds="">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h3 id={`${id}saved`} className="font-display text-sm leading-relaxed text-accent text-shadow-pixel md:text-base">
            {copy.SAVED_TITLE}
          </h3>
          {sorted.length > 0 ? (
            <Link to={props.buildsHref ?? BUILDS_VIEW_HREF} className="inline-flex min-h-tap items-center gap-1.5 text-sm font-semibold text-link underline decoration-1 underline-offset-4 hover:text-accent-strong" data-all-builds="">
              <List aria-hidden="true" className="size-4" />
              {copy.ALL_BUILDS}
            </Link>
          ) : null}
        </div>
        {sorted.length === 0 ? (
          <p className="text-sm text-fg-muted">{copy.SAVED_EMPTY}</p>
        ) : (
          <ul className="grid gap-2">
            {sorted.map((b) => (
              <li key={b.buildId} data-build={b.buildId} className="grid gap-2 border-2 border-panel-border bg-night-900 p-2.5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-x-3">
                <div className="min-w-0">
                  <p className="font-semibold break-words">{b.name}</p>
                  <p className="text-xs text-fg-muted">{copy.buildMeta(copy.CLASS_NAMES[b.class], getStageInfo(b.stage).label, copy.DIFFICULTY_NAMES[b.difficulty], b.goal ? copy.GOAL_NAMES[b.goal] : undefined)}</p>
                  <p className="text-xs text-fg-muted">{copy.updatedOn(dateText(b.updatedAt))}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={props.openHref(b)} aria-label={copy.openSr(b.name)} className={buttonClass('secondary', 'min-h-tap px-3 text-sm')} data-open={b.buildId}>
                    <FolderOpen aria-hidden="true" className="size-4" />
                    {copy.OPEN}
                  </Link>
                  {props.compare ? (
                    <button type="button" onClick={() => props.compare?.onCompare(b.buildId)} aria-label={copy.compareThisSr(b.name)} className={buttonClass('secondary', 'min-h-tap px-3 text-sm')} data-compare-build={b.buildId}>
                      <Columns2 aria-hidden="true" className="size-4" />
                      {copy.COMPARE_THIS}
                    </button>
                  ) : null}
                  {readiness ? (
                    <Link to={readinessBuildHref(b.buildId)} aria-label={copy.analyzeBuildSr(b.name)} className={buttonClass('secondary', 'min-h-tap px-3 text-sm')} data-analyze={b.buildId}>
                      <ClipboardList aria-hidden="true" className="size-4" />
                      {copy.ANALYZE}
                    </Link>
                  ) : null}
                  <button type="button" onClick={() => props.onDelete(b)} aria-label={copy.deleteSr(b.name)} className="inline-flex min-h-tap min-w-tap items-center justify-center gap-1.5 border-2 border-panel-border bg-panel px-3 text-sm font-semibold text-fg hover:bg-night-700" data-delete={b.buildId}>
                    <Trash2 aria-hidden="true" className="size-4" />
                    {copy.DELETE}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </PixelPanel>
    </div>
  )
}
