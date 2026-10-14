import { LocateFixed, Minus, Plus, Scan } from 'lucide-react'
import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react'
import { flushSync } from 'react-dom'
import type { SpriteIndex } from '../data-access/types'
import { BossNode } from './BossNode'
import { cx } from './cx'
import { placeBandLabels } from './nodeMap/bandLabels'
import { EdgeBadges, EdgeMarkerDefs } from './nodeMap/EdgeGlyphs'
import { EDGE_STYLES, markerId } from './nodeMap/edgeStyles'
import { describeNode, isNodeActive, traverse, type MapGraph, type MapMove, type NodeState, type WorldEvil } from './nodeMap/graph'
import type { Box, GraphLayout, LayoutOptions } from './nodeMap/layout'
import { CASCADE_LEAD_MS, cascadeRegion, crossPositions, planCascadeCamera } from './nodeMap/cascadeCamera'
import { CONTROLS_ROW_INSET, hitPadding, MAX_ZOOM, tapFloorZoom } from './nodeMap/mapConfig'
import { openingRect } from './nodeMap/opening'
import { unionRect, type Inset, type Size, type ZoomLimits } from './nodeMap/panZoom'
import {
  describeStatus,
  EMPTY_SCHEDULE,
  mapProgress,
  unlockSchedule,
  withLead,
  type LinkStatus,
  type LinkUnlock,
  type MapProgress,
  type UnlockSchedule,
} from './nodeMap/progressView'
import { buildScene, chipExtent, nodeExtent, type Scene, type ScenePath } from './nodeMap/scene'
import { usePanZoom, type PanZoom } from './nodeMap/usePanZoom'
import { useReducedMotion } from './useReducedMotion'

/**
 * NodeMap (UX_SPEC §3.1/§3.7/§7/§9; PRD P5-S1): the boss progression tree on a pan/zoom surface.
 *
 * - Layers: an SVG (stage bands, edges, icon badges) under real <button> nodes (BossNode), all in
 *   one transformed map layer. Nodes are listed in progression (reading) order, so Tab walks the
 *   progression; arrow keys follow the edges (along the flow / back — straight back returns where
 *   you came from) and step within a layer (a row on the vertical map, a column on the horizontal).
 * - Pan/zoom (./nodeMap/usePanZoom): drag or one-finger pan, wheel or pinch zoom, and on-screen
 *   +/−, "fit all" and "go to start" buttons. Touch screens never zoom out past the 44px tap-target
 *   floor (`minZoom`, see mapConfig.tapFloorZoom); where that floor stops "fit all" short of the whole
 *   tree, it lands on the tree's first node (the start), not on the tree's middle.
 * - Stage labels (./nodeMap/bandLabels): in screen space, riding their bands like sticky headers,
 *   never over a node (they slide into a gap or fade) and never into each other.
 * - Opens on `startId` (the frontier: with no tracked progress, the Pre-Hardmode start), framed per
 *   mapConfig OPENING_FRAME (./nodeMap/opening): on desktop the whole opening region — the start
 *   through the first either/or fork — fitted; on phones the start centred. "Go to start" returns there.
 * - Keyboard focus pans the focused node into view, clear of the floating controls.
 * - Progress (P5-S4, ./nodeMap/progressView): every node and line drawn in its tracked status
 *   (defeated / skipped / reached / recommended / available / locked), the status in words leading
 *   each node's description; a required gate's padlock badge turns into a check once the gate is met.
 *   When the node states change from `cascadeBaseline` (what the map last showed — a defeat marked
 *   here or on a boss page), the UNLOCK CASCADE plays once (UX_SPEC §12) where it can be seen (design
 *   review P5-S4 H1/M1, ./nodeMap/cascadeCamera): the map keeps drawing the baseline until it is
 *   measured (and `holdCascade` is off), then frames the cascade's region in the part of the map the
 *   focus card leaves uncovered — or, when it can't fit there, asks the caller to close the card
 *   (`onCascadeUncover`) and frames it in the whole map — and only once that 200ms pan is over does
 *   the cascade start, its siblings rippling along their layers. `onCascadeShown` then lets the caller
 *   catch the baseline up; the running cascade is held until it finishes. While a cascade waits or its
 *   camera moves, other camera moves hold off: keyboard-focus panning is skipped, and a `show` waits
 *   for the cascade to finish, then brings its nodes into view with the least movement.
 */
