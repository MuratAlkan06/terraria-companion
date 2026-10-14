/**
 * What the map writes on itself (design review P5-S1): node labels that wrap between words only and
 * are never clipped, and stage-band labels that never cover a node or each other.
 */
import { describe, expect, it } from 'vitest'
import type { Boss, ProgressionEdge, ProgressionNode } from '../../data-access/types'
import bossesJson from '../../data/bosses.json'
import progressionJson from '../../data/progression.json'
import { LABEL_CLEARANCE_PX, LABEL_EDGE_PX, placeBandLabels, type BandLabelPlacement } from './bandLabels'
import { buildMapGraph, labelBox, layoutInputs, NODE_LABEL_BOX, SHORT_LABELS, type MapGraph } from './graph'
import { layoutGraph, type Box, type GraphLayout, type Orientation } from './layout'
import { MAP_LAYOUT_OPTIONS, tapFloorZoom } from './mapConfig'
import type { Size, View } from './panZoom'
import { buildScene } from './scene'

const progression = progressionJson as { nodes: ProgressionNode[]; edges: ProgressionEdge[] }
const graph = buildMapGraph(progression, bossesJson as Boss[])
const layoutFor = (orientation: Orientation, g: MapGraph = graph): GraphLayout => {
  const input = layoutInputs(g)
  return layoutGraph(input.nodes, input.edges, input.groups, MAP_LAYOUT_OPTIONS[orientation])
}

/**
 * Advance widths (CSS px) of the node label font — Inter Variable, weight 600, 12px (BossNode's
 * `text-xs font-semibold`) — measured with canvas `measureText` in Chromium once the font had loaded
 * (2026-10-13). Each glyph is measured alone, without kerning: against the whole-word widths of the
 * real labels the per-glyph sums were off by −0.22…+0.71px, so every measured run is padded by
 * WIDTH_SAFETY_PX — the check errs on the side of "too wide".
 */
const INTER_600_12PX: Readonly<Record<string, number>> = {
  ' ': 3.021, a: 6.89, b: 7.491, c: 6.993, d: 7.491, e: 7.097, f: 4.665, g: 7.507, h: 7.347, i: 3.138, j: 3.138, k: 6.835, l: 3.138,
  m: 10.803, n: 7.343, o: 7.305, p: 7.491, q: 7.491, r: 4.764, s: 6.593, t: 4.238, u: 7.347, v: 7.046, w: 10.073, x: 6.825, y: 7.063,
  z: 6.789, A: 8.733, B: 7.911, C: 8.839, D: 8.664, E: 7.264, F: 7.057, G: 8.989, H: 8.947, I: 3.32, J: 6.957, K: 8.44, L: 6.785,
  M: 11.068, N: 9.111, O: 9.222, P: 7.74, Q: 9.273, R: 7.828, S: 7.805, T: 7.923, U: 8.833, V: 8.733, W: 12.242, X: 8.635, Y: 8.562,
  Z: 7.83, '0': 7.916, '1': 5.077, '2': 7.477, '3': 7.634, '4': 7.995, '5': 7.349, '6': 7.678, '7': 6.915, '8': 7.683, '9': 7.678,
  '-': 5.583, "'": 3.91, '’': 3.528, '!': 3.854, '.': 3.824, ',': 3.824, ':': 3.824, '&': 7.95, '(': 4.476, ')': 4.476,
}
const WIDTH_SAFETY_PX = 1

function textWidth(text: string): number {
  let width = 0
  for (const ch of text) {
    const w = INTER_600_12PX[ch]
    if (w === undefined) throw new Error(`no measured width for "${ch}" — measure it and add it to INTER_600_12PX`)
    width += w
  }
  return width + WIDTH_SAFETY_PX
}

/**
 * How the browser lays a label out with `overflow-wrap: normal`: lines break only between words, or
 * after a hyphen inside one ("Pre-" / "Hardmode"). Greedy fill, as CSS does. `unbreakable` lists the
 * pieces wider than the box — with `overflow-wrap: anywhere` those were broken mid-word.
 */
function wrap(text: string, maxWidth: number): { lines: string[]; unbreakable: string[] } {
  const pieces = text.split(' ').flatMap((word, w) => word.split(/(?<=-)/).map((piece, p) => ({ piece, space: w > 0 && p === 0 })))
  const lines: string[] = []
  let line = ''
  for (const { piece, space } of pieces) {
    const next = line === '' ? piece : `${line}${space ? ' ' : ''}${piece}`
    if (line !== '' && textWidth(next) > maxWidth) {
      lines.push(line)
      line = piece
    } else line = next
  }
  if (line !== '') lines.push(line)
  return { lines, unbreakable: pieces.map((p) => p.piece).filter((p) => textWidth(p) > maxWidth) }
}

