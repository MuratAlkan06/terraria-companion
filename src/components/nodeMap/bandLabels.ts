/**
 * Where the stage-band labels sit on screen (UX_SPEC §3.7). Pure: the map passes its view, the
 * measured label sizes and the boxes the labels must keep clear of (nodes, their world tags, the
 * "or" chips), all in map px except the label sizes (screen px — labels don't scale with zoom).
 *
 * - A label's home is the map's leading edge (left on the vertical map, top on the horizontal one),
 *   riding its own band like a sticky header: at the band's start, kept on screen while the band is,
 *   pushed out by the next band.
 * - It never covers a node. Where its home spot would, it moves — first across the flow, along the
 *   band's start, past the nodes in the way (it stays at the band's start, like a header); else along
 *   the flow into the first gap between layers that is clear. With no clear spot on screen it fades out.
 * - On the horizontal map "across" is a drop down the band's start column: taken only where nothing
 *   else on screen sits level with the dropped label — beside another column's nodes it would read as
 *   that row's label (design review P5-S1) — so the sideways slot is preferred there, then fading.
 * - A label pushed past the map box's leading edge (its band scrolling out) fades rather than show a
 *   clipped sliver.
 * - A band shorter on screen than its label shows no label (zoomed far out), so neighbouring labels —
 *   each kept inside its own band — can never collide.
 */
import type { BandExtent, Box, Orientation } from './layout'
import type { Size, View } from './panZoom'

/** Screen px between a label and the map box's edges. */
export const LABEL_EDGE_PX = 8
/** Screen px a label keeps inside its band's ends. */
export const LABEL_BAND_PAD_PX = 4
/** Screen px a label keeps clear of any obstacle. */
export const LABEL_CLEARANCE_PX = 4

export interface BandLabelPlacement {
  band: number
  /** Top-left corner in the map box (screen px). */
  x: number
  y: number
  /** False: faded out (no room in its band on screen, or no spot clear of the nodes). */
  shown: boolean
}

export interface BandLabelInput {
  orientation: Orientation
  bands: readonly Pick<BandExtent, 'band' | 'mainStart' | 'mainEnd'>[]
  view: View
  /** The visible map area (screen px). */
  viewport: Size
  /** Each label's rendered size (screen px); unmeasured labels are placed as if empty. */
  sizes: ReadonlyMap<number, Size>
  /** What labels must not cover (map px). */
  obstacles: readonly Box[]
  /** Controls floating over the map that labels must not slide under (screen px, map-box relative). */
  keepOut?: readonly Box[]
}

interface Span {
  start: number
  end: number
}

const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end
const span = (start: number, length: number): Span => ({ start, end: start + length })

export function placeBandLabels({ orientation, bands, view, viewport, sizes, obstacles, keepOut = [] }: BandLabelInput): BandLabelPlacement[] {
  const vertical = orientation === 'vertical'
  const offset = vertical ? view.y : view.x
  const viewMain = vertical ? viewport.height : viewport.width
  const viewCross = vertical ? viewport.width : viewport.height
  // Obstacles on screen, as their extent along the flow (main) and across it (cross), padded.
  const onScreen = (b: Box) => {
    const pad = LABEL_CLEARANCE_PX
    const x = span(b.x - pad, b.width + pad * 2)
    const y = span(b.y - pad, b.height + pad * 2)
    return vertical ? { main: y, cross: x } : { main: x, cross: y }
  }
  const boxes = [
    ...obstacles.map((b) => onScreen({ x: b.x * view.k + view.x, y: b.y * view.k + view.y, width: b.width * view.k, height: b.height * view.k })),
    ...keepOut.map(onScreen),
  ]

  return bands.map(({ band, mainStart, mainEnd }) => {
    const size = sizes.get(band) ?? { width: 0, height: 0 }
    const length = vertical ? size.height : size.width
    const thickness = vertical ? size.width : size.height
    const start = mainStart * view.k + offset
    const end = mainEnd * view.k + offset
    // The band's room for its label, and the label's sticky spot within it.
    const first = start + LABEL_BAND_PAD_PX
    const last = end - LABEL_BAND_PAD_PX - length
    const sticky = Math.min(Math.max(first, LABEL_EDGE_PX), last)
    const at = (main: number, cross = LABEL_EDGE_PX, shown = true): BandLabelPlacement => ({
      band,
      ...(vertical ? { x: cross, y: main } : { x: main, y: cross }),
      shown,
    })
    if (last < first || sticky < 0) return at(sticky, LABEL_EDGE_PX, false)

    const blocking = (main: number, cross: number) => boxes.filter((b) => overlaps(b.main, span(main, length)) && overlaps(b.cross, span(cross, thickness)))
    const clear = (main: number, cross: number) => blocking(main, cross).length === 0
    if (clear(sticky, LABEL_EDGE_PX)) return at(sticky)
    // Horizontal map: a dropped label must not sit level with anything on screen beside it.
    const onView = (s: Span) => s.end > 0 && s.start < viewMain
    const alone = (main: number, cross: number) =>
      vertical || !boxes.some((b) => onView(b.main) && !overlaps(b.main, span(main, length)) && overlaps(b.cross, span(cross, thickness)))
    // Across the flow, still at the band's start: just past one of the obstacles in the way.
    const crossLimit = viewCross - LABEL_EDGE_PX - thickness
    const across = boxes
      .filter((b) => overlaps(b.main, span(sticky, length)))
      .map((b) => b.cross.end)
      .filter((c) => c > LABEL_EDGE_PX && c <= crossLimit)
      .sort((a, b) => a - b)
      .find((c) => clear(sticky, c) && alone(sticky, c))
    if (across !== undefined) return at(sticky, across)
    // Along the flow, at the leading edge: the first gap past an obstacle, inside the band and on screen.
    const mainLimit = Math.min(last, viewMain - LABEL_EDGE_PX - length)
    const along = boxes
      .filter((b) => overlaps(b.cross, span(LABEL_EDGE_PX, thickness)))
      .map((b) => b.main.end)
      .filter((m) => m > sticky && m <= mainLimit)
      .sort((a, b) => a - b)
      .find((m) => clear(m, LABEL_EDGE_PX))
    if (along !== undefined) return at(along)
    return at(sticky, LABEL_EDGE_PX, false)
  })
}