export interface NodeMapHandle {
  /**
   * Brings nodes into the uncovered part of the map, animated: `reveal` (default) pans as little
   * as possible, `center` centres them (zooming in to the opening zoom if further out).
   */
  show: (ids: readonly string[], options?: { mode?: 'reveal' | 'center' }) => void
  /** Moves keyboard focus to a node's button (without moving the map). */
  focus: (id: string) => void
}

export interface NodeMapProps {
  graph: MapGraph
  layout: GraphLayout
  options: LayoutOptions
  sprites: SpriteIndex | null
  worldEvil: WorldEvil | null
  nodeStates: Readonly<Record<string, NodeState>>
  /**
   * The node states the map last showed (progressStore.shownNodeStates). Whatever unlocked since
   * plays the unlock cascade. Absent = no cascade.
   */
  cascadeBaseline?: Readonly<Record<string, NodeState>>
  /** The map has started showing the current node states (the caller catches the baseline up). */
  onCascadeShown?: () => void
  /**
   * The cascade can't fit beside the overlay covering the map (`inset`): close it. The cascade waits
   * for the inset to clear, then frames itself in the whole map and plays.
   */
  onCascadeUncover?: () => void
  /** An overlay is opening but not measured yet: a cascade waits (the map draws the baseline meanwhile). */
  holdCascade?: boolean
  selectedId: string | null
  /** Id of the details card a node opens. */
  detailsId: string
  minZoom: number
  initialZoom: number
  /** Node the map opens centred on. */
  startId: string | undefined
  /** Label of a stage band. */
  bandLabel: (band: number) => string
  onSelect: (id: string) => void
  ref?: Ref<NodeMapHandle>
  /** Size/position of the map box (default `relative h-full`); it must establish a containing block. */
  className?: string
  /** Placement of the zoom controls inside the map (default: bottom-right). */
  controlsClassName?: string
  /**
   * The zoom controls as a row along the map's bottom edge (default: a column). The row's strip is
   * reserved like an overlay inset, so opening, centring, fitting and bounded panning keep the nodes
   * above it rather than under the buttons.
   */
  controlsRow?: boolean
  /** Map-box edges covered by an overlay (the focus card): the map keeps its nodes clear of them. */
  inset?: Inset
  /** A node's own page, if it has one (P5-S2 boss pages): that node is a link instead of a card button. */
  nodeHref?: (id: string) => string | undefined
  /**
   * A node the map first opens centred on instead of the opening view (a `?node=` deep link from a
   * boss page's next steps, PRD P5-S2 AC3). "Go to start" still returns to `startId`.
   */
  initialFocusId?: string
}

const ZOOM_STEP = 1.25

const KEY_MOVES: Readonly<Record<GraphLayout['orientation'], Readonly<Record<string, MapMove>>>> = {
  vertical: { ArrowDown: 'forward', ArrowUp: 'back', ArrowRight: 'next', ArrowLeft: 'previous', Home: 'first', End: 'last' },
  horizontal: { ArrowRight: 'forward', ArrowLeft: 'back', ArrowDown: 'next', ArrowUp: 'previous', Home: 'first', End: 'last' },
}
/** The move that undoes an edge step. */
const REVERSE: Partial<Record<MapMove, MapMove>> = { forward: 'back', back: 'forward' }

const descriptionId = (nodeId: string) => `map-node-desc-${nodeId}`
/** How far (map px) the stage stripes extend past the canvas. */
const BLEED = 4000
const INSTRUCTIONS_ID = 'node-map-instructions'

/** A drawn path's progress status: its link's, its fork branch's, or (connectors) idle. */
function pathStatus(path: ScenePath, progress: MapProgress): LinkStatus {
  if (path.role === 'branch') return progress.branches.get(path.member ?? '') ?? 'idle'
  return path.linkId ? (progress.links.get(path.linkId) ?? 'idle') : 'idle'
}

function pathUnlock(path: ScenePath, cascade: UnlockSchedule): LinkUnlock | undefined {
  if (path.role === 'branch') return cascade.branches.get(path.member ?? '')
  return path.linkId ? cascade.links.get(path.linkId) : undefined
}

/** How much wider than its line a lit (recommended-next) path's glow is, in map px. */
const HALO_EXTRA = 7

