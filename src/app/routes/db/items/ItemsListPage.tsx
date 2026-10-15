import { Search, X } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import { EmptyChest } from '../../../../components/art/EmptyChest'
import { buttonClass } from '../../../../components/buttonStyles'
import { cx } from '../../../../components/cx'
import { EntityCard } from '../../../../components/EntityCard'
import { ActiveFilterChips, FilterBar } from '../../../../components/FilterBar'
import { ProvenanceLink } from '../../../../components/ProvenanceLink'
import { asRarity, rarityLabel } from '../../../../components/rarity'
import { SpriteImg } from '../../../../components/SpriteImg'
import { EmptyState, ErrorState, SkeletonList } from '../../../../components/States'
import { UnknownValue } from '../../../../components/UnknownValue'
import { VirtualList } from '../../../../components/VirtualList'
import type { ItemListRecord, SpriteIndex } from '../../../../data-access/types'
import type { ItemCategory } from '../../../../schemas'
import { meta } from '../../../../data/meta'
import { useDelayedFlag, useResource } from '../../../useResource'
import { useDocumentTitle } from '../../../useDocumentTitle'
import { stageLabel } from '../weapons/weaponDisplay'
import * as copy from './itemCopy'
import { CategoryBadge } from './ItemBits'
import { CATEGORY_ICON } from './itemIcons'
import { categoryInfo, ITEM_CATEGORIES } from './itemDisplay'
import {
  activeItemFilterCount,
  applyItemFilters,
  buildItemFacets,
  categoryCounts,
  EMPTY_ITEM_FILTERS,
  MAX_QUERY_LENGTH,
  parseItemFilters,
  toggleItemFilter,
  writeItemFilters,
  type ItemFacetId,
  type ItemFilters,
} from './itemFilters'
import { itemHref, ITEMS_SOURCE_URL, rememberItemListSearch, type FromItemListState } from './itemNav'
import { loadItemListData, peekItemListData, type ItemListData } from './itemsData'

/**
 * /items (P6 encyclopedia, AMENDMENTS-016; UX_SPEC §3.10, §1): the encyclopedia hub — category tiles —
 * and the list of every Item record (window-virtualized EntityCards), filterable by category, game stage
 * and name (combinable, URL-synced, chip-removable). Choosing a category turns the hub into that
 * category's list. States: SkeletonList after 300ms, designed empty state on zero results, ErrorState +
 * Retry. Sprites come from the manifest part each visible row needs (loaded on demand, B104).
 */

const FROM_LIST: FromItemListState = { fromItemList: true }
const TITLE_ID = 'items-title'

export default function ItemsListPage() {
  useDocumentTitle(copy.ITEMS_TITLE)
  const resource = useResource('items-list', loadItemListData, peekItemListData)
  const showSkeleton = useDelayedFlag(resource.status === 'loading')

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 px-4 py-6 md:space-y-5 md:px-6 md:py-8">
      <header className="space-y-2">
        <h1 id={TITLE_ID} tabIndex={-1} className="font-display text-base leading-relaxed text-accent text-shadow-pixel focus:outline-none md:text-2xl">
          {copy.ITEMS_TITLE}
        </h1>
        <p className="max-w-prose text-fg-muted">{copy.listIntro(meta.gameVersion)}</p>
        <div className="flex flex-wrap items-center gap-x-4">
          {/* PRD P6-S1/S2: the other database lists, named as such (the intro says what /items leaves out) */}
          <nav aria-label="Other database lists" className="flex flex-wrap items-center gap-x-3">
            <span className="text-sm text-fg-muted">{copy.OWN_LISTS}</span>
            {copy.OWN_LIST_LINKS.map((l) => (
              <Link key={l.to} to={l.to} className="inline-flex min-h-tap items-center text-sm font-semibold text-link underline decoration-1 underline-offset-4 hover:text-accent-strong">
                {l.label}
              </Link>
            ))}
          </nav>
          <ProvenanceLink href={ITEMS_SOURCE_URL} srContext="for the item list" />
        </div>
      </header>

      {resource.status === 'ready' ? (
        <ItemsBrowser data={resource.data} />
      ) : resource.status === 'error' ? (
        <ErrorState title={copy.LIST_ERROR} error={resource.error} onRetry={resource.retry} retryFocusId={TITLE_ID} />
      ) : showSkeleton ? (
        <SkeletonList label={copy.LIST_LOADING} />
      ) : (
        <div className="min-h-[50dvh]" aria-hidden="true" />
      )}
    </div>
  )
}

