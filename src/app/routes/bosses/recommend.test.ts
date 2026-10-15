/**
 * "What Should I Do Next?" (PRD P5-S5 AC1–AC4; UX_SPEC §3.7, §4d; AMENDMENTS-014 B69/Q6;
 * AMENDMENTS-015 B86d): the recommendation over the real progression graph — fresh start, the
 * world-evil fork, the walk from Pre-Hardmode to Moon Lord, inconsistent tracking, the selected stage
 * as context, invariants over many tracked states, the copy audit, the panel's markup and the
 * frontier the map opens on.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { buildMapGraph, isNodeActive, layoutInputs, type NodeState, type WorldEvil } from '../../../components/nodeMap/graph'
import { layoutGraph } from '../../../components/nodeMap/layout'
import { MAP_LAYOUT_OPTIONS } from '../../../components/nodeMap/mapConfig'
import { frontierRect } from '../../../components/nodeMap/opening'
import { unionRect } from '../../../components/nodeMap/panZoom'
import { mapProgress } from '../../../components/nodeMap/progressView'
import { nodeExtent } from '../../../components/nodeMap/scene'
import type { Boss, ProgressionEdge, ProgressionNode } from '../../../data-access/types'
import bossesJson from '../../../data/bosses.json'
import progressionJson from '../../../data/progression.json'
import { STAGE_IDS, type Stage } from '../../stages'
import { finalNode, recommend, type Recommendation, type RecommendItem } from './recommend'
import * as copy from './recommendCopy'
import { RecommendContent } from './RecommendPanel'

const raw = progressionJson as { nodes: ProgressionNode[]; edges: ProgressionEdge[] }
const graph = buildMapGraph(raw, bossesJson as Boss[])
const BOSSES = raw.nodes.filter((n) => n.kind === 'boss').map((n) => n.id)
const WORLDS: readonly (WorldEvil | null)[] = [null, 'corruption', 'crimson']
const defeated = (...ids: string[]): Record<string, NodeState> => Object.fromEntries(ids.map((id) => [id, 'defeated' as const]))
const keys = (items: readonly RecommendItem[]) => items.map((i) => i.key)
const item = (items: readonly RecommendItem[], key: string) => items.find((i) => i.key === key)
const name = (id: string) => graph.nodeById.get(id)!.name
const edgeNote = (from: string, to: string, type: ProgressionEdge['type']) => {
  const e = raw.edges.find((x) => x.from === from && x.to === to && x.type === type)!
  return { text: e.note!, sourceUrl: e.sourceUrl }
}

const PRE = ['eye-of-cthulhu', 'eater-of-worlds', 'skeletron']
const MECHS = ['skeletron-prime', 'the-destroyer', 'the-twins'] // flow order (the map's own "needs" order)
const WALK: readonly string[][] = [
  [],
  ['eye-of-cthulhu'],
  ['eye-of-cthulhu', 'eater-of-worlds'],
  PRE,
  [...PRE, 'wall-of-flesh'],
  [...PRE, 'wall-of-flesh', ...MECHS],
  [...PRE, 'wall-of-flesh', ...MECHS, 'plantera'],
  [...PRE, 'wall-of-flesh', ...MECHS, 'plantera', 'golem'],
  [...PRE, 'wall-of-flesh', ...MECHS, 'plantera', 'golem', 'lunatic-cultist'],
  [...PRE, 'wall-of-flesh', ...MECHS, 'plantera', 'golem', 'lunatic-cultist', 'moon-lord'],
]

/* Copy audit (UX_SPEC §8/§10.3; SCORING_SPEC §8.4; PRD §9): no difficulty estimates, no outcome or
 * probability phrasing, no "best", no forward promises. Wiki quotes (edge notes) are evidence and are
 * removed before auditing our own copy, as on the boss pages. */
const BANNED =
  /\b(best|easy|easier|harder|hard|difficult\w*|tough\w*|challeng\w*|threat\w*|danger\w*|win|wins|winning|lose|loses|losing|odds|chance\w*|probab\w*|guarantee\w*|risk\w*|likely|predict\w*)\b|you(?:'|’)ll|you will|won(?:'|’)t (?:beat|defeat|kill|survive|die)|time.to.kill|\bTTK\b/i
const FORWARD_PROMISE = /\b(yet|coming soon|so far|soon)\b/i

describe('the final node (the required path’s end)', () => {
  it('is Moon Lord: the node with the most required-gate ancestors', () => {
    expect(finalNode(graph)).toBe('moon-lord')
  })
})

