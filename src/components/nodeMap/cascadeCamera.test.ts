/* Framing the unlock cascade before it plays (design review P5-S4 H1/M1): the region, and the camera
 * plan against a mocked focus-card rect at phone / tablet / desktop map sizes. */
import { describe, expect, it } from 'vitest'
import type { Boss, ProgressionEdge, ProgressionNode } from '../../data-access/types'
import bossesJson from '../../data/bosses.json'
import progressionJson from '../../data/progression.json'
import { CASCADE_LEAD_MS, CASCADE_PAN_MS, cascadeRegion, crossPositions, inView, onScreen, planCascadeCamera } from './cascadeCamera'
import { buildMapGraph, layoutInputs, type NodeState } from './graph'
import { layoutGraph, type Orientation } from './layout'
import { INITIAL_ZOOM, MAP_LAYOUT_OPTIONS, POINTER_MIN_ZOOM, tapFloorZoom } from './mapConfig'
import { centerOn, uncovered, unionRect, type Inset, type Rect, type Size, type View } from './panZoom'
import { mapProgress, UNLOCK_DURATION_MS, UNLOCK_STAGGER_MS, unlockSchedule } from './progressView'
import { nodeExtent } from './scene'

const raw = progressionJson as { nodes: ProgressionNode[]; edges: ProgressionEdge[] }
const graph = buildMapGraph(raw, bossesJson as Boss[])
const layoutFor = (orientation: Orientation) => {
  const input = layoutInputs(graph)
  return layoutGraph(input.nodes, input.edges, input.groups, MAP_LAYOUT_OPTIONS[orientation])
}
const defeated = (...ids: string[]): Record<string, NodeState> => Object.fromEntries(ids.map((id) => [id, 'defeated' as const]))
const HARDMODE_OPENS = ['queen-slime', 'skeletron-prime', 'the-destroyer', 'the-twins', 'duke-fishron', 'pirate-invasion', 'solar-eclipse']
const MECHS = ['the-twins', 'the-destroyer', 'skeletron-prime']

const scheduleFor = (orientation: Orientation, before: Record<string, NodeState>, after: Record<string, NodeState>) =>
  unlockSchedule(graph, mapProgress(graph, before, null), mapProgress(graph, after, null), { position: crossPositions(layoutFor(orientation)) })

/** The map-box edge a card rect covers (BossMapPage's useCardInset: the card plus its 8px gap). */
function coveredBy(box: Size, card: Rect, staying: Inset = {}): Inset {
  const alongBottom = card.y + card.height >= box.height - 16 && card.width > box.width / 2
  return alongBottom ? { ...staying, bottom: Math.max(staying.bottom ?? 0, box.height - card.y + 8) } : { ...staying, right: box.width - card.x + 8 }
}
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

describe('the cascade region', () => {
  it('the Wall of Flesh: exactly itself, Hardmode and everything Hardmode opens (Duke Fishron’s far stage included)', () => {
    for (const orientation of ['vertical', 'horizontal'] as const) {
      const layout = layoutFor(orientation)
      const region = cascadeRegion(graph, layout, scheduleFor(orientation, {}, defeated('wall-of-flesh')))
      expect(region, orientation).toEqual(unionRect(['wall-of-flesh', 'hardmode', ...HARDMODE_OPENS].map((id) => nodeExtent(graph, layout.nodes.get(id)!))))
    }
  })

  it('the mechs converging: the lines’ far ends too — all three mechs, the milestone and Plantera', () => {
    const layout = layoutFor('horizontal')
    const schedule = scheduleFor('horizontal', defeated('wall-of-flesh', 'the-twins', 'the-destroyer'), defeated('wall-of-flesh', ...MECHS))
    expect([...schedule.nodes.keys()]).not.toContain('the-twins') // already open: only its line changes
    const region = cascadeRegion(graph, layout, schedule)!
    for (const id of [...MECHS, 'all-mechanical-bosses', 'plantera']) expect(overlaps(region, layout.nodes.get(id)!), id).toBe(true)
  })

  it('a gate badge swapping far away doesn’t stretch it: Skeletron — itself and the Wall of Flesh it lights, not the Lunatic Cultist', () => {
    const layout = layoutFor('vertical')
    const schedule = scheduleFor('vertical', {}, defeated('skeletron'))
    expect(schedule.links.get('skeletron->lunatic-cultist')?.gate).toBe(true) // its badge still swaps
    expect(cascadeRegion(graph, layout, schedule)).toEqual(unionRect(['skeletron', 'wall-of-flesh'].map((id) => nodeExtent(graph, layout.nodes.get(id)!))))
  })

  it('nothing changed: no region', () => {
    expect(cascadeRegion(graph, layoutFor('vertical'), scheduleFor('vertical', {}, {}))).toBeUndefined()
  })
})

