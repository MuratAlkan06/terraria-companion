/**
 * The simulation kernel: one fixed 60 Hz tick at a time, archetype-agnostic.
 *
 * Tick order (fixed — part of the determinism contract):
 *   1. resolve aim/facing from the latched input
 *   2. use cycle: end finished use (its reuse delay starts) → start a new one if attacking, the
 *      reuse delay has passed and the behavior is ready (a returning weapon is back; a summon weapon
 *      has room or a new press) (mana gate) → activation (every activationTicks) → behavior.tickUse
 *      (melee hit detection, a held beam, a whip's sweep and tags)
 *   3. summons (minions, sentries) in summon order: brain step — target → attack when due → move
 *   4. projectiles in spawn order: guide steer (a returning weapon; `caught` removes it) or
 *      modifier steer → gravity → swept move/collide (a guide may stop the move at a hit) →
 *      age/lifetime → bounds
 *   5. debuffs: DoT accrual → duration countdown → expiry; then whip tags: countdown → expiry
 *   6. mana regeneration
 *   7. stats.endTick(); tick++
 * All randomness comes from the single seeded stream, drawn only inside these steps (and, for the
 * minion loadout's summons, once when the world is created — they draw nothing).
 */
import type {
  ActiveUse,
  AgentSpawn,
  AgentState,
  Behavior,
  DummyState,
  HitOwner,
  HitSource,
  KernelApi,
  ModifierRuntime,
  ProjectileLaunch,
  ProjectileState,
  WhipTag,
} from './contracts'
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
import { applyDefense, applyVariancePct, rollHit } from './damage'
import { Digest } from './digest'
import { aabbCenter, aabbFromCenter, angleTo, segmentAabbEntry } from './geometry'
import { mulberry32, type Rng } from './rng'
import { StatsAccumulator } from './stats'
import type { ArenaBounds, BladePose, DummySpec, LabInput, LabSettings, ManaState, RenderState, SimEvent, SummonKind, SummonsState, Vec2 } from './types'

/** Slot sums are compared with this slack (fractional slot costs, e.g. 0.5). */
const SLOT_EPSILON = 1e-9

/** Total slot cost of the summons of `kind` in `agents`. */
export function slotsUsed(agents: readonly AgentState[], kind: SummonKind): number {
  let used = 0
  for (const a of agents) if (a.kind === kind) used += a.slotCost
  return used
}

/** The slots `settings` give summons of `kind`. */
export const slotCapacity = (settings: Readonly<LabSettings>, kind: SummonKind): number => (kind === 'minion' ? settings.minionSlots : settings.sentrySlots)

