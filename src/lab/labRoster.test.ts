/**
 * The dummy roster v2 in the Lab session (PRD P3-S12 AC1–AC4) on the committed data with the Lab's setup:
 * the Boss-Sized, Moving and Armored targets — their values, placement, validation, the HUD they drive
 * (the Moving Dummy's shots), their assumptions, the verified boss-defense picks — and switching targets
 * mid-session. Weapons are picked from the data by their params, never by a hand list; fixed seeds.
 */
import { describe, expect, it } from 'vitest'
import type { Weapon } from '../data-access/types'
import { DEFAULT_LAB_SETTINGS, GROUND_Y_TILES, type SimEvent } from '../sim'
import { targetAssumption } from './labAssumptions'
import { bossDefenses, namedBoss } from './labBossDefense'
import { createLabSession, type LabSession } from './labSession'
import {
  ARMORED_DEFENSE_RANGE,
  BOSS_SCALES,
  DEFAULT_ARMORED_DEFENSE,
  DEFAULT_BOSS_SCALE,
  DEFAULT_LAB_TARGET,
  DEFAULT_MOVING_SPEED,
  isLabTarget,
  LAB_TARGET_KINDS,
  labDummiesFor,
  MOVING_PATH_TILES,
  MOVING_SPEED_RANGE,
  RANGED_TARGET_X_TILES,
  sameTarget,
  type LabTarget,
} from './labSetup'
import { labWeapons } from './labWeapons'
import { ALL_BOSSES, ALL_WEAPONS, LAB_SETUP } from './testing/labData'

const list = labWeapons(ALL_WEAPONS, LAB_SETUP)
const params = (w: Weapon) => (w.labBehavior.kind === 'archetype' ? w.labBehavior.params : null)
const plain = (w: Weapon) => !(w.labBehavior.kind === 'archetype' && w.labBehavior.modifiers)
const pick = (test: (w: Weapon) => boolean) => list.filter(test).sort((a, b) => (a.damage ?? 0) - (b.damage ?? 0) || a.id - b.id)[0]
const FRAME_MS = 1000 / 60
const PICKS = bossDefenses(ALL_BOSSES)

/** A committed spread gun (several pellets fanned over an angle). */
const spreadGun = pick((w) => {
  const p = params(w)
  return p?.archetype === 'bow-gun' && p.projectilesPerUse > 1 && p.spreadDegrees > 0
})
/** A committed bow or gun firing one straight shot, no modifiers. */
const plainGun = pick((w) => {
  const p = params(w)
  return p?.archetype === 'bow-gun' && p.projectilesPerUse === 1 && p.spreadDegrees === 0 && plain(w)
})
/** A committed broadsword, no modifiers. */
const sword = pick((w) => params(w)?.archetype === 'swing-melee' && plain(w))

const boss = (scale: number): LabTarget => ({ kind: 'boss', scale })
const moving = (axis: 'horizontal' | 'vertical', speedTps: number): LabTarget => ({ kind: 'moving', axis, speedTps })
const armored = (defense: number, bossId: string | null = null): LabTarget => ({ kind: 'armored', defense, bossId })

function session(weapon: Weapon, target?: LabTarget, seedStart = 31): LabSession {
  let seed = seedStart
  const created = createLabSession(weapon, { seed: () => seed++, setup: LAB_SETUP, bossDefenses: PICKS, ...(target ? { target } : {}) })
  if (!created.ok) throw new Error(`${weapon.name} refused: ${created.refusal.message}`)
  return created.session
}

function hold(s: LabSession, ticks: number, frameMs = FRAME_MS): SimEvent[] {
  const events: SimEvent[] = []
  s.press('key')
  for (let i = 0; i < ticks; i++) events.push(...s.frame(frameMs).events)
  s.release('key')
  return events
}

function timed(s: LabSession, frames: () => number = () => FRAME_MS) {
  expect(s.startTimedTest(10)).toBe(true)
  let guard = 0
  while (s.getHud().timedTest.status === 'running') {
    s.frame(frames())
    if (++guard > 10_000) throw new Error('test did not finish')
  }
  return s.getHud().timedTest.result!
}

