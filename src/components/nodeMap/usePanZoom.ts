import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import {
  boundView,
  centerOn,
  fitView,
  frameRect,
  revealClear,
  revealRect,
  uncovered,
  wheelFactor,
  zoomAround,
  type Inset,
  type Rect,
  type Size,
  type View,
  type ZoomLimits,
} from './panZoom'

/**
 * Pan/zoom controller for the progression map (UX_SPEC §7). Pointer Events cover mouse, pen and
 * touch alike: one pointer drags, two pointers pinch (zooming about their midpoint), the wheel
 * zooms about the cursor. A press that moves less than the drag threshold stays a click, so nodes
 * remain buttons; a real drag swallows the click that follows it.
 *
 * `animated` is true only for button-driven changes (+/−, fit, centre); direct manipulation and
 * keyboard moves apply instantly (UX_SPEC §10.9), and reduced motion zeroes the transition anyway.
 *
 * `inset`: map-box edges covered by an overlay (the focus card). All centring, revealing, fitting
 * and bounds use the uncovered area, so the card never hides the node it describes; when the
 * inset changes the view slides (animated) into the new bounds.
 */
const DRAG_THRESHOLD_PX: Readonly<Record<string, number>> = { mouse: 4, pen: 6, touch: 8 }

export interface PanZoom {
  view: View
  animated: boolean
  /** The uncovered part of the map box (screen px). */
  viewport: Size
  /** True once the map box has been measured. */
  ready: boolean
  dragging: boolean
  /** Ref callback for the pan surface. */
  surfaceRef: (element: HTMLDivElement | null) => void
  handlers: {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => void
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => void
    onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void
    onClickCapture: (event: MouseEvent<HTMLDivElement>) => void
  }
  /** Zoom about the viewport centre (animated). */
  zoomBy: (factor: number) => void
  /** The whole map in view; where the zoom floor stops it short, `anchor` (the map's start) stays in view. */
  fitAll: (anchor?: Rect) => void
  /** Centre a map rect, optionally at a given zoom. */
  center: (rect: Rect, options?: { k?: number; animate?: boolean }) => void
  /** Frame a map rect: as large as fits, never above `maxK` (panZoom.frameRect). */
  frame: (rect: Rect, options: { maxK: number; animate?: boolean }) => void
  /**
   * Smallest pan that brings a map rect into view (instant unless `animate`); with `avoid` (controls
   * over the map, screen px) also clear of those (panZoom.revealClear).
   */
  reveal: (rect: Rect, options?: { animate?: boolean; avoid?: readonly Rect[] }) => void
}

interface Gesture {
  pointers: Map<number, { x: number; y: number }>
  start: View
  /** Single-pointer drag origin. */
  origin?: { x: number; y: number; type: string }
  /** Pinch origin: distance and midpoint (viewport px) when the second pointer landed. */
  pinch?: { distance: number; mid: { x: number; y: number } }
  moved: boolean
}

const NO_INSET: Inset = {}

