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
 * rate. DpsGraph = the engine's per-second series.
 *
 * Timed tests (PRD P3-S3 AC3) run on the engine's controller: exactly 600 / 1800 ticks, attack held,
 * auto-aimed at the dummy, config locked (input and settings changes are refused while it runs).
 * "Run again" replays the finished run's seed AND settings, so it reproduces the result exactly.
 * The single Reset (PRD P3-S2 AC3) aborts any test and restores the target and the default settings.
 *
 * Setup (./labSetup.ts): a bow or gun fires the ammo it is created with (the engine fixes ammo per
 * sim, so switching ammo is a new session — stats, "Ammo used" included, start from zero); a
 * damage-over-time weapon gets the buff registry; weapons that fire projectiles face the ranged
 * dummy. Mana (PRD P3-S5, AMENDMENTS-008 B35): the HUD's ManaBar reads the engine's pool, refreshed
 * on every attack and every tenth of a second while it regenerates; `slowCasting` is the latest
 * attack's own flag from the engine (a low-mana cast at 40% speed). The low-mana WARNING is latched
 * (design review P3-S4/S5 B1): raised the moment a cast can't be paid (a slow or blocked cast, or the
 * pool seen below the cost), it stays until the pool has covered the cost for a whole second — and
 * for longer than the slowest attack seen, so a regen-funded cast cycle never blinks it — or the
 * session restarts. Changing a mana setting restarts the session's stats, pool and dummy with the
 * new settings, like switching ammo (`updateSettings` → `restarted`).
 */
import type { Buff, Item, Weapon } from '../schemas'
import {
  createLabSim,
  DEFAULT_LAB_SETTINGS,
  TICKS_PER_SECOND,
  timedTestTicks,
  type InsufficientManaPolicy,
  type LabSettings,
  type LabSim,
  type ManaState,
  type SettingsUpdateResult,
  type SimEvent,
  type SimRefusal,
  type SimSnapshot,
  type TimedTestDuration,
  type TimedTestResult,
  type TimedTestStatus,
  type Vec2,
  type WeaponSummary,
} from '../sim'
import { labAssumptionsFor, type LabAssumption } from './labAssumptions'
import { ammoClassOf, firesProjectiles, labDummiesFor, resolveAmmo, type LabSetup } from './labSetup'

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

export interface LabHudState {
  weapon: WeaponSummary
  lastHit: { amount: number; crit: boolean } | null
  totalDamage: number
  directDamage: number
  dotDamage: number
  hits: number
  crits: number
  /** "Ammo used" since the last reset (bows and guns: one per shot). */
  ammoConsumed: number
  /** "Mana used" since the last reset (counted in test mode too). */
  manaConsumed: number
  mana: LabManaHud | null
  /**
   * Attacks per second while attacking: the latest RATE_WINDOW_ATTACKS attacks ÷ the time they took
   * (low-mana slow casts included); the weapon's nominal rate before the first attack.
   */
  attacksPerSec: number
  /** Total damage ÷ seconds spent in whole attack cycles (use time + cooldown) since the last reset. */
  estimatedDps: number
  /** Seconds of whole attack cycles (use time + cooldown) counted since the last reset. */
  attackSeconds: number
  /** Increments on every reset (lets the UI announce it). */
  resets: number
  timedTest: LabTimedTestHud
  graph: LabGraphHud
  settings: LabSettings
  /** A timed test is running: the weapon, target and settings can't change (UX_SPEC §5.7). */
  locked: boolean
}

/** Swing shape for the renderer (from the weapon's archetype params — never per-weapon code). */
export interface SwingShape {
  arcDegrees: number
  reachTiles: number
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
}

export type CreateLabSessionResult = { ok: true; session: LabSession } | { ok: false; refusal: SimRefusal }

