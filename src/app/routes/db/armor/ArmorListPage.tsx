import { Info } from 'lucide-react'
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
import type { SpriteIndex } from '../../../../data-access/types'
import { getField } from '../../../../schemas/getField'
import { meta } from '../../../../data/meta'
import { useDelayedFlag, useResource } from '../../../useResource'
import { useDocumentTitle } from '../../../useDocumentTitle'
import { stageLabel } from '../weapons/weaponDisplay'
import * as copy from './armorCopy'
import { loadArmorData, peekArmorData, type ArmorData } from './armorData'
import {
  activeArmorFilterCount,
  buildArmorFacets,
  EMPTY_ARMOR_FILTERS,
  loosePieceEntries,
  matchesArmor,
  MAX_QUERY_LENGTH,
  parseArmorFilters,
  setEntries,
  toggleArmorFilter,
  writeArmorFilters,
  type ArmorFacetId,
  type ArmorFilters,
  type PieceEntry,
  type SetEntry,
} from './armorModel'
import { ARMOR_SOURCE_URL, armorPieceHref, armorSetHref, rememberArmorListSearch, type FromArmorListState } from './armorNav'
import { ClassChip, NameFilter, SECTION_TITLE } from './EquipmentBits'

/**
 * /armor (PRD P6-S1 AC1; UX_SPEC §1): every armor set — grouped by set, as the game groups armor — filterable by
 * class and game stage (OR within, AND across, URL-synced, chip-removable) and by name; then the pieces that
 * belong to no set. A set row shows its classes (a hybrid set every class it counts for), how many helmets it
 * offers, its full-set defense (set bonus included — P6-S1 AC2's total, never a sum that leaves the bonus out) and
 * its verified stage or Unknown. 69 sets and 14 pieces outside them: plain lists, no virtualization needed. States:
 * SkeletonList after 300ms, designed empty state, ErrorState + Retry.
 */

const FROM_LIST: FromArmorListState = { fromArmorList: true }
const TITLE_ID = 'armor-title'

