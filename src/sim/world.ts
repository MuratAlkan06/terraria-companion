/**
 * The simulation kernel: one fixed 60 Hz tick at a time, archetype-agnostic.
 *
 * Tick order (fixed — part of the determinism contract):
 *   1. resolve aim/facing from the latched input
 *   2. use cycle: end finished use (its reuse delay starts) → start a new one if attacking and the
 *      reuse delay has passed (mana gate) → activation (every activationTicks) → behavior.tickUse
 *      (melee hit detection)
 *   3. projectiles in spawn order: modifier steer → gravity → swept move/collide → age/lifetime → bounds
 *   4. debuffs: DoT accrual → duration countdown → expiry
 *   5. mana regeneration
 *   6. stats.endTick(); tick++
 * All randomness comes from the single seeded stream, drawn only inside these steps.
 */
import type { ActiveUse, Behavior, DummyState, HitSource, KernelApi, ModifierRuntime, ProjectileLaunch, ProjectileState } from './contracts'
import {
  DEFAULT_DUMMY_HEIGHT_TILES,
  DEFAULT_DUMMY_WIDTH_TILES,
  GRAVITY_DELAY_TICKS,
  GRAVITY_TILES_PER_TICK2,
  INSUFFICIENT_MANA_USE_TIME_MULTIPLIER,
  MANA_ITEM_USAGE_FACTOR,
  MANA_STATIONARY_BONUS,
  MAX_FALL_TILES_PER_TICK,
  MAX_PENDING_EVENTS,
  TICKS_PER_SECOND,
} from './constants'
import { rollHit } from './damage'
import { Digest } from './digest'
import { aabbCenter, aabbFromCenter, angleTo, segmentAabbEntry } from './geometry'
import { mulberry32, type Rng } from './rng'
import { StatsAccumulator } from './stats'
import type { ArenaBounds, BladePose, DummySpec, LabInput, LabSettings, ManaState, RenderState, SimEvent, Vec2 } from './types'

/** Distributive Omit so each SimEvent arm keeps its own fields. */
type EventInput = SimEvent extends infer E ? (E extends SimEvent ? Omit<E, 'tick' | 'seq'> : never) : never

export interface WorldConfig {
  seed: number
  behavior: Behavior
  modifiers: readonly ModifierRuntime[]
  dummies: readonly DummySpec[]
  arena: ArenaBounds
  settings: LabSettings
  /** Ticks one use lasts (the attack animation; autoswing melee already −1). */
  useTicks: number
  /** Cooldown after each use before the next may start (reuse delay; 0 = none). */
  reuseDelayTicks: number
  /** Ticks between activations inside one use. */
  activationTicks: number
  critChancePct: number
  /** Mana cost per use; 0 ⇒ the weapon has no mana pool. */
  manaCost: number
}

interface ManaPool {
  current: number
  max: number
  regenAcc: number
}

export class World implements KernelApi {
  tick = 0
  readonly rng: Rng
  readonly player: Vec2 = { x: 0, y: 0 }
  aim: Vec2 = { x: 1, y: 0 }
  facing: 1 | -1 = 1
  readonly dummies: DummyState[]
  settings: LabSettings
  input: LabInput = { attacking: false, aim: null }
  readonly stats: StatsAccumulator

  private readonly cfg: WorldConfig
  private readonly hitCooldown: number | null
  private projectiles: ProjectileState[] = []
  private nextProjectileId = 1
  private use: ActiveUse | null = null
  /** First tick a new use may start: end of the last use + the reuse delay. */
  private readyAt = 0
  private useCount = 0
  private blocked = false
  private mana: ManaPool | null
  private seq = 0
  private events: SimEvent[] = []
  private readonly digest = new Digest()

  constructor(cfg: WorldConfig) {
    this.cfg = cfg
    this.rng = mulberry32(cfg.seed)
    this.settings = { ...cfg.settings }
    this.dummies = cfg.dummies.map((d, index) => ({
      index,
      id: d.id ?? `dummy-${index}`,
      box: aabbFromCenter(d.x, d.y, d.widthTiles ?? DEFAULT_DUMMY_WIDTH_TILES, d.heightTiles ?? DEFAULT_DUMMY_HEIGHT_TILES),
      defense: d.defense ?? 0,
      debuffs: [],
    }))
    this.stats = new StatsAccumulator(this.dummies.map((d) => d.id))
    const cooldowns = cfg.modifiers.flatMap((m) => (m.hitCooldownTicks === undefined ? [] : [m.hitCooldownTicks]))
    this.hitCooldown = cooldowns.length > 0 ? Math.min(...cooldowns) : null
    this.mana = cfg.manaCost > 0 ? { current: this.settings.maxMana, max: this.settings.maxMana, regenAcc: 0 } : null
    this.resolveAim()
  }

