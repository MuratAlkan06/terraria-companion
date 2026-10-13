/**
 * Swing visuals derived from the sim's render state (src/sim README "Render state"): the blade
 * pose is interpolated between the last two 60 Hz ticks with the frame's alpha, the weapon sprite
 * is oriented so its handle sits at the pivot and its tip lands exactly at the modeled reach, and
 * the trail / arc guide come from the weapon's own `arcDegrees` + `reachTiles`. Pure (no renderer).
 *
 * Sprite convention: swung weapon sprites are drawn diagonally, handle bottom-left, tip top-right
 * (the pipeline's reach = that diagonal × item scale, AMENDMENTS-010 B44). Facing left mirrors
 * the sprite, as the game does.
 */
import type { BladePose } from '../sim'
import { GAME_PX_PER_TILE } from './art/arenaArt'

export const DEG = Math.PI / 180

/** Linear interpolation of the blade between the previous and current tick. */
export function interpolateBlade(blade: BladePose, alpha: number): { angle: number; length: number } {
  const a = Math.min(1, Math.max(0, alpha))
  return {
    angle: blade.prevAngle + (blade.angle - blade.prevAngle) * a,
    length: blade.prevLength + (blade.length - blade.prevLength) * a,
  }
}

/**
 * Angle where a swing starts for a facing — mirrors the swing-melee interpreter: facing right the
 * blade sweeps from −arc/2 (up-front) to +arc/2 (down-front); facing left it mirrors through π.
 */
export function swingStartAngle(facing: 1 | -1, arcDegrees: number): number {
  const center = facing === 1 ? 0 : Math.PI
  return center - (facing * arcDegrees * DEG) / 2
}

export function swingEndAngle(facing: 1 | -1, arcDegrees: number): number {
  return swingStartAngle(facing, arcDegrees) + facing * arcDegrees * DEG
}

/**
 * The trail behind the blade: from at most `maxTrailRad` back along the swing (never before the
 * swing's start) to the blade's current angle. Returned as [from, to] in sweep order.
 */
export function trailSpan(current: number, facing: 1 | -1, arcDegrees: number, maxTrailRad: number): [number, number] {
  const start = swingStartAngle(facing, arcDegrees)
  const from = facing === 1 ? Math.max(start, current - maxTrailRad) : Math.min(start, current + maxTrailRad)
  return [from, current]
}

/**
 * The reach guide's dashed arc on the art-pixel grid: the top-left corners (game px, relative to the
 * pivot) of the `cell`-sized squares along the swing's full arc at `radius` game px — on for `dash`
 * cells of arc length, off for `gap`, never the same square twice in a row.
 */
export function guideCells(facing: 1 | -1, arcDegrees: number, radius: number, cell: number, dash: number, gap: number): [number, number][] {
  if (radius <= 0 || cell <= 0) return []
  const start = swingStartAngle(facing, arcDegrees)
  const end = swingEndAngle(facing, arcDegrees)
  const steps = Math.max(8, Math.ceil((Math.abs(end - start) * radius) / cell))
  const cells: [number, number][] = []
  let last = ''
  for (let i = 0; i <= steps; i++) {
    if (i % (dash + gap) >= dash) continue
    const a = start + ((end - start) * i) / steps
    const x = Math.floor((Math.cos(a) * radius) / cell) * cell
    const y = Math.floor((Math.sin(a) * radius) / cell) * cell
    const key = `${x},${y}`
    if (key === last) continue
    last = key
    cells.push([x, y])
  }
  return cells
}

export interface SpriteTransform {
  /** Radians, applied about the anchor (the sprite's bottom-left corner = handle). */
  rotation: number
  scaleX: number
  scaleY: number
}

/**
 * Orientation + scale for a weapon sprite (width × height px) whose handle sits at the pivot and
 * whose diagonal tip points along `angle`, `reachTiles` away (game px units: 16 per tile).
 */
export function bladeSpriteTransform(angle: number, facing: 1 | -1, width: number, height: number, reachTiles: number): SpriteTransform {
  const diagonal = Math.hypot(width, height)
  const s = diagonal > 0 ? (reachTiles * GAME_PX_PER_TILE) / diagonal : 1
  const tilt = Math.atan2(height, width)
  return facing === 1
    ? { rotation: angle + tilt, scaleX: s, scaleY: s }
    : { rotation: angle + Math.PI - tilt, scaleX: -s, scaleY: s }
}

/** Where the sprite's tip ends up relative to the pivot (game px) — the inverse check of the above. */
export function spriteTipOffset(t: SpriteTransform, width: number, height: number): { x: number; y: number } {
  const lx = width * t.scaleX
  const ly = -height * t.scaleY
  const cos = Math.cos(t.rotation)
  const sin = Math.sin(t.rotation)
  return { x: lx * cos - ly * sin, y: lx * sin + ly * cos }
}