describe('node labels (design review P5-S1: no mid-word breaks, no clipping)', () => {
  it('the label boxes match BossNode: 92px under a boss ring (2 lines), 62px beside a marker glyph (3 lines)', () => {
    expect(NODE_LABEL_BOX).toEqual({ boss: { width: 92, lines: 2 }, marker: { width: 62, lines: 3 } })
  })

  it('every one of the real data’s labels fits its box between words — never broken inside a word, never clamped', () => {
    expect(graph.nodes).toHaveLength(28)
    for (const node of graph.nodes) {
      const box = labelBox(node.kind)
      const { lines, unbreakable } = wrap(node.label, box.width)
      expect(unbreakable, `${node.name}: a piece wider than the ${box.width}px box`).toEqual([])
      expect(lines.length, `${node.name}: ${JSON.stringify(lines)}`).toBeLessThanOrEqual(box.lines)
    }
  })

  it('the milestone that broke mid-word ("mechanic / al") gets a shorter map label; its full name stays the accessible one', () => {
    const mech = graph.nodeById.get('all-mechanical-bosses')!
    expect(mech).toMatchObject({ kind: 'milestone', name: 'All mechanical bosses defeated', label: 'All mech bosses' })
    // why: "mechanical" alone is wider than a marker's text box
    expect(wrap(mech.name, NODE_LABEL_BOX.marker.width).unbreakable).toEqual(['mechanical'])
    expect(wrap(mech.label, NODE_LABEL_BOX.marker.width).lines).toEqual(['All mech', 'bosses'])
    // a short label exists only where the name can't fit; every other node shows its name
    for (const [id, label] of Object.entries(SHORT_LABELS)) {
      const node = graph.nodeById.get(id)!
      expect(label.length, id).toBeLessThan(node.name.length)
      const box = labelBox(node.kind)
      const full = wrap(node.name, box.width)
      expect(full.unbreakable.length > 0 || full.lines.length > box.lines, `${id}: the full name fits — no short label needed`).toBe(true)
    }
    for (const node of graph.nodes) if (!(node.id in SHORT_LABELS)) expect(node.label).toBe(node.name)
  })
})

const intersects = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