/** The SVG layer: stage bands, edges, badges. Memoised: panning never re-renders it. Exported for markup tests. */
export const MapDrawing = memo(function MapDrawing({ layout, scene, progress, cascade }: { layout: GraphLayout; scene: Scene; progress: MapProgress; cascade: UnlockSchedule }) {
  const vertical = layout.orientation === 'vertical'
  return (
    <svg width={layout.width} height={layout.height} aria-hidden="true" className="absolute top-0 left-0 overflow-visible">
      <EdgeMarkerDefs />
      <g data-layer="bands">
        {layout.bands.map((band, i) => {
          // Stripes run on past the canvas (across, and before the first / after the last band) so
          // panning to an edge never shows where the drawing stops.
          const start = i === 0 ? band.mainStart - BLEED : band.mainStart
          const end = i === layout.bands.length - 1 ? band.mainEnd + BLEED : band.mainEnd
          const across = vertical ? layout.width : layout.height
          return (
            <rect
              key={band.band}
              x={vertical ? -BLEED : start}
              y={vertical ? start : -BLEED}
              width={vertical ? across + BLEED * 2 : end - start}
              height={vertical ? end - start : across + BLEED * 2}
              style={{ fill: i % 2 === 0 ? 'var(--color-night-900)' : 'var(--color-night-950)' }}
            />
          )
        })}
      </g>
      {/* The recommended next steps glow: a soft wide band under each lit path (P5-S4). */}
      <g data-layer="halos" fill="none">
        {scene.paths.map((path) => {
          if (pathStatus(path, progress) !== 'lit') return null
          const unlock = pathUnlock(path, cascade)
          return (
            <path
              key={path.key}
              d={path.d}
              data-edge-halo={path.linkId ?? path.member}
              data-unlock={unlock?.lit ? 'halo' : undefined}
              className={unlock?.lit ? 'animate-unlock-glow' : undefined}
              style={{
                stroke: 'var(--edge-recommended)',
                strokeWidth: EDGE_STYLES[path.type].strokeWidth + HALO_EXTRA,
                strokeLinecap: 'round',
                opacity: 0.3,
                animationDelay: unlock?.lit ? `${unlock.delayMs}ms` : undefined,
              }}
            />
          )
        })}
      </g>
      <g data-layer="edges" fill="none">
        {scene.paths.map((path) => {
          const style = EDGE_STYLES[path.type]
          const status = pathStatus(path, progress)
          const unlock = pathUnlock(path, cascade)
          return (
            <path
              key={path.key}
              d={path.d}
              data-edge-role={path.role}
              data-edge-type={path.type}
              data-link-id={path.linkId}
              data-member={path.member}
              data-in-play={path.inPlay ? 'true' : 'false'}
              data-edge-status={status}
              data-unlock={unlock?.unlock ? 'edge' : undefined}
              markerEnd={path.marker ? `url(#${markerId(path.type)})` : undefined}
              className={cx('transition-opacity duration-(--dur-ui) ease-out-strong', unlock?.unlock && 'animate-unlock-fade')}
              style={{
                stroke: style.color,
                strokeWidth: style.strokeWidth,
                strokeDasharray: style.dash,
                strokeLinecap: style.lineCap,
                // Subdued: the other world evil's branch, or not reachable yet (locked).
                opacity: path.inPlay && status !== 'locked' ? 1 : 0.3,
                animationDelay: unlock?.unlock ? `${unlock.delayMs}ms` : undefined,
              }}
            />
          )
        })}
      </g>
      <g data-layer="badges">
        {scene.badges.map((badge) => {
          const unlock = cascade.links.get(badge.linkId)
          const dimmed = !badge.inPlay || progress.links.get(badge.linkId) === 'locked'
          const badges = (
            <EdgeBadges
              types={badge.types}
              x={badge.x}
              y={badge.y}
              dimmed={dimmed}
              gateMet={progress.openGates.has(badge.linkId)}
              gateDelayMs={unlock?.gate ? unlock.delayMs : undefined}
            />
          )
          return (
            <g key={badge.key} data-badge-link={badge.linkId} data-unlock={unlock?.unlock ? 'badge' : undefined} className={unlock?.unlock ? 'animate-unlock-fade' : undefined} style={unlock?.unlock ? { animationDelay: `${unlock.delayMs}ms` } : undefined}>
              {badges}
            </g>
          )
        })}
      </g>
    </svg>
  )
})

