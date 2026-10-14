import { ChevronDown } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { cx } from '../../../components/cx'
import { NodeMap, type NodeMapHandle } from '../../../components/NodeMap'
import { NodeMapLegend } from '../../../components/NodeMapLegend'
import { buildMapGraph, edgeLegendForms, frontierId, layoutInputs, WORLD_EVIL_LABEL, type WorldEvil } from '../../../components/nodeMap/graph'
import { layoutGraph } from '../../../components/nodeMap/layout'
import { INITIAL_ZOOM, MAP_LAYOUT_OPTIONS, POINTER_MIN_ZOOM, tapFloorZoom } from '../../../components/nodeMap/mapConfig'
import type { Inset } from '../../../components/nodeMap/panZoom'
import { mapProgress, newlyOpened } from '../../../components/nodeMap/progressView'
import { PixelLoader } from '../../../components/PixelLoader'
import { ProvenanceLink } from '../../../components/ProvenanceLink'
import { ErrorState } from '../../../components/States'
import { useBreakpoint, useMediaQuery } from '../../../components/useMediaQuery'
import { STAGES } from '../../stages'
import { useProgressStore } from '../../progressStore'
import { useDelayedFlag, useResource } from '../../useResource'
import { useDocumentTitle } from '../../useDocumentTitle'
import { useSearchParams } from 'react-router'
import { BossFocusCard } from './BossFocusCard'
import { loadBossMapData, peekBossMapData, type BossMapData } from './bossMapData'
import { bossPageHref, MAP_NODE_PARAM } from './bossNav'
import { cascadeUncoverAnnouncement } from './focusCardCopy'
import { MapOptionsMenu, ResetProgressFlow } from './MapOptionsMenu'

/**
 * /bosses — Boss Node Map v1 (PRD P5-S1; UX_SPEC §3.7, §4d, §7, §9).
 *
 * - The progression tree (NodeMap): a layered layout computed from the typed edges, stage bands in
 *   game order, either/or fork for the world evils; vertical on phones/tablets, horizontal from lg.
 * - MapToolbar: the world-evil choice (persisted to tc.v1.progress.worldEvil), the legend toggle and
 *   the overflow menu with "Reset progress…" (P5-S4 AC3: ConfirmDialog → 6s Undo toast). The legend
 *   docks beside the map from md, and overlays it (collapsed by default) on phones, where its toggle
 *   and the overflow menu share the map's bottom-left corner (the toolbar row has no room at 375px).
 * - A boss with a page (P5-S2: pre-Hardmode, src/schemas/bossPages.ts) is a link to that page; any
 *   other node opens its focus card: beside the map from lg, along its bottom edge below. A boss's
 *   card (reached by `?node=`) carries the defeat control (P5-S4).
 * - Defeat tracking (P5-S4): every node and line is drawn in its tracked status; a defeat marked in a
 *   card — or on a boss page since the map was last shown (progressStore.shownNodeStates) — plays the
 *   unlock cascade (UX_SPEC §12).
 * - `?node=<id>` (a boss page's "show on the map" links): the map opens centred on that node with its
 *   card open (for a node with a page, the card links back to it).
 * - No "What Should I Do Next?" panel (P5-S5): not shipped, so absent (UX_SPEC §3.2 rule).
 */
const TITLE_ID = 'boss-map-title'
const DETAILS_ID = 'boss-map-details'
const BOSSES_SOURCE_URL = 'https://terraria.wiki.gg/wiki/Bosses'

const bandLabel = (band: number) => STAGES[band]?.label ?? 'Unstaged'

export default function BossMapPage() {
  useDocumentTitle('Boss Progression')
  const resource = useResource('boss-map', loadBossMapData, peekBossMapData)
  const showLoader = useDelayedFlag(resource.status === 'loading')
  // `?node=<id>`: opened from a boss page's next steps — centre that node and open its card.
  const [searchParams] = useSearchParams()
  const focusId = searchParams.get(MAP_NODE_PARAM) ?? undefined

  return (
    <div
      className={cx(
        'flex flex-col',
        // Fill the viewport between the header and the tab bar (lg: no tab bar); never shorter than a usable map.
        'h-[calc(100dvh-(--spacing(16))-var(--pixel)-var(--spacing-tabbar)-var(--pixel)-env(safe-area-inset-bottom,0px))] min-h-[32rem]',
        'lg:h-[calc(100dvh-(--spacing(16))-var(--pixel))]',
      )}
    >
      {/* Compact on phones (title + source on one row) so the map keeps the height. Aligned with the
          shell's max-width container (the site header's); the map below runs full width. */}
      <header className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-4 px-4 pt-2 md:px-6 md:pt-3">
        <h1
          id={TITLE_ID}
          tabIndex={-1}
          className="font-display text-base leading-relaxed text-accent text-shadow-pixel focus:outline-none md:text-xl"
        >
          Boss Progression
        </h1>
        <p className="text-sm text-fg-muted max-md:sr-only md:order-last md:basis-full">
          How bosses, events and milestones unlock each other. Select one for its details.
        </p>
        <ProvenanceLink
          href={BOSSES_SOURCE_URL}
          label="Source"
          srContext="on terraria.wiki.gg, the Bosses article (each connection in a node’s details links its own wiki page)"
          className="max-md:ml-auto"
        />
      </header>
      {resource.status === 'ready' ? (
        <BossMapWorkspace key={focusId ?? ''} data={resource.data} focusId={focusId} />
      ) : resource.status === 'error' ? (
        <div className="mx-auto w-full max-w-7xl px-4 py-4 md:px-6">
          <ErrorState title="Couldn’t load the boss map" error={resource.error} onRetry={resource.retry} retryFocusId={TITLE_ID} />
        </div>
      ) : (
        <div className="grid flex-1 place-items-center">{showLoader ? <PixelLoader label="Loading the boss map…" /> : null}</div>
      )}
    </div>
  )
}