describe('stage-band labels (design review P5-S1: never over a node, never into each other)', () => {
  const SIZES: ReadonlyMap<number, Size> = new Map([
    [0, { width: 160, height: 22 }],
    [1, { width: 151, height: 22 }],
    [2, { width: 130, height: 22 }],
    [3, { width: 117, height: 22 }],
    [4, { width: 77, height: 22 }],
  ])
  const labelRect = (p: BandLabelPlacement): Box => ({ x: p.x, y: p.y, ...SIZES.get(p.band)! })

  for (const orientation of ['vertical', 'horizontal'] as const) {
    const layout = layoutFor(orientation)
    const scene = buildScene(graph, layout, null)
    const obstacles: Box[] = [
      ...[...layout.nodes.values()].map((n) => (graph.nodeById.get(n.id)?.worldEvil ? { ...n, y: n.y - 12, height: n.height + 12 } : n)),
      ...scene.orChips.map((c) => ({ x: c.x - 12, y: c.y - 10, width: 24, height: 20 })),
    ]
    const viewport = orientation === 'vertical' ? { width: 360, height: 536 } : { width: 1170, height: 690 }
    const floor = tapFloorZoom(layout, MAP_LAYOUT_OPTIONS[orientation])

    it(`${orientation}: across zooms and pans, a shown label never overlaps a node, a chip or another label`, () => {
      let shown = 0
      let total = 0
      for (const k of [floor, 0.5, 0.85, 1, 1.5, 2]) {
        const mainSize = (orientation === 'vertical' ? layout.height : layout.width) * k
        for (let step = 0; step <= 12; step++) {
          const along = -((mainSize - 300) * step) / 12
          const view: View = orientation === 'vertical' ? { k, x: 0, y: along } : { k, x: along, y: 16 }
          const placed = placeBandLabels({ orientation, bands: layout.bands, view, viewport, sizes: SIZES, obstacles })
          const rects = placed.filter((p) => p.shown).map(labelRect)
          total += placed.length
          shown += rects.length
          for (const r of rects) {
            for (const o of obstacles) {
              const screen = { x: o.x * k + view.x, y: o.y * k + view.y, width: o.width * k, height: o.height * k }
              expect(intersects(r, screen), `k ${k} step ${step}: label at ${r.x},${r.y} covers a node`).toBe(false)
            }
          }
          for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(intersects(rects[i], rects[j]), `k ${k} step ${step}: labels collide`).toBe(false)
          // Horizontal: a label dropped down its band's start column is never level with a node beside it
          // (it would read as that row's label — design review P5-S1); a shown label is never clipped at the leading edge.
          for (const r of rects) {
            expect(orientation === 'vertical' ? r.y : r.x, `k ${k} step ${step}: clipped`).toBeGreaterThanOrEqual(0)
            if (orientation !== 'horizontal' || r.y === LABEL_EDGE_PX) continue
            for (const o of obstacles) {
              const s = { x: o.x * k + view.x, y: o.y * k + view.y, width: o.width * k, height: o.height * k }
              const beside = s.x + s.width > 0 && s.x < viewport.width && (s.x + s.width <= r.x || s.x >= r.x + r.width)
              expect(beside && s.y < r.y + r.height && r.y < s.y + s.height, `k ${k} step ${step}: dropped label at ${r.x},${r.y} is level with a node`).toBe(false)
            }
          }
        }
      }
      // fading is the exception, not the rule
      expect(shown / total).toBeGreaterThan(0.5)
    })

    it(`${orientation}: at the opening zoom with the start in view, the first band's label sits at its start, on the leading edge`, () => {
      const view: View = { k: orientation === 'vertical' ? 0.85 : 1, x: 16, y: 16 }
      const [first] = placeBandLabels({ orientation, bands: layout.bands, view, viewport, sizes: SIZES, obstacles })
      expect(first.shown).toBe(true)
      expect(orientation === 'vertical' ? first.x : first.y).toBe(LABEL_EDGE_PX)
    })
  }

  it('slides across the band’s start past a node in the way; along the flow when that is blocked; fades with no room', () => {
    const band = { band: 0, mainStart: 0, mainEnd: 200 }
    const sizes = new Map([[0, { width: 100, height: 20 }]])
    const base = { orientation: 'vertical' as const, bands: [band], view: { x: 0, y: 0, k: 1 }, viewport: { width: 400, height: 400 }, sizes }
    // clear: the sticky spot
    expect(placeBandLabels({ ...base, obstacles: [] })[0]).toEqual({ band: 0, x: LABEL_EDGE_PX, y: LABEL_EDGE_PX, shown: true })
    // a node at the band's start on the left: the label moves right of it, still at the band's start
    const left = { x: 0, y: 0, width: 50, height: 40 }
    expect(placeBandLabels({ ...base, obstacles: [left] })[0]).toEqual({ band: 0, x: 50 + LABEL_CLEARANCE_PX, y: LABEL_EDGE_PX, shown: true })
    // the whole start row is taken: down the leading edge, past the node
    const row = { x: 0, y: 0, width: 400, height: 40 }
    expect(placeBandLabels({ ...base, obstacles: [row] })[0]).toEqual({ band: 0, x: LABEL_EDGE_PX, y: 40 + LABEL_CLEARANCE_PX, shown: true })
    // no clear spot in the band: faded out
    expect(placeBandLabels({ ...base, obstacles: [{ x: 0, y: 0, width: 400, height: 200 }] })[0].shown).toBe(false)
    // a control floating over the map is kept out like a node
    expect(placeBandLabels({ ...base, obstacles: [left], keepOut: [{ x: 54, y: 0, width: 300, height: 30 }] })[0]).toMatchObject({ x: LABEL_EDGE_PX, shown: true })
    // a band shorter on screen than its label: no label (zoomed far out)
    expect(placeBandLabels({ ...base, view: { x: 0, y: 0, k: 0.1 }, obstacles: [] })[0].shown).toBe(false)
  })

  it('pushed out past the leading edge by the next band, a label fades instead of showing a clipped sliver', () => {
    const base = { orientation: 'vertical' as const, bands: [{ band: 0, mainStart: 0, mainEnd: 200 }], viewport: { width: 400, height: 400 }, sizes: new Map([[0, { width: 100, height: 20 }]]), obstacles: [] }
    // the band ends 30px down: the label is pushed up but still whole
    expect(placeBandLabels({ ...base, view: { x: 0, y: -170, k: 1 } })[0]).toEqual({ band: 0, x: LABEL_EDGE_PX, y: 6, shown: true })
    // the band ends 10px down: the label would hang off the top edge
    expect(placeBandLabels({ ...base, view: { x: 0, y: -190, k: 1 } })[0].shown).toBe(false)
  })

  it('horizontal: a drop that would sit level with another column’s node gives way to the sideways slot, then fades', () => {
    const sizes = new Map([[0, { width: 100, height: 20 }]])
    const base = { orientation: 'horizontal' as const, bands: [{ band: 0, mainStart: 0, mainEnd: 400 }], view: { x: 0, y: 0, k: 1 }, viewport: { width: 800, height: 400 }, sizes }
    const top = { x: 0, y: 0, width: 60, height: 50 } // a node at the band's start, against the top edge
    // nothing beside the drop: the label drops past the node, still at the band's start
    expect(placeBandLabels({ ...base, obstacles: [top] })[0]).toEqual({ band: 0, x: LABEL_EDGE_PX, y: 50 + LABEL_CLEARANCE_PX, shown: true })
    // a node in the next column level with the drop: sideways along the top edge instead
    const beside = { x: 200, y: 40, width: 60, height: 80 }
    expect(placeBandLabels({ ...base, obstacles: [top, beside] })[0]).toEqual({ band: 0, x: 60 + LABEL_CLEARANCE_PX, y: LABEL_EDGE_PX, shown: true })
    // the top edge taken too: faded
    expect(placeBandLabels({ ...base, obstacles: [top, beside, { x: 60, y: 0, width: 400, height: 30 }] })[0].shown).toBe(false)
    // the vertical map keeps sliding across its band's start row (beside that row's nodes is where a header belongs)
    const row = { ...base, orientation: 'vertical' as const, obstacles: [top, { x: 200, y: 0, width: 60, height: 50 }] }
    expect(placeBandLabels(row)[0]).toEqual({ band: 0, x: 60 + LABEL_CLEARANCE_PX, y: LABEL_EDGE_PX, shown: true })
  })
})
