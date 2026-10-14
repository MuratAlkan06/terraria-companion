/**
 * The Lab session headless (PRD P3-S1 AC2–AC5): input → swings → hits → live HUD numbers, instant
 * reset, data-driven differences between broadswords, and crit rates. Real committed weapons,
 * fixed seeds (the engine is deterministic, so these never flake).
 */
import { describe, expect, it } from 'vitest'
import { hasAssumptions } from '../components/assumptions'
import type { Weapon } from '../data-access/types'
import weaponsJson from '../data/weapons.detail.json'
import { APPROXIMATIONS, cadenceTicksFor, TICKS_PER_SECOND, type SimEvent } from '../sim'
import { floatPose } from './floatingNumbers'
import { createLabSession, type LabSession } from './labSession'
import { defaultLabWeapon, labWeapons } from './labWeapons'
import { LAB_SETUP } from './testing/labData'

const weapons = labWeapons(weaponsJson as Weapon[], LAB_SETUP)
/** The swung weapons among them (thrust weapons light up as their data lands — they have no arc). */
const swords = weapons.filter((w) => w.labBehavior.kind === 'archetype' && w.labBehavior.params.archetype === 'swing-melee')
const FRAME_MS = 1000 / 60

function session(weapon: Weapon, seed = 7): LabSession {
  let s = seed
  const created = createLabSession(weapon, { seed: () => s++, setup: LAB_SETUP })
  if (!created.ok) throw new Error(`${weapon.name} refused: ${created.refusal.message}`)
  return created.session
}

type Damage = Extract<SimEvent, { type: 'damage' }>

/** Holds Space for `seconds` of 60 fps frames (or bigger steps), then releases; returns all events. */
function hold(s: LabSession, seconds: number, frameMs = FRAME_MS): SimEvent[] {
  const events: SimEvent[] = []
  s.press('key')
  for (let t = 0; t < seconds * 1000 - 1e-6; t += frameMs) events.push(...s.frame(frameMs).events)
  s.release('key')
  return events
}

const damages = (events: SimEvent[]) => events.filter((e): e is Damage => e.type === 'damage')
const uses = (events: SimEvent[]) => events.filter((e) => e.type === 'use-start')
const swingParams = (w: Weapon) => {
  if (w.labBehavior.kind !== 'archetype' || w.labBehavior.params.archetype !== 'swing-melee') throw new Error('not a swing')
  return w.labBehavior.params
}

