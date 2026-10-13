/**
 * Structural guarantees: ADR-001 D5 layer 1 (pure TS, zero renderer imports, headless) and the
 * honesty contract (every simulation exposes a populated assumptions list for the HUD).
 */
import { describe, expect, it } from 'vitest'
import { APPROXIMATIONS, createLabSim, type LabSimOptions } from './index'
import { ammoFixture, bowFixture, dotBuffFixture, spearFixture, staffFixture, swordFixture } from './testing/fixtures'

const sources = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>

describe('ADR-001 D5 layer separation', () => {
  it('the sim core imports nothing but itself and src/schemas', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(10)
    for (const [file, text] of Object.entries(sources)) {
      for (const [, spec] of text.matchAll(/from\s+'([^']+)'/g)) {
        const allowed = spec.startsWith('./') || spec.startsWith('../') ? !/\.\.\/(app|components|data|data-access|search|storage|styles)\b/.test(spec) : false
        expect(allowed, `${file} imports "${spec}"`).toBe(true)
      }
    }
  })

  it('uses no DOM / browser globals (headless in Node)', () => {
    for (const [file, text] of Object.entries(sources)) {
      // Bare global references only (`this.window` etc. are member accesses, not globals).
      expect(/(?<![.\w$])(window|document|requestAnimationFrame|performance|localStorage)\s*[.(]/.test(text), file).toBe(false)
    }
  })
})

describe('labeled approximations (AssumptionsTip source)', () => {
  const cases: Array<[string, LabSimOptions, string[]]> = [
    ['sword', { weapon: swordFixture() }, ['swing-geometry', 'melee-once-per-use']],
    ['spear', { weapon: spearFixture(3) }, ['thrust-geometry']],
    ['bow', { weapon: bowFixture({ projectilesPerUse: 3, spreadDegrees: 10 }), ammo: ammoFixture() }, ['ammo', 'spread', 'projectile-point']],
    [
      'staff+dot+homing',
      { weapon: staffFixture({}, {}, { dot: { buffId: 'fixture-burn', durationTicks: 60 }, homing: { strength: 0.3, acquisitionRangeTiles: 10 } }), buffs: [dotBuffFixture()] },
      ['mana-cost', 'mana-regen', 'insufficient-mana', 'dot', 'homing'],
    ],
  ]

  it.each(cases)('%s lists the common + behavior-specific assumptions', (_name, options, specific) => {
    const r = createLabSim(options)
    if (!r.ok) throw new Error('refused')
    const ids = r.sim.approximations.map((a) => a.id)
    for (const id of ['fixed-tick', 'crit-base', 'defense', 'cadence', 'knockback', ...specific]) expect(ids).toContain(id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const a of r.sim.approximations) {
      expect(a.title.length).toBeGreaterThan(0)
      expect(a.detail.length).toBeGreaterThan(20)
      if (a.sourceUrl) expect(a.sourceUrl.startsWith('https://terraria.wiki.gg/wiki/')).toBe(true)
    }
  })

  it('melee weapons do not list projectile/mana assumptions', () => {
    const r = createLabSim({ weapon: swordFixture() })
    if (!r.ok) throw new Error('refused')
    const ids = r.sim.approximations.map((a) => a.id)
    expect(ids).not.toContain('projectile-point')
    expect(ids).not.toContain('mana-regen')
  })

  it('every registry entry is keyed by its own id', () => {
    for (const [key, a] of Object.entries(APPROXIMATIONS)) expect(a.id).toBe(key)
  })
})
