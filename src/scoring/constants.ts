/**
 * Editorial scoring constants (SCORING_SPEC §1.7, §2.3, §3.4, §5.2, §6; AMENDMENTS-014 B69/B71).
 * Frozen `as const`, versioned by SCORING_CONSTANTS_VERSION: changing any value bumps the version,
 * re-pins the golden tests and adds a CONSTANTS_CHANGELOG entry (B38 discipline). Pure data — no
 * React, DOM, sim or lab (SCORING_SPEC §8.3).
 *
 * The values are editorial (this site's reading), except where a wiki source is named: those are
 * game rules, verified on the page cited.
 */
import type { AttackPatternTag, DamageClass, Difficulty, StatKind } from '../schemas'

export const SCORING_CONSTANTS_VERSION = 1 as const

export const CONSTANTS_CHANGELOG = [
  {
    version: 1,
    date: '2026-10-14',
    note:
      'First set: SCORING_SPEC §2.3 STAT_POINTS rows, §3.4 slot counts + Demon Heart slot, §5.2 GOAL_WEIGHTS, §6 readiness thresholds and ' +
      'PLAYER_DEFENSE_FACTOR (verified on the wiki Defense page, oldid 1034119). The AMENDMENTS-011 B54 kinds landed by B70 have no ' +
      'v1 row: listed, not counted, until their rows are ruled (each row added bumps this version).',
  },
] as const

// --- §2.3 StatEffect point conversions ------------------------------------------------------------

/** Why a stat kind scores 0 in this version (it is still named wherever it appears). */
export type UncountedReason =
  /** §2.3 "v1 abstains" (mining speed, aggro, knockback). */
  | 'abstain'
  /** §2.3 / B69(Q8): jump-boost units are unverified. */
  | 'units-unverified'
  /** AMENDMENTS-011 B54 kind emitted by the B70 slice; its row is not ruled yet (SCORING_SPEC §2.3 last line). */
  | 'row-pending'

export interface StatPointsRow {
  /** Points per unit of the effect's value, per component (Off / Def / Mob / Surv). */
  off?: number
  def?: number
  mob?: number
  surv?: number
  /**
   * §2.3 scope rule: an effect without its own `scope` still counts only for this class — mana kinds
   * are magic-scoped, melee speed melee-scoped, minion / sentry / whip kinds summon-scoped.
   */
  impliedScope?: DamageClass
  /** Points are per unit of REDUCTION (the stored value is negative for a reduction: mana-cost-pct -14). */
  perReduction?: true
  uncounted?: UncountedReason
}

/**
 * STAT_POINTS v1 — SCORING_SPEC §2.3, row for row. `crit-pct` scores 0 for summon (B17), applied by
 * the points function, not here. `flight-time-ticks` is read as the max of the effect and the
 * accessory's `wingStats.flightTimeTicks` (disclosed) by the points function.
 */
export const STAT_POINTS = {
  'damage-pct': { off: 1 },
  'damage-flat': { off: 2 },
  'crit-pct': { off: 1 },
  'melee-speed-pct': { off: 1, impliedScope: 'melee' },
  'attack-speed-pct': { off: 1 },
  'defense-flat': { def: 1, surv: 1 },
  'damage-reduction-pct': { def: 2, surv: 2 },
  'move-speed-pct': { mob: 1 },
  'jump-boost': { uncounted: 'units-unverified' },
  'flight-time-ticks': { mob: 0.1 },
  'life-regen': { surv: 2 },
  'max-life-flat': { surv: 0.25 },
  'max-mana-flat': { off: 0.1, impliedScope: 'magic' },
  'mana-cost-pct': { off: 1, impliedScope: 'magic', perReduction: true },
  'mana-regen': { off: 1, impliedScope: 'magic' },
  'minion-slots': { off: 20, impliedScope: 'summon' },
  'whip-range-pct': { off: 0.5, impliedScope: 'summon' },
  'sentry-slots': { off: 10, impliedScope: 'summon' },
  'mining-speed-pct': { uncounted: 'abstain' },
  'aggro-flat': { uncounted: 'abstain' },
  // AMENDMENTS-011 B54 kinds (landed by B70). The §2.3 "knockback" row (v1 abstains) covers the two
  // knockback kinds; the rest wait for their rows. Minion / whip / tag kinds are summon-scoped (§2.3).
  'knockback-pct': { uncounted: 'abstain' },
  'minion-knockback': { uncounted: 'abstain', impliedScope: 'summon' },
  'whip-speed-pct': { uncounted: 'row-pending', impliedScope: 'summon' },
  'tag-effect-slots': { uncounted: 'row-pending', impliedScope: 'summon' },
  'fishing-power-flat': { uncounted: 'row-pending' },
  'ammo-save-pct': { uncounted: 'row-pending' },
  'lava-immunity-ticks': { uncounted: 'row-pending' },
  'melee-scale-pct': { uncounted: 'row-pending' },
  'tile-reach-flat': { uncounted: 'row-pending' },
  'potion-cooldown-pct': { uncounted: 'row-pending' },
  'armor-penetration-flat': { uncounted: 'row-pending' },
} as const satisfies Readonly<Record<StatKind, StatPointsRow>>

// --- §2.2 damage-potential proxy -------------------------------------------------------------------

/** Universal base critical strike chance (B17), added to the weapon's own crit bonus. */
export const BASE_CRIT_PCT = 4
export const TICKS_PER_SECOND = 60

