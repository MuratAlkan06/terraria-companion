import { Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { EmptyChest } from '../../../components/art/EmptyChest'
import { buttonClass } from '../../../components/buttonStyles'
import { cx } from '../../../components/cx'
import { ActiveFilterChips, FilterBar } from '../../../components/FilterBar'
import type { SpriteIndex, Weapon } from '../../../data-access/types'
import { labScopeNouns } from '../../../lab/labWeapons'
import {
  activeLabFilterCount,
  buildLabFacets,
  EMPTY_LAB_FILTERS,
  filterRows,
  INITIAL_BROWSER_STATE,
  isLabFacetId,
  LAB_FACET_IDS,
  labFacetValues,
  queryWords,
  searchInputId,
  simulatedCount,
  toggleLabFilter,
  type LabBrowserRow,
  type LabBrowserState,
} from './browserModel'
import { WeaponPicker } from './WeaponPicker'

/**
 * LabBrowserPanel (PRD P3-S2 AC1/AC2, UX_SPEC §3.4): search + FilterBar (class, stage, rarity,
 * source, damage) over every weapon in the dataset, without leaving the arena. Simulated rows equip
 * when chosen; the others show their LimitationCard (never a broken equip). The search text and
 * filters live with the Lab page (`state`), so they survive the panel collapsing, the phone sheet
 * closing and weapon changes. Filtering is instant and never animated (UX_SPEC §12).
 */
export interface LabBrowserProps {
  rows: readonly LabBrowserRow[]
  state: LabBrowserState
  onStateChange: (next: LabBrowserState) => void
  selectedId: number
  equippedId: number
  sprites: SpriteIndex | null
  onSelect: (weapon: Weapon) => void
  onCommit?: (weapon: Weapon) => void
  /** Unique per instance (desktop panel vs mobile sheet). */
  name: string
  focusRequest?: { id: number; nonce: number } | null
  /**
   * Show the intro line on screen (default). The phone sheet's own one-line description says the
   * same, so there it is for screen readers only — it still describes the list.
   */
  introVisible?: boolean
}

export function LabBrowser({ rows, state, onStateChange, selectedId, equippedId, sprites, onSelect, onCommit, name, focusRequest, introVisible = true }: LabBrowserProps) {
  const { query, filters } = state
  const valid = useMemo(() => labFacetValues(rows), [rows])
  const results = useMemo(() => filterRows(rows, filters, query), [rows, filters, query])
  const facets = useMemo(() => buildLabFacets(rows, filters, query), [rows, filters, query])
  const simulated = simulatedCount(results)
  const scopeId = `${name}-scope`
  const statusId = `${name}-status`

  const onToggle = (facet: string, value: string) => {
    if (isLabFacetId(facet)) onStateChange({ query, filters: toggleLabFilter(filters, facet, value, valid[facet]) })
  }
  const onClearAll = () => onStateChange({ query, filters: EMPTY_LAB_FILTERS })
  const clearEverything = () => {
    onStateChange(INITIAL_BROWSER_STATE)
    document.getElementById(searchInputId(name))?.focus()
  }
  const filtered = query.trim() !== '' || activeLabFilterCount(filters) > 0
  // New results get a fresh scroller and list, starting at the top (a virtualizer re-measuring a
  // shrunken list keeps adjusting from its old offset); only the first list centres the selected row.
  const resultsKey = [queryWords(query).join(' '), ...LAB_FACET_IDS.map((id) => filters[id].join(','))].join('|')
  const [mountedKey] = useState(resultsKey)

  return (
    // The header (search, filters, count) stays put; the list scrolls on its own below it. The
    // container (side panel / bottom sheet) gives this a definite height.
    <div className="flex h-full min-h-0 flex-col gap-3" data-lab-browser="">
      <div className="shrink-0 space-y-3">
      <p id={scopeId} className={introVisible ? 'text-xs text-fg-muted' : 'sr-only'}>
        Choose a <span className="font-semibold text-fg">Simulated</span> weapon to equip it; any other shows why it isn’t simulated
        <span className="sr-only"> (so far the Lab simulates {labScopeNouns()})</span>.
      </p>

      <div role="search" className="relative">
        <label htmlFor={searchInputId(name)} className="sr-only">
          Search weapons by name
        </label>
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted" />
        <input
          id={searchInputId(name)}
          type="search"
          value={query}
          onChange={(event) => onStateChange({ query: event.target.value, filters })}
          placeholder={`Search ${rows.length} weapons`}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={statusId}
          className={cx(
            'min-h-tap w-full border-2 border-border-strong bg-surface-sunken py-2 pr-11 pl-9 text-base text-fg placeholder:text-fg-muted',
            '[&::-webkit-search-cancel-button]:hidden',
          )}
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              onStateChange({ query: '', filters })
              document.getElementById(searchInputId(name))?.focus()
            }}
            className="absolute top-0 right-0 grid size-tap place-items-center text-fg-muted hover:text-fg"
          >
            <X aria-hidden="true" className="size-4" />
            <span className="sr-only">Clear the search</span>
          </button>
        ) : null}
      </div>

      <FilterBar
        layout="disclosure"
        facets={facets}
        selected={filters}
        onToggle={onToggle}
        onClearAll={onClearAll}
        resultCount={results.length}
        noun="weapons"
        showActiveChips={results.length > 0}
      />

      <p id={statusId} role="status" className="text-sm font-semibold tabular-nums" data-lab-browser-status="">
        {filtered ? `Showing ${results.length} of ${rows.length} weapons` : `${rows.length} weapons`}
        <span className="font-normal text-fg-muted">
          {' · '}
          <span data-count="simulated">{simulated}</span> simulated
          {' · '}
          <span data-count="not-simulated">{results.length - simulated}</span> not simulated
        </span>
      </p>
      </div>

      {results.length > 0 ? (
        <div key={resultsKey} className="-mx-1 min-h-48 flex-1 overflow-y-auto overscroll-contain px-1 py-1" data-lab-browser-list="">
        <WeaponPicker
          rows={results}
          selectedId={selectedId}
          equippedId={equippedId}
          sprites={sprites}
          onSelect={onSelect}
          onCommit={onCommit}
          name={name}
          describedBy={scopeId}
          focusRequest={focusRequest}
          fallbackFocusId={searchInputId(name)}
          centerSelected={resultsKey === mountedKey}
        />
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 border-2 border-panel-border bg-panel p-4 text-center" data-lab-browser-empty="">
          <EmptyChest className="h-auto w-20" />
          <p className="font-semibold">No weapons match</p>
          <p className="text-sm text-fg-muted">
            {query.trim() ? `Nothing named like “${query.trim()}”` : 'Nothing'}
            {activeLabFilterCount(filters) > 0 ? ' with these filters.' : '.'}
          </p>
          <ActiveFilterChips facets={facets} selected={filters} onToggle={onToggle} onClearAll={onClearAll} showClearAll={false} className="justify-center" />
          <button type="button" onClick={clearEverything} className={buttonClass('primary')}>
            Clear search and filters
          </button>
        </div>
      )}
    </div>
  )
}
