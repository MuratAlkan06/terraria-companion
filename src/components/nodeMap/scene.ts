/**
 * What the map draws, as plain data (PRD P5-S1 AC1–AC3): one path per link (in its primary type's
 * style, ending in its marker), icon badges per link, and the EITHER/OR FORK.
 *
 * Fork: links into an either/or group's root stop at a fork point in the gap above the group, where
 * the "or" chip sits; from it one branch runs to each member. With no world evil chosen ("Both") the
 * fork is symmetric: every branch is an alternative route and every member in play. Once a world evil
 * is chosen, the member it "takes" continues the incoming link's style, the others keep the
 * alternative-route style and are out of play (dimmed). A group nothing leads into is joined by a
 * plain alternative-route connector instead, its "or" chip between the members.
 */
import { byPrecedence, type EdgeType } from './edgeStyles'
import { forkBranches, isLinkActive, isNodeActive, type MapGraph, type WorldEvil } from './graph'
import { edgePathData, lastSegmentMidpoint, type Box, type GraphLayout, type Point } from './layout'

export interface ScenePath {
  key: string
  d: string
  type: EdgeType
  /** Both ends in play (false = the other world evil's branch). */
  inPlay: boolean
  /** Ends in its type's marker (fork trunks don't: their branches do). */
  marker: boolean
  role: 'link' | 'trunk' | 'branch' | 'connector'
  /** The link drawn (absent for fork branches / connectors). */
  linkId?: string
  /** For branches: the group member it leads to. */
  member?: string
}

export interface SceneBadge {
  key: string
  x: number
  y: number
  types: EdgeType[]
  inPlay: boolean
}

export interface SceneChip {
  key: string
  x: number
  y: number
  /** The either/or members it joins. */
  members: readonly string[]
}

/** How far a world-evil node's tag reaches above its box (map px: BossNode's `-top-2.5` tag, 18px tall). */
export const WORLD_TAG_REACH = 12
/** An "or" chip's box (map px, centred on its point). */
export const OR_CHIP = { width: 24, height: 20 }

/** What a node draws on the map: its box, and a world-evil node's tag above it (map px). */
export function nodeExtent(graph: MapGraph, node: Box & { id: string }): Box {
  const { x, y, width, height } = node
  return graph.nodeById.get(node.id)?.worldEvil ? { x, y: y - WORLD_TAG_REACH, width, height: height + WORLD_TAG_REACH } : { x, y, width, height }
}

/** What an "or" chip draws on the map (map px). */
export const chipExtent = (chip: Pick<SceneChip, 'x' | 'y'>): Box => ({ x: chip.x - OR_CHIP.width / 2, y: chip.y - OR_CHIP.height / 2, ...OR_CHIP })

export interface Scene {
  paths: ScenePath[]
  badges: SceneBadge[]
  /** "or" chips: on an either/or fork's branching point, or between the members of a group nothing leads into. */
  orChips: SceneChip[]
}

/** Fraction of the layer gap above a group where its fork point sits. */
const FORK_DEPTH = 0.45

export function buildScene(graph: MapGraph, layout: GraphLayout, worldEvil: WorldEvil | null): Scene {
  const vertical = layout.orientation === 'vertical'
  const toXY = (main: number, cross: number): Point => (vertical ? { x: cross, y: main } : { x: main, y: cross })
  const mainStart = (b: Box) => (vertical ? b.y : b.x)
  const mainMid = (b: Box) => (vertical ? b.y + b.height / 2 : b.x + b.width / 2)
  const crossStart = (b: Box) => (vertical ? b.x : b.y)
  const crossEnd = (b: Box) => (vertical ? b.x + b.width : b.y + b.height)
  const crossMid = (b: Box) => (crossStart(b) + crossEnd(b)) / 2

  const paths: ScenePath[] = []
  const badges: SceneBadge[] = []
  const orChips: SceneChip[] = []
  const forked = new Set<string>() // link ids drawn as fork trunks

  for (const group of graph.groups) {
    const boxes = group.map((id) => layout.nodes.get(id))
    if (boxes.some((b) => b === undefined)) continue
    const members = boxes as Box[]
    const root = group[0]
    const incoming = graph.links.filter((l) => l.to === root && !group.includes(l.from) && layout.edges.get(l.id)?.direction === 'forward')
    // A group nothing leads into: connectors (and "or" chips) between consecutive members.
    if (incoming.length === 0) {
      for (let i = 0; i + 1 < members.length; i++) {
        const a = members[i]
        const b = members[i + 1]
        orChips.push({
          key: `or:${group[i]}:${group[i + 1]}`,
          ...toXY((mainMid(a) + mainMid(b)) / 2, (crossEnd(a) + crossStart(b)) / 2),
          members: [group[i], group[i + 1]],
        })
        paths.push({
          key: `connector:${group[i]}:${group[i + 1]}`,
          d: edgePathData([toXY(mainMid(a), crossEnd(a)), toXY(mainMid(b), crossStart(b))], layout.orientation),
          type: 'alternative-route',
          inPlay: true,
          marker: false,
          role: 'connector',
        })
      }
      continue
    }

    const rootBox = members[0]
    const groupCross = (Math.min(...members.map(crossStart)) + Math.max(...members.map(crossEnd))) / 2
    const fork = toXY(mainStart(rootBox) - layout.layerGap * FORK_DEPTH, groupCross)
    // The choice happens here: the "or" chip sits on the branching point, every branch leaves from it.
    orChips.push({ key: `or:${group.join(':')}`, ...fork, members: group })
    for (const link of incoming) {
      const route = layout.edges.get(link.id)!
      const points = [...route.points.slice(0, -1), fork]
      forked.add(link.id)
      const source = graph.nodeById.get(link.from)
      const inPlay = source ? isNodeActive(source, worldEvil) : true
      paths.push({ key: `trunk:${link.id}`, d: edgePathData(points, layout.orientation), type: link.primary, inPlay, marker: false, role: 'trunk', linkId: link.id })
      const mid = lastSegmentMidpoint(points)
      badges.push({ key: `badge:${link.id}`, ...mid, types: link.types, inPlay })
    }
    const incomingType = byPrecedence(incoming.map((l) => l.primary))[0]
    for (const branch of forkBranches(graph, group, incomingType, worldEvil)) {
      const box = layout.nodes.get(branch.member)!
      paths.push({
        key: `branch:${root}:${branch.member}`,
        d: edgePathData([fork, toXY(mainStart(box), crossMid(box))], layout.orientation),
        type: branch.type,
        inPlay: branch.active,
        marker: true,
        role: 'branch',
        member: branch.member,
      })
    }
  }

  for (const link of graph.links) {
    if (forked.has(link.id)) continue
    const route = layout.edges.get(link.id)
    if (!route) continue
    const inPlay = isLinkActive(graph, link, worldEvil)
    paths.push({ key: `link:${link.id}`, d: edgePathData(route.points, layout.orientation), type: link.primary, inPlay, marker: true, role: 'link', linkId: link.id })
    badges.push({ key: `badge:${link.id}`, ...lastSegmentMidpoint(route.points), types: link.types, inPlay })
  }

  return { paths, badges, orChips }
}