  // -------------------------------------------------------------------------------------------
  // Tick

  step(): void {
    this.resolveAim()
    this.stepUse()
    this.stepProjectiles()
    this.stepDebuffs()
    this.stepMana()
    this.stats.endTick()
    this.tick++
  }

  private resolveAim(): void {
    const first = this.dummies[0]
    this.aim = this.input.aim ? { ...this.input.aim } : first ? aabbCenter(first.box) : { x: this.player.x + 1, y: this.player.y }
    if (this.aim.x > this.player.x) this.facing = 1
    else if (this.aim.x < this.player.x) this.facing = -1
  }

  private stepUse(): void {
    if (this.use && this.tick - this.use.startTick >= this.use.durationTicks) {
      // wiki Use_time: "reuseDelay is applied after the itemAnimation counter turns to zero"
      this.readyAt = this.use.startTick + this.use.durationTicks + this.cfg.reuseDelayTicks
      this.use = null
    }
    if (!this.input.attacking) this.blocked = false
    if (!this.use && this.input.attacking && this.tick >= this.readyAt) this.tryStartUse()
    const use = this.use
    if (!use) return
    use.elapsed = this.tick - use.startTick
    if (use.elapsed % use.activationTicks === 0) {
      this.stats.activation()
      this.cfg.behavior.activate(this, use)
    }
    this.cfg.behavior.tickUse?.(this, use)
  }

  private tryStartUse(): void {
    const cost = this.cfg.manaCost
    let slowCast = false
    if (cost > 0 && this.mana) {
      if (this.settings.ignoreMana) {
        this.stats.mana(cost)
      } else if (this.mana.current >= cost) {
        this.mana.current -= cost
        this.stats.mana(cost)
      } else if (this.settings.insufficientMana === 'slow-cast') {
        slowCast = true // 1.4.5.7+: use time × 2.5; paying nothing is a labeled assumption
      } else {
        if (!this.blocked) this.emit({ type: 'use-blocked', reason: 'insufficient-mana' })
        this.blocked = true
        return
      }
    }
    this.blocked = false
    // slow-cast stretches the use itself; the reuse delay after it is not scaled (README "Cadence")
    const durationTicks = slowCast ? Math.max(1, Math.floor(this.cfg.useTicks * INSUFFICIENT_MANA_USE_TIME_MULTIPLIER)) : this.cfg.useTicks
    const activationTicks = slowCast
      ? Math.max(1, Math.floor(this.cfg.activationTicks * INSUFFICIENT_MANA_USE_TIME_MULTIPLIER))
      : this.cfg.activationTicks
    const index = this.useCount++
    this.use = {
      index,
      startTick: this.tick,
      durationTicks,
      activationTicks,
      slowCast,
      facing: this.facing,
      aimAngle: angleTo(this.player, this.aim),
      melee: this.hitSource(`use:${index}`, 'melee', this.cfg.behavior.baseHitDamage),
      elapsed: 0,
    }
    this.stats.use()
    this.emit({ type: 'use-start', useIndex: index, durationTicks, slowCast })
  }