export default function ArmorListPage() {
  useDocumentTitle(copy.ARMOR_TITLE)
  const resource = useResource('armor-data', loadArmorData, peekArmorData)
  const showSkeleton = useDelayedFlag(resource.status === 'loading')
  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 px-4 py-6 md:space-y-5 md:px-6 md:py-8">
      <header className="space-y-2">
        <h1 id={TITLE_ID} tabIndex={-1} className="font-display text-base leading-relaxed text-accent text-shadow-pixel focus:outline-none md:text-2xl">
          {copy.ARMOR_TITLE}
        </h1>
        <p className="max-w-prose text-fg-muted">{copy.listIntro(meta.gameVersion)}</p>
        <ProvenanceLink href={ARMOR_SOURCE_URL} srContext="for the armor list" />
      </header>
      {resource.status === 'ready' ? (
        <ArmorBrowser data={resource.data} />
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

let entriesFor: { source: ArmorData['sets']; sets: SetEntry[]; loose: PieceEntry[] } | undefined
function entriesOf(data: ArmorData) {
  if (entriesFor?.source !== data.sets) entriesFor = { source: data.sets, sets: setEntries(data.sets.values(), data.armor), loose: loosePieceEntries(data.armor, data.sets.values()) }
  return entriesFor
}

function ArmorBrowser({ data }: { data: ArmorData }) {
  const { sets, loose } = entriesOf(data)
  const [params, setParams] = useSearchParams()
  const { search } = useLocation()
  const filters = useMemo(() => parseArmorFilters(params), [params])
  const shownSets = useMemo(() => sets.filter((e) => matchesArmor(e, filters)), [sets, filters])
  const shownLoose = useMemo(() => loose.filter((e) => matchesArmor(e, filters)), [loose, filters])
  // pieces a class filter alone leaves out (they have no class): said, never silently dropped
  const hiddenByClass = useMemo(() => (filters.class.length > 0 ? loose.filter((e) => matchesArmor(e, filters, 'class')).length : 0), [loose, filters])
  const facets = useMemo(() => buildArmorFacets(sets, filters), [sets, filters])
  const unknownStage = sets.filter((e) => e.stage === undefined).length

  useEffect(() => rememberArmorListSearch(search), [search])

  const update = useCallback(
    (next: (current: ArmorFilters) => ArmorFilters) => setParams((prev) => writeArmorFilters(prev, next(parseArmorFilters(prev))), { replace: true, preventScrollReset: true }),
    [setParams],
  )
  const onToggle = useCallback((facet: string, value: string) => update((f) => toggleArmorFilter(f, facet as ArmorFacetId, value)), [update])
  const onClearAll = useCallback(() => update(() => EMPTY_ARMOR_FILTERS), [update])
  const onQuery = useCallback((q: string) => update((f) => ({ ...f, q })), [update])

  // After a filter change: results back into view if scrolled past; focus the count if the focused control vanished.
  const resultsRef = useRef<HTMLDivElement>(null)
  const statusRef = useRef<HTMLParagraphElement>(null)
  const filterKey = writeArmorFilters(new URLSearchParams(), filters).toString()
  const settledKey = useRef(filterKey)
  useEffect(() => {
    if (settledKey.current === filterKey) return
    settledKey.current = filterKey
    const region = resultsRef.current
    if (region && region.getBoundingClientRect().top < 0) region.scrollIntoView({ block: 'start' })
    const focused = document.activeElement
    if (!focused || focused === document.body || !focused.isConnected) statusRef.current?.focus({ preventScroll: true })
  }, [filterKey])

  const selected = useMemo(() => ({ class: filters.class, stage: filters.stage }), [filters.class, filters.stage])
  const filterProps = { facets, selected, onToggle, onClearAll }
  const nothing = shownSets.length === 0 && shownLoose.length === 0

  return (
    <div className="space-y-3 md:space-y-4">
      {/* heading, then filters, then results — the items and accessories lists' order. The filters apply to both lists
          below (a class filter to the sets only — said where it leaves pieces out). */}
      <section aria-labelledby="armor-sets-title" className="space-y-3 md:space-y-4">
        <h2 id="armor-sets-title" className={SECTION_TITLE}>
          {copy.SETS_HEADING}
        </h2>
        <NameFilter value={filters.q} onChange={onQuery} label={copy.NAME_FILTER_LABEL} placeholder={copy.NAME_FILTER_PLACEHOLDER} clearLabel={copy.CLEAR_NAME} maxLength={MAX_QUERY_LENGTH} />
        <FilterBar {...filterProps} resultCount={shownSets.length} noun="sets" showActiveChips={!nothing} />
        <div ref={resultsRef} className="scroll-mt-20 space-y-3">
          <div className="flex flex-col gap-1 lg:flex-row lg:items-baseline lg:justify-between lg:gap-4">
            <p ref={statusRef} tabIndex={-1} role="status" className="font-semibold tabular-nums">
              {copy.resultCount(shownSets.length, sets.length)}
            </p>
            <p className="max-w-prose text-sm text-fg-muted lg:max-w-[60%] lg:text-right">
              <UnknownValue field="legend" sourceUrl={ARMOR_SOURCE_URL} /> {copy.UNKNOWN_LEGEND} {copy.stageLegend(unknownStage, sets.length)}
            </p>
          </div>
          {nothing ? (
            <EmptyState
              titleId="armor-empty"
              title={copy.EMPTY_TITLE}
              art={<EmptyChest className="h-auto w-30" />}
              actions={
                <button type="button" onClick={onClearAll} className={buttonClass('primary')}>
                  {copy.CLEAR_ALL}
                </button>
              }
            >
              <p>{copy.emptyBody(activeArmorFilterCount(filters))}</p>
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
          ) : shownSets.length === 0 ? (
            // no set matches, but pieces outside the sets do: said here, not an empty list
            <p className="flex gap-2 border-2 border-dashed border-panel-border px-3 py-2 text-sm text-fg-muted" data-set-list="0">
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {copy.noSetsButPieces(shownLoose.length)}
            </p>
          ) : (
            <ul className="space-y-2" aria-label={copy.SETS_HEADING} data-set-list={shownSets.length}>
              {shownSets.map((e) => (
                <li key={e.id}>
                  <SetRow entry={e} sprites={data.sprites} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      {!nothing ? (
        <section aria-labelledby="armor-loose-title" className="space-y-3 pt-2">
          <h2 id="armor-loose-title" className={SECTION_TITLE}>
            {copy.LOOSE_HEADING}
          </h2>
          <p className="text-sm text-fg-muted">
            {copy.LOOSE_NOTE} {copy.pieceCount(shownLoose.length)}.
          </p>
          {hiddenByClass > 0 ? (
            <p className="text-sm text-fg-muted" data-loose-hidden={hiddenByClass}>
              {copy.looseHiddenByClass(hiddenByClass)}
            </p>
          ) : null}
          {shownLoose.length > 0 ? (
            <ul className="space-y-2" aria-label={copy.LOOSE_HEADING} data-loose-list={shownLoose.length}>
              {shownLoose.map((e) => (
                <li key={e.id}>
                  <PieceRow entry={e} sprites={data.sprites} />
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}

function SetRow({ entry, sprites }: { entry: SetEntry; sprites: SpriteIndex | null }) {
  const unknown = (field: string) => <UnknownValue field={field} interactive={false} />
  const defense = entry.defense === undefined ? unknown('defense') : entry.defense.min === entry.defense.max ? String(entry.defense.min) : `${entry.defense.min}–${entry.defense.max}`
  return (
    <EntityCard
      to={armorSetHref(entry.id)}
      state={FROM_LIST}
      name={entry.name}
      rarity={undefined}
      sprite={<SpriteImg src={entry.sprite} sprites={sprites} placeholder="material" box={40} />}
      badges={
        <>
          {entry.classes.map((c) => (
            <ClassChip key={c} cls={c} />
          ))}
          {entry.helmets > 1 ? <span className="text-fg-muted">{copy.helmets(entry.helmets)}</span> : null}
          {entry.chests > 1 ? <span className="text-fg-muted">{copy.chestPieces(entry.chests)}</span> : null}
          {entry.legsAny ? <span className="text-fg-muted">{copy.NO_LEGS_PIECE}</span> : null}
        </>
      }
      // List rows are set records with their own _prov: a stage is shown only where verified
      stats={[
        { key: 'defense', label: copy.FULL_SET_DEFENSE, value: defense },
        { key: 'stage', label: 'Stage', value: entry.stage ? stageLabel(entry.stage, true) : unknown('stage') },
      ]}
    />
  )
}

function PieceRow({ entry, sprites }: { entry: PieceEntry; sprites: SpriteIndex | null }) {
  const rarity = asRarity(entry.piece.rarity)
  const unknown = (field: string) => <UnknownValue field={field} interactive={false} />
  const defense = getField(entry.piece, 'defense')
  return (
    <EntityCard
      to={armorPieceHref(entry.id)}
      state={FROM_LIST}
      name={entry.name}
      rarity={rarity}
      sprite={<SpriteImg src={entry.piece.sprite} sprites={sprites} placeholder="material" box={40} />}
      badges={
        <>
          <span className="inline-flex items-center border-2 border-stone-600 bg-night-900 px-1.5 text-xs leading-5 font-semibold tracking-wide text-fg uppercase">{copy.SLOT_LABEL[entry.piece.slot]}</span>
          <span className="text-fg-muted">{rarity === undefined ? 'Rarity unknown' : rarityLabel(rarity)}</span>
          {getField(entry.piece, 'setId').status === 'unverified' ? (
            <span className="text-fg-muted" data-set-unknown="">
              {copy.SET_ROW} {unknown('setId')}
            </span>
          ) : null}
        </>
      }
      stats={[
        { key: 'defense', label: 'Defense', value: defense.status === 'unverified' ? unknown('defense') : defense.status === 'not-applicable' ? '0' : String(defense.value) },
        { key: 'stage', label: 'Stage', value: entry.stage ? stageLabel(entry.stage, true) : unknown('stage') },
      ]}
    />
  )
}
