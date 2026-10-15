import { CircleHelp, Info, Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { EmptyChest } from '../../../../components/art/EmptyChest'
import { buttonClass } from '../../../../components/buttonStyles'
import { EmptyState } from '../../../../components/States'
import type { Weapon } from '../../../../data-access/types'
import { effectiveProgress, type TrackedProgress } from '../../../../scoring/progress'
import { listHref } from '../weapons/weaponNav'
import { COMPARE_MAX } from './compareLinks'
import * as copy from './compareCopy'
import type { CompareData } from './compareData'
import { ADD_BUTTON_ID, classList, columnUnknowns, gatingCell, knownClasses, linkNotices, shownStatKeys, UNKNOWN_HEAVY_MIN, type CompareSelection } from './compareModel'
import { CompareTable } from './CompareTable'

/**
 * The comparison page body (PRD P4-S1; UX_SPEC §3.6, §5): heading, the link's notices, then by state —
 * none picked (guided empty state), one (prompt to add a second, its column already shown), two or
 * three (the table) — with the mixed-class and Unknown-heavy notes above the table and the footnotes
 * below. Pure presentation over the resolved selection; ComparePage owns the URL, data and picker.
 */
export interface CompareViewProps {
  selection: CompareSelection
  /** The selection's weapons that exist, in column order. */
  weapons: readonly Weapon[]
  /** Ids in the link that the dataset doesn't have. */
  missing: readonly number[]
  data: CompareData
  progress: TrackedProgress
  onAdd?: () => void
  onChange?: (weapon: Weapon) => void
  onRemove?: (weapon: Weapon) => void
  /** Polite live-region text after an add / change / remove, or the link's notices (B101d). */
  announcement?: string
  /**
   * The link's notices, when the page keeps them after rewriting the link to its canonical form (B101d);
   * absent: derived from `selection` + `missing`.
   */
  notices?: readonly string[]
}

export function CompareView({ selection, weapons, missing, data, progress, onAdd, onChange, onRemove, announcement, notices: shownNotices }: CompareViewProps) {
  const n = weapons.length
  const notices = shownNotices ?? linkNotices(selection, missing)
  const classes = knownClasses(weapons)
  const statKeys = shownStatKeys(weapons)
  const ep = effectiveProgress(data.graph, progress)
  const heavy = weapons
    .map((w) => ({ w, count: columnUnknowns(w, statKeys, gatingCell(w, data.graph, ep)).length }))
    .filter((x) => x.count >= UNKNOWN_HEAVY_MIN)
  const addButton = (variant: 'primary' | 'secondary') =>
    onAdd ? (
      <button type="button" id={ADD_BUTTON_ID} onClick={onAdd} className={buttonClass(variant)}>
        <Plus aria-hidden="true" className="size-5" />
        {copy.ADD_WEAPON}
      </button>
    ) : null

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6 md:px-6 md:py-8">
      <header className="space-y-2">
        <h1 className="font-display text-base leading-relaxed text-accent text-shadow-pixel md:text-2xl">{copy.PAGE_TITLE}</h1>
        <p className="max-w-prose text-fg-muted">{copy.PAGE_INTRO}</p>
      </header>

      {notices.length > 0 ? (
        <Note icon={<CircleHelp aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-unknown" />} data="link">
          <ul className="space-y-1">
            {notices.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </Note>
      ) : null}

      {n === 0 ? (
        <EmptyState
          titleId="compare-empty-title"
          art={<EmptyChest className="h-auto w-24" />}
          title={copy.EMPTY_TITLE}
          actions={
            <>
              {addButton('primary')}
              <Link to={listHref()} className={buttonClass('secondary')}>
                {copy.BROWSE_WEAPONS}
              </Link>
            </>
          }
        >
          <p>{copy.EMPTY_BODY}</p>
          <p>{copy.EMPTY_HINT}</p>
        </EmptyState>
      ) : (
        <>
          {n === 1 ? (
            <section aria-labelledby="compare-one-title" data-compare-state="one" className="flex flex-col gap-3 border-2 border-dashed border-gold-600 bg-night-900 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <h2 id="compare-one-title" className="font-semibold text-fg">
                  {copy.ONE_TITLE}
                </h2>
                <p className="text-sm text-fg-muted">{copy.ONE_BODY}</p>
              </div>
              {addButton('primary')}
            </section>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-semibold tabular-nums" data-compare-count={n}>
                {copy.countLine(n, COMPARE_MAX)}
              </p>
              {n < COMPARE_MAX ? addButton('secondary') : null}
            </div>
          )}

          {classes.length > 1 ? (
            <Note icon={<Info aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-accent" />} data="mixed-class">
              <p className="font-semibold text-fg">{copy.MIXED_CLASS_TITLE}</p>
              <p>{copy.mixedClassBody(classList(classes))}</p>
            </Note>
          ) : null}
          {heavy.map(({ w, count }) => (
            <Note key={w.id} icon={<CircleHelp aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-unknown" />} data={`unknown-heavy:${w.id}`}>
              <p>{copy.unknownHeavy(w.name, count)}</p>
            </Note>
          ))}

          {n > 1 ? (
            <p aria-hidden="true" className={n > 2 ? 'text-xs text-fg-muted lg:hidden' : 'text-xs text-fg-muted md:hidden'}>
              {copy.swipeHint(n)}
            </p>
          ) : null}
          <CompareTable
            weapons={weapons}
            graph={data.graph}
            conditions={data.conditions}
            sprites={data.sprites}
            progress={progress}
            onChange={onChange}
            onRemove={onRemove}
          />
          <ul className="space-y-1 text-xs text-fg-muted" data-compare-notes="">
            {statKeys.includes('useTime') ? <li>{copy.NOTE_TICKS}</li> : null}
            {statKeys.includes('crit') ? <li>{copy.NOTE_CRIT}</li> : null}
            <li>{copy.PROS_CONS_NOTE}</li>
            <li>{copy.NOTE_NOT_COMPARED}</li>
            <li>{copy.PAGE_LINK_NOTE}</li>
          </ul>
        </>
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  )
}

function Note({ icon, data, children }: { icon: ReactNode; data: string; children: ReactNode }) {
  return (
    <div data-compare-note={data} className="flex gap-3 border-l-4 border-gold-600 bg-night-900 px-4 py-3 text-sm text-fg-muted">
      {icon}
      <div className="min-w-0 space-y-1">{children}</div>
    </div>
  )
}
