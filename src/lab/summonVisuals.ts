/**
 * Render math for P3-S9 / P3-S10 — summons and whips — pure, no PixiJS (the arena draws it; Node tests
 * check it). Like ./thrownVisuals.ts everything lands on the art-pixel grid.
 *
 * - A whip (the engine's `blade.kind === 'whip'`) is a one-art-pixel line from the hand to its tip at the
 *   engine's range along the engine's angle, bowed BEHIND the swing (a quadratic curve whose control point
 *   trails the sweep), with a brighter tip cell: the whip's length is its data range (PRD P3-S10 AC1).
 * - Minions and sentries are drawn where the engine has them (prev → current, interpolated like the
 *   projectiles), facing their target.
 * - A shooting summon's instant shot (no projectile flight in the data) is a short-lived tracer from the
 *   summon to the hit (`ShotTracers`).
 * - A whip tag on a dummy (PRD P3-S10 AC1): a tag icon above the dummy's head with a timer bar under it
 *   that shrinks with the tag's time left (`tagMarker`) — shape and length, never colour alone; the HTML
 *   HUD says the same in words. While summons are out, the dummy they attack keeps the FILLED tag and any
 *   other tagged dummy shows it HOLLOW (`tagMarkerStyle`, design review M2) — a shape difference.
 * - Minions of one kind attacking one dummy are fanned out sideways (`stackOffsets`, kept steady frame to
 *   frame by `StackSpread`; design review M5): the engine puts them nearly on one spot (its lanes are a
 *   fraction of a tile apart; their movement is drawn, not simulated), where they hide each other.
 * - A summon that leaves (the oldest replaced, design review M1) fades out where it was, rising, with a
 *   small puff (`despawnPose`, `despawnPuffCells`); under reduced motion it only fades, in place.
 */
import type { RenderState } from '../sim'
import { streakCells } from './blade'

/** A summon's drawn position (tiles): its last two ticks, interpolated. */
export function agentPosition(a: Pick<RenderState['agents'][number], 'x' | 'y' | 'prevX' | 'prevY'>, alpha: number): { x: number; y: number } {
  const t = Math.min(1, Math.max(0, alpha))
  return { x: a.prevX + (a.x - a.prevX) * t, y: a.prevY + (a.y - a.prevY) * t }
}

/** How far the whip's middle bows behind the swing, as a share of its length. */
export const WHIP_BOW = 0.12

export interface WhipCells {
  /** The lash, hand to tip, without the tip cell. */
  line: [number, number][]
  /** The tip's cell. */
  tip: [number, number]
}

/**
 * The whip on the art-pixel grid: from `hand` (game px) to the tip `lengthPx` along `angle`, bowed
 * behind the swing — `sweep` is the swing's direction of travel (+1: the angle grows, i.e. clockwise
 * on screen; −1: it shrinks). Cells are top-left corners, deduplicated, hand first.
 */
export function whipCells(hand: { x: number; y: number }, angle: number, lengthPx: number, sweep: 1 | -1, cell: number): WhipCells {
  const tipPoint = { x: hand.x + Math.cos(angle) * lengthPx, y: hand.y + Math.sin(angle) * lengthPx }
  const snap = (p: { x: number; y: number }): [number, number] => [Math.floor(p.x / cell) * cell, Math.floor(p.y / cell) * cell]
  if (!(lengthPx > 0) || !(cell > 0)) return { line: [], tip: snap(tipPoint) }
  // The control point trails the sweep: perpendicular to the line, against the direction of travel.
  const mid = { x: (hand.x + tipPoint.x) / 2, y: (hand.y + tipPoint.y) / 2 }
  const bow = lengthPx * WHIP_BOW * -sweep
  const control = { x: mid.x - Math.sin(angle) * bow, y: mid.y + Math.cos(angle) * bow }
  const segments = Math.max(4, Math.ceil(lengthPx / (cell * 6)))
  const at = (t: number) => ({
    x: (1 - t) * (1 - t) * hand.x + 2 * (1 - t) * t * control.x + t * t * tipPoint.x,
    y: (1 - t) * (1 - t) * hand.y + 2 * (1 - t) * t * control.y + t * t * tipPoint.y,
  })
  const seen = new Set<string>()
  const line: [number, number][] = []
  const tip = snap(tipPoint)
  const tipKey = `${tip[0]},${tip[1]}`
  for (let i = 0; i < segments; i++) {
    for (const [x, y] of streakCells(at(i / segments), at((i + 1) / segments), cell)) {
      const key = `${x},${y}`
      if (seen.has(key) || key === tipKey) continue
      seen.add(key)
      line.push([x, y])
    }
  }
  return { line, tip }
}

