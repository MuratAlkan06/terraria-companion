/**
 * One Lab session = one equipped weapon driving one engine instance (src/sim). The glue between
 * the headless sim, the HTML HUD (React, via `subscribe`/`getHud`) and the PixiJS arena (via
 * `frame`). No DOM, no renderer imports: unit-testable in Node.
 *
 * Input model (UX_SPEC §9): pointer hold (aim = pointer, so the swing follows the cursor side) and
 * Space hold (auto-aim at the dummy) are independent sources; attacking = either is held. A press
 * is latched until a swing actually starts, so a click shorter than one 60 Hz tick still swings.
 *
 * HUD numbers (UX_SPEC §3.4 StatReadout): per-hit = `stats.lastHit`; totals/hits/crits from the
 * snapshot; est. DPS = total damage ÷ time spent in whole attack cycles since the last reset — each
 * attack's use time plus the weapon's cooldown (reuse delay), so a cooldown weapon held down reads
 * like its timed test (`dps-while-attacking` assumption) — the session average from the engine would
 * count idle time between bursts of play. Attacks/sec is counted from the engine's own attacks too (`attack-rate`):
 * the latest RATE_WINDOW_ATTACKS attacks ÷ the time they took (each one's use time + the weapon's
 * cooldown) — the rate the weapon attacks at now, so low-mana casts at 40% speed show in it within
 * a few casts, as the slow-cast chip says (design review P3-S4/S5 H3), while one regen-funded
 * full-speed cast among them barely moves it; before the first attack it is the weapon's nominal
 * rate. A tethered weapon (a yoyo) shows hits/sec instead (`hit-rate`): hits ÷ the same attack time as
 * est. DPS — one throw lasts as long as it is held out, so its attack rate is no measure of how fast
 * it lands hits. DpsGraph = the engine's per-second series.
 *
 * Timed tests (PRD P3-S3 AC3) run on the engine's controller: exactly 600 / 1800 ticks, attack held,
 * auto-aimed at the dummy, config locked (input and settings changes are refused while it runs).
 * "Run again" replays the finished run's seed AND settings, so it reproduces the result exactly.
 * The single Reset (PRD P3-S2 AC3) aborts any test and restores the target and the default settings.
 *
 * Setup (./labSetup.ts): a bow or gun fires the ammo it is created with (the engine fixes ammo per
 * sim, so switching ammo is a new session — stats, "Ammo used" included, start from zero); a
 * damage-over-time weapon gets the buff registry; weapons that fire projectiles face the ranged
 * dummy. The target (PRD P3-S6 AC1, UX_SPEC §3.4 target picker) is the Infinite Dummy or Multiple
 * Dummies — a row whose first dummy is the PRIMARY target; `setTarget` swaps the engine's dummies and
 * starts the stats over, and the HUD reports the primary target apart from all dummies (AC4).
 *
 * Weapons that come back to hand (returning archetype, `WeaponSummary.returnsToHand`; PRD P3-S7): an
 * attack lasts until the weapon is back (the engine's `projectile-despawn` reason `returned`), at least
 * its use time — the attack time and the attacks/sec window grow while it is still out, so a yoyo held
 * out for ten seconds is one ten-second attack (`attack-until-back`). Mana (PRD P3-S5, AMENDMENTS-008 B35): the HUD's ManaBar reads the engine's pool, refreshed
 * on every attack and every tenth of a second while it regenerates; `slowCasting` is the latest
 * attack's own flag from the engine (a low-mana cast at 40% speed). The low-mana WARNING is latched
 * (design review P3-S4/S5 B1): raised the moment a cast can't be paid (a slow or blocked cast, or the
 * pool seen below the cost), it stays until the pool has covered the cost for a whole second — and
 * for longer than the slowest attack seen, so a regen-funded cast cycle never blinks it — or the
 * session restarts. Changing a mana setting restarts the session's stats, pool and dummy with the
 * new settings, like switching ammo (`updateSettings` → `restarted`).
 *
 * Summons (PRD P3-S9 / P3-S10): a minion or sentry staff's attack summons at the pointer (the engine
 * keeps them, attacking on their own); a whip may have a MINION LOADOUT beside it (`loadout`: a minion
 * staff whose minions are out from the start — the engine's `minionLoadout`). Minions and sentries
 * attack all the time, so once one is out, est. DPS (and a staff's hits/sec) divide by the time since
 * the first one appeared, or the attack time if longer (`dps-with-summons`). The HUD reports the summons
 * against their slots, the dummies they attack now and how many were replaced (the oldest, for a new one
 * with the slots full), damage by source (the weapon's own hits, the summons', the whip tag's share,
 * DoT), who dealt the latest hit, and the dummies the whip has tagged with their time left. Changing a slot setting restarts the
 * stats while summons are involved (a fresh world, the loadout summoned again), as a mana setting does.
 *
 * Thrown explosives (PRD P3-S11 AC1): each throw uses one explosive up (the engine's
 * `stats.consumablesUsed`, "Explosives used"); the HUD reports the LATEST BLAST — its radius and falloff
 * and what it dealt each dummy (the engine's `explosion` event and its hits, each with the percent of the
 * blast's damage it kept) — so one explosion's per-dummy damage reads at a glance. The Debuff Dummy
 * (AC3): the target's active debuffs with their names, damage per second and time left (the engine's
 * debuff state, refreshed a tenth of a second at a time while any runs), and the debuffs applied since
 * the last reset (AC2's stat).
 *
 * Dummy roster v2 (PRD P3-S12): the Boss-Sized, Moving and Armored Dummies are targets like the others
 * (`setTarget`; ./labSetup.ts places them). Against the Moving Dummy a weapon that sends projectiles out
 * shows its SHOTS — fired and missed (the engine's `projectilesSpawned` / `projectilesMissed`: a shot that
 * left without hitting) — so a miss (AC2) is a number as well as a sight. An Armored Dummy at a boss's
 * verified defense names that boss in its assumption (`bossDefenses`, ./labBossDefense.ts).
 */