  private stepProjectiles(): void {
    if (this.projectiles.length === 0) return
    const { arena } = this.cfg
    const survivors: ProjectileState[] = []
    for (const p of this.projectiles) {
      p.prevX = p.x
      p.prevY = p.y
      for (const m of this.cfg.modifiers) m.steer?.(this, p)
      if (p.gravity && p.age >= GRAVITY_DELAY_TICKS) p.vy = Math.min(p.vy + GRAVITY_TILES_PER_TICK2, MAX_FALL_TILES_PER_TICK)
      const nx = p.x + p.vx
      const ny = p.y + p.vy
      let alive = true
      const contacts: Array<{ t: number; dummy: DummyState }> = []
      for (const dummy of this.dummies) {
        const t = segmentAabbEntry(p.x, p.y, nx, ny, dummy.box)
        if (t !== null) contacts.push({ t, dummy })
      }
      contacts.sort((a, b) => a.t - b.t || a.dummy.index - b.dummy.index)
      for (const { t, dummy } of contacts) {
        const at = { x: p.x + (nx - p.x) * t, y: p.y + (ny - p.y) * t }
        if (!this.strike(p.source, dummy, at)) continue
        p.hitsLeft--
        if (p.hitsLeft <= 0) {
          p.x = at.x
          p.y = at.y
          this.emit({ type: 'projectile-despawn', projectileId: p.id, reason: 'pierce-exhausted' })
          alive = false
          break
        }
      }
      if (!alive) continue
      p.x = nx
      p.y = ny
      p.age++
      if (p.age >= p.lifetimeTicks) {
        this.emit({ type: 'projectile-despawn', projectileId: p.id, reason: 'lifetime' })
      } else if (p.x < arena.minX || p.x > arena.maxX || p.y < arena.minY || p.y > arena.maxY) {
        this.emit({ type: 'projectile-despawn', projectileId: p.id, reason: 'out-of-bounds' })
      } else {
        survivors.push(p)
      }
    }
    this.projectiles = survivors
  }

  private stepDebuffs(): void {
    for (const dummy of this.dummies) {
      if (dummy.debuffs.length === 0) continue
      for (const b of dummy.debuffs) {
        b.acc += b.dps
        if (b.acc >= TICKS_PER_SECOND) {
          const whole = Math.floor(b.acc / TICKS_PER_SECOND)
          b.acc -= whole * TICKS_PER_SECOND
          const c = aabbCenter(dummy.box)
          this.stats.damage(dummy.id, whole, false, 'dot', this.tick)
          this.emit({ type: 'damage', source: 'dot', sourceId: `buff:${b.buffId}`, dummyId: dummy.id, amount: whole, crit: false, x: c.x, y: c.y })
        }
        b.remainingTicks--
      }
      const expired = dummy.debuffs.filter((b) => b.remainingTicks <= 0)
      if (expired.length === 0) continue
      dummy.debuffs = dummy.debuffs.filter((b) => b.remainingTicks > 0)
      for (const b of expired) this.emit({ type: 'debuff-expired', dummyId: dummy.id, buffId: b.buffId })
    }
  }

  /** VERIFIED 1.4.5.7+ formula (constants.ts); the Lab player stands still, no regen bonuses. */
  private stepMana(): void {
    const pool = this.mana
    if (!pool) return
    if (this.settings.ignoreMana) {
      pool.current = pool.max
      pool.regenAcc = 0
      return
    }
    if (this.settings.manaRegen === 'none' || pool.current >= pool.max) {
      pool.regenAcc = 0
      return
    }
    const regen = (pool.max / 3 + 1) * MANA_STATIONARY_BONUS * ((pool.current / pool.max) * 0.5 + 0.5) * (this.use ? MANA_ITEM_USAGE_FACTOR : 1)
    pool.regenAcc += regen / 2 / TICKS_PER_SECOND
    if (pool.regenAcc >= 1) {
      const whole = Math.floor(pool.regenAcc)
      pool.regenAcc -= whole
      pool.current = Math.min(pool.max, pool.current + whole)
    }
  }

  // -------------------------------------------------------------------------------------------
  // KernelApi

  spawnProjectile(launch: ProjectileLaunch): void {
    const id = this.nextProjectileId++
    this.projectiles.push({
      id,
      x: launch.x,
      y: launch.y,
      prevX: launch.x,
      prevY: launch.y,
      vx: launch.vx,
      vy: launch.vy,
      age: 0,
      hitsLeft: launch.pierce === Infinity ? Infinity : 1 + launch.pierce,
      gravity: launch.gravity,
      lifetimeTicks: launch.lifetimeTicks,
      source: this.hitSource(`proj:${id}`, 'projectile', launch.damage),
      spriteKey: launch.spriteKey,
    })
    this.stats.projectile()
    this.emit({ type: 'projectile-spawn', projectileId: id, x: launch.x, y: launch.y, vx: launch.vx * TICKS_PER_SECOND, vy: launch.vy * TICKS_PER_SECOND })
  }

