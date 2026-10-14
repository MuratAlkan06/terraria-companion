/**
 * Engine constants. Every value that is a modeling choice (not a verified game fact) is tied to
 * an entry in `./approximations.ts` so the HUD can list it in an AssumptionsTip.
 *
 * Units follow DATA_SCHEMA_SPEC §2 (binding): distances in tiles, durations in ticks (60/s),
 * velocities in tiles/second at the data boundary (tiles/tick inside the kernel).
 */

/** Terraria updates at 60 ticks per second; the sim runs exactly this fixed step (ADR-001 D5). */
export const TICKS_PER_SECOND = 60
export const TICK_MS = 1000 / TICKS_PER_SECOND

/** Standardized timed tests (PRD P3-S3 AC3): exactly 600 / 1800 ticks, config-locked. */
export const TIMED_TEST_DURATIONS = [10, 30] as const
export type TimedTestDuration = (typeof TIMED_TEST_DURATIONS)[number]
export const timedTestTicks = (durationSec: TimedTestDuration): number => durationSec * TICKS_PER_SECOND

/**
 * Universal base crit chance (percent) for melee/ranged/magic — VERIFIED: "For melee, ranged, and
 * magic damage types, a critical hit has a 4% chance to appear by default."
 * https://terraria.wiki.gg/wiki/Critical_hit  (approximation id: `crit-base`, AMENDMENTS-004 B17)
 */
export const BASE_CRIT_PCT = 4
/** VERIFIED: crits deal double damage, applied after defense (Critical_hit page). */
export const CRIT_MULTIPLIER = 2

/**
 * Damage variance — VERIFIED: "Damage × Factor2, where Factor2 is a random value between 0.85 and
 * 1.15 (inclusive). The result is rounded to the nearest integer. If the fractional part is 0.5,
 * round to the nearest even number." https://terraria.wiki.gg/wiki/Damage
 * The Lab draws Factor2 in whole-percent steps (85..115) — approximation id `damage-variance`.
 */
export const DAMAGE_VARIANCE_PCT = 15

/**
 * Enemy defense — VERIFIED: "net damage = ⌊attack damage − defense/2⌋"; "always be at least 1";
 * no Expert/Master scaling for enemies. https://terraria.wiki.gg/wiki/Defense
 */
export const NPC_DEFENSE_FACTOR = 0.5
export const MIN_DAMAGE = 1

/**
 * Standard dummy hitbox = the Target Dummy's placed size, "2 wide × 3 high" (VERIFIED,
 * https://terraria.wiki.gg/wiki/Target_Dummy). The NPC's pixel hitbox is NOT documented on the
 * wiki, so using the placed size is an approximation (`dummy-hitbox`). Defense 0 (verified).
 */
export const DEFAULT_DUMMY_WIDTH_TILES = 2
export const DEFAULT_DUMMY_HEIGHT_TILES = 3
/** Default dummy center: point-blank, its near face 1 tile from the player's center (Lab choice). */
export const DEFAULT_DUMMY_X_TILES = 2
export const DEFAULT_DUMMY_Y_TILES = 0
/**
 * Multiple Dummies (PRD P3-S6 AC1, `dummyRow`): standard dummies in a row on the ground, centres this
 * far apart — one tile of air between 2-tile-wide dummies. Lab choice (no game value).
 */
export const DUMMY_ROW_SPACING_TILES = 3

/**
 * Yoyo re-hit interval — VERIFIED (https://terraria.wiki.gg/wiki/Yoyos): "Yoyos inflict 10 ticks of
 * global invincibility frames on direct hits, meaning they can hit for up to 6 times per second."
 * The Lab applies it per dummy (approximation id `yoyo-control`).
 */
export const YOYO_HIT_COOLDOWN_TICKS = 10