describe('AC4: nothing tracked → a fresh-start recommendation, never an error', () => {
  for (const world of WORLDS) {
    it(`world evil ${world ?? 'Both'}: Wall of Flesh required for Hardmode; Eye of Cthulhu then King Slime recommended, per the edges`, () => {
      const r = recommend(graph, {}, world)
      expect(r.state).toBe('fresh')
      expect(r.goal?.id).toBe('hardmode')
      expect(r.progressStage).toBe('early-prehm')
      // required: the Wall of Flesh, and the map's usual order puts it after Skeletron
      expect(keys(r.required)).toEqual(['wall-of-flesh'])
      expect(r.required[0].reason).toBe(`${copy.neededToReach('Hardmode', [])} ${copy.usuallyAfterHint(['Skeletron'])}`)
      expect(r.required[0].evidence).toEqual(edgeNote('wall-of-flesh', 'hardmode', 'required-gate'))
      // recommended: the start's recommended-next, then its Early Pre-Hardmode optional fight
      expect(keys(r.recommended)).toEqual(['eye-of-cthulhu', 'king-slime'])
      expect(r.recommended[0]).toMatchObject({ kind: 'next', status: 'recommended', reason: copy.firstOf('Pre-Hardmode'), evidence: edgeNote('pre-hardmode', 'eye-of-cthulhu', 'recommended-next') })
      expect(r.recommended[1]).toMatchObject({ kind: 'optional', reason: copy.OPTIONAL, evidence: edgeNote('pre-hardmode', 'king-slime', 'optional'), earlier: false })
      // Queen Bee and Deerclops (Late Pre-Hardmode optional) wait for the main path to get there
      expect(keys(r.recommended)).not.toContain('queen-bee')
      expect(keys(r.recommended)).not.toContain('deerclops')
      // the map keeps its usual opening view
      expect(r.frontier).toBeUndefined()
    })
  }

  it('stored ids the graph doesn’t know are ignored: still a fresh start', () => {
    expect(recommend(graph, { 'not-a-boss': 'defeated' }, null).state).toBe('fresh')
  })
})

describe('AC1 world type: the Eater of Worlds / Brain of Cthulhu fork follows the world evil', () => {
  const afterEye = defeated('eye-of-cthulhu')

  it('Both (no world evil chosen): one fork-choice item naming both, with the either/or sentence as evidence', () => {
    const r = recommend(graph, afterEye, null)
    const fork = r.recommended[0]
    expect(fork.key).toBe('eater-of-worlds|brain-of-cthulhu')
    expect(fork.nodes.map((n) => n.id)).toEqual(['eater-of-worlds', 'brain-of-cthulhu'])
    expect(fork.reason).toBe(
      copy.forkChoice('Eye of Cthulhu', [
        { name: 'Eater of Worlds', world: 'Corruption' },
        { name: 'Brain of Cthulhu', world: 'Crimson' },
      ]),
    )
    expect(fork.evidence).toEqual(edgeNote('eater-of-worlds', 'brain-of-cthulhu', 'alternative-route'))
    expect(r.frontier).toEqual(['eater-of-worlds', 'brain-of-cthulhu'])
  })

  it('Corruption: the Eater of Worlds alone, with its own recommended-next sentence', () => {
    const r = recommend(graph, afterEye, 'corruption')
    expect(keys(r.recommended)).toEqual(['eater-of-worlds', 'king-slime'])
    expect(r.recommended[0].reason).toBe(`${copy.usuallyNext('Eye of Cthulhu')} ${copy.inWorld('Corruption')}`)
    expect(r.recommended[0].evidence).toEqual(edgeNote('eye-of-cthulhu', 'eater-of-worlds', 'recommended-next'))
  })

  it('Crimson: the Brain of Cthulhu alone — evidence is the either/or sentence, never the Corruption one', () => {
    const r = recommend(graph, afterEye, 'crimson')
    expect(keys(r.recommended)).toEqual(['brain-of-cthulhu', 'king-slime'])
    expect(r.recommended[0].reason).toBe(`${copy.usuallyNext('Eye of Cthulhu')} ${copy.inWorld('Crimson')}`)
    expect(r.recommended[0].evidence).toEqual(edgeNote('eater-of-worlds', 'brain-of-cthulhu', 'alternative-route'))
    expect(r.recommended[0].evidence?.text).not.toMatch(/Due to how helpful Corruption gear is/)
  })

  it('Both, one member marked: the pair is settled — the other isn’t suggested, Skeletron is next', () => {
    for (const member of ['eater-of-worlds', 'brain-of-cthulhu']) {
      const r = recommend(graph, defeated('eye-of-cthulhu', member), null)
      expect(r.recommended.flatMap((i) => i.nodes.map((n) => n.id))).not.toContain(member === 'eater-of-worlds' ? 'brain-of-cthulhu' : 'eater-of-worlds')
      expect(r.recommended[0].key).toBe('skeletron')
      expect(r.recommended[0].reason).toBe(copy.usuallyNext(name(member)))
    }
  })

  it('a world evil chosen after marking the other world’s boss: that mark settles nothing (it’s out of play)', () => {
    const r = recommend(graph, defeated('eye-of-cthulhu', 'eater-of-worlds'), 'crimson')
    expect(keys(r.recommended)).toContain('brain-of-cthulhu')
    expect(keys(r.recommended)).not.toContain('eater-of-worlds')
  })

  it('a world-evil boss is never in a list while it is out of play', () => {
    for (const states of WALK) {
      for (const world of ['corruption', 'crimson'] as const) {
        const r = recommend(graph, defeated(...states), world)
        for (const i of [...r.required, ...r.recommended]) for (const n of i.nodes) expect(isNodeActive(n, world), `${n.id} in ${world}`).toBe(true)
      }
    }
  })
})

