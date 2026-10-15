import { describe, expect, it } from 'vitest'
import type { Boss, ProgressionEdge, ProgressionNode } from '../../data-access/types'
import bossesJson from '../../data/bosses.json'
import progressionJson from '../../data/progression.json'
import { EdgeType } from '../../schemas'
import { byPrecedence, EDGE_PRECEDENCE, EDGE_STYLES } from './edgeStyles'
import {
  buildMapGraph,
  connectionsOf,
  describeNode,
  edgeLegendForms,
  forkBranches,
  frontierId,
  isLinkActive,
  isNodeActive,
  layoutInputs,
  takenMember,
  traverse,
  type MapGraph,
  type WorldEvil,
} from './graph'
import { layoutGraph, type GraphLayout, type Orientation } from './layout'
import { hitPadding, MAP_LAYOUT_OPTIONS, MAX_ZOOM, POINTER_MIN_ZOOM, TAP_TARGET_PX, tapFloorZoom } from './mapConfig'
import {
  boundView,
  centerOn,
  fitView,
  frameRect,
  OBSTRUCTION_GAP,
  PAN_SLACK,
  revealClear,
  revealRect,
  uncovered,
  unionRect,
  wheelFactor,
  zoomAround,
  type Rect,
  type View,
} from './panZoom'
import { buildScene, nodeExtent } from './scene'

const progression = progressionJson as { nodes: ProgressionNode[]; edges: ProgressionEdge[] }
const bosses = bossesJson as Boss[]
const graph = buildMapGraph(progression, bosses)
const layoutFor = (orientation: Orientation, g: MapGraph = graph): GraphLayout => {
  const input = layoutInputs(g)
  return layoutGraph(input.nodes, input.edges, input.groups, MAP_LAYOUT_OPTIONS[orientation])
}
const WORLD_EVILS: (WorldEvil | null)[] = [null, 'corruption', 'crimson']

describe('edge styling map (PRD P5-S1 AC2; UX_SPEC §9 colour-not-only)', () => {
  const types = EdgeType.options

  it('styles every schema edge type, and precedence lists each exactly once', () => {
    expect(Object.keys(EDGE_STYLES).sort()).toEqual([...types].sort())
    expect([...EDGE_PRECEDENCE].sort()).toEqual([...types].sort())
    expect(EDGE_PRECEDENCE[0]).toBe('required-gate')
    expect(byPrecedence(['optional', 'required-gate', 'optional'])).toEqual(['required-gate', 'optional'])
  })

  it('every type differs from every other by line style, endpoint marker AND icon — not just colour', () => {
    const styles = types.map((t) => EDGE_STYLES[t])
    const lineStyle = (s: (typeof styles)[number]) => `${s.dash ?? 'solid'}|${s.lineCap}`
    expect(new Set(styles.map(lineStyle)).size).toBe(types.length)
    expect(new Set(styles.map((s) => s.marker)).size).toBe(types.length)
    expect(new Set(styles.map((s) => s.icon)).size).toBe(types.length)
    expect(new Set(styles.map((s) => s.label)).size).toBe(types.length)
    expect(new Set(styles.map((s) => s.iconName)).size).toBe(types.length)
    // Required gates are the solid line (UX_SPEC §3.7 "required-gate solid gold").
    expect(EDGE_STYLES['required-gate'].dash).toBeUndefined()
    for (const s of styles) expect(s.description.length).toBeGreaterThan(10)
  })

  it('colours are the --edge-* design tokens (one per type; they resolve in the browser — see slice evidence)', () => {
    const names = Object.values(EDGE_STYLES).map((s) => /^var\((--edge-[a-z]+)\)$/.exec(s.color)?.[1])
    expect(names).toEqual(['--edge-required', '--edge-recommended', '--edge-optional', '--edge-alt', '--edge-early'])
  })
})

