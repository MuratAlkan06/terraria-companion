/**
 * minion-sentry (PRD P3-S9 AC1–AC4). A use of the weapon summons one minion (`variant: 'minion'`) or
 * places one sentry (`'sentry'`) — a persistent kernel agent (contracts `AgentState`) that attacks on
 * its own until it is replaced or the world resets.
 *
 * SLOTS (`summon-slots`) — VERIFIED defaults (constants.ts): one minion and one sentry slot; the Lab's
 * `minionSlots` / `sentrySlots` settings stand in for gear. Each summon takes its `slotCost`; with the
 * slots full a new summon replaces the OLDEST (the wiki: summons last until "the player … summons a
 * replacement"; which one goes is a Lab choice). A summon that costs more than all the slots is not
 * summoned. Weapons repeat while attack is held (`auto-reuse`), but a summon weapon held down only
 * summons while slots are free: a re-summon that would replace one needs a new press
 * (`KernelApi.freshPress`), else a held attack (Space, a timed test) would replace its minion every
 * use and it would never attack.
 *
 * WHERE: a minion appears at the aim point (in-game, at the cursor); with the auto-aim (Space, a
 * timed test) beside the player. A sentry is placed exactly at the aim point and never moves (PRD
 * P3-S9 AC2: "spawns stationary at the click point"); with the auto-aim 2 tiles in front of the player.
 *
 * ATTACKS (`summon-attack`): once per `attackRateTicks` — a rate the wiki states, or one a B63 convention
 * supplies: P-2 an average (`summon-average-rate`), P-3 a contact minion's immunity-frame cap, an
 * UPPER BOUND (`summon-hit-cap`: "maximum rate; actual depends on minion AI pathing") — both labeled by
 * the guard from `_prov.modeledFields`. Every attack lands; the first comes one interval after the summon
 * appears, and the rhythm never breaks when the target changes. Movement is drawn, not simulated (no
 * speed, no pathing): the agent glides to its next pose so that it arrives exactly when its attack is due.
 *
 * TARGET (`summon-target`): the dummy a whip struck last (wiki Whips) — for a sentry only if in range —
 * else the dummy nearest the player (a sentry: nearest itself, centre within `sentryRangeTiles`; none in
 * range → it waits).
 *
 * AI CLASSES — the binding AMENDMENTS-013 B63 P-6 definitions (pipeline/merge/labFamilies.ts header),
 * each with its own observable Lab model (`minion-<class>`):
 * - melee-contact ("flies, charges or dashes at enemies, damaging them by contact"): loops above the
 *   dummy and dives through its centre — the hit as it passes.
 * - ground-melee ("moves along the ground … hits enemies up close"): on the ground (the dummy's foot
 *   line) at its near side, hopping back and into its face — the hit on landing.
 * - hover-strike ("flies or hovers next to enemies and strikes them repeatedly at close range"): hovers
 *   beside the dummy at chest height, lunging in to strike.
 * - ranged-shot ("damages enemies with projectiles it shoots, fires, spits or throws"): hovers near the
 *   player (a sentry: where it stands) and shoots. With no projectile speed in the data the shot lands
 *   the tick it is fired (a hit on the dummy's edge facing it); with `projectile.velocityTps` it is a
 *   kernel projectile of the summon's kind. A contact class with a projectile spec contradicts the
 *   class (`invalid-data`).
 * Damage: weapon damage (× `projectile.damageMultiplierPct` when given); summon damage never crits
 * except through a whip tag (B17; world.ts `strike`). Homing summons are refused, never ignored.
 */
import type { ArchetypeParams } from '../../schemas'
import { PROJECTILE_APPROXIMATIONS, type ApproximationId } from '../approximations'
import type { AgentBrain, AgentState, ArchetypeInterpreter, Behavior, DummyState, HitOwner, KernelApi, PrepareResult, ProjectileShape } from '../contracts'
import { aabbCenter, segmentAabbEntry } from '../geometry'
import { cos, sin } from '../trig'
import type { MinionAiClass, NotSimulable, SummonKind, Vec2 } from '../types'
import { fitsSlots, slotCapacity } from '../world'
import { projectileDamage, shapeFromSpec, tilesPerTick } from './shared'

