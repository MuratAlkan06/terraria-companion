/**
 * P3-S13 Weapon Lab coverage gate — AMENDMENTS-016 B115 (re-rules A3's retired "≥60% simulable" target).
 * Build-failing: `validateDataset` runs it, so `npm run pipeline:build` and `npm run pipeline:validate`
 * both fail on a violation. "Simulable" is the sim's own verdict (src/sim `assessWeapon`), never the
 * record's `labBehavior.kind` alone.
 *
 * (a) SIMULABLE FLOOR (`E_LAB_COVERAGE` rule `simulable-floor`) — the number of simulable weapons may
 *     never decrease. `LAB_COVERAGE_PINS[<manifest name>].floor` pins it.
 *     UPDATE RULE: upward only, by hand, set to the new count in the same change that makes more weapons
 *     simulable (a count above the floor passes, so forgetting to raise it never blocks — it only stops
 *     protecting the gain). Never lowered: a change that leaves fewer weapons simulable is rejected, and
 *     lowering the floor needs a new orchestrator ruling (B115).
 * (b) GOLDENS (`E_LAB_COVERAGE` rule `golden`) — every simulable weapon has a pinned golden (labGoldens.json,
 *     per dataset) that its golden run reproduces: a 10 s timed test (600 ticks) on the engine's defaults —
 *     DEFAULT_SEED, the default point-blank Target Dummy, DEFAULT_LAB_SETTINGS — with the dataset's buff
 *     registry and, for a bow or gun, the pinned `ammo` item. Fingerprint = the run's total / DoT damage,
 *     hits, crits, uses and event digest (the shape of src/sim determinism.test.ts GOLDEN_30S). A run that
 *     lands no hit is never pinnable (a blank behavior, PRD P3-S13 AC4); a golden pinned for a weapon that
 *     is not simulable is stale and fails too (rule `stale-golden`), so the table always equals the
 *     simulable set.
 *     RE-PIN (AMENDMENTS-008 B38 discipline): an intentional engine change, or a data change to a simulable
 *     weapon or its ammo, re-pins in the same change — `npx tsx pipeline/validate/pinLabGoldens.ts` writes
 *     exactly the failing entries (each error carries its `computed` fingerprint) — with a src/sim/README.md
 *     changelog entry naming why. A new weapon's suggested ammo is the Lab's default (the class's namesake
 *     item when the engine fires it, else the weakest it fires — src/lab/labSetup.ts `ammoChoices`).
 * (c) TYPED REASONS (`E_LAB_UNHANDLED`, DATA_SCHEMA_SPEC §6) — every non-simulable weapon's verdict is a
 *     typed `not-simulable` refusal: a known reason, a message, and what the Lab renders for it — a
 *     limitation card's three texts (P3-S13 AC3: what it does in-game, why it isn't simulated, the source)
 *     or a custom scenario's id. The guard throwing is a violation too (never a crash, never a guess).
 *
 * (a) and (b) apply to datasets with pins (the app dataset); every dataset gets (c). The P2-S1 sample and
 * test fixtures have no pins — tests mutate them freely (labCoverage.test.ts pins that the app dataset's
 * manifest name stays registered, so a rename can't switch the gate off).
 */
import type { Buff, Item, Weapon } from '../../src/schemas'
import { assessWeapon, createLabSim, DEFAULT_SEED, type NotSimulableReason, type WeaponAssessment } from '../../src/sim'
import type { PipelineError } from './errors'
import LAB_GOLDENS from './labGoldens.json'

/** One weapon's golden fingerprint. `ammo`: the ammo item a bow or gun fires in its golden run. */
export interface LabGolden {
  ammo?: number
  total: number
  dot: number
  hits: number
  crits: number
  uses: number
  digest: string
}

export interface LabCoveragePins {
  /** B115 (a): the simulable count may not fall below this (see the update rule above). */
  floor: number
  /** B115 (b): weapon id → golden fingerprint. */
  goldens: Readonly<Record<string, LabGolden>>
}

/** Golden runs: a 10 s timed test (seconds; 600 ticks). */
export const GOLDEN_RUN_SECONDS = 10

/**
 * Pins per dataset manifest name. `wiki-sync` (src/data): 149 of 488 weapons simulable at B115
 * (2026-10-15) — swing-melee 37, bow-gun 38, returning 22, thrust 18, explosive-aoe 15, minion-sentry 10,
 * whip 6, magic-bolt 3.
 */
