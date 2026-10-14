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
 * - `target-distance`: weapons that fire projectiles face the dummy RANGED_TARGET_X_TILES away
 *   (./labSetup.ts) — a Lab choice that decides how many spread shots land, listed with the
 *   modeling choices.
 * - `ammo-effects` (bows and guns, design review P3-S4/S5 H2): only each ammo's damage and speed
 *   reach the engine; special ammo effects are not modeled — said plainly with the modeling choices.
 * - `target-row` (PRD P3-S6): Multiple Dummies is a Lab test setup (count, spacing, which dummy is the
 *   primary target) — listed with the modeling choices while that target is chosen.
 * - `attack-until-back` (PRD P3-S7): for a weapon that comes back to hand, how long one attack lasts
 *   in the HUD's measurements (labSession.ts) — right after the rule it extends.
 * - `dps-while-attacking`: how the HUD's live estimate is measured (labSession.ts) — first in its tip.
 * - `attack-rate`: how the HUD's live attacks/sec is measured — the latest RATE_WINDOW_ATTACKS attacks
 *   (labSession.ts, design review P3-S4/S5 H3) — it heads the attacks/sec tip only (no DPS figure is
 *   measured that way).
 * - `hit-rate`: a tethered weapon's (yoyo's) HUD shows hits/sec in place of attacks/sec (design review
 *   P3-S6/S7) — it heads that readout's tip.
 * - `timed-test` / `dps-graph`: how the standardized test's result and the per-second graph are
 *   measured (PRD P3-S3 AC2–AC4); they replace `dps-while-attacking` at the head of their own tips.
 * - Summons (PRD P3-S9 / P3-S10): `dps-with-summons` replaces `dps-while-attacking` while minions or
 *   sentries are involved (they attack all the time, so the live estimate divides by the time since the
 *   first one appeared — labSession.ts); `summon-hit-rate` heads a summon staff's hits/sec readout;
 *   `target-reach` is the dummy distance for whips and summons (the projectile copy of
 *   `target-distance` would not describe them); `minion-loadout` explains the minions out beside a whip.
 *   The engine's own whip and summon entries come right after the modeling choices, before its generic
 *   ones (design review M6).
 * - Every engine approximation is shown verbatim (its copy is already in plain words).
 */