export function NodeMap({
  graph,
  layout,
  options,
  sprites,
  worldEvil,
  nodeStates,
  cascadeBaseline,
  onCascadeShown,
  onCascadeUncover,
  holdCascade = false,
  selectedId,
  detailsId,
  minZoom,
  initialZoom,
  startId,
  bandLabel,
  onSelect,
  ref,
  className,
  controlsClassName = 'right-2 bottom-2',
  controlsRow = false,
  inset,
  nodeHref,
  initialFocusId,
}: NodeMapProps) {
  const content = useMemo(() => ({ width: layout.width, height: layout.height }), [layout])
  const limits = useMemo(() => ({ min: minZoom, max: MAX_ZOOM }), [minZoom])
  // Controls floating over the map — the zoom buttons, and anything beside the map marked
  // `data-map-overlay` (the phone legend toggle): stage labels never slide under them, and an
  // overlay along the bottom edge reserves that strip (below).
  const rootRef = useRef<HTMLDivElement>(null)
  const controlsRef = useRef<HTMLDivElement>(null)
  const [keepOut, setKeepOut] = useState<readonly Box[]>([])
  const [overlayBottom, setOverlayBottom] = useState(0)
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const measure = () => {
      const origin = root.getBoundingClientRect()
      const rect = (element: HTMLElement): Box => {
        const r = element.getBoundingClientRect()
        return { x: r.x - origin.x, y: r.y - origin.y, width: r.width, height: r.height }
      }
      const external = [...(root.parentElement?.querySelectorAll<HTMLElement>(':scope > [data-map-overlay]') ?? [])].map(rect)
      setKeepOut([...(controlsRef.current ? [rect(controlsRef.current)] : []), ...external])
      const reserve = Math.max(0, ...external.filter((r) => r.y + r.height >= origin.height - 16).map((r) => Math.ceil(origin.height - r.y + 8)))
      setOverlayBottom((current) => (current === reserve ? current : reserve))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    return () => observer.disconnect()
  }, [controlsClassName])
  // What covers the map's edges, like an overlay: the caller's inset (the focus card), a row of zoom
  // controls along the bottom, an overlay sitting on the bottom edge. Opening, centring, revealing,
  // fitting and bounded panning all keep the nodes clear of them.
  const insetRight = inset?.right
  const stayingBottom = Math.max(controlsRow ? CONTROLS_ROW_INSET : 0, overlayBottom)
  const insetBottom = Math.max(inset?.bottom ?? 0, stayingBottom)
  const viewInset = useMemo<Inset | undefined>(
    () => (insetRight === undefined && insetBottom === 0 ? undefined : { right: insetRight, bottom: insetBottom }),
    [insetRight, insetBottom],
  )
  // What stays covered once the caller's overlay closes (the controls row, a bottom overlay).
  const baseInset = useMemo<Inset | undefined>(() => (stayingBottom === 0 ? undefined : { bottom: stayingBottom }), [stayingBottom])
  const pz = usePanZoom(content, limits, viewInset)
  const { surfaceRef, handlers } = pz
  const layerRef = useRef<HTMLDivElement>(null)
  const scene = useMemo(() => buildScene(graph, layout, worldEvil), [graph, layout, worldEvil])
  const reading = useMemo(() => layout.layers.flat(), [layout])

  // Open framed on the start (OPENING_FRAME: the opening region on desktop) — again whenever the
  // layout changes (orientation switch). "Go to start" returns to the same view. (Before the cascade
  // below: a cascade waiting at first paint frames itself from this view.)
  const opening = useMemo(() => openingRect(graph, layout, scene, startId), [graph, layout, scene, startId])
  // A deep-linked node opens centred (at the opening zoom); otherwise the opening view.
  const firstFrame = (initialFocusId ? layout.nodes.get(initialFocusId) : undefined) ?? opening
  const centeredFor = useRef<GraphLayout | null>(null)
  const { center, frame, reveal } = pz
  useEffect(() => {
    if (!pz.ready || centeredFor.current === layout) return
    centeredFor.current = layout
    if (firstFrame) frame(firstFrame, { maxK: initialZoom, animate: false })
  }, [pz.ready, layout, firstFrame, initialZoom, frame])

  // The unlock cascade: what to draw (the baseline while it waits for the camera) and when.
  const cascadeFloor = Math.max(minZoom, tapFloorZoom(layout, options))
  const { states: shownStates, schedule: cascade, waiting: cascadeWaiting, busy: cascadeBusy } = useUnlockCascade({
    graph,
    layout,
    nodeStates,
    worldEvil,
    baseline: cascadeBaseline,
    onShown: onCascadeShown,
    onUncover: onCascadeUncover,
    ready: pz.ready && !holdCascade,
    pz,
    limits,
    inset: viewInset,
    baseInset,
    floor: cascadeFloor,
    avoid: keepOut,
  })
  const progress = useMemo(() => mapProgress(graph, shownStates, worldEvil), [graph, shownStates, worldEvil])
  const descriptions = useMemo(
    () => new Map(graph.nodes.map((n) => [n.id, `${describeStatus(graph, progress, n.id)} ${describeNode(graph, n.id, worldEvil)}`])),
    [graph, progress, worldEvil],
  )
  const pad = hitPadding(options)
  const hit = layout.orientation === 'vertical' ? { x: pad.cross, y: pad.main } : { x: pad.main, y: pad.cross }
  const vertical = layout.orientation === 'vertical'
  // What a stage label must keep clear of: every node (with its world tag) and every "or" chip.
  const labelObstacles = useMemo<Box[]>(
    () => [...[...layout.nodes.values()].map((n) => nodeExtent(graph, n)), ...scene.orChips.map(chipExtent)],
    [layout, graph, scene],
  )
  // The stage labels' rendered sizes (they don't scale with the map), measured once laid out.
  const labelElements = useRef(new Map<number, HTMLSpanElement>())
  const [labelSizes, setLabelSizes] = useState<ReadonlyMap<number, Size>>(() => new Map())
  useEffect(() => {
    const elements = labelElements.current
    const observer = new ResizeObserver(() =>
      setLabelSizes(new Map([...elements].map(([band, element]) => [band, { width: element.offsetWidth, height: element.offsetHeight }]))),
    )
    for (const element of elements.values()) observer.observe(element)
    return () => observer.disconnect()
  }, [layout])
  const firstNode = layout.nodes.get(reading[0])

  const nodeButton = (id: string) => layerRef.current?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`) ?? null

  // A show() asked while a cascade has the camera: brought into view (least movement) once it's over.
  const deferredShow = useRef<readonly string[] | null>(null)
  useEffect(() => {
    if (cascadeWaiting || cascade.size > 0 || !deferredShow.current) return
    const rect = unionRect(deferredShow.current.flatMap((id) => layout.nodes.get(id) ?? []))
    deferredShow.current = null
    if (rect) reveal(rect, { animate: true })
  }, [cascadeWaiting, cascade, layout, reveal])

  useImperativeHandle(
    ref,
    () => ({
      show: (ids, { mode = 'reveal' } = {}) => {
        // A cascade framing itself has the camera: the request waits until the cascade is over.
        if (cascadeBusy()) {
          deferredShow.current = ids
          return
        }
        const rect = unionRect(ids.flatMap((id) => layout.nodes.get(id) ?? []))
        if (!rect) return
        if (mode === 'center') center(rect, { k: Math.max(pz.view.k, initialZoom), animate: true })
        else reveal(rect, { animate: true })
      },
      focus: (id) => nodeButton(id)?.focus({ preventScroll: true }),
    }),
    [layout, center, reveal, pz.view.k, initialZoom, cascadeBusy],
  )

  // The last edge step taken with the arrow keys: stepping straight back returns where it came from.
  const lastStep = useRef<{ from: string; to: string; move: MapMove } | null>(null)
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === '+' || event.key === '=') {
      pz.zoomBy(ZOOM_STEP)
      event.preventDefault()
      return
    }
    if (event.key === '-' || event.key === '_') {
      pz.zoomBy(1 / ZOOM_STEP)
      event.preventDefault()
      return
    }
    const move = KEY_MOVES[layout.orientation][event.key]
    const from = (event.target as HTMLElement).closest<HTMLElement>('[data-node-id]')?.dataset.nodeId
    if (!move || !from) return
    event.preventDefault()
    const last = lastStep.current
    const cameFrom = last && last.to === from && REVERSE[last.move] === move ? last.from : undefined
    const to = traverse(graph, layout, from, move, worldEvil, cameFrom)
    if (!to) return
    lastStep.current = REVERSE[move] ? { from, to, move } : null
    nodeButton(to)?.focus({ preventScroll: true })
  }

  // The page's scroll position as of the last scroll event. Browsers scroll a newly focused element
  // into view BEFORE dispatching its focus events, and fire the scroll event after them — so while
  // a node's focus event runs, this still holds where the page was.
  const pageScroll = useRef({ x: 0, y: 0 })
  useEffect(() => {
    const onScroll = () => {
      pageScroll.current = { x: window.scrollX, y: window.scrollY }
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Keyboard focus keeps the focused node on screen by PANNING the map (pointer focus doesn't move
  // it): undo the browser's scroll to the node's old, clipped position, commit the pan — clear of the
  // controls floating over the map (keepOut: the zoom buttons, the phone legend toggle) — then let the
  // page scroll only as far as the node's new place needs (e.g. when the map is half scrolled away).
  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    const id = target.dataset.nodeId
    if (!id || !target.matches(':focus-visible') || cascadeBusy()) return
    const box = layout.nodes.get(id)
    if (!box) return
    const { x: px, y: py } = pageScroll.current
    if (window.scrollX !== px || window.scrollY !== py) window.scrollTo(px, py)
    flushSync(() => reveal(nodeExtent(graph, box), { avoid: keepOut }))
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  const { x, y, k } = pz.view
  const layerStyle = {
    width: layout.width,
    height: layout.height,
    transform: `translate(${x}px, ${y}px) scale(${k})`,
    transition: pz.animated ? 'transform var(--dur-ui) var(--ease-out-strong)' : undefined,
    willChange: pz.dragging ? 'transform' : undefined,
    '--map-zoom': k,
    '--map-ring': `calc(var(--pixel) / ${k})`,
  } as CSSProperties
  const bandLabels = placeBandLabels({
    orientation: layout.orientation,
    bands: layout.bands,
    view: pz.view,
    viewport: pz.viewport,
    sizes: labelSizes,
    obstacles: labelObstacles,
    keepOut,
  })

  return (
    // overflow-clip, not hidden: a clip box can't be scrolled, so focusing an off-screen node never
    // scrolls the map behind the transform's back (the focus handler pans instead).
    <div ref={rootRef} className={cx('overflow-clip bg-surface-sunken', className ?? 'relative h-full')}>
      <div
        ref={surfaceRef}
        {...handlers}
        role="group"
        aria-roledescription="map"
        aria-label="Boss progression map"
        aria-describedby={INSTRUCTIONS_ID}
        data-orientation={layout.orientation}
        className={cx('absolute inset-0 touch-none select-none', pz.dragging ? 'cursor-grabbing' : 'cursor-grab')}
      >
        <div ref={layerRef} className="absolute top-0 left-0 origin-top-left" style={layerStyle} onKeyDown={onKeyDown} onFocus={onFocus}>
          <MapDrawing layout={layout} scene={scene} progress={progress} cascade={cascade} />
          {scene.orChips.map((chip) => (
            <span
              key={chip.key}
              aria-hidden="true"
              data-or-chip=""
              className="absolute -translate-1/2 border border-night-400 bg-night-950 px-1 text-xs leading-4 font-semibold text-night-200"
              style={{ left: chip.x, top: chip.y }}
            >
              or
            </span>
          ))}
          <ol aria-label="Bosses, events and milestones in progression order" className="m-0 list-none p-0">
            {reading.map((id) => {
              const node = graph.nodeById.get(id)
              const box = layout.nodes.get(id)
              if (!node || !box) return null
              return (
                <li key={id}>
                  <BossNode
                    node={node}
                    box={box}
                    sprites={sprites}
                    inPlay={isNodeActive(node, worldEvil)}
                    selected={selectedId === id}
                    state={shownStates[id]}
                    status={progress.nodes.get(id)}
                    unlock={cascade.nodes.get(id)}
                    describedBy={descriptionId(id)}
                    controls={detailsId}
                    hit={hit}
                    onSelect={onSelect}
                    href={nodeHref?.(id)}
                  />
                  <span id={descriptionId(id)} hidden>
                    {descriptions.get(id)}
                  </span>
                </li>
              )
            })}
          </ol>
        </div>
      </div>
      {/* Stage labels in screen space (./nodeMap/bandLabels): each rides its stripe, clear of the nodes. Decorative. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        {bandLabels.map((placed) => (
          <span
            key={placed.band}
            ref={(element) => {
              if (element) labelElements.current.set(placed.band, element)
              else labelElements.current.delete(placed.band)
            }}
            data-band-label={placed.band}
            data-shown={placed.shown ? 'true' : 'false'}
            className={cx(
              'absolute top-0 left-0 border border-panel-border bg-night-950/85 px-1.5 py-1 text-xs leading-none font-semibold tracking-wide whitespace-nowrap text-fg-muted uppercase',
              'transition-opacity duration-(--dur-ui) ease-out-strong',
              !placed.shown && 'opacity-0',
            )}
            style={{ transform: `translate(${Math.round(placed.x)}px, ${Math.round(placed.y)}px)` }}
          >
            {bandLabel(placed.band)}
          </span>
        ))}
      </div>
      <p id={INSTRUCTIONS_ID} className="sr-only">
        {`Drag to pan; zoom with the mouse wheel, a pinch, or the zoom buttons. Tab moves through the nodes in progression order; the ${
          vertical ? 'down and up' : 'right and left'
        } arrow keys follow the connections forward and back, the ${vertical ? 'left and right arrows step along a row' : 'up and down arrows step along a column'}. Enter opens a node’s details${nodeHref ? ', or its page when it has one' : ''}.`}
      </p>
      <div
        ref={controlsRef}
        className={cx('absolute z-(--z-hud) flex border-2 border-panel-border bg-surface shadow-pixel-drop', controlsRow ? 'flex-row' : 'flex-col', controlsClassName)}
        data-map-controls={controlsRow ? 'row' : 'column'}
      >
        <MapButton label="Zoom in" row={controlsRow} onClick={() => pz.zoomBy(ZOOM_STEP)} disabled={k >= MAX_ZOOM - 1e-6}>
          <Plus aria-hidden="true" className="size-5" />
        </MapButton>
        <MapButton label="Zoom out" row={controlsRow} onClick={() => pz.zoomBy(1 / ZOOM_STEP)} disabled={k <= minZoom + 1e-6}>
          <Minus aria-hidden="true" className="size-5" />
        </MapButton>
        <MapButton label="Fit all" row={controlsRow} onClick={() => pz.fitAll(firstNode)}>
          <Scan aria-hidden="true" className="size-5" />
        </MapButton>
        {opening ? (
          <MapButton label="Go to start" row={controlsRow} onClick={() => frame(opening, { maxK: initialZoom, animate: true })}>
            <LocateFixed aria-hidden="true" className="size-5" />
          </MapButton>
        ) : null}
      </div>
    </div>
  )
}

type NodeStates = Readonly<Record<string, NodeState>>

/** How long a cascade waits for the overlay it asked to close before framing beside it instead. */
const UNCOVER_WAIT_MS = 400

interface CascadeInput {
  graph: MapGraph
  layout: GraphLayout
  nodeStates: NodeStates
  worldEvil: WorldEvil | null
  /** What the map last showed (absent: no cascade). */
  baseline: NodeStates | undefined
  onShown: (() => void) | undefined
  onUncover: (() => void) | undefined
  /** The map (and any overlay over it) is measured: the cascade may frame itself. */
  ready: boolean
  pz: PanZoom
  limits: ZoomLimits
  /** Covered map edges now (the caller's overlay included), and once that overlay closes. */
  inset: Inset | undefined
  baseInset: Inset | undefined
  /** Lowest zoom a cascade may be framed at beside the overlay (./nodeMap/cascadeCamera). */
  floor: number
  /** Controls floating over the map (map-box px): the cascade is framed clear of them. */
  avoid: readonly Box[]
}

interface CascadeOutput {
  /** The node states to draw: the baseline while a cascade waits to be framed. */
  states: NodeStates
  schedule: UnlockSchedule
  /** A cascade is waiting to be framed. */
  waiting: boolean
  /** A cascade is waiting or its camera is still moving: other camera moves hold off. */
  busy: () => boolean
}

/**
 * The unlock cascade (UX_SPEC §12; design review P5-S4 H1/M1/M2). A change from the baseline is
 * PENDING — the baseline still drawn — until the map is ready; then the camera plan
 * (./nodeMap/cascadeCamera) runs: uncover the map first if the region can't fit beside the overlay
 * (the caller closes it; this waits for the inset to clear), else pan to show the region and start
 * the cascade CASCADE_LEAD_MS later (no pan: at once; reduced motion: at once, no stagger). Once
 * playing, the caller catches the baseline up and the schedule is held until its last element has
 * finished, so the running animations are never cut short.
 */
function useUnlockCascade({ graph, layout, nodeStates, worldEvil, baseline, onShown, onUncover, ready, pz, limits, inset, baseInset, floor, avoid }: CascadeInput): CascadeOutput {
  const reducedMotion = useReducedMotion()
  const position = useMemo(() => crossPositions(layout), [layout])
  const live = useMemo(
    () =>
      !baseline || baseline === nodeStates
        ? EMPTY_SCHEDULE
        : unlockSchedule(graph, mapProgress(graph, baseline, worldEvil), mapProgress(graph, nodeStates, worldEvil), { reducedMotion, position }),
    [graph, nodeStates, worldEvil, baseline, reducedMotion, position],
  )
  // The cascade started for `states` (`done` once its last element has finished).
  const [playing, setPlaying] = useState<{ states: NodeStates; schedule: UnlockSchedule; cameraUntil: number; done: boolean } | null>(null)
  const current = playing?.states === nodeStates ? playing : null
  const pending = live.size > 0 && !current

  // Frame, then play. Having asked the caller to uncover the map, wait for the inset to change (the
  // overlay gone) — or, should it stay, give up after UNCOVER_WAIT_MS and frame beside it.
  const uncoverWait = useRef<{ states: NodeStates; inset: Inset | undefined; expired: boolean } | null>(null)
  const waitTimer = useRef(0)
  const [waitedOut, setWaitedOut] = useState(0)
  useEffect(() => () => window.clearTimeout(waitTimer.current), [])
  const { current: viewNow, go, box } = pz
  useEffect(() => {
    if (!pending || !ready) return
    const asked = uncoverWait.current?.states === nodeStates ? uncoverWait.current : null
    if (asked && asked.inset === inset && !asked.expired) return
    const region = cascadeRegion(graph, layout, live)
    const plan = region
      ? planCascadeCamera({
          region,
          view: viewNow(),
          content: { width: layout.width, height: layout.height },
          box,
          inset,
          uncoveredInset: baseInset,
          limits,
          floor,
          canUncover: onUncover !== undefined && !asked,
          avoid,
        })
      : { view: null, uncover: false }
    if (plan.uncover) {
      const wait = { states: nodeStates, inset, expired: false }
      uncoverWait.current = wait
      window.clearTimeout(waitTimer.current)
      waitTimer.current = window.setTimeout(() => {
        wait.expired = true
        setWaitedOut((n) => n + 1)
      }, UNCOVER_WAIT_MS)
      onUncover?.()
      return
    }
    if (plan.view) go(plan.view, { animate: true })
    const lead = plan.view && !reducedMotion ? CASCADE_LEAD_MS : 0
    setPlaying({ states: nodeStates, schedule: withLead(live, lead), cameraUntil: performance.now() + lead, done: false })
  }, [pending, ready, live, nodeStates, graph, layout, box, inset, baseInset, limits, floor, avoid, onUncover, reducedMotion, viewNow, go, waitedOut])

  // The map shows the current states (playing, or nothing to play): the caller catches the baseline up.
  useEffect(() => {
    if (baseline && baseline !== nodeStates && (current || live.size === 0)) onShown?.()
  }, [baseline, nodeStates, current, live, onShown])
  useEffect(() => {
    if (!playing || playing.done) return
    const timer = window.setTimeout(() => setPlaying((p) => (p === playing ? { ...p, done: true } : p)), playing.schedule.durationMs + 100)
    return () => window.clearTimeout(timer)
  }, [playing])

  const busyState = useRef({ pending, cameraUntil: 0 })
  useLayoutEffect(() => {
    busyState.current = { pending, cameraUntil: current?.cameraUntil ?? 0 }
  })
  const busy = useCallback(() => busyState.current.pending || performance.now() < busyState.current.cameraUntil, [])

  return {
    states: pending && baseline ? baseline : nodeStates,
    schedule: current && !current.done ? current.schedule : EMPTY_SCHEDULE,
    waiting: pending,
    busy,
  }
}

function MapButton({ label, row, onClick, disabled = false, children }: { label: string; row: boolean; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'grid min-h-tap min-w-tap place-items-center text-fg transition-colors duration-(--dur-ui) not-last:border-panel-border hover:bg-night-700 disabled:text-stone-600 disabled:hover:bg-transparent',
        row ? 'not-last:border-r-2' : 'not-last:border-b-2',
      )}
    >
      {children}
    </button>
  )
}
