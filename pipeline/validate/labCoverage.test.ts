/* P3-S13 Weapon Lab coverage gate (AMENDMENTS-016 B115): the committed app dataset passes it, and each
 * violation — (a) the simulable count below its floor, (b) a missing / failing / stale / unpinnable golden,
 * (c) a non-simulable weapon without a typed, renderable refusal — fails the build with its named error. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Weapon } from '../../src/schemas'
import { assessWeapon, type WeaponAssessment } from '../../src/sim'
import { loadDatasetDir, type RawDataset } from './dataset'
import { formatError, type PipelineError } from './errors'
import { validateDataset } from './index'
import { checkLabCoverage, GOLDEN_RUN_SECONDS, LAB_COVERAGE_PINS, type LabCoverageInput, type LabCoveragePins } from './labCoverage'
import { serializeGoldens } from './pinLabGoldens'

const DATA_DIR = join(import.meta.dirname, '../../src/data')
const SAMPLE_DIR = join(import.meta.dirname, '../fixtures/sample')
const GOLDENS_FILE = join(import.meta.dirname, 'labGoldens.json')
const NOW = new Date('2026-10-15T00:00:00.000Z')

const app = loadDatasetDir(DATA_DIR)
const appName = (app.raw.manifest as { name: string }).name
const PINS = LAB_COVERAGE_PINS[appName]

function validated(raw: RawDataset) {
  const result = validateDataset(raw, { now: NOW })
  if (!result.ok) throw new Error(result.errors.slice(0, 5).map(formatError).join('\n'))
  return result.dataset
}
const dataset = validated(structuredClone(app.raw))
const input: LabCoverageInput = { weapons: dataset.weapons, items: dataset.items, buffs: dataset.buffs }
const simulableIds = dataset.weapons.filter((w) => assessWeapon(w).simulable).map((w) => String(w.id))
const byName = (name: string): Weapon => {
  const w = dataset.weapons.find((x) => x.name === name)
  if (!w) throw new Error(`no weapon ${name}`)
  return w
}
const coverageErrors = (errors: readonly PipelineError[]) => errors.filter((e) => e.code === 'E_LAB_COVERAGE' || e.code === 'E_LAB_UNHANDLED')
const rulesOf = (errors: readonly PipelineError[]) => errors.map((e) => (e.code === 'E_LAB_COVERAGE' ? `${e.rule} ${e.ref}` : e.code === 'E_LAB_UNHANDLED' ? `unhandled i:${e.itemId}` : e.code))

// Test-only loose record type for mutating raw JSON.
// oxlint-disable-next-line typescript/no-explicit-any
type Rec = Record<string, any>
const rawWeapon = (raw: RawDataset, id: number) => (raw.collections.weapons as Rec[]).find((w) => w.id === id) as Rec

describe('the committed app dataset (src/data) passes the B115 gate', () => {
  it('its manifest is pinned (a rename can’t switch the gate off) at the floor B115 ruled: 149 simulable', () => {
    expect(PINS, `LAB_COVERAGE_PINS has no entry for manifest "${appName}"`).toBeDefined()
    expect(PINS.floor).toBe(149)
    expect(simulableIds).toHaveLength(PINS.floor)
  })

  it('every simulable weapon has a passing golden, the table equals the simulable set, and no weapon is unhandled', () => {
    const report = checkLabCoverage(input, { pins: PINS })
    expect(report.errors.map(formatError)).toEqual([])
    expect(report.simulable).toBe(149)
    expect(Object.keys(PINS.goldens).sort()).toEqual([...simulableIds].sort())
  })

  it('a bow or gun golden names the ammo it fires; nothing else does', () => {
    for (const w of dataset.weapons) {
      const verdict = assessWeapon(w)
      if (!verdict.simulable) continue
      expect(PINS.goldens[String(w.id)].ammo !== undefined, w.name).toBe(verdict.requiresAmmoClass !== null)
    }
  })

  it('labGoldens.json is in the pin tool’s canonical form (one golden per line, ids ascending)', () => {
    const text = readFileSync(GOLDENS_FILE, 'utf8')
    expect(serializeGoldens(JSON.parse(text))).toBe(text)
  })
})

describe('build failures through validateDataset (the app dataset, one mutation each)', () => {
  const sword = byName('Iron Broadsword')

  it('(b) a data change to a simulable weapon fails its golden — E_LAB_COVERAGE golden, carrying the fingerprint it produces now', () => {
    const raw = structuredClone(app.raw)
    rawWeapon(raw, sword.id).critPct = 40 // not a list field: only the golden can notice
    const result = validateDataset(raw, { now: NOW })
    expect(result.ok).toBe(false)
    expect(rulesOf(result.errors)).toEqual([`golden i:${sword.id}`])
    const [error] = result.errors
    expect(error).toMatchObject({ code: 'E_LAB_COVERAGE', rule: 'golden', ref: `i:${sword.id}`, message: expect.stringContaining('golden fails: pinned') })
    if (error.code !== 'E_LAB_COVERAGE') throw new Error('unreachable')
    expect(error.computed?.crits).toBeGreaterThan(PINS.goldens[String(sword.id)].crits)
  })

  it('(a) a simulable weapon downgraded to a limitation drops the count below the floor — and its pin goes stale', () => {
    const raw = structuredClone(app.raw)
    const w = rawWeapon(raw, sword.id)
    w._prov.unverifiedFields = [...w._prov.unverifiedFields, 'useAnimationTicks'].sort() // §2.1-3: validate downgrades it
    delete w.useAnimationTicks
    for (const l of raw.lists.weapons as Rec[]) {
      if (l.id !== sword.id) continue
      l.labKind = 'limitation'
      delete l.useAnimationTicks
    }
    const result = validateDataset(raw, { now: NOW })
    expect(result.ok).toBe(false)
    expect(rulesOf(result.errors).sort()).toEqual(['simulable-floor collection:weapons', `stale-golden i:${sword.id}`])
    expect(result.errors.find((e) => e.code === 'E_LAB_COVERAGE' && e.rule === 'simulable-floor')?.message).toBe(
      '148 simulable weapons, below the pinned floor of 149 — the simulable count may never decrease (B115 a)',
    )
  })

  it('the P2-S1 sample has no pins: only (c) applies, and it passes', () => {
    const sample = loadDatasetDir(SAMPLE_DIR)
    expect(LAB_COVERAGE_PINS[(sample.raw.manifest as { name: string }).name]).toBeUndefined()
    const result = validateDataset(structuredClone(sample.raw), { now: NOW })
    expect(result.ok ? [] : coverageErrors(result.errors)).toEqual([])
  })
})

describe('(a) simulable floor', () => {
  it('a count at or above the floor passes (forgetting to raise it never blocks); below fails', () => {
    const at = checkLabCoverage(input, { pins: { ...PINS, floor: 149 } })
    const above = checkLabCoverage(input, { pins: { ...PINS, floor: 100 } })
    const below = checkLabCoverage(input, { pins: { ...PINS, floor: 150 } })
    expect(at.errors).toEqual([])
    expect(above.errors).toEqual([])
    expect(rulesOf(below.errors)).toEqual(['simulable-floor collection:weapons'])
  })
})

describe('(b) goldens', () => {
  const withGoldens = (edit: (goldens: Record<string, LabCoveragePins['goldens'][string]>) => void): LabCoveragePins => {
    const goldens = structuredClone(PINS.goldens) as Record<string, LabCoveragePins['goldens'][string]>
    edit(goldens)
    return { floor: PINS.floor, goldens }
  }
  const sword = byName('Iron Broadsword')
  const bow = byName('Wooden Bow')

  it('a simulable weapon without a pin fails, suggesting the fingerprint its golden run produces', () => {
    const { errors } = checkLabCoverage(input, { pins: withGoldens((g) => delete g[String(sword.id)]) })
    expect(rulesOf(errors)).toEqual([`golden i:${sword.id}`])
    expect(errors[0]).toMatchObject({ message: expect.stringContaining('no golden pinned (B115 b)'), computed: PINS.goldens[String(sword.id)] })
  })

  it('a pin that no longer reproduces fails (any field: totals, counts or the event digest)', () => {
    for (const field of ['total', 'hits', 'crits', 'uses', 'dot'] as const) {
      const { errors } = checkLabCoverage(input, { pins: withGoldens((g) => void (g[String(sword.id)] = { ...g[String(sword.id)], [field]: g[String(sword.id)][field] + 1 })) })
      expect(rulesOf(errors), field).toEqual([`golden i:${sword.id}`])
    }
    const { errors } = checkLabCoverage(input, { pins: withGoldens((g) => void (g[String(sword.id)] = { ...g[String(sword.id)], digest: '00000000' })) })
    expect(rulesOf(errors)).toEqual([`golden i:${sword.id}`])
  })

  it('a pin for a weapon that is not simulable, or not in the dataset, is stale', () => {
    const limited = dataset.weapons.find((w) => !assessWeapon(w).simulable)!
    const { errors } = checkLabCoverage(input, { pins: withGoldens((g) => void ((g[String(limited.id)] = g[String(sword.id)]), (g['999999'] = g[String(sword.id)]))) })
    expect(rulesOf(errors).sort()).toEqual([`stale-golden i:${limited.id}`, 'stale-golden i:999999'].sort())
  })

  it('a bow’s pinned ammo must be ammo the sim fires from it; the run uses exactly that ammo', () => {
    const pinned = PINS.goldens[String(bow.id)]
    expect(dataset.items.find((i) => i.id === pinned.ammo)?.name).toBe('Wooden Arrow') // the Lab's default: the class's namesake
    const bullet = dataset.items.find((i) => i.name === 'Musket Ball')!
    const { errors } = checkLabCoverage(input, { pins: withGoldens((g) => void (g[String(bow.id)] = { ...pinned, ammo: bullet.id })) })
    expect(rulesOf(errors)).toEqual([`golden i:${bow.id}`])
    expect(errors[0].message).toContain(`its pinned ammo i:${bullet.id} is not`)
  })

  it(`a weapon whose ${GOLDEN_RUN_SECONDS} s golden run lands no hit can't be pinned (a blank behavior, P3-S13 AC4)`, () => {
    // Test-only: the sword's reach shrunk to half a tile — it never reaches the point-blank dummy.
    const lab = sword.labBehavior
    if (lab.kind !== 'archetype' || lab.params.archetype !== 'swing-melee') throw new Error('fixture drift')
    const short: Weapon = { ...sword, labBehavior: { ...lab, params: { ...lab.params, reachTiles: 0.5 } } }
    const { errors } = checkLabCoverage({ ...input, weapons: input.weapons.map((w) => (w.id === sword.id ? short : w)) }, { pins: PINS })
    expect(rulesOf(errors)).toEqual([`golden i:${sword.id}`])
    expect(errors[0]).toMatchObject({ message: expect.stringContaining('lands no hit') })
    expect(errors[0]).not.toHaveProperty('computed')
  })

  it('without pins (a dataset not registered) no golden or floor check runs', () => {
    const { errors, simulable } = checkLabCoverage(input)
    expect(errors).toEqual([])
    expect(simulable).toBe(149)
  })
})

describe('(c) typed reasons — E_LAB_UNHANDLED', () => {
  const limited = dataset.weapons.find((w) => w.labBehavior.kind === 'limitation')!
  const others = (assess: (w: Weapon) => WeaponAssessment) => (w: Weapon) => (w.id === limited.id ? assess(w) : assessWeapon(w))
  const refusalOf = (w: Weapon) => {
    const v = assessWeapon(w)
    if (v.simulable) throw new Error('fixture drift')
    return v.refusal
  }
  const unhandled = (assess: (w: Weapon) => WeaponAssessment) => checkLabCoverage(input, { assess: others(assess) }).errors

  it('every non-simulable weapon in the app dataset carries a typed refusal (339 limitation cards)', () => {
    const reasons = dataset.weapons.flatMap((w) => {
      const v = assessWeapon(w)
      return v.simulable ? [] : [v.refusal.reason]
    })
    expect(reasons).toHaveLength(339)
    expect(new Set(reasons)).toEqual(new Set(['limitation']))
    expect(checkLabCoverage(input).errors).toEqual([])
  })

  it('the guard throwing is a violation (never a crash)', () => {
    const errors = unhandled(() => {
      throw new Error('boom')
    })
    expect(errors).toEqual([expect.objectContaining({ code: 'E_LAB_UNHANDLED', itemId: limited.id, message: expect.stringContaining('the sim guard threw (boom)') })])
  })

  it('an unknown reason, a non-refusal, or an empty message is a violation', () => {
    const base = refusalOf(limited)
    const cases: WeaponAssessment[] = [
      { simulable: false, refusal: { ...base, reason: 'because' as never } },
      { simulable: false, refusal: { ...base, kind: 'invalid-setup' as never } },
      { simulable: false, refusal: { ...base, message: '  ' } },
    ]
    for (const verdict of cases) expect(rulesOf(unhandled(() => verdict))).toEqual([`unhandled i:${limited.id}`])
  })

  it('a limitation card missing any of its three texts (P3-S13 AC3), or a scenario without an id, is a violation', () => {
    const base = refusalOf(limited)
    for (const field of ['inGameBehavior', 'reason', 'sourceUrl'] as const) {
      const errors = unhandled(() => ({ simulable: false, refusal: { ...base, limitation: { ...base.limitation!, [field]: '' } } }))
      expect(errors[0]?.message, field).toContain(`its limitation card lacks ${field}`)
    }
    expect(unhandled(() => ({ simulable: false, refusal: { ...base, limitation: undefined } }))[0]?.message).toContain('lacks inGameBehavior, reason, sourceUrl')
    expect(unhandled(() => ({ simulable: false, refusal: { ...base, reason: 'custom-scenario', scenarioId: '' } }))[0]?.message).toContain('names no scenario')
    expect(unhandled(() => ({ simulable: false, refusal: { ...base, reason: 'custom-scenario', scenarioId: 'flask-scenario' } }))).toEqual([])
  })

  it('other typed sim refusals (e.g. a modifier the engine doesn’t implement) are typed reasons', () => {
    const base = refusalOf(limited)
    expect(unhandled(() => ({ simulable: false, refusal: { ...base, reason: 'modifier-not-implemented', limitation: undefined } }))).toEqual([])
  })
})
