/**
 * Public types of the Weapon Lab simulation core (ADR-001 D5 layer 1). Pure data — no renderer,
 * DOM, or framework types. Schema types (Weapon, Item, Buff, …) come from `src/schemas` (frozen).
 */
import type { Archetype, ArchetypeParams, Buff, Item, Weapon } from '../schemas'
import type { Approximation } from './approximations'
import type { TimedTestDuration } from './constants'

export interface Vec2 {
  x: number
  y: number
}

/** World space: tiles, origin at the player's center, x right, y DOWN (screen/Terraria convention). */
export interface ArenaBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/** `horizontal`: toward +x from home (away from a player facing the dummy) and back; `vertical`: up (−y) and back down. */
export type DummyMotionAxis = 'horizontal' | 'vertical'

/**
 * A Moving Dummy's path (PRD P3-S12 AC2; approximation `dummy-motion`): from its home position (`x`,
 * `y`) `rangeTiles` along `axis` and back, again and again, at a constant `speedTps`, turning instantly
 * at each end. A closed form of the world tick (src/sim/motion.ts): frame-rate independent by construction.
 */
export interface DummyMotion {
  axis: DummyMotionAxis
  /** Tiles per second along the path (finite, > 0). */
  speedTps: number
  /** Path length from home (tiles, finite, > 0). */
  rangeTiles: number
}

export interface DummySpec {
  /** Stable id used in events/stats; defaults to `dummy-<index>`. */
  id?: string
  /** Hitbox center (tiles) — a moving dummy's home, where every world starts it. */
  x: number
  y: number
  /** Hitbox size (tiles); default 2 × 3 (Target Dummy placed size). A Boss-Sized Dummy is a bigger box. */
  widthTiles?: number
  heightTiles?: number
  /** Non-negative integer; default 0 (Target Dummy). An Armored Dummy sets it. */
  defense?: number
  /** A Moving Dummy's path (P3-S12); absent = it never moves. */
  motion?: DummyMotion
}

export type ManaRegenMode = 'wiki-1.4.5.7' | 'none'
/**
 * What happens when mana can't pay the cost:
 * - `slow-cast` (default, AMENDMENTS-008 B35): the 1.4.5.7+ game rule — the cast happens with use time × 2.5 and pays nothing.
 * - `block`: the labeled "stop at zero" test setting — casting stops until mana covers the cost.
 */
export type InsufficientManaPolicy = 'block' | 'slow-cast'

export interface LabSettings {
  /** "ignore mana (test mode)" — casting never blocks; mana stays full; costs still counted. */
  ignoreMana: boolean
  maxMana: number
  manaRegen: ManaRegenMode
  insufficientMana: InsufficientManaPolicy
  /** P3-S8 AC2 toggle: homing-flagged projectiles fly straight when false. */
  homingEnabled: boolean
  /** ±15% damage variance (wiki); off makes per-hit damage constant. */
  damageVariance: boolean
  /**
   * Minion slots (PRD P3-S9 AC1): VERIFIED default 1 — "By default, a player can only have a single
   * minion summoned at once" — raised by gear "up to 11" (wiki Minion-summoning weapons). A test setting
   * until equipment lands (P3-S14).
   */
  minionSlots: number
  /** Sentry slots: VERIFIED default 1, "raised to 6" by gear (wiki Sentry-summoning weapons). */
  sentrySlots: number
}

export interface LabInput {
  attacking: boolean
  /** Aim point in world tiles; `null` auto-aims at the first dummy's center. */
  aim: Vec2 | null
}

export interface LabSimOptions {
  weapon: Weapon
  /** uint32 seed for the mulberry32 stream (default 1). */
  seed?: number
  /** Required for bow-gun weapons: an Item with `ammoStats` of the weapon's ammo class. */
  ammo?: Item
  /** Buff registry used to resolve `modifiers.dot.buffId` → DoT dps. */
  buffs?: readonly Buff[]
  /** Default: one standard dummy at point-blank range. */
  dummies?: readonly DummySpec[]
  settings?: Partial<LabSettings>
  arena?: ArenaBounds
  /**
   * Minion loadout (PRD P3-S10 AC2/AC3, the summoner loop): a MINION summon weapon whose minions are
   * out alongside the equipped (non-summon) weapon — every world starts with as many of them as the
   * minion slots hold (README "Summons"). Absent: none.
   */
  minionLoadout?: Weapon
}