import type { Archetype, Weapon } from '../schemas'
import { DUMMY_ROW_SPACING_TILES, type Approximation } from '../sim'
import { firesProjectiles, RANGED_TARGET_X_TILES, ROW_COUNTS, type LabTarget } from './labSetup'

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
  'target-distance': {
    id: 'target-distance',
    title: `Dummy ${RANGED_TARGET_X_TILES} tiles away`,
    detail: `For weapons that fire projectiles, the Infinite Dummy’s centre stands ${RANGED_TARGET_X_TILES} tiles in front of you (melee weapons test at point-blank), so shots visibly travel before they land. Spread shots can miss at this range, as they would in-game from there. The distance is a Lab choice.`,
  },
  'target-reach': {
    id: 'target-reach',
    title: `Dummy ${RANGED_TARGET_X_TILES} tiles away`,
    detail: `For whips, minions and sentries the Infinite Dummy’s centre stands ${RANGED_TARGET_X_TILES} tiles in front of you, as for weapons that fire projectiles (melee weapons test at point-blank): inside every whip’s range, with room for summons to reach it. The distance is a Lab choice.`,
  },
  'minion-loadout': {
    id: 'minion-loadout',
    title: 'Minion loadout: minions out beside the whip',
    detail:
      'The minion loadout is a Lab test setup: with a whip equipped, the chosen minion staff’s minions are out from the start — as many as your minion slots hold — and come back fresh with every restart, so the whip’s tags can boost them. In-game you summon them yourself before switching to the whip. Reset clears the loadout.',
  },
  'dps-with-summons': {
    id: 'dps-with-summons',
    title: 'Divided by the time since the first summon',
    detail:
      'Minions and sentries attack all the time, not only while you attack, so once one is out, estimated DPS = total damage ÷ the time since the first one appeared (or the time spent in whole attacks, if that is longer). Before any summon it divides by the time spent attacking.',
  },
  'summon-hit-rate': {
    id: 'summon-hit-rate',
    title: 'Summon hits per second',
    detail:
      'A summon staff attacks through what it summons, so the Lab counts their hits, not your uses of the staff: Hits/sec = hits ÷ the time since the first summon appeared (the same time estimated DPS divides by). With Multiple Dummies it counts the hits on every dummy.',
  },
  'target-row': {
    id: 'target-row',
    title: `Multiple Dummies: a row ${DUMMY_ROW_SPACING_TILES} tiles apart`,
    detail: `Multiple Dummies stands ${ROW_COUNTS[0]} to ${ROW_COUNTS.at(-1)} Infinite Dummies in a row on flat ground, centres ${DUMMY_ROW_SPACING_TILES} tiles apart, the first where the single dummy stands. The first is the primary target — the one holding Space and the timed tests aim at — and its numbers are shown apart from the totals over all dummies. The row is a Lab test setup.`,
  },
  'attack-until-back': {
    id: 'attack-until-back',
    title: 'A throw lasts until it is back',
    detail:
      'For weapons that are thrown and come back (boomerangs, launched flails, yoyos), an attack lasts until the weapon is back in your hand — at least its use time — because the next throw waits for it. A yoyo held out counts as one long attack, so for a yoyo the Lab shows hits per second rather than attacks per second.',
  },
  'hit-rate': {
    id: 'hit-rate',
    title: 'Hits per second while it is out',
    detail:
      'A yoyo stays out — one long attack — for as long as you hold attack, hitting all the while, so the Lab counts its hits, not its throws: Hits/sec = hits ÷ the time spent attacking (each throw until the yoyo is back in hand), the same time est. DPS divides by; idle time is not counted. With Multiple Dummies it counts the hits on every dummy.',
  },
  'ammo-effects': {
    id: 'ammo-effects',
    title: 'Special ammo effects not modeled',
    detail: 'The Lab uses only each ammo’s damage and speed: special effects — homing, splitting, explosions, debuffs, burning — are not modeled.',
  },
  'dps-while-attacking': {
    id: 'dps-while-attacking',
    title: 'Divided by the time spent attacking',
    detail:
      'Estimated DPS = total damage ÷ the time spent in whole attacks since the last reset — each attack’s use time plus any cooldown after it, as a held attack repeats; idle time is not counted.',
  },
  'attack-rate': {
    id: 'attack-rate',
    title: 'Counted from the latest attacks',
    detail:
      'Attacks/sec = the latest 5 attacks ÷ the time they took (each attack’s use time, plus any cooldown); idle time is not counted, and before the first attack it shows the weapon’s own rate. Casts slowed for lack of mana count at their slowed length, so the rate drops within a few casts.',
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

/** Archetypes whose dummy distance is `target-reach` (a whip's sweep, summons) rather than a shot's `target-distance`. */
const REACH_ARCHETYPES: readonly Archetype[] = ['whip', 'minion-sentry']

function archetypeAssumptions(archetype: Archetype): readonly LabAssumption[] {
  const distance = REACH_ARCHETYPES.includes(archetype) ? LAB_ASSUMPTIONS['target-reach'] : LAB_ASSUMPTIONS['target-distance']
  return [
    ...(BY_ARCHETYPE[archetype] ?? []),
    ...(firesProjectiles(archetype) ? [distance] : []),
    ...(archetype === 'bow-gun' ? [LAB_ASSUMPTIONS['ammo-effects']] : []),
  ]
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
 * The engine's whip and summon mechanics (how the whip swings and tags, slots, attacks, targeting, each
 * AI class, sentry placement): listed right after the modeling choices, ahead of the generic engine
 * entries (defense, knockback, …) that say nothing specific about a summoner's numbers (design review M6).
 */
const SUMMONER_IDS: ReadonlySet<string> = new Set([
  'whip-swing',
  'whip-tag',
  'summon-slots',
  'summon-attack',
  'summon-target',
  'minion-melee-contact',
  'minion-ground-melee',
  'minion-hover-strike',
  'minion-ranged-shot',
  'sentry-placement',
])

/** What else decides the list: the Lab's target (Multiple Dummies) and whether the weapon comes back to hand. */
export interface LabAssumptionContext {
  target?: LabTarget
  /** WeaponSummary.returnsToHand: an attack lasts until the thrown weapon is back. */
  returnsToHand?: boolean
  /** Minions or sentries are involved (a summon staff, or the minion loadout): the live DPS rule changes. */
  summons?: boolean
  /** The minion loadout is on (its minions are out beside the equipped weapon). */
  loadout?: boolean
}

/**
 * The full list for an AssumptionsTip: modeling choices (the archetype's and the target's, then the
 * engine's convention labels — those carry a `ruling`) or the stated reach they replace, the engine's
 * whip and summon mechanics (`SUMMONER_IDS`), the HUD's measurement rule (and, for a weapon that comes
 * back, how long one of its attacks lasts), then every other engine approximation for the equipped
 * weapon, verbatim.
 */
export function labAssumptionsFor(
  archetype: Archetype,
  engine: readonly Approximation[],
  weapon: Pick<Weapon, 'wikiUrl' | 'labBehavior'>,
  context: LabAssumptionContext = {},
): LabAssumption[] {
  const summoner = (a: Approximation) => !a.ruling && SUMMONER_IDS.has(a.id)
  return [
    ...archetypeAssumptions(archetype),
    ...(context.target?.kind === 'row' ? [LAB_ASSUMPTIONS['target-row']] : []),
    ...(context.loadout ? [LAB_ASSUMPTIONS['minion-loadout']] : []),
    ...engine.filter((a) => a.ruling),
    ...statedThrustReach(weapon, engine),
    ...engine.filter(summoner),
    context.summons ? LAB_ASSUMPTIONS['dps-with-summons'] : LAB_ASSUMPTIONS['dps-while-attacking'],
    ...(context.returnsToHand ? [LAB_ASSUMPTIONS['attack-until-back']] : []),
    ...engine.filter((a) => !a.ruling && !summoner(a)),
  ]
}

/** The HUD numbers that carry an EstimateLabel. */
export type LabEstimate = 'attacks-per-sec' | 'hits-per-sec' | 'summon-hits-per-sec' | 'estimated-dps' | 'timed-test-dps' | 'dps-graph'

/**
 * The measurement rule that heads each DPS estimate's tip — what the damage is divided by comes
 * first (design review P3-S2/S3: two est. DPS figures, each tip states its denominator first).
 */
const MEASURED_BY: Record<LabEstimate, LabAssumption> = {
  'attacks-per-sec': LAB_ASSUMPTIONS['attack-rate'],
  'hits-per-sec': LAB_ASSUMPTIONS['hit-rate'],
  'summon-hits-per-sec': LAB_ASSUMPTIONS['summon-hit-rate'],
  'estimated-dps': LAB_ASSUMPTIONS['dps-while-attacking'],
  'timed-test-dps': LAB_ASSUMPTIONS['timed-test'],
  'dps-graph': LAB_ASSUMPTIONS['dps-graph'],
}

/** The live estimate's own measurement rules (one of them leads the list — `labAssumptionsFor`). */
const LIVE_DPS_RULES: ReadonlySet<string> = new Set([LAB_ASSUMPTIONS['dps-while-attacking'].id, LAB_ASSUMPTIONS['dps-with-summons'].id])

/**
 * Assumptions that decide the attack rate (design review M5): the rate rule itself, the 60 Hz
 * tick it is counted in, held attacks repeating, a cooldown after each attack, base stats only (no
 * speed bonuses), and — for mana weapons — the slowed low-mana cast and its cooldown. Hit geometry,
 * damage rolls, crits and defense don't change how often the weapon attacks.
 */
const CADENCE_IDS: ReadonlySet<string> = new Set(['fixed-tick', 'cadence', 'reuse-delay', 'auto-reuse', 'no-equipment', 'insufficient-mana', 'slow-cast-cooldown', 'attack-until-back'])

/**
 * What decides a yoyo's hit rate: the cadence (how soon it is thrown again), how its time out is
 * counted, how it moves and how often it may re-hit a dummy (`yoyo-control`: every 10 ticks), and how
 * many dummies there are to hit.
 */
const HIT_RATE_IDS: ReadonlySet<string> = new Set([...CADENCE_IDS, 'yoyo-control', 'target-row'])

/**
 * What decides a summon staff's hit rate: the tick, how many summons the slots hold, how often each
 * attacks (the stated or modeled rate — B63 P-2 / P-3 labels), whom they target, how its class attacks,
 * where a sentry stands, and how many dummies there are.
 */
const SUMMON_RATE_IDS: ReadonlySet<string> = new Set([
  'fixed-tick',
  'no-equipment',
  'summon-slots',
  'summon-attack',
  'summon-target',
  'summon-average-rate',
  'summon-hit-cap',
  'minion-melee-contact',
  'minion-ground-melee',
  'minion-hover-strike',
  'minion-ranged-shot',
  'sentry-placement',
  'target-row',
])

/**
 * The assumptions behind one HUD estimate, led by how it is measured: attacks/sec by `attack-rate`,
 * then only the cadence ones in the full list's order; a yoyo's hits/sec by `hit-rate`, then what
 * decides its hit rate. Each DPS figure depends on all of them: the live est. DPS led by
 * `dps-while-attacking` (then the modeling choices and the rest, in order); the timed-test result and
 * the DPS graph by their own rule, which replaces the live estimate's.
 */
export function assumptionsForEstimate<A extends { id: string }>(all: readonly A[], estimate: LabEstimate): (A | LabAssumption)[] {
  const measured = MEASURED_BY[estimate]
  if (estimate === 'attacks-per-sec') return [measured, ...all.filter((a) => CADENCE_IDS.has(a.id))]
  if (estimate === 'hits-per-sec') return [measured, ...all.filter((a) => HIT_RATE_IDS.has(a.id))]
  if (estimate === 'summon-hits-per-sec') return [measured, ...all.filter((a) => SUMMON_RATE_IDS.has(a.id))]
  // The live estimate is led by the rule the list carries (with summons: `dps-with-summons`).
  const live = estimate === 'estimated-dps' ? all.find((a) => LIVE_DPS_RULES.has(a.id)) : undefined
  return [live ?? measured, ...all.filter((a) => !LIVE_DPS_RULES.has(a.id))]
}
