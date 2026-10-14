/**
 * The Lab session headless, P3-S2 AC3 + P3-S3 AC1–AC3: the single Reset restores the test, the
 * target and the settings together; standardized timed tests run on the engine's controller
 * (exactly 600 / 1800 ticks), lock the config, abort on Reset, halt with a result, and "Run again"
 * reproduces that result exactly; the HUD publishes the engine's per-second series for the graph;
 * a weapon whose record gains thrust params (B47) equips and attacks with no UI change.
 * Real committed weapons, fixed seeds — the engine is deterministic, so none of this can flake.
 */
import { describe, expect, it } from 'vitest'
import type { Weapon } from '../data-access/types'
import weaponsJson from '../data/weapons.detail.json'
import { DEFAULT_LAB_SETTINGS, TICKS_PER_SECOND, type LabSettings, type SimEvent } from '../sim'
import { createLabSession, type LabSession } from './labSession'
import { defaultLabWeapon, labStatus, labWeapons } from './labWeapons'
import { LAB_SETUP } from './testing/labData'

const all = weaponsJson as Weapon[]
const swords = labWeapons(all, LAB_SETUP).filter((w) => w.labBehavior.kind === 'archetype' && w.labBehavior.params.archetype === 'swing-melee')
const sword = defaultLabWeapon(swords)!
const FRAME_MS = 1000 / 60

function session(weapon: Weapon, seed = 7, settings?: Partial<LabSettings>): LabSession {
  let s = seed
  const created = createLabSession(weapon, { seed: () => s++, setup: LAB_SETUP, ...(settings ? { settings } : {}) })
  if (!created.ok) throw new Error(`${weapon.name} refused: ${created.refusal.message}`)
  return created.session
}

function hold(s: LabSession, seconds: number): SimEvent[] {
  const events: SimEvent[] = []
  s.press('key')
  for (let t = 0; t < seconds * 1000 - 1e-6; t += FRAME_MS) events.push(...s.frame(FRAME_MS).events)
  s.release('key')
  return events
}

/** Feeds frames of `frameMs` until the running test finishes; returns the frame count. */
function runToEnd(s: LabSession, frameMs = FRAME_MS): number {
  let frames = 0
  while (s.getHud().timedTest.status === 'running') {
    s.frame(frameMs)
    if (++frames > 100_000) throw new Error('test never finished')
  }
  return frames
}

describe('P3-S2 AC3: one Reset restores the test, the target and the settings together', () => {
  it('a single reset() — mid-test — aborts the test, zeroes stats and the graph, clears the dummy, restores default settings', () => {
    const s = session(sword)
    expect(s.getHud().settings).toEqual(DEFAULT_LAB_SETTINGS)
    expect(s.updateSettings({ damageVariance: false })).toMatchObject({ ok: true })
    hold(s, 2)
    expect(s.startTimedTest(30)).toBe(true)
    for (let i = 0; i < 90; i++) s.frame(FRAME_MS)
    expect(s.getHud()).toMatchObject({ locked: true, timedTest: { status: 'running' } })
    expect(s.getHud().totalDamage).toBeGreaterThan(0)
    // A running test still kept the changed setting (it was set before the run).
    expect(s.getHud().settings.damageVariance).toBe(false)

    let published = 0
    s.subscribe(() => published++)
    s.reset()
    const hud = s.getHud()
    expect(published).toBe(1)
    expect(hud.settings).toEqual(DEFAULT_LAB_SETTINGS)
    expect(hud).toMatchObject({ locked: false, lastHit: null, totalDamage: 0, hits: 0, crits: 0, estimatedDps: 0 })
    expect(hud.timedTest).toMatchObject({ status: 'idle', durationSec: null, result: null })
    expect(hud.graph).toEqual({ series: [], startSecond: 0, currentSecondDamage: 0, elapsedTicks: 0 })
    expect(s.sim.renderState().dummies.every((d) => d.debuffs.length === 0)).toBe(true)
    expect(s.sim.snapshot().settings).toEqual(DEFAULT_LAB_SETTINGS)
    // ...and attacking works again straight away.
    expect(hold(s, 1).some((e) => e.type === 'damage')).toBe(true)
  })

  it('variance off really is a setting the sim applies: every normal hit deals the same damage', () => {
    const s = session(sword, 3, { damageVariance: false })
    const amounts = new Set(hold(s, 8).flatMap((e) => (e.type === 'damage' && !e.crit ? [e.amount] : [])))
    expect(amounts.size).toBe(1)
    const v = session(sword, 3)
    expect(new Set(hold(v, 8).flatMap((e) => (e.type === 'damage' && !e.crit ? [e.amount] : []))).size).toBeGreaterThan(1)
  })
})

