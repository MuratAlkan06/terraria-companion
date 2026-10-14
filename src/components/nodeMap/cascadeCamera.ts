/**
 * Framing the unlock cascade (UX_SPEC §12; design review P5-S4 H1/M1). Pure.
 *
 * A cascade plays where it can be seen: before it starts, the camera brings its REGION — the nodes
 * it touches and the far ends of the lines it lights — into the part of the map no overlay covers
 * (the focus card on the right from lg, along the bottom below). When the region already shows
 * there, the camera stays put. When it can't fit beside the card at a usable zoom (nodes still
 * ≥ 44px tap targets: mapConfig.tapFloorZoom), the plan asks for the map to be uncovered first — the
 * card closes — and frames the region in the whole map. The cascade then waits CASCADE_LEAD_MS for
 * the 200ms pan to finish, so the two never move at once.
 */
import type { MapGraph } from './graph'
import type { GraphLayout } from './layout'
import { frameRect, OBSTRUCTION_GAP, revealRect, uncovered, unionRect, type Inset, type Rect, type Size, type View, type ZoomLimits } from './panZoom'
import { UNLOCK_DURATION_MS, UNLOCK_STAGGER_MS, type UnlockSchedule } from './progressView'
import { nodeExtent } from './scene'

/** The camera's pan (the map layer's `--dur-ui` transform transition), then one stagger step's rest. */
export const CASCADE_PAN_MS = UNLOCK_DURATION_MS
export const CASCADE_LEAD_MS = CASCADE_PAN_MS + UNLOCK_STAGGER_MS

/** Clearance (screen px) kept around a framed region; and the least a region in view may have. */
export const CASCADE_MARGIN = 24
const IN_VIEW_MARGIN = 8

/** Each node's position along its layer (cross-axis centre, map px): the cascade's ripple order. */
export function crossPositions(layout: GraphLayout): Map<string, number> {
  const vertical = layout.orientation === 'vertical'
  return new Map([...layout.nodes].map(([id, n]) => [id, vertical ? n.x + n.width / 2 : n.y + n.height / 2]))
}

/**
 * The map area a cascade plays in: every node it changes, and both ends of every line that comes up
 * or lights. (A line whose only change is its gate badge — its target still waiting on another gate,
 * like Skeletron's to the Lunatic Cultist — doesn't pull the camera across the map.)
 */
export function cascadeRegion(graph: MapGraph, layout: GraphLayout, schedule: UnlockSchedule): Rect | undefined {
  const ids = new Set(schedule.nodes.keys())
  for (const link of graph.links) {
    const change = schedule.links.get(link.id)
    if (!change || !(change.unlock || change.lit)) continue
    ids.add(link.from)
    ids.add(link.to)
  }
  for (const member of schedule.branches.keys()) ids.add(member)
  return unionRect([...ids].flatMap((id) => {
    const node = layout.nodes.get(id)
    return node ? [nodeExtent(graph, node)] : []
  }))
}

/** Where a map rect lands on screen under a view. */
export const onScreen = (rect: Rect, view: View): Rect => ({ x: rect.x * view.k + view.x, y: rect.y * view.k + view.y, width: rect.width * view.k, height: rect.height * view.k })

/** Is the map rect fully inside the viewport (with `margin` screen px to spare)? */
export function inView(rect: Rect, view: View, viewport: Size, margin = 0): boolean {
  const s = onScreen(rect, view)
  return s.x >= margin && s.y >= margin && s.x + s.width <= viewport.width - margin && s.y + s.height <= viewport.height - margin
}

/** The largest zoom at which the rect fits the viewport with `margin` on every side. */
export function fitZoom(rect: Rect, viewport: Size, margin = CASCADE_MARGIN): number {
  return Math.min((viewport.width - margin * 2) / Math.max(1, rect.width), (viewport.height - margin * 2) / Math.max(1, rect.height))
}

