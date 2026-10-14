import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useLocation, useSearchParams } from 'react-router'
import { EmptyChest } from '../../../../components/art/EmptyChest'
import { buttonClass } from '../../../../components/buttonStyles'
import { EntityCard } from '../../../../components/EntityCard'
import { FavoriteStar } from '../../../../components/FavoriteStar'
import { ActiveFilterChips, FilterBar } from '../../../../components/FilterBar'
import { ProvenanceLink } from '../../../../components/ProvenanceLink'
import { rarityLabel, asRarity } from '../../../../components/rarity'
import { SpriteImg } from '../../../../components/SpriteImg'
import { EmptyState, ErrorState, SkeletonList } from '../../../../components/States'
import { UnknownValue } from '../../../../components/UnknownValue'
import { VirtualList } from '../../../../components/VirtualList'
import { loadList, loadSpriteIndex, peekList, peekSpriteIndex } from '../../../../data-access'
import type { SpriteIndex, WeaponListRecord } from '../../../../data-access/types'
import { meta } from '../../../../data/meta'
import { useDelayedFlag, useResource } from '../../../useResource'
import { useDocumentTitle } from '../../../useDocumentTitle'
import { ClassBadge } from './WeaponBits'
import { stageLabel } from './weaponDisplay'
import {
  applyFilters,
  activeFilterCount,
  buildFacets,
  EMPTY_FILTERS,
  facetValues,
  parseFilters,
  sortForBrowse,
  toggleFilter,
  writeFilters,
  type FacetId,
} from './weaponFilters'
import { rememberListSearch, weaponHref, WEAPONS_SOURCE_URL, type FromListState } from './weaponNav'

/**
 * /weapons (PRD P2-S3 AC1/AC2, UX_SPEC §3.3): every weapon in a window-virtualized list of
 * EntityCards, filterable by class / stage / rarity (combinable, URL-synced, chip-removable).
 * States: SkeletonList after 300ms, designed empty state on zero results, ErrorState + Retry.
 */
interface ListData {
  list: WeaponListRecord[]
  /** null = manifest unavailable → placeholder art (safe direction for the D3 lever). */
  sprites: SpriteIndex | null
}

async function loadListData(): Promise<ListData> {
  const [list, sprites] = await Promise.all([
    loadList('weapons'),
    loadSpriteIndex().catch((error: unknown) => {
      console.warn('[sprites] Manifest unavailable; showing placeholder art.', error)
      return null
    }),
  ])
  return { list: sortForBrowse(list), sprites }
}

function peekListData(): ListData | undefined {
  const list = peekList('weapons')
  return list ? { list: sortForBrowse(list), sprites: peekSpriteIndex() ?? null } : undefined
}

const FROM_LIST: FromListState = { fromList: true }

/** Page heading id: where focus lands when Retry replaces the error panel. */
const LIST_TITLE_ID = 'weapons-title'

export default function WeaponsListPage() {
  useDocumentTitle('Weapons')
  const resource = useResource('weapons-list', loadListData, peekListData)
  const showSkeleton = useDelayedFlag(resource.status === 'loading')

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 px-4 py-6 md:space-y-5 md:px-6 md:py-8">
      <header className="space-y-2">
        <h1
          id={LIST_TITLE_ID}
          tabIndex={-1}
          className="font-display text-base leading-relaxed text-accent text-shadow-pixel focus:outline-none md:text-2xl"
        >
          Weapons
        </h1>
        <p className="max-w-prose text-fg-muted">
          Every weapon in Terraria {meta.gameVersion}, from the Official Terraria Wiki. Filter by class, game stage and
          rarity; open a weapon for its full stats and how to get it.
        </p>
        <div className="flex flex-wrap items-center gap-x-4">
          <ProvenanceLink href={WEAPONS_SOURCE_URL} srContext="for the weapon list" />
        </div>
      </header>

      {resource.status === 'ready' ? (
        <WeaponsBrowser data={resource.data} />
      ) : resource.status === 'error' ? (
        <ErrorState
          title="Couldn’t load the weapon list"
          error={resource.error}
          onRetry={resource.retry}
          retryFocusId={LIST_TITLE_ID}
        />
      ) : showSkeleton ? (
        <SkeletonList label="Loading weapons…" />
      ) : (
        // Reserve space until the skeleton is due (no blank flash for fast loads, no layout jump).
        <div className="min-h-[50dvh]" aria-hidden="true" />
      )}
    </div>
  )
}