describe('P3-S3 AC3: standardized 10 s / 30 s tests', () => {
  it('locks the config while running: settings refused, attack input ignored, no second test; exactly 600 ticks, then halts', () => {
    const s = session(sword)
    let maxPublishGapTicks = 0
    let lastTick = 0
    s.subscribe(() => {
      const t = s.getHud().graph.elapsedTicks
      maxPublishGapTicks = Math.max(maxPublishGapTicks, t - lastTick)
      lastTick = t
    })
    expect(s.startTimedTest(10)).toBe(true)
    lastTick = 0
    expect(s.getHud()).toMatchObject({ locked: true, timedTest: { status: 'running', durationSec: 10, remainingSec: 10, progress: 0 } })
    expect(s.locked).toBe(true)
    expect(s.updateSettings({ damageVariance: false })).toEqual({ ok: false, reason: 'config-locked' })
    expect(s.startTimedTest(30)).toBe(false)
    expect(s.runAgain()).toBe(false)
    // Aiming away mid-run changes nothing: the engine holds the attack, aimed at the dummy.
    s.press('pointer', { x: -6, y: 0 })

    const remaining: number[] = []
    s.subscribe(() => remaining.push(s.getHud().timedTest.remainingSec))
    runToEnd(s, 17)
    const hud = s.getHud()
    expect(hud.locked).toBe(false)
    expect(hud.timedTest.status).toBe('finished')
    expect(hud.timedTest.progress).toBe(1)
    const result = hud.timedTest.result!
    expect(result).toMatchObject({ durationSec: 10, ticks: 10 * TICKS_PER_SECOND })
    expect(result.estimatedDps).toBeCloseTo(result.totalDamage / 10, 12)
    expect(result.hits).toBeGreaterThan(0)
    // The countdown stepped at least every 0.1 s and only ever went down.
    expect(maxPublishGapTicks).toBeLessThanOrEqual(TICKS_PER_SECOND / 10 + 2)
    expect(remaining.filter((r, i) => i > 0 && r > remaining[i - 1])).toEqual([])
    // Readouts froze at the result, and the halted engine runs no more ticks.
    expect(hud.totalDamage).toBe(result.totalDamage)
    expect(hud.hits).toBe(result.hits)
    for (let i = 0; i < 120; i++) s.frame(FRAME_MS)
    expect(s.getHud().totalDamage).toBe(result.totalDamage)
    expect(s.sim.snapshot().tick).toBe(600)
  })

  it('Reset mid-test aborts it (no result) and unlocks', () => {
    const s = session(sword)
    s.startTimedTest(10)
    for (let i = 0; i < 300; i++) s.frame(FRAME_MS)
    expect(s.getHud().timedTest.status).toBe('running')
    s.reset()
    expect(s.getHud().timedTest).toMatchObject({ status: 'idle', result: null })
    expect(s.locked).toBe(false)
    expect(s.updateSettings({ damageVariance: false })).toMatchObject({ ok: true })
    for (let i = 0; i < 900; i++) s.frame(FRAME_MS)
    expect(s.getHud().timedTest.status).toBe('idle')
  })

  it('"Run again" reproduces the result exactly (same seed, settings, event digest) at any frame rate', () => {
    const s = session(sword, 41)
    s.startTimedTest(10)
    runToEnd(s, FRAME_MS)
    const first = s.getHud().timedTest.result!
    // Settings may change after a run; Run again replays the run's own settings anyway.
    s.updateSettings({ damageVariance: false })
    expect(s.runAgain()).toBe(true)
    expect(s.getHud().settings.damageVariance).toBe(true)
    runToEnd(s, 1000 / 144)
    expect(s.getHud().timedTest.result).toEqual(first)
    expect(s.runAgain()).toBe(true)
    runToEnd(s, 250)
    expect(s.getHud().timedTest.result).toEqual(first)
    // A new test draws a fresh seed (a different run, same rules).
    expect(s.startTimedTest(10)).toBe(true)
    runToEnd(s)
    const fresh = s.getHud().timedTest.result!
    expect(fresh.seed).not.toBe(first.seed)
    expect(fresh.ticks).toBe(first.ticks)
  })

  it('30 s: 1800 ticks; the result’s per-second series covers 30 seconds and sums to the total', () => {
    const s = session(sword)
    s.startTimedTest(30)
    runToEnd(s, 33)
    const result = s.getHud().timedTest.result!
    expect(result.ticks).toBe(30 * TICKS_PER_SECOND)
    expect(result.dpsSeries).toHaveLength(30)
    expect(result.dpsSeries.reduce((a, b) => a + b, 0)).toBe(result.totalDamage)
    expect(result.attacksPerSec).toBeCloseTo(result.uses / 30, 12)
  })
})

