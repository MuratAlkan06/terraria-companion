/**
 * Swing visuals derived from the sim's render state (src/sim README "Render state"): the blade
 * pose is interpolated between the last two 60 Hz ticks with the frame's alpha, the weapon sprite
 * is oriented so its handle sits at the pivot and its tip lands exactly at the modeled reach, and
 * the trail / arc guide come from the weapon's own `arcDegrees` + `reachTiles`. Pure (no renderer).
 *
 * Sprite convention: swung weapon sprites are drawn diagonally, handle bottom-left, tip top-right
 * (the pipeline's reach = that diagonal × item scale, AMENDMENTS-010 B44). Facing left mirrors
 * the sprite, as the game does. A thrust's reach is unrelated to its sprite (often the wiki's
 * stated range, AMENDMENTS-012 B56), so a thrust draws its sprite at native scale instead
 * (`thrustVisual`, design review P3-S2/S3 H1).
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
  return orient(angle, facing, width, height, diagonal > 0 ? (reachTiles * GAME_PX_PER_TILE) / diagonal : 1)
}

function orient(angle: number, facing: 1 | -1, width: number, height: number, s: number): SpriteTransform {
  const tilt = Math.atan2(height, width)
  return facing === 1
    ? { rotation: angle + tilt, scaleX: s, scaleY: s }
    : { rotation: angle + Math.PI - tilt, scaleX: -s, scaleY: s }
}

/**
 * The player's front hand (game px from the player's centre, facing right): the skin pixel at the
 * end of the front sleeve in the arena's player art (../art/arenaArt.ts `buildPlayer`). Mirrored
 * when facing left. A thrust weapon is held here.
 */
export const THRUST_HAND = { x: 7, y: 5 } as const

/** At full extension the held weapon lunges forward by at most this share of its own length. */
export const THRUST_LUNGE = 0.25

export interface ThrustVisual {
  /** Native art scale: 1 game px per sprite px (|scale| = 1), like the arena's other sprites. */
  transform: SpriteTransform
  /** The sprite's handle (its anchor), game px from the player's centre. */
  handle: { x: number; y: number }
  /** The sprite's tip, game px from the player's centre. */
  tip: { x: number; y: number }
  /**
   * The rest of the modeled thrust past the weapon's tip, along the weapon's own axis (game px):
   * the extension the sprite can't show without implying a longer weapon. Null when the weapon
   * itself reaches the modeled extension.
   */
  pierce: { from: { x: number; y: number }; to: { x: number; y: number } } | null
}

/**
 * A thrust (engine `blade.kind === 'thrust'`, triangle extend/retract): the weapon sprite at its
 * native art scale, held at the front hand and pointed along the aim, lunging forward with the
 * extension — never behind the hand, its tip never past the modeled reach. Whatever reach is left
 * beyond the tip is returned as `pierce` for a light streak. Render-only: the hit test stays the
 * engine's line from the player's centre (`length` tiles along `angle`).
 */
export function thrustVisual(angle: number, length: number, reachTiles: number, facing: 1 | -1, width: number, height: number): ThrustVisual {
  const diagonal = Math.hypot(width, height)
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  const hand = { x: facing * THRUST_HAND.x, y: THRUST_HAND.y }
  // Distances measured along the aim from the player's centre, as the engine measures the thrust.
  const handAlong = hand.x * dx + hand.y * dy
  const reach = Math.max(0, reachTiles) * GAME_PX_PER_TILE
  const extension = Math.min(reach, Math.max(0, length * GAME_PX_PER_TILE))
  const fraction = reach > 0 ? extension / reach : 0
  const lunge = fraction * Math.min(THRUST_LUNGE * diagonal, Math.max(0, reach - handAlong - diagonal))
  const handle = { x: hand.x + dx * lunge, y: hand.y + dy * lunge }
  const tip = { x: handle.x + dx * diagonal, y: handle.y + dy * diagonal }
  const left = extension - (handAlong + lunge + diagonal)
  return {
    transform: orient(angle, facing, width, height, 1),
    handle,
    tip,
    pierce: left >= 1 ? { from: tip, to: { x: tip.x + dx * left, y: tip.y + dy * left } } : null,
  }
}

/**
 * How a projectile weapon is held (render-only choice from its sprite's shape): near-square sprites
 * — staffs, drawn diagonally like swords — point their diagonal at the aim; long sprites — guns
 * (wide) and bows (tall) — point their own +x axis at the aim, as the game draws them.
 */
export type HoldStyle = 'axis' | 'diagonal'

export function holdStyleFor(width: number, height: number): HoldStyle {
  const ratio = height > 0 ? width / height : 0
  return ratio >= 0.8 && ratio <= 1.25 ? 'diagonal' : 'axis'
}

export interface HeldWeaponVisual {
  /** Sprite anchor (fractions of its size): bottom-left (diagonal) or left-middle (axis). */
  anchor: { x: number; y: number }
  /** Where the anchor sits: the front hand (game px from the player's centre). */
  handle: { x: number; y: number }
  /** Native art scale (|scale| = 1). */
  transform: SpriteTransform
  /** The far end of the weapon along the aim (game px from the player's centre). */
  muzzle: { x: number; y: number }
}

/**
 * A bow, gun or staff held in the front hand, at native art scale, pointing along `angle` (the
 * launch direction, 0 = +x, y down). Axis-held sprites facing left are flipped vertically so they
 * stay upright; diagonal ones mirror like a sword. Render-only: shots come from the engine's
 * launch line (see ../projectiles.ts).
 */
export function heldWeaponVisual(angle: number, facing: 1 | -1, width: number, height: number, style: HoldStyle): HeldWeaponVisual {
  const handle = { x: facing * THRUST_HAND.x, y: THRUST_HAND.y }
  if (style === 'diagonal') {
    const transform = orient(angle, facing, width, height, 1)
    const tip = spriteTipOffset(transform, width, height)
    return { anchor: { x: 0, y: 1 }, handle, transform, muzzle: { x: handle.x + tip.x, y: handle.y + tip.y } }
  }
  return {
    anchor: { x: 0, y: 0.5 },
    handle,
    transform: { rotation: angle, scaleX: 1, scaleY: facing },
    muzzle: { x: handle.x + Math.cos(angle) * width, y: handle.y + Math.sin(angle) * width },
  }
}

/**
 * A straight streak on the art-pixel grid: the top-left corners (game px) of the `cell`-sized
 * squares from `from` to `to`, in order, never the same square twice in a row.
 */
export function streakCells(from: { x: number; y: number }, to: { x: number; y: number }, cell: number): [number, number][] {
  if (cell <= 0) return []
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / cell))
  const cells: [number, number][] = []
  let last = ''
  for (let i = 0; i <= steps; i++) {
    const x = Math.floor((from.x + ((to.x - from.x) * i) / steps) / cell) * cell
    const y = Math.floor((from.y + ((to.y - from.y) * i) / steps) / cell) * cell
    const key = `${x},${y}`
    if (key === last) continue
    last = key
    cells.push([x, y])
  }
  return cells
}

/** Where the sprite's tip ends up relative to the pivot (game px) — the inverse check of the above. */
export function spriteTipOffset(t: SpriteTransform, width: number, height: number): { x: number; y: number } {
  const lx = width * t.scaleX
  const ly = -height * t.scaleY
  const cos = Math.cos(t.rotation)
  const sin = Math.sin(t.rotation)
  return { x: lx * cos - ly * sin, y: lx * sin + ly * cos }
}
