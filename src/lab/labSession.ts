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
 * engine would count idle time between bursts of play.
 */
import type { Weapon } from '../schemas'
import { createLabSim, TICKS_PER_SECOND, type LabSim, type SimEvent, type SimRefusal, type Vec2, type WeaponSummary } from '../sim'
import { labAssumptionsFor, type LabAssumption } from './labAssumptions'

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
}

/** Swing shape for the renderer (from the weapon's archetype params — never per-weapon code). */
export interface SwingShape {
  arcDegrees: number
  reachTiles: number
}

export type InputSource = 'pointer' | 'key'

export interface LabSessionOptions {
  /** uint32 seed source; default: a fresh random seed per sim and per reset. */
  seed?: () => number
}

export type CreateLabSessionResult = { ok: true; session: LabSession } | { ok: false; refusal: SimRefusal }

function randomSeed(): number {
  const buf = new Uint32Array(1)
  globalThis.crypto.getRandomValues(buf)
  return buf[0]
}

export function createLabSession(weapon: Weapon, options: LabSessionOptions = {}): CreateLabSessionResult {
  const nextSeed = options.seed ?? randomSeed
  const created = createLabSim({ weapon, seed: nextSeed() })
  if (!created.ok) return { ok: false, refusal: created.refusal }
  return { ok: true, session: new LabSession(weapon, created.sim, nextSeed) }
}

export class LabSession {
  readonly weapon: Weapon
  readonly sim: LabSim
  readonly summary: WeaponSummary
  readonly swing: SwingShape | null
  readonly assumptions: readonly LabAssumption[]

  private readonly nextSeed: () => number
  private readonly held: Record<InputSource, boolean> = { pointer: false, key: false }
  private latched = false
  private aim: Vec2 | null = null
  private busyTicks = 0
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
    this.swing =
      lab.kind === 'archetype' && lab.params.archetype === 'swing-melee'
        ? { arcDegrees: lab.params.arcDegrees, reachTiles: lab.params.reachTiles }
        : null
    this.assumptions = labAssumptionsFor(this.summary.archetype, sim.approximations)
    this.hud = this.computeHud()
  }

  // ------------------------------------------------------------------------------- input

  /** Start holding attack from `source`; a pointer press also aims at `aim` (world tiles). */
  press(source: InputSource, aim?: Vec2 | null): void {
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
    this.aim = aim
    this.syncInput()
  }

  get attacking(): boolean {
    return this.held.pointer || this.held.key || this.latched
  }

  private syncInput(): void {
    this.sim.setInput({ attacking: this.attacking, aim: this.aim })
  }

  // ------------------------------------------------------------------------------- loop

  /** Feed one frame's wall-clock delta; returns the interpolation alpha and this frame's events. */
  frame(dtMs: number): { alpha: number; events: SimEvent[] } {
    this.syncInput()
    const { alpha } = this.sim.advance(dtMs)
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
    if (!this.latched) this.syncInput()
    if (changed) this.publish()
    return { alpha, events }
  }

  /** The single ResetButton action (UX_SPEC §6): stats, dummy, sim state — instant. */
  reset(): void {
    this.sim.reset({ seed: this.nextSeed() })
    this.latched = false
    this.busyTicks = 0
    this.resets++
    this.syncInput()
    for (const listener of this.resetListeners) listener()
    this.publish()
  }

  // ------------------------------------------------------------------------------- HUD

  getHud = (): LabHudState => this.hud

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Renderer hook: clear floating numbers and dummy effects on reset. */
  onReset(listener: () => void): () => void {
    this.resetListeners.add(listener)
    return () => this.resetListeners.delete(listener)
  }

  private publish(): void {
    this.hud = this.computeHud()
    for (const listener of this.listeners) listener()
  }

  private computeHud(): LabHudState {
    const { stats } = this.sim.snapshot()
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
    }
  }
}