  strike(source: HitSource, dummy: DummyState, at: Vec2): boolean {
    const until = source.immuneUntil.get(dummy.index)
    if (until !== undefined && this.tick < until) return false
    source.immuneUntil.set(dummy.index, source.cooldownTicks === null ? Infinity : this.tick + source.cooldownTicks)
    const roll = rollHit(this.rng, source.baseDamage, dummy.defense, this.cfg.critChancePct, this.settings.damageVariance)
    this.stats.damage(dummy.id, roll.amount, roll.crit, source.kind, this.tick)
    this.emit({ type: 'damage', source: source.kind, sourceId: source.key, dummyId: dummy.id, amount: roll.amount, crit: roll.crit, x: at.x, y: at.y })
    for (const m of this.cfg.modifiers) m.afterStrike?.(this, source, dummy)
    return true
  }

  consumeAmmo(count: number): void {
    this.stats.ammo(count)
  }

  applyDebuff(dummy: DummyState, buffId: string, dps: number, durationTicks: number): void {
    const existing = dummy.debuffs.find((b) => b.buffId === buffId)
    if (existing) {
      existing.remainingTicks = Math.max(existing.remainingTicks, durationTicks)
    } else {
      dummy.debuffs.push({ buffId, dps, remainingTicks: durationTicks, acc: 0 })
      dummy.debuffs.sort((a, b) => (a.buffId < b.buffId ? -1 : a.buffId > b.buffId ? 1 : 0))
    }
    this.stats.debuff()
    this.emit({ type: 'debuff-applied', dummyId: dummy.id, buffId, durationTicks, refreshed: existing !== undefined })
  }

  // -------------------------------------------------------------------------------------------
  // Settings / views

  applySettings(next: LabSettings): void {
    this.settings = { ...next }
    if (this.mana) {
      this.mana.max = next.maxMana
      this.mana.current = Math.min(this.mana.current, next.maxMana)
    }
  }

  manaState(): ManaState | null {
    return this.mana ? { current: this.mana.current, max: this.mana.max, ignoreMana: this.settings.ignoreMana } : null
  }

  eventDigest(): string {
    return this.digest.value()
  }

  drainEvents(): SimEvent[] {
    const out = this.events
    this.events = []
    return out
  }

  renderState(alpha: number): RenderState {
    return {
      tick: this.tick,
      alpha,
      player: { ...this.player },
      facing: this.facing,
      aim: { ...this.aim },
      dummies: this.dummies.map((d) => {
        const c = aabbCenter(d.box)
        return {
          id: d.id,
          x: c.x,
          y: c.y,
          width: d.box.maxX - d.box.minX,
          height: d.box.maxY - d.box.minY,
          defense: d.defense,
          debuffs: d.debuffs.map((b) => ({ buffId: b.buffId, remainingTicks: b.remainingTicks })),
        }
      }),
      projectiles: this.projectiles.map((p) => ({
        id: p.id,
        x: p.x,
        y: p.y,
        prevX: p.prevX,
        prevY: p.prevY,
        vx: p.vx * TICKS_PER_SECOND,
        vy: p.vy * TICKS_PER_SECOND,
        ...(p.spriteKey === undefined ? {} : { spriteKey: p.spriteKey }),
      })),
      blade: this.bladePose(),
    }
  }

  private bladePose(): BladePose | null {
    const use = this.use
    if (!use || !this.cfg.behavior.blade) return null
    // Only while the use is still in progress at the last processed tick.
    if (this.tick - 1 - use.startTick >= use.durationTicks) return null
    return this.cfg.behavior.blade(use)
  }

  // -------------------------------------------------------------------------------------------

  private hitSource(key: string, kind: HitSource['kind'], baseDamage: number): HitSource {
    return { key, kind, baseDamage, cooldownTicks: this.hitCooldown, immuneUntil: new Map() }
  }

  private emit(input: EventInput): void {
    const event = { tick: this.tick, seq: this.seq++, ...input } as SimEvent
    const d = this.digest
    for (const [key, value] of Object.entries(event)) {
      d.str(key)
      if (typeof value === 'number') d.num(value)
      else if (typeof value === 'boolean') d.num(value ? 1 : 0)
      else d.str(String(value))
    }
    this.events.push(event)
    if (this.events.length > MAX_PENDING_EVENTS) this.events.splice(0, this.events.length - MAX_PENDING_EVENTS)
  }
}