/**
 * The view that shows the rect in the viewport with the least change: the smallest pan where it fits
 * at the current zoom, else framed (zoomed out to fit, centred; never below the zoom floor).
 */
export function showRegion(rect: Rect, view: View, content: Size, viewport: Size, limits: ZoomLimits, margin = CASCADE_MARGIN): View {
  if (fitZoom(rect, viewport, margin) >= view.k) return revealRect(view, rect, content, viewport, margin)
  return frameRect(rect, view.k, content, viewport, limits, margin)
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
const clearOf = (rect: Rect, view: View, avoid: readonly Rect[]) => !avoid.some((o) => overlaps(onScreen(rect, view), o))

/**
 * showRegion, also clear of the controls floating over the map (`avoid`, screen px): where the region
 * would sit under one, it is framed beside it instead — left of a control on the right half of the
 * map, above one on the bottom half (the result may lie past the panning bounds: move there allowing
 * it). Best effort: if no such framing shows the whole region, the plain one.
 */
export function showRegionClear(rect: Rect, view: View, content: Size, viewport: Size, limits: ZoomLimits, avoid: readonly Rect[] = []): View {
  const plain = showRegion(rect, view, content, viewport, limits)
  const hits = avoid.filter((o) => overlaps(onScreen(rect, plain), o))
  if (hits.length === 0) return plain
  const narrower: Size[] = []
  const right = Math.min(...hits.filter((o) => o.x > viewport.width / 2).map((o) => o.x))
  const bottom = Math.min(...hits.filter((o) => o.y > viewport.height / 2).map((o) => o.y))
  if (Number.isFinite(right)) narrower.push({ width: right - OBSTRUCTION_GAP, height: viewport.height })
  if (Number.isFinite(bottom)) narrower.push({ width: viewport.width, height: bottom - OBSTRUCTION_GAP })
  for (const area of narrower) {
    const next = showRegion(rect, view, content, area, limits)
    if (inView(rect, next, area) && clearOf(rect, next, avoid)) return next
  }
  return plain
}

export interface CascadeCameraInput {
  /** The cascade's region (map px). */
  region: Rect
  /** The camera now. */
  view: View
  /** The map's size (map px). */
  content: Size
  /** The map box (screen px). */
  box: Size
  /** Map-box edges covered now: the focus card plus anything that stays (a row of zoom controls). */
  inset?: Inset
  /** What stays covered once the card is closed. */
  uncoveredInset?: Inset
  limits: ZoomLimits
  /** The lowest zoom a region may be framed at beside the card; below it, uncover the map. */
  floor: number
  /** False: the card can't be closed — frame in the space beside it, best effort. */
  canUncover: boolean
  /** Controls floating over the map (zoom buttons; screen px in the map box): kept clear of the region. */
  avoid?: readonly Rect[]
}

export interface CascadeCamera {
  /** Where the camera goes before the cascade plays; null when the region already shows. */
  view: View | null
  /** The region doesn't fit beside the card: close the card first, then frame `view` in the whole map. */
  uncover: boolean
}

export function planCascadeCamera({ region, view, content, box, inset, uncoveredInset, limits, floor, canUncover, avoid = [] }: CascadeCameraInput): CascadeCamera {
  const viewport = uncovered(box, inset)
  if (inView(region, view, viewport, IN_VIEW_MARGIN) && clearOf(region, view, avoid)) return { view: null, uncover: false }
  const covered = (inset?.right ?? 0) > (uncoveredInset?.right ?? 0) || (inset?.bottom ?? 0) > (uncoveredInset?.bottom ?? 0)
  if (canUncover && covered && fitZoom(region, viewport) < Math.max(floor, limits.min)) {
    return { view: showRegionClear(region, view, content, uncovered(box, uncoveredInset), limits, avoid), uncover: true }
  }
  return { view: showRegionClear(region, view, content, viewport, limits, avoid), uncover: false }
}