import type { Buff, Item, Weapon } from '../schemas'
import {
  createLabSim,
  DEFAULT_LAB_SETTINGS,
  GROUND_Y_TILES,
  THROWN_REST_HEIGHT_TILES,
  TICKS_PER_SECOND,
  timedTestTicks,
  type DamageBreakdown,
  type InsufficientManaPolicy,
  type LabSettings,
  type LabSim,
  type ManaState,
  type SettingsUpdateResult,
  type SimEvent,
  type SimRefusal,
  type SimSnapshot,
  type SummonKind,
  type TimedTestDuration,
  type TimedTestResult,
  type TimedTestStatus,
  type Vec2,
  type WeaponSummary,
} from '../sim'
import { labAssumptionsFor, type LabAssumption } from './labAssumptions'
import { namedBoss, type BossDefense } from './labBossDefense'
import { ammoClassOf, DEFAULT_LAB_TARGET, firesProjectiles, isLabTarget, labDummiesFor, resolveAmmo, sameTarget, type LabSetup, type LabTarget } from './labSetup'

export interface LabTimedTestHud {
  status: TimedTestStatus
  durationSec: TimedTestDuration | null
  /** Seconds of simulation time left while running (0 otherwise). */
  remainingSec: number
  /** Elapsed fraction of the run, 0..1 (1 once finished). */
  progress: number
  result: TimedTestResult | null
}

/** The engine's per-second damage series (UX_SPEC §3.4 DpsGraph), as of the last publish. */
export interface LabGraphHud {
  /** Damage per completed second, oldest first. */
  series: readonly number[]
  /** Second index of `series[0]`. */
  startSecond: number
  /** Damage so far in the current, incomplete second. */
  currentSecondDamage: number
  /** Ticks since the last reset. */
  elapsedTicks: number
}

/** The ManaBar (UX_SPEC §3.4) — null for weapons without a mana cost. */
export interface LabManaHud {
  current: number
  max: number
  costPerUse: number
  /** "ignore mana (test mode)": the pool stays full; casts are still counted in "Mana used". */
  ignoreMana: boolean
  /** Not enough mana for the next cast right now (never while ignoring mana). */
  low: boolean
  /**
   * The latched low-mana warning the ManaBar shows: on since a cast couldn't be paid, until the pool
   * has covered the cost for a whole second (see the header). Never while ignoring mana.
   */
  warning: boolean
  /** What a cast does without enough mana: `slow-cast` (game behavior) or `block` (stop at zero). */
  policy: InsufficientManaPolicy
  /** Mana regenerates (with "stop at zero", casting then waits for mana instead of stopping for good). */
  regen: boolean
  /** The latest attack was a low-mana cast at 40% speed (the engine's `use-start` flag). */
  slowCasting: boolean
}

/** A weapon's shots against the Moving Dummy (PRD P3-S12 AC2): sent out, and those that left without a hit. */
export interface LabShotsHud {
  /** `throw` for a thrown weapon (a returning weapon, an explosive), else `shot`. */
  noun: 'shot' | 'throw'
  fired: number
  missed: number
}

/** One dummy's live numbers (Multiple Dummies), as of the last publish. */
export interface LabDummyHud {
  id: string
  /** 1-based position in the row, nearest first (the arena labels the dummies with it). */
  number: number
  /** The primary target: the first dummy — the one Space and the timed tests aim at. */
  primary: boolean
  hits: number
  crits: number
  /** Direct + damage over time. */
  damage: number
  /** This dummy's damage ÷ the time spent attacking (as the live est. DPS). */
  estimatedDps: number
}

/** Summons out vs their slots (PRD P3-S9 AC1): a staff's own kind, or the minion loadout's minions. */
export interface LabSummonsHud {
  /** `weapon`: the equipped staff summons them; `loadout`: the minion loadout beside a whip. */
  source: 'weapon' | 'loadout'
  kind: SummonKind
  /** How many are out, and the slots they take of the slots there are. */
  count: number
  slotsUsed: number
  slots: number
  /** The minion loadout weapon's name (source `loadout`), else null. */
  loadoutName: string | null
  /**
   * Summons replaced since the last reset: each one the oldest, gone for a new summon with the slots
   * full (the engine's `dismiss` reason `replaced`) — the UI announces each new one (design review M1).
   */
  replaced: number
  /**
   * The dummies the summons attack now (1-based row numbers, ascending, each once; the engine's
   * per-summon `targetId`) — empty while none has a target (design review M2).
   */
  targets: readonly number[]
}

/** A dummy the whip has tagged (PRD P3-S10 AC1), with the tag's time left. */
export interface LabTagHud {
  dummyId: string
  /** 1-based position in the row (the arena's label), 1 for the single dummy. */
  number: number
  remainingSec: number
}

/** Multiple Dummies: every dummy's numbers, and the primary target's (PRD P3-S6 AC2/AC4). */
export interface LabTargetsHud {
  /** Nearest first; the first is the primary target. */
  dummies: readonly LabDummyHud[]
  primary: LabDummyHud
}

/** Who dealt a hit: the equipped weapon itself, or one of the summons. */
export type LabHitSource = 'weapon' | SummonKind

/** One dummy's share of the latest blast (row order): what it took, or null when the blast missed it. */
export interface LabBlastDummyHud {
  id: string
  /** 1-based position in the row (the arena's label); 1 for the single dummy. */
  number: number
  amount: number | null
  crit: boolean
  /** The percent of the blast's damage it kept at its distance (100 without falloff), else null. */
  keptPct: number | null
}

/** The latest explosion (PRD P3-S11 AC1): its radius and falloff, and what it dealt each dummy. */
export interface LabBlastHud {
  /** 1-based count of explosions since the last reset (this one's number). */
  index: number
  radiusTiles: number
  falloff: 'none' | 'linear'
  dummies: readonly LabBlastDummyHud[]
}

/** One debuff active on the Debuff Dummy (PRD P3-S11 AC3), from the engine's debuff state. */
export interface LabDebuffHud {
  buffId: string
  /** The buff registry's name (else the id). */
  name: string
  /** Seconds left, and the duration it was last (re)applied with (the bar's full length). */
  remainingSec: number
  durationSec: number
  /** remaining ÷ duration, 0..1 (the bar). */
  fraction: number
  /** The registry's verified damage per second (null when it has none). */
  dps: number | null
}

/** The Debuff Dummy's panel: its active debuffs, and what applied them. */
export interface LabDebuffDummyHud {
  debuffs: readonly LabDebuffHud[]
  /** The equipped weapon (or its minion loadout) applies a debuff at all — else the panel says it applies none. */
  weaponApplies: boolean
  /**
   * The debuffs the weapon and its minion loadout can apply (one row each): the panel lays their rows out
   * from the session's start, so the first debuff never resizes it (the stable-HUD pattern).
   */
  applies: readonly Pick<LabDebuffHud, 'buffId' | 'name' | 'dps'>[]
  /** Damage over time this dummy has taken since the last reset. */
  dotDamage: number
}

