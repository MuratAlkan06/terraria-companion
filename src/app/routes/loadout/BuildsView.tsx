import { ArrowLeft, Backpack, CircleAlert, ClipboardList, FolderOpen, Trash2 } from 'lucide-react'
import { Link } from 'react-router'
import { buttonClass } from '../../../components/buttonStyles'
import { InventoryGrid } from '../../../components/InventoryGrid'
import { PixelPanel } from '../../../components/PixelPanel'
import { buildItemIds, type SavedBuild } from '../../../storage/builds'
import { hasRoute } from '../../routes'
import { getStageInfo } from '../../stages'
import type { ReadinessPageData } from '../bosses/readiness/readinessData'
import { readinessBuildHref } from '../bosses/readiness/readinessLinks'
import * as copy from './loadoutCopy'
import { ItemSquare } from './LoadoutBits'
import { LOADOUT_PATH } from './loadoutModel'

/**
 * The saved-builds list (PRD P4-S4 AC4; UX_SPEC §1 `/builds` — shipped as the builder's `?view=builds`
 * sub-view, no route of its own): every build saved in this browser, newest first, each with its inputs,
 * an equip preview of the slots AS SAVED (sprites + Terraria tooltips), Open, Analyze (the readiness
 * checker's import) and Delete (ConfirmDialog, destructive — owned by the page). Export / import is
 * P7-S2. Empty: the designed one-line invitation with a single call to action (UX_SPEC §5.2).
 */
export interface BuildsViewProps {
  page: ReadinessPageData
  builds: readonly SavedBuild[]
  loadStatus: 'loaded' | 'empty' | 'quarantined'
  persistError: boolean
  headingId: string
  backHref: string
  openHref: (build: SavedBuild) => string
  onDelete: (build: SavedBuild) => void
}

const dateText = (iso: string) => new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })

export function BuildsView(props: BuildsViewProps) {
  const sorted = [...props.builds].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name))
  const readiness = hasRoute('readiness')
  return (
    <section aria-labelledby={props.headingId} className="space-y-4" data-builds-view="">
      <Link to={props.backHref} className="inline-flex min-h-tap items-center gap-1.5 text-sm font-semibold text-link underline decoration-1 underline-offset-4 hover:text-accent-strong" data-builds-back="">
        <ArrowLeft aria-hidden="true" className="size-4" />
        {copy.BUILDS_BACK}
      </Link>
      <div className="space-y-1">
        <h2 id={props.headingId} tabIndex={-1} className="font-display text-sm leading-relaxed text-accent text-shadow-pixel focus:outline-none md:text-lg">
          {copy.BUILDS_TITLE}
        </h2>
        <p className="text-sm text-fg-muted">{copy.BUILDS_INTRO}</p>
        {sorted.length > 0 ? <p className="text-sm text-fg-muted" data-builds-count={sorted.length}>{copy.buildsCount(sorted.length)}</p> : null}
      </div>
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
      {sorted.length === 0 ? (
        <div className="flex flex-col gap-3 border-2 border-dashed border-panel-border bg-surface p-4 md:flex-row md:items-center md:justify-between md:gap-6" data-builds-empty="">
          <p className="flex items-center gap-3 text-fg-muted">
            <Backpack aria-hidden="true" className="size-5 shrink-0 text-accent" />
            {copy.BUILDS_EMPTY}
          </p>
          <Link to={LOADOUT_PATH} className={buttonClass('secondary', 'shrink-0 self-start md:self-auto')}>
            {copy.BUILDS_EMPTY_CTA}
          </Link>
        </div>
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
          {sorted.map((b) => {
            const ids = buildItemIds(b)
            const boss = b.targetBoss ? (props.page.engine.bosses.get(b.targetBoss)?.name ?? b.targetBoss) : undefined
            return (
              <li key={b.buildId} className="min-w-0" data-build-card={b.buildId}>
                <PixelPanel as="article" padded={false} aria-labelledby={`build-${b.buildId}`} className="flex h-full flex-col gap-3 p-3 md:p-4">
                  <div className="min-w-0">
                    <h3 id={`build-${b.buildId}`} className="font-semibold break-words">
                      {b.name}
                    </h3>
                    <p className="text-xs text-fg-muted">{copy.buildMeta(copy.CLASS_NAMES[b.class], getStageInfo(b.stage).label, copy.DIFFICULTY_NAMES[b.difficulty], b.goal ? copy.GOAL_NAMES[b.goal] : undefined)}</p>
                    {boss ? <p className="text-xs text-fg-muted">{copy.madeFor(boss)}</p> : null}
                    <p className="text-xs text-fg-muted">{copy.updatedOn(dateText(b.updatedAt))}</p>
                  </div>
                  {ids.length > 0 ? (
                    <InventoryGrid label={copy.previewLabel(b.name)} columns={10}>
                      {ids.map((id, i) => (
                        <ItemSquare key={`${id}-${i}`} page={props.page} id={id} />
                      ))}
                    </InventoryGrid>
                  ) : (
                    <p className="text-sm text-fg-muted">{copy.PREVIEW_EMPTY}</p>
                  )}
                  <div className="mt-auto flex flex-wrap items-center gap-2">
                    <Link to={props.openHref(b)} aria-label={copy.openSr(b.name)} className={buttonClass('secondary', 'min-h-tap px-3 text-sm')} data-open={b.buildId}>
                      <FolderOpen aria-hidden="true" className="size-4" />
                      {copy.OPEN}
                    </Link>
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
                </PixelPanel>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
