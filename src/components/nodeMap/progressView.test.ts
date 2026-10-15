/* Map statuses from tracked progress and the unlock-cascade schedule (PRD P5-S4 AC1/AC2; UX_SPEC
 * §3.7, §9, §12). The schedule is tested as data — the animation itself is CSS driven by it. */
import { describe, expect, it } from 'vitest'
import type { Boss, ProgressionEdge, ProgressionNode } from '../../data-access/types'
import bossesJson from '../../data/bosses.json'
import progressionJson from '../../data/progression.json'
import { countsInWorld, effectiveProgress, isNodeSatisfied } from '../../scoring/progress'
import { crossPositions } from './cascadeCamera'
import { buildMapGraph, isNodeActive, layoutInputs, type NodeState, type WorldEvil } from './graph'
import { layoutGraph } from './layout'
import { MAP_LAYOUT_OPTIONS } from './mapConfig'
import {
  bossesToMark,
  describeStatus,
  flowIncoming,
  flowOrder,
  mapProgress,
  newlyOpened,
  UNLOCK_DURATION_MS,
  UNLOCK_MAX_TOTAL_MS,
  UNLOCK_RIPPLE_MS,
  UNLOCK_STAGGER_MS,
  unlockSchedule,
  withLead,
  type UnlockSchedule,
} from './progressView'

const raw = progressionJson as { nodes: ProgressionNode[]; edges: ProgressionEdge[] }
const graph = buildMapGraph(raw, bossesJson as Boss[])
const defeated = (...ids: string[]): Record<string, NodeState> => Object.fromEntries(ids.map((id) => [id, 'defeated' as const]))
const statuses = (states: Record<string, NodeState>, worldEvil: WorldEvil | null = null) => mapProgress(graph, states, worldEvil).nodes
const MECHS = ['the-twins', 'the-destroyer', 'skeletron-prime']
const HARDMODE_OPENS = ['queen-slime', 'skeletron-prime', 'the-destroyer', 'the-twins', 'duke-fishron', 'pirate-invasion', 'solar-eclipse']

