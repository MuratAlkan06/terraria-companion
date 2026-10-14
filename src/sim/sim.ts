/**
 * Public facade: `createLabSim(options)` → a headless, deterministic LabSim, or a typed refusal.
 * Owns the fixed-step clock, the timed-test controller (exactly 600/1800 ticks, config-locked), and
 * world resets. See ./README.md for the API contract the Lab UI consumes.
 */
import {
  DEFAULT_ARENA,
  DEFAULT_DUMMY_X_TILES,
  DEFAULT_DUMMY_Y_TILES,
  DEFAULT_MAX_MANA,
  DEFAULT_MINION_SLOTS,
  DEFAULT_SENTRY_SLOTS,
  DUMMY_ROW_SPACING_TILES,
  MAX_MINION_SLOTS,
  MAX_SENTRY_SLOTS,
  TICKS_PER_SECOND,
  TIMED_TEST_DURATIONS,
  timedTestTicks,
  type TimedTestDuration,
} from './constants'
import { FixedStepClock } from './clock'
import { prepareLoadout, prepareSimulation, type LoadoutPlan, type SimPlan } from './guard'
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
  SetDummiesResult,
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
  minionSlots: DEFAULT_MINION_SLOTS,
  sentrySlots: DEFAULT_SENTRY_SLOTS,
})

export const DEFAULT_DUMMY: Readonly<DummySpec> = Object.freeze({ id: 'dummy-0', x: DEFAULT_DUMMY_X_TILES, y: DEFAULT_DUMMY_Y_TILES })

/**
 * Multiple Dummies (PRD P3-S6 AC1): `count` standard dummies in a row on the ground, the first (the
 * primary target — auto-aim's dummy) centred at `firstX`, each next one `spacingTiles` further away.
 * Ids `dummy-0` … `dummy-<count − 1>`, nearest first. Throws on a count that is not a positive integer
 * (a programming error, not data).
 */
export function dummyRow(count: number, firstX: number = DEFAULT_DUMMY_X_TILES, spacingTiles: number = DUMMY_ROW_SPACING_TILES): DummySpec[] {
  if (!Number.isInteger(count) || count < 1) throw new RangeError(`dummyRow: count must be a positive integer, got ${count}`)
  return Array.from({ length: count }, (_, i) => ({ id: `dummy-${i}`, x: firstX + i * spacingTiles, y: DEFAULT_DUMMY_Y_TILES }))
}

const MAX_MANA_LIMIT = 10_000

export function validateSettings(s: LabSettings): string | null {
  if (typeof s.ignoreMana !== 'boolean') return 'ignoreMana must be a boolean'
  if (!Number.isInteger(s.maxMana) || s.maxMana < 1 || s.maxMana > MAX_MANA_LIMIT) return `maxMana must be an integer in 1..${MAX_MANA_LIMIT}`
  if (s.manaRegen !== 'wiki-1.4.5.7' && s.manaRegen !== 'none') return 'manaRegen must be "wiki-1.4.5.7" or "none"'
  if (s.insufficientMana !== 'block' && s.insufficientMana !== 'slow-cast') return 'insufficientMana must be "block" or "slow-cast"'
  if (typeof s.homingEnabled !== 'boolean') return 'homingEnabled must be a boolean'
  if (typeof s.damageVariance !== 'boolean') return 'damageVariance must be a boolean'
  if (!Number.isInteger(s.minionSlots) || s.minionSlots < 1 || s.minionSlots > MAX_MINION_SLOTS) return `minionSlots must be an integer in 1..${MAX_MINION_SLOTS}`
  if (!Number.isInteger(s.sentrySlots) || s.sentrySlots < 1 || s.sentrySlots > MAX_SENTRY_SLOTS) return `sentrySlots must be an integer in 1..${MAX_SENTRY_SLOTS}`
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
  let loadout: LoadoutPlan | null = null
  if (options.minionLoadout) {
    const loadoutPrepared = prepareLoadout(options.minionLoadout, prepared.plan, options.buffs)
    if (!loadoutPrepared.ok) return { ok: false, refusal: loadoutPrepared.refusal }
    loadout = loadoutPrepared.loadout
  }
  return { ok: true, sim: new Sim(prepared.plan, loadout, toSeed(options.seed ?? DEFAULT_SEED), settings, dummies, arena) }
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
  private readonly loadoutPlan: LoadoutPlan | null
  private dummies: readonly DummySpec[]
  private readonly arena: ArenaBounds

  constructor(plan: SimPlan, loadout: LoadoutPlan | null, seed: number, settings: LabSettings, dummies: readonly DummySpec[], arena: ArenaBounds) {
    this.plan = plan
    this.loadoutPlan = loadout
    this.seed = seed
    this.settings = settings
    this.dummies = dummies
    this.arena = arena
    this.world = this.newWorld()
  }

  get weapon() {
    return { ...this.plan.summary }
  }

  get loadout() {
    return this.loadoutPlan ? { ...this.loadoutPlan.summary } : null
  }

  get approximations() {
    const own = this.plan.approximations
    const extra = (this.loadoutPlan?.approximations ?? []).filter((a) => !own.some((b) => b.id === a.id))
    return [...own, ...extra].map((a) => ({ ...a }))
  }

  private newWorld(): World {
    return new World({
      seed: this.seed,
      behavior: this.plan.behavior,
      modifiers: this.plan.modifiers,
      dummies: this.dummies,
      arena: this.arena,
      settings: this.settings,
      useTicks: this.plan.useTicks,
      reuseDelayTicks: this.plan.reuseDelayTicks,
      activationTicks: this.plan.activationTicks,
      critChancePct: this.plan.critChancePct,
      manaCost: this.plan.manaCost,
      loadout: this.loadoutPlan ? { behavior: this.loadoutPlan.behavior, owner: this.loadoutPlan.owner } : null,
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

  setDummies(dummies: readonly DummySpec[], options?: { seed?: number }): SetDummiesResult {
    if (this.locked()) return { ok: false, reason: 'config-locked' }
    const next = dummies.map((d) => ({ ...d }))
    const error = validateDummies(next)
    if (error) return { ok: false, reason: 'invalid-dummy', message: error }
    this.dummies = next
    this.reset(options)
    return { ok: true }
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
        consumablesUsed: s.consumablesUsed,
        explosions: s.explosions,
        manaConsumed: s.manaConsumed,
        debuffsApplied: s.debuffsApplied,
        dpsSeries: s.dpsSeries,
        perDummy: s.perDummy,
        breakdown: s.breakdown,
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
      result: t.result
        ? {
            ...t.result,
            dpsSeries: [...t.result.dpsSeries],
            perDummy: Object.fromEntries(Object.entries(t.result.perDummy).map(([id, d]) => [id, { ...d }])),
            breakdown: { ...t.result.breakdown },
          }
        : null,
    }
  }

  snapshot(): SimSnapshot {
    return {
      tick: this.world.tick,
      seed: this.seed,
      weapon: this.weapon,
      stats: this.world.stats.snapshot(),
      mana: this.world.manaState(),
      summons: this.world.summonsState(),
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
