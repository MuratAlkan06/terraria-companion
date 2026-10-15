/**
 * P3-S9 / P3-S10 render math (../summonVisuals.ts) and art (../art/arenaArt.ts): the whip's lash, the
 * tag marker, summons' instant-shot tracers, interpolated summon positions, and the per-class summon art.
 */
import { describe, expect, it } from 'vitest'
import { ART_PX_PER_TILE, buildSummon, buildTagIcon, GAME_PX_PER_ART_PX, type SummonArt } from './art/arenaArt'
import { A, ARENA_PALETTE } from './art/arenaPalette'
import {
  agentPosition,
  DESPAWN_MS,
  DESPAWN_RISE_TILES,
  despawnPose,
  despawnPuffCells,
  ShotTracers,
  STACK_SPREAD_TILES,
  STACK_STEP_TILES,
  stackOffsets,
  StackSpread,
  summonFocus,
  sweepOf,
  TAG_MARKER_LIFT_TILES,
  tagMarker,
  tagMarkerStyle,
  TRACER_MS,
  whipCells,
  WHIP_BOW,
} from './summonVisuals'

const px = GAME_PX_PER_ART_PX

describe('whip lash', () => {
  it('runs from the hand to its range along the angle, the tip its own cell, cells unique and on the art grid', () => {
    const hand = { x: 6, y: 4 }
    const length = 11 * 16
    const { line, tip } = whipCells(hand, 0, length, 1, px)
    expect(tip).toEqual([Math.floor((hand.x + length) / px) * px, Math.floor(hand.y / px) * px])
    expect(line[0]).toEqual([Math.floor(hand.x / px) * px, Math.floor(hand.y / px) * px])
    const keys = line.map(([x, y]) => `${x},${y}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).not.toContain(`${tip[0]},${tip[1]}`)
    for (const [x, y] of line) {
      expect(Math.abs(x % px)).toBe(0)
      expect(Math.abs(y % px)).toBe(0)
    }
  })

  it('bows behind the sweep: swinging down (angle growing) its middle trails above the straight line, and the reverse below', () => {
    const middleY = (sweep: 1 | -1) => {
      const { line } = whipCells({ x: 0, y: 0 }, 0, 200, sweep, px)
      const mid = line.filter(([x]) => Math.abs(x - 100) <= px)
      return mid.reduce((a, [, y]) => a + y, 0) / mid.length
    }
    expect(middleY(1)).toBeLessThan(-200 * WHIP_BOW * 0.5 * 0.9) // trails up (screen y down)
    expect(middleY(-1)).toBeGreaterThan(200 * WHIP_BOW * 0.5 * 0.9 - px)
    expect(sweepOf({ angle: 0.2, prevAngle: 0.1 })).toBe(1)
    expect(sweepOf({ angle: 0.1, prevAngle: 0.2 })).toBe(-1)
  })

  it('a zero length draws only its tip', () => {
    expect(whipCells({ x: 0, y: 0 }, 1, 0, 1, px)).toEqual({ line: [], tip: [0, 0] })
  })
})

describe('whip tag marker (PRD P3-S10 AC1)', () => {
  const dummy = { x: 6, y: 0, height: 3 }
  it('none without a tag; over the dummy’s head with the share of its time left', () => {
    expect(tagMarker({ ...dummy, tag: null })).toBeNull()
    expect(tagMarker({ ...dummy, tag: { remainingTicks: 60, durationTicks: 240, damageFlat: 4, critPct: null } })).toEqual({ x: 6, y: -1.5 - TAG_MARKER_LIFT_TILES, left: 0.25 })
    expect(tagMarker({ ...dummy, tag: { remainingTicks: 240, durationTicks: 240, damageFlat: 4, critPct: 10 } })?.left).toBe(1)
  })

  it('the dummy the summons attack keeps the FILLED tag, any other tagged dummy a HOLLOW one (design review M2: shape, not colour)', () => {
    const focus = summonFocus([{ targetId: 'dummy-2' }, { targetId: 'dummy-2' }, { targetId: null }])
    expect([...focus]).toEqual(['dummy-2'])
    expect(tagMarkerStyle('dummy-2', focus)).toBe('filled')
    expect(tagMarkerStyle('dummy-0', focus)).toBe('outline')
    // no summons attacking anything: no focus to show, every tag filled (as before)
    expect(tagMarkerStyle('dummy-0', summonFocus([]))).toBe('filled')
  })

  it('the hollow tag is the same shape as the filled one, lit only at its edge (dark inside)', () => {
    const filled = buildTagIcon()
    const hollow = buildTagIcon('outline')
    expect(hollow).toHaveLength(filled.length)
    hollow.forEach((row, y) => [...row].forEach((ch, x) => expect(ch === '.', `${x},${y}`).toBe(filled[y][x] === '.')))
    const lit = (rows: string[]) => rows.join('').split('').filter((ch) => ch === A.f300 || ch === A.f400 || ch === A.f500).length
    // the filled tag is mostly lit; the hollow one keeps only a one-pixel rim of it
    expect(lit(hollow)).toBeLessThan(lit(filled) * 0.75)
    for (const ch of hollow.join('')) if (ch !== '.') expect([A.f300, A.n950]).toContain(ch)
    expect(hollow.join('/')).not.toBe(filled.join('/'))
  })
})

describe('summons that share a spot (design review M5) and summons that leave (M1)', () => {
  const dummies = [
    { id: 'dummy-0', x: 6 },
    { id: 'dummy-1', x: 9 },
  ]
  /** A ground minion at the player's side of dummy-0 (x 6), `away` tiles out from x 4.5 (its engine lane). */
  const minion = (id: number, targetId: string | null, away = 0, aiClass: 'ground-melee' | 'ranged-shot' = 'ground-melee') => ({ id, kind: 'minion' as const, aiClass, targetId, x: 4.5 - away })
  const drawn = (agents: { id: number; x: number }[], offsets: Map<number, number>) => agents.map((a) => a.x + (offsets.get(a.id) ?? 0))

  it('minions of one class on one dummy step toward the player’s side, the nearest to the dummy unmoved; others are left alone', () => {
    const group = [minion(1, 'dummy-0', 0), minion(2, 'dummy-0', 0.3), minion(3, 'dummy-0', 0.6)]
    const offsets = stackOffsets([...group, minion(4, 'dummy-1'), minion(5, 'dummy-0', 0, 'ranged-shot'), minion(6, null)], dummies, 0)
    expect(offsets.get(1)).toBeUndefined()
    expect(offsets.get(2)).toBeCloseTo(-STACK_STEP_TILES)
    expect(offsets.get(3)).toBeCloseTo(-2 * STACK_STEP_TILES)
    // alone on its dummy, alone in its class, or with no target: drawn where the engine has it
    for (const id of [4, 5, 6]) expect(offsets.has(id)).toBe(false)
    // a dummy on the player's left: the steps go right (toward the player)
    expect(stackOffsets([{ ...minion(1, 'dummy-0'), x: -4.5 }, { ...minion(2, 'dummy-0'), x: -4.2 }], [{ id: 'dummy-0', x: -6 }], 0).get(2)).toBeCloseTo(STACK_STEP_TILES)
    // sentries never move from where they were placed
    expect(stackOffsets([{ ...minion(1, 'dummy-0'), kind: 'sentry' }, { ...minion(2, 'dummy-0'), kind: 'sentry' }], dummies, 0).size).toBe(0)
  })

  it('follows the engine’s lanes, not the summons’ age: after a replacement the newer minion may rest nearer the dummy — the gap only widens', () => {
    // the engine lanes summons by id (id 3 a lane out, id 4 back at the face): ordering by age would push 4 onto 3
    const group = [minion(3, 'dummy-0', 0.6), minion(4, 'dummy-0', 0)]
    const offsets = stackOffsets(group, dummies, 0)
    expect(offsets.get(4)).toBeUndefined()
    const [x3, x4] = drawn(group, offsets)
    expect(x4 - x3).toBeCloseTo(0.6 + STACK_STEP_TILES)
  })

  it('a big group stays within the spread: eleven minions over at most STACK_SPREAD_TILES, each in its own place', () => {
    const group = Array.from({ length: 11 }, (_, i) => minion(i + 1, 'dummy-0', 0.3 * (i % 3)))
    const offsets = stackOffsets(group, dummies, 0)
    expect(offsets.size).toBe(10)
    expect(Math.min(...offsets.values())).toBeCloseTo(-STACK_SPREAD_TILES)
    const xs = drawn(group, offsets).sort((a, b) => a - b)
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThan(0.1)
  })

  it('frame to frame: hops never reorder the fan (resting places are smoothed); a new place is slid to, or snapped to under reduced motion', () => {
    const spread = new StackSpread()
    // two minions hopping back from the face 1 tile, out of phase, a lane (0.3) apart
    const at = (frame: number) => [
      minion(1, 'dummy-0', 0 + Math.max(0, Math.sin(frame / 3))),
      minion(2, 'dummy-0', 0.3 + Math.max(0, Math.sin(frame / 3 + 2))),
    ]
    let last = new Map<number, number>()
    for (let f = 0; f < 200; f++) last = spread.update(at(f), dummies, 0, 16, false)
    for (let f = 200; f < 260; f++) {
      const offsets = spread.update(at(f), dummies, 0, 16, false)
      expect(offsets.get(1)).toBeUndefined()
      expect(offsets.get(2)).toBeCloseTo(-STACK_STEP_TILES)
      last = offsets
    }
    expect(last.size).toBe(1)
    // a third joins nearest the face: the others slide one step out over a few frames…
    const joined = () => [minion(1, 'dummy-0', 0.3), minion(2, 'dummy-0', 0.6), minion(7, 'dummy-0', 0)]
    const fresh = new StackSpread()
    fresh.update([minion(1, 'dummy-0', 0.3), minion(2, 'dummy-0', 0.6)], dummies, 0, 16, false)
    const sliding = fresh.update(joined(), dummies, 0, 16, false)
    expect(sliding.get(1)).toBeLessThan(0)
    expect(sliding.get(1)).toBeGreaterThan(-STACK_STEP_TILES)
    for (let f = 0; f < 60; f++) fresh.update(joined(), dummies, 0, 16, false)
    expect(fresh.update(joined(), dummies, 0, 16, false).get(1)).toBeCloseTo(-STACK_STEP_TILES)
    // …or at once under reduced motion
    const still = new StackSpread()
    still.update([minion(1, 'dummy-0', 0.3), minion(2, 'dummy-0', 0.6)], dummies, 0, 16, true)
    expect(still.update(joined(), dummies, 0, 16, true).get(1)).toBeCloseTo(-STACK_STEP_TILES)
    // a summon that left is forgotten
    expect(still.update([minion(1, 'dummy-0')], dummies, 0, 16, true).size).toBe(0)
  })

  it('a departing summon fades out over DESPAWN_MS, rising and shrinking a little — under reduced motion it only fades, in place', () => {
    expect(despawnPose(0, false)).toMatchObject({ alpha: 1, scale: 1 })
    expect(despawnPose(0, false)!.dy).toBeCloseTo(0)
    const mid = despawnPose(DESPAWN_MS / 2, false)!
    expect(mid.alpha).toBeCloseTo(0.5)
    expect(mid.dy).toBeCloseTo(-DESPAWN_RISE_TILES / 2)
    expect(mid.scale).toBeLessThan(1)
    expect(despawnPose(DESPAWN_MS / 2, true)).toEqual({ alpha: 0.5, dy: 0, scale: 1 })
    expect(despawnPose(DESPAWN_MS, false)).toBeNull()
    expect(despawnPose(-1, false)).toBeNull()
  })

  it('its puff: four art-pixel cells on the diagonals, moving out as it fades (not under reduced motion), gone after', () => {
    const at = { x: 100, y: 50 }
    const early = despawnPuffCells(at, 0, false, px, 5 * px, 10 * px)
    const late = despawnPuffCells(at, DESPAWN_MS * 0.9, false, px, 5 * px, 10 * px)
    expect(early).toHaveLength(4)
    for (const [x, y] of [...early, ...late]) {
      expect(Math.abs(x % px)).toBe(0)
      expect(Math.abs(y % px)).toBe(0)
    }
    const spread = (cells: [number, number][]) => Math.max(...cells.map(([x]) => x)) - Math.min(...cells.map(([x]) => x))
    expect(spread(late)).toBeGreaterThan(spread(early))
    expect(despawnPuffCells(at, DESPAWN_MS * 0.9, true, px, 5 * px, 10 * px)).toEqual(despawnPuffCells(at, 0, true, px, 5 * px, 10 * px))
    expect(despawnPuffCells(at, DESPAWN_MS, false, px, 5 * px, 10 * px)).toEqual([])
  })
})

describe('summons', () => {
  it('positions interpolate between the last two ticks', () => {
    const a = { prevX: 1, prevY: 2, x: 3, y: 6 }
    expect(agentPosition(a, 0)).toEqual({ x: 1, y: 2 })
    expect(agentPosition(a, 0.5)).toEqual({ x: 2, y: 4 })
    expect(agentPosition(a, 2)).toEqual({ x: 3, y: 6 })
  })

  it('instant-shot tracers fade over TRACER_MS, then go', () => {
    const t = new ShotTracers()
    t.add({ x: 0, y: -2 }, { x: 5, y: 0 }, 1000)
    expect(t.visuals(1000)).toEqual([{ from: { x: 0, y: -2 }, to: { x: 5, y: 0 }, alpha: 1 }])
    expect(t.visuals(1000 + TRACER_MS / 2)[0].alpha).toBeCloseTo(0.5)
    expect(t.visuals(1000 + TRACER_MS)).toEqual([])
    t.add({ x: 0, y: 0 }, { x: 1, y: 1 }, 2000)
    t.clear()
    expect(t.visuals(2000)).toEqual([])
  })

  it('each AI class (and the sentry) has its own original art, about a tile in size, in the arena palette only', () => {
    const arts: SummonArt[] = ['melee-contact', 'ground-melee', 'hover-strike', 'ranged-shot', 'sentry']
    const grids = arts.map((a) => buildSummon(a))
    expect(new Set(grids.map((g) => g.join('/'))).size).toBe(arts.length)
    for (const [i, rows] of grids.entries()) {
      const width = rows[0].length
      expect(rows.every((r) => r.length === width), arts[i]).toBe(true)
      expect(Math.max(width, rows.length), arts[i]).toBeLessThanOrEqual(2 * ART_PX_PER_TILE)
      for (const ch of rows.join('')) if (ch !== '.') expect(ARENA_PALETTE[ch], `${arts[i]} ${ch}`).toBeDefined()
    }
    const tag = buildTagIcon()
    for (const ch of tag.join('')) if (ch !== '.') expect(ARENA_PALETTE[ch]).toBeDefined()
  })

  it('the shooter, which hovers in the night sky, has a pale rim around its dark outline (design review M4)', () => {
    const rows = buildSummon('ranged-shot')
    const at = (x: number, y: number) => rows[y]?.[x] ?? '.'
    const edge: string[] = []
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch !== '.' && [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)].includes('.')) edge.push(ch)
    }))
    // every outermost pixel is the pale rim; the dark outline sits just inside it
    expect(new Set(edge)).toEqual(new Set([A.n200]))
    expect(rows.join('')).toContain(A.n950)
  })
})
