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
 * snapshot; attacks/sec = the weapon's nominal rate; est. DPS = total damage ÷ time spent in whole
 * attacks since the last reset (`dps-while-attacking` assumption) — the session average from the
 * engine would count idle time between bursts of play. DpsGraph = the engine's per-second series.
 *
 * Timed tests (PRD P3-S3 AC3) run on the engine's controller: exactly 600 / 1800 ticks, attack held,
 * auto-aimed at the dummy, config locked (input and settings changes are refused while it runs).
 * "Run again" replays the finished run's seed AND settings, so it reproduces the result exactly.
 * The single Reset (PRD P3-S2 AC3) aborts any test and restores the target and the default settings.
 */
import type { Weapon } from '../schemas'
import {
  createLabSim,
  DEFAULT_LAB_SETTINGS,
  TICKS_PER_SECOND,
  timedTestTicks,
  type LabSettings,
  type LabSim,
  type SettingsUpdateResult,
  type SimEvent,
  type SimRefusal,
  type TimedTestDuration,
  type TimedTestResult,
  type TimedTestStatus,
  type Vec2,
  type WeaponSummary,
} from '../sim'
import { labAssumptionsFor, type LabAssumption } from './labAssumptions'

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

export interface LabHudState {
  weapon: WeaponSummary
  lastHit: { amount: number; crit: boolean } | null
  totalDamage: number
  hits: number
  crits: number
  /** Attacks per second while attacking (the weapon's rate). */
  attacksPerSec: number
  /** Total damage ÷ seconds spent in whole attacks since the last reset. */
  estimatedDps: number
  /** Seconds of whole attacks counted since the last reset. */
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
}

export type CreateLabSessionResult = { ok: true; session: LabSession } | { ok: false; refusal: SimRefusal }

function randomSeed(): number {
  const buf = new Uint32Array(1)
  globalThis.crypto.getRandomValues(buf)
  return buf[0]
}

export function createLabSession(weapon: Weapon, options: LabSessionOptions = {}): CreateLabSessionResult {
  const nextSeed = options.seed ?? randomSeed
  const created = createLabSim({ weapon, seed: nextSeed(), ...(options.settings ? { settings: options.settings } : {}) })
  if (!created.ok) return { ok: false, refusal: created.refusal }
  return { ok: true, session: new LabSession(weapon, created.sim, nextSeed) }
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

export class LabSession {
  readonly weapon: Weapon
  readonly sim: LabSim
  readonly summary: WeaponSummary
  readonly swing: SwingShape | null
  /** Blade reach (tiles) for swung and thrust weapons, else 0 — the phone camera frames it. */
  readonly reachTiles: number
  readonly assumptions: readonly LabAssumption[]

  private readonly nextSeed: () => number
  private readonly held: Record<InputSource, boolean> = { pointer: false, key: false }
  private latched = false
  private aim: Vec2 | null = null
  private busyTicks = 0
  /** Ticks run since the last reset / test start (mirrors the engine's stats clock). */
  private ticks = 0
  private run: TimedRun | null = null
  private resets = 0
  private hud: LabHudState
  private readonly listeners = new Set<() => void>()
  private readonly resetListeners = new Set<() => void>()

  constructor(weapon: Weapon, sim: LabSim, nextSeed: () => number) {
    this.weapon = weapon
    this.sim = sim
    this.nextSeed = nextSeed
    this.summary = sim.weapon
    const lab = weapon.labBehavior
    const params = lab.kind === 'archetype' ? lab.params : null
    this.swing = params?.archetype === 'swing-melee' ? { arcDegrees: params.arcDegrees, reachTiles: params.reachTiles } : null
    this.reachTiles = params?.archetype === 'swing-melee' || params?.archetype === 'thrust' ? params.reachTiles : 0
    this.assumptions = labAssumptionsFor(this.summary.archetype, sim.approximations, weapon)
    this.hud = this.computeHud()
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
        this.busyTicks += e.durationTicks
        this.latched = false
        changed = true
      } else if (e.type === 'damage') {
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
    this.sim.reset({ seed: this.nextSeed() })
    this.sim.updateSettings({ ...DEFAULT_LAB_SETTINGS })
    this.run = null
    this.ticks = 0
    this.latched = false
    this.busyTicks = 0
    this.resets++
    this.syncInput()
    this.notifyReset()
    this.publish()
  }

  /** Change test settings (refused while a timed test runs). */
  updateSettings(patch: Partial<LabSettings>): SettingsUpdateResult {
    const result = this.sim.updateSettings(patch)
    if (result.ok) this.publish()
    return result
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
    this.busyTicks = 0
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
    this.hud = this.computeHud()
    for (const listener of this.listeners) listener()
  }

  private computeHud(): LabHudState {
    const { stats, timedTest, settings } = this.sim.snapshot()
    const attackSeconds = this.busyTicks / TICKS_PER_SECOND
    return {
      weapon: this.summary,
      lastHit: stats.lastHit ? { amount: stats.lastHit.amount, crit: stats.lastHit.crit } : null,
      totalDamage: stats.totalDamage,
      hits: stats.hits,
      crits: stats.crits,
      attacksPerSec: this.summary.nominalAttacksPerSec,
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