describe('AC2/AC3: required vs recommended, with reasons — and changing defeats changes them', () => {
  it('after Skeletron: the Wall of Flesh is required (and now the map’s recommended next); Queen Bee and Deerclops open up', () => {
    const r = recommend(graph, defeated(...PRE), 'corruption')
    expect(keys(r.required)).toEqual(['wall-of-flesh'])
    expect(r.required[0]).toMatchObject({ status: 'recommended', reason: copy.neededToReach('Hardmode', []) })
    expect(keys(r.recommended)).toEqual(['deerclops', 'queen-bee', 'king-slime'])
    expect(item(r.recommended, 'king-slime')).toMatchObject({ earlier: true, reason: copy.optionalEarlier('Early Pre-Hardmode') })
    expect(r.frontier).toEqual(['wall-of-flesh'])
  })

  it('AC3: marking the Wall of Flesh switches the recommendation to early Hardmode', () => {
    const before = recommend(graph, defeated(...PRE), 'corruption')
    const after = recommend(graph, defeated(...PRE, 'wall-of-flesh'), 'corruption')
    const stage = (i: RecommendItem) => STAGE_IDS.indexOf(i.nodes[0].stage as Stage)
    expect(Math.max(...[...before.required, ...before.recommended].map(stage))).toBeLessThanOrEqual(STAGE_IDS.indexOf('late-prehm'))
    expect(after.progressStage).toBe('early-hm')
    expect(after.goal?.id).toBe('all-mechanical-bosses')
    // required: the three mechanical bosses, each needed for Plantera along with the other two
    expect(keys(after.required)).toEqual(MECHS)
    for (const id of MECHS) {
      const others = MECHS.filter((m) => m !== id).map(name)
      expect(item(after.required, id)).toMatchObject({ status: 'recommended', reason: copy.neededFor('Plantera', others), evidence: edgeNote('all-mechanical-bosses', 'plantera', 'required-gate') })
      expect(after.required.find((i) => i.key === id)!.nodes[0].stage).toBe('early-hm')
    }
    // recommended: Queen Slime first (optional, this stage); the Pre-Hardmode optional fights after, as earlier
    expect(after.recommended[0]).toMatchObject({ key: 'queen-slime', kind: 'optional', earlier: false, evidence: edgeNote('hardmode', 'queen-slime', 'optional') })
    expect(after.recommended.slice(1).every((i) => i.earlier)).toBe(true)
    expect(after.frontier).toEqual(MECHS)
  })

  it('early challenges are never recommended early: Duke Fishron not after the Wall of Flesh, the Empress of Light not after Plantera — both after Golem', () => {
    const wof = recommend(graph, defeated(...PRE, 'wall-of-flesh'), null)
    expect(keys(wof.recommended)).not.toContain('duke-fishron')
    const plantera = recommend(graph, defeated(...PRE, 'wall-of-flesh', ...MECHS, 'plantera'), null)
    expect(keys(plantera.recommended)).not.toContain('empress-of-light')
    expect(keys(plantera.recommended)).not.toContain('duke-fishron')
    const golem = recommend(graph, defeated(...PRE, 'wall-of-flesh', ...MECHS, 'plantera', 'golem'), null)
    expect(item(golem.recommended, 'duke-fishron')).toMatchObject({ kind: 'optional', earlier: false, evidence: edgeNote('golem', 'duke-fishron', 'optional') })
    expect(item(golem.recommended, 'empress-of-light')).toMatchObject({ kind: 'optional', earlier: false, evidence: edgeNote('golem', 'empress-of-light', 'optional') })
  })

  it('past the last milestone the required path runs to Moon Lord: each fight what it is needed for, the locked ones what they wait on', () => {
    const r = recommend(graph, defeated(...PRE, 'wall-of-flesh', ...MECHS), null)
    expect(r.goal?.id).toBe('moon-lord')
    expect(keys(r.required)).toEqual(['plantera', 'golem', 'lunatic-cultist', 'moon-lord'])
    expect(item(r.required, 'plantera')).toMatchObject({ status: 'recommended', needs: [], reason: copy.neededFor('Golem', []), evidence: edgeNote('plantera', 'golem', 'required-gate') })
    expect(item(r.required, 'golem')).toMatchObject({ status: 'locked', needs: ['Plantera'], reason: copy.neededFor('Lunatic Cultist', []) })
    expect(item(r.required, 'lunatic-cultist')).toMatchObject({ status: 'locked', needs: ['Golem'], reason: copy.neededFor('Celestial Pillars', []) })
    expect(item(r.required, 'moon-lord')).toMatchObject({ status: 'locked', needs: ['Lunatic Cultist'], reason: copy.LAST_REQUIRED, evidence: edgeNote('celestial-pillars', 'moon-lord', 'required-gate') })
    expect(r.frontier).toEqual(['plantera'])
  })

  it('the walk from a fresh world to Moon Lord: each defeat moves the lists on; the required list empties once Moon Lord is marked', () => {
    const firsts = WALK.map((states) => {
      const r = recommend(graph, defeated(...states), 'corruption')
      return [r.required[0]?.key ?? null, r.recommended[0]?.key ?? null]
    })
    expect(firsts).toEqual([
      ['wall-of-flesh', 'eye-of-cthulhu'],
      ['wall-of-flesh', 'eater-of-worlds'],
      ['wall-of-flesh', 'skeletron'],
      ['wall-of-flesh', 'deerclops'],
      ['skeletron-prime', 'queen-slime'],
      // Queen Slime from here on is "still open from Early Hardmode": earlier ones, the most recent first
      ['plantera', 'queen-slime'],
      ['golem', 'queen-slime'],
      ['lunatic-cultist', 'duke-fishron'],
      ['moon-lord', 'duke-fishron'],
      [null, 'duke-fishron'],
    ])
    const end = recommend(graph, defeated(...WALK[WALK.length - 1]), 'corruption')
    expect(end).toMatchObject({ state: 'progress', goalDone: true, progressStage: 'endgame', frontier: ['moon-lord'] })
    // what's left is optional, every one from an earlier stage, the most recent first
    expect(end.recommended.every((i) => i.kind === 'optional' && i.earlier)).toBe(true)
    expect(end.recommended.map((i) => i.nodes[0].stage)).toEqual(['mid-hm', 'mid-hm', 'early-hm', 'late-prehm', 'late-prehm', 'early-prehm'])
  })

  it('full clear: every boss marked → "nothing left to recommend", never an error', () => {
    const all = recommend(graph, defeated(...BOSSES), 'corruption')
    expect(all).toMatchObject({ state: 'complete', required: [], recommended: [], allMarked: true, goalDone: true })
    // optional fights skipped count as marked
    const skipped = { ...defeated(...WALK[WALK.length - 1]), ...Object.fromEntries(['king-slime', 'queen-bee', 'deerclops', 'queen-slime', 'duke-fishron', 'empress-of-light'].map((id) => [id, 'skipped' as const])) }
    expect(recommend(graph, skipped, 'corruption')).toMatchObject({ state: 'complete', allMarked: true })
  })
})