export interface LabHudState {
  weapon: WeaponSummary
  /** The latest direct hit (the engine's `stats.lastHit`) and who dealt it (whip vs minion in a mixed run). */
  lastHit: { amount: number; crit: boolean; source: LabHitSource } | null
  totalDamage: number
  directDamage: number
  dotDamage: number
  hits: number
  crits: number
  /** "Ammo used" since the last reset (bows and guns: one per shot). */
  ammoConsumed: number
  /** "Explosives used" since the last reset (a thrown explosive: one per throw — WeaponSummary.consumable). */
  consumablesUsed: number
  /** Debuffs applied (and refreshed) since the last reset — the engine's `stats.debuffsApplied` (PRD P3-S11 AC2). */
  debuffsApplied: number
  /** "Mana used" since the last reset (counted in test mode too). */
  manaConsumed: number
  mana: LabManaHud | null
  /**
   * Attacks per second while attacking: the latest RATE_WINDOW_ATTACKS attacks ÷ the time they took
   * (low-mana slow casts included); the weapon's nominal rate before the first attack.
   */
  attacksPerSec: number
  /** Hits ÷ seconds spent attacking (the est. DPS denominator); 0 before any attack time. */
  hitsPerSec: number
  /**
   * The rate the HUD shows: `attacks`, or `hits` for a tethered weapon (a yoyo) — one throw is one
   * attack that lasts as long as it is held out, hitting all the while, so its attacks/sec (≈ 1 ÷ the
   * hold) says nothing about how fast it lands hits (design review P3-S6/S7) — or `summon-hits` for a
   * summon staff (its summons attack; the staff's uses only summon them).
   */
  rateReadout: 'attacks' | 'hits' | 'summon-hits'
  /** Total damage ÷ seconds spent in whole attack cycles (use time + cooldown) since the last reset. */
  estimatedDps: number
  /** Seconds of whole attack cycles (use time + cooldown) counted since the last reset. */
  attackSeconds: number
  /** Increments on every reset (lets the UI announce it). */
  resets: number
  timedTest: LabTimedTestHud
  graph: LabGraphHud
  settings: LabSettings
  /** The Lab's target (the Infinite Dummy, Multiple Dummies, or the Debuff Dummy). */
  target: LabTarget
  /** Per-dummy numbers while the target is Multiple Dummies, else null (one dummy: the totals are its numbers). */
  targets: LabTargetsHud | null
  /** Summons vs slots — a summon staff, or a whip's minion loadout — else null. */
  summons: LabSummonsHud | null
  /** Damage by source (weapon / summons / tag bonus / DoT) for a whip or summons, else null. */
  breakdown: DamageBreakdown | null
  /** Dummies the whip has tagged now, nearest first (empty without a whip). */
  tags: readonly LabTagHud[]
  /** The latest explosion of a thrown explosive since the last reset, else null. */
  lastBlast: LabBlastHud | null
  /** The Debuff Dummy's panel while that is the target, else null. */
  debuffDummy: LabDebuffDummyHud | null
  /** Shots fired and missed while the target is the Moving Dummy and the weapon sends projectiles out, else null. */
  shots: LabShotsHud | null
  /** A timed test is running: the weapon, target and settings can't change (UX_SPEC §5.7). */
  locked: boolean
}

/** Swing shape for the renderer (from the weapon's archetype params — never per-weapon code). */
export interface SwingShape {
  arcDegrees: number
  reachTiles: number
}

/** A weapon thrown out and back (returning params): how the arena draws it — spinning, on a string or a chain. */
export interface ReturningShape {
  variant: 'boomerang' | 'flail' | 'yoyo'
  throwRangeTiles: number
}

/** A thrown explosive (explosive-aoe params): what the arena and the HUD say about its blast. */
export interface ExplosiveShape {
  blastRadiusTiles: number
  trigger: 'impact' | 'timed'
  /** Ticks from the throw to the explosion (timed), else null. */
  fuseTicks: number | null
  falloff: 'none' | 'linear'
}

export type InputSource = 'pointer' | 'key'

export interface LabSessionOptions {
  /** uint32 seed source; default: a fresh random seed per sim, per reset and per test. */
  seed?: () => number
  /** Test settings to start with (e.g. carried over from the previously equipped weapon). */
  settings?: Partial<LabSettings>
  /** Ammo and buffs the Lab provides (./labSetup.ts); weapons needing neither work without it. */
  setup?: LabSetup
  /** The chosen ammo's item id (a bow or gun); anything not among its usable ammo loads the default. */
  ammoId?: number | null
  /** The target to start with (e.g. carried over from the previously equipped weapon); default the Infinite Dummy. */
  target?: LabTarget
  /**
   * The minion loadout (PRD P3-S10): a minion staff whose minions are out beside the equipped weapon
   * (the Lab offers it beside a whip). Null / absent: none.
   */
  loadout?: Weapon | null
  /** The Armored Dummy's boss quick picks (./labBossDefense.ts): an armored target naming one is described as that boss's defense. */
  bossDefenses?: readonly BossDefense[]
}

export type CreateLabSessionResult = { ok: true; session: LabSession } | { ok: false; refusal: SimRefusal }

/** The test settings that decide how a mana weapon's casts are paid: changing one restarts the stats. */
export const MANA_SETTING_KEYS = ['maxMana', 'insufficientMana', 'manaRegen', 'ignoreMana'] as const satisfies readonly (keyof LabSettings)[]

/** The slot settings: changing one restarts the stats while summons are involved (a staff, or a loadout). */
export const SLOT_SETTING_KEYS = ['minionSlots', 'sentrySlots'] as const satisfies readonly (keyof LabSettings)[]

/** `restarted`: a mana setting of a mana weapon (or a slot setting with summons) changed, so the stats, pool and dummy started over. */
export type LabSettingsUpdateResult = Exclude<SettingsUpdateResult, { ok: true }> | (Extract<SettingsUpdateResult, { ok: true }> & { restarted: boolean })

function randomSeed(): number {
  const buf = new Uint32Array(1)
  globalThis.crypto.getRandomValues(buf)
  return buf[0]
}