type SummonParams = Extract<ArchetypeParams, { archetype: 'minion-sentry' }>

const CLASS_APPROXIMATION: Readonly<Record<MinionAiClass, ApproximationId>> = {
  'melee-contact': 'minion-melee-contact',
  'ground-melee': 'minion-ground-melee',
  'hover-strike': 'minion-hover-strike',
  'ranged-shot': 'minion-ranged-shot',
}

/** The classes that damage by the summon's own hits (B63 P-3 applies to them; no projectile). */
export const CONTACT_AI_CLASSES: readonly MinionAiClass[] = ['melee-contact', 'ground-melee', 'hover-strike']

/**
 * Lab pose geometry (tiles) — drawn movement, not game values. Contact poses meet the dummy on the
 * attack tick, so the hit point (`damage` event x / y) is where the summon touches it.
 */
export const SUMMON_POSE = {
  /** A minion with the auto-aim (Space, a timed test) appears this far behind and above the player. */
  autoMinion: { back: 1, up: 2 },
  /** A sentry placed with the auto-aim stands this far in front of the player. */
  autoSentryAhead: 2,
  /** melee-contact: the loop's half width and its height above the dummy's centre. */
  loop: { halfWidth: 3, height: 3 },
  /** ground-melee: the hop's height and how far it springs back from the dummy's face. */
  hop: { height: 1, back: 1 },
  /** hover-strike: where it hovers beside the face, and how far its lunge reaches in. */
  hover: { out: 1.4, up: 0.9, lunge: 1.2 },
  /** ranged-shot minions (and any idle minion): behind and above the player. */
  ranged: { back: 1.2, up: 2.2 },
  /** Several summons on one target: each further one offset by this much (tiles), by id. */
  lane: 0.6,
} as const

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const smooth = (w: number) => w * w * (3 - 2 * w)
const lerp = (a: Vec2, b: Vec2, w: number): Vec2 => ({ x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w })

/** `p` pulled inside the arena (a little short of its edges). */
function inArena(k: KernelApi, p: Vec2): Vec2 {
  const { minX, maxX, minY, maxY } = k.arena
  return { x: Math.min(maxX - 1, Math.max(minX + 1, p.x)), y: Math.min(maxY - 1, Math.max(minY + 1, p.y)) }
}

/** Where a use summons: the aim point, or with the auto-aim beside (minion) / in front of (sentry) the player. */
function summonPoint(k: KernelApi, kind: SummonKind): Vec2 {
  if (!k.autoAim) return inArena(k, k.aim)
  const { player, facing } = k
  return kind === 'minion'
    ? inArena(k, { x: player.x - facing * SUMMON_POSE.autoMinion.back, y: player.y - SUMMON_POSE.autoMinion.up })
    : inArena(k, { x: player.x + facing * SUMMON_POSE.autoSentryAhead, y: player.y })
}

interface SummonConfig {
  kind: SummonKind
  slotCost: number
  aiClass: MinionAiClass
  rate: number
  /** Sentry targeting radius (tiles), null for minions. */
  range: number | null
  damage: number
  /** A ranged summon's projectile flight (data velocity), else null: the shot lands at once. */
  shot: { speed: number; shape: ProjectileShape } | null
}

const centreOf = (d: DummyState): Vec2 => aabbCenter(d.box)
const distSq = (a: Vec2, b: Vec2) => (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)

/** The dummy an agent attacks now: the whip's focus (a sentry: if in range), else the nearest. */
function pickTarget(k: KernelApi, a: AgentState, cfg: SummonConfig): number | null {
  const inRange = (d: DummyState) => cfg.range === null || distSq(a, centreOf(d)) <= cfg.range * cfg.range
  const focus = k.focusIndex === null ? undefined : k.dummies[k.focusIndex]
  if (focus && inRange(focus)) return focus.index
  const from = cfg.kind === 'sentry' ? a : k.player
  let best: number | null = null
  let bestSq = Infinity
  for (const d of k.dummies) {
    if (!inRange(d)) continue
    const sq = distSq(from, centreOf(d))
    if (sq < bestSq) {
      best = d.index
      bestSq = sq
    }
  }
  return best
}