describe('inconsistent tracking (B86b: a tracked fight stands for its own upstream)', () => {
  it('only the Wall of Flesh marked: the Pre-Hardmode main path is behind the player — never suggested; optional ones last, as earlier', () => {
    const r = recommend(graph, defeated('wall-of-flesh'), null)
    expect(keys(r.required)).toEqual(MECHS)
    for (const id of ['eye-of-cthulhu', 'eater-of-worlds', 'brain-of-cthulhu', 'skeletron']) expect(r.recommended.flatMap((i) => i.nodes.map((n) => n.id))).not.toContain(id)
    expect(keys(r.recommended)).toEqual(['queen-slime', 'deerclops', 'queen-bee', 'king-slime'])
  })

  it('Hardmode bosses marked but not Skeletron: Skeletron turns up as required for the Lunatic Cultist (the game needs it)', () => {
    const r = recommend(graph, defeated('wall-of-flesh', ...MECHS), null)
    expect(r.required[0]).toMatchObject({
      key: 'skeletron',
      reason: `${copy.neededFor('Lunatic Cultist', ['Golem'])} ${copy.usuallyAfterHint(['Eater of Worlds or Brain of Cthulhu'])}`,
      evidence: edgeNote('skeletron', 'lunatic-cultist', 'required-gate'),
    })
    expect(item(r.required, 'golem')?.reason).toBe(copy.neededFor('Lunatic Cultist', ['Skeletron']))
    // the frontier stays at the progress stage: Plantera, not the Pre-Hardmode Skeletron
    expect(r.frontier).toEqual(['plantera'])
  })
})

describe('AC1 selected stage: display context only — tracked defeats decide (B69/Q6)', () => {
  it('the lists are the same whatever stage is selected', () => {
    for (const states of WALK) {
      const base = recommend(graph, defeated(...states), null)
      for (const stage of [null, ...STAGE_IDS]) {
        const r = recommend(graph, defeated(...states), null, stage)
        expect(r.required).toEqual(base.required)
        expect(r.recommended).toEqual(base.recommended)
      }
    }
  })

  it('a note only when the selected stage is behind what’s done or ahead of what’s next', () => {
    expect(recommend(graph, {}, null, 'early-hm').stageNote).toEqual({ selected: 'early-hm', relation: 'ahead' })
    expect(recommend(graph, {}, null, 'early-prehm').stageNote).toBeUndefined()
    expect(recommend(graph, {}, null, null).stageNote).toBeUndefined()
    // done: Early Pre-Hardmode; next: Skeletron (Late Pre-Hardmode) — either stage agrees
    const eow = defeated('eye-of-cthulhu', 'eater-of-worlds')
    expect(recommend(graph, eow, 'corruption', 'early-prehm').stageNote).toBeUndefined()
    expect(recommend(graph, eow, 'corruption', 'late-prehm').stageNote).toBeUndefined()
    expect(recommend(graph, defeated(...PRE, 'wall-of-flesh'), null, 'late-prehm').stageNote).toEqual({ selected: 'late-prehm', relation: 'behind' })
  })
})