describe('graph model over the real progression data (P2-S6 → P5-S1)', () => {
  it('every node is on the map; boss nodes carry their boss records', () => {
    expect(graph.nodes).toHaveLength(progression.nodes.length)
    const bossNodes = graph.nodes.filter((n) => n.kind === 'boss')
    expect(bossNodes).toHaveLength(bosses.length)
    for (const n of bossNodes) expect(n.boss?.nodeId, n.id).toBe(n.id)
    expect(graph.nodes.filter((n) => n.kind !== 'boss').every((n) => n.boss === undefined)).toBe(true)
  })

  it('merges parallel edges into one link carrying every type (each edge keeps its source)', () => {
    const typed = graph.links.flatMap((l) => l.edges)
    expect(typed.length + graph.altLinks.flatMap((l) => l.edges).length).toBe(progression.edges.length)
    expect(new Set(graph.links.map((l) => l.id)).size).toBe(graph.links.length)
    const link = (id: string) => graph.links.find((l) => l.id === id)
    expect(link('hardmode->duke-fishron')?.types).toEqual(['required-gate', 'early-challenge-possible'])
    expect(link('hardmode->queen-slime')?.types).toEqual(['required-gate', 'optional'])
    expect(link('plantera->empress-of-light')?.primary).toBe('required-gate')
    for (const l of graph.links) for (const e of l.edges) expect(e.sourceUrl).toMatch(/^https:\/\/terraria\.wiki\.gg\//)
  })

  it('alternative-route edges form the either/or group (Eater of Worlds first, as the data points)', () => {
    expect(graph.groups).toEqual([['eater-of-worlds', 'brain-of-cthulhu']])
    expect(graph.links.some((l) => l.types.includes('alternative-route'))).toBe(false)
    expect(connectionsOf(graph, 'brain-of-cthulhu').alternatives.map((c) => c.other.id)).toEqual(['eater-of-worlds'])
  })

  it('world evil decides which member is in play and which branch continues the path', () => {
    const pair = graph.groups[0]
    const node = (id: string) => graph.nodeById.get(id)!
    expect(WORLD_EVILS.map((w) => [isNodeActive(node('eater-of-worlds'), w), isNodeActive(node('brain-of-cthulhu'), w)])).toEqual([
      [true, true],
      [true, false],
      [false, true],
    ])
    // "Both" (no world evil chosen) takes neither member: the data's edge direction is not a preference
    expect(WORLD_EVILS.map((w) => takenMember(graph, pair, w))).toEqual([undefined, 'eater-of-worlds', 'brain-of-cthulhu'])
    expect(forkBranches(graph, pair, 'recommended-next', 'crimson')).toEqual([
      { member: 'eater-of-worlds', type: 'alternative-route', taken: false, active: false },
      { member: 'brain-of-cthulhu', type: 'recommended-next', taken: true, active: true },
    ])
    expect(forkBranches(graph, pair, 'recommended-next', null)).toEqual([
      { member: 'eater-of-worlds', type: 'alternative-route', taken: false, active: true },
      { member: 'brain-of-cthulhu', type: 'alternative-route', taken: false, active: true },
    ])
    expect(isLinkActive(graph, { from: 'eater-of-worlds', to: 'skeletron' }, 'crimson')).toBe(false)
    // Nodes without a world evil are always in play.
    for (const w of WORLD_EVILS) expect(graph.nodes.filter((n) => !n.worldEvil).every((n) => isNodeActive(n, w))).toBe(true)
  })

  it('screen-reader descriptions name the kind, stage and typed connections', () => {
    expect(describeNode(graph, 'plantera', null)).toBe(
      'Boss, Mid-Hardmode. after All mechanical bosses defeated (required gate). leads to Empress of Light (required gate, early challenge possible); Frost Moon (required gate); Golem (required gate); Pumpkin Moon (required gate).',
    )
    expect(describeNode(graph, 'eater-of-worlds', 'crimson')).toContain('Corruption worlds only, not in your world')
    expect(describeNode(graph, 'brain-of-cthulhu', null)).toContain('either this or Eater of Worlds')
  })

  it('the map opens on the first untracked node in reading order (with nothing tracked: the start)', () => {
    const reading = layoutFor('vertical').layers.flat()
    expect(frontierId(reading, {})).toBe('pre-hardmode')
    expect(frontierId(reading, { 'pre-hardmode': 'defeated' })).toBe(reading[1])
  })
})

describe('keyboard traversal along edges (UX_SPEC §9)', () => {
  for (const orientation of ['vertical', 'horizontal'] as const) {
    const layout = layoutFor(orientation)
    const go = (from: string, ...moves: Parameters<typeof traverse>[3][]) =>
      moves.reduce<string | undefined>((at, move) => (at ? traverse(graph, layout, at, move, null) : undefined), from)

    it(`${orientation}: forward/back follow the strongest link one layer at a time`, () => {
      expect(traverse(graph, layout, 'eye-of-cthulhu', 'first', null)).toBe('pre-hardmode')
      expect(traverse(graph, layout, 'eye-of-cthulhu', 'last', null)).toBe('moon-lord')
      // Recommended (Eye of Cthulhu) beats optional (King Slime / Deerclops / Queen Bee).
      expect(go('pre-hardmode', 'forward')).toBe('eye-of-cthulhu')
      expect(go('wall-of-flesh', 'forward')).toBe('hardmode')
      expect(go('celestial-pillars', 'forward')).toBe('moon-lord')
      expect(go('moon-lord', 'forward')).toBeUndefined()
      expect(go('moon-lord', 'back', 'back')).toBe('lunatic-cultist')
      const next = go('hardmode', 'forward')!
      expect(layout.nodes.get(next)!.layer).toBe(layout.nodes.get('hardmode')!.layer + 1)
    })

    it(`${orientation}: the fork reaches both members; a chosen world evil picks the default`, () => {
      // "Both": neither is preferred — the nearer one across (then reading order) comes first, the other is next along the row
      const both = traverse(graph, layout, 'eye-of-cthulhu', 'forward', null)!
      expect(['eater-of-worlds', 'brain-of-cthulhu']).toContain(both)
      expect(traverse(graph, layout, both, both === 'eater-of-worlds' ? 'next' : 'previous', null)).toBe(both === 'eater-of-worlds' ? 'brain-of-cthulhu' : 'eater-of-worlds')
      expect(traverse(graph, layout, 'eye-of-cthulhu', 'forward', 'corruption')).toBe('eater-of-worlds')
      expect(traverse(graph, layout, 'eye-of-cthulhu', 'forward', 'crimson')).toBe('brain-of-cthulhu')
      expect(traverse(graph, layout, 'brain-of-cthulhu', 'back', null)).toBe('eye-of-cthulhu')
    })

    it(`${orientation}: stepping straight back returns where you came from (the fork's members, the mech trio)`, () => {
      // design review P5-S1: back from Skeletron went to the nearer member, whichever one you came from
      for (const member of ['eater-of-worlds', 'brain-of-cthulhu']) {
        expect(traverse(graph, layout, 'skeletron', 'back', null, member)).toBe(member)
        expect(traverse(graph, layout, 'eye-of-cthulhu', 'forward', null, member)).toBe(member)
      }
      for (const mech of ['the-destroyer', 'the-twins', 'skeletron-prime']) expect(traverse(graph, layout, 'all-mechanical-bosses', 'back', null, mech)).toBe(mech)
      // it even wins over the chosen world evil's member: you are going back to where you were
      expect(traverse(graph, layout, 'skeletron', 'back', 'crimson', 'eater-of-worlds')).toBe('eater-of-worlds')
      // a node that isn't a step away changes nothing
      expect(traverse(graph, layout, 'skeletron', 'back', null, 'moon-lord')).toBe(traverse(graph, layout, 'skeletron', 'back', null))
    })

    it(`${orientation}: next/previous step along a layer (the mech trio side by side)`, () => {
      const row = layout.layers[layout.nodes.get('the-destroyer')!.layer]
      const i = row.indexOf('the-destroyer')
      expect(traverse(graph, layout, 'the-destroyer', 'next', null)).toBe(row[i + 1])
      expect(traverse(graph, layout, 'the-destroyer', 'previous', null)).toBe(row[i - 1])
      expect(traverse(graph, layout, row[row.length - 1], 'next', null)).toBeUndefined()
    })
  }
})

describe('scene: what the map draws (AC1–AC3)', () => {
  for (const orientation of ['vertical', 'horizontal'] as const) {
    const layout = layoutFor(orientation)

    it(`${orientation}: every link is drawn exactly once, with a badge per link`, () => {
      const scene = buildScene(graph, layout, null)
      const drawn = scene.paths.filter((p) => p.linkId).map((p) => p.linkId)
      expect([...drawn].sort()).toEqual(graph.links.map((l) => l.id).sort())
      expect(scene.badges).toHaveLength(graph.links.length)
      expect(scene.orChips).toHaveLength(1)
      for (const p of scene.paths) expect(p.d, p.key).toMatch(/^M[-\d.]+ [-\d.]+[CL]/)
    })

    it(`${orientation}: EoW/BoC render as an either/or fork that the world evil switches`, () => {
      const branches = (w: WorldEvil | null) =>
        buildScene(graph, layout, w)
          .paths.filter((p) => p.role === 'branch')
          .map((p) => [p.member, p.type, p.inPlay])
      // "Both": symmetric — both members on alternative-route branches, both in play
      expect(branches(null)).toEqual([
        ['eater-of-worlds', 'alternative-route', true],
        ['brain-of-cthulhu', 'alternative-route', true],
      ])
      expect(branches('corruption')).toEqual([
        ['eater-of-worlds', 'recommended-next', true],
        ['brain-of-cthulhu', 'alternative-route', false],
      ])
      expect(branches('crimson')).toEqual([
        ['eater-of-worlds', 'alternative-route', false],
        ['brain-of-cthulhu', 'recommended-next', true],
      ])
      // The incoming link stops at the fork (no arrowhead of its own); branches end in markers.
      const scene = buildScene(graph, layout, null)
      const trunk = scene.paths.find((p) => p.role === 'trunk')!
      expect(trunk).toMatchObject({ linkId: 'eye-of-cthulhu->eater-of-worlds', marker: false, type: 'recommended-next' })
      // The "or" chip sits on the branching point: the trunk ends there and both branches start there,
      // the same distance from the chip to each member (a symmetric fork).
      const [chip] = scene.orChips
      const ends = (d: string) => [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }))
      const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) < 0.11
      expect(near(ends(trunk.d).at(-1)!, chip)).toBe(true)
      const branchPaths = scene.paths.filter((p) => p.role === 'branch')
      for (const b of branchPaths) expect(near(ends(b.d)[0], chip), b.key).toBe(true)
      const toMember = branchPaths.map((b) => {
        const end = ends(b.d).at(-1)!
        return Math.hypot(end.x - chip.x, end.y - chip.y)
      })
      expect(toMember[0]).toBeCloseTo(toMember[1], 0)
      // Links of the out-of-play member are dimmed too.
      const out = buildScene(graph, layout, 'crimson').paths.find((p) => p.linkId === 'eater-of-worlds->skeletron')!
      expect(out.inPlay).toBe(false)
    })
  }

  it('a group nothing leads into is joined by an alternative-route connector', () => {
    const alone = buildMapGraph(
      { nodes: progression.nodes, edges: progression.edges.filter((e) => !(e.to === 'eater-of-worlds' && e.type !== 'alternative-route')) },
      bosses,
    )
    const scene = buildScene(alone, layoutFor('vertical', alone), null)
    expect(scene.paths.filter((p) => p.role === 'branch')).toHaveLength(0)
    expect(scene.paths.filter((p) => p.role === 'connector').map((p) => p.type)).toEqual(['alternative-route'])
    expect(scene.orChips).toHaveLength(1) // between the members
  })

  it('legend forms: a type that never draws a line of its own is shown as its badge on its host’s line', () => {
    // early challenge only rides on Hardmode → Duke Fishron's required gate
    expect(graph.links.some((l) => l.primary === 'early-challenge-possible')).toBe(false)
    expect(edgeLegendForms(graph)).toEqual({ 'early-challenge-possible': { host: 'required-gate' } })
    // once some link draws it, it shows its own line
    const promoted = buildMapGraph(
      { nodes: progression.nodes, edges: progression.edges.filter((e) => !(e.from === 'hardmode' && e.to === 'duke-fishron' && e.type === 'required-gate')) },
      bosses,
    )
    expect(edgeLegendForms(promoted)).toEqual({})
  })
})