export const LAB_COVERAGE_PINS: Readonly<Record<string, LabCoveragePins>> = {
  'wiki-sync': { floor: 149, goldens: LAB_GOLDENS['wiki-sync'] },
}

/** Every typed reason the sim can give (compile-time exhaustive over NotSimulableReason). */
const TYPED_REASONS: Readonly<Record<NotSimulableReason, true>> = {
  limitation: true,
  'custom-scenario': true,
  'archetype-not-implemented': true,
  'modifier-not-implemented': true,
  'missing-required-field': true,
  'unverified-required-field': true,
  'invalid-data': true,
  'dependency-data-unavailable': true,
}

export interface LabCoverageInput {
  weapons: readonly Weapon[]
  /** Items; those with `ammoStats` are the ammo a bow or gun may fire. */
  items: readonly Item[]
  buffs: readonly Buff[]
}

export interface LabCoverageOptions {
  /** Pins for this dataset (absent: only (c) applies). */
  pins?: LabCoveragePins
  /** The sim guard (default src/sim `assessWeapon`; injectable so tests can prove (c) fails). */
  assess?: (weapon: Weapon) => WeaponAssessment
}

export interface LabCoverageReport {
  errors: PipelineError[]
  simulable: number
}

const nonEmpty = (s: unknown): boolean => typeof s === 'string' && s.trim() !== ''
const ref = (weapon: Weapon) => `i:${weapon.id}`
const sameGolden = (a: LabGolden, b: LabGolden) =>
  a.ammo === b.ammo && a.total === b.total && a.dot === b.dot && a.hits === b.hits && a.crits === b.crits && a.uses === b.uses && a.digest === b.digest

/** The fingerprint as the error messages and labGoldens.json show it. */
export const formatGolden = (g: LabGolden): string => JSON.stringify(g)

/** Why a non-simulable verdict can't be rendered as a typed refusal (null = it can). */
function untypedReason(verdict: Extract<WeaponAssessment, { simulable: false }>): string | null {
  const r = verdict.refusal as Partial<typeof verdict.refusal> | undefined
  if (r?.kind !== 'not-simulable') return `its refusal is not a typed not-simulable verdict (kind ${JSON.stringify(r?.kind)})`
  if (typeof r.reason !== 'string' || !Object.hasOwn(TYPED_REASONS, r.reason)) return `its refusal reason ${JSON.stringify(r.reason)} is not a typed NotSimulable reason`
  if (!nonEmpty(r.message)) return `its "${r.reason}" refusal has no message`
  if (r.reason === 'limitation') {
    const card = r.limitation
    const missing = (['inGameBehavior', 'reason', 'sourceUrl'] as const).filter((k) => !nonEmpty(card?.[k]))
    if (missing.length > 0) return `its limitation card lacks ${missing.join(', ')} (P3-S13 AC3)`
  }
  if (r.reason === 'custom-scenario' && !nonEmpty(r.scenarioId)) return 'its custom-scenario refusal names no scenario'
  return null
}

/** Ammo of the class the engine fires from this weapon, weakest first (damage, then id) — the Lab's order. */
function usableAmmo(weapon: Weapon, ammoClass: string, items: readonly Item[], buffs: readonly Buff[]): Item[] {
  return items
    .filter((item) => item.ammoStats?.ammoClass === ammoClass && createLabSim({ weapon, ammo: item, buffs }).ok)
    .sort((a, b) => (a.ammoStats?.damage ?? 0) - (b.ammoStats?.damage ?? 0) || a.id - b.id)
}

/** The ammo a NEW golden suggests: the class's namesake item when usable, else the weakest usable (src/lab/labSetup.ts rule). */
function suggestedAmmo(usable: readonly Item[], ammoClass: string): Item | undefined {
  return usable.find((item) => item.slug === ammoClass) ?? usable[0]
}

