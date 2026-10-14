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
import type { ArenaBounds, BladePose, LabSettings, MinionAiClass, SimRefusal, SummonKind, Vec2 } from './types'

/** Anything that can damage a dummy, with its own local-immunity bookkeeping. */
export interface HitSource {
  /** `use:<n>` (melee), `proj:<id>`, a persistent source's key (`beam`), or a summon's (`minion:<id>`). */
  readonly key: string
  /** `minion` / `sentry`: a summon's hit — it takes a whip tag's bonus (P3-S10). */
  readonly kind: 'melee' | 'projectile' | SummonKind
  /** Damage before variance/defense/crit. */
  readonly baseDamage: number
  /** null ⇒ hits each dummy at most once for the source's lifetime; else re-hit cooldown (multiHit). */
  readonly cooldownTicks: number | null
  /** dummy index → first tick a new hit is allowed. */
  readonly immuneUntil: Map<number, number>
  /**
   * Whose hit it is, when not the equipped weapon's: its crit chance and on-hit modifiers (the minion
   * loadout's summons — P3-S10). Absent: the equipped weapon's (the world's own).
   */
  readonly owner?: HitOwner
}

/** The weapon behind a hit: its crit chance (0 for summon damage, B17) and its on-hit modifiers (DoT). */
export interface HitOwner {
  readonly critChancePct: number
  readonly modifiers: readonly ModifierRuntime[]
}

/** A whip's tag on a dummy (wiki Whips: tag damage, tag critical strike chance, for 4 seconds). */
export interface WhipTag {
  readonly damageFlat: number
  /** Tag critical strike chance (%), or null when the whip has none. */
  readonly critPct: number | null
  readonly durationTicks: number
}

export interface TagState extends WhipTag {
  remainingTicks: number
}

export interface DebuffState {
  buffId: string
  dps: number
  remainingTicks: number
  /** The duration it was last (re)applied with: `remainingTicks` was set to it then (refresh-not-stack keeps the longer). */
  durationTicks: number
  /** Accrued dps·ticks not yet emitted as whole HP (units: HP × 60). */
  acc: number
}

/** How a blast's damage spreads over its radius (DATA_SCHEMA_SPEC §2.4 explosive-aoe `falloff`). */
export type BlastFalloff = 'none' | 'linear'

export interface DummyState {
  readonly index: number
  readonly id: string
  readonly box: Aabb
  readonly defense: number
  /** Sorted by buffId (deterministic iteration). */
  debuffs: DebuffState[]
  /** A whip's tag (one whip, one tag: a new strike refreshes it), else null. */
  tag: TagState | null
}

/**
 * A persistent autonomous summon (P3-S9: a minion or a sentry), stepped once per tick in summon order
 * by its `brain` (world.ts header). Created by an interpreter through `KernelApi.summon`, kept until a
 * replacement, a lowered slot setting, or the next reset.
 */
export interface AgentState {
  readonly id: number
  readonly kind: SummonKind
  readonly slotCost: number
  readonly aiClass: MinionAiClass
  /** The minion loadout's (P3-S10), else the equipped weapon summoned it. */
  readonly loadout: boolean
  readonly spawnTick: number
  x: number
  y: number
  prevX: number
  prevY: number
  facing: 1 | -1
  /** Index of the dummy it attacks now, or null. */
  targetIndex: number | null
  /** World tick of its latest attack (-1: none yet). */
  lastAttackTick: number
  /** Its hit source (`minion:<id>` / `sentry:<id>`, kind = `kind`), persistent for its lifetime. */
  readonly source: HitSource
  readonly brain: AgentBrain
}

/** A summon's behavior (per agent, so it may keep that agent's own state, like a projectile's guide). */
export interface AgentBrain {
  /** Once per tick, after the use cycle: pick a target, attack when due, move (sets `x` / `y`). */
  step(k: KernelApi, agent: AgentState): void
}