// ---------------------------------------------------------------------------------------------
// Refusals (never a guess: the engine answers with a typed result instead of simulating)

export type NotSimulableReason =
  /** labBehavior.kind === "limitation" — render the LimitationCard from `limitation`. */
  | 'limitation'
  /** labBehavior.kind === "custom-scenario" — special setup handled by a scenario, not the generic engine. */
  | 'custom-scenario'
  /** Archetype exists in the schema but its interpreter hasn't shipped yet. */
  | 'archetype-not-implemented'
  /** A modifier (bounce/chain) the engine does not implement — never faked. */
  | 'modifier-not-implemented'
  /** A field the engine needs is absent (not listed as unverified). */
  | 'missing-required-field'
  /** A field the engine needs is listed in `_prov.unverifiedFields` (pipeline downgrade, defense-in-depth). */
  | 'unverified-required-field'
  /** A present value is malformed or contradicts another field. */
  | 'invalid-data'
  /** A referenced buff/ammo record lacks verified data the engine needs. */
  | 'dependency-data-unavailable'

export interface NotSimulable {
  kind: 'not-simulable'
  reason: NotSimulableReason
  message: string
  weaponId: number
  /** Dot-paths involved (on the weapon unless prefixed `ammo.` / `buff:<id>.`). */
  fields?: string[]
  limitation?: { inGameBehavior: string; reason: string; sourceUrl: string }
  scenarioId?: string
  archetype?: Archetype
}

export type InvalidSetupReason =
  | 'ammo-required'
  | 'ammo-incompatible'
  | 'buff-registry-required'
  | 'invalid-settings'
  | 'invalid-dummy'
  | 'invalid-arena'
  /** `minionLoadout` is not a simulable minion weapon, or the equipped weapon summons its own. */
  | 'invalid-loadout'

/** The weapon is simulable but the provided setup (ammo, buffs, settings, dummies) is not usable. */
export interface InvalidSetup {
  kind: 'invalid-setup'
  reason: InvalidSetupReason
  message: string
  fields?: string[]
}

export type SimRefusal = NotSimulable | InvalidSetup

// ---------------------------------------------------------------------------------------------
// Events (deterministic log; drained by the renderer for floating numbers etc.)

interface EventBase {
  tick: number
  /** Monotonic per world (resets with `reset()`); total order of the log. */
  seq: number
}

/** `minion` / `sentry`: a summon's hit (PRD P3-S9 AC3) — never the equipped weapon's own. */
export type DamageSourceKind = 'melee' | 'projectile' | 'dot' | 'minion' | 'sentry'

export type SummonKind = 'minion' | 'sentry'

export type SimEvent =
  | (EventBase & { type: 'use-start'; useIndex: number; durationTicks: number; slowCast: boolean })
  | (EventBase & { type: 'use-blocked'; reason: 'insufficient-mana' })
  | (EventBase & { type: 'projectile-spawn'; projectileId: number; x: number; y: number; vx: number; vy: number })
  | (EventBase & {
      type: 'projectile-despawn'
      projectileId: number
      /**
       * `returned`: a returning weapon (boomerang, flail, yoyo) is back in hand — the next attack may start.
       * `detonated`: a thrown explosive went off (its `explosion` event comes first, then its blast's hits).
       */
      reason: 'pierce-exhausted' | 'lifetime' | 'out-of-bounds' | 'returned' | 'detonated'
    })
  /**
   * A thrown explosive goes off (P3-S11): centre (tiles) and blast radius; one per throw. Its hits follow
   * as `damage` events of the same `proj:<id>` source (each with `blastKeptPct`), then the despawn.
   */
  | (EventBase & { type: 'explosion'; projectileId: number; x: number; y: number; radiusTiles: number })
  | (EventBase & {
      type: 'damage'
      source: DamageSourceKind
      /**
       * `use:<n>` for melee (a swing, a thrust, a whip), `proj:<id>` for projectiles, `beam` for a held
       * beam, `buff:<buffId>` for DoT, `minion:<agentId>` / `sentry:<agentId>` for a summon's hit.
       */
      sourceId: string
      dummyId: string
      amount: number
      crit: boolean
      x: number
      y: number
      /**
       * Summon hits on a whip-tagged dummy only: the part of `amount` the tag added — `amount` minus what
       * the same roll deals untagged (tag damage, and a crit only the tag's crit chance allows).
       */
      tagBonus?: number
      /**
       * A blast's hit only (explosive-aoe): the whole percent of the blast's damage this dummy took at its
       * distance from the centre — 100 without falloff (README "Param semantics", explosive-aoe).
       */
      blastKeptPct?: number
    })
  | (EventBase & { type: 'debuff-applied'; dummyId: string; buffId: string; durationTicks: number; refreshed: boolean })
  | (EventBase & { type: 'debuff-expired'; dummyId: string; buffId: string })
  /** A minion or sentry appears (`loadout`: the minion loadout's, summoned with the world). */
  | (EventBase & { type: 'summon'; agentId: number; kind: SummonKind; x: number; y: number; loadout: boolean })
  /** A summon leaves: `replaced` by a new summon with the slots full, or `slots` lowered below it. */
  | (EventBase & { type: 'dismiss'; agentId: number; kind: SummonKind; reason: 'replaced' | 'slots' })
  /** A whip strike tags a dummy (PRD P3-S10 AC1); `refreshed`: it was tagged already. */
  | (EventBase & { type: 'tag-applied'; dummyId: string; durationTicks: number; refreshed: boolean })
  | (EventBase & { type: 'tag-expired'; dummyId: string })

