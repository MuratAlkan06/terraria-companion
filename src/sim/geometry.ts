/**
 * Minimal 2-D geometry for hit detection. Pure functions over plain numbers (tiles).
 * Determinism note (AMENDMENTS-016 B147): only IEEE-754 basic ops, Math.sqrt (correctly rounded by
 * IEEE-754) and the sim's own sin/cos/atan2 (./trig) — bit-identical on every platform and engine.
 */
import { atan2, cos, sin } from './trig'
import type { Vec2 } from './types'

export interface Aabb {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export const DEG_TO_RAD = Math.PI / 180

export function aabbFromCenter(x: number, y: number, width: number, height: number): Aabb {
  return { minX: x - width / 2, minY: y - height / 2, maxX: x + width / 2, maxY: y + height / 2 }
}

export function aabbCenter(box: Aabb): Vec2 {
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }
}

/**
 * Segment p0→p1 vs AABB (slab method). Returns the entry parameter t ∈ [0, 1] (0 when p0 starts
 * inside), or null when the segment misses. Degenerate (zero-length) segments test p0.
 */
export function segmentAabbEntry(x0: number, y0: number, x1: number, y1: number, box: Aabb): number | null {
  let tMin = 0
  let tMax = 1
  const dx = x1 - x0
  const dy = y1 - y0
  if (dx === 0) {
    if (x0 < box.minX || x0 > box.maxX) return null
  } else {
    let t1 = (box.minX - x0) / dx
    let t2 = (box.maxX - x0) / dx
    if (t1 > t2) [t1, t2] = [t2, t1]
    if (t1 > tMin) tMin = t1
    if (t2 < tMax) tMax = t2
    if (tMin > tMax) return null
  }
  if (dy === 0) {
    if (y0 < box.minY || y0 > box.maxY) return null
  } else {
    let t1 = (box.minY - y0) / dy
    let t2 = (box.maxY - y0) / dy
    if (t1 > t2) [t1, t2] = [t2, t1]
    if (t1 > tMin) tMin = t1
    if (t2 < tMax) tMax = t2
    if (tMin > tMax) return null
  }
  return tMin
}

export function length(x: number, y: number): number {
  return Math.sqrt(x * x + y * y)
}

/** Unit vector at `angle` radians. */
export function unit(angle: number): Vec2 {
  return { x: cos(angle), y: sin(angle) }
}

/** Angle of the vector from `from` to `to`; 0 (facing +x) when they coincide. */
export function angleTo(from: Vec2, to: Vec2): number {
  const dx = to.x - from.x
  const dy = to.y - from.y
  return dx === 0 && dy === 0 ? 0 : atan2(dy, dx)
}

/**
 * Distance (tiles) from `from` — inside `box` — along `angle` to where the ray leaves the box (0 when
 * `from` is outside or on its edge going out).
 */
export function rayExitDistance(from: Vec2, angle: number, box: Aabb): number {
  const dx = cos(angle)
  const dy = sin(angle)
  let t = Infinity
  if (dx > 0) t = Math.min(t, (box.maxX - from.x) / dx)
  else if (dx < 0) t = Math.min(t, (box.minX - from.x) / dx)
  if (dy > 0) t = Math.min(t, (box.maxY - from.y) / dy)
  else if (dy < 0) t = Math.min(t, (box.minY - from.y) / dy)
  return Number.isFinite(t) ? Math.max(0, t) : 0
}

/** The point of `box` nearest to (x, y) — the point itself when it is inside (blast reach, P3-S11). */
export function nearestPointInAabb(x: number, y: number, box: Aabb): Vec2 {
  return { x: Math.min(box.maxX, Math.max(box.minX, x)), y: Math.min(box.maxY, Math.max(box.minY, y)) }
}

/** Squared distance from point to the AABB center (nearest-target ordering). */
export function distSqToCenter(x: number, y: number, box: Aabb): number {
  const c = aabbCenter(box)
  const dx = c.x - x
  const dy = c.y - y
  return dx * dx + dy * dy
}
