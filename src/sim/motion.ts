/**
 * Moving dummies (PRD P3-S12 AC2): a dummy with a `DummyMotion` glides back and forth along a straight
 * path from its home position at a constant speed, turning instantly at each end — a Lab test target
 * (approximation `dummy-motion`), not any enemy's movement AI.
 *
 * Determinism: the position is a CLOSED FORM of the world tick — distance travelled = speed × tick,
 * folded into the back-and-forth path — never integrated step by step, so it carries no accumulated
 * rounding and is identical however the ticks are batched (README "Determinism contract"). Only
 * IEEE-exact operations (×, ÷, %, −).
 */
import { TICKS_PER_SECOND } from './constants'
import type { DummyMotion, Vec2 } from './types'

/** Tiles from home along the path at world tick `tick`: 0 → `rangeTiles` → 0 → … (a triangle wave). */
export function dummyPathOffset(motion: Readonly<DummyMotion>, tick: number): number {
  const range = motion.rangeTiles
  const travelled = (motion.speedTps * tick) / TICKS_PER_SECOND
  const phase = travelled % (2 * range)
  return phase <= range ? phase : 2 * range - phase
}

/** The unit direction a motion travels from home: `horizontal` → +x (away from a player facing it), `vertical` → up (−y). */
export function dummyPathDirection(motion: Readonly<DummyMotion>): Vec2 {
  return motion.axis === 'horizontal' ? { x: 1, y: 0 } : { x: 0, y: -1 }
}

/** The dummy's centre `offset` tiles along its path from `home`. */
export function dummyPathPoint(home: Readonly<Vec2>, motion: Readonly<DummyMotion>, offset: number): Vec2 {
  const dir = dummyPathDirection(motion)
  return { x: home.x + dir.x * offset, y: home.y + dir.y * offset }
}