export function createLabSession(weapon: Weapon, options: LabSessionOptions = {}): CreateLabSessionResult {
  const nextSeed = options.seed ?? randomSeed
  const { setup } = options
  const ammo = setup ? resolveAmmo(weapon, setup, options.ammoId) : null
  const lab = weapon.labBehavior
  const target = options.target && isLabTarget(options.target) ? options.target : DEFAULT_LAB_TARGET
  const dummies = lab.kind === 'archetype' ? labDummiesFor(lab.params.archetype, target) : undefined
  const loadout = options.loadout ?? null
  const created = createLabSim({
    weapon,
    seed: nextSeed(),
    ...(options.settings ? { settings: options.settings } : {}),
    ...(ammo ? { ammo } : {}),
    ...(setup ? { buffs: setup.buffs } : {}),
    ...(dummies ? { dummies } : {}),
    ...(loadout ? { minionLoadout: loadout } : {}),
  })
  if (!created.ok) return { ok: false, refusal: created.refusal }
  return { ok: true, session: new LabSession(weapon, created.sim, nextSeed, ammo, setup?.buffs ?? [], target, loadout, options.bossDefenses ?? []) }
}

/** A finished (or running) timed test: what "Run again" replays. */
interface TimedRun {
  durationSec: TimedTestDuration
  seed: number
  settings: LabSettings
  ticksTotal: number
}

/** HUD refresh while a test runs: every tenth of a second (the countdown ring's step). */
const COUNTDOWN_STEP_TICKS = TICKS_PER_SECOND / 10
/** ManaBar refresh while the pool regenerates: every tenth of a second. */
const MANA_STEP_TICKS = TICKS_PER_SECOND / 10
/** HUD refresh while a weapon that comes back is still out: every tenth of a second. */
const OUT_STEP_TICKS = TICKS_PER_SECOND / 10
/** HUD refresh while a whip tag runs (its time left): every tenth of a second. */
const TAG_STEP_TICKS = TICKS_PER_SECOND / 10
/** HUD refresh while a debuff runs on the Debuff Dummy (its bar): every tenth of a second. */
const DEBUFF_STEP_TICKS = TICKS_PER_SECOND / 10
/** The low-mana warning clears once the pool has covered the cost this long (at least; see the header). */
export const MANA_WARNING_CLEAR_TICKS = TICKS_PER_SECOND
/** The live attacks/sec counts this many of the latest attacks. */
export const RATE_WINDOW_ATTACKS = 5
/**
 * Weapons that fire projectiles: the phone camera frames this much around the player (tiles) — the
 * weapon held out toward the aim — alongside the dummy. Framing only, never a hit reach.
 */
export const RANGED_FRAME_TILES = 2

export class LabSession {
  readonly weapon: Weapon
  readonly sim: LabSim
  readonly summary: WeaponSummary
  readonly swing: SwingShape | null
  /** Blade reach (tiles) for swung and thrust weapons, else 0. */
  readonly reachTiles: number
  /** What the camera frames around the player (tiles): the blade's reach, or the held ranged weapon. */
  readonly frameTiles: number
  /** The loaded ammo (bows and guns), else null. */
  readonly ammo: Item | null
  /** The weapon's ammo class (bows and guns), else null. */
  readonly ammoClass: string | null
  /** The weapon fires projectiles (bows, guns, magic): the arena draws them and the held weapon. */
  readonly firesProjectiles: boolean
  /** The buff registry the engine resolves damage over time with (names for the HUD). */
  readonly buffs: readonly Buff[]
  /** A returning weapon (the arena draws the weapon itself in flight), else null. */
  readonly returning: ReturningShape | null
  /** Tethered to the hand while attack is held (returning `returnMode: 'tethered'`: a yoyo) — the HUD shows hits/sec. */
  readonly tethered: boolean
  /** A held beam (piercing-beam channel mode: the engine's `blade.kind === 'beam'`). */
  readonly beam: boolean
  /** A whip (P3-S10): the arena draws its sweep at its range (the engine's `blade.kind === 'whip'`). */
  readonly whip: { arcDegrees: number; rangeTiles: number } | null
  /** A summon staff (P3-S9): what one use summons, else null. */
  readonly summonKind: SummonKind | null
  /** A thrown explosive (P3-S11): its blast, trigger and falloff, else null. */
  readonly explosive: ExplosiveShape | null
  /** The minion loadout (a minion staff whose minions are out beside a whip), else null. */
  readonly loadout: Weapon | null
  /**
   * What the weapon sends out that can miss (P3-S12): `shot` (bows, guns, magic, piercing shots, a summon's
   * flying shot) or `throw` (a returning weapon, a thrown explosive); null for a blade, a held beam, a whip,
   * or summons that strike by touch or land their shot at once.
   */
  readonly shotNoun: 'shot' | 'throw' | null
  /** The Armored Dummy's boss quick picks (names the boss whose verified defense a target uses). */
  readonly bossDefenses: readonly BossDefense[]

  private readonly nextSeed: () => number
  private readonly held: Record<InputSource, boolean> = { pointer: false, key: false }
  private latched = false
  private aim: Vec2 | null = null
  private busyTicks = 0
  /** The ticks each of the latest attacks took (use time + cooldown), oldest first. */
  private recentAttackTicks: number[] = []
  /** The longest attack seen since the last reset (use time + cooldown; a slow cast's, once one ran). */
  private slowestAttackTicks = 0
  /** Ticks run since the last reset / test start (mirrors the engine's stats clock). */
  private ticks = 0
  private run: TimedRun | null = null
  private resets = 0
  private slowCasting = false
  /** The latched low-mana warning, and the tick since which the pool has covered the cost. */
  private manaWarning = false
  private manaCoveredSince: number | null = null
  /** The latest attack of a weapon that comes back to hand, while it is still out (see the header). */
  private out: { start: number; nominal: number; credited: number } | null = null
  private target: LabTarget
  private dummyIds: string[]
  /** Session tick the first summon of this world appeared (null: none yet) — the summon-time denominator. */
  private summonSince: number | null = null
  /** Tagged dummies → the world tick their tag ends (applied tick + duration). */
  private tagEnds = new Map<string, number>()
  /** Summons replaced (oldest out, slots full) since the last reset. */
  private summonsReplaced = 0
  /** Who dealt the latest direct hit (the engine's `stats.lastHit` has no source). */
  private lastHitSource: LabHitSource = 'weapon'
  /** The latest explosion (its projectile, count, radius) and its hits by dummy id. */
  private blast: { projectileId: number; index: number; radiusTiles: number; hits: Map<string, { amount: number; crit: boolean; keptPct: number }> } | null = null
  private blasts = 0
  private assumptionList: { target: LabTarget; list: readonly LabAssumption[] } | null = null
  private hud: LabHudState
  private readonly listeners = new Set<() => void>()
  private readonly resetListeners = new Set<() => void>()

