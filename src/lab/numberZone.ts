/**
 * Where the arena lets a dummy's damage numbers go (design review P3-S4/S5 M4) — pure math shared by
 * the renderer (./arena) and its tests, so both place numbers the same way:
 * - a horizontal band over the dummy plus NUMBER_BAND_PAD_TILES of air on either side: a number's
 *   anchor stays inside it, so a fast gun's numbers stack on the target instead of fanning back
 *   along the flight lane (the layout stacks them deeper instead — ../floatingNumbers.ts);
 * - damage over time (UX_SPEC §12 "DoT smaller cadence"): anchored just above the painted bullseye,
 *   which the layout keeps clear while any other spot near the dummy is free.
 */
import { dummyBullseye } from './art/arenaArt'
import { worldToScreen, type CameraFit } from './camera'
import type { FloatRect, FloatZone } from './floatingNumbers'

/**
 * Air (tiles) beside the dummy that a number's anchor may move into: little on the player's side
 * (where shots fly in), more behind the dummy (nothing there to cover).
 */
export const NUMBER_BAND_PAD_TILES = { towardPlayer: 0.5, beyond: 1.5 } as const

export interface DummyBox {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The zone for a number on `dummy` (CSS px): the band, and for damage over time the bullseye to
 * avoid. The player stands at the world origin (x = 0), so "toward the player" is the side facing 0.
 */
export function numberZone(fit: CameraFit, dummy: DummyBox, dot: boolean): FloatZone {
  const { towardPlayer, beyond } = NUMBER_BAND_PAD_TILES
  const [padLeft, padRight] = dummy.x >= 0 ? [towardPlayer, beyond] : [beyond, towardPlayer]
  const left = worldToScreen(fit, dummy.x - dummy.width / 2 - padLeft, dummy.y).x
  const right = worldToScreen(fit, dummy.x + dummy.width / 2 + padRight, dummy.y).x
  return { band: { left, right }, ...(dot ? { avoid: bullseyeRect(fit, dummy) } : {}) }
}

/** The painted bullseye's box on screen (CSS px). */
export function bullseyeRect(fit: CameraFit, dummy: DummyBox): FloatRect {
  const eye = dummyBullseye(dummy)
  const a = worldToScreen(fit, eye.x0, eye.y0)
  const b = worldToScreen(fit, eye.x1, eye.y1)
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }
}

/** Where a damage-over-time number rises from (world tiles): the dummy's centre line, just above the bullseye. */
export function dotAnchor(dummy: DummyBox): { x: number; y: number } {
  return { x: dummy.x, y: dummyBullseye(dummy).y0 }
}