describe('tap targets (UX_SPEC §7/§9: node targets ≥ 44px at any zoom on touch)', () => {
  for (const orientation of ['vertical', 'horizontal'] as const) {
    it(`${orientation}: at the tap floor every node's hit area is ≥ 44px and neighbours' never overlap`, () => {
      const options = MAP_LAYOUT_OPTIONS[orientation]
      const layout = layoutFor(orientation)
      const floor = tapFloorZoom(layout, options)
      expect(floor).toBeGreaterThan(0)
      expect(floor).toBeLessThanOrEqual(1)
      const pad = hitPadding(options)
      const hits = [...layout.nodes.values()].map((n) => {
        const px = orientation === 'vertical' ? pad.cross : pad.main
        const py = orientation === 'vertical' ? pad.main : pad.cross
        return { id: n.id, x: n.x - px, y: n.y - py, width: n.width + px * 2, height: n.height + py * 2 }
      })
      for (const h of hits) expect(Math.min(h.width, h.height) * floor, h.id).toBeGreaterThanOrEqual(TAP_TARGET_PX - 1e-9)
      for (let i = 0; i < hits.length; i++) {
        for (let j = i + 1; j < hits.length; j++) {
          const [a, b] = [hits[i], hits[j]]
          const overlap = a.x < b.x + b.width - 0.01 && b.x < a.x + a.width - 0.01 && a.y < b.y + b.height - 0.01 && b.y < a.y + a.height - 0.01
          expect(overlap, `${a.id} / ${b.id}`).toBe(false)
        }
      }
    })
  }
})