  constructor(
    weapon: Weapon,
    sim: LabSim,
    nextSeed: () => number,
    ammo: Item | null = null,
    buffs: readonly Buff[] = [],
    target: LabTarget = DEFAULT_LAB_TARGET,
    loadout: Weapon | null = null,
    bossDefenses: readonly BossDefense[] = [],
  ) {
    this.weapon = weapon
    this.sim = sim
    this.nextSeed = nextSeed
    this.summary = sim.weapon
    this.ammo = ammo
    this.ammoClass = ammoClassOf(weapon)
    this.buffs = buffs
    const lab = weapon.labBehavior
    const params = lab.kind === 'archetype' ? lab.params : null
    this.swing = params?.archetype === 'swing-melee' ? { arcDegrees: params.arcDegrees, reachTiles: params.reachTiles } : null
    this.reachTiles = params?.archetype === 'swing-melee' || params?.archetype === 'thrust' ? params.reachTiles : 0
    this.returning = params?.archetype === 'returning' ? { variant: params.variant, throwRangeTiles: params.throwRangeTiles } : null
    this.tethered = params?.archetype === 'returning' && params.returnMode === 'tethered'
    this.beam = params?.archetype === 'piercing-beam' && params.mode === 'channel-beam'
    this.whip = params?.archetype === 'whip' ? { arcDegrees: params.arcDegrees, rangeTiles: params.rangeTiles } : null
    this.summonKind = params?.archetype === 'minion-sentry' ? params.variant : null
    this.explosive =
      params?.archetype === 'explosive-aoe' ? { blastRadiusTiles: params.blastRadiusTiles, trigger: params.trigger, fuseTicks: params.fuseTicks ?? null, falloff: params.falloff } : null
    this.loadout = sim.loadout ? loadout : null
    this.bossDefenses = bossDefenses
    this.shotNoun =
      params?.archetype === 'returning' || params?.archetype === 'explosive-aoe'
        ? 'throw'
        : params?.archetype === 'bow-gun' ||
            params?.archetype === 'magic-bolt' ||
            (params?.archetype === 'piercing-beam' && params.mode === 'pierce-projectile') ||
            (params?.archetype === 'minion-sentry' && params.aiClass === 'ranged-shot' && params.projectile !== undefined)
          ? 'shot'
          : null
    this.firesProjectiles = firesProjectiles(this.summary.archetype)
    this.frameTiles = this.firesProjectiles ? RANGED_FRAME_TILES : this.reachTiles
    this.target = target
    this.dummyIds = sim.renderState().dummies.map((d) => d.id)
    this.hud = this.computeHud(sim.snapshot())
  }

  /**
   * A thrown explosive's blast as the phone camera frames it (design review P3-S11 #3): the circle of its
   * radius around where a Space or timed-test throw comes to rest and goes off — on the ground under the
   * first dummy (the engine's landing point). Framing only; null for any other weapon.
   */
  blastFrame(): { x: number; y: number; radiusTiles: number } | null {
    const first = this.explosive ? this.sim.renderState().dummies[0] : undefined
    if (!this.explosive || !first) return null
    // A Moving Dummy (P3-S12): framed at its home, wherever it is now — the camera never follows it.
    return { x: first.path ? first.path.fromX : first.x, y: GROUND_Y_TILES - THROWN_REST_HEIGHT_TILES, radiusTiles: this.explosive.blastRadiusTiles }
  }

  /** Summons are involved: a summon staff, or the minion loadout. */
  get hasSummons(): boolean {
    return this.summonKind !== null || this.loadout !== null
  }

  /** The AssumptionsTip list for the equipped weapon and the current target. */
  get assumptions(): readonly LabAssumption[] {
    if (!this.assumptionList || !sameTarget(this.assumptionList.target, this.target)) {
      const list = labAssumptionsFor(this.summary.archetype, this.sim.approximations, this.weapon, {
        target: this.target,
        boss: this.target.kind === 'armored' ? namedBoss(this.target, this.bossDefenses) : null,
        returnsToHand: this.summary.returnsToHand,
        summons: this.hasSummons,
        loadout: this.loadout !== null,
      })
      this.assumptionList = { target: this.target, list }
    }
    return this.assumptionList.list
  }

  // ------------------------------------------------------------------------------- input

  /** Start holding attack from `source`; a pointer press also aims at `aim` (world tiles). Ignored during a timed test. */
  press(source: InputSource, aim?: Vec2 | null): void {
    if (this.run) return
    if (aim !== undefined) this.aim = aim
    if (source === 'key') this.aim = null
    this.held[source] = true
    this.latched = true
    this.syncInput()
  }

  release(source: InputSource): void {
    this.held[source] = false
    this.syncInput()
  }

  /** Window blur / pointer lost: stop attacking (never leave attack stuck on). */
  releaseAll(): void {
    this.held.pointer = false
    this.held.key = false
    this.syncInput()
  }

  /** Pointer moved while held: the next swing faces the pointer. */
  setAim(aim: Vec2 | null): void {
    if (this.run) return
    this.aim = aim
    this.syncInput()
  }

  get attacking(): boolean {
    return this.held.pointer || this.held.key || this.latched
  }

  /** A timed test is running (the engine refuses input and settings changes until it ends). */
  get locked(): boolean {
    return this.run !== null && this.ticks < this.run.ticksTotal
  }

  private syncInput(): void {
    // Refused (config-locked) while a timed test runs; the engine holds attack itself.
    this.sim.setInput({ attacking: this.attacking, aim: this.aim })
  }

  // ------------------------------------------------------------------------------- loop