/** How long a summon's instant-shot tracer stays (ms). */
export const TRACER_MS = 140

export interface Tracer {
  from: { x: number; y: number }
  to: { x: number; y: number }
  /** 1 → 0 over TRACER_MS. */
  alpha: number
}

/** Short-lived lines from a shooting summon to where its shot landed (tiles), newest last. */
export class ShotTracers {
  private list: { from: { x: number; y: number }; to: { x: number; y: number }; bornAt: number }[] = []

  add(from: { x: number; y: number }, to: { x: number; y: number }, now: number): void {
    this.list.push({ from: { ...from }, to: { ...to }, bornAt: now })
  }

  /** The tracers still showing at `now` (older ones are dropped). */
  visuals(now: number): Tracer[] {
    this.list = this.list.filter((t) => now - t.bornAt < TRACER_MS)
    return this.list.map((t) => ({ from: t.from, to: t.to, alpha: 1 - (now - t.bornAt) / TRACER_MS }))
  }

  clear(): void {
    this.list = []
  }
}

/** Gap (tiles) between a dummy's head and its tag icon. */
export const TAG_MARKER_LIFT_TILES = 0.35

export interface TagMarker {
  /** Where the tag icon's bottom centre sits (tiles). */
  x: number
  y: number
  /** The tag's time left, 0..1 — the timer bar's filled share. */
  left: number
}

/** A tagged dummy's marker: the icon over its head, and how much of the tag's time is left. Null when untagged. */
export function tagMarker(d: Pick<RenderState['dummies'][number], 'x' | 'y' | 'height' | 'tag'>): TagMarker | null {
  if (!d.tag || !(d.tag.durationTicks > 0)) return null
  return { x: d.x, y: d.y - d.height / 2 - TAG_MARKER_LIFT_TILES, left: Math.min(1, Math.max(0, d.tag.remainingTicks / d.tag.durationTicks)) }
}

/** The direction a whip pose is sweeping: +1 when its angle grows (prev → current), −1 when it shrinks. */
export const sweepOf = (pose: { angle: number; prevAngle: number }): 1 | -1 => (pose.angle >= pose.prevAngle ? 1 : -1)

type AgentFocus = Pick<RenderState['agents'][number], 'targetId'>

/** The dummies the summons attack now (their targets), by id. */
export const summonFocus = (agents: readonly AgentFocus[]): ReadonlySet<string> => new Set(agents.flatMap((a) => (a.targetId ? [a.targetId] : [])))

/**
 * How a tagged dummy's tag icon is drawn: `filled` for a dummy the summons attack, `outline` (hollow) for
 * one they don't. With no summons attacking anything there is no focus to show: every tag is filled.
 */
export function tagMarkerStyle(dummyId: string, focus: ReadonlySet<string>): 'filled' | 'outline' {
  return focus.size === 0 || focus.has(dummyId) ? 'filled' : 'outline'
}

/** Sideways step (tiles) between minions of one kind on one dummy… */
export const STACK_STEP_TILES = 0.45
/** …the whole group spread over at most this much (the step shrinks for a big group). */
export const STACK_SPREAD_TILES = 2.25

type StackAgent = Pick<RenderState['agents'][number], 'id' | 'kind' | 'aiClass' | 'targetId' | 'x'>
type StackDummy = Pick<RenderState['dummies'][number], 'id' | 'x'>

/**
 * Horizontal draw offsets (tiles) for minions that share a spot: same AI class, same target. Within a
 * group they are ordered by how far from the dummy, toward the player's side, each one rests (`restX`:
 * its x with its hops and loops averaged out — see `StackSpread`; default its x now): the nearest stays
 * where the engine has it, each further one is drawn one more step toward the player's side. The engine
 * spreads several summons on one target into lanes the same way (away from the dummy for a ground
 * minion, further behind you for a shooter), so following its order these steps only ever widen its
 * gaps. Sentries stay exactly where they were placed; a minion with no target, or alone in its group, is
 * not moved. Drawing only: the engine's positions and hits are untouched.
 */