export function usePanZoom(content: Size, limits: ZoomLimits, inset: Inset = NO_INSET): PanZoom {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const [box, setBox] = useState<Size>({ width: 0, height: 0 })
  const viewport = useMemo(() => uncovered(box, inset), [box, inset])
  const [view, setViewState] = useState<View>({ x: 0, y: 0, k: 1 })
  const [animated, setAnimated] = useState(false)
  const [dragging, setDragging] = useState(false)
  const viewRef = useRef(view)
  const gesture = useRef<Gesture | null>(null)
  const swallowClick = useRef(false)
  // Latest sizes/limits for the event handlers (synced after render, before any effect reads them).
  const env = useRef({ content, viewport, limits })
  useLayoutEffect(() => {
    env.current = { content, viewport, limits }
  })

  // `allow`: a view at the same zoom the bounds stretch to include (boundView).
  const apply = useCallback((next: View, animate: boolean, allow?: View) => {
    const { content: c, viewport: v, limits: l } = env.current
    const k = Math.min(l.max, Math.max(l.min, next.k))
    const bounded = boundView({ ...next, k }, c, v, allow?.k === k ? allow : undefined)
    viewRef.current = bounded
    setAnimated(animate)
    setViewState(bounded)
  }, [])

  // Track the viewport size; re-bound the view when it (or the map) changes size.
  useEffect(() => {
    if (!element) return
    const measure = () => setBox({ width: element.clientWidth, height: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  const lastInset = useRef(inset)
  useEffect(() => {
    if (box.width === 0) return
    const insetChanged = lastInset.current !== inset
    lastInset.current = inset
    apply(viewRef.current, insetChanged)
  }, [box, inset, content.width, content.height, limits.min, limits.max, apply])

  const localPoint = (event: { clientX: number; clientY: number }) => {
    const rect = element?.getBoundingClientRect()
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }
  }

  // Wheel zoom needs a non-passive listener (React's onWheel is passive).
  useEffect(() => {
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const factor = wheelFactor(event.deltaY, event.deltaMode, event.ctrlKey)
      apply(zoomAround(viewRef.current, factor, event.clientX - rect.left, event.clientY - rect.top, env.current.limits), false)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [element, apply])

  const restartFrom = (g: Gesture) => {
    g.start = viewRef.current
    const points = [...g.pointers.values()]
    if (points.length >= 2) {
      const [a, b] = points
      g.pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
      g.origin = undefined
    } else if (points.length === 1) {
      g.pinch = undefined
      g.origin = { ...points[0], type: g.origin?.type ?? 'touch' }
    }
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const point = localPoint(event)
    const g: Gesture = gesture.current ?? { pointers: new Map(), start: viewRef.current, moved: false }
    g.pointers.set(event.pointerId, point)
    if (g.pointers.size === 1) {
      // A new gesture: a pinch or drag that ended without a click must not eat this one's click.
      swallowClick.current = false
      g.start = viewRef.current
      g.origin = { ...point, type: event.pointerType }
      g.moved = false
    } else {
      // A second finger: this is a pinch, never a tap.
      g.moved = true
      event.currentTarget.setPointerCapture(event.pointerId)
      restartFrom(g)
      setDragging(true)
    }
    gesture.current = g
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    if (!g || !g.pointers.has(event.pointerId)) return
    const point = localPoint(event)
    g.pointers.set(event.pointerId, point)
    if (g.pinch && g.pointers.size >= 2) {
      const [a, b] = [...g.pointers.values()]
      const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const { min, max } = env.current.limits
      const k = Math.min(max, Math.max(min, g.start.k * (distance / g.pinch.distance)))
      // Keep the map point that was under the starting midpoint under the current midpoint.
      const mapX = (g.pinch.mid.x - g.start.x) / g.start.k
      const mapY = (g.pinch.mid.y - g.start.y) / g.start.k
      apply({ k, x: mid.x - mapX * k, y: mid.y - mapY * k }, false)
      return
    }
    if (!g.origin) return
    const dx = point.x - g.origin.x
    const dy = point.y - g.origin.y
    if (!g.moved) {
      if (Math.hypot(dx, dy) < (DRAG_THRESHOLD_PX[g.origin.type] ?? 6)) return
      g.moved = true
      event.currentTarget.setPointerCapture(event.pointerId)
      setDragging(true)
    }
    // A drag from a view past the bounds (revealClear's) moves from there, never snapping back first.
    apply({ k: g.start.k, x: g.start.x + dx, y: g.start.y + dy }, false, g.start)
  }

  const end = (event: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    if (!g || !g.pointers.has(event.pointerId)) return
    g.pointers.delete(event.pointerId)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (g.pointers.size > 0) {
      restartFrom(g)
      return
    }
    if (g.moved) swallowClick.current = true
    gesture.current = null
    setDragging(false)
  }

  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (!swallowClick.current) return
    swallowClick.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  const zoomBy = useCallback(
    (factor: number) => {
      const { viewport: v, limits: l } = env.current
      apply(zoomAround(viewRef.current, factor, v.width / 2, v.height / 2, l), true)
    },
    [apply],
  )
  const fitAll = useCallback(
    (anchor?: Rect) => {
      const { content: c, viewport: v, limits: l } = env.current
      apply(fitView(c, v, l, anchor), true)
    },
    [apply],
  )
  const center = useCallback(
    (rect: Rect, options: { k?: number; animate?: boolean } = {}) => {
      const { content: c, viewport: v } = env.current
      apply(centerOn(rect, options.k ?? viewRef.current.k, c, v), options.animate ?? true)
    },
    [apply],
  )
  const frame = useCallback(
    (rect: Rect, options: { maxK: number; animate?: boolean }) => {
      const { content: c, viewport: v, limits: l } = env.current
      apply(frameRect(rect, options.maxK, c, v, l), options.animate ?? true)
    },
    [apply],
  )
  const reveal = useCallback(
    (rect: Rect, options: { animate?: boolean; avoid?: readonly Rect[] } = {}) => {
      const { content: c, viewport: v } = env.current
      if (options.avoid?.length) {
        const clear = revealClear(viewRef.current, rect, c, v, options.avoid)
        apply(clear, options.animate ?? false, clear)
      } else apply(revealRect(viewRef.current, rect, c, v), options.animate ?? false)
    },
    [apply],
  )

  return {
    view,
    animated,
    viewport,
    ready: box.width > 0 && box.height > 0,
    dragging,
    surfaceRef: setElement,
    handlers: { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end, onClickCapture },
    zoomBy,
    fitAll,
    center,
    frame,
    reveal,
  }
}
