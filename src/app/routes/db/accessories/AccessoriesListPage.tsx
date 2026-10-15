import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useLocation, useSearchParams } from 'react-router'
import { EmptyChest } from '../../../../components/art/EmptyChest'
import { buttonClass } from '../../../../components/buttonStyles'
import { EntityCard } from '../../../../components/EntityCard'
import { ActiveFilterChips, FilterBar } from '../../../../components/FilterBar'
import { ProvenanceLink } from '../../../../components/ProvenanceLink'
import { asRarity, rarityLabel } from '../../../../components/rarity'
import { SpriteImg } from '../../../../components/SpriteImg'
import { EmptyState, ErrorState, SkeletonList } from '../../../../components/States'
import { UnknownValue } from '../../../../components/UnknownValue'
import { VirtualList } from '../../../../components/VirtualList'
import type { Accessory, SpriteIndex } from '../../../../data-access/types'
import { meta } from '../../../../data/meta'
import { getField } from '../../../../schemas/getField'
import { useDelayedFlag, useResource } from '../../../useResource'
import { useDocumentTitle } from '../../../useDocumentTitle'
import { NameFilter } from '../armor/EquipmentBits'
import { stageLabel } from '../weapons/weaponDisplay'
import * as copy from './accessoryCopy'
import { loadAccessoryData, peekAccessoryData, type AccessoryData } from './accessoryData'
import {
  activeAccessoryFilterCount,
  buildAccessoryFacets,
  categoryBuckets,
  categoryLabel,
  EMPTY_ACCESSORY_FILTERS,
  matchesAccessory,
  MAX_QUERY_LENGTH,
  parseAccessoryFilters,
  toggleAccessoryFilter,
  verifiedStage,
  writeAccessoryFilters,
  type AccessoryFacetId,
  type AccessoryFilters,
} from './accessoryModel'
import { ACCESSORIES_SOURCE_URL, accessoryHref, rememberAccessoryListSearch, type FromAccessoryListState } from './accessoryNav'

/**
 * /accessories (PRD P6-S2 AC1; UX_SPEC §1): every accessory in a window-virtualized list of EntityCards, filterable
 * by category (mobility / defense / offense / utility — curated; "Unknown" where the data has none),
 * game stage and name (combinable, URL-synced, chip-removable). Rows read each record's own `_prov`: a stage shows
 * only where verified. States: SkeletonList after 300ms, designed empty state, ErrorState + Retry.
 */

const FROM_LIST: FromAccessoryListState = { fromAccessoryList: true }
const TITLE_ID = 'accessories-title'