function ItemsBrowser({ data }: { data: ItemListData }) {
  const { list, sprites } = data
  const [params, setParams] = useSearchParams()
  const { search } = useLocation()
  const filters = useMemo(() => parseItemFilters(params), [params])
  const results = useMemo(() => applyItemFilters(list, filters), [list, filters])
  const facets = useMemo(() => buildItemFacets(list, filters), [list, filters])
  const counts = useMemo(() => categoryCounts(list), [list])
  const unknownStage = useMemo(() => list.filter((i) => i.stage === undefined).length, [list])
  const hub = activeItemFilterCount(filters) === 0

  useEffect(() => rememberItemListSearch(search), [search])

  const update = useCallback(
    (next: (current: ItemFilters) => ItemFilters) =>
      setParams((prev) => writeItemFilters(prev, next(parseItemFilters(prev))), { replace: true, preventScrollReset: true }),
    [setParams],
  )
  const onToggle = useCallback((facet: string, value: string) => update((f) => toggleItemFilter(f, facet as ItemFacetId, value)), [update])
  const onClearAll = useCallback(() => update(() => EMPTY_ITEM_FILTERS), [update])
  const onQuery = useCallback((q: string) => update((f) => ({ ...f, q })), [update])

  // After a filter change: results back into view if scrolled past; focus the count if the focused control vanished.
  const resultsRef = useRef<HTMLDivElement>(null)
  const statusRef = useRef<HTMLParagraphElement>(null)
  const filterKey = writeItemFilters(new URLSearchParams(), filters).toString()
  const settledKey = useRef(filterKey)
  useEffect(() => {
    if (settledKey.current === filterKey) return
    settledKey.current = filterKey
    const region = resultsRef.current
    if (region && region.getBoundingClientRect().top < 0) region.scrollIntoView({ block: 'start' })
    const focused = document.activeElement
    if (!focused || focused === document.body || !focused.isConnected) statusRef.current?.focus({ preventScroll: true })
  }, [filterKey])

  // FilterBar takes facet selections only (the name filter has its own field and its own chip in the empty state)
  const selected = useMemo(() => ({ category: filters.category, stage: filters.stage }), [filters.category, filters.stage])
  const filterProps = { facets, selected, onToggle, onClearAll }
  const single = filters.category.length === 1 ? categoryInfo(filters.category[0] as ItemCategory) : undefined

  return (
    <>
      {hub ? <CategoryTiles counts={counts} /> : null}

      <section aria-labelledby="items-list-title" className="space-y-3 md:space-y-4">
        <h2 id="items-list-title" className="font-display text-sm leading-relaxed text-accent text-shadow-pixel md:text-base">
          {single ? single.label : copy.ALL_ITEMS_HEADING}
        </h2>
        <NameFilter value={filters.q} onChange={onQuery} />
        <FilterBar {...filterProps} resultCount={results.length} noun="items" showActiveChips={results.length > 0} />

        <div ref={resultsRef} className="scroll-mt-20 space-y-3">
          {/* B113(e): count and legend side by side only from lg — at 768 the legend was a squeezed right-aligned block */}
          <div className="flex flex-col gap-1 lg:flex-row lg:items-baseline lg:justify-between lg:gap-4">
            <p ref={statusRef} tabIndex={-1} role="status" className="font-semibold tabular-nums">
              {copy.resultCount(results.length, list.length)}
            </p>
            <p className="max-w-prose text-sm text-fg-muted lg:max-w-[60%] lg:text-right">
              <UnknownValue field="legend" sourceUrl={ITEMS_SOURCE_URL} /> {copy.UNKNOWN_LEGEND} {copy.stageLegend(unknownStage, list.length)}
            </p>
          </div>

          {results.length > 0 ? (
            <VirtualList
              items={results}
              getKey={(i) => i.id}
              estimateSize={96}
              gap={8}
              restoreKey={`items?${filterKey}`}
              aria-label={single ? single.label : copy.ALL_ITEMS_HEADING}
              renderItem={(i) => <ItemRow item={i} sprites={sprites} />}
            />
          ) : (
            <EmptyState
              titleId="items-empty"
              title={copy.EMPTY_TITLE}
              art={<EmptyChest className="h-auto w-30" />}
              actions={
                <button type="button" onClick={onClearAll} className={buttonClass('primary')}>
                  {copy.CLEAR_ALL}
                </button>
              }
            >
              <p>{copy.emptyBody(activeItemFilterCount(filters))}</p>
              <p>{copy.EMPTY_HINT}</p>
              <ActiveFilterChips {...filterProps} showClearAll={false} className="justify-center pt-2" />
              {filters.q ? (
                <p>
                  <button type="button" onClick={() => onQuery('')} className="inline-flex min-h-tap items-center font-semibold text-link underline decoration-1 underline-offset-4 hover:text-accent-strong">
                    {copy.CLEAR_NAME} (“{filters.q}”)
                  </button>
                </p>
              ) : null}
            </EmptyState>
          )}
        </div>
      </section>
    </>
  )
}

