/**
 * Progression data → the map's graph model (PRD P5-S1; UX_SPEC §3.7, §9). Pure functions over the
 * schema types only, so the map follows progression.json / bosses.json as they regenerate.
 *
 * - Parallel edges between one pair of nodes merge into one LINK carrying every type (drawn in the
 *   line style of the highest-precedence type, with every type's icon).
 * - `alternative-route` edges are not flow: they join their nodes into an EITHER/OR GROUP drawn
 *   side by side in one layer (Eater of Worlds / Brain of Cthulhu). The group's root is the edge's
 *   `from`. Incoming links to the root fork to every member.
 * - World evil (tc.v1.progress.worldEvil) picks the member that is "taken": the member whose
 *   `worldEvil` matches. With no world evil chosen ("Both") NO member is taken — the pair is drawn
 *   symmetrically, neither member preferred.
 * - Each node carries its on-map LABEL: the name, or a shorter form where the name can't fit its box
 *   word by word (SHORT_LABELS). The full name stays the node's accessible name and the focus card's.
 */
import { getStageInfo, isStage, STAGE_IDS } from '../../app/stages'
import type { Boss, ProgressionEdge, ProgressionNode } from '../../data-access/types'
import { byPrecedence, EDGE_PRECEDENCE, EDGE_STYLES, type EdgeType } from './edgeStyles'
import type { GraphLayout, LayoutEdgeInput, LayoutNodeInput } from './layout'

export type WorldEvil = NonNullable<ProgressionNode['worldEvil']>
export type NodeKind = ProgressionNode['kind']
export type NodeState = 'defeated' | 'skipped'

export interface MapNode {
  id: string
  kind: NodeKind
  name: string
  /** The name as drawn on the map (SHORT_LABELS); screen readers and the focus card get `name`. */
  label: string
  stage: ProgressionNode['stage']
  worldEvil?: WorldEvil
  wikiUrl: string
  node: ProgressionNode
  /** The boss record behind a boss node (absent for events/milestones, or a missing record). */
  boss?: Boss
}

export interface MapLink {
  /** `${from}->${to}` */
  id: string
  from: string
  to: string
  /** Every type on this pair, by drawing precedence. */
  types: EdgeType[]
  /** The type that draws the line (types[0]). */
  primary: EdgeType
  /** The underlying data edges (each with its own sourceUrl). */
  edges: ProgressionEdge[]
}

export interface MapGraph {
  /** The progression data the graph was built from (gate satisfaction, src/scoring/progress.ts). */
  progression: { nodes: readonly ProgressionNode[]; edges: readonly ProgressionEdge[] }
  nodes: MapNode[]
  nodeById: ReadonlyMap<string, MapNode>
  /** Flow links: every edge type except alternative-route, parallel edges merged. */
  links: MapLink[]
  /** alternative-route links. */
  altLinks: MapLink[]
  /** Either/or groups (>= 2 members), root first. */
  groups: string[][]
}

export const linkId = (from: string, to: string) => `${from}->${to}`

function mergeLinks(edges: readonly ProgressionEdge[]): MapLink[] {
  const byPair = new Map<string, ProgressionEdge[]>()
  for (const e of edges) {
    const id = linkId(e.from, e.to)
    byPair.set(id, [...(byPair.get(id) ?? []), e])
  }
  return [...byPair.entries()].map(([id, list]) => {
    const types = byPrecedence(list.map((e) => e.type))
    const edgesByPrecedence = [...list].sort((a, b) => types.indexOf(a.type) - types.indexOf(b.type))
    return { id, from: list[0].from, to: list[0].to, types, primary: types[0], edges: edgesByPrecedence }
  })
}

/** Connected components of the alternative-route edges, each ordered root-first along the edges. */
function eitherOrGroups(nodeOrder: readonly string[], alt: readonly ProgressionEdge[]): string[][] {
  const neighbours = new Map<string, Set<string>>()
  const hasIncoming = new Set<string>()
  const out = new Map<string, string[]>()
  for (const e of alt) {
    for (const [a, b] of [[e.from, e.to], [e.to, e.from]] as const) {
      neighbours.set(a, (neighbours.get(a) ?? new Set()).add(b))
    }
    hasIncoming.add(e.to)
    out.set(e.from, [...(out.get(e.from) ?? []), e.to])
  }
  const position = (id: string) => nodeOrder.indexOf(id)
  const seen = new Set<string>()
  const groups: string[][] = []
  for (const start of [...neighbours.keys()].sort((a, b) => position(a) - position(b))) {
    if (seen.has(start)) continue
    // Collect the component.
    const component: string[] = []
    const stack = [start]
    seen.add(start)
    while (stack.length) {
      const id = stack.pop()!
      component.push(id)
      for (const n of neighbours.get(id) ?? []) {
        if (!seen.has(n)) {
          seen.add(n)
          stack.push(n)
        }
      }
    }
    // Order: roots (no incoming alternative edge) first, then breadth-first along the edges.
    const roots = component.filter((id) => !hasIncoming.has(id)).sort((a, b) => position(a) - position(b))
    const ordered: string[] = []
    const queue = roots.length ? roots : [component.sort((a, b) => position(a) - position(b))[0]]
    while (queue.length) {
      const id = queue.shift()!
      if (ordered.includes(id)) continue
      ordered.push(id)
      for (const n of (out.get(id) ?? []).sort((a, b) => position(a) - position(b))) queue.push(n)
    }
    for (const id of component.sort((a, b) => position(a) - position(b))) if (!ordered.includes(id)) ordered.push(id)
    groups.push(ordered)
  }
  return groups
}

