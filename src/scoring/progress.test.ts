/* EffectiveProgress + gate satisfaction (SCORING_SPEC §2.4/§7/§8; AMENDMENTS-006 B24; AMENDMENTS-014
 * B69/Q6, Q9) over the shipped progression graph, plus synthetic graphs for deep recursion. */
import { describe, expect, it } from 'vitest'
import type { ProgressionEdge, ProgressionNode } from '../data-access/types'
import progressionJson from '../data/progression.json'
import {
  effectiveProgress,
  isNodeSatisfied,
  requiredAncestors,
  requiredPredecessors,
  satisfiedNodes,
  trackedDefeats,
  unmetGates,
  virtualDefeats,
  type ProgressionGraphLike,
  type TrackedProgress,
} from './progress'

const graph = progressionJson as { nodes: ProgressionNode[]; edges: ProgressionEdge[] }
const tracked = (nodeStates: TrackedProgress['nodeStates'], worldEvil: TrackedProgress['worldEvil'] = null): TrackedProgress => ({ worldEvil, nodeStates })
const defeated = (...ids: string[]) => Object.fromEntries(ids.map((id) => [id, 'defeated' as const]))
const satisfied = (states: TrackedProgress['nodeStates'], id: string, worldEvil: TrackedProgress['worldEvil'] = null) =>
  isNodeSatisfied(graph, effectiveProgress(graph, tracked(states, worldEvil)), id)
const MECHS = ['the-twins', 'the-destroyer', 'skeletron-prime']

describe('isNodeSatisfied over the real graph (tracked defeats only)', () => {
  it('with nothing tracked: only gate-free milestones and events are satisfied — no boss, no gated marker', () => {
    const ep = effectiveProgress(graph, tracked({}))
    expect(ep.size).toBe(0)
    expect([...satisfiedNodes(graph, ep)].sort()).toEqual(['goblin-army', 'pre-hardmode'])
  })

  it('B24: Hardmode is reached once the Wall of Flesh is defeated; events behind it follow (recursion through the milestone)', () => {
    expect(satisfied({}, 'hardmode')).toBe(false)
    expect(satisfied(defeated('wall-of-flesh'), 'hardmode')).toBe(true)
    for (const event of ['pirate-invasion', 'solar-eclipse']) {
      expect(satisfied({}, event), event).toBe(false)
      expect(satisfied(defeated('wall-of-flesh'), event), event).toBe(true)
    }
    // a boss is satisfied only by its own tracked defeat
    expect(satisfied(defeated('wall-of-flesh'), 'queen-slime')).toBe(false)
  })

  it('the all-mechanical-bosses milestone needs all three mechs; Plantera (a boss) still needs its own defeat', () => {
    expect(satisfied(defeated('wall-of-flesh', 'the-twins', 'the-destroyer'), 'all-mechanical-bosses')).toBe(false)
    expect(satisfied(defeated('wall-of-flesh', ...MECHS), 'all-mechanical-bosses')).toBe(true)
    expect(satisfied(defeated('wall-of-flesh', ...MECHS), 'plantera')).toBe(false)
    expect(unmetGates(graph, effectiveProgress(graph, tracked(defeated('wall-of-flesh', 'the-twins'))), 'all-mechanical-bosses')).toEqual(['skeletron-prime', 'the-destroyer'])
    expect(unmetGates(graph, effectiveProgress(graph, tracked(defeated('wall-of-flesh', ...MECHS))), 'plantera')).toEqual([])
    // the pillars (an event gate) follow the Lunatic Cultist
    expect(satisfied(defeated('lunatic-cultist'), 'celestial-pillars')).toBe(true)
  })

  it('skipped never counts as defeated; unknown ids are never satisfied', () => {
    expect(satisfied({ 'wall-of-flesh': 'skipped' }, 'hardmode')).toBe(false)
    expect(trackedDefeats(graph, tracked({ 'king-slime': 'skipped', 'queen-bee': 'defeated' }))).toEqual(new Set(['queen-bee']))
    expect(satisfied(defeated('not-a-node'), 'not-a-node')).toBe(false)
    expect(trackedDefeats(graph, tracked(defeated('not-a-node'))).size).toBe(0)
  })

  it('B69/Q6: the Eater of Worlds / Brain of Cthulhu count only for the matching chosen world evil (none when unchosen)', () => {
    expect(satisfied(defeated('eater-of-worlds'), 'eater-of-worlds', null)).toBe(false)
    expect(satisfied(defeated('eater-of-worlds'), 'eater-of-worlds', 'corruption')).toBe(true)
    expect(satisfied(defeated('eater-of-worlds'), 'eater-of-worlds', 'crimson')).toBe(false)
    expect(satisfied(defeated('brain-of-cthulhu'), 'brain-of-cthulhu', 'crimson')).toBe(true)
  })

  it('memoized: one shared memo evaluates every node at most once, and a cached answer is reused', () => {
    const ep = effectiveProgress(graph, tracked(defeated('wall-of-flesh', ...MECHS, 'lunatic-cultist')))
    const lookups = new Map<string, number>()
    const counting: ReadonlySet<string> = { ...ep, has: (id: string) => (lookups.set(id, (lookups.get(id) ?? 0) + 1), ep.has(id)), size: ep.size } as ReadonlySet<string>
    const memo = new Map<string, boolean>()
    for (const node of graph.nodes) isNodeSatisfied(graph, counting, node.id, memo)
    expect(memo.size).toBe(graph.nodes.length)
    expect([...lookups.values()].every((n) => n === 1)).toBe(true)
    // the milestone's answer was computed on the way to Plantera's gate and cached
    const fresh = new Map<string, boolean>()
    isNodeSatisfied(graph, ep, 'pirate-invasion', fresh)
    expect([...fresh.keys()].sort()).toEqual(['hardmode', 'pirate-invasion', 'wall-of-flesh'])
    // a cached answer short-circuits (here a deliberately seeded one)
    expect(isNodeSatisfied(graph, new Set(), 'solar-eclipse', new Map([['hardmode', true]]))).toBe(true)
  })
})

