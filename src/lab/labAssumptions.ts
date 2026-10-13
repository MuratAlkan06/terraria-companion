/**
 * Assumptions the Lab UI adds on top of the engine's registry (src/sim/approximations.ts), shown in
 * the AssumptionsTip next to an EstimateLabel (UX_SPEC §8; TASK_CONTRACT "Simulation honesty") —
 * each tip lists the assumptions its own number depends on (`assumptionsForEstimate`).
 *
 * - `swing-reach-arc`: AMENDMENTS-010 B44 / B49 — swing arc and reach are Lab MODELING CHOICES and
 *   must be labeled as such wherever the Lab uses them (the engine's `swing-geometry` entry covers
 *   the hitbox shape, not where the numbers come from). Quote and page: pipeline/merge/labParams.ts
 *   RULE_QUOTES.swingOverHead.
 * - Thrust reach: a formula reach (AMENDMENTS-010 B46) is labeled by the engine's own `thrust-reach`
 *   entry, which the engine adds only when the record lists the reach in `_prov.modeledFields`. A
 *   reach the article states (AMENDMENTS-012 B56) is wiki data: the Lab cites it instead
 *   (`thrust-reach-stated`). Either way the reach line sits with the modeling choices, ahead of the
 *   engine's other approximations.
 * - `dps-while-attacking`: how the HUD's live estimate is measured (labSession.ts) — first in its tip.
 * - `timed-test` / `dps-graph`: how the standardized test's result and the per-second graph are
 *   measured (PRD P3-S3 AC2–AC4); they replace `dps-while-attacking` at the head of their own tips.
 * - Every engine approximation is shown verbatim (its copy is already in plain words).
 */
import type { Archetype, Weapon } from '../schemas'
import type { Approximation } from '../sim'

/** Same shape as an engine approximation, so the tip renders both identically. */
export interface LabAssumption {
  id: string
  title: string
  detail: string
  sourceUrl?: string
}

const WIKI = 'https://terraria.wiki.gg/wiki/'

export const LAB_ASSUMPTIONS = {
  'swing-reach-arc': {
    id: 'swing-reach-arc',
    title: 'Swing arc and reach are modeled',
    detail:
      'The wiki gives no swing angle or reach. The Lab swings each sword through 180° (the wiki says broadswords are swung over the player’s head) with a reach equal to its sprite’s diagonal × the item’s scale. Both are Lab modeling choices, not game data.',
    sourceUrl: `${WIKI}Broadswords`,
  },
  'dps-while-attacking': {
    id: 'dps-while-attacking',
    title: 'Divided by the time spent attacking',
    detail:
      'Estimated DPS = total damage ÷ the time spent in whole attacks since the last reset; idle time is not counted. Attacks/sec is 60 ÷ the weapon’s effective use time.',
  },
  'timed-test': {
    id: 'timed-test',
    title: 'Divided by the whole test',
    detail:
      'Estimated DPS = total damage ÷ the test length: exactly 600 or 1,800 ticks (10 or 30 seconds of simulation time). The test resets the Lab, then holds attack for that long, aimed at the dummy. “Run again” replays the same random seed and settings, so it reproduces the result exactly.',
  },
  'dps-graph': {
    id: 'dps-graph',
    title: 'Damage per second, second by second',
    detail:
      'Each bar is the damage dealt during one whole second of simulation time (60 ticks), idle seconds included. The outlined bar is the current second so far.',
  },
} as const satisfies Record<string, LabAssumption>

/** Lab-level assumptions per archetype (listed before the engine's). */
const BY_ARCHETYPE: Partial<Record<Archetype, readonly LabAssumption[]>> = {
  'swing-melee': [LAB_ASSUMPTIONS['swing-reach-arc']],
}

/**
 * AMENDMENTS-012 B56 / B59: a thrust whose reach is not modeled uses the range its article states
 * ("maximum range of approximately N tiles", quote-checked by the pipeline) — cited, not labeled a
 * modeling choice. The engine's `thrust-reach` entry marks the modeled case.
 */
function statedThrustReach(weapon: Pick<Weapon, 'wikiUrl' | 'labBehavior'>, engine: readonly Approximation[]): LabAssumption[] {
  const params = weapon.labBehavior.kind === 'archetype' ? weapon.labBehavior.params : null
  if (params?.archetype !== 'thrust' || engine.some((a) => a.id === 'thrust-reach')) return []
  return [
    {
      id: 'thrust-reach-stated',
      title: 'Thrust reach is the wiki’s stated range',
      detail: `The wiki gives this weapon a maximum range of approximately ${params.reachTiles} tiles; the Lab’s thrust reaches that far.`,
      sourceUrl: weapon.wikiUrl,
    },
  ]
}

/**
 * The full list for an AssumptionsTip: modeling choices (the archetype's, then the engine's
 * convention labels — those carry a `ruling`) or the stated reach they replace, the HUD's
 * measurement rule, then every other engine approximation for the equipped weapon, verbatim.
 */
export function labAssumptionsFor(
  archetype: Archetype,
  engine: readonly Approximation[],
  weapon: Pick<Weapon, 'wikiUrl' | 'labBehavior'>,
): LabAssumption[] {
  return [
    ...(BY_ARCHETYPE[archetype] ?? []),
    ...engine.filter((a) => a.ruling),
    ...statedThrustReach(weapon, engine),
    LAB_ASSUMPTIONS['dps-while-attacking'],
    ...engine.filter((a) => !a.ruling),
  ]
}

/** The HUD numbers that carry an EstimateLabel. */
export type LabEstimate = 'attacks-per-sec' | 'estimated-dps' | 'timed-test-dps' | 'dps-graph'

/**
 * The measurement rule that heads each DPS estimate's tip — what the damage is divided by comes
 * first (design review P3-S2/S3: two est. DPS figures, each tip states its denominator first).
 */
const MEASURED_BY: Partial<Record<LabEstimate, LabAssumption>> = {
  'estimated-dps': LAB_ASSUMPTIONS['dps-while-attacking'],
  'timed-test-dps': LAB_ASSUMPTIONS['timed-test'],
  'dps-graph': LAB_ASSUMPTIONS['dps-graph'],
}

/**
 * Assumptions that decide the attack rate (design review M5): the rate rule itself, the 60 Hz
 * tick it is counted in, held attacks repeating, and base stats only (no speed bonuses). Hit
 * geometry, damage rolls, crits and defense don't change how often the weapon attacks.
 */
const CADENCE_IDS: ReadonlySet<string> = new Set(['fixed-tick', 'cadence', 'auto-reuse', 'no-equipment'])

/**
 * The assumptions behind one HUD estimate: attacks/sec only the cadence ones, in the full list's
 * order. Each DPS figure depends on all of them, led by how it is measured: the live est. DPS by
 * `dps-while-attacking` (then the modeling choices and the rest, in order); the timed-test result
 * and the DPS graph by their own rule, which replaces the live estimate's.
 */
export function assumptionsForEstimate<A extends { id: string }>(all: readonly A[], estimate: LabEstimate): (A | LabAssumption)[] {
  if (estimate === 'attacks-per-sec') return all.filter((a) => CADENCE_IDS.has(a.id))
  const measured = MEASURED_BY[estimate]
  return measured ? [measured, ...all.filter((a) => a.id !== LAB_ASSUMPTIONS['dps-while-attacking'].id)] : [...all]
}
