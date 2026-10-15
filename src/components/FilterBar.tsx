import { Check, ChevronDown, SlidersHorizontal, X } from 'lucide-react'
import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { BottomSheet } from './BottomSheet'
import { buttonClass } from './buttonStyles'
import { cx } from './cx'
import { showResults } from './filterBarCopy'
import { PixelPanel } from './PixelPanel'

/**
 * FilterBar (UX_SPEC §3.1, §7): combinable facets (OR within a facet, AND across facets),
 * removable active chips, "Clear all". From md the facets sit inline — collapsed behind a
 * "Filters" disclosure at md (768–1023, so results show on the first screen), always open from
 * lg; below md they move into a "Filters" bottom sheet and only the active chips stay inline.
 * Filter application is instant and never animated (UX_SPEC §12). Every toggle is a real button
 * with aria-pressed; selection shows a gold frame AND a check glyph (not colour alone); keyboard
 * focus is a separate dark ring + cream outline, so focused never looks like selected (as on the
 * stage chips, design review N4).
 *
 * `layout="disclosure"` is for narrow containers that are already a panel or a sheet (the Lab's
 * weapon browser, UX_SPEC §3.4): the md–lg disclosure at every width — never a sheet inside a sheet,
 * never facets that push the results off a 300px panel.
 */

/** Focus treatment shared with StageSelector: distinct from the gold "selected" frame. */
const CHIP_FOCUS = 'focus-visible:outline-fg focus-visible:ring-2 focus-visible:ring-night-950'
export interface FacetOption {
  value: string
  label: string
  /** Matching results if this option were selected (given the other facets). */
  count: number
  /** Optional label colour (e.g. a rarity token); the label text always carries the meaning. */
  color?: string
}

export interface Facet {
  id: string
  label: string
  options: readonly FacetOption[]
}

export type FacetSelection = Readonly<Record<string, readonly string[]>>

export interface FilterBarProps {
  facets: readonly Facet[]
  selected: FacetSelection
  onToggle: (facetId: string, value: string) => void
  onClearAll: () => void
  /** Results after filtering, for the sheet's "Show N" button. */
  resultCount: number
  /** Plural noun for counts, e.g. "weapons" (a regular plural: "Show 1 weapon" drops its "s" — filterBarCopy). */
  noun: string
  /** Show the active-chip row under the bar (pages hide it when an empty state shows the chips). */
  showActiveChips?: boolean
  /** `responsive` (default): sheet < md, disclosure md–lg, open ≥ lg. `disclosure`: a disclosure at every width. */
  layout?: 'responsive' | 'disclosure'
}

function activeFilters(facets: readonly Facet[], selected: FacetSelection) {
  return facets.flatMap((facet) =>
    (selected[facet.id] ?? []).map((value) => ({
      facet,
      value,
      option: facet.options.find((o) => o.value === value),
    })),
  )
}

export function FilterBar({ facets, selected, onToggle, onClearAll, resultCount, noun, showActiveChips = true, layout = 'responsive' }: FilterBarProps) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const panelId = useId()
  const active = activeFilters(facets, selected)
  const disclosure = layout === 'disclosure'

  return (
    <div className="space-y-3">
      {/* < md: Filters button opens the sheet */}
      {disclosure ? null : (
        <div className="md:hidden">
          <FilterSheet
            open={sheetOpen}
            onOpenChange={setSheetOpen}
            facets={facets}
            selected={selected}
            onToggle={onToggle}
            onClearAll={onClearAll}
            resultCount={resultCount}
            noun={noun}
            activeCount={active.length}
          />
        </div>
      )}

      {/* md–lg (every width in disclosure layout): the inline facets collapse behind a disclosure (closed by default) */}
      <div className={disclosure ? undefined : 'hidden md:block lg:hidden'}>
        <button
          type="button"
          aria-expanded={panelOpen}
          aria-controls={panelId}
          onClick={() => setPanelOpen((open) => !open)}
          className={buttonClass('secondary', 'w-full justify-between')}
        >
          <span className="inline-flex items-center gap-2">
            <SlidersHorizontal aria-hidden="true" className="size-5" />
            Filters
          </span>
          <span className="inline-flex items-center gap-2 text-sm text-fg-muted tabular-nums">
            {active.length > 0 ? `${active.length} active` : 'None active'}
            <ChevronDown aria-hidden="true" className={cx('size-5 text-fg', panelOpen && 'rotate-180')} />
          </span>
        </button>
      </div>

      {/* md+: inline facets (always shown from lg) */}
      <PixelPanel
        id={panelId}
        padded={!disclosure}
        className={disclosure ? cx('space-y-4 p-3', !panelOpen && 'hidden') : cx('hidden space-y-4 lg:block', panelOpen && 'md:block')}
      >
        {facets.map((facet) => (
          <FacetGroup key={facet.id} facet={facet} selected={selected[facet.id] ?? []} onToggle={onToggle} />
        ))}
      </PixelPanel>

      {showActiveChips ? (
        <ActiveFilterChips facets={facets} selected={selected} onToggle={onToggle} onClearAll={onClearAll} />
      ) : null}
    </div>
  )
}