/** The test settings that decide how a mana weapon's casts are paid: changing one restarts the stats. */
export const MANA_SETTING_KEYS = ['maxMana', 'insufficientMana', 'manaRegen', 'ignoreMana'] as const satisfies readonly (keyof LabSettings)[]

/** `restarted`: a mana setting of a mana weapon changed, so the stats, pool and dummy started over. */
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
  const dummies = lab.kind === 'archetype' ? labDummiesFor(lab.params.archetype) : undefined
  const created = createLabSim({
    weapon,
    seed: nextSeed(),
    ...(options.settings ? { settings: options.settings } : {}),
    ...(ammo ? { ammo } : {}),
    ...(setup ? { buffs: setup.buffs } : {}),
    ...(dummies ? { dummies } : {}),
  })
  if (!created.ok) return { ok: false, refusal: created.refusal }
  return { ok: true, session: new LabSession(weapon, created.sim, nextSeed, ammo, setup?.buffs ?? []) }
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
  readonly assumptions: readonly LabAssumption[]

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
  private hud: LabHudState
  private readonly listeners = new Set<() => void>()
  private readonly resetListeners = new Set<() => void>()

  constructor(weapon: Weapon, sim: LabSim, nextSeed: () => number, ammo: Item | null = null, buffs: readonly Buff[] = []) {
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
    this.firesProjectiles = firesProjectiles(this.summary.archetype)
    this.frameTiles = this.firesProjectiles ? RANGED_FRAME_TILES : this.reachTiles
    this.assumptions = labAssumptionsFor(this.summary.archetype, sim.approximations, weapon)
    this.hud = this.computeHud(sim.snapshot())
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
        this.latched = false
        this.slowCasting = e.slowCast
        if (e.slowCast) this.raiseManaWarning()
        changed = true
      } else if (e.type === 'use-blocked') {
        // A cast stopped for mana.
        this.raiseManaWarning()
        changed = true
      } else if (e.type === 'damage' || e.type === 'projectile-spawn') {
        // Hits and shots (ammo used) change the HUD.
        changed = true
      }
    }
    if (ticksRun > 0) {
      const before = this.ticks
      this.ticks += ticksRun
      // The DPS graph gains a bar each whole second (idle seconds too).
      if (Math.floor(before / TICKS_PER_SECOND) !== Math.floor(this.ticks / TICKS_PER_SECOND)) changed = true
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
    // The first reset ends any test (settings are locked while one runs); the second rebuilds the
    // world with the default settings, so the mana pool starts full at the default capacity.
    this.sim.reset({ seed: this.nextSeed() })
    this.sim.updateSettings({ ...DEFAULT_LAB_SETTINGS })
    this.sim.reset()
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
   * a fresh seed, a clean dummy — as switching ammo does (design review P3-S4/S5 M6).
   */
  updateSettings(patch: Partial<LabSettings>): LabSettingsUpdateResult {
    const before = this.hud.settings
    const result = this.sim.updateSettings(patch)
    if (!result.ok) return result
    const restarted = this.hud.mana !== null && MANA_SETTING_KEYS.some((key) => before[key] !== result.settings[key])
    if (restarted) this.restart()
    else this.publish()
    return { ...result, restarted }
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

  private computeHud({ stats, timedTest, settings, mana }: SimSnapshot): LabHudState {
    const attackSeconds = this.busyTicks / TICKS_PER_SECOND
    return {
      weapon: this.summary,
      lastHit: stats.lastHit ? { amount: stats.lastHit.amount, crit: stats.lastHit.crit } : null,
      totalDamage: stats.totalDamage,
      directDamage: stats.directDamage,
      dotDamage: stats.dotDamage,
      hits: stats.hits,
      crits: stats.crits,
      ammoConsumed: stats.ammoConsumed,
      manaConsumed: stats.manaConsumed,
      mana: this.manaHud(mana, settings),
      attacksPerSec: this.liveAttackRate(),
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
      locked: timedTest.status === 'running',
    }
  }
}