describe('node statuses from tracked progress', () => {
  it('fresh world: the start is reached, the Eye of Cthulhu recommended, every Hardmode node locked', () => {
    const s = statuses({})
    expect(s.get('pre-hardmode')).toBe('reached')
    expect(s.get('eye-of-cthulhu')).toBe('recommended')
    for (const id of ['king-slime', 'queen-bee', 'deerclops', 'skeletron', 'wall-of-flesh', 'goblin-army', 'eater-of-worlds', 'brain-of-cthulhu']) expect(s.get(id), id).toBe('available')
    for (const node of raw.nodes.filter((n) => ['early-hm', 'mid-hm', 'endgame'].includes(n.stage))) expect(s.get(node.id), node.id).toBe('locked')
    expect(describeStatus(graph, mapProgress(graph, {}, null), 'hardmode')).toBe('Locked: needs Wall of Flesh.')
  })

  it('the Wall of Flesh defeated: Hardmode reached, everything it gates recommended; Plantera still locked behind the mechs', () => {
    const p = mapProgress(graph, defeated('wall-of-flesh'), null)
    expect(p.nodes.get('wall-of-flesh')).toBe('defeated')
    expect(p.nodes.get('hardmode')).toBe('reached')
    for (const id of HARDMODE_OPENS) expect(p.nodes.get(id), id).toBe('recommended')
    expect(p.nodes.get('plantera')).toBe('locked')
    expect(p.unmet.get('plantera')).toEqual(['all-mechanical-bosses'])
    expect(p.nodes.get('all-mechanical-bosses')).toBe('locked')
    expect(describeStatus(graph, p, 'all-mechanical-bosses')).toBe('Locked: needs Skeletron Prime, The Destroyer, The Twins.')
    // a milestone gate is expanded into the bosses to mark
    expect(describeStatus(graph, p, 'plantera')).toBe('Locked: needs Skeletron Prime, The Destroyer, The Twins.')
    expect(bossesToMark(graph, mapProgress(graph, {}, null), 'queen-slime')).toEqual(['wall-of-flesh'])
    expect(bossesToMark(graph, mapProgress(graph, defeated('wall-of-flesh', 'the-twins'), null), 'plantera')).toEqual(['skeletron-prime', 'the-destroyer'])
    expect(bossesToMark(graph, mapProgress(graph, {}, null), 'moon-lord')).toEqual(['lunatic-cultist'])
  })

  it('…and the three mechs: the milestone is reached and Plantera opens', () => {
    const s = statuses(defeated('wall-of-flesh', ...MECHS))
    expect(s.get('all-mechanical-bosses')).toBe('reached')
    expect(s.get('plantera')).toBe('recommended')
    expect(s.get('golem')).toBe('locked')
    // two of three is not enough
    expect(statuses(defeated('wall-of-flesh', 'the-twins', 'the-destroyer')).get('plantera')).toBe('locked')
  })

  it('skipped shows as skipped and opens nothing; recommendations follow done nodes along non-optional links', () => {
    const s = statuses({ 'king-slime': 'skipped', 'eye-of-cthulhu': 'defeated' })
    expect(s.get('king-slime')).toBe('skipped')
    expect(s.get('eater-of-worlds')).toBe('recommended')
    expect(s.get('brain-of-cthulhu')).toBe('recommended') // the fork: both members while no world evil is chosen
    expect(statuses({ 'eye-of-cthulhu': 'defeated' }, 'crimson').get('eater-of-worlds')).toBe('available') // the other world's member is never recommended
    // a world-evil boss marked defeated is done on the map (Skeletron recommended) even with no world evil chosen
    expect(statuses({ 'eater-of-worlds': 'defeated' }).get('skeletron')).toBe('recommended')
  })

  it('B128: under a chosen world evil, the other world’s evil boss marked opens and recommends nothing; the in-play fork does', () => {
    // Crimson world, only the Eater of Worlds marked: its mark doesn't count (countsInWorld), so Skeletron isn't "next" through it
    const eow = mapProgress(graph, defeated('eater-of-worlds'), 'crimson')
    expect(eow.nodes.get('eater-of-worlds')).toBe('defeated') // the mark itself still shows, as marked
    expect(eow.nodes.get('skeletron')).toBe('available')
    expect(describeStatus(graph, eow, 'skeletron')).toBe('Available.')
    // mark the Brain of Cthulhu (the Crimson fork): Skeletron is recommended
    const boc = mapProgress(graph, defeated('eater-of-worlds', 'brain-of-cthulhu'), 'crimson')
    expect(boc.nodes.get('skeletron')).toBe('recommended')
    expect(describeStatus(graph, boc, 'skeletron')).toBe('Recommended next.')
    // the mirror world
    expect(statuses(defeated('brain-of-cthulhu'), 'corruption').get('skeletron')).toBe('available')
    expect(statuses(defeated('eater-of-worlds'), 'corruption').get('skeletron')).toBe('recommended')
    // "Both": either mark counts (B96a)
    for (const member of ['eater-of-worlds', 'brain-of-cthulhu']) expect(statuses(defeated(member)).get('skeletron'), member).toBe('recommended')
  })

  it('B128 sweep: a mark countsInWorld leaves out changes nothing but its own node — statuses, gates, links, branches', () => {
    const progression = graph.progression
    const order = flowOrder(graph).filter((id) => graph.nodeById.get(id)?.kind === 'boss' && !graph.nodeById.get(id)?.worldEvil)
    const evil = raw.nodes.filter((n) => n.worldEvil).map((n) => n.id)
    const evilMarks = [[], ...evil.map((id) => [id]), evil]
    let uncounted = 0
    for (let k = 0; k <= order.length; k++) {
      for (const marks of evilMarks) {
        const states = defeated(...order.slice(0, k), ...marks)
        for (const world of [null, 'corruption', 'crimson'] as const) {
          const ignored = marks.filter((id) => !countsInWorld(progression.nodes.find((n) => n.id === id)!, world))
          const counted = Object.fromEntries(Object.entries(states).filter(([id]) => !ignored.includes(id)))
          const p = mapProgress(graph, states, world)
          const q = mapProgress(graph, counted, world)
          const at = `${world ?? 'Both'} · ${Object.keys(states).join(',')}`
          for (const node of graph.nodes) if (!ignored.includes(node.id)) expect(p.nodes.get(node.id), `${node.id} @ ${at}`).toBe(q.nodes.get(node.id))
          for (const node of graph.nodes) if (!ignored.includes(node.id)) expect(p.branches.get(node.id), `branch ${node.id} @ ${at}`).toBe(q.branches.get(node.id))
          expect([...p.links], at).toEqual([...q.links])
          expect([...p.unmet], at).toEqual([...q.unmet])
          expect([...p.openGates], at).toEqual([...q.openGates])
          // every node "recommended next" is the next step from a node whose defeat counts in this world
          const ep = effectiveProgress(progression, { worldEvil: world, nodeStates: states })
          for (const [id, status] of p.nodes) {
            if (status !== 'recommended') continue
            const from = flowIncoming(graph, id).filter((l) => l.types.some((t) => t === 'required-gate' || t === 'recommended-next')).map((l) => l.from)
            expect(from.some((f) => isNodeSatisfied(progression, ep, f)), `${id} @ ${at}`).toBe(true)
          }
          uncounted += ignored.length
        }
      }
    }
    expect(uncounted).toBeGreaterThan(0) // the sweep did exercise out-of-play marks
  })

  it('links: locked into locked nodes, lit along recommended-next from done nodes, else idle', () => {
    const fresh = mapProgress(graph, {}, null)
    expect(fresh.links.get('hardmode->the-twins')).toBe('locked')
    expect(fresh.links.get('pre-hardmode->eye-of-cthulhu')).toBe('lit')
    expect(fresh.links.get('skeletron->wall-of-flesh')).toBe('idle')
    const wof = mapProgress(graph, defeated('wall-of-flesh', 'skeletron'), null)
    expect(wof.links.get('hardmode->the-twins')).toBe('idle')
    expect(wof.links.get('skeletron->wall-of-flesh')).toBe('idle') // its target is done: no longer "next"
    expect(mapProgress(graph, defeated('skeletron'), null).links.get('skeletron->wall-of-flesh')).toBe('lit')
    // fork branches: lit for the members in play once the Eye of Cthulhu is done
    const fork = mapProgress(graph, defeated('eye-of-cthulhu'), 'crimson')
    expect([fork.branches.get('eater-of-worlds'), fork.branches.get('brain-of-cthulhu')]).toEqual(['idle', 'lit'])
  })

  it('B98: a marked boss of the other world evil (drawn dimmed) leaves no glow; the chosen world’s still does', () => {
    // Crimson world, the Eater of Worlds marked: its line on to Skeletron stays idle (it was lit before B98)
    const eow = mapProgress(graph, defeated('eye-of-cthulhu', 'eater-of-worlds'), 'crimson')
    expect(eow.links.get('eater-of-worlds->skeletron')).toBe('idle')
    // the trunk into the fork (from the Eye, in play) still glows toward the Brain's open branch
    expect(eow.links.get('eye-of-cthulhu->eater-of-worlds')).toBe('lit')
    expect(eow.branches.get('brain-of-cthulhu')).toBe('lit')
    // both marked: only the Brain's line glows
    const both = mapProgress(graph, defeated('eye-of-cthulhu', 'eater-of-worlds', 'brain-of-cthulhu'), 'crimson')
    expect([both.links.get('brain-of-cthulhu->skeletron'), both.links.get('eater-of-worlds->skeletron')]).toEqual(['lit', 'idle'])
    // no world evil chosen ("Both"): both forks are in play and both lines glow, as before
    const open = mapProgress(graph, defeated('eye-of-cthulhu', 'eater-of-worlds', 'brain-of-cthulhu'), null)
    expect([open.links.get('brain-of-cthulhu->skeletron'), open.links.get('eater-of-worlds->skeletron')]).toEqual(['lit', 'lit'])
    // nothing lit is drawn dimmed, in either world
    for (const evil of ['crimson', 'corruption'] as const) {
      const p = mapProgress(graph, defeated('eye-of-cthulhu', 'eater-of-worlds', 'brain-of-cthulhu'), evil)
      for (const link of graph.links) if (p.links.get(link.id) === 'lit') expect(isNodeActive(graph.nodeById.get(link.from)!, evil), link.id).toBe(true)
    }
  })

  it('M3 open gates: a required-gate line’s gate is met once its source is satisfied — even while its target waits on another gate', () => {
    expect(mapProgress(graph, {}, null).openGates.size).toBe(0)
    const wof = mapProgress(graph, defeated('wall-of-flesh'), null)
    expect([...wof.openGates].sort()).toEqual(['wall-of-flesh->hardmode', ...HARDMODE_OPENS.map((id) => `hardmode->${id}`)].sort())
    // two mechs: their gates into the milestone are met, the third still closed
    const two = mapProgress(graph, defeated('wall-of-flesh', 'the-twins', 'the-destroyer'), null)
    expect(['the-twins', 'the-destroyer', 'skeletron-prime'].map((m) => two.openGates.has(`${m}->all-mechanical-bosses`))).toEqual([true, true, false])
    // Skeletron meets its gate to the Lunatic Cultist, who stays locked behind Golem
    const skeletron = mapProgress(graph, defeated('skeletron'), null)
    expect(skeletron.openGates.has('skeletron->lunatic-cultist')).toBe(true)
    expect(skeletron.nodes.get('lunatic-cultist')).toBe('locked')
    expect(skeletron.openGates.has('golem->lunatic-cultist')).toBe(false)
    // only required gates: a recommended-next line never counts
    expect([...mapProgress(graph, defeated('eye-of-cthulhu', 'skeletron'), null).openGates].every((id) => graph.links.find((l) => l.id === id)?.types.includes('required-gate'))).toBe(true)
  })
})