/** Where a minion of `cfg.aiClass` is at phase `p` of its attack cycle (p = 1: the attack tick). */
function cyclePose(k: KernelApi, a: AgentState, cfg: SummonConfig, target: DummyState | null, p: number): Vec2 {
  const lane = ((a.id - 1) % 3) * SUMMON_POSE.lane
  const near = target ? (k.player.x <= centreOf(target).x ? -1 : 1) : -k.facing
  const towards = target ? -near : k.facing
  if (!target || cfg.aiClass === 'ranged-shot') {
    // ranged (and idle): hovering behind and above the player, with a slow bob
    return { x: k.player.x - towards * (SUMMON_POSE.ranged.back + lane), y: k.player.y - SUMMON_POSE.ranged.up - 0.25 * sin(2 * Math.PI * p) }
  }
  const c = centreOf(target)
  const face = near < 0 ? target.box.minX : target.box.maxX
  switch (cfg.aiClass) {
    case 'melee-contact': {
      const q = 2 * Math.PI * p
      const { halfWidth, height } = SUMMON_POSE.loop
      return { x: c.x + towards * halfWidth * sin(q), y: c.y - (height * (1 - cos(q))) / 2 - lane }
    }
    case 'ground-melee': {
      const hop = sin(Math.PI * p)
      return { x: face + near * (0.5 + lane / 2 + SUMMON_POSE.hop.back * hop), y: target.box.maxY - 0.5 - SUMMON_POSE.hop.height * hop }
    }
    case 'hover-strike': {
      const { out, up, lunge } = SUMMON_POSE.hover
      const strike = 1 - Math.min(1, Math.min(p, 1 - p) / 0.2)
      return { x: face + near * (out - lunge * strike), y: c.y - up - lane + 0.6 * strike + 0.15 * sin(4 * Math.PI * p) * (1 - strike) }
    }
  }
}

/** One agent's behavior: target → attack when due → move (per agent, so it keeps its own schedule). */
function summonBrain(cfg: SummonConfig): AgentBrain {
  let nextAttack = -1
  let travelFrom: Vec2 | null = null
  let travelStart = 0
  let target: number | null | undefined
  return {
    step(k, a) {
      if (nextAttack < 0) {
        nextAttack = a.spawnTick + cfg.rate
        travelFrom = { x: a.x, y: a.y }
        travelStart = k.tick
      }
      const next = pickTarget(k, a, cfg)
      if (next !== target) {
        // a new target: glide there from here, arriving when the next attack is due
        if (target !== undefined) {
          travelFrom = { x: a.x, y: a.y }
          travelStart = k.tick
        }
        target = next
        a.targetIndex = next
      }
      const dummy = target === null || target === undefined ? null : k.dummies[target]
      if (cfg.kind === 'minion') {
        const pose = cyclePose(k, a, cfg, dummy, clamp01(1 - (nextAttack - k.tick) / cfg.rate))
        let at = pose
        if (travelFrom) {
          const w = (k.tick - travelStart) / Math.max(1, nextAttack - travelStart)
          if (w >= 1) travelFrom = null
          else at = lerp(travelFrom, pose, smooth(clamp01(w)))
        }
        a.x = at.x
        a.y = at.y
      }
      if (dummy) {
        const c = centreOf(dummy)
        if (c.x !== a.x) a.facing = c.x > a.x ? 1 : -1
      }
      if (!dummy || k.tick < nextAttack) return
      attack(k, a, cfg, dummy)
      a.lastAttackTick = k.tick
      nextAttack = k.tick + cfg.rate
    },
  }
}

function attack(k: KernelApi, a: AgentState, cfg: SummonConfig, dummy: DummyState): void {
  const c = centreOf(dummy)
  if (cfg.aiClass !== 'ranged-shot') {
    // contact: where it touches the dummy
    const { box } = dummy
    k.strike(a.source, dummy, { x: Math.min(box.maxX, Math.max(box.minX, a.x)), y: Math.min(box.maxY, Math.max(box.minY, a.y)) })
    return
  }
  if (cfg.shot) {
    const d = Math.sqrt(distSq(a, c))
    const ux = d === 0 ? a.facing : (c.x - a.x) / d
    const uy = d === 0 ? 0 : (c.y - a.y) / d
    const owner = a.source.owner
    k.spawnProjectile({ x: a.x, y: a.y, vx: ux * cfg.shot.speed, vy: uy * cfg.shot.speed, damage: cfg.damage, ...cfg.shot.shape, summon: { kind: cfg.kind, ...(owner ? { owner } : {}) } })
    return
  }
  // an instant shot: it lands where the line from the summon enters the dummy (its centre if inside)
  const t = segmentAabbEntry(a.x, a.y, c.x, c.y, dummy.box) ?? 1
  k.strike(a.source, dummy, { x: a.x + (c.x - a.x) * t, y: a.y + (c.y - a.y) * t })
}

