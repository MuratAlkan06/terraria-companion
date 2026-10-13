import { describe, expect, it } from 'vitest'
import type { LabModifiers } from '../schemas'
import { createLabSim, type LabSim, type LabSimOptions, type SimEvent } from './index'
import { ammoFixture, bowFixture, dotBuffFixture, fixtureWeapon, staffFixture, SWORD_PARAMS, swordFixture } from './testing/fixtures'

function sim(options: LabSimOptions): LabSim {
  const r = createLabSim(options)
  if (!r.ok) throw new Error(`refused: ${JSON.stringify(r.refusal)}`)
  return r.sim
}

/** Attack for `attackTicks`, then release and keep stepping until `totalTicks`. */
function burst(s: LabSim, attackTicks: number, totalTicks: number, aim: { x: number; y: number } | null = null): SimEvent[] {
  const events: SimEvent[] = []
  s.setInput({ attacking: true, aim })
  for (let t = 0; t < totalTicks; t++) {
    if (t === attackTicks) s.setInput({ attacking: false })
    s.step()
    events.push(...s.drainEvents())
  }
  return events
}

const of = <T extends SimEvent['type']>(events: SimEvent[], type: T) => events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type)

describe('homing modifier (P3-S8)', () => {
  const homing: LabModifiers = { homing: { strength: 0.2, acquisitionRangeTiles: 20 } }
  const offAxis = [{ x: 10, y: -6 }] // aim is straight right; the dummy is well above the line
  const aimRight = { x: 20, y: 0 }

  it.each([
    ['ranged (bow-gun)', () => ({ weapon: bowFixture({}, {}, homing), ammo: ammoFixture() })],
    ['magic (magic-bolt)', () => ({ weapon: staffFixture({}, {}, homing), settings: { ignoreMana: true } })],
  ])('%s: curves into an off-axis dummy; the same weapon flies straight with homing disabled', (_label, setup) => {
    const on = sim({ ...setup(), dummies: offAxis })
    const off = sim({ ...setup(), dummies: offAxis })
    off.updateSettings({ homingEnabled: false })
    burst(on, 1, 120, aimRight)
    burst(off, 1, 120, aimRight)
    expect(on.snapshot().stats.hits).toBe(1)
    expect(off.snapshot().stats.hits).toBe(0)
  })

  it('does not acquire targets beyond acquisitionRangeTiles', () => {
    const weapon = bowFixture({}, {}, { homing: { strength: 0.5, acquisitionRangeTiles: 3 } })
    const s = sim({ weapon, ammo: ammoFixture(), dummies: offAxis })
    burst(s, 1, 120, aimRight)
    expect(s.snapshot().stats.hits).toBe(0)
  })

  it('keeps projectile speed while steering', () => {
    const s = sim({ weapon: bowFixture({}, {}, homing), ammo: ammoFixture(), dummies: offAxis })
    s.setInput({ attacking: true, aim: aimRight })
    s.step(10)
    const p = s.renderState().projectiles[0]
    expect(Math.hypot(p.vx, p.vy)).toBeCloseTo(24, 9)
    expect(p.vy).toBeLessThan(0) // turned upward toward the dummy
  })
})