describe('synthetic graphs: deep milestone recursion, cycle safety', () => {
  const node = (id: string, kind: ProgressionNode['kind'], stage = 'early-hm') => ({ id, kind, stage })
  const gate = (from: string, to: string) => ({ from, to, type: 'required-gate' })
  const chain: ProgressionGraphLike = {
    nodes: [node('boss-a', 'boss'), node('boss-b', 'boss'), node('m1', 'milestone'), node('m2', 'milestone'), node('ev', 'event'), node('boss-c', 'boss')],
    edges: [gate('boss-a', 'm1'), gate('boss-b', 'm1'), gate('m1', 'm2'), gate('m2', 'ev'), gate('ev', 'boss-c'), { from: 'boss-a', to: 'boss-c', type: 'recommended-next' }],
  }

  it('a milestone → milestone → event chain is satisfied only when every boss at its root is', () => {
    expect(isNodeSatisfied(chain, new Set(['boss-a']), 'ev')).toBe(false)
    const memo = new Map<string, boolean>()
    expect(isNodeSatisfied(chain, new Set(['boss-a', 'boss-b']), 'ev', memo)).toBe(true)
    expect([...memo.entries()].filter(([, v]) => v).map(([k]) => k).sort()).toEqual(['boss-a', 'boss-b', 'ev', 'm1', 'm2'])
    // gates read the required-gate DAG only (the recommended-next edge is not a gate)
    expect(requiredPredecessors(chain, 'boss-c')).toEqual(['ev'])
    expect([...requiredAncestors(chain, 'boss-c')].sort()).toEqual(['boss-a', 'boss-b', 'ev', 'm1', 'm2'])
  })

  it('a malformed cycle terminates and is never satisfied', () => {
    const cyclic: ProgressionGraphLike = { nodes: [node('x', 'milestone'), node('y', 'milestone')], edges: [gate('x', 'y'), gate('y', 'x')] }
    expect(isNodeSatisfied(cyclic, new Set(), 'x')).toBe(false)
    expect([...requiredAncestors(cyclic, 'x')].sort()).toEqual(['y'])
  })
})

describe('VirtualDefeats + scope split (SCORING_SPEC §2.4, B69/Q9)', () => {
  it('a stage implies its required-gate ancestors from earlier stages — never optional bosses, never a world-evil node', () => {
    expect(virtualDefeats(graph, 'early-prehm', null).size).toBe(0)
    expect([...virtualDefeats(graph, 'early-hm', null)].sort()).toEqual(['skeletron', 'wall-of-flesh'])
    expect([...virtualDefeats(graph, 'mid-hm', 'corruption')].sort()).toEqual(['hardmode', 'skeletron', 'skeletron-prime', 'the-destroyer', 'the-twins', 'wall-of-flesh'])
  })

  it('property: every virtual defeat is an earlier-stage required-gate ancestor of a node at or past the stage', () => {
    const order = ['early-prehm', 'late-prehm', 'early-hm', 'mid-hm', 'endgame']
    const optionalBosses = graph.nodes.filter((n) => n.kind === 'boss' && graph.edges.some((e) => e.to === n.id && e.type === 'optional') && !graph.edges.some((e) => e.from === n.id && e.type === 'required-gate'))
    expect(optionalBosses.map((n) => n.id).sort()).toEqual(['deerclops', 'duke-fishron', 'empress-of-light', 'king-slime', 'queen-bee', 'queen-slime'])
    for (const stage of order) {
      for (const evil of [null, 'corruption', 'crimson'] as const) {
        const virtual = virtualDefeats(graph, stage, evil)
        for (const id of virtual) {
          const n = graph.nodes.find((x) => x.id === id)!
          expect(order.indexOf(n.stage), `${stage} ${id}`).toBeLessThan(order.indexOf(stage))
          expect(graph.nodes.some((d) => order.indexOf(d.stage) >= order.indexOf(stage) && requiredAncestors(graph, d.id).has(id)), `${stage} ${id}`).toBe(true)
          expect(n.worldEvil, id).toBeUndefined()
        }
        for (const o of optionalBosses) expect(virtual.has(o.id), `${stage} ${o.id}`).toBe(false)
      }
    }
  })

  it('tracked-only without a stage; tracked ∪ virtual with one (Plantera is open at mid-hm with nothing tracked)', () => {
    const none = tracked({})
    expect(effectiveProgress(graph, none).size).toBe(0)
    const builder = effectiveProgress(graph, none, 'mid-hm')
    expect(isNodeSatisfied(graph, builder, 'all-mechanical-bosses')).toBe(true)
    expect(isNodeSatisfied(graph, builder, 'plantera')).toBe(false)
    const both = effectiveProgress(graph, tracked(defeated('queen-slime')), 'early-hm')
    expect([...both].sort()).toEqual(['queen-slime', 'skeletron', 'wall-of-flesh'])
  })
})

describe('src/scoring boundary (SCORING_SPEC §8.3)', () => {
  const sources = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>

  it('imports nothing from src/sim, src/lab, React or the DOM', () => {
    expect(Object.keys(sources)).toContain('./progress.ts')
    for (const [file, source] of Object.entries(sources)) {
      const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1])
      expect(imports.filter((i) => /^(react|react-dom)(\/|$)|\/(sim|lab)(\/|$)/.test(i)), file).toEqual([])
      expect(source, file).not.toMatch(/\b(window|document|localStorage)\./)
    }
  })
})