describe('AC2 + AC3: swings hit the dummy; the HUD updates live', () => {
  const sword = defaultLabWeapon(swords)!

  it('holding attack swings at the weapon’s cadence; every hit is in the HUD (per-hit, total, hits)', () => {
    const s = session(sword)
    const updates: number[] = []
    s.subscribe(() => updates.push(s.getHud().totalDamage))
    const events = hold(s, 3)
    const hits = damages(events)
    const cadence = cadenceTicksFor(sword, sword.useAnimationTicks!)
    expect(uses(events).length).toBeGreaterThanOrEqual(Math.floor((3 * TICKS_PER_SECOND) / cadence))
    expect(uses(events).length).toBeLessThanOrEqual(Math.ceil((3 * TICKS_PER_SECOND) / cadence) + 1)
    expect(hits.length).toBeGreaterThan(0)
    const hud = s.getHud()
    expect(hud.hits).toBe(hits.length)
    expect(hud.totalDamage).toBe(hits.reduce((sum, e) => sum + e.amount, 0))
    expect(hud.crits).toBe(hits.filter((e) => e.crit).length)
    expect(hud.lastHit).toEqual({ amount: hits.at(-1)!.amount, crit: hits.at(-1)!.crit })
    // Live: subscribers saw the total grow hit by hit, not only at the end.
    expect(new Set(updates).size).toBeGreaterThan(2)
    // Every hit lands on the dummy box (floating numbers spawn at the impact point).
    const dummy = s.sim.renderState().dummies[0]
    for (const e of hits) {
      expect(Math.abs(e.x - dummy.x)).toBeLessThanOrEqual(dummy.width / 2 + 1e-9)
      expect(Math.abs(e.y - dummy.y)).toBeLessThanOrEqual(dummy.height / 2 + 1e-9)
    }
  })

  it('attacks/sec is the weapon’s rate; est. DPS = total ÷ time spent attacking', () => {
    const s = session(sword)
    const events = hold(s, 2)
    const hud = s.getHud()
    expect(hud.attacksPerSec).toBeCloseTo(TICKS_PER_SECOND / cadenceTicksFor(sword, sword.useAnimationTicks!), 9)
    // Whole attack cycles: each use time + the weapon's cooldown (none for this sword).
    const busy = uses(events).reduce((sum, e) => sum + (e.type === 'use-start' ? e.durationTicks + s.summary.reuseDelayTicks : 0), 0) / TICKS_PER_SECOND
    expect(hud.attackSeconds).toBeCloseTo(busy, 9)
    expect(hud.estimatedDps).toBeCloseTo(hud.totalDamage / busy, 9)
  })

  it('a click shorter than one tick still swings exactly once (press is latched)', () => {
    const s = session(sword)
    s.press('pointer', { x: 2, y: 0 })
    s.release('pointer')
    const events: SimEvent[] = []
    for (let i = 0; i < 120; i++) events.push(...s.frame(FRAME_MS).events)
    expect(uses(events)).toHaveLength(1)
    expect(damages(events)).toHaveLength(1)
  })

  it('releasing (or losing focus) stops attacking', () => {
    const s = session(sword)
    s.press('pointer', { x: 2, y: 0 })
    s.press('key')
    for (let i = 0; i < 30; i++) s.frame(FRAME_MS)
    s.releaseAll()
    for (let i = 0; i < 60; i++) s.frame(FRAME_MS)
    const after = s.getHud().hits
    for (let i = 0; i < 120; i++) s.frame(FRAME_MS)
    expect(s.getHud().hits).toBe(after)
  })

  it('aiming left of the player swings left and misses the dummy (the swing follows the pointer side)', () => {
    const s = session(sword)
    s.press('pointer', { x: -3, y: 0 })
    const events: SimEvent[] = []
    for (let i = 0; i < 90; i++) events.push(...s.frame(FRAME_MS).events)
    expect(uses(events).length).toBeGreaterThan(0)
    expect(damages(events)).toHaveLength(0)
    expect(s.sim.renderState().facing).toBe(-1)
  })

  it('Reset zeroes every stat instantly, restores the sim and tells the renderer', () => {
    const s = session(sword)
    hold(s, 2)
    expect(s.getHud().hits).toBeGreaterThan(0)
    let rendererCleared = 0
    let published = 0
    s.onReset(() => rendererCleared++)
    s.subscribe(() => published++)
    s.reset()
    expect(s.getHud()).toMatchObject({ lastHit: null, totalDamage: 0, hits: 0, crits: 0, estimatedDps: 0, attackSeconds: 0, resets: 1 })
    expect(s.sim.snapshot().stats).toMatchObject({ totalDamage: 0, hits: 0, crits: 0 })
    expect(s.sim.renderState().blade).toBeNull()
    expect(rendererCleared).toBe(1)
    expect(published).toBe(1)
    // ...and the Lab keeps working afterwards.
    expect(damages(hold(s, 1)).length).toBeGreaterThan(0)
  })
})

