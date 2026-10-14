/**
 * Layered DAG layout for the boss progression map (PRD P5-S1 AC1, UX_SPEC §3.7). Pure and
 * deterministic: the same graph always yields the same picture, and nothing is hand-placed, so the
 * map stays correct when the progression data changes.
 *
 * Approach (a compact Sugiyama pipeline, documented for P5-S1):
 * 1. Units — nodes joined by a group (the world-evil either/or pair) become one unit that sits in a
 *    single layer, members side by side in the given order.
 * 2. Layers — longest path over the flow edges, constrained by BANDS (game stages): bands occupy
 *    consecutive, non-overlapping runs of layers in band order, so each stage reads as one stripe.
 *    Within a band a unit sits one layer below its deepest predecessor. A unit with no edges at all
 *    sits in its band's last layer. Cycles (never in valid data) are broken deterministically; an
 *    edge that points to an earlier layer is drawn as a "back" edge, never dropped.
 * 3. Lanes — an edge spanning several layers gets a lane slot in every layer it crosses, so long
 *    edges run between nodes instead of through them.
 * 4. Order — barycentre sweeps plus adjacent swaps, keeping the ordering with the fewest crossings.
 * 5. Cross coordinates — each layer is placed as close as possible to its neighbours' centres,
 *    solved exactly (weighted isotonic regression) under minimum-separation constraints, so
 *    neighbours in a layer can never overlap.
 * 6. Main coordinates — layer by layer, with extra lead-in space where a band starts (its label).
 *
 * Coordinates are computed on abstract axes — MAIN (the flow direction) and CROSS — and mapped to
 * x/y by orientation: `vertical` flows top→bottom (phones, tablets), `horizontal` left→right
 * (desktop, where the screen is wide).
 */

export type Orientation = 'vertical' | 'horizontal'

export interface LayoutNodeInput {
  id: string
  /** Band index (the game stage's order): bands occupy consecutive, non-overlapping layer runs. */
  band: number
  /** Box size in layout px. Width and height are screen axes, independent of orientation. */
  width: number
  height: number
}

export interface LayoutEdgeInput {
  /** Unique id, used to look the routed edge up. */
  id: string
  from: string
  to: string
}

/** Nodes drawn side by side in one layer, in this order (e.g. world-evil alternatives). */
export type LayoutGroupInput = readonly string[]

export interface LayoutOptions {
  orientation: Orientation
  /** Space between consecutive layers along the flow (main) axis. */
  layerGap: number
  /** Space between neighbouring nodes within a layer (cross axis). */
  nodeGap: number
  /** Space between the members of a group. */
  groupGap: number
  /** Cross-axis width reserved where a long edge passes through a layer. */
  laneWidth: number
  /** Extra main-axis space before each band's first layer (room for its label). */
  bandLeadIn: number
  /** Extra cross-axis space before the content (room for band labels in horizontal layouts). */
  crossLeadIn: number
  /** Outer margin on every side. */
  margin: number
}

export interface Point {
  x: number
  y: number
}

export interface Box {
  /** Left edge. */
  x: number
  /** Top edge. */
  y: number
  width: number
  height: number
}

export interface PlacedNode extends Box {
  id: string
  layer: number
  band: number
  /** Position in the map's reading order (layer by layer, along the cross axis). */
  order: number
}

export type EdgeDirection = 'forward' | 'flat' | 'back'

export interface RoutedEdge {
  id: string
  from: string
  to: string
  /** Source port → lane waypoints (enter/exit per crossed layer) → target port, in layout px. */
  points: Point[]
  /** forward: target in a later layer; flat: same layer; back: earlier layer (non-monotone data). */
  direction: EdgeDirection
}

export interface BandExtent {
  band: number
  firstLayer: number
  lastLayer: number
  /**
   * The band's stripe on the main axis: from its lead-in to the next band's lead-in. Consecutive
   * bands tile the canvas (the first starts at 0, the last ends at the canvas edge).
   */
  mainStart: number
  mainEnd: number
}