/** Removable chips for every active filter + "Clear all". Renders nothing when no filter is active. */
export function ActiveFilterChips({
  facets,
  selected,
  onToggle,
  onClearAll,
  showClearAll = true,
  className,
}: Pick<FilterBarProps, 'facets' | 'selected' | 'onToggle' | 'onClearAll'> & { showClearAll?: boolean; className?: string }) {
  const active = activeFilters(facets, selected)
  // Keyboard users keep their place: after a chip is removed, focus the chip that took its slot.
  // (When the last chip goes, this row unmounts and the page moves focus to its result count.)
  const listRef = useRef<HTMLUListElement>(null)
  const pendingFocus = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (pendingFocus.current === null) return
    const chips = listRef.current?.querySelectorAll<HTMLButtonElement>('button')
    if (chips && chips.length > 0) chips[Math.min(pendingFocus.current, chips.length - 1)].focus()
    pendingFocus.current = null
  }, [active.length])

  if (active.length === 0) return null
  return (
    <div className={cx('flex flex-wrap items-center gap-2', className)}>
      <span className="text-sm text-fg-muted">Active filters:</span>
      <ul ref={listRef} className="contents">
        {active.map(({ facet, value, option }, index) => (
          <li key={`${facet.id}:${value}`}>
            <button
              type="button"
              onClick={() => {
                pendingFocus.current = index
                onToggle(facet.id, value)
              }}
              className={cx(
                'inline-flex min-h-tap items-center gap-1.5 border-2 border-gold-600 bg-slot px-3 text-sm font-semibold shadow-pixel hover:bg-night-800',
                CHIP_FOCUS,
              )}
            >
              <span className="text-fg-muted">{facet.label}:</span>
              <span style={option?.color ? { color: option.color } : undefined}>{option?.label ?? value}</span>
              <X aria-hidden="true" className="size-4 shrink-0" />
              <span className="sr-only">(remove filter)</span>
            </button>
          </li>
        ))}
      </ul>
      {showClearAll ? (
        <button
          type="button"
          onClick={onClearAll}
          className="inline-flex min-h-tap items-center px-2 text-sm font-semibold text-link underline decoration-1 underline-offset-4 hover:text-accent-strong"
        >
          Clear all
        </button>
      ) : null}
    </div>
  )
}

function FacetGroup({
  facet,
  selected,
  onToggle,
}: {
  facet: Facet
  selected: readonly string[]
  onToggle: (facetId: string, value: string) => void
}) {
  const labelId = useId()
  return (
    <div role="group" aria-labelledby={labelId} className="space-y-2">
      <p id={labelId} className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
        {facet.label}
      </p>
      <ul className="flex flex-wrap gap-2">
        {facet.options.map((option) => {
          const pressed = selected.includes(option.value)
          const labelStyle: CSSProperties | undefined = option.color ? { color: option.color } : undefined
          return (
            <li key={option.value}>
              <button
                type="button"
                aria-pressed={pressed}
                onClick={() => onToggle(facet.id, option.value)}
                className={cx(
                  'inline-flex min-h-tap items-center gap-2 border-2 px-3 text-sm font-semibold shadow-pixel',
                  'transition-transform duration-(--dur-press) ease-out-strong active:scale-[0.97]',
                  CHIP_FOCUS,
                  // Never a lighter-than-night-800 fill: rarity label colours need it for 4.5:1.
                  pressed ? 'border-slot-selected bg-slot shadow-slot-selected' : 'border-panel-border bg-slot hover:border-border-strong',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cx(
                    'grid size-4 shrink-0 place-items-center border-2',
                    pressed ? 'border-gold-300 bg-gold-500' : 'border-stone-500',
                  )}
                >
                  {pressed ? <Check className="size-3 text-fg-on-accent" strokeWidth={3} /> : null}
                </span>
                <span style={labelStyle}>{option.label}</span>
                <span className={cx('tabular-nums', option.count === 0 ? 'text-stone-500' : 'text-fg-muted')}>
                  {option.count.toLocaleString('en-US')}
                  <span className="sr-only">{option.count === 1 ? ' result' : ' results'}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function FilterSheet({
  open,
  onOpenChange,
  facets,
  selected,
  onToggle,
  onClearAll,
  resultCount,
  noun,
  activeCount,
}: FilterBarProps & { open: boolean; onOpenChange: (open: boolean) => void; activeCount: number }) {
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Filters"
      description="Combine any filters — the list updates as you choose."
      trigger={
        <button type="button" className={buttonClass('secondary', 'w-full justify-between')}>
          <span className="inline-flex items-center gap-2">
            <SlidersHorizontal aria-hidden="true" className="size-5" />
            Filters
          </span>
          <span className="text-sm text-fg-muted tabular-nums">
            {activeCount > 0 ? `${activeCount} active` : 'None active'}
          </span>
        </button>
      }
      footer={
        <>
          <button
            type="button"
            onClick={onClearAll}
            disabled={activeCount === 0}
            className="inline-flex min-h-tap items-center px-2 font-semibold text-link underline decoration-1 underline-offset-4 hover:text-accent-strong disabled:text-stone-500 disabled:no-underline"
          >
            Clear all
          </button>
          <button type="button" onClick={() => onOpenChange(false)} className={buttonClass('primary')}>
            {showResults(resultCount, noun)}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {facets.map((facet) => (
          <FacetGroup key={facet.id} facet={facet} selected={selected[facet.id] ?? []} onToggle={onToggle} />
        ))}
      </div>
    </BottomSheet>
  )
}