describe('AC4: two broadswords differ in arc, speed and damage — from data params, not per-weapon code', () => {
  it('every equippable sword’s swing, rate and damage come straight from its record', () => {
    for (const w of swords) {
      const s = session(w)
      expect(s.swing, w.name).toEqual({ arcDegrees: swingParams(w).arcDegrees, reachTiles: swingParams(w).reachTiles })
      expect(s.reachTiles).toBe(swingParams(w).reachTiles)
      expect(s.summary.damage).toBe(w.damage)
      expect(s.summary.nominalAttacksPerSec).toBeCloseTo(TICKS_PER_SECOND / cadenceTicksFor(w, w.useAnimationTicks!), 9)
    }
  })

  // The shortest- and longest-reach swords in the data (whatever they are).
  const byReach = [...swords].sort((a, b) => swingParams(a).reachTiles - swingParams(b).reachTiles)
  const [short, long] = [byReach[0], byReach.at(-1)!]

  it('the rendered blade sweeps the record’s arc at the record’s reach', () => {
    for (const w of [short, long]) {
      const s = session(w)
      s.press('key')
      const angles: number[] = []
      const cadence = cadenceTicksFor(w, w.useAnimationTicks!)
      for (let i = 0; i < cadence; i++) {
        s.frame(FRAME_MS)
        const blade = s.sim.renderState().blade
        expect(blade?.kind).toBe('swing')
        expect(blade!.length).toBe(swingParams(w).reachTiles)
        angles.push(blade!.prevAngle, blade!.angle)
      }
      const span = Math.max(...angles) - Math.min(...angles)
      expect(span).toBeCloseTo((swingParams(w).arcDegrees * Math.PI) / 180, 6)
    }
  })

  it('observably different: reach, attacks/sec and damage per hit', () => {
    expect(swingParams(long).reachTiles).toBeGreaterThan(swingParams(short).reachTiles + 1)
    const a = session(short)
    const b = session(long)
    // Direct hits only: a sword that inflicts a debuff also deals damage-over-time ticks, which are not hits.
    const hitsA = damages(hold(a, 6)).filter((e) => e.source !== 'dot')
    const hitsB = damages(hold(b, 6)).filter((e) => e.source !== 'dot')
    // Speed: one hit per swing, swings at each weapon's own cadence (±1 partial swing at the end).
    expect(a.summary.cadenceTicks).not.toBe(b.summary.cadenceTicks)
    for (const [s, hits] of [[a, hitsA], [b, hitsB]] as const) {
      expect(Math.abs(hits.length - (6 * TICKS_PER_SECOND) / s.summary.cadenceTicks)).toBeLessThanOrEqual(1)
    }
    // Damage: each mean non-crit hit sits within ±15% variance of its own base damage.
    for (const [s, hits] of [[a, hitsA], [b, hitsB]] as const) {
      const normal = hits.filter((e) => !e.crit).map((e) => e.amount)
      const mean = normal.reduce((x, y) => x + y, 0) / normal.length
      expect(mean).toBeGreaterThanOrEqual(s.summary.damage * 0.85)
      expect(mean).toBeLessThanOrEqual(s.summary.damage * 1.15)
    }
    if (short.damage !== long.damage) expect(a.getHud().totalDamage / a.getHud().hits).not.toBeCloseTo(b.getHud().totalDamage / b.getHud().hits, 0)
  })
})

describe('AC5: crits roll at the weapon’s crit chance and look distinct', () => {
  const byCrit = [...weapons].sort((a, b) => (a.critPct ?? 0) - (b.critPct ?? 0))

  it.each([
    ['lowest crit chance', byCrit[0]],
    ['highest crit chance', byCrit.at(-1)!],
  ])('%s: observed crit rate ≈ 4% base + the weapon’s crit', (_label, weapon) => {
    const s = session(weapon, 1234)
    // Direct hits only: damage-over-time ticks never crit and are not hits.
    const hits = damages(hold(s, 900, 250)).filter((e) => e.source !== 'dot') // big frames: the engine runs whole ticks, results unchanged
    const expected = (4 + (weapon.critPct ?? 0)) / 100
    expect(s.summary.critChancePct / 100).toBeCloseTo(expected, 9)
    expect(hits.length).toBeGreaterThan(2000)
    const rate = hits.filter((e) => e.crit).length / hits.length
    // ±4 standard deviations of a binomial proportion.
    expect(Math.abs(rate - expected)).toBeLessThan(4 * Math.sqrt((expected * (1 - expected)) / hits.length))
    // A crit is ×2 after variance, so every crit outnumbers every normal hit (distinct by value too).
    const crits = hits.filter((e) => e.crit).map((e) => e.amount)
    const normal = hits.filter((e) => !e.crit).map((e) => e.amount)
    expect(Math.min(...crits)).toBeGreaterThan(Math.max(...normal))
  })

  it('crit floating numbers render larger (size + outline font), and the HUD flags the crit', () => {
    expect(floatPose(0, true, false)!.scale).toBeGreaterThan(floatPose(0, false, false)!.scale)
    const weapon = byCrit.at(-1)!
    const s = session(weapon, 99)
    s.press('key')
    for (let i = 0; i < 6000; i++) {
      const crit = damages(s.frame(FRAME_MS).events).find((e) => e.crit)
      if (crit) {
        expect(s.getHud().lastHit).toEqual({ amount: crit.amount, crit: true })
        return
      }
    }
    expect.fail('no crit in 100 s of swinging')
  })
})

