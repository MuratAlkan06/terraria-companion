/**
 * The Lab session's target (PRD P3-S6 AC1/AC2/AC4: Multiple Dummies, per-dummy hit counts, primary
 * target vs all dummies) and the attack time of weapons that come back to hand (P3-S7), on the
 * committed data with the Lab's setup. Weapons are picked from the data by their params, never by a
 * hand list; the engine is deterministic, so fixed seeds never flake.
 */
import { describe, expect, it } from 'vitest'
import type { Weapon } from '../data-access/types'
import { DEFAULT_LAB_SETTINGS, DUMMY_ROW_SPACING_TILES, TICKS_PER_SECOND, type SimEvent } from '../sim'
import { createLabSession, type LabSession } from './labSession'
import { DEFAULT_LAB_TARGET, DEFAULT_ROW_COUNT, labDummiesFor, RANGED_TARGET_X_TILES, ROW_COUNTS, type LabTarget } from './labSetup'
import { labWeapons } from './labWeapons'
import { ALL_WEAPONS, LAB_SETUP } from './testing/labData'

const list = labWeapons(ALL_WEAPONS, LAB_SETUP)
const params = (w: Weapon) => {
  if (w.labBehavior.kind !== 'archetype') throw new Error(`${w.name} has no params`)
  return w.labBehavior.params
}
const FRAME_MS = 1000 / 60
const row = (count: number): LabTarget => ({ kind: 'row', count })

function session(weapon: Weapon, target?: LabTarget): LabSession {
  let seed = 11
  const created = createLabSession(weapon, { seed: () => seed++, setup: LAB_SETUP, ...(target ? { target } : {}) })
  if (!created.ok) throw new Error(`${weapon.name} refused: ${created.refusal.message}`)
  return created.session
}

/** Hold Space for `ticks` 60 fps frames; returns the events. */
function hold(s: LabSession, ticks: number): SimEvent[] {
  const events: SimEvent[] = []
  s.press('key')
  for (let i = 0; i < ticks; i++) events.push(...s.frame(FRAME_MS).events)
  s.release('key')
  return events
}
function idle(s: LabSession, ticks: number): SimEvent[] {
  const events: SimEvent[] = []
  for (let i = 0; i < ticks; i++) events.push(...s.frame(FRAME_MS).events)
  return events
}

/** A committed pierce-1 magic bolt (the data's Diamond / Frost Staff shape), no DoT. */
const pierceStaff = list.find((w) => {
  const p = params(w)
  return p.archetype === 'magic-bolt' && p.projectile.pierce === 1 && w.labBehavior.kind === 'archetype' && !w.labBehavior.modifiers?.dot
})!
const variant = (v: 'boomerang' | 'flail' | 'yoyo') =>
  list
    .filter((w) => {
      const p = params(w)
      return p.archetype === 'returning' && p.variant === v && !(w.labBehavior.kind === 'archetype' && w.labBehavior.modifiers)
    })
    .sort((a, b) => (a.damage ?? 0) - (b.damage ?? 0) || a.id - b.id)[0]

