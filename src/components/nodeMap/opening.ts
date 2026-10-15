/**
 * Where the map opens (UX_SPEC §3.7; design review P5-S1: on laptop-height screens the opening view
 * centred on the start hid the Eater of Worlds / Brain of Cthulhu fork). Pure.
 *
 * The OPENING REGION: from the start node's layer through the first either/or fork at or after it in
 * the start's band — every node in those layers (a world-evil node with its tag) and the fork's "or"
 * chip. With no fork ahead in the start's band, the start node alone. The map frames it
 * (panZoom.frameRect): fitted, never above the opening zoom, centred, bounded.
 */
import type { MapGraph } from './graph'
import type { Box, GraphLayout } from './layout'
import { OPENING_FRAME } from './mapConfig'
import { unionRect } from './panZoom'
import { chipExtent, nodeExtent, type Scene } from './scene'

export function openingRegion(graph: MapGraph, layout: GraphLayout, scene: Scene, startId: string): Box | undefined {
  const start = layout.nodes.get(startId)
  if (!start) return undefined
  const forkLayers = graph.groups
    .flatMap((group) => group.flatMap((id) => layout.nodes.get(id) ?? []))
    .filter((member) => member.band === start.band && member.layer >= start.layer)
    .map((member) => member.layer)
  if (forkLayers.length === 0) return nodeExtent(graph, start)
  const through = Math.min(...forkLayers)
  const nodes = [...layout.nodes.values()].filter((n) => n.layer >= start.layer && n.layer <= through)
  const inRegion = new Set(nodes.map((n) => n.id))
  const chips = scene.orChips.filter((chip) => chip.members.every((id) => inRegion.has(id)))
  return unionRect([...nodes.map((n) => nodeExtent(graph, n)), ...chips.map(chipExtent)])
}

/** The rect the map opens framed on, per OPENING_FRAME: the opening region, or the start node alone. */
export function openingRect(graph: MapGraph, layout: GraphLayout, scene: Scene, startId: string | undefined): Box | undefined {
  if (!startId) return undefined
  return OPENING_FRAME[layout.orientation] === 'region' ? openingRegion(graph, layout, scene, startId) : layout.nodes.get(startId)
}

/**
 * The PROGRESS FRONTIER's rect (AMENDMENTS-015 B86d; UX_SPEC §4d "map pans to frontier"): the nodes
 * the player is up to — the recommender's next steps — with their world tags. The map opens framed on
 * it instead of the opening view once anything is tracked. Undefined when none of the ids is laid out.
 */
export function frontierRect(graph: MapGraph, layout: GraphLayout, ids: readonly string[] | undefined): Box | undefined {
  if (!ids) return undefined
  return unionRect(ids.flatMap((id) => {
    const box = layout.nodes.get(id)
    return box ? [nodeExtent(graph, box)] : []
  }))
}