export interface GraphLayout {
  orientation: Orientation
  width: number
  height: number
  nodes: ReadonlyMap<string, PlacedNode>
  /** Node ids per layer in cross-axis order; `layers.flat()` is the reading (tab) order. */
  layers: readonly (readonly string[])[]
  edges: ReadonlyMap<string, RoutedEdge>
  /** Where long edges pass through layers (exposed so tests can check they miss every node). */
  lanes: readonly Box[]
  bands: readonly BandExtent[]
  /** Main-axis span of every layer (start/end of its tallest box). */
  layerSpans: readonly { mainStart: number; mainEnd: number }[]
  /** Layer gap the layout was made with (renderers place forks/badges inside it). */
  layerGap: number
}

/* ------------------------------------------------------------------------------------------ */

interface Unit {
  members: number[]
  band: number
  /** First input position among its members: the deterministic tie-breaker. */
  rank: number
}

type Slot = { kind: 'unit'; unit: number } | { kind: 'lane'; edge: number }

interface UnitEdge {
  /** Index into the valid-edge list. */
  edge: number
  from: number
  to: number
}

/** Sizes on the abstract axes. */
const mainSize = (n: LayoutNodeInput, o: Orientation) => (o === 'vertical' ? n.height : n.width)
const crossSize = (n: LayoutNodeInput, o: Orientation) => (o === 'vertical' ? n.width : n.height)

/** Union-find over node indexes (groups → units). */
function unionFind(size: number) {
  const parent = Array.from({ length: size }, (_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  const union = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb)
  }
  return { find, union }
}

/**
 * Weighted isotonic regression with minimum separations: minimises Σ w·(x − target)² subject to
 * x[i+1] − x[i] ≥ sep[i] (pool-adjacent-violators on the separation-shifted problem).
 */
export function placeWithSeparation(targets: readonly number[], weights: readonly number[], seps: readonly number[]): number[] {
  const n = targets.length
  const offset: number[] = new Array(n).fill(0)
  for (let i = 1; i < n; i++) offset[i] = offset[i - 1] + seps[i - 1]
  const blocks: { w: number; wt: number; start: number; end: number }[] = []
  for (let i = 0; i < n; i++) {
    blocks.push({ w: weights[i], wt: weights[i] * (targets[i] - offset[i]), start: i, end: i })
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1]
      const a = blocks[blocks.length - 2]
      if (a.wt / a.w <= b.wt / b.w) break
      blocks.splice(blocks.length - 2, 2, { w: a.w + b.w, wt: a.wt + b.wt, start: a.start, end: b.end })
    }
  }
  const x: number[] = new Array(n)
  for (const b of blocks) for (let i = b.start; i <= b.end; i++) x[i] = b.wt / b.w + offset[i]
  // Guard against floating-point drift: the separations are hard constraints.
  for (let i = 1; i < n; i++) x[i] = Math.max(x[i], x[i - 1] + seps[i - 1])
  return x
}

/** Crossings between two adjacent layers' segments (pairs of slot positions upper → lower). */
function crossingsBetween(segments: readonly (readonly [number, number])[]): number {
  let count = 0
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const [a1, b1] = segments[i]
      const [a2, b2] = segments[j]
      if ((a1 - a2) * (b1 - b2) < 0) count++
    }
  }
  return count
}

