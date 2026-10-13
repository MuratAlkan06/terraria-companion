/**
 * Assumptions the Lab UI adds on top of the engine's registry (src/sim/approximations.ts), shown in
 * the AssumptionsTip next to an EstimateLabel (UX_SPEC §8; TASK_CONTRACT "Simulation honesty") —
 * each tip lists the assumptions its own number depends on (`assumptionsForEstimate`).
 *
 * - `swing-reach-arc`: AMENDMENTS-010 B44 / B49 — swing arc and reach are Lab MODELING CHOICES and
 *   must be labeled as such wherever the Lab uses them (the engine's `swing-geometry` entry covers
 *   the hitbox shape, not where the numbers come from). Quote and page: pipeline/merge/labParams.ts
 *   RULE_QUOTES.swingOverHead.
 * - `dps-while-attacking`: how the HUD's live estimate is measured (labSession.ts).
 * - The engine's `cadence` entry is shown in plain words (`inPlainWords`); every other engine
 *   approximation is shown verbatim.
 */
import type { Archetype } from '../schemas'
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
    title: 'DPS counts time spent attacking',
    detail:
      'Estimated DPS = total damage ÷ the time spent in whole attacks since the last reset; idle time is not counted. Attacks/sec is 60 ÷ the weapon’s effective use time.',
  },
} as const satisfies Record<string, LabAssumption>

/** Lab-level assumptions per archetype (listed before the engine's). */
const BY_ARCHETYPE: Partial<Record<Archetype, readonly LabAssumption[]>> = {
  'swing-melee': [LAB_ASSUMPTIONS['swing-reach-arc']],
}

/**
 * The engine's `cadence` entry names game internals (useAnimation, useTime) and mentions shots. The
 * tip says the same rule in plain words, and mentions repeated shots only for archetypes that can
 * fire several in one attack — never for a single strike (a swing, thrust or whip crack).
 */
const CADENCE_PLAIN =
  "One attack every 'use time' ticks (the wiki's use time, which is the game's attack animation time); auto-swing melee weapons attack one tick sooner, as the wiki documents."
const CADENCE_SHOTS = ' Shots inside one attack repeat at the weapon’s per-hit interval.'
const SINGLE_STRIKE: ReadonlySet<Archetype> = new Set<Archetype>(['swing-melee', 'thrust', 'whip'])

function inPlainWords(archetype: Archetype, approximation: Approximation): LabAssumption {
  if (approximation.id !== 'cadence') return approximation
  return { ...approximation, detail: CADENCE_PLAIN + (SINGLE_STRIKE.has(archetype) ? '' : CADENCE_SHOTS) }
}

/**
 * The full list for an AssumptionsTip: archetype modeling choices, the HUD's measurement rule,
 * then every engine approximation for the equipped weapon — verbatim, except the attack-rate rule,
 * which is re-worded in plain words (above).
 */
export function labAssumptionsFor(archetype: Archetype, engine: readonly Approximation[]): LabAssumption[] {
  return [...(BY_ARCHETYPE[archetype] ?? []), LAB_ASSUMPTIONS['dps-while-attacking'], ...engine.map((a) => inPlainWords(archetype, a))]
}

/** The HUD numbers that carry an EstimateLabel. */
export type LabEstimate = 'attacks-per-sec' | 'estimated-dps'

/**
 * Assumptions that decide the attack rate (design review M5): the rate rule itself, the 60 Hz
 * tick it is counted in, held attacks repeating, and base stats only (no speed bonuses). Hit
 * geometry, damage rolls, crits and defense don't change how often the weapon attacks.
 */
const CADENCE_IDS: ReadonlySet<string> = new Set(['fixed-tick', 'cadence', 'auto-reuse', 'no-equipment'])

/**
 * The assumptions behind one HUD estimate, in the full list's order: est. DPS depends on all of
 * them (modeling choices first); attacks/sec only on the cadence ones.
 */
export function assumptionsForEstimate<A extends { id: string }>(all: readonly A[], estimate: LabEstimate): A[] {
  return estimate === 'estimated-dps' ? [...all] : all.filter((a) => CADENCE_IDS.has(a.id))
}