export function stackOffsets(agents: readonly StackAgent[], dummies: readonly StackDummy[], playerX: number, restX: (a: StackAgent) => number = (a) => a.x): Map<number, number> {
  const groups = new Map<string, { targetId: string; members: StackAgent[] }>()
  for (const a of agents) {
    if (a.kind !== 'minion' || a.targetId === null) continue
    const key = `${a.aiClass}|${a.targetId}`
    const group = groups.get(key)
    if (group) group.members.push(a)
    else groups.set(key, { targetId: a.targetId, members: [a] })
  }
  const offsets = new Map<number, number>()
  for (const { targetId, members } of groups.values()) {
    const target = dummies.find((d) => d.id === targetId)
    if (!target || members.length < 2) continue
    const toward = playerX <= target.x ? -1 : 1
    const step = Math.min(STACK_STEP_TILES, STACK_SPREAD_TILES / (members.length - 1))
    const away = (a: StackAgent) => (restX(a) - target.x) * toward
    const ordered = [...members].sort((a, b) => away(a) - away(b) || a.id - b.id)
    ordered.forEach((a, i) => {
      if (i > 0) offsets.set(a.id, toward * step * i)
    })
  }
  return offsets
}

/** How long a minion's resting place takes to settle (ms): its hops and loops average out over it. */
export const STACK_REST_MS = 600
/** How quickly a minion slides to a new place in the fan (ms); at once under reduced motion. */
export const STACK_SLIDE_MS = 150

/**
 * `stackOffsets` frame by frame: it keeps each minion's resting x (its x smoothed over STACK_REST_MS,
 * so a hop or a loop through the dummy never reorders a group), and slides a minion to a new place in
 * the fan instead of jumping (at once under reduced motion). A summon that is gone is forgotten.
 */
export class StackSpread {
  private rest = new Map<number, number>()
  private shown = new Map<number, number>()

  /** This frame's offsets (tiles) by agent id; `dtMs`: wall time since the last update. */
  update(agents: readonly StackAgent[], dummies: readonly StackDummy[], playerX: number, dtMs: number, reduced: boolean): Map<number, number> {
    const dt = Math.max(0, dtMs)
    const settle = 1 - Math.exp(-dt / STACK_REST_MS)
    const slide = reduced ? 1 : 1 - Math.exp(-dt / STACK_SLIDE_MS)
    const live = new Set<number>()
    for (const a of agents) {
      live.add(a.id)
      const before = this.rest.get(a.id)
      this.rest.set(a.id, before === undefined ? a.x : before + (a.x - before) * settle)
    }
    for (const id of [...this.rest.keys()]) {
      if (live.has(id)) continue
      this.rest.delete(id)
      this.shown.delete(id)
    }
    const goals = stackOffsets(agents, dummies, playerX, (a) => this.rest.get(a.id) ?? a.x)
    const out = new Map<number, number>()
    for (const a of agents) {
      const goal = goals.get(a.id) ?? 0
      const before = this.shown.get(a.id) ?? goal
      const next = Math.abs(goal - before) < 1e-3 ? goal : before + (goal - before) * slide
      this.shown.set(a.id, next)
      if (next !== 0) out.set(a.id, next)
    }
    return out
  }

  clear(): void {
    this.rest.clear()
    this.shown.clear()
  }
}

/** How long a departing summon's fade lasts (ms). */
export const DESPAWN_MS = 360
/** How far it rises while fading (tiles), without reduced motion. */
export const DESPAWN_RISE_TILES = 0.5

/** A departing summon at `ageMs`: opacity, rise (tiles, up is negative) and scale; null once gone. */
export function despawnPose(ageMs: number, reduced: boolean): { alpha: number; dy: number; scale: number } | null {
  if (!(ageMs >= 0) || ageMs >= DESPAWN_MS) return null
  const t = ageMs / DESPAWN_MS
  const alpha = 1 - t
  return reduced ? { alpha, dy: 0, scale: 1 } : { alpha, dy: -DESPAWN_RISE_TILES * t, scale: 1 - 0.25 * t }
}

/**
 * The puff where a summon left: four art-pixel cells on the diagonals around `center` (game px), moving
 * out from `minPx` to `maxPx` as it fades — under reduced motion they stay at `minPx`. Cells are
 * top-left corners on the art-pixel grid; none once the fade is over.
 */
export function despawnPuffCells(center: { x: number; y: number }, ageMs: number, reduced: boolean, cell: number, minPx: number, maxPx: number): [number, number][] {
  if (!(ageMs >= 0) || ageMs >= DESPAWN_MS || !(cell > 0)) return []
  const r = reduced ? minPx : minPx + (maxPx - minPx) * (ageMs / DESPAWN_MS)
  const d = r / Math.SQRT2
  return [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ].map(([sx, sy]) => [Math.floor((center.x + sx * d) / cell) * cell, Math.floor((center.y + sy * d) / cell) * cell])
}