  /** Feed one frame's wall-clock delta; returns the interpolation alpha and this frame's events. */
  frame(dtMs: number): { alpha: number; events: SimEvent[] } {
    this.syncInput()
    const { alpha, ticksRun } = this.sim.advance(dtMs)
    const events = this.sim.drainEvents()
    let changed = false
    for (const e of events) {
      if (e.type === 'use-start') {
        // One whole attack cycle: its use time + the weapon's cooldown (the next attack can't start sooner).
        const cadence = e.durationTicks + this.summary.reuseDelayTicks
        this.busyTicks += cadence
        this.recentAttackTicks.push(cadence)
        if (this.recentAttackTicks.length > RATE_WINDOW_ATTACKS) this.recentAttackTicks.shift()
        this.slowestAttackTicks = Math.max(this.slowestAttackTicks, cadence)
        // A weapon that comes back: this attack lasts until it is back in hand (at least the cycle above).
        if (this.summary.returnsToHand) this.out = { start: e.tick, nominal: cadence, credited: cadence }
        this.latched = false
        this.slowCasting = e.slowCast
        if (e.slowCast) this.raiseManaWarning()
        changed = true
      } else if (e.type === 'projectile-despawn' && e.reason === 'returned') {
        // Caught: the next attack may start on the following tick — that is where this one ends.
        this.extendOut(e.tick + 1)
        this.out = null
        changed = true
      } else if (e.type === 'projectile-despawn' && this.target.kind === 'moving') {
        // A shot gone (the Moving Dummy's missed shots may have changed).
        changed = true
      } else if (e.type === 'use-blocked') {
        // A cast stopped for mana.
        this.raiseManaWarning()
        changed = true
      } else if (e.type === 'damage') {
        // The latest direct hit's source, as the engine's `lastHit` counts it (damage over time is no hit).
        if (e.source !== 'dot') this.lastHitSource = e.source === 'minion' || e.source === 'sentry' ? e.source : 'weapon'
        // A blast's hit (its projectile's, labeled with the percent it kept): the latest blast's share.
        if (e.blastKeptPct !== undefined && this.blast && e.sourceId === `proj:${this.blast.projectileId}`) this.blast.hits.set(e.dummyId, { amount: e.amount, crit: e.crit, keptPct: e.blastKeptPct })
        changed = true
      } else if (e.type === 'explosion') {
        // A thrown explosive went off: its hits follow in this batch (same tick).
        this.blast = { projectileId: e.projectileId, index: ++this.blasts, radiusTiles: e.radiusTiles, hits: new Map() }
        changed = true
      } else if (e.type === 'debuff-applied' || e.type === 'debuff-expired') {
        // The Debuff Dummy's list (and the debuffs-applied count) changed.
        changed = true
      } else if (e.type === 'dismiss') {
        // A summon leaving changes the count; the oldest replaced by a new one is announced.
        if (e.reason === 'replaced') this.summonsReplaced++
        changed = true
      } else if (e.type === 'projectile-spawn') {
        // Shots (ammo used) change the HUD.
        changed = true
      } else if (e.type === 'summon') {
        // From the first summon on, every tick counts toward the summons' time (`dps-with-summons`).
        this.summonSince ??= e.tick
        changed = true
      } else if (e.type === 'tag-applied') {
        this.tagEnds.set(e.dummyId, e.tick + e.durationTicks)
        changed = true
      } else if (e.type === 'tag-expired') {
        this.tagEnds.delete(e.dummyId)
        changed = true
      }
    }
    if (ticksRun > 0) {
      const before = this.ticks
      this.ticks += ticksRun
      // Still out (a boomerang in flight, a yoyo held out): the attack keeps lasting — the HUD follows
      // it a tenth of a second at a time.
      if (this.extendOut(this.ticks) && Math.floor(before / OUT_STEP_TICKS) !== Math.floor(this.ticks / OUT_STEP_TICKS)) changed = true
      // The DPS graph gains a bar each whole second (idle seconds too).
      if (Math.floor(before / TICKS_PER_SECOND) !== Math.floor(this.ticks / TICKS_PER_SECOND)) changed = true
      // A whip tag's time left, a tenth of a second at a time; summons keep est. DPS moving between hits.
      if ((this.tagEnds.size > 0 || this.summonSince !== null) && Math.floor(before / TAG_STEP_TICKS) !== Math.floor(this.ticks / TAG_STEP_TICKS)) changed = true
      // The Debuff Dummy's bars, a tenth of a second at a time while any debuff runs on it.
      if ((this.hud.debuffDummy?.debuffs.length ?? 0) > 0 && Math.floor(before / DEBUFF_STEP_TICKS) !== Math.floor(this.ticks / DEBUFF_STEP_TICKS)) changed = true
      // A running test steps its countdown ring, and publishes the moment it finishes.
      if (this.run && before < this.run.ticksTotal) {
        if (Math.floor(before / COUNTDOWN_STEP_TICKS) !== Math.floor(this.ticks / COUNTDOWN_STEP_TICKS) || this.ticks >= this.run.ticksTotal) changed = true
      }
      // The ManaBar follows regeneration and its warning latch (a tenth of a second at a time, only
      // when the pool moved or the warning cleared).
      if (!changed && this.hud.mana && Math.floor(before / MANA_STEP_TICKS) !== Math.floor(this.ticks / MANA_STEP_TICKS)) {
        const { mana } = this.sim.snapshot()
        const warned = this.manaWarning
        this.trackManaWarning(mana)
        if (mana && (mana.current !== this.hud.mana.current || this.manaWarning !== warned)) changed = true
      }
    }
    if (!this.latched) this.syncInput()
    if (changed) this.publish()
    return { alpha, events }
  }

  /**
   * The single ResetButton action (PRD P3-S2 AC3, UX_SPEC §6): aborts any timed test, clears the
   * stats and the dummy, and restores the default test settings — instant, no confirmation.
   */
  reset(): void {
    // The first reset ends any test (settings are locked while one runs); then the world is rebuilt
    // with the default settings and the default target (the Infinite Dummy), so the mana pool starts
    // full at the default capacity.
    this.sim.reset({ seed: this.nextSeed() })
    this.sim.updateSettings({ ...DEFAULT_LAB_SETTINGS })
    this.target = DEFAULT_LAB_TARGET
    const dummies = labDummiesFor(this.summary.archetype, DEFAULT_LAB_TARGET)
    this.sim.setDummies(dummies)
    this.dummyIds = dummies.map((d, i) => d.id ?? `dummy-${i}`)
    this.run = null
    this.ticks = 0
    this.latched = false
    this.clearSessionCounters()
    this.resets++
    this.syncInput()
    this.notifyReset()
    this.publish()
  }

  /**
   * Change test settings (refused while a timed test runs). A mana setting of a mana weapon decides
   * how every cast is paid, so changing one starts the stats over — a fresh pool at the new settings,
   * a fresh seed, a clean dummy — as switching ammo does (design review P3-S4/S5 M6). So does a slot
   * setting while summons are involved: the summons start over (a minion loadout fills the new slots).
   */
  updateSettings(patch: Partial<LabSettings>): LabSettingsUpdateResult {
    const before = this.hud.settings
    const result = this.sim.updateSettings(patch)
    if (!result.ok) return result
    const changed = (keys: readonly (keyof LabSettings)[]) => keys.some((key) => before[key] !== result.settings[key])
    const restarted = (this.hud.mana !== null && changed(MANA_SETTING_KEYS)) || (this.hasSummons && changed(SLOT_SETTING_KEYS))
    if (restarted) this.restart()
    else this.publish()
    return { ...result, restarted }
  }

