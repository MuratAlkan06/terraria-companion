/**
 * Internal extension contracts between the kernel (`./world.ts`), archetype interpreters
 * (`./interpreters/*`) and the modifier layer (`./modifiers.ts`).
 *
 * Adding an archetype = one interpreter module + one registry entry (`./interpreters/index.ts`);
 * the kernel never switches on archetype. Adding a modifier = one registry entry in
 * `./modifiers.ts` using the hooks below.
 */
import type { Archetype, ArchetypeParams, Buff, Item, Weapon } from '../schemas'
import type { ApproximationId } from './approximations'
import type { Aabb } from './geometry'
import type { Rng } from './rng'
import type { ArenaBounds, BladePose, LabSettings, SimRefusal, Vec2 } from './types'

/** Anything that can damage a dummy, with its own local-immunity bookkeeping. */
export interface HitSource {
  /** `use:<n>` (melee), `proj:<id>`, or a persistent source's key (`beam`). */
  readonly key: string
  readonly kind: 'melee' | 'projectile'
  /** Damage before variance/defense/crit. */
  readonly baseDamage: number
  /** null ⇒ hits each dummy at most once for the source's lifetime; else re-hit cooldown (multiHit). */
  readonly cooldownTicks: number | null
  /** dummy index → first tick a new hit is allowed. */
  readonly immuneUntil: Map<number, number>
}

export interface DebuffState {
  buffId: string
  dps: number
  remainingTicks: number
  /** Accrued dps·ticks not yet emitted as whole HP (units: HP × 60). */
  acc: number
}

export interface DummyState {
  readonly index: number
  readonly id: string
  readonly box: Aabb
  readonly defense: number
  /** Sorted by buffId (deterministic iteration). */
  debuffs: DebuffState[]
}

export interface ProjectileShape {
  gravity: boolean
  lifetimeTicks: number
  /** Extra dummies passed through after the first hit (Infinity = infinite). */
  pierce: number
  spriteKey?: string
}

export interface ProjectileLaunch extends ProjectileShape {
  x: number
  y: number
  /** tiles / tick */
  vx: number
  vy: number
  damage: number
  /**
   * The archetype's own re-hit interval for this projectile (e.g. a yoyo's 10 ticks); a weapon's
   * `multiHit` modifier (data) takes precedence. Absent: the weapon's multiHit, else one hit per dummy.
   */
  hitCooldownTicks?: number
  /** Flight control for a projectile that doesn't fly straight (a returning weapon). */
  guide?: ProjectileGuide
}

export interface ProjectileState {
  readonly id: number
  x: number
  y: number
  prevX: number
  prevY: number
  vx: number
  vy: number
  age: number
  hitsLeft: number
  readonly gravity: boolean
  readonly lifetimeTicks: number
  readonly source: HitSource
  readonly spriteKey?: string
  readonly guide?: ProjectileGuide
}

/**
 * Per-flight control of a guided projectile (the returning archetype: out, back, held at the aim).
 * Created per launch, so it may keep that flight's state; the kernel calls it in the fixed
 * projectile step (world.ts header), so guided flight stays deterministic.
 */
export interface ProjectileGuide {
  /**
   * Before movement each tick: set `p.vx` / `p.vy` (tiles/tick). `caught` = back in hand: the
   * projectile is removed without moving (`projectile-despawn` reason `returned`).
   */
  steer(k: KernelApi, p: ProjectileState): 'caught' | void
  /** After each hit it lands: `stop` ends this tick's move at the impact point (it turns back there). */
  afterHit?(k: KernelApi, p: ProjectileState, dummy: DummyState): 'stop' | void
}

export interface ActiveUse {
  readonly index: number
  readonly startTick: number
  readonly durationTicks: number
  readonly activationTicks: number
  readonly slowCast: boolean
  /** Facing and aim angle latched when the use starts (the swing/thrust direction is fixed). */
  readonly facing: 1 | -1
  readonly aimAngle: number
  /** Melee hit source scoped to this use (one hit per dummy per use unless multiHit). */
  readonly melee: HitSource
  /** Ticks since the use started, for the tick being processed (0-based). */
  elapsed: number
}