/**
 * Every scheduled element comes after the elements upstream of it (graph-topological), in steps AND
 * in time — each starting at least one stagger after its cause, never before its step's time.
 * `exact`: no ripple, so every delay is exactly step × stagger.
 */
function expectTopological(schedule: UnlockSchedule, exact = true) {
  for (const link of graph.links) {
    const l = schedule.links.get(link.id)
    if (!l) continue
    const source = schedule.nodes.get(link.from)
    if (source) {
      expect(l.step, link.id).toBeGreaterThan(source.step)
      expect(l.delayMs, link.id).toBeGreaterThanOrEqual(source.delayMs + UNLOCK_STAGGER_MS)
    }
    const t = schedule.nodes.get(link.to)
    if (t) {
      expect(t.step, `${link.id} → node`).toBeGreaterThan(l.step)
      expect(t.delayMs, `${link.id} → node`).toBeGreaterThanOrEqual(l.delayMs + UNLOCK_STAGGER_MS)
    }
  }
  for (const n of [...schedule.nodes.values(), ...schedule.links.values(), ...schedule.branches.values()]) {
    if (exact) expect(n.delayMs).toBe(n.step * UNLOCK_STAGGER_MS)
    else expect(n.delayMs).toBeGreaterThanOrEqual(n.step * UNLOCK_STAGGER_MS)
  }
}