/** The hub: one tile per category with its count (UX_SPEC §7: 2 / 3 / 4 columns). */
function CategoryTiles({ counts }: { counts: ReadonlyMap<string, number> }) {
  const [, setParams] = useSearchParams()
  const tiles = ITEM_CATEGORIES.filter((c) => (counts.get(c.id) ?? 0) > 0)
  return (
    <section aria-labelledby="items-categories-title" className="space-y-3">
      <h2 id="items-categories-title" className="font-display text-sm leading-relaxed text-accent text-shadow-pixel md:text-base">
        {copy.CATEGORY_HEADING}
      </h2>
      <ul className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4 md:gap-3">
        {tiles.map((c) => {
          const Icon = CATEGORY_ICON[c.id]
          return (
            <li key={c.id}>
              <Link
                to={`?${new URLSearchParams({ category: c.id }).toString()}`}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
                  event.preventDefault()
                  setParams(new URLSearchParams({ category: c.id }), { preventScrollReset: true })
                }}
                data-category-tile={c.id}
                className="group flex h-full min-h-tap items-start gap-2 border-2 border-panel-border bg-panel p-2.5 text-fg shadow-pixel transition-colors duration-(--dur-ui) ease-out-strong hover:border-gold-600 md:gap-3 md:p-3"
              >
                <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-accent" />
                <span className="flex min-w-0 flex-col">
                  <span className="font-semibold leading-snug group-hover:text-accent-strong">{c.label}</span>
                  <span className="text-xs text-fg-muted tabular-nums">{(counts.get(c.id) ?? 0).toLocaleString('en-US')} items</span>
                  <span className="mt-0.5 hidden text-xs text-fg-muted md:block">{c.blurb}</span>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** Name filter (`?q=`): every typed word must start a word of the name. Instant, never animated (UX_SPEC §12). */
function NameFilter({ value, onChange }: { value: string; onChange: (q: string) => void }) {
  const id = useId()
  const [text, setText] = useState(value)
  // follow the URL when it changes from elsewhere (Clear all, back navigation)
  const [synced, setSynced] = useState(value)
  if (value !== synced) {
    setSynced(value)
    if (value.trim() !== text.trim()) setText(value)
  }
  return (
    <div className="max-w-md space-y-1">
      <label htmlFor={id} className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
        {copy.NAME_FILTER_LABEL}
      </label>
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-fg-muted" />
        <input
          id={id}
          type="search"
          value={text}
          maxLength={MAX_QUERY_LENGTH}
          placeholder={copy.NAME_FILTER_PLACEHOLDER}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setText(event.target.value)
            onChange(event.target.value)
          }}
          className={cx(
            'min-h-tap w-full border-2 border-panel-border bg-slot py-2 pr-12 pl-10 text-fg shadow-pixel placeholder:text-stone-500',
            'focus-visible:outline-fg focus-visible:ring-2 focus-visible:ring-night-950 [&::-webkit-search-cancel-button]:hidden',
          )}
        />
        {text ? (
          <button
            type="button"
            onClick={() => {
              setText('')
              onChange('')
            }}
            className="absolute top-1/2 right-0 grid min-h-tap min-w-tap -translate-y-1/2 place-items-center text-fg-muted hover:text-fg"
          >
            <X aria-hidden="true" className="size-5" />
            <span className="sr-only">{copy.CLEAR_NAME}</span>
          </button>
        ) : null}
      </div>
    </div>
  )
}

function ItemRow({ item, sprites }: { item: ItemListRecord; sprites: SpriteIndex | null }) {
  const rarity = asRarity(item.rarity)
  return (
    <EntityCard
      to={itemHref(item.id)}
      state={FROM_LIST}
      name={item.name}
      rarity={rarity}
      sprite={<SpriteImg src={item.sprite} sprites={sprites} placeholder="material" box={40} />}
      badges={
        <>
          <CategoryBadge category={item.category} />
          <span className="text-fg-muted">{rarity === undefined ? 'Rarity unknown' : rarityLabel(rarity)}</span>
        </>
      }
      // List records carry no _prov: an absent stage reads as Unknown here; the item page shows the exact status.
      stats={[{ key: 'stage', label: 'Stage', value: item.stage ? stageLabel(item.stage, true) : <UnknownValue field="stage" interactive={false} /> }]}
    />
  )
}