/** A small seeded PRNG (mulberry32) so the sweep is deterministic. */
function prng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const EDGE_NOTES = new Set(raw.edges.filter((e) => e.note).map((e) => `${e.note}\u0000${e.sourceUrl}`))

function checkInvariants(r: Recommendation, nodeStates: Record<string, NodeState>, world: WorldEvil | null, label: string) {
  const progress = mapProgress(graph, nodeStates, world)
  const requiredIds = r.required.flatMap((i) => i.nodes.map((n) => n.id))
  const recommendedIds = r.recommended.flatMap((i) => i.nodes.map((n) => n.id))
  expect(requiredIds.filter((id) => recommendedIds.includes(id)), label).toEqual([])
  for (const i of [...r.required, ...r.recommended]) {
    for (const n of i.nodes) {
      expect(n.kind, label).toBe('boss')
      expect(isNodeActive(n, world), label).toBe(true)
      expect(progress.nodes.get(n.id), label).toBe(i.status)
    }
    expect(i.reason.length, label).toBeGreaterThan(0)
    expect(i.reason, label).not.toMatch(BANNED)
    expect(i.reason, label).not.toMatch(FORWARD_PROMISE)
    if (i.evidence) expect(EDGE_NOTES.has(`${i.evidence.text}\u0000${i.evidence.sourceUrl}`), `${label}: ${i.key} evidence is a verbatim edge note`).toBe(true)
    if (i.status === 'locked') expect(i.needs.length, label).toBeGreaterThan(0)
  }
  for (const i of r.recommended) {
    expect(i.status, label).not.toBe('locked')
    for (const n of i.nodes) expect(nodeStates[n.id], label).toBeUndefined()
  }
  for (const i of r.required) expect(nodeStates[i.key] === 'defeated' && isNodeActive(i.nodes[0], world), label).toBe(false)
  for (const id of r.frontier ?? []) expect(graph.nodeById.has(id), label).toBe(true)
  if (r.state === 'complete') expect(r.required.length + r.recommended.length, label).toBe(0)
  if (r.state === 'fresh') expect(r.frontier, label).toBeUndefined()
  else expect(r.frontier?.length ?? 0, label).toBeGreaterThan(0)
}

describe('invariants over many tracked states (deterministic sweep)', () => {
  it('lists never overlap, hold only open-or-required bosses in play, carry real edge notes as evidence, and pass the copy audit', () => {
    const random = prng(5_5)
    for (let run = 0; run < 400; run++) {
      const states: Record<string, NodeState> = {}
      const density = random()
      for (const id of BOSSES) {
        const roll = random()
        if (roll < density * 0.85) states[id] = 'defeated'
        else if (roll < density) states[id] = 'skipped'
      }
      const world = WORLDS[Math.floor(random() * WORLDS.length)]
      const stage = random() < 0.3 ? null : STAGE_IDS[Math.floor(random() * STAGE_IDS.length)]
      checkInvariants(recommend(graph, states, world, stage), states, world, `run ${run} ${world} ${JSON.stringify(states)}`)
    }
    for (const states of WALK) for (const world of WORLDS) checkInvariants(recommend(graph, defeated(...states), world), defeated(...states), world, `walk ${states.length} ${world}`)
  })
})

describe('copy audit (no difficulty estimates, no outcome phrasing, no forward promises)', () => {
  const samples = [
    copy.progressContext('Early Hardmode'),
    copy.worldContext('Corruption'),
    copy.worldContext(null),
    copy.stageNote('Endgame', 'Early Hardmode', 'ahead'),
    copy.stageNote('Early Pre-Hardmode', 'Early Hardmode', 'behind'),
    copy.neededToReach('Hardmode', ['The Twins']),
    copy.neededFor('Plantera', ['The Destroyer', 'Skeletron Prime']),
    copy.usuallyAfterHint(['Skeletron']),
    copy.firstOf('Pre-Hardmode'),
    copy.usuallyNext('Eye of Cthulhu'),
    copy.openedBy('Hardmode'),
    copy.inWorld('Crimson'),
    copy.forkChoice('Eye of Cthulhu', [{ name: 'Eater of Worlds', world: 'Corruption' }]),
    copy.optionalEarlier('Mid-Hardmode'),
    copy.requiredDone('Moon Lord'),
    copy.sourceLabel('King Slime'),
    ...Object.values(copy as Record<string, unknown>).filter((v): v is string => typeof v === 'string'),
  ]

  it.each(samples)('%s', (line) => {
    expect(line).not.toMatch(BANNED)
    expect(line).not.toMatch(FORWARD_PROMISE)
  })

  it('the rendered panel’s own copy, with the quoted wiki sentences removed, in every state of the walk', () => {
    for (const states of [...WALK, BOSSES]) {
      for (const world of WORLDS) {
        const r = recommend(graph, defeated(...states), world, 'mid-hm')
        let html = renderToStaticMarkup(createElement(RecommendContent, { recommendation: r, worldEvil: world, sprites: null, onJump: () => {}, idPrefix: 'rec' }))
        for (const i of [...r.required, ...r.recommended]) if (i.evidence) html = html.split(escaped(i.evidence.text)).join(' ')
        const own = text(html)
        expect(own).not.toMatch(BANNED)
        expect(own).not.toMatch(FORWARD_PROMISE)
      }
    }
  })
})