/** Whether `cost` more fits in the `kind` slots now. */
export const fitsSlots = (k: Pick<KernelApi, 'agents' | 'settings'>, kind: SummonKind, cost: number): boolean =>
  slotsUsed(k.agents, kind) + cost <= slotCapacity(k.settings, kind) + SLOT_EPSILON

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
  /** The minion loadout (P3-S10): its behavior fills the minion slots when the world is created. */
  loadout?: { behavior: Behavior; owner: HitOwner } | null
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
  /** Hit sources that outlive single uses (`persistentSource`), per world. */
  private readonly persistent = new Map<string, HitSource>()
  /** Minions and sentries, oldest first. */
  private summons: AgentState[] = []
  private nextAgentId = 1
  /** The dummy a whip struck last (summons focus it). */
  private focus: number | null = null
  /** Attack released since the last use started (a new press may re-summon with the slots full). */
  private released = true

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
      tag: null,
    }))
    this.stats = new StatsAccumulator(this.dummies.map((d) => d.id))
    const cooldowns = cfg.modifiers.flatMap((m) => (m.hitCooldownTicks === undefined ? [] : [m.hitCooldownTicks]))
    this.hitCooldown = cooldowns.length > 0 ? Math.min(...cooldowns) : null
    this.mana = cfg.manaCost > 0 ? { current: this.settings.maxMana, max: this.settings.maxMana, regenAcc: 0 } : null
    this.resolveAim()
    // The minion loadout is out from the start (as many minions as the slots hold).
    if (cfg.loadout) cfg.loadout.behavior.fillSlots?.(this, cfg.loadout.owner)
  }

  // -------------------------------------------------------------------------------------------
  // Tick

  step(): void {
    this.resolveAim()
    this.stepUse()
    this.stepAgents()
    this.stepProjectiles()
    this.stepDebuffs()
    this.stepTags()
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
    if (!this.input.attacking) {
      this.blocked = false
      this.released = true
    }
    if (!this.use && this.input.attacking && this.tick >= this.readyAt && (this.cfg.behavior.ready?.(this) ?? true)) this.tryStartUse()
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
    this.released = false
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

  /** Each summon's brain, oldest first (a brain never summons or dismisses). */
  private stepAgents(): void {
    for (const a of this.summons) {
      a.prevX = a.x
      a.prevY = a.y
      a.brain.step(this, a)
    }
  }

  private stepProjectiles(): void {
    if (this.projectiles.length === 0) return
    const { arena } = this.cfg
    const survivors: ProjectileState[] = []
    for (const p of this.projectiles) {
      p.prevX = p.x
      p.prevY = p.y
      if (p.guide) {
        // A guided flight (returning weapon) is steered by its interpreter alone.
        if (p.guide.steer(this, p) === 'caught') {
          this.emit({ type: 'projectile-despawn', projectileId: p.id, reason: 'returned' })
          continue
        }
      } else {
        // A loadout summon's shot is steered by its own weapon's modifiers, never the equipped one's.
        for (const m of p.source.owner?.modifiers ?? this.cfg.modifiers) m.steer?.(this, p)
      }
      if (p.gravity && p.age >= GRAVITY_DELAY_TICKS) p.vy = Math.min(p.vy + GRAVITY_TILES_PER_TICK2, MAX_FALL_TILES_PER_TICK)
      const nx = p.x + p.vx
      const ny = p.y + p.vy
      let alive = true
      let stopped = false
      const contacts: Array<{ t: number; dummy: DummyState }> = []
      for (const dummy of this.dummies) {
        const t = segmentAabbEntry(p.x, p.y, nx, ny, dummy.box)
        if (t !== null) contacts.push({ t, dummy })
      }
      contacts.sort((a, b) => a.t - b.t || a.dummy.index - b.dummy.index)
      for (const { t, dummy } of contacts) {
        const at = { x: p.x + (nx - p.x) * t, y: p.y + (ny - p.y) * t }
        if (!this.strike(p.source, dummy, at)) continue
        if (p.guide?.afterHit?.(this, p, dummy) === 'stop') {
          p.x = at.x
          p.y = at.y
          stopped = true
          break
        }
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
      if (!stopped) {
        p.x = nx
        p.y = ny
      }
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

  /** Whip tags count down; one applied at tick t lasts its whole duration (ticks t … t + duration − 1). */
  private stepTags(): void {
    for (const dummy of this.dummies) {
      const tag = dummy.tag
      if (!tag) continue
      tag.remainingTicks--
      if (tag.remainingTicks > 0) continue
      dummy.tag = null
      this.emit({ type: 'tag-expired', dummyId: dummy.id })
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

  get attacking(): boolean {
    return this.input.attacking
  }

  get arena(): Readonly<ArenaBounds> {
    return this.cfg.arena
  }

  get activeProjectiles(): readonly ProjectileState[] {
    return this.projectiles
  }

  get autoAim(): boolean {
    return this.input.aim === null
  }

  get freshPress(): boolean {
    return this.released
  }

  get agents(): readonly AgentState[] {
    return this.summons
  }

  get focusIndex(): number | null {
    return this.focus
  }

  spawnProjectile(launch: ProjectileLaunch): void {
    const id = this.nextProjectileId++
    const summon = launch.summon
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
      source: summon
        ? // A summon's shot: its own kind (tag bonus) and owner; paced by its brain, one hit per dummy.
          { key: `proj:${id}`, kind: summon.kind, baseDamage: launch.damage, cooldownTicks: launch.hitCooldownTicks ?? null, immuneUntil: new Map(), ...(summon.owner ? { owner: summon.owner } : {}) }
        : this.hitSource(`proj:${id}`, 'projectile', launch.damage, launch.hitCooldownTicks),
      spriteKey: launch.spriteKey,
      ...(launch.guide ? { guide: launch.guide } : {}),
    })
    this.stats.projectile()
    this.emit({ type: 'projectile-spawn', projectileId: id, x: launch.x, y: launch.y, vx: launch.vx * TICKS_PER_SECOND, vy: launch.vy * TICKS_PER_SECOND })
  }

  strike(source: HitSource, dummy: DummyState, at: Vec2, damage: number = source.baseDamage): boolean {
    const until = source.immuneUntil.get(dummy.index)
    if (until !== undefined && this.tick < until) return false
    source.immuneUntil.set(dummy.index, source.cooldownTicks === null ? Infinity : this.tick + source.cooldownTicks)
    const owner = source.owner
    // A whip's tag counts for summon hits only (wiki Whips: "When minions or sentries attack tagged
    // enemies…"): its damage joins the hit's base damage before variance and defense (Lab choice), and
    // its crit chance is the hit's — summon damage has none of its own (B17; "the only way summons can
    // deal critical hits").
    const tag = source.kind === 'minion' || source.kind === 'sentry' ? dummy.tag : null
    const critPct = tag && tag.critPct !== null ? tag.critPct : owner ? owner.critChancePct : this.cfg.critChancePct
    const roll = rollHit(this.rng, tag ? damage + tag.damageFlat : damage, dummy.defense, critPct, this.settings.damageVariance)
    // The tag's share: everything above what the same roll deals untagged (no tag damage, no crit).
    const tagBonus = tag ? roll.amount - applyDefense(this.settings.damageVariance ? applyVariancePct(damage, roll.variancePct) : damage, dummy.defense) : undefined
    this.stats.damage(dummy.id, roll.amount, roll.crit, source.kind, this.tick, tagBonus ?? 0)
    this.emit({
      type: 'damage',
      source: source.kind,
      sourceId: source.key,
      dummyId: dummy.id,
      amount: roll.amount,
      crit: roll.crit,
      x: at.x,
      y: at.y,
      ...(tagBonus === undefined ? {} : { tagBonus }),
    })
    for (const m of owner?.modifiers ?? this.cfg.modifiers) m.afterStrike?.(this, source, dummy)
    return true
  }

  summon(spawn: AgentSpawn): AgentState {
    const id = this.nextAgentId++
    const agent: AgentState = {
      id,
      kind: spawn.kind,
      slotCost: spawn.slotCost,
      aiClass: spawn.aiClass,
      loadout: spawn.loadout,
      spawnTick: this.tick,
      x: spawn.x,
      y: spawn.y,
      prevX: spawn.x,
      prevY: spawn.y,
      facing: this.facing,
      targetIndex: null,
      lastAttackTick: -1,
      source: { key: `${spawn.kind}:${id}`, kind: spawn.kind, baseDamage: spawn.baseDamage, cooldownTicks: spawn.cooldownTicks, immuneUntil: new Map(), ...(spawn.owner ? { owner: spawn.owner } : {}) },
      brain: spawn.brain,
    }
    this.summons.push(agent)
    this.emit({ type: 'summon', agentId: id, kind: spawn.kind, x: spawn.x, y: spawn.y, loadout: spawn.loadout })
    return agent
  }

  dismiss(agent: AgentState, reason: 'replaced' | 'slots'): void {
    const at = this.summons.indexOf(agent)
    if (at < 0) return
    this.summons.splice(at, 1)
    this.emit({ type: 'dismiss', agentId: agent.id, kind: agent.kind, reason })
  }

  tagDummy(dummy: DummyState, tag: WhipTag): void {
    const refreshed = dummy.tag !== null
    dummy.tag = { damageFlat: tag.damageFlat, critPct: tag.critPct, durationTicks: tag.durationTicks, remainingTicks: tag.durationTicks }
    // wiki Whips: "The last enemy hit by a whip will be targeted by the player's minions and sentries".
    this.focus = dummy.index
    this.emit({ type: 'tag-applied', dummyId: dummy.id, durationTicks: tag.durationTicks, refreshed })
  }

  persistentSource(key: string, kind: HitSource['kind'], baseDamage: number, cooldownTicks: number | null): HitSource {
    let source = this.persistent.get(key)
    if (!source) {
      source = { key, kind, baseDamage, cooldownTicks, immuneUntil: new Map() }
      this.persistent.set(key, source)
    }
    return source
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
    // Fewer slots than summons out: the oldest leave first (in-game they are "randomly chosen to be
    // dismissed" — wiki Minion-summoning weapons; the Lab's order keeps runs reproducible).
    for (const kind of ['minion', 'sentry'] as const) {
      let used = slotsUsed(this.summons, kind)
      for (const a of this.summons.filter((s) => s.kind === kind)) {
        if (used <= slotCapacity(next, kind) + SLOT_EPSILON) break
        this.dismiss(a, 'slots')
        used -= a.slotCost
      }
    }
  }

  manaState(): ManaState | null {
    return this.mana ? { current: this.mana.current, max: this.mana.max, ignoreMana: this.settings.ignoreMana } : null
  }

  summonsState(): SummonsState {
    const count = (kind: SummonKind) => this.summons.filter((a) => a.kind === kind).length
    return {
      minions: count('minion'),
      minionSlotsUsed: slotsUsed(this.summons, 'minion'),
      minionSlots: this.settings.minionSlots,
      sentries: count('sentry'),
      sentrySlotsUsed: slotsUsed(this.summons, 'sentry'),
      sentrySlots: this.settings.sentrySlots,
    }
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
          tag: d.tag ? { remainingTicks: d.tag.remainingTicks, durationTicks: d.tag.durationTicks, damageFlat: d.tag.damageFlat, critPct: d.tag.critPct } : null,
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
      agents: this.summons.map((a) => ({
        id: a.id,
        kind: a.kind,
        aiClass: a.aiClass,
        x: a.x,
        y: a.y,
        prevX: a.prevX,
        prevY: a.prevY,
        facing: a.facing,
        targetId: a.targetIndex === null ? null : (this.dummies[a.targetIndex]?.id ?? null),
        lastAttackTick: a.lastAttackTick,
        loadout: a.loadout,
      })),
    }
  }

  private bladePose(): BladePose | null {
    const use = this.use
    if (!use || !this.cfg.behavior.blade) return null
    // Only while the use is still in progress at the last processed tick.
    if (this.tick - 1 - use.startTick >= use.durationTicks) return null
    return this.cfg.behavior.blade(use, this)
  }

  // -------------------------------------------------------------------------------------------

  /** The weapon's multiHit cooldown (data) wins; else the archetype's own interval for the source, if any. */
  private hitSource(key: string, kind: HitSource['kind'], baseDamage: number, archetypeCooldownTicks?: number): HitSource {
    return { key, kind, baseDamage, cooldownTicks: this.hitCooldown ?? archetypeCooldownTicks ?? null, immuneUntil: new Map() }
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