describe('P3-S3 AC1–AC2: live numbers and the graph’s series', () => {
  it('the HUD carries the engine’s per-second series (what the DpsGraph draws), published every whole second', () => {
    const s = session(sword)
    // At every publish, the HUD's series is exactly the engine's at that moment.
    let checked = 0
    const stop = s.subscribe(() => {
      const { graph, totalDamage } = s.getHud()
      const stats = s.sim.snapshot().stats
      expect(graph).toEqual({ series: stats.dpsSeries, startSecond: stats.seriesStartSecond, currentSecondDamage: stats.currentSecondDamage, elapsedTicks: stats.ticks })
      expect(graph.series.reduce((a, b) => a + b, 0) + graph.currentSecondDamage).toBe(totalDamage)
      checked++
    })
    s.press('key')
    for (let i = 0; i < 5.5 * 60; i++) s.frame(FRAME_MS)
    s.release('key')
    stop()
    expect(checked).toBeGreaterThan(10)
    expect(s.getHud().graph.series).toHaveLength(5)
    // Idle seconds still close a bar (the strip keeps rolling), each one published.
    let published = 0
    s.subscribe(() => published++)
    for (let i = 0; i < 3 * 60; i++) s.frame(FRAME_MS)
    expect(published).toBeGreaterThanOrEqual(3)
    expect(s.getHud().graph.series.slice(-2)).toEqual([0, 0])
  })
})

describe('data-driven archetypes: a record with thrust params equips with no UI change (B47)', () => {
  // A real spear record, given thrust params (the shape the pipeline emits for a B46 formula reach,
  // listed in modeledFields) — a mock of the data landing, whatever the committed record says today.
  const SIM_FIELDS = ['damageClass', 'damage', 'critPct', 'useTimeTicks', 'useAnimationTicks', 'knockback', 'manaCost', 'autoReuse']
  const spear = all.find((w) => w.tags.includes('spears') && !w._prov.unverifiedFields.some((f) => SIM_FIELDS.includes(f) || f.startsWith('labBehavior')))!
  const mock: Weapon = {
    ...spear,
    _prov: { ...spear._prov, modeledFields: ['labBehavior.params.reachTiles'] },
    labBehavior: { kind: 'archetype', params: { archetype: 'thrust', reachTiles: 3.5 } },
  }

  it('is equippable, thrusts at the dummy and hits it; the reach is labeled a modeling choice', () => {
    expect(labStatus(mock, LAB_SETUP)).toEqual({ kind: 'equippable', archetype: 'thrust' })
    const s = session(mock)
    expect(s.reachTiles).toBe(3.5)
    expect(s.swing).toBeNull()
    expect(s.assumptions[0].id).toBe('thrust-reach')
    expect(s.assumptions[0].detail).toMatch(/modeling choice, not game data/)
    const events = hold(s, 3)
    expect(events.some((e) => e.type === 'damage')).toBe(true)
    s.press('key')
    s.frame(FRAME_MS * 3)
    expect(s.sim.renderState().blade?.kind).toBe('thrust')
    s.release('key')
    // Timed tests work for it too.
    s.reset()
    s.startTimedTest(10)
    runToEnd(s)
    expect(s.getHud().timedTest.result!.hits).toBeGreaterThan(0)
  })
})