describe('honesty: every estimate has a populated AssumptionsTip (UX_SPEC §8)', () => {
  it('lists the Lab’s modeling choices first, then every engine approximation verbatim (the attack-rate rule included)', () => {
    const s = session(swords[0])
    expect(hasAssumptions(s.assumptions)).toBe(true)
    const ids = s.assumptions.map((a) => a.id)
    expect(ids.slice(0, 2)).toEqual(['swing-reach-arc', 'dps-while-attacking'])
    for (const a of s.sim.approximations) expect(s.assumptions).toContainEqual(a)
    expect(s.assumptions.find((a) => a.id === 'cadence')).toEqual(APPROXIMATIONS.cadence)
    expect(new Set(ids).size).toBe(ids.length)
    for (const a of s.assumptions) {
      expect(a.title.length).toBeGreaterThan(0)
      expect(a.detail.length).toBeGreaterThan(20)
    }
    // B44/B49: the swing geometry is labeled as a modeling choice, never as game data.
    expect(s.assumptions[0].detail).toMatch(/modeling choices, not game data/)
  })

  it('thrust reach: labeled modeled only when the record lists it (B46); a wiki-stated range is cited instead (AMENDMENTS-012 B56)', () => {
    const thrusts = weapons.filter((w) => w.labBehavior.kind === 'archetype' && w.labBehavior.params.archetype === 'thrust')
    const isModeled = (w: Weapon) => (w._prov.modeledFields ?? []).includes('labBehavior.params.reachTiles')
    const stated = thrusts.filter((w) => !isModeled(w))
    // The nine plain spears B56 names state their range; at least one thrust weapon still uses the formula.
    const B56 = ['Adamantite Glaive', 'Cobalt Naginata', 'Mythril Halberd', 'Orichalcum Halberd', 'Palladium Pike', 'Titanium Trident', 'Spear', 'Trident', 'Swordfish']
    expect(stated.map((w) => w.name)).toEqual(expect.arrayContaining(B56))
    expect(thrusts.some(isModeled)).toBe(true)
    for (const w of thrusts) {
      const { assumptions } = session(w)
      const ids = assumptions.map((a) => a.id)
      expect(new Set(ids).size, w.name).toBe(ids.length)
      // Exactly one reach line, heading the list.
      expect(ids.filter((id) => id.startsWith('thrust-reach')), w.name).toEqual([ids[0]])
      if (isModeled(w)) {
        expect(assumptions[0], w.name).toEqual(APPROXIMATIONS['thrust-reach'])
      } else {
        expect(ids, w.name).not.toContain('thrust-reach')
        for (const a of assumptions) expect(a.detail, w.name).not.toMatch(/no thrust reach/)
        const reach = w.labBehavior.kind === 'archetype' && w.labBehavior.params.archetype === 'thrust' ? w.labBehavior.params.reachTiles : NaN
        expect(assumptions[0], w.name).toEqual({
          id: 'thrust-reach-stated',
          title: 'Thrust reach is the wiki’s stated range',
          detail: `The wiki gives this weapon a maximum range of approximately ${reach} tiles; the Lab’s thrust reaches that far.`,
          sourceUrl: w.wikiUrl,
        })
      }
    }
  })
})