export function layoutGraph(
  nodesIn: readonly LayoutNodeInput[],
  edgesIn: readonly LayoutEdgeInput[],
  groupsIn: readonly LayoutGroupInput[],
  options: LayoutOptions,
): GraphLayout {
  const o = options.orientation
  const index = new Map<string, number>()
  nodesIn.forEach((n, i) => {
    if (!index.has(n.id)) index.set(n.id, i)
  })
  const nodes = nodesIn.filter((n, i) => index.get(n.id) === i)
  // Re-index after de-duplication.
  index.clear()
  nodes.forEach((n, i) => index.set(n.id, i))
  const edges = edgesIn.filter((e) => index.has(e.from) && index.has(e.to))

  /* ---- 1. Units ---- */
  const uf = unionFind(nodes.length)
  for (const group of groupsIn) {
    const ids = group.filter((id) => index.has(id))
    for (let i = 1; i < ids.length; i++) uf.union(index.get(ids[0])!, index.get(ids[i])!)
  }
  // Member order: group order first (first group listing wins), then input order.
  const groupRank = new Map<number, number>()
  let counter = 0
  for (const group of groupsIn) for (const id of group) if (index.has(id) && !groupRank.has(index.get(id)!)) groupRank.set(index.get(id)!, counter++)
  const unitOfRoot = new Map<number, number>()
  const units: Unit[] = []
  const unitOf: number[] = new Array(nodes.length)
  nodes.forEach((n, i) => {
    const root = uf.find(i)
    let u = unitOfRoot.get(root)
    if (u === undefined) {
      u = units.length
      unitOfRoot.set(root, u)
      units.push({ members: [], band: n.band, rank: i })
    }
    units[u].members.push(i)
    units[u].band = Math.min(units[u].band, n.band)
    unitOf[i] = u
  })
  for (const unit of units) {
    unit.members.sort((a, b) => (groupRank.get(a) ?? Infinity) - (groupRank.get(b) ?? Infinity) || a - b)
  }

  /* ---- 2. Layers (band-constrained longest path, deterministic cycle breaking) ---- */
  const unitEdges: UnitEdge[] = []
  edges.forEach((e, ei) => {
    const from = unitOf[index.get(e.from)!]
    const to = unitOf[index.get(e.to)!]
    if (from !== to) unitEdges.push({ edge: ei, from, to })
  })
  const preds: number[][] = units.map(() => [])
  const succs: number[][] = units.map(() => [])
  for (const ue of unitEdges) {
    preds[ue.to].push(ue.from)
    succs[ue.from].push(ue.to)
  }
  const byPriority = (a: number, b: number) => units[a].band - units[b].band || units[a].rank - units[b].rank
  // Kahn's algorithm; on a cycle, release the highest-priority remaining unit.
  const indegree = units.map((_, u) => preds[u].length)
  const done = new Set<number>()
  const topo: number[] = []
  while (topo.length < units.length) {
    const ready = units.map((_, u) => u).filter((u) => !done.has(u) && indegree[u] === 0)
    const next = (ready.length > 0 ? ready : units.map((_, u) => u).filter((u) => !done.has(u))).sort(byPriority)[0]
    done.add(next)
    topo.push(next)
    for (const s of succs[next]) indegree[s]--
  }
  const layerOf: number[] = new Array(units.length).fill(-1)
  const bandsPresent = [...new Set(units.map((u) => u.band))].sort((a, b) => a - b)
  let maxLayer = -1
  for (const band of bandsPresent) {
    const bandStart = maxLayer + 1
    const inBand = topo.filter((u) => units[u].band === band)
    const isolated = inBand.filter((u) => preds[u].length === 0 && succs[u].length === 0)
    let bandMax = bandStart
    for (const u of inBand) {
      if (isolated.includes(u)) continue
      let layer = bandStart
      for (const p of preds[u]) if (layerOf[p] >= 0) layer = Math.max(layer, layerOf[p] + 1)
      layerOf[u] = layer
      bandMax = Math.max(bandMax, layer)
    }
    for (const u of isolated) layerOf[u] = bandMax
    maxLayer = Math.max(maxLayer, bandMax)
  }
  const layerCount = maxLayer + 1

  /* ---- 3. Slots (units + lanes for long forward edges) ---- */
  const slotLayers: Slot[][] = Array.from({ length: layerCount }, () => [])
  const unitSlot = new Map<number, number>() // unit → index into slots
  const slots: { slot: Slot; layer: number }[] = []
  const addSlot = (slot: Slot, layer: number) => {
    slots.push({ slot, layer })
    slotLayers[layer].push(slot)
    return slots.length - 1
  }
  // Initial order: reading priority within each layer.
  for (const u of [...units.keys()].sort(byPriority)) unitSlot.set(u, addSlot({ kind: 'unit', unit: u }, layerOf[u]))
  const edgeLanes = new Map<number, number[]>() // valid edge index → its lane slot ids, top to bottom
  // Segments: consecutive slot pairs (upper slot id, lower slot id) along each forward edge.
  const segments: { upper: number; lower: number; layer: number }[] = []
  for (const ue of unitEdges) {
    const a = layerOf[ue.from]
    const b = layerOf[ue.to]
    if (b <= a) continue
    const chain = [unitSlot.get(ue.from)!]
    const lanes: number[] = []
    for (let l = a + 1; l < b; l++) {
      const id = addSlot({ kind: 'lane', edge: ue.edge }, l)
      lanes.push(id)
      chain.push(id)
    }
    chain.push(unitSlot.get(ue.to)!)
    edgeLanes.set(ue.edge, lanes)
    for (let i = 0; i + 1 < chain.length; i++) segments.push({ upper: chain[i], lower: chain[i + 1], layer: a + i })
  }
  const slotIdsByLayer: number[][] = Array.from({ length: layerCount }, () => [])
  slots.forEach((s, id) => slotIdsByLayer[s.layer].push(id))
  const upperOf: number[][] = slots.map(() => [])
  const lowerOf: number[][] = slots.map(() => [])
  for (const seg of segments) {
    lowerOf[seg.upper].push(seg.lower)
    upperOf[seg.lower].push(seg.upper)
  }

  /* ---- 4. Ordering: barycentre sweeps + adjacent swaps, best by total crossings ---- */
  const position = new Map<number, number>()
  const writePositions = (order: number[][]) => order.forEach((ids) => ids.forEach((id, i) => position.set(id, i)))
  const totalCrossings = (order: number[][]) => {
    writePositions(order)
    let total = 0
    for (let l = 0; l + 1 < layerCount; l++) {
      total += crossingsBetween(
        segments.filter((s) => s.layer === l).map((s) => [position.get(s.upper)!, position.get(s.lower)!] as const),
      )
    }
    return total
  }
  const barycentre = (ns: number[]) => ns.reduce((sum, n) => sum + position.get(n)!, 0) / ns.length
  /**
   * Classic barycentre step: slots with no neighbours on the sweep side keep their positions; the
   * rest are sorted by barycentre, ties broken by their other side (a slot that continues the flow
   * sits with its siblings, dead ends move aside — the mech trio stays together), then position.
   */
  const sortByBarycentre = (ids: number[], primary: number[][], secondary: number[][]) => {
    const movable = ids
      .map((id, i) => ({ id, i }))
      .filter(({ id }) => primary[id].length > 0)
      .map(({ id, i }) => ({
        id,
        i,
        key: barycentre(primary[id]),
        tie: secondary[id].length ? barycentre(secondary[id]) : Infinity,
      }))
      .sort((a, b) => a.key - b.key || a.tie - b.tie || a.i - b.i)
    let next = 0
    return ids.map((id) => (primary[id].length > 0 ? movable[next++].id : id))
  }
  let order = slotIdsByLayer.map((ids) => [...ids])
  // Initial top-down pass so lanes start near their source.
  writePositions(order)
  for (let l = 1; l < layerCount; l++) {
    order[l] = sortByBarycentre(order[l], upperOf, lowerOf)
    order[l].forEach((id, i) => position.set(id, i))
  }
  let best = order.map((ids) => [...ids])
  let bestCrossings = totalCrossings(best)
  for (let sweep = 0; sweep < 16 && bestCrossings > 0; sweep++) {
    order = order.map((ids) => [...ids])
    writePositions(order)
    if (sweep % 2 === 0) {
      for (let l = 1; l < layerCount; l++) {
        order[l] = sortByBarycentre(order[l], upperOf, lowerOf)
        order[l].forEach((id, i) => position.set(id, i))
      }
    } else {
      for (let l = layerCount - 2; l >= 0; l--) {
        order[l] = sortByBarycentre(order[l], lowerOf, upperOf)
        order[l].forEach((id, i) => position.set(id, i))
      }
    }
    const crossings = totalCrossings(order)
    if (crossings < bestCrossings) {
      best = order.map((ids) => [...ids])
      bestCrossings = crossings
    }
  }
  // Adjacent swaps (transpose) while they strictly reduce crossings.
  order = best
  for (let round = 0; round < 8 && bestCrossings > 0; round++) {
    let improved = false
    for (let l = 0; l < layerCount; l++) {
      for (let i = 0; i + 1 < order[l].length; i++) {
        const trial = order.map((ids) => [...ids])
        ;[trial[l][i], trial[l][i + 1]] = [trial[l][i + 1], trial[l][i]]
        const crossings = totalCrossings(trial)
        if (crossings < bestCrossings) {
          order = trial
          bestCrossings = crossings
          improved = true
        }
      }
    }
    if (!improved) break
  }
  writePositions(order)

  /* ---- 5. Cross coordinates ---- */
  const slotCross = (id: number) => {
    const { slot } = slots[id]
    if (slot.kind === 'lane') return options.laneWidth
    const members = units[slot.unit].members
    return members.reduce((sum, m) => sum + crossSize(nodes[m], o), 0) + options.groupGap * (members.length - 1)
  }
  const separation = (a: number, b: number) => {
    const lane = slots[a].slot.kind === 'lane' || slots[b].slot.kind === 'lane'
    return (slotCross(a) + slotCross(b)) / 2 + (lane ? options.nodeGap / 2 : options.nodeGap)
  }
  const center = new Map<number, number>()
  for (const ids of order) {
    const seps = ids.slice(1).map((id, i) => separation(ids[i], id))
    const width = seps.reduce((s, v) => s + v, 0)
    let x = -width / 2
    ids.forEach((id, i) => {
      if (i > 0) x += seps[i - 1]
      center.set(id, x)
    })
  }
  const weight = (id: number) => (slots[id].slot.kind === 'lane' ? 2 : 1)
  const relax = (l: number, neighbours: number[][]) => {
    const ids = order[l]
    if (ids.length === 0) return
    const targets = ids.map((id) => {
      const ns = neighbours[id]
      return ns.length ? ns.reduce((sum, n) => sum + center.get(n)!, 0) / ns.length : center.get(id)!
    })
    const seps = ids.slice(1).map((id, i) => separation(ids[i], id))
    const placed = placeWithSeparation(targets, ids.map(weight), seps)
    ids.forEach((id, i) => center.set(id, placed[i]))
  }
  for (let iter = 0; iter < 12; iter++) {
    if (iter % 2 === 0) for (let l = 1; l < layerCount; l++) relax(l, upperOf)
    else for (let l = layerCount - 2; l >= 0; l--) relax(l, lowerOf)
  }
  // Final top-down pass blends both neighbours so a node centres between its parents and children.
  const both = slots.map((_, id) => [...upperOf[id], ...lowerOf[id]])
  for (let l = 0; l < layerCount; l++) relax(l, both)

  /* ---- 6. Main coordinates ---- */
  const layerMain = order.map((ids) =>
    ids.reduce((max, id) => {
      const { slot } = slots[id]
      if (slot.kind === 'lane') return max
      return Math.max(max, ...units[slot.unit].members.map((m) => mainSize(nodes[m], o)))
    }, 0),
  )
  const firstLayerOfBand = new Map<number, number>()
  const lastLayerOfBand = new Map<number, number>()
  units.forEach((unit, u) => {
    const l = layerOf[u]
    firstLayerOfBand.set(unit.band, Math.min(firstLayerOfBand.get(unit.band) ?? Infinity, l))
    lastLayerOfBand.set(unit.band, Math.max(lastLayerOfBand.get(unit.band) ?? -Infinity, l))
  })
  const bandStartsAt = new Set(firstLayerOfBand.values())
  const mainStart: number[] = []
  let cursor = options.margin
  for (let l = 0; l < layerCount; l++) {
    if (bandStartsAt.has(l)) cursor += options.bandLeadIn
    mainStart.push(cursor)
    cursor += layerMain[l] + options.layerGap
  }
  const mainExtent = (layerCount ? cursor - options.layerGap : cursor) + options.margin

  // Shift the cross axis so the content starts after the margin + lead-in.
  let minCross = Infinity
  let maxCross = -Infinity
  center.forEach((c, id) => {
    minCross = Math.min(minCross, c - slotCross(id) / 2)
    maxCross = Math.max(maxCross, c + slotCross(id) / 2)
  })
  if (!Number.isFinite(minCross)) {
    minCross = 0
    maxCross = 0
  }
  const crossShift = options.margin + options.crossLeadIn - minCross
  const crossExtent = maxCross - minCross + options.margin * 2 + options.crossLeadIn

  /* ---- Output (abstract → x/y) ---- */
  const toXY = (main: number, cross: number): Point => (o === 'vertical' ? { x: cross, y: main } : { x: main, y: cross })
  const placed = new Map<string, PlacedNode>()
  const layers: string[][] = []
  let reading = 0
  order.forEach((ids, l) => {
    const row: string[] = []
    for (const id of ids) {
      const { slot } = slots[id]
      if (slot.kind !== 'unit') continue
      const members = units[slot.unit].members
      let cross = center.get(id)! + crossShift - slotCross(id) / 2
      for (const m of members) {
        const n = nodes[m]
        const ms = mainSize(n, o)
        const cs = crossSize(n, o)
        const main = mainStart[l] + (layerMain[l] - ms) / 2
        const { x, y } = toXY(main, cross)
        placed.set(n.id, { id: n.id, x, y, width: n.width, height: n.height, layer: l, band: n.band, order: reading++ })
        row.push(n.id)
        cross += cs + options.groupGap
      }
    }
    layers.push(row)
  })

  const lanes: Box[] = []
  const laneCross = (slotId: number) => center.get(slotId)! + crossShift
  slots.forEach((s, id) => {
    if (s.slot.kind !== 'lane') return
    const c = laneCross(id)
    const box = { main: mainStart[s.layer], cross: c - options.laneWidth / 2, mainLen: layerMain[s.layer], crossLen: options.laneWidth }
    lanes.push(
      o === 'vertical'
        ? { x: box.cross, y: box.main, width: box.crossLen, height: box.mainLen }
        : { x: box.main, y: box.cross, width: box.mainLen, height: box.crossLen },
    )
  })

  /* ---- Routes: ports spread along a face, sorted by where each edge goes ---- */
  const crossOf = (p: Point) => (o === 'vertical' ? p.x : p.y)
  const box = (id: string) => placed.get(id)!
  const centerCross = (b: Box) => (o === 'vertical' ? b.x + b.width / 2 : b.y + b.height / 2)
  const mainStartOf = (b: Box) => (o === 'vertical' ? b.y : b.x)
  const mainEndOf = (b: Box) => (o === 'vertical' ? b.y + b.height : b.x + b.width)
  const crossLen = (b: Box) => (o === 'vertical' ? b.width : b.height)

  interface Draft {
    edge: number
    direction: EdgeDirection
    inner: Point[]
  }
  const drafts: Draft[] = edges.map((e, ei) => {
    const a = placed.get(e.from)!
    const b = placed.get(e.to)!
    const direction: EdgeDirection = b.layer > a.layer ? 'forward' : b.layer === a.layer ? 'flat' : 'back'
    const inner: Point[] = []
    if (direction === 'forward') {
      for (const laneId of edgeLanes.get(ei) ?? []) {
        const l = slots[laneId].layer
        const c = laneCross(laneId)
        inner.push(toXY(mainStart[l], c), toXY(mainStart[l] + layerMain[l], c))
      }
    }
    return { edge: ei, direction, inner }
  })

  // Port offsets per (node, face): forward edges only; flat/back edges use the face centre.
  const portOffset = new Map<string, number>()
  const assignPorts = (face: 'out' | 'in') => {
    const byNode = new Map<string, { key: string; toward: number }[]>()
    drafts.forEach((d) => {
      if (d.direction !== 'forward') return
      const e = edges[d.edge]
      const nodeId = face === 'out' ? e.from : e.to
      const other = face === 'out' ? e.to : e.from
      const toward =
        d.inner.length > 0 ? crossOf(face === 'out' ? d.inner[0] : d.inner[d.inner.length - 1]) : centerCross(box(other))
      const list = byNode.get(nodeId) ?? []
      list.push({ key: `${face}:${d.edge}`, toward })
      byNode.set(nodeId, list)
    })
    byNode.forEach((list, nodeId) => {
      list.sort((p, q) => p.toward - q.toward)
      const span = crossLen(box(nodeId)) * 0.5
      const step = list.length > 1 ? Math.min(14, span / (list.length - 1)) : 0
      list.forEach((p, i) => portOffset.set(p.key, (i - (list.length - 1) / 2) * step))
    })
  }
  assignPorts('out')
  assignPorts('in')

  const routed = new Map<string, RoutedEdge>()
  drafts.forEach((d) => {
    const e = edges[d.edge]
    const a = box(e.from)
    const b = box(e.to)
    let points: Point[]
    if (d.direction === 'forward') {
      points = [
        toXY(mainEndOf(a), centerCross(a) + (portOffset.get(`out:${d.edge}`) ?? 0)),
        ...d.inner,
        toXY(mainStartOf(b), centerCross(b) + (portOffset.get(`in:${d.edge}`) ?? 0)),
      ]
    } else if (d.direction === 'flat') {
      const aMid = mainStartOf(a) + (mainEndOf(a) - mainStartOf(a)) / 2
      const bMid = mainStartOf(b) + (mainEndOf(b) - mainStartOf(b)) / 2
      const leftToRight = centerCross(a) <= centerCross(b)
      const aFace = centerCross(a) + (leftToRight ? 1 : -1) * (crossLen(a) / 2)
      const bFace = centerCross(b) + (leftToRight ? -1 : 1) * (crossLen(b) / 2)
      points = [toXY(aMid, aFace), toXY(bMid, bFace)]
    } else {
      points = [toXY(mainStartOf(a), centerCross(a)), toXY(mainEndOf(b), centerCross(b))]
    }
    routed.set(e.id, { id: e.id, from: e.from, to: e.to, points, direction: d.direction })
  })

  // Band stripes tile the main axis: each runs from its lead-in to the next band's lead-in (the
  // first from the canvas start, the last to the canvas end).
  const bandStarts = bandsPresent.map((band, i) => (i === 0 ? 0 : mainStart[firstLayerOfBand.get(band)!] - options.bandLeadIn))
  const bands: BandExtent[] = bandsPresent.map((band, i) => ({
    band,
    firstLayer: firstLayerOfBand.get(band)!,
    lastLayer: lastLayerOfBand.get(band)!,
    mainStart: bandStarts[i],
    mainEnd: i + 1 < bandStarts.length ? bandStarts[i + 1] : mainExtent,
  }))

  const size = toXY(mainExtent, crossExtent)
  return {
    orientation: o,
    width: size.x,
    height: size.y,
    nodes: placed,
    layers,
    edges: routed,
    lanes,
    bands,
    layerSpans: mainStart.map((start, l) => ({ mainStart: start, mainEnd: start + layerMain[l] })),
    layerGap: options.layerGap,
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Geometry helpers shared by the renderer                                                     */

/** True when two boxes overlap (touching edges do not count). */
export function boxesOverlap(a: Box, b: Box, gap = 0): boolean {
  return a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap
}

/**
 * SVG path through route points: straight where consecutive points share the cross coordinate
 * (a lane through a layer), otherwise an S-curve whose tangents follow the flow direction.
 */
export function edgePathData(points: readonly Point[], orientation: Orientation): string {
  if (points.length === 0) return ''
  const f = (n: number) => Math.round(n * 10) / 10
  let d = `M${f(points[0].x)} ${f(points[0].y)}`
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1]
    const q = points[i]
    const straight = orientation === 'vertical' ? Math.abs(p.x - q.x) < 0.5 : Math.abs(p.y - q.y) < 0.5
    if (straight) {
      d += `L${f(q.x)} ${f(q.y)}`
    } else if (orientation === 'vertical') {
      const my = (p.y + q.y) / 2
      d += `C${f(p.x)} ${f(my)} ${f(q.x)} ${f(my)} ${f(q.x)} ${f(q.y)}`
    } else {
      const mx = (p.x + q.x) / 2
      d += `C${f(mx)} ${f(p.y)} ${f(mx)} ${f(q.y)} ${f(q.x)} ${f(q.y)}`
    }
  }
  return d
}

/** Midpoint of the route's last segment — on the S-curve itself (its t = 0.5 point). */
export function lastSegmentMidpoint(points: readonly Point[]): Point {
  const q = points[points.length - 1]
  const p = points.length > 1 ? points[points.length - 2] : q
  return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }
}