describe('the roster (UX_SPEC §3.4 picker): six targets, each with its own honest values', () => {
  it('the data has what this slice needs: a spread gun, a single-shot gun, a sword', () => {
    expect(spreadGun).toBeDefined()
    expect(plainGun).toBeDefined()
    expect(sword).toBeDefined()
  })

  it('picker order is the spec’s: Infinite / Boss-Sized / Moving / Multiple / Armored / Debuff', () => {
    expect(LAB_TARGET_KINDS).toEqual(['single', 'boss', 'moving', 'row', 'armored', 'debuff'])
  })

  it('only values from each target’s own ranges are offered', () => {
    for (const scale of BOSS_SCALES) expect(isLabTarget(boss(scale))).toBe(true)
    for (const bad of [1, 5, 2.5]) expect(isLabTarget(boss(bad)), `scale ${bad}`).toBe(false)
    expect(isLabTarget(moving('horizontal', MOVING_SPEED_RANGE.min))).toBe(true)
    expect(isLabTarget(moving('vertical', MOVING_SPEED_RANGE.max))).toBe(true)
    for (const bad of [0, MOVING_SPEED_RANGE.max + 1, 3.5]) expect(isLabTarget(moving('vertical', bad)), `speed ${bad}`).toBe(false)
    expect(isLabTarget({ kind: 'moving', axis: 'diagonal', speedTps: 4 } as unknown as LabTarget)).toBe(false)
    expect(isLabTarget(armored(ARMORED_DEFENSE_RANGE.min))).toBe(true)
    expect(isLabTarget(armored(ARMORED_DEFENSE_RANGE.max, 'plantera'))).toBe(true)
    for (const bad of [-1, ARMORED_DEFENSE_RANGE.max + 1, 7.5]) expect(isLabTarget(armored(bad)), `defense ${bad}`).toBe(false)
    expect([DEFAULT_BOSS_SCALE, DEFAULT_MOVING_SPEED, DEFAULT_ARMORED_DEFENSE]).toEqual([3, 4, 20])
  })

  it('a changed value is a new target; the same values are the same target', () => {
    expect(sameTarget(boss(3), boss(3))).toBe(true)
    expect(sameTarget(boss(3), boss(4))).toBe(false)
    expect(sameTarget(moving('horizontal', 4), moving('vertical', 4))).toBe(false)
    expect(sameTarget(moving('horizontal', 4), moving('horizontal', 5))).toBe(false)
    expect(sameTarget(armored(36), armored(36, 'plantera'))).toBe(false)
    expect(sameTarget(armored(36, 'plantera'), armored(36, 'plantera'))).toBe(true)
    expect(sameTarget(boss(3), DEFAULT_LAB_TARGET)).toBe(false)
  })

  it('placement: Boss-Sized keeps the near face and the feet; Moving starts where the dummy stands; Armored stands there with its defense', () => {
    for (const [archetype, x] of [['swing-melee', 2], ['bow-gun', RANGED_TARGET_X_TILES]] as const) {
      for (const scale of BOSS_SCALES) {
        const [d] = labDummiesFor(archetype, boss(scale))
        expect(d.widthTiles).toBe(2 * scale)
        expect(d.heightTiles).toBe(3 * scale)
        expect(d.x - d.widthTiles! / 2).toBe(x - 1) // the Infinite Dummy's near face
        expect(d.y + d.heightTiles! / 2).toBe(GROUND_Y_TILES) // feet on the ground
      }
      expect(labDummiesFor(archetype, moving('vertical', 7))).toEqual([{ id: 'dummy-0', x, y: 0, motion: { axis: 'vertical', speedTps: 7, rangeTiles: MOVING_PATH_TILES.vertical } }])
      expect(labDummiesFor(archetype, armored(33))).toEqual([{ id: 'dummy-0', x, y: 0, defense: 33 }])
    }
  })
})

describe('Boss-Sized Dummy (AC1): a spread gun lands more of its pellets on it than on the Infinite Dummy', () => {
  it('same seed, same ammo: more hits and more damage over a 10 s test', () => {
    const standard = timed(session(spreadGun))
    const big = timed(session(spreadGun, boss(DEFAULT_BOSS_SCALE)))
    expect(big.ammoConsumed).toBe(standard.ammoConsumed)
    expect(big.hits).toBeGreaterThan(standard.hits)
    expect(big.totalDamage).toBeGreaterThan(standard.totalDamage)
    // the bigger the box, the more of the fan it takes (never fewer)
    const hits = BOSS_SCALES.map((scale) => timed(session(spreadGun, boss(scale))).hits)
    for (let i = 1; i < hits.length; i++) expect(hits[i]).toBeGreaterThanOrEqual(hits[i - 1])
  })

  it('its assumption names the test size (not any boss’s hitbox); the engine draws the box at that size', () => {
    const s = session(spreadGun, boss(4))
    expect(s.sim.renderState().dummies[0]).toMatchObject({ width: 8, height: 12, path: null })
    const a = s.assumptions.find((x) => x.id === 'target-boss')
    expect(a?.title).toBe('Boss-Sized Dummy: a 8 × 12-tile test size')
    expect(a?.detail).toContain('not any boss’s hitbox')
  })
})