export type SimEventType = SimEvent['type']

// ---------------------------------------------------------------------------------------------
// Stats (HUD StatReadout / DpsGraph / ResultsSummary — UX_SPEC §3.4)

export interface DummyStats {
  damage: number
  directDamage: number
  dotDamage: number
  hits: number
  crits: number
}

/**
 * Damage by source (PRD P3-S9 AC3, P3-S10 AC2/AC3): the equipped weapon's own hits vs its summons'
 * (minions and sentries), the part of those the whip tag added, and damage over time.
 * weaponDamage + summonDamage + dotDamage = totalDamage; tagBonusDamage is part of summonDamage.
 */
export interface DamageBreakdown {
  /** The equipped weapon's own hits: a swing, thrust, shot, beam or whip. */
  weaponDamage: number
  weaponHits: number
  /** Minion and sentry hits (the minion loadout's included), tag bonus included. */
  summonDamage: number
  summonHits: number
  /** The part of summon damage the whip tag added (each hit's `tagBonus`). */
  tagBonusDamage: number
  dotDamage: number
}

export interface StatsSnapshot {
  /** Ticks since the last stats reset. */
  ticks: number
  elapsedSeconds: number
  /** direct + DoT. */
  totalDamage: number
  directDamage: number
  dotDamage: number
  /** Direct hits (DoT ticks are not hits). */
  hits: number
  crits: number
  /** crits / hits (0 with no hits). */
  critRate: number
  /** Attacks started (uses). */
  uses: number
  /** Shots/emissions inside uses (≥ uses when useTime < use animation). */
  activations: number
  projectilesSpawned: number
  /**
   * Projectiles that left without landing a hit on any dummy (P3-S12: a Moving Dummy can be missed):
   * despawned out of bounds, at the end of their lifetime, back in hand, or gone off without reaching
   * a dummy — counted when they despawn, so ones still in flight are in neither column yet.
   */
  projectilesMissed: number
  ammoConsumed: number
  /** Consumable weapon items used up: a thrown explosive is the item itself, one per throw (P3-S11). */
  consumablesUsed: number
  /**
   * Explosions so far (a thrown explosive goes off once: `explosion` events). Fewer than
   * `consumablesUsed` while thrown ones are still on their fuses.
   */
  explosions: number
  manaConsumed: number
  debuffsApplied: number
  /** Most recent direct hit — the HUD's "per-hit damage". */
  lastHit: { amount: number; crit: boolean; tick: number; dummyId: string } | null
  /** uses / elapsedSeconds. */
  attacksPerSec: number
  /** totalDamage / elapsedSeconds — label "estimated". */
  estimatedDps: number
  /** Damage in the trailing 60 ticks (1 s window). */
  rollingDps: number
  /** Damage per completed second, oldest first (graph). */
  dpsSeries: number[]
  /** Second index of `dpsSeries[0]` (advances when old buckets are dropped). */
  seriesStartSecond: number
  /** Damage so far in the current, incomplete second. */
  currentSecondDamage: number
  perDummy: Record<string, DummyStats>
  breakdown: DamageBreakdown
}

