/**
 * Public facade: `createLabSim(options)` → a headless, deterministic LabSim, or a typed refusal.
 * Owns the fixed-step clock, the timed-test controller (exactly 600/1800 ticks, config-locked), and
 * world resets. See ./README.md for the API contract the Lab UI consumes.
 */
import { DEFAULT_ARENA, DEFAULT_DUMMY_X_TILES, DEFAULT_DUMMY_Y_TILES, DEFAULT_MAX_MANA, TICKS_PER_SECOND, TIMED_TEST_DURATIONS, timedTestTicks, type TimedTestDuration } from './constants'
import { FixedStepClock } from './clock'
import { prepareSimulation, type SimPlan } from './guard'
import { toSeed } from './rng'
import type {
  AdvanceResult,
  ArenaBounds,
  CreateLabSimResult,
  DummySpec,
  InvalidSetup,
  LabInput,
  LabSettings,
  LabSim,
  LabSimOptions,
  RenderState,
  SettingsUpdateResult,
  SimEvent,
  SimSnapshot,
  StartTimedTestResult,
  TimedTestResult,
  TimedTestState,
} from './types'
import { World } from './world'

export const DEFAULT_SEED = 1

export const DEFAULT_LAB_SETTINGS: Readonly<LabSettings> = Object.freeze({
  ignoreMana: false,
  maxMana: DEFAULT_MAX_MANA,
  manaRegen: 'wiki-1.4.5.7',
  insufficientMana: 'slow-cast', // AMENDMENTS-008 B35: the pinned 1.4.5.8 game rule (40% attack speed)
  homingEnabled: true,
  damageVariance: true,
})

export const DEFAULT_DUMMY: Readonly<DummySpec> = Object.freeze({ id: 'dummy-0', x: DEFAULT_DUMMY_X_TILES, y: DEFAULT_DUMMY_Y_TILES })

const MAX_MANA_LIMIT = 10_000

export function validateSettings(s: LabSettings): string | null {
  if (typeof s.ignoreMana !== 'boolean') return 'ignoreMana must be a boolean'
  if (!Number.isInteger(s.maxMana) || s.maxMana < 1 || s.maxMana > MAX_MANA_LIMIT) return `maxMana must be an integer in 1..${MAX_MANA_LIMIT}`
  if (s.manaRegen !== 'wiki-1.4.5.7' && s.manaRegen !== 'none') return 'manaRegen must be "wiki-1.4.5.7" or "none"'
  if (s.insufficientMana !== 'block' && s.insufficientMana !== 'slow-cast') return 'insufficientMana must be "block" or "slow-cast"'
  if (typeof s.homingEnabled !== 'boolean') return 'homingEnabled must be a boolean'
  if (typeof s.damageVariance !== 'boolean') return 'damageVariance must be a boolean'
  return null
}

function validateDummies(dummies: readonly DummySpec[]): string | null {
  const ids = new Set<string>()
  for (const [i, d] of dummies.entries()) {
    const id = d.id ?? `dummy-${i}`
    if (ids.has(id)) return `duplicate dummy id "${id}"`
    ids.add(id)
    if (!Number.isFinite(d.x) || !Number.isFinite(d.y)) return `dummy "${id}" position must be finite`
    for (const size of [d.widthTiles, d.heightTiles]) {
      if (size !== undefined && !(Number.isFinite(size) && size > 0)) return `dummy "${id}" size must be positive`
    }
    if (d.defense !== undefined && !(Number.isInteger(d.defense) && d.defense >= 0)) return `dummy "${id}" defense must be a non-negative integer`
  }
  return null
}

function validateArena(a: ArenaBounds): string | null {
  const finite = [a.minX, a.maxX, a.minY, a.maxY].every(Number.isFinite)
  if (!finite || !(a.minX < 0 && a.maxX > 0 && a.minY < 0 && a.maxY > 0)) return 'arena must be finite and contain the player at the origin'
  return null
}

const invalid = (reason: InvalidSetup['reason'], message: string): CreateLabSimResult => ({ ok: false, refusal: { kind: 'invalid-setup', reason, message } })

export function createLabSim(options: LabSimOptions): CreateLabSimResult {
  const prepared = prepareSimulation(options)
  if (!prepared.ok) return { ok: false, refusal: prepared.refusal }
  const settings: LabSettings = { ...DEFAULT_LAB_SETTINGS, ...options.settings }
  const settingsError = validateSettings(settings)
  if (settingsError) return invalid('invalid-settings', settingsError)
  const dummies = (options.dummies ?? [DEFAULT_DUMMY]).map((d) => ({ ...d }))
  const dummyError = validateDummies(dummies)
  if (dummyError) return invalid('invalid-dummy', dummyError)
  const arena = { ...(options.arena ?? DEFAULT_ARENA) }
  const arenaError = validateArena(arena)
  if (arenaError) return invalid('invalid-arena', arenaError)
  return { ok: true, sim: new Sim(prepared.plan, toSeed(options.seed ?? DEFAULT_SEED), settings, dummies, arena) }
}

interface TestState {
  status: TimedTestState['status']
  durationSec: TimedTestDuration | null
  ticksTotal: number
  ticksElapsed: number
  result: TimedTestResult | null
}

const IDLE_TEST: TestState = { status: 'idle', durationSec: null, ticksTotal: 0, ticksElapsed: 0, result: null }

class Sim implements LabSim {
  private world: World
  private readonly clock = new FixedStepClock()
  private seed: number
  private settings: LabSettings
  private test: TestState = { ...IDLE_TEST }
  private readonly plan: SimPlan
  private readonly dummies: readonly DummySpec[]
  private readonly arena: ArenaBounds

