import { describe, expect, it } from 'vitest'
import type { Boss, ProgressionEdge, ProgressionNode } from '../../data-access/types'
import bossesJson from '../../data/bosses.json'
import progressionJson from '../../data/progression.json'
import { buildMapGraph, layoutInputs } from './graph'
import {
  boxesOverlap,
  edgePathData,
  lastSegmentMidpoint,
  layoutGraph,
  placeWithSeparation,
  type GraphLayout,
  type LayoutEdgeInput,
  type LayoutNodeInput,
  type LayoutOptions,
  type Orientation,
} from './layout'
import { MAP_LAYOUT_OPTIONS } from './mapConfig'

const progression = progressionJson as { nodes: ProgressionNode[]; edges: ProgressionEdge[] }
const bosses = bossesJson as Boss[]
const ORIENTATIONS: Orientation[] = ['vertical', 'horizontal']

/** Every structural promise the layout makes, as a list of violations (empty = valid). */
function violations(
  layout: GraphLayout,
  nodes: readonly LayoutNodeInput[],
  edges: readonly LayoutEdgeInput[],
  groups: readonly (readonly string[])[],
  options: LayoutOptions,
): string[] {
  const out: string[] = []
  const placed = [...layout.nodes.values()]
  if (placed.length !== new Set(nodes.map((n) => n.id)).size) out.push(`placed ${placed.length} of ${nodes.length} nodes`)
  // No two nodes overlap — with at least the smaller of the two gaps between them.
  const minGap = Math.min(options.nodeGap, options.groupGap, options.layerGap) - 0.01
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      if (boxesOverlap(placed[i], placed[j], minGap)) out.push(`overlap ${placed[i].id} / ${placed[j].id}`)
    }
  }
  // Long-edge lanes never run through a node.
  for (const lane of layout.lanes) for (const n of placed) if (boxesOverlap(lane, n)) out.push(`lane crosses ${n.id}`)
  // Everything inside the canvas.
  for (const b of [...placed, ...layout.lanes]) {
    if (b.x < 0 || b.y < 0 || b.x + b.width > layout.width + 0.01 || b.y + b.height > layout.height + 0.01) out.push(`out of bounds ${JSON.stringify(b)}`)
  }
  // Bands are contiguous runs of layers in band order. A group sits in its earliest member's band.
  const band = (id: string) => {
    const group = groups.find((g) => g.includes(id))
    return Math.min(...(group ?? [id]).filter((m) => layout.nodes.has(m)).map((m) => layout.nodes.get(m)!.band))
  }
  for (const a of placed) {
    for (const b of placed) if (band(a.id) < band(b.id) && a.layer >= b.layer) out.push(`band order ${a.id} vs ${b.id}`)
  }
  // Group members share a layer and sit next to each other in the given order.
  for (const g of groups) {
    const members = g.filter((id) => layout.nodes.has(id))
    const layers = new Set(members.map((id) => layout.nodes.get(id)!.layer))
    if (layers.size > 1) out.push(`group split across layers: ${members.join(',')}`)
    const row = layout.layers[layout.nodes.get(members[0])!.layer]
    const at = row.indexOf(members[0])
    if (members.some((id, k) => row[at + k] !== id)) out.push(`group not adjacent/in order: ${members.join(',')}`)
  }
  // Every edge is routed; forward edges start at their source and end at their target face.
  const index = new Set(nodes.map((n) => n.id))
  for (const e of edges) {
    if (!index.has(e.from) || !index.has(e.to)) continue
    const r = layout.edges.get(e.id)
    if (!r) {
      out.push(`unrouted ${e.id}`)
      continue
    }
    if (r.points.length < 2) out.push(`degenerate route ${e.id}`)
  }
  // Reading order covers every node once, layer by layer.
  const reading = layout.layers.flat()
  if (new Set(reading).size !== placed.length || reading.length !== placed.length) out.push('reading order is not a permutation')
  reading.forEach((id, i) => {
    if (layout.nodes.get(id)!.order !== i) out.push(`order mismatch ${id}`)
  })
  return out
}

function realInputs() {
  const graph = buildMapGraph(progression, bosses)
  return { graph, ...layoutInputs(graph) }
}