export interface WeaponSummary {
  id: number
  name: string
  archetype: Archetype
  damage: number
  /** Effective ticks per attack, incl. any reuse delay (see README "Cadence"). */
  cadenceTicks: number
  /** Cooldown after each attack (Weapon.reuseDelayTicks; 0 = none), included in cadenceTicks. */
  reuseDelayTicks: number
  /** Ticks between activations inside one attack (useTimeTicks). */
  activationTicks: number
  activationsPerUse: number
  /** 60 / cadenceTicks. */
  nominalAttacksPerSec: number
  /** 4 + critPct for melee/ranged/magic, 0 for summon/other; capped at 100. */
  critChancePct: number
  manaCostPerUse: number
  usesAmmo: boolean
  /** Weapon + ammo damage for bow-gun, else weapon damage. */
  baseHitDamage: number
  /**
   * The weapon itself is thrown and comes back (returning archetype: boomerang, flail, yoyo): an
   * attack lasts until it is back in hand (`projectile-despawn` reason `returned`), and the next
   * attack can't start sooner.
   */
  returnsToHand: boolean
  /**
   * Each attack throws the weapon itself and uses it up (a thrown explosive, P3-S11): one item per throw,
   * counted in `stats.consumablesUsed` — not ammo.
   */
  consumable: boolean
}

export interface TimedTestResult {
  durationSec: TimedTestDuration
  ticks: number
  seed: number
  estimatedDps: number
  totalDamage: number
  directDamage: number
  dotDamage: number
  hits: number
  crits: number
  uses: number
  attacksPerSec: number
  /** Projectiles spawned over the run, and those that despawned without a hit (`StatsSnapshot.projectilesMissed`). */
  projectilesSpawned: number
  projectilesMissed: number
  ammoConsumed: number
  /** Consumable weapon items used up over the run (thrown explosives: one per throw). */
  consumablesUsed: number
  /**
   * Explosions over the run. `consumablesUsed − explosions` thrown explosives had not gone off when the
   * run ended (still on their fuses: the results say so beside "Explosives used").
   */
  explosions: number
  manaConsumed: number
  debuffsApplied: number
  dpsSeries: number[]
  /** Per-dummy totals of the run (the primary target is the first dummy; Multiple Dummies). */
  perDummy: Record<string, DummyStats>
  /** Damage by source over the run (weapon vs summons vs tag bonus vs DoT). */
  breakdown: DamageBreakdown
  /** FNV-1a digest of the full event log of the run (determinism fingerprint). */
  eventDigest: string
}

export type TimedTestStatus = 'idle' | 'running' | 'finished'

export interface TimedTestState {
  status: TimedTestStatus
  durationSec: TimedTestDuration | null
  ticksElapsed: number
  ticksTotal: number
  remainingSec: number
  result: TimedTestResult | null
}

export interface ManaState {
  current: number
  max: number
  ignoreMana: boolean
}

/** Summons out now vs the slots (PRD P3-S9 AC1 "respects slot count settings"). */
export interface SummonsState {
  minions: number
  /** Sum of the minions' slot costs. */
  minionSlotsUsed: number
  minionSlots: number
  sentries: number
  sentrySlotsUsed: number
  sentrySlots: number
}

export interface SimSnapshot {
  /** World tick since creation / last reset. */
  tick: number
  seed: number
  weapon: WeaponSummary
  stats: StatsSnapshot
  /** Null for weapons without a mana cost. */
  mana: ManaState | null
  summons: SummonsState
  timedTest: TimedTestState
  settings: LabSettings
  /** FNV-1a digest of every event emitted since the last reset (hex). */
  eventDigest: string
  rngState: number
}

// ---------------------------------------------------------------------------------------------
// Render state (renderer interpolates prev → current with `alpha`)

export interface BladePose {
  /**
   * `beam`: a held beam (piercing-beam channel mode) — a line from the player along `angle`. `whip`: a
   * whip sweeping its arc (P3-S10), `length` = its range.
   */
  kind: 'swing' | 'thrust' | 'beam' | 'whip'
  /** Radians, world space (0 = +x, π/2 = down). */
  angle: number
  prevAngle: number
  /** Tiles from the player's center. */
  length: number
  prevLength: number
  arcDegrees?: number
}