describe('pan/zoom math', () => {
  const content = { width: 1000, height: 2000 }
  const viewport = { width: 400, height: 600 }
  const limits = { min: 0.25, max: 2 }

  it('zoomAround keeps the point under the cursor fixed and respects the limits', () => {
    const view = { x: -100, y: -50, k: 1 }
    const z = zoomAround(view, 1.5, 200, 300, limits)
    expect(z.k).toBe(1.5)
    expect((200 - z.x) / z.k).toBeCloseTo((200 - view.x) / view.k)
    expect((300 - z.y) / z.k).toBeCloseTo((300 - view.y) / view.k)
    expect(zoomAround(view, 100, 0, 0, limits).k).toBe(2)
    expect(zoomAround(view, 0.001, 0, 0, limits).k).toBe(0.25)
  })

  it('bounded panning: a larger map stays within PAN_SLACK of its edges, a smaller one is centred', () => {
    expect(boundView({ x: 500, y: 500, k: 1 }, content, viewport)).toEqual({ x: PAN_SLACK, y: PAN_SLACK, k: 1 })
    expect(boundView({ x: -5000, y: -5000, k: 1 }, content, viewport)).toEqual({ x: 400 - PAN_SLACK - 1000, y: 600 - PAN_SLACK - 2000, k: 1 })
    expect(boundView({ x: 0, y: 0, k: 0.1 }, content, viewport)).toEqual({ x: 150, y: 200, k: 0.1 })
  })

  it('fitView shows the whole map when the limits allow, never zooming past 1×', () => {
    const fit = fitView(content, viewport, limits)
    expect(fit.k).toBeCloseTo((600 - PAN_SLACK * 2) / 2000)
    expect(fit.x).toBeGreaterThanOrEqual(0)
    expect(fit.x + content.width * fit.k).toBeLessThanOrEqual(viewport.width)
    expect(fitView({ width: 100, height: 100 }, viewport, limits).k).toBe(1)
    expect(fitView(content, viewport, { min: 0.5, max: 2 }).k).toBe(0.5)
  })

  it('fitView at the zoom floor (still overflowing) lands on the anchor — the start — not the middle of the map', () => {
    const floor = { min: 0.5, max: 2 }
    const start = { x: 100, y: 20, width: 100, height: 50 } // the tree's first node, near the top-left
    const middle = fitView(content, viewport, floor)
    expect(middle.y).toBeCloseTo((600 - 2000 * 0.5) / 2) // the old landing: vertical centre, mid-tree
    const fit = fitView(content, viewport, floor, start)
    expect(fit).toEqual({ k: 0.5, x: PAN_SLACK, y: PAN_SLACK }) // both axes overflow: pinned at the start's corner
    expect(start.y * fit.k + fit.y).toBeGreaterThanOrEqual(0)
    expect((start.y + start.height) * fit.k + fit.y).toBeLessThanOrEqual(viewport.height)
    // an axis that fits is still centred (a phone-shaped map: full width at the floor, overflowing downward)
    const wide = { width: 1200, height: 600 }
    expect(fitView(content, wide, floor, start)).toEqual({ k: 0.5, x: (1200 - 500) / 2, y: PAN_SLACK })
    // with room for the whole map the anchor changes nothing
    expect(fitView(content, viewport, limits, start)).toEqual(fitView(content, viewport, limits))
  })

  it('centerOn / revealRect / the covered inset', () => {
    const rect = { x: 500, y: 1000, width: 100, height: 100 }
    const c = centerOn(rect, 1, content, viewport)
    expect([c.x + 550, c.y + 1050]).toEqual([200, 300])
    // Already visible: no movement. Off-screen: the smallest pan that shows it with its margin.
    expect(revealRect(c, rect, content, viewport)).toEqual(c)
    const r = revealRect({ x: 0, y: 0, k: 1 }, rect, content, viewport, 24)
    expect([r.x + 600, r.y + 1100]).toEqual([400 - 24, 600 - 24])
    // An overlay covering the bottom 300px shrinks the area everything is placed in.
    const area = uncovered(viewport, { bottom: 300 })
    expect(area).toEqual({ width: 400, height: 300 })
    expect(centerOn(rect, 1, content, area).y + 1050).toBe(150)
    expect(unionRect([rect, { x: 0, y: 0, width: 10, height: 10 }])).toEqual({ x: 0, y: 0, width: 600, height: 1100 })
    expect(unionRect([])).toBeUndefined()
  })

  it('frameRect: fits the rect within the margins, never above maxK or outside the limits, centred', () => {
    const rect = { x: 100, y: 200, width: 300, height: 800 }
    const framed = frameRect(rect, 1, content, viewport, limits)
    expect(framed.k).toBeCloseTo((600 - PAN_SLACK * 2) / 800)
    expect(framed.y + (rect.y + rect.height / 2) * framed.k).toBeCloseTo(300)
    expect(frameRect({ ...rect, height: 100 }, 1, content, viewport, limits).k).toBe(1)
    expect(frameRect(rect, 1, content, viewport, { min: 0.9, max: 2 }).k).toBe(0.9)
  })

  it('boundView `allow`: the bounds stretch to include an allowed offset, no further', () => {
    const out = { x: 120, y: -1500, k: 1 }
    expect(boundView(out, content, viewport, out)).toEqual(out)
    expect(boundView({ x: 200, y: 0, k: 1 }, content, viewport, out)).toEqual({ x: 120, y: 0, k: 1 })
    // a centred (smaller) axis may move to the allowed offset too
    expect(boundView({ x: 10, y: 0, k: 0.1 }, content, viewport, { x: 140, y: 200 })).toEqual({ x: 140, y: 200, k: 0.1 })
  })

  it('wheel: scrolling up zooms in, down zooms out; line/page deltas are normalised', () => {
    expect(wheelFactor(-100, 0, false)).toBeGreaterThan(1)
    expect(wheelFactor(100, 0, false)).toBeLessThan(1)
    expect(wheelFactor(-3, 1, false)).toBeCloseTo(wheelFactor(-48, 0, false))
  })
})