const schedule = (before: Record<string, NodeState>, after: Record<string, NodeState>, reducedMotion = false, worldEvil: WorldEvil | null = null, position?: ReadonlyMap<string, number>) =>
  unlockSchedule(graph, mapProgress(graph, before, worldEvil), mapProgress(graph, after, worldEvil), { reducedMotion, position })
const steps = (map: ReadonlyMap<string, { step: number }>) => Object.fromEntries([...map].map(([id, v]) => [id, v.step]))
const delays = (map: ReadonlyMap<string, { delayMs: number }>) => Object.fromEntries([...map].map(([id, v]) => [id, v.delayMs]))
/** The phone (vertical) map's ripple order: each node's centre along its row. */
const verticalLayout = (() => {
  const input = layoutInputs(graph)
  return layoutGraph(input.nodes, input.edges, input.groups, MAP_LAYOUT_OPTIONS.vertical)
})()
const position = crossPositions(verticalLayout)
const byPosition = (ids: readonly string[]) => [...ids].sort((a, b) => position.get(a)! - position.get(b)!)

describe('unlock cascade schedule (UX_SPEC §12)', () => {
  it('marking the Wall of Flesh: ring (0) → its link (1) → Hardmode (2) → Hardmode’s links (3) → what they open (4), 50ms apart', () => {
    const s = schedule({}, defeated('wall-of-flesh'))
    expect(steps(s.nodes)).toEqual({ 'wall-of-flesh': 0, hardmode: 2, ...Object.fromEntries(HARDMODE_OPENS.map((id) => [id, 4])) })
    expect(s.nodes.get('wall-of-flesh')).toMatchObject({ ring: true, unlock: false, delayMs: 0 })
    expect(s.nodes.get('hardmode')).toMatchObject({ unlock: true, delayMs: 100 })
    expect(s.nodes.get('the-twins')).toMatchObject({ unlock: true, delayMs: 200 })
    expect(steps(s.links)).toEqual({ 'wall-of-flesh->hardmode': 1, ...Object.fromEntries(HARDMODE_OPENS.map((id) => [`hardmode->${id}`, 3])) })
    expect(s.links.get('hardmode->the-twins')).toMatchObject({ unlock: true, lit: false, delayMs: 150 })
    expect(s.nodes.has('plantera')).toBe(false) // still locked: not part of the cascade
    expect(s.durationMs).toBe(4 * UNLOCK_STAGGER_MS + UNLOCK_DURATION_MS)
    expectTopological(s)
  })

  it('marking the third mech: its ring, the milestone, then Plantera — the mechs already open fill without unlocking', () => {
    const s = schedule(defeated('wall-of-flesh', 'the-twins', 'the-destroyer'), defeated('wall-of-flesh', ...MECHS))
    expect(steps(s.nodes)).toEqual({ 'skeletron-prime': 0, 'all-mechanical-bosses': 2, plantera: 4 })
    // the other mechs' links into the milestone come in with the causal one
    expect(steps(s.links)).toEqual({ 'skeletron-prime->all-mechanical-bosses': 1, 'the-destroyer->all-mechanical-bosses': 1, 'the-twins->all-mechanical-bosses': 1, 'all-mechanical-bosses->plantera': 3 })
    expect(s.nodes.get('skeletron-prime')).toMatchObject({ ring: true, unlock: false })
    expectTopological(s)
  })

  it('a recommended-next link lights from a defeat: the Eye of Cthulhu → the fork, both members newly recommended', () => {
    const s = schedule({}, defeated('eye-of-cthulhu'))
    expect(s.nodes.get('eye-of-cthulhu')).toMatchObject({ step: 0, ring: true })
    expect(s.links.get('eye-of-cthulhu->eater-of-worlds')).toMatchObject({ step: 1, lit: true, unlock: false })
    expect(s.nodes.get('eater-of-worlds')).toMatchObject({ step: 2, highlight: true, unlock: false })
    expect(s.nodes.get('brain-of-cthulhu')).toMatchObject({ step: 2, highlight: true })
    expect(s.branches.get('brain-of-cthulhu')).toMatchObject({ step: 1, lit: true })
    expectTopological(s)
  })

  it('several defeats at once (an undo, or marks made on boss pages): one cascade in flow order', () => {
    const s = schedule({}, defeated('wall-of-flesh', ...MECHS))
    expect(steps(s.nodes)).toMatchObject({ 'wall-of-flesh': 0, hardmode: 2, 'the-twins': 4, 'all-mechanical-bosses': 6, plantera: 8 })
    expect(s.nodes.get('the-twins')).toMatchObject({ ring: true, unlock: true })
    expectTopological(s)
  })

  it('reduced motion: the same elements, no stagger and no ripple (every delay 0), one 200ms fade', () => {
    const motion = schedule({}, defeated('wall-of-flesh'), false, null, position)
    const reduced = schedule({}, defeated('wall-of-flesh'), true, null, position)
    expect([...reduced.nodes.keys()]).toEqual([...motion.nodes.keys()])
    expect([...reduced.nodes.values(), ...reduced.links.values(), ...reduced.branches.values()].every((e) => e.delayMs === 0)).toBe(true)
    expect(reduced.rippleMs).toBe(0)
    expect(reduced.durationMs).toBe(UNLOCK_DURATION_MS)
    expect(schedule({}, defeated('eye-of-cthulhu'), true, null, position).branches.get('brain-of-cthulhu')?.delayMs).toBe(0)
  })

  it('M2 ripple: siblings within a step follow each other 25ms apart along their row — the Wall of Flesh’s fan arrives as a wave', () => {
    const s = schedule({}, defeated('wall-of-flesh'), false, null, position)
    expect(s.rippleMs).toBe(UNLOCK_RIPPLE_MS)
    // the same steps as without the ripple
    expect(steps(s.nodes)).toEqual(steps(schedule({}, defeated('wall-of-flesh')).nodes))
    expect(steps(s.links)).toEqual(steps(schedule({}, defeated('wall-of-flesh')).links))
    // a step with one element doesn't ripple
    expect(delays(s.nodes)).toMatchObject({ 'wall-of-flesh': 0, hardmode: 100 })
    expect(s.links.get('wall-of-flesh->hardmode')?.delayMs).toBe(50)
    // the fan, left to right along its row: each line 25ms after the one before, each node 50ms after its line
    const fan = byPosition(HARDMODE_OPENS)
    expect(fan.slice(0, 3)).toEqual(['skeletron-prime', 'the-destroyer', 'the-twins'])
    fan.forEach((id, i) => {
      expect(s.links.get(`hardmode->${id}`)?.delayMs, id).toBe(3 * UNLOCK_STAGGER_MS + i * UNLOCK_RIPPLE_MS)
      expect(s.nodes.get(id)?.delayMs, id).toBe(4 * UNLOCK_STAGGER_MS + i * UNLOCK_RIPPLE_MS)
    })
    expect(s.durationMs).toBe(4 * UNLOCK_STAGGER_MS + (fan.length - 1) * UNLOCK_RIPPLE_MS + UNLOCK_DURATION_MS)
    expect(s.durationMs).toBeLessThanOrEqual(UNLOCK_MAX_TOTAL_MS)
    expectTopological(s, false)
  })

  it('M2 ripple, the mechs converging: the three lines into the milestone ripple along the row, the milestone waits for the last', () => {
    const s = schedule(defeated('wall-of-flesh', 'the-twins', 'the-destroyer'), defeated('wall-of-flesh', ...MECHS), false, null, position)
    byPosition(MECHS).forEach((mech, i) => expect(s.links.get(`${mech}->all-mechanical-bosses`)?.delayMs, mech).toBe(UNLOCK_STAGGER_MS + i * UNLOCK_RIPPLE_MS))
    const lastLine = UNLOCK_STAGGER_MS + 2 * UNLOCK_RIPPLE_MS
    expect(delays(s.nodes)).toEqual({ 'skeletron-prime': 0, 'all-mechanical-bosses': lastLine + UNLOCK_STAGGER_MS, plantera: lastLine + 3 * UNLOCK_STAGGER_MS })
    expectTopological(s, false)
  })

  it('the ripple is capped: a wide fan stays within 700ms (fewer ms per sibling); a cascade already past it gets none', () => {
    // A synthetic fan: twenty more events behind Hardmode's required gates.
    const eclipse = raw.nodes.find((n) => n.id === 'solar-eclipse')!
    const gate = raw.edges.find((e) => e.from === 'hardmode' && e.to === 'solar-eclipse')!
    const extra = Array.from({ length: 20 }, (_, i) => ({ ...eclipse, id: `extra-event-${i}` }))
    const wide = buildMapGraph({ nodes: [...raw.nodes, ...extra], edges: [...raw.edges, ...extra.map((n) => ({ ...gate, to: n.id }))] }, bossesJson as Boss[])
    const order = new Map(wide.nodes.map((n, i) => [n.id, i]))
    const s = unlockSchedule(wide, mapProgress(wide, {}, null), mapProgress(wide, defeated('wall-of-flesh'), null), { position: order })
    const siblings = HARDMODE_OPENS.length + extra.length
    expect(s.nodes.size).toBe(2 + siblings)
    expect(s.rippleMs).toBeGreaterThan(0)
    expect(s.rippleMs).toBeLessThan(UNLOCK_RIPPLE_MS)
    expect(s.durationMs).toBe(4 * UNLOCK_STAGGER_MS + (siblings - 1) * s.rippleMs + UNLOCK_DURATION_MS)
    expect(s.durationMs).toBeLessThanOrEqual(UNLOCK_MAX_TOTAL_MS)
    // the largest ripple that fits: one ms more would overflow
    expect(4 * UNLOCK_STAGGER_MS + (siblings - 1) * (s.rippleMs + 1) + UNLOCK_DURATION_MS).toBeGreaterThan(UNLOCK_MAX_TOTAL_MS)
    // every boss at once (an undo after resetting the whole tree): already past the cap, so no ripple
    const everything = defeated(...raw.nodes.filter((n) => n.kind === 'boss').map((n) => n.id))
    const big = schedule({}, everything, false, null, position)
    expect(schedule({}, everything).durationMs).toBeGreaterThan(UNLOCK_MAX_TOTAL_MS)
    expect(big.rippleMs).toBe(0)
    expect(big.durationMs).toBe(schedule({}, everything).durationMs)
    expectTopological(big)
  })

  it('M1: a lead holds the whole cascade back while the camera frames it; no lead, the same schedule', () => {
    const s = schedule({}, defeated('eye-of-cthulhu'), false, null, position)
    const led = withLead(s, 250)
    for (const kind of ['nodes', 'links', 'branches'] as const) {
      expect(led[kind].size, kind).toBe(s[kind].size)
      for (const [id, e] of led[kind]) expect(e.delayMs, id).toBe(s[kind].get(id)!.delayMs + 250)
    }
    expect(led.durationMs).toBe(s.durationMs + 250)
    expect(withLead(s, 0)).toBe(s)
    expect(withLead(schedule({}, {}), 250).size).toBe(0)
  })

  it('M3: a gate met while its target still waits on another gate joins the cascade for its badge only', () => {
    // Skeletron meets its gate to the Lunatic Cultist, who still waits on Golem
    const s = schedule({}, defeated('skeletron'))
    expect(s.links.get('skeletron->lunatic-cultist')).toMatchObject({ step: 1, gate: true, unlock: false, lit: false })
    expect(s.nodes.has('lunatic-cultist')).toBe(false)
    // the Wall of Flesh: every gate it meets swaps as its line unlocks
    const w = schedule({}, defeated('wall-of-flesh'))
    for (const id of ['hardmode', ...HARDMODE_OPENS]) {
      const from = id === 'hardmode' ? 'wall-of-flesh' : 'hardmode'
      expect(w.links.get(`${from}->${id}`), id).toMatchObject({ gate: true, unlock: true })
    }
    // a recommended-next line has no gate to meet
    expect(schedule({}, defeated('eye-of-cthulhu')).links.get('eye-of-cthulhu->eater-of-worlds')).toMatchObject({ gate: false, lit: true })
  })

  it('re-locks are not animated: a reset (or an un-marked defeat) schedules nothing', () => {
    expect(schedule(defeated('wall-of-flesh', ...MECHS), {}).size).toBe(0)
    expect(schedule(defeated('wall-of-flesh'), { 'wall-of-flesh': 'skipped' }).size).toBe(0)
    expect(schedule({}, {}).size).toBe(0)
  })

  it('flow order puts every node after its predecessors (the fork members after the fork’s source)', () => {
    const order = flowOrder(graph)
    expect(order).toHaveLength(raw.nodes.length)
    for (const id of order) for (const link of flowIncoming(graph, id)) expect(order.indexOf(link.from), `${link.from} before ${id}`).toBeLessThan(order.indexOf(id))
    expect(newlyOpened(graph, mapProgress(graph, {}, null), mapProgress(graph, defeated('wall-of-flesh'), null))).toEqual(
      order.filter((id) => ['hardmode', ...HARDMODE_OPENS].includes(id)),
    )
  })
})