export const minionSentry: ArchetypeInterpreter<'minion-sentry'> = {
  archetype: 'minion-sentry',
  requiredFields: [],
  prepare({ weapon, params }): PrepareResult {
    const refuse = (reason: NotSimulable['reason'], message: string, fields: string[]): PrepareResult => ({
      ok: false,
      refusal: { kind: 'not-simulable', reason, message, weaponId: weapon.id, fields, archetype: 'minion-sentry' },
    })
    const modifiers = weapon.labBehavior.kind === 'archetype' ? weapon.labBehavior.modifiers : undefined
    if (modifiers?.homing) return refuse('modifier-not-implemented', 'A summon’s homing isn’t simulated by the Weapon Lab.', ['labBehavior.modifiers.homing'])
    if (params.projectile && CONTACT_AI_CLASSES.includes(params.aiClass)) {
      return refuse('invalid-data', `A ${params.aiClass} summon damages by its own hits; a projectile contradicts its class.`, ['labBehavior.params.aiClass', 'labBehavior.params.projectile'])
    }
    const cfg = configOf(params, weapon.damage ?? 0)
    const summonOne = (k: KernelApi, at: Vec2, owner: HitOwner | undefined, loadout: boolean) => {
      if (cfg.slotCost > slotCapacity(k.settings, cfg.kind) + 1e-9) return // it can never fit
      for (const old of k.agents.filter((x) => x.kind === cfg.kind)) {
        if (fitsSlots(k, cfg.kind, cfg.slotCost)) break
        k.dismiss(old, 'replaced')
      }
      k.summon({
        kind: cfg.kind,
        slotCost: cfg.slotCost,
        aiClass: cfg.aiClass,
        x: at.x,
        y: at.y,
        baseDamage: cfg.damage,
        cooldownTicks: cfg.rate,
        ...(owner ? { owner } : {}),
        loadout,
        brain: summonBrain(cfg),
      })
    }
    const behavior: Behavior = {
      archetype: 'minion-sentry',
      baseHitDamage: cfg.damage,
      usesAmmo: false,
      approximations: [
        'summon-slots',
        'summon-attack',
        'summon-target',
        CLASS_APPROXIMATION[cfg.aiClass],
        ...(cfg.kind === 'sentry' ? (['sentry-placement'] as const) : []),
        ...(cfg.shot ? PROJECTILE_APPROXIMATIONS : []),
      ],
      ready: (k) => k.freshPress || fitsSlots(k, cfg.kind, cfg.slotCost),
      activate(k) {
        summonOne(k, summonPoint(k, cfg.kind), undefined, false)
      },
      ...(cfg.kind === 'minion'
        ? {
            fillSlots(k: KernelApi, owner: HitOwner) {
              const { player, facing } = k
              for (let i = 0; fitsSlots(k, 'minion', cfg.slotCost); i++) {
                summonOne(k, inArena(k, { x: player.x - facing * (SUMMON_POSE.autoMinion.back + i * SUMMON_POSE.lane), y: player.y - SUMMON_POSE.autoMinion.up }), owner, true)
              }
            },
          }
        : {}),
    }
    return { ok: true, behavior }
  },
}

function configOf(params: SummonParams, weaponDamage: number): SummonConfig {
  const spec = params.projectile
  return {
    kind: params.variant,
    slotCost: params.slotCost,
    aiClass: params.aiClass,
    rate: params.attackRateTicks,
    range: params.variant === 'sentry' ? (params.sentryRangeTiles ?? null) : null,
    damage: projectileDamage(weaponDamage, spec),
    shot: spec && params.aiClass === 'ranged-shot' ? { speed: tilesPerTick(spec.velocityTps), shape: shapeFromSpec(spec) } : null,
  }
}