describe('Moving Dummy (AC2): a path at an adjustable speed — shots can visibly miss, and the HUD counts them', () => {
  it('a straight shot at the up-and-back path: shots fired and missed, live and in the results; a still dummy is never missed', () => {
    const s = session(plainGun, moving('vertical', 12))
    expect(s.getHud().shots).toEqual({ noun: 'shot', fired: 0, missed: 0 }) // laid out from the start
    hold(s, 600)
    for (let i = 0; i < 180; i++) s.frame(FRAME_MS) // the last shots leave
    const shots = s.getHud().shots!
    expect(shots.fired).toBe(s.getHud().ammoConsumed)
    expect(shots.missed).toBeGreaterThan(0)
    expect(shots.missed).toBeLessThan(shots.fired)
    const result = timed(s)
    expect(result.projectilesMissed).toBeGreaterThan(0)
    expect(timed(session(plainGun)).projectilesMissed).toBe(0)
    expect(session(plainGun).getHud().shots).toBeNull() // only against the Moving Dummy
  })

  it('a faster dummy is missed more often (same seed)', () => {
    const missRate = (speed: number) => {
      const r = timed(session(plainGun, moving('vertical', speed)))
      return r.projectilesMissed / r.projectilesSpawned
    }
    expect(missRate(16)).toBeGreaterThan(missRate(1))
  })

  it('a blade has no shots readout; out of reach on the away-and-back path, it lands fewer hits than at the Infinite Dummy', () => {
    expect(session(sword, moving('horizontal', 4)).getHud().shots).toBeNull()
    expect(timed(session(sword, moving('horizontal', 4))).hits).toBeLessThan(timed(session(sword)).hits)
  })

  it('frame-rate independent through the session: a 10 s test gives the same result at 30, 60 and 144 fps and jittered frames', () => {
    const at = (frames: () => number) => timed(session(plainGun, moving('horizontal', 9), 77), frames)
    const reference = at(() => 1000 / 60)
    let j = 0
    for (const frames of [() => 1000 / 30, () => 1000 / 144, () => [3, 41, 17, 9, 66][j++ % 5]]) expect(at(frames)).toEqual(reference)
  })

  it('its assumptions: the path and speed (Lab test values) and the engine’s movement model, with the modeling choices', () => {
    const s = session(plainGun, moving('horizontal', 6))
    const ids = s.assumptions.map((a) => a.id)
    expect(ids).toEqual(expect.arrayContaining(['target-moving', 'dummy-motion']))
    expect(ids.indexOf('target-moving')).toBeLessThan(ids.indexOf('dps-while-attacking'))
    expect(s.assumptions.find((a) => a.id === 'target-moving')?.title).toBe('Moving Dummy: 8 tiles away and back at 6 tiles/s')
    s.setTarget(DEFAULT_LAB_TARGET)
    expect(s.assumptions.map((a) => a.id)).not.toEqual(expect.arrayContaining(['dummy-motion']))
  })
})