  /**
   * Change the target (PRD P3-S6 AC1, P3-S11 AC3): the Infinite Dummy, a row of Multiple Dummies, or the Debuff Dummy. A new world
   * with the new dummies starts the stats over, like switching ammo — the settings stay. Refused while
   * a timed test runs (and for a target the Lab doesn't offer); true when the target is in place.
   */
  setTarget(target: LabTarget): boolean {
    if (this.locked || !isLabTarget(target)) return false
    if (sameTarget(target, this.target)) return true
    const dummies = labDummiesFor(this.summary.archetype, target)
    if (!this.sim.setDummies(dummies, { seed: this.nextSeed() }).ok) return false
    this.target = target
    this.dummyIds = dummies.map((d, i) => d.id ?? `dummy-${i}`)
    this.run = null
    this.ticks = 0
    this.clearSessionCounters()
    this.syncInput()
    this.notifyReset()
    this.publish()
    return true
  }

  /** A fresh world with the current settings (stats, pool, dummy, projectiles) — the settings stay. */
  private restart(): void {
    this.sim.reset({ seed: this.nextSeed() })
    this.ticks = 0
    this.clearSessionCounters()
    this.syncInput()
    this.notifyReset()
    this.publish()
  }

  private clearSessionCounters(): void {
    this.out = null
    this.summonSince = null
    this.tagEnds.clear()
    this.summonsReplaced = 0
    this.lastHitSource = 'weapon'
    this.blast = null
    this.blasts = 0
    this.busyTicks = 0
    this.recentAttackTicks = []
    this.slowestAttackTicks = 0
    this.slowCasting = false
    this.manaWarning = false
    this.manaCoveredSince = null
  }

  /** Start a standardized 10 s / 30 s test with a fresh seed. False while one is already running. */
  startTimedTest(durationSec: TimedTestDuration): boolean {
    return this.beginTest(durationSec, this.nextSeed(), null)
  }

  /** "Run again": the last test's duration, seed and settings — the exact same result (sim contract). */
  runAgain(): boolean {
    const run = this.run
    if (!run || this.locked) return false
    return this.beginTest(run.durationSec, run.seed, run.settings)
  }

  private beginTest(durationSec: TimedTestDuration, seed: number, settings: LabSettings | null): boolean {
    if (this.locked) return false
    if (settings) this.sim.updateSettings(settings)
    // Standardized: no held input carries over, and the engine aims at the dummy (aim frozen at null).
    this.held.pointer = false
    this.held.key = false
    this.latched = false
    this.aim = null
    this.sim.setInput({ attacking: false, aim: null })
    if (!this.sim.startTimedTest(durationSec, { seed }).ok) return false
    this.run = { durationSec, seed, settings: this.sim.snapshot().settings, ticksTotal: timedTestTicks(durationSec) }
    this.ticks = 0
    this.clearSessionCounters()
    this.notifyReset()
    this.publish()
    return true
  }

  // ------------------------------------------------------------------------------- HUD

  getHud = (): LabHudState => this.hud

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Renderer hook: clear floating numbers and dummy effects on reset (and when a test starts). */
  onReset(listener: () => void): () => void {
    this.resetListeners.add(listener)
    return () => this.resetListeners.delete(listener)
  }

  private notifyReset(): void {
    for (const listener of this.resetListeners) listener()
  }

  private publish(): void {
    const snapshot = this.sim.snapshot()
    this.trackManaWarning(snapshot.mana)
    this.hud = this.computeHud(snapshot)
    for (const listener of this.listeners) listener()
  }

  /** A cast couldn't be paid: the warning shows (again) and its clear-out timer starts over. */
  private raiseManaWarning(): void {
    this.manaWarning = true
    this.manaCoveredSince = null
  }

  /**
   * The warning latch against the pool as of now: raised while the pool is below the cost; cleared
   * once it has covered the cost for MANA_WARNING_CLEAR_TICKS and longer than the slowest attack
   * seen (a cast cycle funded by regeneration covers the cost for at most one attack at a time).
   */
  private trackManaWarning(mana: ManaState | null): void {
    if (!mana || mana.ignoreMana) {
      this.manaWarning = false
      this.manaCoveredSince = null
      return
    }
    if (mana.current < this.summary.manaCostPerUse) return this.raiseManaWarning()
    if (!this.manaWarning) return
    this.manaCoveredSince ??= this.ticks
    if (this.ticks - this.manaCoveredSince >= Math.max(MANA_WARNING_CLEAR_TICKS, this.slowestAttackTicks + 1)) {
      this.manaWarning = false
      this.manaCoveredSince = null
    }
  }

  /**
   * The attack in progress of a weapon that comes back lasts until `now` (world ticks; the session's
   * tick count mirrors the engine's since every reset): grow its share of the attack time and of the
   * attacks/sec window. True when it grew.
   */
  private extendOut(now: number): boolean {
    const out = this.out
    if (!out) return false
    const length = Math.max(out.nominal, now - out.start)
    const grown = length - out.credited
    if (grown <= 0) return false
    out.credited = length
    this.busyTicks += grown
    const last = this.recentAttackTicks.length - 1
    if (last >= 0) this.recentAttackTicks[last] += grown
    this.slowestAttackTicks = Math.max(this.slowestAttackTicks, length)
    return true
  }

  /** The latest attacks ÷ the ticks they took, per second; the nominal rate before any attack. */
  private liveAttackRate(): number {
    const window = this.recentAttackTicks
    if (window.length === 0) return this.summary.nominalAttacksPerSec
    return (window.length * TICKS_PER_SECOND) / window.reduce((sum, ticks) => sum + ticks, 0)
  }

  private manaHud(mana: ManaState | null, settings: LabSettings): LabManaHud | null {
    if (!mana) return null
    const costPerUse = this.summary.manaCostPerUse
    return {
      current: mana.current,
      max: mana.max,
      costPerUse,
      ignoreMana: mana.ignoreMana,
      low: !mana.ignoreMana && mana.current < costPerUse,
      warning: !mana.ignoreMana && this.manaWarning,
      policy: settings.insufficientMana,
      regen: settings.manaRegen !== 'none',
      slowCasting: this.slowCasting,
    }
  }

