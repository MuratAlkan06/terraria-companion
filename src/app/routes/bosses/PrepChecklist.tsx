import { useId } from 'react'
import { PixelPanel } from '../../../components/PixelPanel'
import { QuarantineNotice } from '../../../components/QuarantineNotice'
import { UnknownValue } from '../../../components/UnknownValue'
import type { Boss, SpriteIndex } from '../../../data-access/types'
import { ItemCell, PanelHeading, SourceIconLink } from './BossBits'
import { prepEntries, type ItemInfo } from './bossPageModel'
import { prepChecklistKey, usePrepChecklistStore } from './prepChecklistStore'

/**
 * PrepChecklist (UX_SPEC §3.7, AMENDMENTS-001 A7): the boss's curated prep steps as real checkboxes,
 * persisted to `tc.v1.checklists` under `boss:<slug>:prep` on every change (no save button). Each
 * step cites its wiki source; items a step names are shown as ItemSlots (linked where a page
 * exists). A progress line stays visible at the top of the panel on phones (UX_SPEC §7 "sticky
 * checklist progress"). Unknown checklist → UnknownValue; storage problems are said, not hidden.
 */
const CHECKLISTS_DOMAIN = ['checklists'] as const

export function PrepChecklist({ boss, itemOf, sprites, titleId }: { boss: Boss; itemOf: (id: number) => ItemInfo; sprites: SpriteIndex | null; titleId: string }) {
  const list = prepEntries(boss)
  const key = prepChecklistKey(boss.id)
  const stored = usePrepChecklistStore((s) => s.byKey[key])
  const setChecked = usePrepChecklistStore((s) => s.setChecked)
  const persistError = usePrepChecklistStore((s) => s.persistError)
  const quarantined = usePrepChecklistStore((s) => s.loadStatus === 'quarantined')
  const progressId = useId()

  const entries = list.status === 'curated' ? list.entries : []
  const checked = new Set((stored ?? []).filter((id) => entries.some((e) => e.id === id)))
  const done = checked.size

  return (
    <PixelPanel as="section" aria-labelledby={titleId} data-section="prep" className="space-y-4">
      <PanelHeading id={titleId} curated={list.status === 'curated'}>
        Prep checklist
      </PanelHeading>
      {list.status === 'unknown' ? (
        <p>
          Prep steps: <UnknownValue field="prepChecklist" sourceUrl={boss.wikiUrl} />
        </p>
      ) : list.status === 'none' ? (
        <p className="text-fg-muted">No prep steps are listed for this boss.</p>
      ) : (
        <>
          <div className="sticky top-16 z-(--z-hud) -mx-4 border-y-2 border-panel-border bg-panel px-4 py-2 md:static md:mx-0 md:border-0 md:p-0">
            {/* role="status": polite AND atomic, so a change reads as the whole line ("3 of 8 done"), not just the new number. */}
            <p id={progressId} role="status" className="text-sm font-semibold">
              <span data-prep-progress={`${done}/${entries.length}`}>
                {done} of {entries.length} done
              </span>
              <span className="font-normal text-fg-muted"> · saved on this device</span>
            </p>
            {/* Same bar as the guide checklist (M5): scaleX is compositor-only, width would re-lay out. */}
            <div aria-hidden="true" className="mt-1.5 h-2 border-2 border-panel-border bg-night-950">
              <div data-prep-bar="" className="h-full origin-left bg-gold-500 transition-transform duration-(--dur-ui) ease-out-strong" style={{ transform: `scaleX(${entries.length ? done / entries.length : 0})` }} />
            </div>
          </div>
          {persistError ? (
            <p role="status" className="text-sm text-negative">
              Couldn’t save on this device — your checks are kept for this visit only.
            </p>
          ) : null}
          <QuarantineNotice domains={CHECKLISTS_DOMAIN} active={quarantined} message="Saved checklist data couldn’t be read and was set aside (not deleted)." />
          <ul aria-describedby={progressId} className="space-y-2">
            {entries.map((entry) => {
              const inputId = `${key}-${entry.id}`
              const isChecked = checked.has(entry.id)
              return (
                <li key={entry.id} data-prep-entry={entry.id} data-checked={isChecked ? 'true' : 'false'} className="border-2 border-panel-border bg-night-900 px-3 py-1">
                  <div className="flex items-start gap-2">
                    <label htmlFor={inputId} className="flex min-h-tap flex-1 cursor-pointer items-start gap-3 py-2">
                      <input
                        id={inputId}
                        type="checkbox"
                        checked={isChecked}
                        onChange={(event) => setChecked(key, entry.id, event.currentTarget.checked)}
                        className="mt-0.5 size-5 shrink-0 cursor-pointer accent-gold-500"
                      />
                      <span className={isChecked ? 'text-fg-muted line-through decoration-1' : undefined}>{entry.text}</span>
                    </label>
                    {entry.sourceUrl ? <SourceIconLink href={entry.sourceUrl} srLabel={`Source for “${entry.text}”`} /> : null}
                  </div>
                  {entry.itemIds.length > 0 ? (
                    <ul aria-label={`Items for “${entry.text}”`} className="mb-2 ml-8 flex flex-wrap gap-x-4 gap-y-1">
                      {entry.itemIds.map((id) => (
                        <li key={id}>
                          <ItemCell item={itemOf(id)} sprites={sprites} className="text-sm" />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </PixelPanel>
  )
}