describe('Multiple Dummies (P3-S6 AC1): a configurable row the session swaps in', () => {
  it('the data has what this slice needs: a pierce-1 bolt, and every returning variant (no modifiers) equips', () => {
    expect(pierceStaff).toBeDefined()
    for (const v of ['boomerang', 'flail', 'yoyo'] as const) expect(variant(v), v).toBeDefined()
  })

  it('offers 2–5 dummies, 3 to start; the row starts where the single dummy stands, DUMMY_ROW_SPACING_TILES apart', () => {
    expect(ROW_COUNTS).toEqual([2, 3, 4, 5])
    expect(DEFAULT_ROW_COUNT).toBe(3)
    expect(labDummiesFor('magic-bolt', row(3)).map((d) => d.x)).toEqual([0, 1, 2].map((i) => RANGED_TARGET_X_TILES + i * DUMMY_ROW_SPACING_TILES))
    expect(labDummiesFor('swing-melee', row(2)).map((d) => d.x)).toEqual([2, 2 + DUMMY_ROW_SPACING_TILES])
  })

  it('setTarget swaps the engine’s dummies and starts the stats over; the HUD reports every dummy, the first as primary', () => {
    const s = session(pierceStaff)
    hold(s, 60)
    expect(s.getHud().hits).toBeGreaterThan(0)
    expect(s.getHud()).toMatchObject({ target: DEFAULT_LAB_TARGET, targets: null })
    let resets = 0
    s.onReset(() => resets++)
    expect(s.setTarget(row(4))).toBe(true)
    expect(resets).toBe(1)
    expect(s.sim.renderState().dummies.map((d) => d.id)).toEqual(['dummy-0', 'dummy-1', 'dummy-2', 'dummy-3'])
    const hud = s.getHud()
    expect(hud.hits).toBe(0)
    expect(hud.target).toEqual(row(4))
    expect(hud.targets?.dummies.map((d) => [d.number, d.primary, d.hits])).toEqual([[1, true, 0], [2, false, 0], [3, false, 0], [4, false, 0]])
    expect(hud.targets?.primary.id).toBe('dummy-0')
    // a target the Lab doesn't offer is refused; the same target is a no-op
    expect(s.setTarget(row(9))).toBe(false)
    expect(s.setTarget(row(4))).toBe(true)
    expect(resets).toBe(1)
  })

  it('AC2: a piercing bolt hits up to 1 + pierce dummies per shot — per-dummy hit counts in the HUD', () => {
    const s = session(pierceStaff, row(3))
    hold(s, 240)
    idle(s, 120) // the last bolts land
    const { targets, hits, totalDamage, settings } = s.getHud()
    expect(settings).toEqual(DEFAULT_LAB_SETTINGS)
    const counts = targets!.dummies.map((d) => d.hits)
    expect(counts[0]).toBeGreaterThan(0)
    expect(counts).toEqual([counts[0], counts[0], 0]) // pierce 1: the first two, never the third
    expect(counts.reduce((a, b) => a + b, 0)).toBe(hits)
    expect(targets!.dummies.reduce((a, d) => a + d.damage, 0)).toBe(totalDamage)
  })

  it('AC4: the primary target’s est. DPS is reported apart from all dummies’ (same attack time)', () => {
    const s = session(pierceStaff, row(3))
    hold(s, 240)
    const hud = s.getHud()
    const primary = hud.targets!.primary
    expect(primary.estimatedDps).toBeCloseTo(primary.damage / hud.attackSeconds, 9)
    expect(hud.estimatedDps).toBeCloseTo(hud.totalDamage / hud.attackSeconds, 9)
    expect(hud.estimatedDps).toBeGreaterThan(primary.estimatedDps)
  })

  it('the timed test runs on the row and reports per-dummy totals; the target can’t change while it runs', () => {
    const s = session(pierceStaff, row(2))
    expect(s.startTimedTest(10)).toBe(true)
    expect(s.setTarget(DEFAULT_LAB_TARGET)).toBe(false)
    idle(s, 600)
    const result = s.getHud().timedTest.result!
    expect(Object.keys(result.perDummy)).toEqual(['dummy-0', 'dummy-1'])
    expect(result.perDummy['dummy-0'].hits).toBeGreaterThan(0)
    // "Run again" replays the same row
    expect(s.runAgain()).toBe(true)
    idle(s, 600)
    expect(s.getHud().timedTest.result).toEqual(result)
  })

  it('the single Reset restores the Infinite Dummy (with the stats and the default settings)', () => {
    const s = session(pierceStaff, row(5))
    hold(s, 60)
    s.reset()
    expect(s.sim.renderState().dummies).toHaveLength(1)
    expect(s.getHud()).toMatchObject({ target: DEFAULT_LAB_TARGET, targets: null, hits: 0, settings: DEFAULT_LAB_SETTINGS })
  })

  it('a row lists its Lab assumption with the modeling choices; the single dummy does not', () => {
    const s = session(pierceStaff)
    expect(s.assumptions.map((a) => a.id)).not.toContain('target-row')
    s.setTarget(row(3))
    const ids = s.assumptions.map((a) => a.id)
    expect(ids).toContain('target-row')
    expect(ids.indexOf('target-row')).toBeLessThan(ids.indexOf('dps-while-attacking'))
  })
})