export interface RenderState {
  tick: number
  /** Accumulator fraction toward the next tick, in [0, 1). */
  alpha: number
  player: Vec2
  facing: 1 | -1
  aim: Vec2
  dummies: Array<{
    id: string
    x: number
    y: number
    /** The centre one tick earlier (interpolate prev → current with `alpha`); = `x` / `y` for a dummy that never moves. */
    prevX: number
    prevY: number
    /**
     * A Moving Dummy's path (P3-S12): the two ends its centre travels between — home first — so the
     * renderer can frame and draw the whole path once; null for a dummy that never moves.
     */
    path: { fromX: number; fromY: number; toX: number; toY: number } | null
    width: number
    height: number
    defense: number
    /**
     * Active debuffs (sorted by buffId): ticks left, and the duration they were last (re)applied with —
     * the full length of the remaining-time bar (Debuff Dummy, PRD P3-S11 AC3).
     */
    debuffs: Array<{ buffId: string; remainingTicks: number; durationTicks: number }>
    /** A whip's tag on it (P3-S10 AC1), else null. */
    tag: { remainingTicks: number; durationTicks: number; damageFlat: number; critPct: number | null } | null
  }>
  projectiles: Array<{ id: number; x: number; y: number; prevX: number; prevY: number; vx: number; vy: number; spriteKey?: string }>
  blade: BladePose | null
  /** Minions and sentries, oldest first (P3-S9). Positions interpolate prev → current like projectiles. */
  agents: Array<{
    id: number
    kind: SummonKind
    aiClass: MinionAiClass
    x: number
    y: number
    prevX: number
    prevY: number
    facing: 1 | -1
    /** The dummy it attacks now, or null (none in range / none at all). */
    targetId: string | null
    /** World tick of its latest attack (-1: none yet). */
    lastAttackTick: number
    /** One of the minion loadout's (else the equipped weapon summoned it). */
    loadout: boolean
  }>
}

/** DATA_SCHEMA_SPEC §2.4 minion-sentry `aiClass` (AMENDMENTS-013 B63 P-6 taxonomy). */
export type MinionAiClass = Extract<ArchetypeParams, { archetype: 'minion-sentry' }>['aiClass']

export type SettingsUpdateResult =
  | { ok: true; settings: LabSettings }
  | { ok: false; reason: 'config-locked' }
  | { ok: false; reason: 'invalid-settings'; message: string }

export type StartTimedTestResult = { ok: true } | { ok: false; reason: 'already-running' | 'invalid-duration' }

export type SetDummiesResult = { ok: true } | { ok: false; reason: 'config-locked' } | { ok: false; reason: 'invalid-dummy'; message: string }

export interface AdvanceResult {
  ticksRun: number
  alpha: number
}

/** The headless engine handle the Lab UI drives (see README). */
export interface LabSim {
  readonly weapon: WeaponSummary
  /** The minion loadout's weapon (LabSimOptions.minionLoadout), else null. */
  readonly loadout: WeaponSummary | null
  /**
   * The equipped weapon's assumptions, then the minion loadout's (deduplicated), then the target's: a
   * moving dummy's `dummy-motion` while one is among the current dummies (it follows `setDummies`).
   */
  readonly approximations: readonly Approximation[]
  /** Feed a wall-clock frame delta (ms); runs whole fixed ticks, keeps the remainder. */
  advance(dtMs: number): AdvanceResult
  /** Run exactly `ticks` ticks (headless / tests). Returns ticks actually run (a finished test halts). */
  step(ticks?: number): number
  setInput(input: Partial<LabInput>): { ok: true } | { ok: false; reason: 'config-locked' }
  updateSettings(patch: Partial<LabSettings>): SettingsUpdateResult
  /** Full reset (stats, projectiles, debuffs, mana, RNG re-seeded, timed test aborted). */
  reset(options?: { seed?: number }): void
  /**
   * Replace the target dummies (e.g. Multiple Dummies: `dummyRow`), then a full `reset()`. Rejected
   * during a timed test; invalid dummies are refused and the current ones kept.
   */
  setDummies(dummies: readonly DummySpec[], options?: { seed?: number }): SetDummiesResult
  /** Zero the stats + graph only; the world keeps running. Rejected during a timed test. */
  resetStats(): { ok: true } | { ok: false; reason: 'config-locked' }
  startTimedTest(durationSec: TimedTestDuration, options?: { seed?: number }): StartTimedTestResult
  snapshot(): SimSnapshot
  renderState(): RenderState
  /** Returns and clears pending events (oldest first). */
  drainEvents(): SimEvent[]
}

export type CreateLabSimResult = { ok: true; sim: LabSim } | { ok: false; refusal: SimRefusal }

/** Data needed to decide simulability without building a world. */
export interface SimulabilityInput {
  weapon: Weapon
  ammo?: Item
  buffs?: readonly Buff[]
}