describe('DoT modifier (buff registry → dotDamage)', () => {
  const buffs = [dotBuffFixture(4)]
  const dotStaff = (dot: NonNullable<LabModifiers['dot']>) => staffFixture({}, {}, { dot })

  it('accrues buff dps into dotDamage for the debuff duration, separate from direct damage', () => {
    const s = sim({ weapon: dotStaff({ buffId: 'fixture-burn', durationTicks: 120 }), buffs, settings: { ignoreMana: true } })
    const events = burst(s, 1, 300)
    const st = s.snapshot().stats
    expect(st.hits).toBe(1)
    expect(st.debuffsApplied).toBe(1)
    expect(st.dotDamage).toBe(8) // 4 dps × 2 s
    expect(st.totalDamage).toBe(st.directDamage + 8)
    expect(st.perDummy['dummy-0'].dotDamage).toBe(8)
    expect(of(events, 'debuff-expired')).toHaveLength(1)
    expect(of(events, 'damage').filter((e) => e.source === 'dot').every((e) => !e.crit)).toBe(true)
  })

  it('ignores dummy defense (labeled assumption)', () => {
    const s = sim({ weapon: dotStaff({ buffId: 'fixture-burn', durationTicks: 120 }), buffs, dummies: [{ x: 2, y: 0, defense: 100 }], settings: { ignoreMana: true, damageVariance: false } })
    burst(s, 1, 300)
    const st = s.snapshot().stats
    expect(st.directDamage === 1 || st.directDamage === 2).toBe(true) // min-1 floor (×2 on crit)
    expect(st.dotDamage).toBe(8)
  })

  it('reapplication refreshes duration instead of stacking', () => {
    const s = sim({ weapon: dotStaff({ buffId: 'fixture-burn', durationTicks: 120 }), buffs, settings: { ignoreMana: true } })
    const events = burst(s, 21, 400) // two casts (ticks 0 and 20), hits on ticks 1 and 21
    const applied = of(events, 'debuff-applied')
    expect(applied.map((e) => e.refreshed)).toEqual([false, true])
    expect(s.renderState().dummies[0].debuffs).toHaveLength(0)
    // Debuff active ticks 1..140 (refreshed to 120 at tick 21): ⌊140 × 4 / 60⌋ = 9, not doubled.
    expect(s.snapshot().stats.dotDamage).toBe(9)
  })

  it('rolls duration ranges and proc chance from the seeded stream', () => {
    const s = sim({
      weapon: dotStaff({ buffId: 'fixture-burn', chancePct: 50, durationTicks: { minTicks: 60, maxTicks: 240 } }),
      buffs,
      settings: { ignoreMana: true },
    })
    const events = burst(s, 600, 600)
    const applied = of(events, 'debuff-applied')
    const hits = s.snapshot().stats.hits
    expect(hits).toBeGreaterThan(20)
    expect(applied.length).toBeGreaterThan(hits * 0.25)
    expect(applied.length).toBeLessThan(hits * 0.75)
    expect(applied.every((e) => e.durationTicks >= 60 && e.durationTicks <= 240)).toBe(true)
    expect(new Set(applied.map((e) => e.durationTicks)).size).toBeGreaterThan(1)
  })
})

describe('multiHit modifier (local immunity ticks)', () => {
  it('lets one piercing projectile re-hit the same dummy every localImmunityTicks', () => {
    const ammo = ammoFixture({ projectile: { velocityTps: 1, pierce: 'infinite' } })
    const slowBow = (modifiers?: LabModifiers) => bowFixture({}, { shootSpeedTps: 3 }, modifiers)
    const dummies = [{ x: 4, y: 0, widthTiles: 4 }] // box x ∈ [2, 6]; projectile at 0.05 tiles/tick
    const plain = sim({ weapon: slowBow(), ammo, dummies })
    const multi = sim({ weapon: slowBow({ multiHit: { localImmunityTicks: 10 } }), ammo, dummies })
    burst(plain, 1, 200)
    const events = burst(multi, 1, 200)
    expect(plain.snapshot().stats.hits).toBe(1)
    const ticks = of(events, 'damage').map((e) => e.tick)
    // Enters at tick 39 (0.05 × 40 = 2), exits after x = 6 → hits at 39, 49, …, 119.
    expect(ticks).toEqual([39, 49, 59, 69, 79, 89, 99, 109, 119])
  })

  it('lets a slow swing hit a boss-sized dummy several times per swing', () => {
    const dummies = [{ x: 2.5, y: 0, widthTiles: 4, heightTiles: 6 }]
    const slow = { useTimeTicks: 60, useAnimationTicks: 60 }
    const once = sim({ weapon: swordFixture(slow), dummies })
    const multi = sim({ weapon: fixtureWeapon(SWORD_PARAMS, slow, { multiHit: { localImmunityTicks: 10 } }), dummies })
    burst(once, 60, 60)
    burst(multi, 60, 60)
    expect(once.snapshot().stats.hits).toBe(1)
    expect(multi.snapshot().stats.hits).toBeGreaterThanOrEqual(5)
  })
})