describe('weapons that come back to hand (P3-S7): an attack lasts until the weapon is back', () => {
  it('boomerang: the attack time and the attack rate follow each throw until the catch', () => {
    const boomerang = variant('boomerang')
    const s = session(boomerang)
    expect(s.returning).toMatchObject({ variant: 'boomerang', throwRangeTiles: expect.any(Number) })
    const events = hold(s, 600)
    const starts = events.filter((e) => e.type === 'use-start').map((e) => e.tick)
    const caught = events.flatMap((e) => (e.type === 'projectile-despawn' && e.reason === 'returned' ? [e.tick] : []))
    expect(caught.length).toBeGreaterThan(2)
    // each throw starts the tick after the previous catch (or after its use time, if that is longer)
    const cadence = s.summary.cadenceTicks
    for (let i = 1; i < starts.length; i++) expect(starts[i], `throw ${i}`).toBe(Math.max(starts[i - 1] + cadence, caught[i - 1] + 1))
    // attack time: the whole span of throws (held throughout), so est. DPS = damage over that time
    idle(s, 120) // the last throw comes back
    const hud = s.getHud()
    expect(hud.attackSeconds * TICKS_PER_SECOND).toBeGreaterThanOrEqual(caught.at(-1)! + 1)
    expect(hud.attacksPerSec).toBeLessThanOrEqual(TICKS_PER_SECOND / cadence + 1e-9)
    expect(s.assumptions.map((a) => a.id)).toEqual(expect.arrayContaining(['attack-until-back', 'boomerang-flight']))
  })

  it('yoyo: held out for 5 s is ONE attack lasting 5 s (plus its way back); est. DPS divides by it', () => {
    const yoyo = variant('yoyo')
    const s = session(yoyo)
    const events = hold(s, 300)
    expect(events.filter((e) => e.type === 'use-start')).toHaveLength(1)
    expect(s.getHud().attackSeconds).toBeCloseTo(5, 1) // grows while it is out, a tenth of a second at a time
    const back = idle(s, 120)
    const caughtAt = back.find((e) => e.type === 'projectile-despawn' && e.reason === 'returned')!.tick
    const hud = s.getHud()
    expect(hud.attackSeconds * TICKS_PER_SECOND).toBe(caughtAt + 1) // from the throw (tick 0) to the catch
    expect(hud.estimatedDps).toBeCloseTo(hud.totalDamage / hud.attackSeconds, 9)
    expect(hud.attacksPerSec).toBeCloseTo(TICKS_PER_SECOND / (caughtAt + 1), 9)
    // the yoyo re-hits the primary dummy every 10 ticks while it dwells there (wiki: up to 6 hits per second)
    expect(hud.hits).toBeGreaterThanOrEqual(25)
  })

  it('yoyo: the HUD’s rate is hits/sec while it is out — hits over the same attack time as est. DPS — not ~0.2 attacks/sec', () => {
    const s = session(variant('yoyo'))
    expect(s.tethered).toBe(true)
    expect(s.getHud()).toMatchObject({ rateReadout: 'hits', hitsPerSec: 0 }) // no attack time yet
    hold(s, 300)
    const out = s.getHud() // still out: the readout is live while it is held
    expect(out.hitsPerSec).toBeCloseTo(out.hits / out.attackSeconds, 9)
    expect(out.attacksPerSec).toBeLessThan(0.25) // the misleading figure the readout replaced
    expect(out.hitsPerSec).toBeGreaterThan(4.5)
    // one dummy is hit at most once per 10 ticks: at most ⌊attack ticks ÷ 10⌋ + 1 hits
    expect(out.hits).toBeLessThanOrEqual(Math.floor((out.attackSeconds * TICKS_PER_SECOND) / 10) + 1)
    idle(s, 120)
    const back = s.getHud()
    expect(back.hitsPerSec).toBeCloseTo(back.hits / back.attackSeconds, 9)
    // weapons that aren't tethered keep attacks/sec
    for (const v of ['boomerang', 'flail'] as const) {
      const other = session(variant(v))
      expect(other.tethered, v).toBe(false)
      expect(other.getHud().rateReadout, v).toBe('attacks')
    }
    expect(session(pierceStaff).getHud().rateReadout).toBe('attacks')
  })

  it('launched flail: strikes the nearest dummy of a row and comes back; the dummies behind are never hit', () => {
    const s = session(variant('flail'), row(3))
    hold(s, 300)
    idle(s, 60)
    const counts = s.getHud().targets!.dummies.map((d) => d.hits)
    expect(counts[0]).toBeGreaterThan(0)
    expect(counts.slice(1)).toEqual([0, 0])
  })
})