describe('keyboard focus is never left under the floating controls (design review P5-S1: phone "fit all")', () => {
  // The phone map at 375×812 as measured in Chromium (2026-10-14): a 360×536 box; the zoom controls a
  // column at its top-right; the legend toggle's strip (60px) reserved along the bottom.
  const layout = layoutFor('vertical')
  const content = { width: layout.width, height: layout.height }
  const area = uncovered({ width: 360, height: 536 }, { bottom: 60 })
  const controls: Rect = { x: 304, y: 8, width: 48, height: 180 }
  const screen = (b: Rect, v: View): Rect => ({ x: b.x * v.k + v.x, y: b.y * v.k + v.y, width: b.width * v.k, height: b.height * v.k })
  const covers = (a: Rect, b: Rect, gap = 0) => a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap
  const pointers = { mouse: POINTER_MIN_ZOOM, touch: tapFloorZoom(layout, MAP_LAYOUT_OPTIONS.vertical) }

  for (const [pointer, min] of Object.entries(pointers)) {
    it(`${pointer}: from "fit all", focusing any node pans it fully into view and clear of the controls`, () => {
      const fit = fitView(content, area, { min, max: MAX_ZOOM }, layout.nodes.get(layout.layers[0][0]))
      // the review's case: King Slime starts under the controls column (at the pan bounds, so a bounded pan can't help)
      expect(covers(screen(nodeExtent(graph, layout.nodes.get('king-slime')!), fit), controls)).toBe(true)
      for (const node of layout.nodes.values()) {
        const box = nodeExtent(graph, node)
        const view = revealClear(fit, box, content, area, [controls])
        const at = screen(box, view)
        expect(covers(at, controls, OBSTRUCTION_GAP - 1e-6), `${node.id} at ${JSON.stringify(at)}`).toBe(false)
        expect(at.x >= 0 && at.y >= 0 && at.x + at.width <= area.width && at.y + at.height <= area.height, node.id).toBe(true)
        // the view is applied as is (usePanZoom passes it as boundView's `allow`)
        expect(boundView(view, content, area, view)).toEqual(view)
      }
    })
  }

  it('with nothing in the way it is plain revealRect (the desktop row sits in a reserved strip, never in the way)', () => {
    const view = { x: -100, y: -200, k: 0.8 }
    const box = layout.nodes.get('plantera')!
    expect(revealClear(view, box, content, area, [])).toEqual(revealRect(view, box, content, area))
    expect(revealClear(view, box, content, area, [{ x: 0, y: area.height + 8, width: 180, height: 48 }])).toEqual(revealRect(view, box, content, area))
  })
})