/** The weapon's golden run, or why it can't run. */
export function goldenRun(weapon: Weapon, ammo: Item | undefined, buffs: readonly Buff[]): { ok: true; golden: LabGolden } | { ok: false; detail: string } {
  const created = createLabSim({ weapon, buffs, seed: DEFAULT_SEED, ...(ammo ? { ammo } : {}) })
  if (!created.ok) return { ok: false, detail: `the sim refuses its golden setup: ${created.refusal.reason} — ${created.refusal.message}` }
  const { sim } = created
  sim.startTimedTest(GOLDEN_RUN_SECONDS)
  sim.step(GOLDEN_RUN_SECONDS * 60)
  const result = sim.snapshot().timedTest.result
  if (!result) return { ok: false, detail: 'its golden run did not finish' }
  const golden: LabGolden = {
    ...(ammo ? { ammo: ammo.id } : {}),
    total: result.totalDamage,
    dot: result.dotDamage,
    hits: result.hits,
    crits: result.crits,
    uses: result.uses,
    digest: result.eventDigest,
  }
  return { ok: true, golden }
}

/** B115 (a)–(c) over a parsed dataset's weapons (see the header). */
export function checkLabCoverage(input: LabCoverageInput, options: LabCoverageOptions = {}): LabCoverageReport {
  const assess = options.assess ?? assessWeapon
  const { pins } = options
  const errors: PipelineError[] = []
  const goldenError = (weapon: Weapon, message: string, computed?: LabGolden) =>
    errors.push({ code: 'E_LAB_COVERAGE', rule: 'golden', ref: ref(weapon), message: `${ref(weapon)} ${weapon.name}: ${message}`, ...(computed ? { computed } : {}) })
  let simulable = 0
  const simulableIds = new Set<string>()

  for (const weapon of input.weapons) {
    let verdict: WeaponAssessment
    try {
      verdict = assess(weapon)
    } catch (error) {
      errors.push({ code: 'E_LAB_UNHANDLED', itemId: weapon.id, message: `${ref(weapon)} ${weapon.name}: the sim guard threw (${(error as Error).message}) — every weapon needs a typed verdict` })
      continue
    }
    if (!verdict.simulable) {
      const why = untypedReason(verdict)
      if (why) errors.push({ code: 'E_LAB_UNHANDLED', itemId: weapon.id, message: `${ref(weapon)} ${weapon.name} is not simulable, but ${why}` })
      continue
    }
    simulable += 1
    simulableIds.add(String(weapon.id))
    if (!pins) continue

    const pinned = pins.goldens[String(weapon.id)]
    let ammo: Item | undefined
    if (verdict.requiresAmmoClass !== null) {
      const usable = usableAmmo(weapon, verdict.requiresAmmoClass, input.items, input.buffs)
      ammo = pinned?.ammo !== undefined ? usable.find((item) => item.id === pinned.ammo) : suggestedAmmo(usable, verdict.requiresAmmoClass)
      if (!ammo) {
        goldenError(weapon, pinned?.ammo !== undefined ? `its pinned ammo i:${pinned.ammo} is not ${verdict.requiresAmmoClass} ammo the sim fires from it` : `no ${verdict.requiresAmmoClass} ammo the sim fires from it`)
        continue
      }
    }
    const run = goldenRun(weapon, ammo, input.buffs)
    if (!run.ok) {
      goldenError(weapon, run.detail)
      continue
    }
    if (run.golden.hits === 0) {
      goldenError(weapon, `its golden run lands no hit in ${GOLDEN_RUN_SECONDS} s — a blank behavior can't be pinned (P3-S13 AC4)`)
      continue
    }
    if (!pinned) goldenError(weapon, `no golden pinned (B115 b); it produces ${formatGolden(run.golden)}`, run.golden)
    else if (!sameGolden(pinned, run.golden)) goldenError(weapon, `golden fails: pinned ${formatGolden(pinned)}, now ${formatGolden(run.golden)} — re-pin only for an intended change (B38)`, run.golden)
  }

  if (pins) {
    for (const id of Object.keys(pins.goldens)) {
      if (simulableIds.has(id)) continue
      const weapon = input.weapons.find((w) => String(w.id) === id)
      errors.push({ code: 'E_LAB_COVERAGE', rule: 'stale-golden', ref: `i:${id}`, message: `i:${id}${weapon ? ` ${weapon.name}` : ''}: stale golden — the weapon is ${weapon ? 'not simulable' : 'not in the dataset'}; remove its pin` })
    }
    if (simulable < pins.floor) {
      errors.push({
        code: 'E_LAB_COVERAGE',
        rule: 'simulable-floor',
        ref: 'collection:weapons',
        message: `${simulable} simulable weapons, below the pinned floor of ${pins.floor} — the simulable count may never decrease (B115 a)`,
      })
    }
  }
  return { errors, simulable }
}