describe('the camera plan (H1: the payoff shows; M1: one motion at a time)', () => {
  const plan = (orientation: Orientation, box: Size, card: Rect | null, staying: Inset, view: (content: Size, viewport: Size) => View, canUncover = true) => {
    const layout = layoutFor(orientation)
    const content = { width: layout.width, height: layout.height }
    const inset = card ? coveredBy(box, card, staying) : staying
    const limits = { min: POINTER_MIN_ZOOM, max: 2 }
    const region = cascadeRegion(graph, layout, scheduleFor(orientation, {}, defeated('wall-of-flesh')))!
    const before = view(content, uncovered(box, inset))
    const result = planCascadeCamera({
      region,
      view: before,
      content,
      box,
      inset,
      uncoveredInset: staying,
      limits,
      floor: Math.max(limits.min, tapFloorZoom(layout, MAP_LAYOUT_OPTIONS[orientation])),
      canUncover,
    })
    return { layout, region, before, inset, result }
  }
  const onWoF = (orientation: Orientation) => (content: Size, viewport: Size) => {
    const wof = layoutFor(orientation).nodes.get('wall-of-flesh')!
    return centerOn(wof, INITIAL_ZOOM[orientation], content, viewport)
  }

  it('desktop (1440: card on the right): the region fits beside the card — framed there, never under it; the card stays', () => {
    const box = { width: 1184, height: 692 }
    const card = { x: box.width - 8 - 352, y: 8, width: 352, height: box.height - 16 - 56 }
    const { region, before, inset, result } = plan('horizontal', box, card, { bottom: 64 }, onWoF('horizontal'))
    expect(inView(region, before, uncovered(box, inset))).toBe(false) // the fan was under the card
    expect(result.uncover).toBe(false)
    expect(result.view).not.toBeNull()
    expect(inView(region, result.view!, uncovered(box, inset))).toBe(true)
    expect(overlaps(onScreen(region, result.view!), card)).toBe(false)
  })

  it('tablet (768: card along the bottom): too little map above the card — uncover, then frame in the whole map', () => {
    const box = { width: 512, height: 750 }
    const card = { x: 8, y: box.height - 8 - 416, width: box.width - 16, height: 416 }
    const { region, result } = plan('vertical', box, card, {}, onWoF('vertical'))
    expect(result.uncover).toBe(true)
    expect(inView(region, result.view!, box)).toBe(true)
  })

  it('phone (375: the sheet along the bottom, the legend/options row staying): uncover, then the whole region in the map above that row', () => {
    const box = { width: 375, height: 555 }
    const card = { x: 8, y: box.height - 8 - 333, width: box.width - 16, height: 333 }
    const staying = { bottom: 60 }
    const { region, result } = plan('vertical', box, card, staying, onWoF('vertical'))
    expect(result.uncover).toBe(true)
    expect(inView(region, result.view!, uncovered(box, staying))).toBe(true)
    expect(result.view!.k).toBeGreaterThanOrEqual(tapFloorZoom(layoutFor('vertical'), MAP_LAYOUT_OPTIONS.vertical))
  })

  it('phones of every common width: the region also clears the zoom-control column in the map’s top-right corner', () => {
    const layout = layoutFor('vertical')
    const content = { width: layout.width, height: layout.height }
    const region = cascadeRegion(graph, layout, scheduleFor('vertical', {}, defeated('wall-of-flesh')))!
    const limits = { min: tapFloorZoom(layout, MAP_LAYOUT_OPTIONS.vertical), max: 2 }
    let avoided = 0
    for (const width of [360, 375, 390, 412, 430]) {
      const box = { width, height: 555 }
      const staying = { bottom: 60 }
      // NodeMap's controls column: right-2 top-2, four 44px buttons + borders
      const column = { x: width - 8 - 48, y: 8, width: 48, height: 186 }
      const input = { region, view: centerOn(layout.nodes.get('wall-of-flesh')!, 0.85, content, uncovered(box, staying)), content, box, inset: staying, uncoveredInset: staying, limits, floor: limits.min, canUncover: false }
      const plain = planCascadeCamera(input).view!
      const clear = planCascadeCamera({ ...input, avoid: [column] }).view!
      if (overlaps(onScreen(region, plain), column)) avoided++
      expect(inView(region, clear, uncovered(box, staying)), String(width)).toBe(true)
      expect(overlaps(onScreen(region, clear), column), String(width)).toBe(false)
    }
    expect(avoided).toBeGreaterThan(0) // without the column in mind, some phone width puts the fan under it
  })

  it('a card that can’t close: framed beside it as well as the zoom floor allows', () => {
    const box = { width: 375, height: 555 }
    const card = { x: 8, y: box.height - 8 - 333, width: box.width - 16, height: 333 }
    const { result } = plan('vertical', box, card, {}, onWoF('vertical'), false)
    expect(result.uncover).toBe(false)
    expect(result.view!.k).toBe(POINTER_MIN_ZOOM)
  })

  it('the region already in view: the camera stays put (no pan, so no lead)', () => {
    const box = { width: 1184, height: 692 }
    const { region, result, before } = plan('horizontal', box, null, { bottom: 64 }, (content, viewport) => {
      const region = cascadeRegion(graph, layoutFor('horizontal'), scheduleFor('horizontal', {}, defeated('wall-of-flesh')))!
      return centerOn(region, 0.5, content, viewport)
    })
    expect(inView(region, before, uncovered(box, { bottom: 64 }))).toBe(true)
    expect(result).toEqual({ view: null, uncover: false })
  })

  it('M1: the cascade waits out the 200ms pan (the map layer’s --dur-ui transition, as each cascade element’s) plus one stagger step', () => {
    expect(CASCADE_PAN_MS).toBe(UNLOCK_DURATION_MS)
    expect(CASCADE_LEAD_MS).toBe(CASCADE_PAN_MS + UNLOCK_STAGGER_MS)
  })
})