  private targetsHud(stats: SimSnapshot['stats'], attackSeconds: number): LabTargetsHud | null {
    if (this.target.kind !== 'row') return null
    const dummies = this.dummyIds.map((id, i): LabDummyHud => {
      const d = stats.perDummy[id]
      const damage = d?.damage ?? 0
      return { id, number: i + 1, primary: i === 0, hits: d?.hits ?? 0, crits: d?.crits ?? 0, damage, estimatedDps: attackSeconds > 0 ? damage / attackSeconds : 0 }
    })
    return { dummies, primary: dummies[0] }
  }

  /** The summons vs their slots: the staff's own kind, or the loadout's minions; null without summons. */
  private summonsHud(summons: SimSnapshot['summons']): LabSummonsHud | null {
    if (!this.hasSummons) return null
    const kind: SummonKind = this.summonKind ?? 'minion'
    const minion = kind === 'minion'
    // The row numbers of the dummies the summons attack now (nearest first, as the arena numbers them).
    const targeted = new Set(this.sim.renderState().agents.map((a) => a.targetId))
    const targets = this.dummyIds.flatMap((id, i) => (targeted.has(id) ? [i + 1] : []))
    return {
      source: this.summonKind ? 'weapon' : 'loadout',
      kind,
      count: minion ? summons.minions : summons.sentries,
      slotsUsed: minion ? summons.minionSlotsUsed : summons.sentrySlotsUsed,
      slots: minion ? summons.minionSlots : summons.sentrySlots,
      loadoutName: this.summonKind ? null : (this.loadout?.name ?? null),
      replaced: this.summonsReplaced,
      targets,
    }
  }

  /** The latest blast, by dummy in row order (a dummy outside it: null). */
  private blastHud(): LabBlastHud | null {
    const blast = this.blast
    if (!blast || !this.explosive) return null
    return {
      index: blast.index,
      radiusTiles: blast.radiusTiles,
      falloff: this.explosive.falloff,
      dummies: this.dummyIds.map((id, i) => {
        const hit = blast.hits.get(id)
        return { id, number: i + 1, amount: hit?.amount ?? null, crit: hit?.crit ?? false, keptPct: hit?.keptPct ?? null }
      }),
    }
  }

  /** The Debuff Dummy's panel (that target only): the engine's debuff state on its dummy, named from the registry. */
  private debuffDummyHud(stats: SimSnapshot['stats']): LabDebuffDummyHud | null {
    if (this.target.kind !== 'debuff') return null
    const dummy = this.sim.renderState().dummies[0]
    const named = (buffId: string) => {
      const buff = this.buffs.find((b) => b.id === buffId)
      const dps = buff?.dot?.dps
      return { buffId, name: buff?.name ?? buffId, dps: typeof dps === 'number' ? dps : null }
    }
    const applied = [this.weapon.labBehavior, this.loadout?.labBehavior].flatMap((lab) => (lab?.kind === 'archetype' && lab.modifiers?.dot ? [lab.modifiers.dot.buffId] : []))
    return {
      debuffs: (dummy?.debuffs ?? []).map((d) => ({
        ...named(d.buffId),
        remainingSec: d.remainingTicks / TICKS_PER_SECOND,
        durationSec: d.durationTicks / TICKS_PER_SECOND,
        fraction: d.durationTicks > 0 ? Math.min(1, Math.max(0, d.remainingTicks / d.durationTicks)) : 0,
      })),
      weaponApplies: applied.length > 0,
      applies: [...new Set(applied)].map(named),
      dotDamage: (dummy ? stats.perDummy[dummy.id]?.dotDamage : undefined) ?? 0,
    }
  }

  private tagsHud(): LabTagHud[] {
    if (this.tagEnds.size === 0) return []
    return this.dummyIds.flatMap((id, i) => {
      const end = this.tagEnds.get(id)
      return end === undefined ? [] : [{ dummyId: id, number: i + 1, remainingSec: Math.max(0, end - this.ticks) / TICKS_PER_SECOND }]
    })
  }

  private computeHud({ stats, timedTest, settings, mana, summons }: SimSnapshot): LabHudState {
    // With summons out, every tick since the first one appeared is attack time (`dps-with-summons`).
    const summonTicks = this.summonSince === null ? 0 : this.ticks - this.summonSince
    const attackSeconds = Math.max(this.busyTicks, summonTicks) / TICKS_PER_SECOND
    return {
      weapon: this.summary,
      lastHit: stats.lastHit ? { amount: stats.lastHit.amount, crit: stats.lastHit.crit, source: this.lastHitSource } : null,
      totalDamage: stats.totalDamage,
      directDamage: stats.directDamage,
      dotDamage: stats.dotDamage,
      hits: stats.hits,
      crits: stats.crits,
      ammoConsumed: stats.ammoConsumed,
      consumablesUsed: stats.consumablesUsed,
      debuffsApplied: stats.debuffsApplied,
      manaConsumed: stats.manaConsumed,
      mana: this.manaHud(mana, settings),
      attacksPerSec: this.liveAttackRate(),
      hitsPerSec: attackSeconds > 0 ? stats.hits / attackSeconds : 0,
      rateReadout: this.summonKind ? 'summon-hits' : this.tethered ? 'hits' : 'attacks',
      estimatedDps: attackSeconds > 0 ? stats.totalDamage / attackSeconds : 0,
      attackSeconds,
      resets: this.resets,
      timedTest: {
        status: timedTest.status,
        durationSec: timedTest.durationSec,
        remainingSec: timedTest.remainingSec,
        progress: timedTest.status === 'finished' ? 1 : timedTest.ticksTotal > 0 ? timedTest.ticksElapsed / timedTest.ticksTotal : 0,
        result: timedTest.result,
      },
      graph: {
        series: stats.dpsSeries,
        startSecond: stats.seriesStartSecond,
        currentSecondDamage: stats.currentSecondDamage,
        elapsedTicks: stats.ticks,
      },
      settings,
      target: this.target,
      targets: this.targetsHud(stats, attackSeconds),
      summons: this.summonsHud(summons),
      breakdown: this.hasSummons || this.whip ? stats.breakdown : null,
      tags: this.tagsHud(),
      lastBlast: this.blastHud(),
      debuffDummy: this.debuffDummyHud(stats),
      shots: this.target.kind === 'moving' && this.shotNoun ? { noun: this.shotNoun, fired: stats.projectilesSpawned, missed: stats.projectilesMissed } : null,
      locked: timedTest.status === 'running',
    }
  }
}