/** What interpreters and modifiers may touch. Implemented by the World. */
export interface KernelApi {
  readonly tick: number
  readonly rng: Rng
  readonly player: Readonly<Vec2>
  readonly aim: Readonly<Vec2>
  readonly facing: 1 | -1
  readonly dummies: readonly DummyState[]
  readonly settings: Readonly<LabSettings>
  /** Attack is held (input, or forced by a timed test) — a yoyo stays out while it is. */
  readonly attacking: boolean
  /** Projectile despawn bounds (a held beam reaches to them). */
  readonly arena: Readonly<ArenaBounds>
  /** Projectiles in flight, in spawn order. */
  readonly activeProjectiles: readonly ProjectileState[]
  spawnProjectile(launch: ProjectileLaunch): void
  /** Applies a direct hit (immunity → variance → defense → crit → stats/events → modifier hooks). */
  strike(source: HitSource, dummy: DummyState, at: Vec2): boolean
  /**
   * This world's hit source for `key`, created on first use and kept until the next reset — for a
   * damage source that outlives single uses (a held beam's per-dummy hit interval).
   */
  persistentSource(key: string, kind: HitSource['kind'], baseDamage: number, cooldownTicks: number | null): HitSource
  consumeAmmo(count: number): void
  applyDebuff(dummy: DummyState, buffId: string, dps: number, durationTicks: number): void
}

/**
 * A prepared archetype behavior for one weapon (+ ammo). Shared by every world the sim builds
 * (reset makes a new world), so it must keep no per-world state of its own: per-flight state lives
 * in a projectile's guide, per-world state in the kernel (`persistentSource`, `activeProjectiles`).
 */
export interface Behavior {
  readonly archetype: Archetype
  readonly baseHitDamage: number
  readonly usesAmmo: boolean
  readonly approximations: readonly ApproximationId[]
  /** The weapon itself is thrown and comes back; the next attack waits for it (WeaponSummary.returnsToHand). */
  readonly returnsToHand?: boolean
  /** Called on each activation: at use start, then every activationTicks inside the use. */
  activate(k: KernelApi, use: ActiveUse): void
  /** Called every tick of a use, after any activation (melee hit detection, a held beam). */
  tickUse?(k: KernelApi, use: ActiveUse): void
  /** Optional gate on starting a use (absent = always ready): false while a returning weapon is still out. */
  ready?(k: KernelApi): boolean
  /** Melee / beam pose for the renderer at the end of the use's current tick. */
  blade?(use: ActiveUse, k: KernelApi): BladePose | null
}

export type PrepareResult = { ok: true; behavior: Behavior } | { ok: false; refusal: SimRefusal }

export interface PrepareContext<A extends Archetype> {
  weapon: Weapon
  params: Extract<ArchetypeParams, { archetype: A }>
  ammo?: Item
}

export interface ArchetypeInterpreter<A extends Archetype> {
  readonly archetype: A
  /** Weapon dot-paths that must be present (verified or editorial) beyond the kernel's common set. */
  readonly requiredFields: readonly string[]
  prepare(ctx: PrepareContext<A>): PrepareResult
}

/** Runtime hooks of one cross-cutting modifier (LabModifiers key). */
export interface ModifierRuntime {
  readonly key: string
  readonly approximations: readonly ApproximationId[]
  /** multiHit: local immunity ticks for every hit source of the weapon. */
  readonly hitCooldownTicks?: number
  /** Before projectile movement each tick (homing). */
  steer?(k: KernelApi, p: ProjectileState): void
  /** After a direct hit lands (DoT application). */
  afterStrike?(k: KernelApi, source: HitSource, dummy: DummyState): void
}

export interface ModifierContext {
  weapon: Weapon
  buffs?: readonly Buff[]
}