export default function AccessoriesListPage() {
  useDocumentTitle(copy.ACCESSORIES_TITLE)
  const resource = useResource('accessory-data', loadAccessoryData, peekAccessoryData)
  const showSkeleton = useDelayedFlag(resource.status === 'loading')
  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 px-4 py-6 md:space-y-5 md:px-6 md:py-8">
      <header className="space-y-2">
        <h1 id={TITLE_ID} tabIndex={-1} className="font-display text-base leading-relaxed text-accent text-shadow-pixel focus:outline-none md:text-2xl">
          {copy.ACCESSORIES_TITLE}
        </h1>
        <p className="max-w-prose text-fg-muted">{copy.listIntro(meta.gameVersion)}</p>
        <ProvenanceLink href={ACCESSORIES_SOURCE_URL} srContext="for the accessory list" />
      </header>
      {resource.status === 'ready' ? (
        <AccessoriesBrowser data={resource.data} />
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

function AccessoriesBrowser({ data }: { data: AccessoryData }) {
  const { list, sprites } = data
  const [params, setParams] = useSearchParams()
  const { search } = useLocation()
  const filters = useMemo(() => parseAccessoryFilters(params), [params])
  const results = useMemo(() => list.filter((a) => matchesAccessory(a, filters)), [list, filters])
  const facets = useMemo(() => buildAccessoryFacets(list, filters), [list, filters])
  const unknownStage = useMemo(() => list.filter((a) => verifiedStage(a) === undefined).length, [list])

  useEffect(() => rememberAccessoryListSearch(search), [search])

  const update = useCallback(
    (next: (current: AccessoryFilters) => AccessoryFilters) => setParams((prev) => writeAccessoryFilters(prev, next(parseAccessoryFilters(prev))), { replace: true, preventScrollReset: true }),
    [setParams],
  )
  const onToggle = useCallback((facet: string, value: string) => update((f) => toggleAccessoryFilter(f, facet as AccessoryFacetId, value)), [update])
  const onClearAll = useCallback(() => update(() => EMPTY_ACCESSORY_FILTERS), [update])
  const onQuery = useCallback((q: string) => update((f) => ({ ...f, q })), [update])

  const resultsRef = useRef<HTMLDivElement>(null)
  const statusRef = useRef<HTMLParagraphElement>(null)
  const filterKey = writeAccessoryFilters(new URLSearchParams(), filters).toString()
  const settledKey = useRef(filterKey)
  useEffect(() => {
    if (settledKey.current === filterKey) return
    settledKey.current = filterKey
    const region = resultsRef.current
    if (region && region.getBoundingClientRect().top < 0) region.scrollIntoView({ block: 'start' })
    const focused = document.activeElement
    if (!focused || focused === document.body || !focused.isConnected) statusRef.current?.focus({ preventScroll: true })
  }, [filterKey])

  const selected = useMemo(() => ({ category: filters.category, stage: filters.stage }), [filters.category, filters.stage])
  const filterProps = { facets, selected, onToggle, onClearAll }

  return (
    <section aria-labelledby="accessories-list-title" className="space-y-3 md:space-y-4">
      <h2 id="accessories-list-title" className="font-display text-sm leading-relaxed text-accent text-shadow-pixel md:text-base">
        {copy.ALL_HEADING}
      </h2>
      <NameFilter value={filters.q} onChange={onQuery} label={copy.NAME_FILTER_LABEL} placeholder={copy.NAME_FILTER_PLACEHOLDER} clearLabel={copy.CLEAR_NAME} maxLength={MAX_QUERY_LENGTH} />
      <FilterBar {...filterProps} resultCount={results.length} noun="accessories" showActiveChips={results.length > 0} />
      <div ref={resultsRef} className="scroll-mt-20 space-y-3">
        <div className="flex flex-col gap-1 lg:flex-row lg:items-baseline lg:justify-between lg:gap-4">
          <p ref={statusRef} tabIndex={-1} role="status" className="font-semibold tabular-nums">
            {copy.resultCount(results.length, list.length)}
          </p>
          <p className="max-w-prose text-sm text-fg-muted lg:max-w-[60%] lg:text-right">
            <UnknownValue field="legend" sourceUrl={ACCESSORIES_SOURCE_URL} /> {copy.UNKNOWN_LEGEND} {copy.stageLegend(unknownStage, list.length)}
          </p>
        </div>
        {results.length > 0 ? (
          <VirtualList
            items={results}
            getKey={(a) => a.id}
            estimateSize={96}
            gap={8}
            restoreKey={`accessories?${filterKey}`}
            aria-label={copy.ALL_HEADING}
            renderItem={(a) => <AccessoryRow accessory={a} sprites={sprites} />}
          />
        ) : (
          <EmptyState
            titleId="accessories-empty"
            title={copy.EMPTY_TITLE}
            art={<EmptyChest className="h-auto w-30" />}
            actions={
              <button type="button" onClick={onClearAll} className={buttonClass('primary')}>
                {copy.CLEAR_ALL}
              </button>
            }
          >
            <p>{copy.emptyBody(activeAccessoryFilterCount(filters))}</p>
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
  )
}

function AccessoryRow({ accessory, sprites }: { accessory: Accessory; sprites: SpriteIndex | null }) {
  const rarity = asRarity(accessory.rarity)
  const stage = verifiedStage(accessory)
  const categories = getField(accessory, 'categories')
  return (
    <EntityCard
      to={accessoryHref(accessory.id)}
      state={FROM_LIST}
      name={accessory.name}
      rarity={rarity}
      sprite={<SpriteImg src={accessory.sprite} sprites={sprites} placeholder="material" box={40} />}
      badges={
        <>
          {categories.status === 'unverified' ? (
            <span className="text-fg-muted">
              {copy.CATEGORY_LABEL} <UnknownValue field="categories" interactive={false} />
            </span>
          ) : (
            categoryBuckets(accessory).map((c) => (
              <span key={c} data-category={c} className="inline-flex items-center border-2 border-stone-600 bg-night-900 px-1.5 text-xs leading-5 font-semibold tracking-wide text-fg uppercase">
                {categoryLabel(c)}
              </span>
            ))
          )}
          <span className="text-fg-muted">{rarity === undefined ? 'Rarity unknown' : rarityLabel(rarity)}</span>
        </>
      }
      stats={[{ key: 'stage', label: 'Stage', value: stage ? stageLabel(stage, true) : <UnknownValue field="stage" interactive={false} /> }]}
    />
  )
}