/** §2.2: the assumptions every DPP-derived figure carries, verbatim. */
export const DPP_ASSUMPTIONS =
  'Single target, point-blank, target defense 0, no damage variance, no reforge modifiers, one hit per melee swing, projectile/DoT side effects not counted, held-attack rate.'

// --- §2.4 / §3.4 accessory slots -------------------------------------------------------------------

/** SLOT_COUNT[D] (AMENDMENTS-001 A4): the accessory slots of each difficulty, the Demon Heart slot included. */
export const SLOT_COUNT = { classic: 5, expert: 6, master: 7 } as const satisfies Readonly<Record<Difficulty, number>>
/** The slot only a used Demon Heart opens (Expert / Master): the assumption chip + Wall of Flesh gate. */
export const DEMON_HEART_SLOT_INDEX = { classic: null, expert: 5, master: 6 } as const satisfies Readonly<Record<Difficulty, number | null>>
/** The node whose defeat drops the Demon Heart (Wall of Flesh's Treasure Bag). */
export const DEMON_HEART_GATE_NODE = 'wall-of-flesh'
/** "Permanently increases the number of accessory slots" — Expert / Master only (checked 2026-10-14). */
export const DEMON_HEART_SOURCE = 'https://terraria.wiki.gg/wiki/Demon_Heart'
/** The most accessory slots any difficulty has: the stored loadout always keeps this many (lossless difficulty switches). */
export const MAX_ACCESSORY_SLOTS = 7

// --- §6 readiness factors --------------------------------------------------------------------------

/**
 * F2: damage a point of PLAYER defense blocks, by difficulty (B71 TO-VERIFY, done): the wiki Defense
 * page — "Reduces hit damage by <defense value × 0.5>" (Classic), "× 0.75" (Expert), "× 1" (Master);
 * net damage = ⌊attack − defense × f⌋, at least 1.
 */
export const PLAYER_DEFENSE_FACTOR = { classic: 0.5, expert: 0.75, master: 1 } as const satisfies Readonly<Record<Difficulty, number>>
/**
 * F1: NPCs "will always change incoming damage by 50% of their defense" in every mode — the spec's
 * ⌊perHit − bossDefense / 2⌋ (same page).
 */
export const NPC_DEFENSE_FACTOR = 0.5
export const DEFENSE_RULE_SOURCE = { url: 'https://terraria.wiki.gg/wiki/Defense', oldid: 1034119, checked: '2026-10-14' } as const
/** The game's minimum damage per hit after defense (same page). */
export const MIN_DAMAGE_PER_HIT = 1

/** F3: movement speed from gear at or above which a charge / dash / barrage need counts as met. */
export const MOVE_SPEED_HELPS_PCT = 10
/** F3: flight time (ticks) at or above which a flying boss's flight need counts as met (≈ 1.7 s). */
export const FLIGHT_HELPS_TICKS = 100

/** F3 needs (SCORING_SPEC §6 TAG_NEEDS). The first three are read from gear; the rest are info / cross-references. */
export type MobilityNeed =
  | 'burst-dodge'
  | 'flight'
  | 'repositioning'
  | 'platform'
  | 'open-ground'
  | 'reaction'
  | 'positioning'
  | 'enrage'
  | 'endurance'
  | 'crowd'
  | 'debuffs'
  | 'contact'

/** TAG_NEEDS v1 (editorial; every line it produces carries the editorial label and cites the boss page). */
export const TAG_NEEDS = {
  charges: 'burst-dodge',
  dashes: 'burst-dodge',
  flies: 'flight',
  'projectile-spam': 'repositioning',
  'homing-projectiles': 'repositioning',
  'ground-bound': 'platform',
  burrows: 'open-ground',
  teleports: 'reaction',
  'despawn-leash': 'positioning',
  'enrage-mechanic': 'enrage',
  'multi-phase': 'endurance',
  'summons-adds': 'crowd',
  'inflicts-debuffs': 'debuffs',
  'high-contact-damage': 'contact',
} as const satisfies Readonly<Record<AttackPatternTag, MobilityNeed>>

/** The needs a loadout can meet (toned easier / harder by the gear); every other need is an info line. */
export const GEAR_NEEDS: ReadonlySet<MobilityNeed> = new Set<MobilityNeed>(['burst-dodge', 'flight', 'repositioning'])

// --- §4.6 tie-break -------------------------------------------------------------------------------

/** rarityRank (B71: special tiers pinned after 11, in this fixed order). Absent rarity ranks last. */
export const RARITY_RANK_SPECIAL = { rainbow: 12, 'fiery-red': 13, amber: 14 } as const

// --- §5.2 goal weights ----------------------------------------------------------------------------

export const GOAL_COMPONENTS = ['estDamage', 'defense', 'mobility', 'survivability', 'classSynergy'] as const
export type GoalComponent = (typeof GOAL_COMPONENTS)[number]

/** GOAL_WEIGHTS v1 (rows sum to 1.0), in GOAL_COMPONENTS order. Goal scoring (P4-S4) reads these; readiness does not. */
export const GOAL_WEIGHTS = {
  boss: [0.45, 0.1, 0.15, 0.2, 0.1],
  'max-damage': [0.7, 0.05, 0.05, 0.1, 0.1],
  exploration: [0.2, 0.1, 0.4, 0.2, 0.1],
  survivability: [0.1, 0.35, 0.1, 0.35, 0.1],
  mobility: [0.1, 0.1, 0.55, 0.15, 0.1],
  balanced: [0.25, 0.2, 0.2, 0.2, 0.15],
} as const satisfies Readonly<Record<string, readonly [number, number, number, number, number]>>
