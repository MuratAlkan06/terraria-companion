/**
 * Render math for thrown explosives and their blasts (PRD P3-S11 AC1) — pure, no PixiJS (the arena
 * draws it; Node tests check it). Everything lands on the arena's art-pixel grid, like the shots and the
 * whip:
 *
 * - A thrown explosive is the weapon's own sprite where the engine has it (interpolated), at native art
 *   scale, tumbling in QUARTER turns while it flies (a sprite turned by 90° keeps every pixel square) and
 *   upright once it rests on the ground (`explosiveRotation`).
 * - A blast is a RING of art-pixel cells straddling the circle of the blast's radius — radius-accurate:
 *   its cells' centres lie within `thickness` cells of `radiusTiles` × 16 game px (`ringCells`) — over a
 *   flash disc drawn as one span per pixel row (`discSpans`). It grows from the centre to the full radius
 *   over BLAST_GROW_MS (ease-out) while the flash fades, then the full ring fades over BLAST_FADE_MS
 *   (`blastPose`). Reduced motion: no growth and no fade — one static frame of the full ring and a dim
 *   flash, held BLAST_STATIC_MS (long enough to see), then gone.
 * - A FUSED explosive (timed trigger) sparks at its fuse end — the sprite's topmost opaque pixel (a
 *   bomb's fuse curls up out of it, a stick of dynamite's stands on top: `topmostOpaque`), turned with
 *   the sprite (`fuseTip`) — every tick it is out: two small spark poses alternating every
 *   SPARK_STEP_TICKS (`fuseSparkCells`; design review P3-S11 #9). Reduced motion: one static glow there,
 *   never flickering.
 * - Explosives resting on one spot (every Space throw lands under the first dummy) are fanned out
 *   sideways like a stack of minions (`restingStackOffsets`, kept steady and slid by `ExplosiveStack`):
 *   the oldest stays where the engine has it, each newer one a step further toward the player. Drawing
 *   only — the engine's positions, and so the blasts, are untouched.
 */
import type { RenderState } from '../sim'
import { STACK_SLIDE_MS, STACK_SPREAD_TILES, STACK_STEP_TILES } from './summonVisuals'
import { spinRotation } from './thrownVisuals'

/** The ring grows to its full radius in this long (ms)… */
export const BLAST_GROW_MS = 180
/** …then fades out over this long (ms). */
export const BLAST_FADE_MS = 320
/** Reduced motion: the single static frame is held this long (ms). */
export const BLAST_STATIC_MS = 200

export interface BlastPose {
  /** Share of the blast radius the ring is drawn at (1 = the full radius). */
  radiusFrac: number
  ringAlpha: number
  flashAlpha: number
}

/** A blast `ageMs` after it went off; null once it is gone. */
export function blastPose(ageMs: number, reduced: boolean): BlastPose | null {
  if (!(ageMs >= 0)) return null
  if (reduced) return ageMs < BLAST_STATIC_MS ? { radiusFrac: 1, ringAlpha: 1, flashAlpha: 0.25 } : null
  if (ageMs < BLAST_GROW_MS) {
    const t = ageMs / BLAST_GROW_MS
    return { radiusFrac: 1 - (1 - t) ** 2, ringAlpha: 1, flashAlpha: 0.45 * (1 - t) }
  }
  const f = (ageMs - BLAST_GROW_MS) / BLAST_FADE_MS
  return f < 1 ? { radiusFrac: 1, ringAlpha: 1 - f, flashAlpha: 0 } : null
}

const snap = (v: number, cell: number) => Math.round(v / cell) * cell

/**
 * The ring's art-pixel cells (top-left corners, game px) around `center` (game px): every grid cell whose
 * centre lies within `thickness` ÷ 2 cells of the circle of `radiusPx`. Empty for a radius under a cell.
 */
export function ringCells(center: { x: number; y: number }, radiusPx: number, cell: number, thickness = 2): [number, number][] {
  if (!(radiusPx >= cell) || !(cell > 0)) return []
  const cx = snap(center.x, cell)
  const cy = snap(center.y, cell)
  const half = (thickness * cell) / 2
  const reach = Math.ceil((radiusPx + half) / cell) * cell
  const out: [number, number][] = []
  for (let y = cy - reach; y < cy + reach; y += cell) {
    for (let x = cx - reach; x < cx + reach; x += cell) {
      const d = Math.hypot(x + cell / 2 - cx, y + cell / 2 - cy)
      if (Math.abs(d - radiusPx) <= half) out.push([x, y])
    }
  }
  return out
}

/** The flash disc as one horizontal span per art-pixel row: [x, y, width] (game px), inside the circle of `radiusPx`. */
export function discSpans(center: { x: number; y: number }, radiusPx: number, cell: number): [number, number, number][] {
  if (!(radiusPx >= cell) || !(cell > 0)) return []
  const cx = snap(center.x, cell)
  const cy = snap(center.y, cell)
  const out: [number, number, number][] = []
  for (let y = cy - Math.floor(radiusPx / cell) * cell; y < cy + radiusPx; y += cell) {
    const dy = y + cell / 2 - cy
    if (Math.abs(dy) > radiusPx) continue
    const half = Math.floor(Math.sqrt(radiusPx * radiusPx - dy * dy) / cell) * cell
    if (half <= 0) continue
    out.push([cx - half, y, 2 * half])
  }
  return out
}

type Thrown = Pick<RenderState['projectiles'][number], 'x' | 'y' | 'prevX' | 'prevY'>