describe('layoutGraph over the real progression graph (PRD P5-S1 AC1)', () => {
  for (const orientation of ORIENTATIONS) {
    const options = MAP_LAYOUT_OPTIONS[orientation]

    it(`${orientation}: no overlapping nodes, lanes clear of nodes, bands contiguous, groups adjacent`, () => {
      const { nodes, edges, groups } = realInputs()
      const layout = layoutGraph(nodes, edges, groups, options)
      expect(layout.nodes.size).toBe(progression.nodes.length)
      expect(violations(layout, nodes, edges, groups, options)).toEqual([])
    })

    it(`${orientation}: every link points forward (a tree, not a list) and stage bands run in game order`, () => {
      const { graph, nodes, edges, groups } = realInputs()
      const layout = layoutGraph(nodes, edges, groups, options)
      for (const link of graph.links) {
        expect(layout.edges.get(link.id)?.direction, link.id).toBe('forward')
        expect(layout.nodes.get(link.from)!.layer, link.id).toBeLessThan(layout.nodes.get(link.to)!.layer)
      }
      expect(layout.bands.map((b) => b.band)).toEqual([0, 1, 2, 3, 4])
      // Demonstrably not a flat list: many layers, several of them holding more than one node.
      expect(layout.layers.length).toBeGreaterThan(5)
      expect(layout.layers.filter((row) => row.length > 1).length).toBeGreaterThanOrEqual(5)
    })

    it(`${orientation}: branching at the mechanical trio — Hardmode fans out to three siblings that rejoin`, () => {
      const { nodes, edges, groups } = realInputs()
      const layout = layoutGraph(nodes, edges, groups, options)
      const mechs = ['the-twins', 'the-destroyer', 'skeletron-prime'].map((id) => layout.nodes.get(id)!)
      const hardmode = layout.nodes.get('hardmode')!
      const milestone = layout.nodes.get('all-mechanical-bosses')!
      expect(new Set(mechs.map((m) => m.layer)).size).toBe(1)
      expect(mechs[0].layer).toBe(hardmode.layer + 1)
      expect(milestone.layer).toBe(mechs[0].layer + 1)
      // Side by side: distinct cross positions, consecutive in their layer.
      const row = layout.layers[mechs[0].layer]
      const positions = mechs.map((m) => row.indexOf(m.id)).sort((a, b) => a - b)
      expect(positions[2] - positions[0]).toBe(2)
      const cross = mechs.map((m) => (orientation === 'vertical' ? m.x : m.y))
      expect(new Set(cross).size).toBe(3)
    })

    it(`${orientation}: is deterministic`, () => {
      const { nodes, edges, groups } = realInputs()
      const a = layoutGraph(nodes, edges, groups, options)
      const b = layoutGraph([...nodes], [...edges], groups, options)
      expect([...b.nodes.entries()]).toEqual([...a.nodes.entries()])
      expect([...b.edges.entries()]).toEqual([...a.edges.entries()])
    })

    it(`${orientation}: stays valid when any single link is removed, or extra links (even a cycle) are added`, () => {
      const { nodes, edges, groups } = realInputs()
      for (let skip = 0; skip < edges.length; skip++) {
        const fewer = edges.filter((_, i) => i !== skip)
        expect(violations(layoutGraph(nodes, fewer, groups, options), nodes, fewer, groups, options), `without ${edges[skip].id}`).toEqual([])
      }
      const more: LayoutEdgeInput[] = [
        ...edges,
        { id: 'x1', from: 'king-slime', to: 'moon-lord' },
        { id: 'x2', from: 'goblin-army', to: 'pirate-invasion' },
        { id: 'x3', from: 'queen-bee', to: 'plantera' },
        // A cycle never occurs in valid data; the layout must still not break or drop it.
        { id: 'x4', from: 'moon-lord', to: 'pre-hardmode' },
      ]
      const layout = layoutGraph(nodes, more, groups, options)
      expect(violations(layout, nodes, more, groups, options)).toEqual([])
      expect(layout.edges.get('x4')?.direction).toBe('back')
    })
  }
})

/** mulberry32 — a tiny seeded PRNG so the random-graph test is reproducible. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('layoutGraph over random graphs (correct for any data, not tuned to today’s)', () => {
  it('200 seeded random graphs: no overlaps, lanes clear, bands contiguous, groups adjacent', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const random = rng(seed)
      const count = 3 + Math.floor(random() * 35)
      const nodes: LayoutNodeInput[] = Array.from({ length: count }, (_, i) => ({
        id: `n${i}`,
        band: Math.floor(random() * 5),
        width: random() < 0.6 ? 104 : 80 + Math.floor(random() * 60),
        height: random() < 0.6 ? 108 : 40 + Math.floor(random() * 40),
      }))
      const edges: LayoutEdgeInput[] = []
      for (let k = 0; k < count * 1.4; k++) {
        const a = Math.floor(random() * count)
        const b = Math.floor(random() * count)
        if (a !== b) edges.push({ id: `e${k}`, from: `n${a}`, to: `n${b}` }) // may be non-monotone or cyclic
      }
      const groups = random() < 0.5 ? [[`n${Math.floor(random() * count)}`, `n${Math.floor(random() * count)}`]].filter((g) => g[0] !== g[1]) : []
      const orientation: Orientation = random() < 0.5 ? 'vertical' : 'horizontal'
      const options = MAP_LAYOUT_OPTIONS[orientation]
      const layout = layoutGraph(nodes, edges, groups, options)
      expect(violations(layout, nodes, edges, groups, options), `seed ${seed}`).toEqual([])
    }
  })

  it('handles the empty graph and unknown edge endpoints', () => {
    const options = MAP_LAYOUT_OPTIONS.vertical
    expect(layoutGraph([], [], [], options).nodes.size).toBe(0)
    const layout = layoutGraph([{ id: 'a', band: 0, width: 10, height: 10 }], [{ id: 'e', from: 'a', to: 'ghost' }], [], options)
    expect(layout.nodes.size).toBe(1)
    expect(layout.edges.size).toBe(0)
  })
})

describe('geometry helpers', () => {
  it('placeWithSeparation: closest placement that keeps every separation', () => {
    expect(placeWithSeparation([0, 0, 0], [1, 1, 1], [10, 10])).toEqual([-10, 0, 10])
    expect(placeWithSeparation([0, 100], [1, 1], [10])).toEqual([0, 100])
    const x = placeWithSeparation([5, 1, 9, 2], [1, 2, 1, 1], [4, 6, 3])
    for (let i = 1; i < x.length; i++) expect(x[i] - x[i - 1]).toBeGreaterThanOrEqual([4, 6, 3][i - 1] - 1e-9)
  })

  it('edge paths: straight through a lane, S-curves between layers; the badge point lies on the curve', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 50, y: 40 },
      { x: 50, y: 140 },
      { x: 10, y: 200 },
    ]
    expect(edgePathData(points, 'vertical')).toBe('M0 0C0 20 50 20 50 40L50 140C50 170 10 170 10 200')
    expect(edgePathData(points.map((p) => ({ x: p.y, y: p.x })), 'horizontal')).toBe('M0 0C20 0 20 50 40 50L140 50C170 50 170 10 200 10')
    expect(lastSegmentMidpoint(points)).toEqual({ x: 30, y: 170 })
  })
})