export interface AgentSpawn {
  kind: SummonKind
  slotCost: number
  aiClass: MinionAiClass
  x: number
  y: number
  baseDamage: number
  /** Its re-hit cooldown per dummy (the attack interval: its schedule, not immunity, paces it). */
  cooldownTicks: number
  owner?: HitOwner
  loadout: boolean
  brain: AgentBrain
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
  /** A summon's shot (a ranged minion or sentry with a projectile): its kind and owner. Absent: the weapon's. */
  summon?: { kind: SummonKind; owner?: HitOwner }
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
 * Per-flight control of a guided projectile (the returning archetype: out, back, held at the aim; a
 * thrown explosive's arc, rest and fuse). Created per launch, so it may keep that flight's state; the
 * kernel calls it in the fixed projectile step (world.ts header), so guided flight stays deterministic.
 */
export interface ProjectileGuide {
  /**
   * Before movement each tick: set `p.vx` / `p.vy` (tiles/tick). `caught` = back in hand: the
   * projectile is removed without moving (`projectile-despawn` reason `returned`). `detonated` = it
   * went off where it is (the guide called `KernelApi.explode` first): removed (reason `detonated`).
   */
  steer(k: KernelApi, p: ProjectileState): 'caught' | 'detonated' | void
  /** After each hit it lands: `stop` ends this tick's move at the impact point (it turns back there). */
  afterHit?(k: KernelApi, p: ProjectileState, dummy: DummyState): 'stop' | void
  /**
   * A projectile with no contact hit of its own (a thrown explosive): each dummy it touches during a move
   * calls this INSTEAD of a hit. `detonated` = it went off at the touch point `at` (the guide called
   * `KernelApi.explode` there): removed there, the rest of the move dropped (reason `detonated`).
   */
  touch?(k: KernelApi, p: ProjectileState, dummy: DummyState, at: Vec2): 'detonated' | void
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
  /** The aim is the auto-aim (no pointer aim: Space, a timed test) — `aim` is then the first dummy's centre. */
  readonly autoAim: boolean
  /** Attack has been released since the last use started (or no use started yet): this is a new press. */
  readonly freshPress: boolean
  /** Minions and sentries out now, oldest first. */
  readonly agents: readonly AgentState[]
  /** The dummy a whip struck last (summons focus it — wiki Whips), or null. */
  readonly focusIndex: number | null
  spawnProjectile(launch: ProjectileLaunch): void
  /**
   * Applies a direct hit (immunity → variance → defense → crit → stats/events → modifier hooks).
   * `damage` overrides the source's base damage for this hit (a whip's multihit penalty). A summon's
   * hit on a tagged dummy adds the tag (damage before variance; its crit chance) — README "Summons".
   */
  strike(source: HitSource, dummy: DummyState, at: Vec2, damage?: number): boolean
  /**
   * This world's hit source for `key`, created on first use and kept until the next reset — for a
   * damage source that outlives single uses (a held beam's per-dummy hit interval).
   */
  persistentSource(key: string, kind: HitSource['kind'], baseDamage: number, cooldownTicks: number | null): HitSource
  consumeAmmo(count: number): void
  /** A consumable weapon item used up (a thrown explosive: one per throw) — `stats.consumablesUsed`. */
  consumeItem(count: number): void
  /**
   * An explosion (P3-S11): event `explosion`, then ONE hit from `p`'s source on every dummy whose hitbox
   * reaches into the circle of `radiusTiles` around `at` (dummy order), at the hitbox point nearest the
   * centre, with the base damage `falloff` keeps at that distance (`blastKeptPct`; a dummy kept 0 is not
   * hit). Returns the number of dummies hit. The caller removes the projectile (`detonated`).
   */
  explode(p: ProjectileState, at: Vec2, radiusTiles: number, falloff: BlastFalloff): number
  applyDebuff(dummy: DummyState, buffId: string, dps: number, durationTicks: number): void
  /** A new minion / sentry (event `summon`); its brain steps from the next agent step on. */
  summon(spawn: AgentSpawn): AgentState
  /** Removes a summon (event `dismiss`). */
  dismiss(agent: AgentState, reason: 'replaced' | 'slots'): void
  /** Tags (or re-tags) `dummy` with a whip's tag and makes it the summons' focus (event `tag-applied`). */
  tagDummy(dummy: DummyState, tag: WhipTag): void
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
  /** Each throw uses the weapon item itself up (a thrown explosive; WeaponSummary.consumable). */
  readonly consumable?: boolean
  /** Called on each activation: at use start, then every activationTicks inside the use. */
  activate(k: KernelApi, use: ActiveUse): void
  /** Called every tick of a use, after any activation (melee hit detection, a held beam). */
  tickUse?(k: KernelApi, use: ActiveUse): void
  /** Optional gate on starting a use (absent = always ready): false while a returning weapon is still out. */
  ready?(k: KernelApi): boolean
  /** Melee / beam pose for the renderer at the end of the use's current tick. */
  blade?(use: ActiveUse, k: KernelApi): BladePose | null
  /**
   * A minion summon weapon used as the minion loadout (P3-S10): summon its minions — as many as the
   * free slots hold, never replacing one — owned by `owner` (the loadout weapon's crit and modifiers).
   */
  fillSlots?(k: KernelApi, owner: HitOwner): void
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
