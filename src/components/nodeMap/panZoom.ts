/**
 * Pan/zoom math for the progression map (UX_SPEC §7: drag + wheel on desktop; one-finger pan,
 * pinch and on-screen +/− on touch; "fit all"; auto-centre). Pure functions over a view
 * `{ x, y, k }`: a map point p is drawn at screen point p·k + (x, y) inside the viewport.
 *
 * `viewport` here is the UNCOVERED area: the map box minus any overlay docked on its right or
 * bottom edge (the focus card), so centring, revealing and bounds all keep clear of it.
 *
 * Panning is bounded: on an axis where the scaled map is larger than the viewport it can't be
 * dragged further than PAN_SLACK past its edge; where it is smaller it is centred. The one exception
 * is revealClear's pan out from under a control, which the bounds stretch to allow.
 */
export interface View {
  x: number
  y: number
  k: number
}

export interface Size {
  width: number
  height: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface ZoomLimits {
  min: number
  max: number
}

/** Map-box edges covered by an overlay (screen px). */
export interface Inset {
  right?: number
  bottom?: number
}

/** How far (screen px) the map may be dragged past its edge. */
export const PAN_SLACK = 16

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** The part of the map box not covered by the inset. */
export function uncovered(box: Size, inset: Inset | undefined): Size {
  return { width: Math.max(1, box.width - (inset?.right ?? 0)), height: Math.max(1, box.height - (inset?.bottom ?? 0)) }
}

function boundAxis(offset: number, scaled: number, viewportSize: number, allow: number | undefined): number {
  const centred = (viewportSize - scaled) / 2
  const [min, max] = scaled <= viewportSize - PAN_SLACK * 2 ? [centred, centred] : [viewportSize - PAN_SLACK - scaled, PAN_SLACK]
  return clamp(offset, Math.min(min, allow ?? min), Math.max(max, allow ?? max))
}

/**
 * Keeps the map in view (see module doc). `allow`: an offset the bounds stretch to include — a view
 * revealClear placed past them (a node brought out from under a control) stays allowed, e.g. while a
 * drag starts from it.
 */
export function boundView(view: View, content: Size, viewport: Size, allow?: Pick<View, 'x' | 'y'>): View {
  return {
    k: view.k,
    x: boundAxis(view.x, content.width * view.k, viewport.width, allow?.x),
    y: boundAxis(view.y, content.height * view.k, viewport.height, allow?.y),
  }
}

/** Zoom by `factor` keeping the map point under screen point (px, py) fixed. */
export function zoomAround(view: View, factor: number, px: number, py: number, limits: ZoomLimits): View {
  const k = clamp(view.k * factor, limits.min, limits.max)
  const ratio = k / view.k
  return { k, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio }
}

/**
 * The whole map in view, as large as fits (within the zoom limits, never above 1×), centred. When the
 * zoom floor stops it short of fitting (a touch screen's tap-target floor), each axis the map still
 * overflows centres `anchor` instead — the map's start — then bounds, so the view lands at the
 * beginning of the tree rather than somewhere in its middle.
 */
export function fitView(content: Size, viewport: Size, limits: ZoomLimits, anchor?: Rect): View {
  const pad = PAN_SLACK * 2
  const k = clamp(Math.min((viewport.width - pad) / content.width, (viewport.height - pad) / content.height), limits.min, Math.min(1, limits.max))
  // One axis: centre the anchor where the map overflows (so the bound pins the start), else the map.
  const axis = (size: number, view: number, anchorCenter: number | undefined) =>
    anchorCenter !== undefined && size * k > view - pad ? view / 2 - anchorCenter * k : (view - size * k) / 2
  const x = axis(content.width, viewport.width, anchor && anchor.x + anchor.width / 2)
  const y = axis(content.height, viewport.height, anchor && anchor.y + anchor.height / 2)
  return boundView({ k, x, y }, content, viewport)
}

/** `rect` centred in the viewport at zoom k (then bounded, so the map's start never drifts inward). */
export function centerOn(rect: Rect, k: number, content: Size, viewport: Size): View {
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  return boundView({ k, x: viewport.width / 2 - cx * k, y: viewport.height / 2 - cy * k }, content, viewport)
}

/**
 * `rect` framed: as large as fits the viewport with `margin` clear on every side — never above `maxK`
 * (the opening zoom) nor outside the zoom limits — and centred on it, then bounded.
 */
export function frameRect(rect: Rect, maxK: number, content: Size, viewport: Size, limits: ZoomLimits, margin = PAN_SLACK): View {
  const fit = Math.min((viewport.width - margin * 2) / rect.width, (viewport.height - margin * 2) / rect.height)
  const k = clamp(Math.min(maxK, fit), limits.min, Math.min(maxK, limits.max))
  return centerOn(rect, k, content, viewport)
}

/** The smallest pan that brings `rect` (plus `margin` screen px) fully into view. */
export function revealRect(view: View, rect: Rect, content: Size, viewport: Size, margin = 24): View {
  const left = rect.x * view.k + view.x
  const top = rect.y * view.k + view.y
  const right = left + rect.width * view.k
  const bottom = top + rect.height * view.k
  let { x, y } = view
  if (left < margin) x += margin - left
  else if (right > viewport.width - margin) x -= right - (viewport.width - margin)
  if (top < margin) y += margin - top
  else if (bottom > viewport.height - margin) y -= bottom - (viewport.height - margin)
  return boundView({ k: view.k, x, y }, content, viewport)
}

/** Gap (screen px) revealClear leaves between a revealed rect and a control it clears. */
export const OBSTRUCTION_GAP = 8

/**
 * revealRect, then clear of `obstructions` — controls floating over the map (screen px, in viewport
 * coordinates): where the revealed rect would still sit under one, the shortest further pan (left,
 * right, up or down) that leaves `gap` between them while the rect stays fully in view and clear of
 * the others. That pan may go past the panning bounds (a node at the map's edge under a control has
 * nowhere else to go): the result is NOT re-bounded — the caller allows it (boundView `allow`).
 */
export function revealClear(view: View, rect: Rect, content: Size, viewport: Size, obstructions: readonly Rect[], margin = 24, gap = OBSTRUCTION_GAP): View {
  const revealed = revealRect(view, rect, content, viewport, margin)
  const screen = (v: View) => ({ x: rect.x * v.k + v.x, y: rect.y * v.k + v.y, width: rect.width * v.k, height: rect.height * v.k })
  const under = (r: Rect, o: Rect) => r.x < o.x + o.width + gap && o.x < r.x + r.width + gap && r.y < o.y + o.height + gap && o.y < r.y + r.height + gap
  const s = screen(revealed)
  const hit = obstructions.find((o) => under(s, o))
  if (!hit) return revealed
  const moves = [
    { dx: hit.x - gap - (s.x + s.width), dy: 0 },
    { dx: hit.x + hit.width + gap - s.x, dy: 0 },
    { dx: 0, dy: hit.y - gap - (s.y + s.height) },
    { dx: 0, dy: hit.y + hit.height + gap - s.y },
  ]
  const best = moves
    .map((m) => ({ ...m, r: { ...s, x: s.x + m.dx, y: s.y + m.dy } }))
    .filter(({ r }) => r.x >= 0 && r.y >= 0 && r.x + r.width <= viewport.width && r.y + r.height <= viewport.height && !obstructions.some((o) => under(r, o)))
    .sort((a, b) => Math.abs(a.dx) + Math.abs(a.dy) - (Math.abs(b.dx) + Math.abs(b.dy)))[0]
  return best ? { k: revealed.k, x: revealed.x + best.dx, y: revealed.y + best.dy } : revealed
}

/** Bounding rect of several rects. */
export function unionRect(rects: readonly Rect[]): Rect | undefined {
  if (rects.length === 0) return undefined
  const x = Math.min(...rects.map((r) => r.x))
  const y = Math.min(...rects.map((r) => r.y))
  return {
    x,
    y,
    width: Math.max(...rects.map((r) => r.x + r.width)) - x,
    height: Math.max(...rects.map((r) => r.y + r.height)) - y,
  }
}

/** Wheel delta → zoom factor (trackpad pinch arrives as ctrl+wheel with small deltas). */
export function wheelFactor(deltaY: number, deltaMode: number, ctrlKey: boolean): number {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY
  return Math.exp(-pixels * (ctrlKey ? 0.01 : 0.0015))
}