function WeaponsBrowser({ data }: { data: ListData }) {
  const { list, sprites } = data
  const [params, setParams] = useSearchParams()
  const { search } = useLocation()
  const valid = useMemo(() => facetValues(list), [list])
  const filters = useMemo(() => parseFilters(params, valid), [params, valid])
  const results = useMemo(() => applyFilters(list, filters), [list, filters])
  const facets = useMemo(() => buildFacets(list, filters), [list, filters])
  const allStagesUnknown = useMemo(() => list.every((w) => w.stage === undefined), [list])

  useEffect(() => rememberListSearch(search), [search])

  const update = useCallback(
    (next: (current: ReturnType<typeof parseFilters>) => ReturnType<typeof parseFilters>) =>
      setParams((prev) => writeFilters(prev, next(parseFilters(prev, valid))), { replace: true, preventScrollReset: true }),
    [setParams, valid],
  )
  const onToggle = useCallback(
    (facet: string, value: string) => update((f) => toggleFilter(f, facet as FacetId, value, valid[facet as FacetId])),
    [update, valid],
  )
  const onClearAll = useCallback(() => update(() => EMPTY_FILTERS), [update])

  // After a filter change: bring the results back into view if the user had scrolled past them,
  // and if the control that had focus disappeared (removed chip, Clear all), focus the result count.
  const resultsRef = useRef<HTMLDivElement>(null)
  const statusRef = useRef<HTMLParagraphElement>(null)
  const filterKey = writeFilters(new URLSearchParams(), filters).toString()
  // Previous key (not a "first render" flag) so StrictMode's double effect run is a no-op.
  const settledKey = useRef(filterKey)
  useEffect(() => {
    if (settledKey.current === filterKey) return
    settledKey.current = filterKey
    const region = resultsRef.current
    if (region && region.getBoundingClientRect().top < 0) region.scrollIntoView({ block: 'start' })
    const focused = document.activeElement
    if (!focused || focused === document.body || !focused.isConnected) statusRef.current?.focus({ preventScroll: true })
  }, [filterKey])

  const filterProps = { facets, selected: filters, onToggle, onClearAll }

  return (
    <>
      <FilterBar {...filterProps} resultCount={results.length} noun="weapons" showActiveChips={results.length > 0} />

      <div ref={resultsRef} className="scroll-mt-20 space-y-3">
        <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:justify-between md:gap-4">
          <p ref={statusRef} tabIndex={-1} role="status" className="font-semibold tabular-nums">
            {results.length === list.length
              ? `${list.length} weapons`
              : `Showing ${results.length} of ${list.length} weapons`}
          </p>
          <p className="text-sm text-fg-muted">
            <UnknownValue field="legend" sourceUrl={WEAPONS_SOURCE_URL} /> = not yet verified; we never guess values.
            {allStagesUnknown ? ' Game stage isn’t verified for any weapon yet, so all are under “Stage unknown”.' : null}
          </p>
        </div>

        {results.length > 0 ? (
          <VirtualList
            items={results}
            getKey={(w) => w.id}
            estimateSize={96}
            gap={8}
            restoreKey={`weapons?${filterKey}`}
            aria-label="Weapons"
            renderItem={(w) => <WeaponRow weapon={w} sprites={sprites} />}
          />
        ) : (
          <EmptyState
            titleId="weapons-empty"
            title="No weapons match"
            art={<EmptyChest className="h-auto w-30" />}
            actions={
              <button type="button" onClick={onClearAll} className={buttonClass('primary')}>
                Clear all filters
              </button>
            }
          >
            <p>
              Nothing in this chest —{' '}
              {activeFilterCount(filters) === 1
                ? 'no weapon matches this filter.'
                : `no weapon matches all ${activeFilterCount(filters)} active filters together.`}
            </p>
            <p>Remove a filter below, or clear them all.</p>
            <ActiveFilterChips {...filterProps} showClearAll={false} className="justify-center pt-2" />
          </EmptyState>
        )}
      </div>
    </>
  )
}

function WeaponRow({ weapon, sprites }: { weapon: WeaponListRecord; sprites: SpriteIndex | null }) {
  const rarity = asRarity(weapon.rarity)
  // List records carry no _prov: an absent always-applicable field reads as Unknown here; the
  // detail page shows the exact per-field status.
  const unknown = (field: string) => <UnknownValue field={field} interactive={false} />
  return (
    <EntityCard
      to={weaponHref(weapon.id)}
      state={FROM_LIST}
      name={weapon.name}
      rarity={rarity}
      sprite={<SpriteImg src={weapon.sprite} sprites={sprites} damageClass={weapon.damageClass} box={40} />}
      badges={
        <>
          <ClassBadge damageClass={weapon.damageClass} />
          <span className="text-fg-muted">{rarity === undefined ? 'Rarity unknown' : rarityLabel(rarity)}</span>
        </>
      }
      stats={[
        { key: 'damage', label: 'Damage', value: weapon.damage ?? unknown('damage') },
        { key: 'useTime', label: 'Use time', value: weapon.useAnimationTicks ?? unknown('useAnimationTicks') },
        { key: 'stage', label: 'Stage', value: weapon.stage ? stageLabel(weapon.stage, true) : unknown('stage') },
      ]}
      // P7-S1: each row's star subscribes to its own ref in the shared store, so a toggle anywhere
      // re-renders only the rows whose answer changed (virtualization-safe: no per-list state).
      action={<FavoriteStar entityRef={`i:${weapon.id}`} name={weapon.name} />}
    />
  )
}
