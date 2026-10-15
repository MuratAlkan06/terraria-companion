/**
 * Where the map opens (design review P5-S1, High: on laptop-height desktop viewports the opening
 * view — centred on the start at 1× — hid the Eater of Worlds / Brain of Cthulhu fork).
 */
import { describe, expect, it } from 'vitest'
import type { Boss, ProgressionEdge, ProgressionNode } from '../../data-access/types'
import bossesJson from '../../data/bosses.json'
import progressionJson from '../../data/progression.json'
import { buildMapGraph, layoutInputs } from './graph'
import { layoutGraph, type Box, type Orientation } from './layout'
import { CONTROLS_ROW_INSET, INITIAL_ZOOM, MAP_LAYOUT_OPTIONS, MAX_ZOOM, POINTER_MIN_ZOOM, tapFloorZoom } from './mapConfig'
import { openingRect, openingRegion } from './opening'
import { centerOn, frameRect, PAN_SLACK, uncovered, type Size, type View } from './panZoom'
import { buildScene, chipExtent, nodeExtent } from './scene'

const graph = buildMapGraph(progressionJson as { nodes: ProgressionNode[]; edges: ProgressionEdge[] }, bossesJson as Boss[])
const layoutFor = (orientation: Orientation) => {
  const input = layoutInputs(graph)
  return layoutGraph(input.nodes, input.edges, input.groups, MAP_LAYOUT_OPTIONS[orientation])
}
const horizontal = layoutFor('horizontal')
const scene = buildScene(graph, horizontal, null)
const extent = (id: string) => nodeExtent(graph, horizontal.nodes.get(id)!)
const [chip] = scene.orChips

/**
 * The desktop map box at each window size the review named, as measured in Chromium (2026-10-14):
 * the window minus the docked legend (256px) and the page scrollbar (15px) wide, minus the site
 * header, title and toolbar (208px) tall. The zoom-control row's strip is reserved below.
 */
const DESKTOP_WINDOWS: readonly [number, number][] = [
  [1024, 768],
  [1280, 720],
  [1366, 657],
  [1536, 730],
  [1440, 900],
]
const mapArea = ([w, h]: readonly [number, number]): Size => uncovered({ width: w - 256 - 15, height: h - 208 }, { bottom: CONTROLS_ROW_INSET })
const onScreen = (b: Box, v: View) => ({ x: b.x * v.k + v.x, y: b.y * v.k + v.y, width: b.width * v.k, height: b.height * v.k })
const inside = (b: Box, area: Size) => b.x >= 0 && b.y >= 0 && b.x + b.width <= area.width && b.y + b.height <= area.height

describe('the opening region (start through the first either/or fork)', () => {
  it('real data: Pre-Hardmode through the fork’s layer — every node there, the world tags and the "or" chip', () => {
    const region = openingRegion(graph, horizontal, scene, 'pre-hardmode')!
    const start = horizontal.nodes.get('pre-hardmode')!
    const forkLayer = horizontal.nodes.get('eater-of-worlds')!.layer
    const members = [...horizontal.nodes.values()].filter((n) => n.layer >= start.layer && n.layer <= forkLayer).map((n) => n.id)
    expect(members.sort()).toEqual(['brain-of-cthulhu', 'eater-of-worlds', 'eye-of-cthulhu', 'goblin-army', 'king-slime', 'pre-hardmode'])
    for (const box of [...members.map(extent), chipExtent(chip)]) {
      expect(box.x).toBeGreaterThanOrEqual(region.x)
      expect(box.y).toBeGreaterThanOrEqual(region.y)
      expect(box.x + box.width).toBeLessThanOrEqual(region.x + region.width)
      expect(box.y + box.height).toBeLessThanOrEqual(region.y + region.height)
    }
    // tight: its top is the Eater of Worlds' world tag, its bottom King Slime's box, nothing past the fork's layer
    expect(region.y).toBe(extent('eater-of-worlds').y)
    expect(region.y + region.height).toBe(extent('king-slime').y + extent('king-slime').height)
    expect(region.x + region.width).toBe(extent('eater-of-worlds').x + extent('eater-of-worlds').width)
  })

  it('a start past every fork in its band opens on the start alone; phones (OPENING_FRAME start) always do', () => {
    expect(openingRegion(graph, horizontal, scene, 'skeletron')).toEqual(extent('skeletron'))
    const vertical = layoutFor('vertical')
    expect(openingRect(graph, vertical, buildScene(graph, vertical, null), 'pre-hardmode')).toBe(vertical.nodes.get('pre-hardmode'))
    expect(openingRect(graph, horizontal, scene, undefined)).toBeUndefined()
  })
})

describe('the desktop opening view at laptop sizes (review: 1024×768, 1280×720, 1366×657, 1536×730, 1440×900)', () => {
  const content = { width: horizontal.width, height: horizontal.height }
  const region = openingRect(graph, horizontal, scene, 'pre-hardmode')!
  const pointers = { mouse: POINTER_MIN_ZOOM, touch: tapFloorZoom(horizontal, MAP_LAYOUT_OPTIONS.horizontal) }

  for (const size of DESKTOP_WINDOWS) {
    for (const [pointer, min] of Object.entries(pointers)) {
      it(`${size.join('×')} (${pointer}): the start, both fork members with their tags and the "or" chip are fully on screen, no band wasted below King Slime`, () => {
        const area = mapArea(size)
        const initialZoom = Math.max(min, INITIAL_ZOOM.horizontal)
        const view = frameRect(region, initialZoom, content, area, { min, max: MAX_ZOOM })
        expect(view.k).toBeLessThanOrEqual(1)
        for (const id of ['pre-hardmode', 'eater-of-worlds', 'brain-of-cthulhu', 'king-slime', 'eye-of-cthulhu', 'goblin-army']) {
          expect(inside(onScreen(extent(id), view), area), `${id} at ${JSON.stringify(onScreen(extent(id), view))}`).toBe(true)
        }
        expect(inside(onScreen(chipExtent(chip), view), area)).toBe(true)
        // Fitted (below 1×), King Slime ends one margin above the controls' strip; at 1× the spare room
        // is shared out (the map's own bottom edge may pin it a little lower) — never more below than above.
        const r = onScreen(region, view)
        const above = r.y
        const below = area.height - (r.y + r.height)
        if (view.k < 1) expect(below).toBeLessThanOrEqual(PAN_SLACK + 0.5)
        expect(below).toBeLessThanOrEqual(Math.max(PAN_SLACK, above) + 0.5)
      })
    }
  }

  it('regression: the old opening (the start centred at 1×) left the "or" chip off-screen at 1366×657', () => {
    const area = mapArea([1366, 657])
    const old = centerOn(horizontal.nodes.get('pre-hardmode')!, 1, content, area)
    expect(inside(onScreen(chipExtent(chip), old), area)).toBe(false)
  })
})
