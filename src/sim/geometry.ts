/**
 * Minimal 2-D geometry for hit detection. Pure functions over plain numbers (tiles).
 * Determinism note: only IEEE-exact ops plus Math.sin/cos/atan2/sqrt — bit-identical within one JS
 * engine; cross-engine transcendental differences are a documented limitation (README).
 */
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
  return { x: Math.cos(angle), y: Math.sin(angle) }
}

/** Angle of the vector from `from` to `to`; 0 (facing +x) when they coincide. */
export function angleTo(from: Vec2, to: Vec2): number {
  const dx = to.x - from.x
  const dy = to.y - from.y
  return dx === 0 && dy === 0 ? 0 : Math.atan2(dy, dx)
}

/** Squared distance from point to the AABB center (nearest-target ordering). */
export function distSqToCenter(x: number, y: number, box: Aabb): number {
  const c = aabbCenter(box)
  const dx = c.x - x
  const dy = c.y - y
  return dx * dx + dy * dy
}
