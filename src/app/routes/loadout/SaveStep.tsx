import { CircleAlert, Columns3, FolderOpen, Save, Trash2 } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router'
import { buttonClass } from '../../../components/buttonStyles'
import { PixelPanel } from '../../../components/PixelPanel'
import { SendToLabButton } from '../../../components/SendToLabButton'
import type { Weapon } from '../../../data-access/types'
import { BUILD_NAME_MAX, type SavedBuild } from '../../../storage/builds'
import { getStageInfo } from '../../stages'
import { hasRoute } from '../../routes'
import { compareHref } from '../db/compare/compareLinks'
import * as copy from './loadoutCopy'
import { LABEL, FIELD } from './LoadoutBits'

/**
 * Step 4 — save (PRD P4-S2 scope "save/load named builds"; UX_SPEC §3.5 Step4, §4(c), §5.6, §5.7, §6):
 * name the loadout and save it to this browser (tc.v1.builds). Editing a saved build: "Save changes"
 * overwrites it, "Save as copy" forks it, and an "Unsaved changes" line says when the draft differs.
 * The button itself is the confirmation ("Saved ✓" for 2 s, then "Save as copy"). Saved builds are
 * listed with Open and Delete (ConfirmDialog, destructive). Next steps: compare the loadout's weapons
 * and test the main one in the Weapon Lab.
 */
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
  onDelete: (build: SavedBuild) => void
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
  const save = (mode: 'overwrite' | 'new') => {
    const trimmed = name.trim()
    if (trimmed === '') {
      setError(true)
      document.getElementById(`${id}name`)?.focus()
      return
    }
    setError(false)
    const finalName = mode === 'new' && editing && trimmed === editing.name ? copy.copyName(trimmed) : trimmed
    props.onSave(finalName, mode)
    setName(finalName)
    setFlash(true)
  }
  const sorted = [...props.builds].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name))
  return (
    <div className="space-y-5" data-step-body="4">
      {props.loadStatus === 'quarantined' ? (
        <p role="status" className="flex gap-2 border-2 border-earth-600 bg-earth-900 p-2 text-sm" data-quarantine="">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-gate" />
          {copy.QUARANTINE_NOTICE}
        </p>
      ) : null}
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
        </div>
      </PixelPanel>

      {props.weaponIds.length > 0 ? (
        <PixelPanel as="section" aria-labelledby={`${id}next`} className="space-y-3">
          <h3 id={`${id}next`} className="font-display text-sm leading-relaxed text-accent text-shadow-pixel md:text-base">
            {copy.NEXT_STEPS}
          </h3>
          <div className="flex flex-wrap items-center gap-3">
            {hasRoute('compare') ? (
              <Link to={compareHref(props.weaponIds)} className={buttonClass('secondary')} data-compare-link="">
                <Columns3 aria-hidden="true" className="size-5" />
                {copy.COMPARE_WEAPONS}
              </Link>
            ) : null}
            {props.mainWeapon ? <SendToLabButton weapon={props.mainWeapon} /> : null}
          </div>
          <p className="text-xs text-fg-muted">{copy.COMPARE_HINT}</p>
        </PixelPanel>
      ) : null}

      <PixelPanel as="section" aria-labelledby={`${id}saved`} className="space-y-3" data-saved-builds="">
        <h3 id={`${id}saved`} className="font-display text-sm leading-relaxed text-accent text-shadow-pixel md:text-base">
          {copy.SAVED_TITLE}
        </h3>
        {sorted.length === 0 ? (
          <p className="text-sm text-fg-muted">{copy.SAVED_EMPTY}</p>
        ) : (
          <ul className="grid gap-2">
            {sorted.map((b) => (
              <li key={b.buildId} data-build={b.buildId} className="grid gap-2 border-2 border-panel-border bg-night-900 p-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-x-3">
                <div className="min-w-0">
                  <p className="font-semibold break-words">{b.name}</p>
                  <p className="text-xs text-fg-muted">{copy.buildMeta(copy.CLASS_NAMES[b.class], getStageInfo(b.stage).label, copy.DIFFICULTY_NAMES[b.difficulty], b.goal ? copy.GOAL_NAMES[b.goal] : undefined)}</p>
                  <p className="text-xs text-fg-muted">{copy.updatedOn(dateText(b.updatedAt))}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Link to={props.openHref(b)} aria-label={copy.openSr(b.name)} className={buttonClass('secondary', 'min-h-tap px-3 text-sm')} data-open={b.buildId}>
                    <FolderOpen aria-hidden="true" className="size-4" />
                    {copy.OPEN}
                  </Link>
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