/**
 * Summon slots — VERIFIED (wiki Minion-summoning weapons, rev 1032993): "By default, a player can only
 * have a single minion summoned at once"; gear raises "the maximum number of minions … up to 11
 * (including the default minion slot)". Sentry-summoning weapons (rev 1033011): "By default, a player
 * can only have a single sentry summoned at once"; raised "to 6 (including the default sentry slot)".
 * The Lab's slot settings range over these (`LabSettings.minionSlots` / `sentrySlots`).
 */
export const DEFAULT_MINION_SLOTS = 1
export const MAX_MINION_SLOTS = 11
export const DEFAULT_SENTRY_SLOTS = 1
export const MAX_SENTRY_SLOTS = 6

/**
 * Whip tag duration — VERIFIED (wiki Whips, rev 1033416): "All whips inflict a special tag effect on
 * struck enemies for 4 seconds (8 seconds for Constellation)". The whip params carry no duration, so
 * every whip gets the 4 s; Constellation is a reviewed limitation (it would need a schema field —
 * README "Summons and whips"). Approximation id `whip-tag`.
 */
export const WHIP_TAG_DURATION_TICKS = 4 * 60

/** A guided (returning) projectile counts as back at the target point within this distance (tiles). */
export const ARRIVE_EPSILON_TILES = 1e-9

/** Arena bounds (tiles, relative to the player at the origin; y grows downward). Lab choice. */
export const DEFAULT_ARENA = { minX: -60, maxX: 60, minY: -40, maxY: 40 } as const

/**
 * Projectile cap when the data gives no `lifetimeTicks` (Lab bound, NOT a game value; arena bounds
 * usually despawn projectiles first). Approximation id `projectile-lifetime`.
 */
export const DEFAULT_PROJECTILE_LIFETIME_TICKS = 600

/**
 * Generic arcing-projectile gravity for `ProjectileSpec.gravity: true` (schema: "simplified:
 * arcing vs straight"). These magnitudes are a TUNABLE APPROXIMATION chosen to look like an arrow
 * arc — they are NOT verified game constants. Approximation id `gravity`.
 */
export const GRAVITY_DELAY_TICKS = 15
export const GRAVITY_TILES_PER_TICK2 = 0.1 / 16
export const MAX_FALL_TILES_PER_TICK = 1

/** Swing sweep sampling: max blade-tip travel per collision sub-step (tiles). Engine precision knob. */
export const SWING_MAX_TIP_STEP_TILES = 0.25

/**
 * Mana — VERIFIED (https://terraria.wiki.gg/wiki/Mana, Desktop 1.4.5.7+ formula):
 *   rate = (maxMana/3 + 1 + regenBonus) × stationary × (current/max × 0.5 + 0.5) × itemUsage
 *   stationary = 2 when standing still; itemUsage = 0.05 while using a mana weapon; per second = rate/2
 * The regeneration delay was removed in 1.4.5.7. The Lab player always stands still and has no
 * regen bonuses (approximation id `mana-regen`). Max mana: 20 base, +20 per crystal, 200 with all
 * nine crystals (verified) — the Lab default is 200.
 */
export const DEFAULT_MAX_MANA = 200
export const MANA_STATIONARY_BONUS = 2
export const MANA_ITEM_USAGE_FACTOR = 0.05
/**
 * VERIFIED (1.4.5.7+): casting with insufficient mana is allowed with "use time multiplied by 2.5".
 * Only used by the `slow-cast` insufficient-mana policy (see `LabSettings.insufficientMana`).
 */
export const INSUFFICIENT_MANA_USE_TIME_MULTIPLIER = 2.5

/** Pending-event queue cap when the UI never drains (headless runs); oldest are dropped. */
export const MAX_PENDING_EVENTS = 50_000
/** DPS graph history cap (seconds); oldest buckets are dropped and `seriesStartSecond` advances. */
export const MAX_DPS_SERIES_SECONDS = 600
/** Frame-delta clamp for the accumulator (tab-switch / debugger pauses). Lab choice. */
export const MAX_FRAME_MS = 250