/** A thrown explosive tumbles in quarter turns while it moves (toward its flight) and lies upright at rest. */
export function explosiveRotation(p: Thrown, t: number, facing: 1 | -1): number {
  const moving = p.x !== p.prevX || p.y !== p.prevY
  return moving ? spinRotation(t, facing) : 0
}

/** A fused explosive's spark alternates its two poses every this many ticks (≈ 7.5 Hz at 60 ticks/s). */
export const SPARK_STEP_TICKS = 4

export interface SparkCells {
  /** The bright point at the fuse end. */
  core: [number, number][]
  /** The sparks around it (or, under reduced motion, its static glow). */
  glow: [number, number][]
}

/**
 * The spark at a fused explosive's fuse end `tip` (game px): art-pixel cells (top-left corners, on the
 * grid). Pose A, a "+" without its lower arm (the fuse is below); pose B, the two upper diagonals —
 * alternating every SPARK_STEP_TICKS of `tick`. Reduced motion: the core and the cell above it, the same
 * every tick (a static glow).
 */
export function fuseSparkCells(tip: { x: number; y: number }, tick: number, reduced: boolean, cell: number): SparkCells {
  if (!(cell > 0)) return { core: [], glow: [] }
  const cx = Math.floor(tip.x / cell) * cell
  const cy = Math.floor(tip.y / cell) * cell
  const at = (dx: number, dy: number): [number, number] => [cx + dx * cell, cy + dy * cell]
  if (reduced) return { core: [at(0, 0)], glow: [at(0, -1)] }
  const poseA = Math.floor(tick / SPARK_STEP_TICKS) % 2 === 0
  return {
    core: [at(0, 0)],
    glow: poseA ? [at(0, -1), at(-1, 0), at(1, 0)] : [at(-1, -1), at(1, -1)],
  }
}

/**
 * The topmost opaque pixel of a sprite (its fuse end), as an offset from the sprite's centre (texture px,
 * the pixel's centre): the middle of the opaque run on the first row that has one. `alpha`: one value
 * per pixel, row by row. Null for a sprite with no opaque pixel.
 */
export function topmostOpaque(alpha: ArrayLike<number>, width: number, height: number, threshold = 128): { x: number; y: number } | null {
  for (let y = 0; y < height; y++) {
    let first = -1
    let last = -1
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x] < threshold) continue
      if (first < 0) first = x
      last = x
    }
    if (first >= 0) return { x: (first + last + 1) / 2 - width / 2, y: y + 0.5 - height / 2 }
  }
  return null
}

/**
 * Where the fuse end is (game px) for a sprite drawn at `center` and turned by `rotation` (radians):
 * `offset` from its centre (`topmostOpaque`, sprite px = game px at native art scale), turned with it.
 */
export function fuseTip(center: { x: number; y: number }, offset: { x: number; y: number }, rotation: number): { x: number; y: number } {
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return { x: center.x + offset.x * cos - offset.y * sin, y: center.y + offset.x * sin + offset.y * cos }
}

type Resting = Pick<RenderState['projectiles'][number], 'id' | 'x' | 'y' | 'prevX' | 'prevY'>

/**
 * Sideways draw offsets (tiles) for explosives resting on one spot (same position, not moving): oldest
 * first (by projectile id) stays where the engine has it, each newer one one more step toward the
 * player's side — STACK_STEP_TILES apart, the group over at most STACK_SPREAD_TILES (as minions on one
 * dummy, ./summonVisuals.ts). One alone, or in flight, is not moved.
 */
export function restingStackOffsets(projectiles: readonly Resting[], playerX: number): Map<number, number> {
  const groups = new Map<string, Resting[]>()
  for (const p of projectiles) {
    if (p.x !== p.prevX || p.y !== p.prevY) continue
    const key = `${Math.round(p.x * 16)}|${Math.round(p.y * 16)}`
    const group = groups.get(key)
    if (group) group.push(p)
    else groups.set(key, [p])
  }
  const offsets = new Map<number, number>()
  for (const members of groups.values()) {
    if (members.length < 2) continue
    const toward = playerX <= members[0].x ? -1 : 1
    const step = Math.min(STACK_STEP_TILES, STACK_SPREAD_TILES / (members.length - 1))
    const ordered = [...members].sort((a, b) => a.id - b.id)
    ordered.forEach((p, i) => {
      if (i > 0) offsets.set(p.id, toward * step * i)
    })
  }
  return offsets
}

/**
 * `restingStackOffsets` frame by frame: an explosive slides to its place in the fan (and back as an older
 * one goes off) over STACK_SLIDE_MS instead of jumping — at once under reduced motion. One that is gone is
 * forgotten.
 */
export class ExplosiveStack {
  private shown = new Map<number, number>()

  /** This frame's offsets (tiles) by projectile id; `dtMs`: wall time since the last update. */
  update(projectiles: readonly Resting[], playerX: number, dtMs: number, reduced: boolean): Map<number, number> {
    const slide = reduced ? 1 : 1 - Math.exp(-Math.max(0, dtMs) / STACK_SLIDE_MS)
    const goals = restingStackOffsets(projectiles, playerX)
    const live = new Set<number>()
    const out = new Map<number, number>()
    for (const p of projectiles) {
      live.add(p.id)
      const goal = goals.get(p.id) ?? 0
      const before = this.shown.get(p.id) ?? goal
      const next = Math.abs(goal - before) < 1e-3 ? goal : before + (goal - before) * slide
      this.shown.set(p.id, next)
      if (next !== 0) out.set(p.id, next)
    }
    for (const id of [...this.shown.keys()]) if (!live.has(id)) this.shown.delete(id)
    return out
  }

  clear(): void {
    this.shown.clear()
  }
}
