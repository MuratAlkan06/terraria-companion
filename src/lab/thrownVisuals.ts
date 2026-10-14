/**
 * Render math for what P3-S6 / P3-S7 weapons send out — pure, no PixiJS (the arena draws it; Node
 * tests check it). Everything lands on the arena's art-pixel grid (one art pixel = 2 game pixels,
 * like the projectiles and the thrust streak), so nothing is drawn at a pixel density of its own:
 *
 * - A returning weapon (boomerang, launched flail, yoyo) is the weapon's own sprite where the engine
 *   says it is, at the size it flies at in-game (`thrownScale`): a boomerang or flail at native art
 *   scale, a yoyo at half its inventory icon. Boomerangs and yoyos spin in QUARTER TURNS (a sprite
 *   turned by 90° keeps every pixel square); a flail head points along its chain. A yoyo hangs on a
 *   string — a one-art-pixel line from the hand — and a flail on a chain of alternating links; a
 *   boomerang flies free.
 * - A held beam (the engine's `blade.kind === 'beam'`) is a line of art pixels from the hand along the
 *   engine's beam, two cells thick across its axis (a bright core and a glow cell on each side).
 */
import type { RenderState } from '../sim'
import { streakCells, THRUST_HAND } from './blade'

/** Ticks per quarter turn of a spinning boomerang or yoyo (a full turn every 12 ticks: 5 per second). */
export const SPIN_TICKS_PER_QUARTER = 3

/** Rotation (radians, a multiple of π/2) of a spinning thrown weapon at sim time `t` (ticks); spins toward the facing. */
export function spinRotation(t: number, facing: 1 | -1): number {
  const quarters = Math.floor(Math.max(0, t) / SPIN_TICKS_PER_QUARTER) % 4
  return facing * quarters * (Math.PI / 2) + 0 // + 0: never -0
}

/** The front hand (game px from the player's centre), mirrored by facing — where strings and beams start. */
export function handPoint(facing: 1 | -1): { x: number; y: number } {
  return { x: facing * THRUST_HAND.x, y: THRUST_HAND.y }
}

/**
 * A yoyo's sprite scale. The Lab has each weapon's item art only. A boomerang flies as its item art
 * (the wiki shows the same file as its projectile, e.g. Wooden_Boomerang.png), so it is drawn at
 * native art scale. A yoyo's item art is its 30 × 26 px inventory icon, but the yoyo in flight is a
 * 16 × 16 px projectile (wiki file pages "Wooden Yoyo (projectile).png", "Amarok (projectile).png":
 * 16 × 16 pixels) — at native scale the icon covered most of the dummy (design review P3-S6/S7). Half
 * scale draws it 15 × 13 px, the in-game size, each of the icon's 2 × 2-pixel art pixels on exactly
 * one game pixel (uniform pixels; no art pixel dropped or doubled).
 */
export const YOYO_SPRITE_SCALE = 0.5

/** The drawn scale of a thrown weapon's sprite (1 = native art scale). */
export const thrownScale = (variant: 'boomerang' | 'flail' | 'yoyo'): number => (variant === 'yoyo' ? YOYO_SPRITE_SCALE : 1)

/** A returning projectile's drawn position (tiles): the render state's last two ticks, interpolated. */
export function thrownPosition(p: RenderState['projectiles'][number], alpha: number): { x: number; y: number } {
  const a = Math.min(1, Math.max(0, alpha))
  return { x: p.prevX + (p.x - p.prevX) * a, y: p.prevY + (p.y - p.prevY) * a }
}

export type TetherKind = 'string' | 'chain' | null

/** What ties a thrown weapon to the hand: a yoyo's string, a flail's chain, nothing for a boomerang. */
export const tetherFor = (variant: 'boomerang' | 'flail' | 'yoyo'): TetherKind => (variant === 'yoyo' ? 'string' : variant === 'flail' ? 'chain' : null)

/**
 * The tether's cells (top-left corners, game px) from the hand to the weapon: every cell of a string;
 * every other cell of a chain (its links), counted from the hand so the links don't crawl as it moves.
 */
export function tetherCells(kind: TetherKind, from: { x: number; y: number }, to: { x: number; y: number }, cell: number): [number, number][] {
  if (!kind) return []
  const cells = streakCells(from, to, cell)
  return kind === 'chain' ? cells.filter((_, i) => i % 2 === 0) : cells
}

export interface BeamCells {
  /** The bright line itself. */
  core: [number, number][]
  /** One cell either side of it, across its main axis. */
  glow: [number, number][]
}

/**
 * A held beam on the art-pixel grid: from `from` (game px) along `angle` for `lengthPx` game px. The
 * glow sits beside the core across the beam's main axis (above and below a flat beam, left and right of
 * a steep one), never on a core cell.
 */
export function beamCells(from: { x: number; y: number }, angle: number, lengthPx: number, cell: number): BeamCells {
  if (!(lengthPx > 0) || !(cell > 0)) return { core: [], glow: [] }
  const to = { x: from.x + Math.cos(angle) * lengthPx, y: from.y + Math.sin(angle) * lengthPx }
  const core = streakCells(from, to, cell)
  const flat = Math.abs(Math.cos(angle)) >= Math.abs(Math.sin(angle))
  const taken = new Set(core.map(([x, y]) => `${x},${y}`))
  const glow: [number, number][] = []
  for (const [x, y] of core) {
    for (const [gx, gy] of flat ? [[x, y - cell], [x, y + cell]] : [[x - cell, y], [x + cell, y]]) {
      const key = `${gx},${gy}`
      if (taken.has(key)) continue
      taken.add(key)
      glow.push([gx, gy])
    }
  }
  return { core, glow }
}

/** A stable key of the dummies the arena has built views for (rebuild when the engine's row changes). */
export const dummySignature = (dummies: RenderState['dummies']): string => dummies.map((d) => `${d.id}@${d.x},${d.y},${d.width}x${d.height}`).join('|')