const WORLD_EVIL_OPTIONS: readonly { value: WorldEvil | null; label: string }[] = [
  { value: null, label: 'Both' },
  { value: 'corruption', label: WORLD_EVIL_LABEL.corruption },
  { value: 'crimson', label: WORLD_EVIL_LABEL.crimson },
]

/** World-evil segmented control (native radios: arrow keys move the choice). */
export function WorldEvilToggle({ value, onChange }: { value: WorldEvil | null; onChange: (value: WorldEvil | null) => void }) {
  const name = useId()
  return (
    <fieldset className="flex items-center gap-2">
      <legend className="float-left mr-1 text-sm font-semibold text-fg-muted">World evil</legend>
      <div className="flex border-2 border-panel-border shadow-pixel">
        {WORLD_EVIL_OPTIONS.map((option) => {
          const checked = option.value === value
          return (
            <label
              key={option.label}
              className={cx(
                'relative flex min-h-tap cursor-pointer items-center px-3 text-sm font-semibold transition-colors duration-(--dur-ui) not-last:border-r-2 not-last:border-panel-border',
                'has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-ring has-focus-visible:outline-solid',
                checked ? 'bg-night-700 text-accent' : 'bg-panel text-fg-muted hover:bg-night-700 hover:text-fg',
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value ?? 'both'}
                checked={checked}
                onChange={() => onChange(option.value)}
                data-world-evil={option.value ?? 'both'}
                className="sr-only"
              />
              {option.label}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

/** A boss node's page, if it has one (P5-S2); every other node opens its focus card. */
function pageOf(graph: ReturnType<typeof buildMapGraph>, id: string): string | undefined {
  return graph.nodeById.get(id)?.kind === 'boss' ? bossPageHref(id) : undefined
}

export function BossMapWorkspace({ data, focusId }: { data: BossMapData; focusId?: string }) {
  const horizontal = useBreakpoint('lg')
  const legendDocked = useBreakpoint('md')
  const coarse = useMediaQuery('(any-pointer: coarse)')
  const orientation = horizontal ? 'horizontal' : 'vertical'
  const options = MAP_LAYOUT_OPTIONS[orientation]
  const graph = useMemo(() => buildMapGraph(data.progression, data.bosses), [data])
  const layout = useMemo(() => {
    const input = layoutInputs(graph)
    return layoutGraph(input.nodes, input.edges, input.groups, options)
  }, [graph, options])
  // Touch screens never zoom out past the 44px tap-target floor; a mouse may go further.
  const minZoom = coarse ? tapFloorZoom(layout, options) : POINTER_MIN_ZOOM
  const initialZoom = Math.max(minZoom, INITIAL_ZOOM[orientation])

  const worldEvil = useProgressStore((s) => s.progress.worldEvil)
  const nodeStates = useProgressStore((s) => s.progress.nodeStates)
  const shownNodeStates = useProgressStore((s) => s.shownNodeStates)
  const markNodeStatesShown = useProgressStore((s) => s.markNodeStatesShown)
  const setWorldEvil = useProgressStore((s) => s.setWorldEvil)
  const unsaved = useProgressStore((s) => s.persistError)
  const startId = useMemo(() => frontierId(layout.layers.flat(), nodeStates), [layout, nodeStates])

  const [legendOpen, setLegendOpen] = useState(legendDocked)
  // `via`: a node pressed on the map is revealed with the least movement; one reached from the
  // card's connections or a page's "show on the map" link ("jump") is centred, since it may be far away.
  const initialFocus = focusId && graph.nodeById.has(focusId) ? focusId : undefined
  const [selection, setSelection] = useState<{ id: string; via: 'map' | 'jump' } | null>(() => (initialFocus ? { id: initialFocus, via: 'jump' } : null))
  const nodeHref = useCallback((id: string) => pageOf(graph, id), [graph])
  const selectedId = selection?.id ?? null
  const mapRef = useRef<NodeMapHandle>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const legendId = useId()
  const legendTitleId = useId()
  const [cardElement, setCardElement] = useState<HTMLElement | null>(null)
  const cardInset = useCardInset(cardElement, horizontal)
  const [resetOpen, setResetOpen] = useState(false)
  // Where the reset's undo toast renders: right after the options button (toolbar or map corner).
  const [toastHost, setToastHost] = useState<HTMLElement | null>(null)
  const optionsRef = useRef<HTMLButtonElement>(null)
  const openReset = useCallback(() => setResetOpen(true), [])
  const returnToOptions = useCallback(() => optionsRef.current, [])

  // The card's heading takes focus whenever the card opens or switches node.
  useEffect(() => {
    if (selectedId) headingRef.current?.focus({ preventScroll: true })
  }, [selectedId])
  // Keep the selected node clear of the card (runs again once the card's size is known).
  useEffect(() => {
    if (selection) mapRef.current?.show([selection.id], { mode: selection.via === 'jump' ? 'center' : 'reveal' })
  }, [selection, cardInset])

  const onSelect = useCallback(
    (id: string) => {
      setSelection((current) => (current?.id === id ? null : { id, via: 'map' }))
      // On phones the legend and the card share the map's lower edge: the card wins.
      if (!legendDocked) setLegendOpen(false)
    },
    [legendDocked],
  )
  const onClose = useCallback(() => {
    const id = selectedId
    setSelection(null)
    if (id) mapRef.current?.focus(id)
  }, [selectedId])
  const onJump = useCallback((id: string) => setSelection({ id, via: 'jump' }), [])
  // The unlock cascade can't fit beside the card (design review P5-S4 H1): the card closes — it was
  // where the mark was made, or a deep link's — and says so politely; focus inside it goes to its node.
  const [announcement, setAnnouncement] = useState('')
  const onCascadeUncover = useCallback(() => {
    const id = selectedId
    if (!id) return
    const progressBefore = mapProgress(graph, shownNodeStates, worldEvil)
    const opened = newlyOpened(graph, progressBefore, mapProgress(graph, nodeStates, worldEvil)).map((o) => graph.nodeById.get(o)?.name ?? o)
    const marked = shownNodeStates[id] !== nodeStates[id] ? { name: graph.nodeById.get(id)?.name ?? id, state: nodeStates[id] ?? null } : null
    setAnnouncement(cascadeUncoverAnnouncement(marked, opened, !unsaved))
    const focusInCard = cardElement?.contains(document.activeElement) ?? false
    setSelection(null)
    if (focusInCard) mapRef.current?.focus(id)
  }, [selectedId, graph, shownNodeStates, nodeStates, worldEvil, unsaved, cardElement])
  // Changing the world evil re-routes the either/or fork: bring the pair into view to show it.
  const onWorldEvil = useCallback(
    (value: WorldEvil | null) => {
      setWorldEvil(value)
      const pair = graph.groups.find((g) => g.some((id) => graph.nodeById.get(id)?.worldEvil))
      if (pair) mapRef.current?.show(pair)
    },
    [graph, setWorldEvil],
  )

  const legendForms = useMemo(() => edgeLegendForms(graph), [graph])
  const legend = (
    <NodeMapLegend
      titleId={legendTitleId}
      forms={legendForms}
      footer={
        <p className="border-t-2 border-panel-border pt-2 text-xs text-fg-muted">
          Every connection comes from the Terraria Wiki; open a node to see each one’s source.
        </p>
      }
    />
  )

  // One legend toggle: in the toolbar from md (legend docked beside the map), in the map's
  // bottom-left corner on phones (legend overlays the map above it, collapsed by default).
  const legendToggle = (
    <button
      type="button"
      aria-expanded={legendOpen}
      aria-controls={legendOpen ? legendId : undefined}
      onClick={() => setLegendOpen((open) => !open)}
      className={cx(
        'group inline-flex min-h-tap items-center gap-2 border-2 border-panel-border bg-panel px-3 text-sm font-semibold text-fg shadow-pixel hover:bg-night-700',
        !legendDocked && 'shadow-pixel-drop',
      )}
    >
      Legend
      <ChevronDown aria-hidden="true" className={cx('size-4 transition-transform duration-(--dur-ui)', legendOpen && 'rotate-180')} />
    </button>
  )

  return (
    <>
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 md:px-6">
        <WorldEvilToggle value={worldEvil} onChange={onWorldEvil} />
        {legendDocked ? (
          <>
            {legendToggle}
            <MapOptionsMenu onReset={openReset} triggerRef={optionsRef} className="ml-auto" />
            <div ref={setToastHost} className="contents" />
          </>
        ) : null}
      </div>
      <ResetProgressFlow open={resetOpen} onOpenChange={setResetOpen} returnFocus={returnToOptions} toastHost={toastHost} />

      <div className="flex min-h-0 flex-1 border-t-2 border-panel-border">
        {legendOpen && legendDocked ? (
          <aside id={legendId} className="w-64 shrink-0 overflow-y-auto overscroll-contain border-r-2 border-panel-border bg-surface p-4">
            {legend}
          </aside>
        ) : null}
        <div className="relative min-w-0 flex-1">
          <NodeMap
            ref={mapRef}
            className="absolute inset-0"
            controlsClassName={horizontal ? 'right-2 bottom-2' : 'right-2 top-2'}
            // Desktop: a row along the bottom edge, its strip kept clear of the nodes (a column there covered them).
            controlsRow={horizontal}
            graph={graph}
            layout={layout}
            options={options}
            sprites={data.sprites}
            worldEvil={worldEvil}
            nodeStates={nodeStates}
            cascadeBaseline={shownNodeStates}
            onCascadeShown={markNodeStatesShown}
            onCascadeUncover={onCascadeUncover}
            // The card is open but not measured yet: a cascade waits to see how much map it leaves.
            holdCascade={selectedId !== null && cardInset === undefined}
            selectedId={selectedId}
            detailsId={DETAILS_ID}
            minZoom={minZoom}
            initialZoom={initialZoom}
            startId={startId}
            bandLabel={bandLabel}
            onSelect={onSelect}
            inset={cardInset}
            nodeHref={nodeHref}
            initialFocusId={initialFocus}
          />
          {legendDocked ? null : (
            // Over the map on phones: the map's stage labels keep clear of it, its strip is reserved.
            <div data-map-overlay="" className="absolute bottom-2 left-2 z-(--z-hud) flex gap-2">
              {legendToggle}
              <MapOptionsMenu onReset={openReset} triggerRef={optionsRef} className="shadow-pixel-drop" />
            </div>
          )}
          {legendDocked ? null : <div ref={setToastHost} className="contents" />}
          {legendOpen && !legendDocked ? (
            <div
              id={legendId}
              className="absolute bottom-15 left-2 z-(--z-hud) max-h-[calc(100%-4.25rem)] w-[min(20rem,calc(100%-4.5rem))] overflow-y-auto overscroll-contain border-2 border-panel-border bg-surface p-3 shadow-pixel-drop"
            >
              {legend}
            </div>
          ) : null}
          {selectedId ? (
            <BossFocusCard
              // One card per node: a new node starts at the top of the card.
              key={selectedId}
              id={DETAILS_ID}
              graph={graph}
              nodeId={selectedId}
              sprites={data.sprites}
              worldEvil={worldEvil}
              nodeStates={nodeStates}
              pageHref={pageOf(graph, selectedId)}
              onClose={onClose}
              onJump={onJump}
              headingRef={headingRef}
              rootRef={setCardElement}
              className={cx(
                'absolute z-(--z-hud)',
                // From lg it stops above the zoom-control row (48px + an 8px gap) at the bottom-right.
                horizontal ? 'top-2 right-2 max-h-[calc(100%-1rem-3.5rem)] w-88' : 'inset-x-2 bottom-2 max-h-[min(60%,26rem)]',
              )}
            />
          ) : null}
        </div>
      </div>
      <p role="status" className="sr-only" data-map-announcer="">
        {announcement}
      </p>
    </>
  )
}

/**
 * The map edge the focus card covers (screen px, incl. its 8px offset and an 8px gap): its width
 * on the right from lg, its height along the bottom below. Measured by a ResizeObserver (which
 * reports once as soon as it starts observing, then on every resize), so content changes and
 * resizes keep the map's uncovered area exact. No card, no inset.
 */
function useCardInset(card: HTMLElement | null, horizontal: boolean): Inset | undefined {
  const [inset, setInset] = useState<Inset | undefined>(undefined)
  useEffect(() => {
    if (!card) return
    const observer = new ResizeObserver(() => {
      if (!card.isConnected) return
      const rect = card.getBoundingClientRect()
      const next = horizontal ? { right: Math.round(rect.width) + 16 } : { bottom: Math.round(rect.height) + 16 }
      setInset((current) => (current?.right === next.right && current?.bottom === next.bottom ? current : next))
    })
    observer.observe(card)
    return () => observer.disconnect()
  }, [card, horizontal])
  return card ? inset : undefined
}