describe('Armored Dummy (AC3): adjustable defense, the wiki formula, lower numbers as it rises', () => {
  const perHit = (defense: number) => {
    const s = session(sword, armored(defense))
    s.updateSettings({ damageVariance: false })
    hold(s, 120)
    return s.getHud().lastHit
  }

  it('raising defense visibly lowers the damage numbers (⌊damage − defense ÷ 2⌋, never below 1)', () => {
    const base = sword.damage!
    const values = [0, 4, 10, 20].map((d) => perHit(d))
    for (const [i, defense] of [0, 4, 10, 20].entries()) {
      const hit = values[i]!
      expect(hit.amount, `defense ${defense}`).toBe(Math.max(1, Math.floor(base - defense / 2)) * (hit.crit ? 2 : 1))
    }
    expect(perHit(ARMORED_DEFENSE_RANGE.max)!.amount).toBeLessThanOrEqual(2) // the floor (1, or a crit's 2)
  })

  it('the verified boss picks come from the bosses data with their wiki pages; only defense applies', () => {
    expect(PICKS.length).toBeGreaterThan(0)
    for (const b of PICKS) {
      const record = ALL_BOSSES.find((r) => r.id === b.id)!
      expect(b.defense).toBe(record.statsByDifficulty.classic?.defense)
      expect(b.sourceUrl).toBe(record.wikiUrl)
      expect(record._prov.unverifiedFields.some((f) => f === 'statsByDifficulty.classic' || f === 'statsByDifficulty.classic.defense' || f === 'statsByDifficulty')).toBe(false)
    }
    // sorted by defense, then name
    expect(PICKS.map((b) => b.defense)).toEqual([...PICKS.map((b) => b.defense)].sort((a, b) => a - b))
    const plantera = PICKS.find((b) => b.id === 'plantera')
    expect(plantera).toMatchObject({ defense: 36, multiForm: true })
  })

  it('a boss pick names the boss (with its source) while the value is its defense; a value of your own is a test value', () => {
    const plantera = PICKS.find((b) => b.id === 'plantera')!
    const s = session(sword, armored(plantera.defense, plantera.id))
    const named = s.assumptions.find((a) => a.id === 'target-armored')!
    expect(named.title).toBe('Armored Dummy: defense 36, as Plantera')
    expect(named.detail).toContain('its first form’s')
    expect(named.sourceUrl).toBe(plantera.sourceUrl)
    s.setTarget(armored(37))
    const own = s.assumptions.find((a) => a.id === 'target-armored')!
    expect(own.title).toBe('Armored Dummy: defense 37 (a test value)')
    expect(own.sourceUrl).toBeUndefined()
    // a stale boss id never names a boss for another value
    expect(namedBoss({ defense: 37, bossId: 'plantera' }, PICKS)).toBeNull()
    expect(targetAssumption(armored(37, 'plantera'), null)?.title).toBe('Armored Dummy: defense 37 (a test value)')
  })
})

describe('switching targets mid-session (AC4): every switch starts clean; Reset restores the Infinite Dummy', () => {
  it('each target swaps the engine’s dummies, zeroes the stats and clears the renderer; same target again is a no-op', () => {
    const s = session(plainGun)
    let resets = 0
    s.onReset(() => resets++)
    const targets: LabTarget[] = [boss(2), moving('vertical', 5), { kind: 'row', count: 3 }, armored(25), { kind: 'debuff' }, moving('horizontal', 5), DEFAULT_LAB_TARGET]
    for (const [i, target] of targets.entries()) {
      hold(s, 90)
      expect(s.getHud().hits + s.getHud().ammoConsumed, `before ${target.kind}`).toBeGreaterThan(0)
      expect(s.setTarget(target)).toBe(true)
      expect(resets).toBe(i + 1)
      const hud = s.getHud()
      expect(hud).toMatchObject({ target, hits: 0, totalDamage: 0, ammoConsumed: 0, attackSeconds: 0, settings: DEFAULT_LAB_SETTINGS })
      expect(hud.graph.elapsedTicks).toBe(0)
      expect(s.sim.snapshot().tick).toBe(0)
      expect(s.setTarget(target)).toBe(true) // the same target: nothing restarts
      expect(resets).toBe(i + 1)
    }
    expect(s.setTarget(boss(9))).toBe(false) // a value the Lab doesn't offer
  })

  it('the single Reset brings back the Infinite Dummy from any roster target (and the default settings)', () => {
    for (const target of [boss(4), moving('vertical', 16), armored(80, 'empress-of-light')]) {
      const s = session(plainGun, target)
      s.updateSettings({ damageVariance: false })
      hold(s, 60)
      s.reset()
      expect(s.getHud()).toMatchObject({ target: DEFAULT_LAB_TARGET, hits: 0, shots: null, settings: DEFAULT_LAB_SETTINGS })
      expect(s.sim.renderState().dummies).toEqual([expect.objectContaining({ width: 2, height: 3, defense: 0, path: null })])
    }
  })

  it('switching is refused while a timed test runs; the run keeps its target', () => {
    const s = session(plainGun, moving('horizontal', 8))
    s.startTimedTest(10)
    expect(s.setTarget(armored(10))).toBe(false)
    expect(s.getHud().target).toEqual(moving('horizontal', 8))
  })
})