export function buildMapGraph(
  progression: { nodes: readonly ProgressionNode[]; edges: readonly ProgressionEdge[] },
  bosses: readonly Boss[],
): MapGraph {
  const bossById = new Map(bosses.map((b) => [b.id, b]))
  const nodes: MapNode[] = progression.nodes.map((node) => ({
    id: node.id,
    kind: node.kind,
    name: node.name,
    label: SHORT_LABELS[node.id] ?? node.name,
    stage: node.stage,
    worldEvil: node.worldEvil,
    wikiUrl: node.wikiUrl,
    node,
    boss: node.bossId ? bossById.get(node.bossId) : undefined,
  }))
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const known = progression.edges.filter((e) => nodeById.has(e.from) && nodeById.has(e.to))
  const alt = known.filter((e) => e.type === 'alternative-route')
  return {
    progression,
    nodes,
    nodeById,
    links: mergeLinks(known.filter((e) => e.type !== 'alternative-route')),
    altLinks: mergeLinks(alt),
    groups: eitherOrGroups(
      nodes.map((n) => n.id),
      alt,
    ),
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Layout inputs                                                                               */

/** Node box sizes in map px: bosses carry art; events/milestones are compact markers (A3). */
export const NODE_SIZE: Readonly<Record<'boss' | 'marker', { width: number; height: number }>> = {
  boss: { width: 104, height: 114 },
  marker: { width: 104, height: 56 },
}

export const nodeSize = (kind: NodeKind) => (kind === 'boss' ? NODE_SIZE.boss : NODE_SIZE.marker)

/**
 * The label's text box inside a node (map px wide) and how many lines it shows — BossNode's layout:
 * a boss name under its ring (2px border + `px-1` either side; `line-clamp-2`), a marker's beside its
 * 16px glyph (2px border + `px-2` either side, `gap-1.5`; `line-clamp-3`). Labels wrap between words
 * only (`wrap-normal`), so every word of every label must fit this width — nodeMap.test.ts checks the
 * real data's labels against it.
 */
export const NODE_LABEL_BOX: Readonly<Record<'boss' | 'marker', { width: number; lines: number }>> = {
  boss: { width: NODE_SIZE.boss.width - 2 * 2 - 2 * 4, lines: 2 },
  marker: { width: NODE_SIZE.marker.width - 2 * 2 - 2 * 8 - 16 - 6, lines: 3 },
}

export const labelBox = (kind: NodeKind) => (kind === 'boss' ? NODE_LABEL_BOX.boss : NODE_LABEL_BOX.marker)

/**
 * On-map labels for names that can't fit their node box word by word (a marker's text box is 62px:
 * "mechanical" alone is wider). Display only — the node's accessible name, its description and the
 * focus card keep the full name.
 */
export const SHORT_LABELS: Readonly<Record<string, string>> = {
  'all-mechanical-bosses': 'All mech bosses',
}

/** Band = the stage's position in the game's stage order. */
export const stageBand = (stage: string) => {
  const i = (STAGE_IDS as readonly string[]).indexOf(stage)
  return i < 0 ? STAGE_IDS.length : i
}

export function layoutInputs(graph: MapGraph): { nodes: LayoutNodeInput[]; edges: LayoutEdgeInput[]; groups: string[][] } {
  return {
    nodes: graph.nodes.map((n) => ({ id: n.id, band: stageBand(n.stage), ...nodeSize(n.kind) })),
    edges: graph.links.map((l) => ({ id: l.id, from: l.from, to: l.to })),
    groups: graph.groups,
  }
}

/* ------------------------------------------------------------------------------------------ */
/* World evil                                                                                  */

/** A node is out of play when it belongs to the other world evil. No choice = everything in play. */
export function isNodeActive(node: Pick<MapNode, 'worldEvil'>, worldEvil: WorldEvil | null): boolean {
  return worldEvil === null || node.worldEvil === undefined || node.worldEvil === worldEvil
}

export function isLinkActive(graph: MapGraph, link: Pick<MapLink, 'from' | 'to'>, worldEvil: WorldEvil | null): boolean {
  const a = graph.nodeById.get(link.from)
  const b = graph.nodeById.get(link.to)
  return !!a && !!b && isNodeActive(a, worldEvil) && isNodeActive(b, worldEvil)
}

/**
 * The group member on the main path: the one matching the chosen world evil. None with no world evil
 * chosen ("Both"): neither member is preferred.
 */
export function takenMember(graph: MapGraph, group: readonly string[], worldEvil: WorldEvil | null): string | undefined {
  return worldEvil ? group.find((id) => graph.nodeById.get(id)?.worldEvil === worldEvil) : undefined
}

export interface ForkBranch {
  member: string
  /**
   * Line style: the incoming link's type for the taken member, alternative-route for the others — so
   * with nothing taken ("Both") every branch is an alternative route, drawn alike.
   */
  type: EdgeType
  taken: boolean
  active: boolean
}

/** One branch per group member, from the fork: symmetric until a world evil picks the taken member. */
export function forkBranches(
  graph: MapGraph,
  group: readonly string[],
  incoming: EdgeType,
  worldEvil: WorldEvil | null,
): ForkBranch[] {
  const taken = takenMember(graph, group, worldEvil)
  return group.map((member) => {
    const node = graph.nodeById.get(member)
    return {
      member,
      type: member === taken ? incoming : 'alternative-route',
      taken: member === taken,
      active: node ? isNodeActive(node, worldEvil) : false,
    }
  })
}

/** Group containing a node, if any. */
export const groupOf = (graph: MapGraph, id: string) => graph.groups.find((g) => g.includes(id))

/**
 * The legend shows each edge type the way the map draws it. A type that draws a line somewhere (the
 * primary type of a link; alternative-route on every either/or fork) shows its own line. A type that
 * only ever rides on another type's link — drawn as nothing but its icon badge on that line, e.g.
 * "early challenge possible" on Hardmode → Duke Fishron's required gate — shows as that badge on its
 * HOST's line (the host it rides on most; ties by drawing precedence). Absent = its own line.
 */
export function edgeLegendForms(graph: MapGraph): Partial<Record<EdgeType, { host: EdgeType }>> {
  const drawn = new Set<EdgeType>(graph.links.map((l) => l.primary))
  if (graph.groups.length > 0) drawn.add('alternative-route')
  const forms: Partial<Record<EdgeType, { host: EdgeType }>> = {}
  for (const type of EDGE_PRECEDENCE) {
    if (drawn.has(type)) continue
    const hosts = graph.links.filter((l) => l.types.includes(type)).map((l) => l.primary)
    if (hosts.length === 0) continue
    const count = (t: EdgeType) => hosts.filter((h) => h === t).length
    const host = byPrecedence(hosts).sort((a, b) => count(b) - count(a))[0]
    forms[type] = { host }
  }
  return forms
}

/* ------------------------------------------------------------------------------------------ */
/* Connections, descriptions, traversal                                                        */

export interface Connection {
  link: MapLink
  other: MapNode
}

export interface NodeConnections {
  /** Links into this node (its prerequisites / what usually comes before). */
  before: Connection[]
  /** Links out of this node. */
  after: Connection[]
  /** Either/or partners. */
  alternatives: Connection[]
}

export function connectionsOf(graph: MapGraph, id: string): NodeConnections {
  const conn = (link: MapLink, otherId: string): Connection[] => {
    const other = graph.nodeById.get(otherId)
    return other ? [{ link, other }] : []
  }
  return {
    before: graph.links.filter((l) => l.to === id).flatMap((l) => conn(l, l.from)),
    after: graph.links.filter((l) => l.from === id).flatMap((l) => conn(l, l.to)),
    alternatives: graph.altLinks.filter((l) => l.from === id || l.to === id).flatMap((l) => conn(l, l.from === id ? l.to : l.from)),
  }
}

export const KIND_LABEL: Readonly<Record<NodeKind, string>> = { boss: 'Boss', event: 'Event', milestone: 'Milestone' }

export const WORLD_EVIL_LABEL: Readonly<Record<WorldEvil, string>> = { corruption: 'Corruption', crimson: 'Crimson' }

export const stageName = (stage: string) => (isStage(stage) ? getStageInfo(stage).label : stage)

const typeList = (types: readonly EdgeType[]) => types.map((t) => EDGE_STYLES[t].label.toLowerCase()).join(', ')

/** Screen-reader description of a node: kind, stage, world, and its typed connections. */
export function describeNode(graph: MapGraph, id: string, worldEvil: WorldEvil | null): string {
  const node = graph.nodeById.get(id)
  if (!node) return ''
  const parts = [`${KIND_LABEL[node.kind]}, ${stageName(node.stage)}`]
  if (node.worldEvil) {
    parts.push(
      isNodeActive(node, worldEvil)
        ? `${WORLD_EVIL_LABEL[node.worldEvil]} worlds`
        : `${WORLD_EVIL_LABEL[node.worldEvil]} worlds only, not in your world`,
    )
  }
  const { before, after, alternatives } = connectionsOf(graph, id)
  if (before.length) parts.push(`after ${before.map((c) => `${c.other.name} (${typeList(c.link.types)})`).join('; ')}`)
  if (alternatives.length) parts.push(`either this or ${alternatives.map((c) => c.other.name).join(' or ')}`)
  if (after.length) parts.push(`leads to ${after.map((c) => `${c.other.name} (${typeList(c.link.types)})`).join('; ')}`)
  return `${parts.join('. ')}.`
}

/** Where the map opens: the first node in reading order that isn't defeated or skipped. */
export function frontierId(readingOrder: readonly string[], nodeStates: Readonly<Record<string, NodeState>>): string | undefined {
  return readingOrder.find((id) => nodeStates[id] === undefined) ?? readingOrder[0]
}

export type MapMove = 'forward' | 'back' | 'next' | 'previous' | 'first' | 'last'

/**
 * Keyboard traversal (UX_SPEC §9): forward/back follow links (a fork counts as reaching every
 * member of the group), preferring nodes in play and the one nearest across; next/previous step
 * through the node's layer; first/last jump to the ends of the reading order.
 *
 * `cameFrom`: the node the previous step left, when this move goes straight back the way it came —
 * among the candidates it wins, so back from Skeletron returns to the fork member you came from (and
 * forward again from the Eye of Cthulhu to the member you came back from), not to the nearer one.
 */
export function traverse(
  graph: MapGraph,
  layout: GraphLayout,
  fromId: string,
  move: MapMove,
  worldEvil: WorldEvil | null,
  cameFrom?: string,
): string | undefined {
  const reading = layout.layers.flat()
  if (move === 'first') return reading[0]
  if (move === 'last') return reading[reading.length - 1]
  const here = layout.nodes.get(fromId)
  if (!here) return undefined
  if (move === 'next' || move === 'previous') {
    const row = layout.layers[here.layer]
    const i = row.indexOf(fromId)
    return row[move === 'next' ? i + 1 : i - 1]
  }
  const expand = (ids: string[]) => ids.flatMap((id) => (groupOf(graph, id)?.[0] === id ? groupOf(graph, id)! : [id]))
  const candidates =
    move === 'forward'
      ? expand(graph.links.filter((l) => l.from === fromId).map((l) => l.to))
      : // Back from a non-root group member: the root's sources (the fork) are its predecessors.
        graph.links
          .filter((l) => l.to === fromId || (groupOf(graph, fromId)?.includes(l.to) && groupOf(graph, fromId)?.[0] === l.to))
          .map((l) => l.from)
  const cross = (id: string) => {
    const b = layout.nodes.get(id)!
    return layout.orientation === 'vertical' ? b.x + b.width / 2 : b.y + b.height / 2
  }
  // The strongest connection's type (a fork member is reached through its group's root).
  const strength = (id: string) => {
    const root = groupOf(graph, id)?.[0] ?? id
    const links = graph.links.filter((l) =>
      move === 'forward' ? l.from === fromId && (l.to === id || l.to === root) : (l.to === fromId || l.to === groupOf(graph, fromId)?.[0]) && l.from === id,
    )
    return Math.min(...links.map((l) => EDGE_PRECEDENCE.indexOf(l.primary)), EDGE_PRECEDENCE.length)
  }
  // Where you came from first; then the nearest step: the closest layer, the strongest connection,
  // the node in play, the nearest across.
  const ranked = [...new Set(candidates)]
    .filter((id) => layout.nodes.has(id) && id !== fromId)
    .map((id) => {
      const node = graph.nodeById.get(id)!
      const box = layout.nodes.get(id)!
      const group = groupOf(graph, id)
      const taken = group ? takenMember(graph, group, worldEvil) : undefined
      return {
        id,
        came: id === cameFrom ? 0 : 1,
        layers: Math.abs(box.layer - here.layer),
        strength: strength(id),
        // In play first, and of an either/or pair the member on the main path (none with no world evil chosen).
        inPlay: !isNodeActive(node, worldEvil) ? 2 : taken !== undefined && taken !== id ? 1 : 0,
        distance: Math.abs(cross(id) - cross(fromId)),
        order: box.order,
      }
    })
    .sort((a, b) => a.came - b.came || a.layers - b.layers || a.strength - b.strength || a.inPlay - b.inPlay || a.distance - b.distance || a.order - b.order)
  return ranked[0]?.id
}