  constructor(plan: SimPlan, seed: number, settings: LabSettings, dummies: readonly DummySpec[], arena: ArenaBounds) {
    this.plan = plan
    this.seed = seed
    this.settings = settings
    this.dummies = dummies
    this.arena = arena
    this.world = this.newWorld()
  }

  get weapon() {
    return { ...this.plan.summary }
  }

  get approximations() {
    return this.plan.approximations.map((a) => ({ ...a }))
  }

  private newWorld(): World {
    return new World({
      seed: this.seed,
      behavior: this.plan.behavior,
      modifiers: this.plan.modifiers,
      dummies: this.dummies,
      arena: this.arena,
      settings: this.settings,
      cadenceTicks: this.plan.cadenceTicks,
      activationTicks: this.plan.activationTicks,
      critChancePct: this.plan.critChancePct,
      manaCost: this.plan.manaCost,
    })
  }

  advance(dtMs: number): AdvanceResult {
    if (this.finished()) {
      this.clock.clear()
      return { ticksRun: 0, alpha: 0 }
    }
    const ticksRun = this.runTicks(this.clock.push(dtMs))
    if (this.finished()) this.clock.clear()
    return { ticksRun, alpha: this.clock.alpha }
  }

  /** A finished timed test halts the world until reset() / startTimedTest(). */
  private finished(): boolean {
    return this.test.status === 'finished'
  }

  step(ticks = 1): number {
    return this.runTicks(Math.max(0, Math.floor(ticks)))
  }

  private runTicks(n: number): number {
    let ran = 0
    while (ran < n && !this.finished()) {
      this.world.step()
      ran++
      if (this.test.status === 'running' && ++this.test.ticksElapsed >= this.test.ticksTotal) this.finishTest()
    }
    return ran
  }

  private locked(): boolean {
    return this.test.status === 'running'
  }

  setInput(patch: Partial<LabInput>): { ok: true } | { ok: false; reason: 'config-locked' } {
    if (this.locked()) return { ok: false, reason: 'config-locked' }
    const next: LabInput = { ...this.world.input, ...patch }
    this.world.input = { attacking: next.attacking, aim: next.aim ? { x: next.aim.x, y: next.aim.y } : null }
    return { ok: true }
  }

  updateSettings(patch: Partial<LabSettings>): SettingsUpdateResult {
    if (this.locked()) return { ok: false, reason: 'config-locked' }
    const next: LabSettings = { ...this.settings, ...patch }
    const error = validateSettings(next)
    if (error) return { ok: false, reason: 'invalid-settings', message: error }
    this.settings = next
    this.world.applySettings(next)
    return { ok: true, settings: { ...next } }
  }

  reset(options?: { seed?: number }): void {
    if (options?.seed !== undefined) this.seed = toSeed(options.seed)
    const input = this.world.input
    this.world = this.newWorld()
    this.world.input = { ...input }
    this.clock.clear()
    this.test = { ...IDLE_TEST }
  }

  resetStats(): { ok: true } | { ok: false; reason: 'config-locked' } {
    if (this.locked()) return { ok: false, reason: 'config-locked' }
    this.world.stats.reset()
    return { ok: true }
  }

  startTimedTest(durationSec: TimedTestDuration, options?: { seed?: number }): StartTimedTestResult {
    if (this.locked()) return { ok: false, reason: 'already-running' }
    if (!(TIMED_TEST_DURATIONS as readonly number[]).includes(durationSec)) return { ok: false, reason: 'invalid-duration' }
    const aim = this.world.input.aim
    this.reset(options)
    // Config lock: attack held for the whole run, aim frozen (null ⇒ auto-aim at the first dummy).
    this.world.input = { attacking: true, aim: aim ? { ...aim } : null }
    this.test = { status: 'running', durationSec, ticksTotal: timedTestTicks(durationSec), ticksElapsed: 0, result: null }
    return { ok: true }
  }

  private finishTest(): void {
    const s = this.world.stats.snapshot()
    const durationSec = this.test.durationSec as TimedTestDuration
    this.test = {
      ...this.test,
      status: 'finished',
      result: {
        durationSec,
        ticks: s.ticks,
        seed: this.seed,
        estimatedDps: s.totalDamage / durationSec,
        totalDamage: s.totalDamage,
        directDamage: s.directDamage,
        dotDamage: s.dotDamage,
        hits: s.hits,
        crits: s.crits,
        uses: s.uses,
        attacksPerSec: s.uses / durationSec,
        ammoConsumed: s.ammoConsumed,
        manaConsumed: s.manaConsumed,
        debuffsApplied: s.debuffsApplied,
        dpsSeries: s.dpsSeries,
        eventDigest: this.world.eventDigest(),
      },
    }
  }

  private timedTestState(): TimedTestState {
    const t = this.test
    return {
      status: t.status,
      durationSec: t.durationSec,
      ticksElapsed: t.ticksElapsed,
      ticksTotal: t.ticksTotal,
      remainingSec: t.status === 'running' ? (t.ticksTotal - t.ticksElapsed) / TICKS_PER_SECOND : 0,
      result: t.result ? { ...t.result, dpsSeries: [...t.result.dpsSeries] } : null,
    }
  }

  snapshot(): SimSnapshot {
    return {
      tick: this.world.tick,
      seed: this.seed,
      weapon: this.weapon,
      stats: this.world.stats.snapshot(),
      mana: this.world.manaState(),
      timedTest: this.timedTestState(),
      settings: { ...this.settings },
      eventDigest: this.world.eventDigest(),
      rngState: this.world.rng.state,
    }
  }

  renderState(): RenderState {
    return this.world.renderState(this.finished() ? 0 : this.clock.alpha)
  }

  drainEvents(): SimEvent[] {
    return this.world.drainEvents()
  }
}