const escaped = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
const render = (r: Recommendation, world: WorldEvil | null = null) =>
  renderToStaticMarkup(createElement(RecommendContent, { recommendation: r, worldEvil: world, sprites: null, onJump: () => {}, idPrefix: 'rec' }))

describe('RecommendContent (UX_SPEC §3.7: two lists with reasons and node links)', () => {
  it('fresh: the context says so; "Required before you can progress" comes first, then "Recommended order", each an ordered list', () => {
    const html = render(recommend(graph, {}, null))
    expect(html).toContain('data-recommend-state="fresh"')
    expect(text(html)).toContain(copy.FRESH_CONTEXT)
    expect(text(html)).toContain(copy.worldContext(null))
    const required = html.indexOf('data-recommend-list="required"')
    const recommended = html.indexOf('data-recommend-list="recommended"')
    expect(required).toBeGreaterThan(-1)
    expect(recommended).toBeGreaterThan(required)
    expect(html).toMatch(/<section aria-labelledby="rec-required" data-recommend-list="required"[^>]*><h3 id="rec-required"[^>]*>[\s\S]*?Required before you can progress<\/h3>/)
    expect(html).toMatch(/<section aria-labelledby="rec-recommended" data-recommend-list="recommended"[^>]*><h3 id="rec-recommended"[^>]*>[\s\S]*?Recommended order<\/h3>/)
    expect(html.match(/<ol /g)).toHaveLength(2)
    expect(html).not.toContain('data-stage-note')
  })

  it('each fight: a node-jump button (named for screen readers), its stage and map status, the reason, the quoted sentence with its source', () => {
    const r = recommend(graph, {}, null)
    const html = render(r)
    const row = /<li data-recommend-item="eye-of-cthulhu" data-kind="next"[\s\S]*?<\/li>/.exec(html)![0]
    expect(row).toMatch(/<button type="button" data-recommend-jump="eye-of-cthulhu"[^>]*>Eye of Cthulhu<span class="sr-only"> — show on the map<\/span><\/button>/)
    expect(row).toContain('Early Pre-Hardmode')
    expect(row).toContain('data-node-status="recommended"')
    expect(row).toMatch(new RegExp(`data-recommend-reason=""[^>]*>${copy.firstOf('Pre-Hardmode').replace('.', '\\.')}</p>`))
    expect(row).toContain(`“${escaped(r.recommended[0].evidence!.text)}”`)
    expect(row).toMatch(new RegExp(`<a href="${escaped(r.recommended[0].evidence!.sourceUrl)}" target="_blank" rel="noopener noreferrer"[^>]*data-source-link=""`))
    expect(row).toContain(`${copy.sourceLabel('Eye of Cthulhu')} on terraria.wiki.gg (opens in a new tab)`)
    // every local href is absent: jumps are buttons, sources are the wiki
    expect(html).not.toMatch(/href="\//)
  })

  it('a wiki sentence shared down a list is quoted once; every row keeps its own source link (the three mechs share Plantera’s)', () => {
    const r = recommend(graph, defeated(...PRE, 'wall-of-flesh'), null)
    const html = render(r)
    const required = /<section aria-labelledby="rec-required"[\s\S]*?<\/section>/.exec(html)![0]
    const quote = escaped(edgeNote('all-mechanical-bosses', 'plantera', 'required-gate').text)
    expect(required.split(quote).length - 1).toBe(1)
    for (const id of MECHS) {
      const row = new RegExp(`<li data-recommend-item="${id}"[\\s\\S]*?</li>`).exec(required)![0]
      expect(row.match(/data-source-link=""/g), id).toHaveLength(1)
      expect(row).toContain(`${copy.sourceLabel(name(id))} on terraria.wiki.gg`)
    }
    expect(r.required.every((i) => i.evidence?.text === edgeNote('all-mechanical-bosses', 'plantera', 'required-gate').text)).toBe(true)
  })

  it('the fork (Both): one row, two jump buttons joined by "or"', () => {
    const html = render(recommend(graph, defeated('eye-of-cthulhu'), null))
    const row = /<li data-recommend-item="eater-of-worlds\|brain-of-cthulhu"[\s\S]*?<\/li>/.exec(html)![0]
    expect(row.match(/data-recommend-jump="/g)).toHaveLength(2)
    expect(text(row)).toMatch(/Eater of Worlds — show on the map or Brain of Cthulhu — show on the map/)
  })

  it('a locked required fight says what it waits on; an emptied required list says the goal is done', () => {
    const locked = render(recommend(graph, defeated(...PRE, 'wall-of-flesh', ...MECHS), null))
    expect(/<li data-recommend-item="golem"[\s\S]*?<\/li>/.exec(locked)![0]).toContain('Locked on the map: needs Plantera first.')
    const done = render(recommend(graph, defeated(...WALK[WALK.length - 1]), null))
    expect(done).toContain(`data-recommend-empty="required"`)
    expect(text(done)).toContain(copy.requiredDone('Moon Lord'))
  })

  it('full clear: the completion state replaces both lists', () => {
    const html = render(recommend(graph, defeated(...BOSSES), 'corruption'), 'corruption')
    expect(html).toContain('data-recommend-complete=""')
    expect(text(html)).toContain(copy.COMPLETE_TITLE)
    expect(text(html)).toContain(copy.COMPLETE_ALL)
    expect(html).not.toContain('data-recommend-list')
  })

  it('the selected stage shows as context when it disagrees with the marked bosses', () => {
    const html = render(recommend(graph, {}, null, 'early-hm'))
    expect(html).toContain('data-stage-note="ahead"')
    expect(text(html)).toContain(copy.stageNote('Early Hardmode', 'Early Pre-Hardmode', 'ahead'))
  })

  it('world evil "Both": the context names the control’s state, never “not chosen”', () => {
    expect(copy.worldContext(null)).toMatch(/^World evil: Both\b/)
    expect(text(render(recommend(graph, {}, null)))).not.toMatch(/not chosen/)
  })

  it('the footer about reasons and quotes shows beside the lists only — not on the full-clear state', () => {
    expect(text(render(recommend(graph, {}, null)))).toContain(copy.SOURCES_NOTE)
    const complete = render(recommend(graph, defeated(...BOSSES), 'corruption'), 'corruption')
    expect(complete).not.toContain('data-recommend-sources')
    expect(text(complete)).not.toContain(copy.SOURCES_NOTE)
  })
})

describe('design review P5-S5 M3: a fight carried over from an earlier stage', () => {
  const row = (html: string, key: string) => new RegExp(`<li data-recommend-item="${key.replace('|', '\\|')}"[\\s\\S]*?</li>`).exec(html)?.[0] ?? ''
  const AFTER_MECHS = [...PRE, 'wall-of-flesh', ...MECHS]
  const smallGap = edgeNote('hardmode', 'queen-slime', 'optional').text

  it('Queen Slime after the mechs: the Optional tag, never her map status “Recommended next”; the templated reason, no quote — its source link stays', () => {
    const r = recommend(graph, defeated(...AFTER_MECHS), null)
    const queen = item(r.recommended, 'queen-slime')!
    // the model is unchanged: still her map status and the edge's sentence as evidence
    expect(queen).toMatchObject({ kind: 'optional', earlier: true, status: 'recommended', reason: copy.optionalEarlier('Early Hardmode'), evidence: edgeNote('hardmode', 'queen-slime', 'optional') })
    const html = row(render(r), 'queen-slime')
    expect(html).toContain('data-recommend-tag="optional"')
    expect(text(html)).toContain(copy.OPTIONAL_TAG)
    expect(html).not.toContain('data-node-status')
    expect(text(html)).not.toContain('Recommended next')
    expect(html).not.toContain('data-recommend-evidence')
    expect(html).not.toContain(escaped(smallGap))
    expect(html.match(/data-source-link=""/g)).toHaveLength(1)
    expect(html).toContain(`${copy.sourceLabel('Queen Slime')} on terraria.wiki.gg`)
  })

  it('at her own stage (right after the Wall of Flesh) she is not carried over: map status and the quote as before', () => {
    const html = row(render(recommend(graph, defeated(...PRE, 'wall-of-flesh'), null)), 'queen-slime')
    expect(html).toContain('data-node-status="recommended"')
    expect(html).not.toContain('data-recommend-tag')
    expect(html).toContain(`“${escaped(smallGap)}”`)
  })

  it('every state of the walk, every world: carried-over rows tag Optional and quote nothing; the others show their map status', () => {
    let carried = 0
    for (const states of [...WALK, BOSSES]) {
      for (const world of WORLDS) {
        const r = recommend(graph, defeated(...states), world)
        const html = render(r, world)
        for (const i of [...r.required, ...r.recommended]) {
          const own = row(html, i.key)
          if (i.earlier) {
            carried++
            expect(own, i.key).toContain('data-recommend-tag="optional"')
            expect(own, i.key).not.toContain('data-node-status')
            expect(own, i.key).not.toContain('data-recommend-evidence')
          } else {
            expect(own, i.key).toContain(`data-node-status="${i.status}"`)
            expect(own, i.key).not.toContain('data-recommend-tag')
          }
        }
      }
    }
    expect(carried).toBeGreaterThan(10)
  })

  it('a hidden quote doesn’t count as “quoted above”: a later row with the same sentence still quotes it', () => {
    const shared = { text: 'A shared sentence.', sourceUrl: 'https://terraria.wiki.gg/wiki/Bosses' }
    const base = recommend(graph, defeated(...AFTER_MECHS), null)
    const [first, second] = base.recommended
    const synthetic: Recommendation = { ...base, required: [], recommended: [{ ...first, key: 'a', earlier: true, evidence: shared }, { ...second, key: 'b', earlier: false, evidence: shared }] }
    const html = render(synthetic)
    expect(row(html, 'a')).not.toContain('data-recommend-evidence')
    expect(row(html, 'b')).toContain(`“${shared.text}”`)
  })
})

describe('design review P5-S5 M2: a wiki sentence cut mid-way gets its subject back, marked', () => {
  const MECH_CUT = edgeNote('the-twins', 'all-mechanical-bosses', 'required-gate')

  it('the Lunatic Cultist’s sentence (the Celestial Pillars article’s lead without its subject): “[Celestial Pillars] are four…”; the stored quote stays verbatim', () => {
    const r = recommend(graph, defeated(...PRE, 'wall-of-flesh', ...MECHS), null)
    const cultist = item(r.required, 'lunatic-cultist')!
    const stored = edgeNote('lunatic-cultist', 'celestial-pillars', 'required-gate')
    expect(stored.text).toMatch(/^are four late-Hardmode/)
    expect(cultist.evidence).toEqual({ ...stored, lead: '[Celestial Pillars] ' })
    expect(render(r)).toContain(`“[Celestial Pillars] ${escaped(stored.text)}”`)
  })

  it('every quoted sentence in every state of the walk reads from a capital or a marked lead, never mid-sentence', () => {
    for (const states of [...WALK, BOSSES]) {
      for (const world of WORLDS) {
        const r = recommend(graph, defeated(...states), world)
        for (const i of [...r.required, ...r.recommended]) {
          if (!i.evidence) continue
          const shown = `${i.evidence.lead ?? ''}${i.evidence.text}`
          expect(shown, i.key).not.toMatch(/^\p{Ll}/u)
          // a whole sentence carries no lead
          if (!/^\p{Ll}/u.test(i.evidence.text)) expect(i.evidence.lead, i.key).toBeUndefined()
          // only the sentence pinned as cut at the end carries a trail (B93(ii))
          expect(i.evidence.trail, i.key).toBe(i.evidence.text === MECH_CUT.text ? '…' : undefined)
        }
      }
    }
  })

  it('B93(ii): where the panel quotes the mech sentence (a milestone opening no single fight), it ends with an ellipsis; the stored quote stays verbatim', () => {
    // the shipped graph quotes Plantera's sentence for the mechs; without that link the panel falls back to the mechs' own
    const trimmed = buildMapGraph({ nodes: raw.nodes, edges: raw.edges.filter((e) => !(e.from === 'all-mechanical-bosses' && e.to === 'plantera')) }, bossesJson as Boss[])
    const r = recommend(trimmed, defeated(...PRE, 'wall-of-flesh'), null)
    expect(keys(r.required)).toEqual(MECHS)
    for (const id of MECHS) expect(item(r.required, id)!.evidence, id).toEqual({ ...edgeNote(id, 'all-mechanical-bosses', 'required-gate'), trail: '…' })
    expect(MECH_CUT.text).not.toMatch(/…$/)
    expect(render(r)).toContain(`“${escaped(MECH_CUT.text)}…”`)
  })
})

describe('B86d: the map opens framed on the progress frontier', () => {
  const layout = (() => {
    const input = layoutInputs(graph)
    return layoutGraph(input.nodes, input.edges, input.groups, MAP_LAYOUT_OPTIONS.vertical)
  })()

  it('the frontier rect is the union of the nodes’ extents (world tags included); nothing to frame → undefined', () => {
    const ids = recommend(graph, defeated(...PRE, 'wall-of-flesh'), null).frontier!
    expect(frontierRect(graph, layout, ids)).toEqual(unionRect(ids.map((id) => nodeExtent(graph, layout.nodes.get(id)!))))
    const fork = ['eater-of-worlds', 'brain-of-cthulhu']
    expect(frontierRect(graph, layout, fork)).toEqual(unionRect(fork.map((id) => nodeExtent(graph, layout.nodes.get(id)!))))
    expect(frontierRect(graph, layout, undefined)).toBeUndefined()
    expect(frontierRect(graph, layout, ['not-a-node'])).toBeUndefined()
  })

  it('fresh: no frontier (the usual opening view); any mark: the next steps', () => {
    expect(recommend(graph, {}, 'corruption').frontier).toBeUndefined()
    expect(recommend(graph, defeated('king-slime'), null).frontier).toEqual(['eye-of-cthulhu'])
    expect(recommend(graph, defeated('eye-of-cthulhu', 'eater-of-worlds'), 'corruption').frontier).toEqual(['skeletron'])
  })
})
