/**
 * Progression graph integrity (DATA_SCHEMA_SPEC §7a-8): edges resolve, no self-loops, unique
 * (from,to,type) triples, the required-gate subgraph is a DAG, and world-evil nodes
 * (EoW/BoC) carry worldEvil and are joined by an alternative-route edge.
 */
import type { ProgressionEdge, ProgressionNode } from '../../src/schemas'
import type { Dataset } from './dataset'
import { danglingRef, duplicateId, type PipelineError } from './errors'

const edgeRef = (e: ProgressionEdge) => `edge:${e.from}->${e.to}(${e.type})`

/** Adjacency of the required-gate subgraph (only edges whose endpoints are both known nodes). */
function requiredGateAdjacency(nodes: readonly ProgressionNode[], edges: readonly ProgressionEdge[]): Map<string, string[]> {
  const ids = new Set(nodes.map((n) => n.id))
  const adj = new Map<string, string[]>()
  for (const e of edges) {
    if (e.type !== 'required-gate' || e.from === e.to || !ids.has(e.from) || !ids.has(e.to)) continue
    adj.set(e.from, [...(adj.get(e.from) ?? []), e.to])
  }
  return adj
}

/** For every node: the set of nodes strictly upstream of it via required-gate paths. */
export function requiredGateUpstream(nodes: readonly ProgressionNode[], edges: readonly ProgressionEdge[]): Map<string, Set<string>> {
  const adj = requiredGateAdjacency(nodes, edges)
  const upstream = new Map<string, Set<string>>(nodes.map((n) => [n.id, new Set<string>()]))
  for (const start of nodes) {
    const seen = new Set<string>()
    const stack = [...(adj.get(start.id) ?? [])]
    while (stack.length > 0) {
      const next = stack.pop() as string
      if (seen.has(next)) continue
      seen.add(next)
      if (next !== start.id) upstream.get(next)?.add(start.id)
      stack.push(...(adj.get(next) ?? []))
    }
  }
  return upstream
}

/** Every distinct cycle in the required-gate subgraph, each as a closed node path. */
function findCycles(nodes: readonly ProgressionNode[], edges: readonly ProgressionEdge[]): string[][] {
  const adj = requiredGateAdjacency(nodes, edges)
  const state = new Map<string, 'active' | 'done'>()
  const stack: string[] = []
  const cycles = new Map<string, string[]>()
  const visit = (id: string): void => {
    state.set(id, 'active')
    stack.push(id)
    for (const next of adj.get(id) ?? []) {
      const s = state.get(next)
      if (s === 'active') {
        const cycle = stack.slice(stack.indexOf(next))
        const key = [...cycle].sort().join('|')
        if (!cycles.has(key)) cycles.set(key, [...cycle, next])
      } else if (s === undefined) {
        visit(next)
      }
    }
    stack.pop()
    state.set(id, 'done')
  }
  for (const n of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) if (!state.has(n.id)) visit(n.id)
  return [...cycles.values()]
}

export function checkGraph(ds: Pick<Dataset, 'nodes' | 'edges'>): PipelineError[] {
  const errors: PipelineError[] = []
  const nodeById = new Map(ds.nodes.map((n) => [n.id, n]))
  const triples = new Set<string>()

  for (const e of ds.edges) {
    const ref = edgeRef(e)
    if (!nodeById.has(e.from)) errors.push(danglingRef(ref, 'from', `node:${e.from}`, 'node not found'))
    if (!nodeById.has(e.to)) errors.push(danglingRef(ref, 'to', `node:${e.to}`, 'node not found'))
    if (e.from === e.to) {
      errors.push({ code: 'E_GRAPH_CYCLE', path: [e.from, e.to], message: `${ref}: self-loop (from === to)` })
    }
    const triple = `${e.from}|${e.to}|${e.type}`
    if (triples.has(triple)) errors.push(duplicateId('progression.edges', ref, 'duplicate (from, to, type) edge'))
    triples.add(triple)
  }

  for (const cycle of findCycles(ds.nodes, ds.edges)) {
    errors.push({
      code: 'E_GRAPH_CYCLE',
      path: cycle,
      message: `required-gate subgraph has a cycle: ${cycle.join(' -> ')}`,
    })
  }

  // EoW/BoC rule: every world-evil node is joined to an opposite-evil node by an alternative-route edge.
  for (const node of ds.nodes) {
    if (node.worldEvil === undefined) continue
    const opposite = node.worldEvil === 'corruption' ? 'crimson' : 'corruption'
    const joined = ds.edges.some((e) => {
      if (e.type !== 'alternative-route') return false
      const other = e.from === node.id ? e.to : e.to === node.id ? e.from : undefined
      return other !== undefined && nodeById.get(other)?.worldEvil === opposite
    })
    if (!joined) {
      errors.push(
        danglingRef(`node:${node.id}`, 'alternative-route', `node:<${opposite} counterpart>`, `world-evil node has no alternative-route edge to a ${opposite} node`),
      )
    }
  }
  return errors
}
