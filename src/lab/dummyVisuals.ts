/**
 * How the arena draws the dummy roster v2 (PRD P3-S12) — pure helpers, Node-tested; the PixiJS layer
 * (./arena) only places what these return.
 *
 * - A Moving Dummy is drawn where the engine has it, interpolated between its last two ticks (`prevX/prevY`
 *   → `x/y` by `alpha`, like projectiles and summons), so it glides at any frame rate; a finished timed test
 *   shows it where the run ended.
 * - Its path is drawn once as a dashed track of art-pixel cells — along the ground under its feet (away and
 *   back) or up the column it rises through (up and back) — from home to the far end, in the modeled-value
 *   gold of the reach guides (the path length is a Lab choice).
 * - A dummy with defense (the Armored Dummy) wears armor (`buildDummy('armored')`) and its defense is
 *   labeled under its feet with a shield — the plain dummy never looks armored.
 */
import type { RenderState } from '../sim'
import { GAME_PX_PER_TILE } from './art/arenaArt'

type DummyView = RenderState['dummies'][number]

/** Where to draw a dummy's centre (tiles): interpolated prev → current; the current one once a test has finished. */
export function dummyCentre(d: Pick<DummyView, 'x' | 'y' | 'prevX' | 'prevY'>, alpha: number, finished: boolean): { x: number; y: number } {
  if (finished) return { x: d.x, y: d.y }
  return { x: d.prevX + (d.x - d.prevX) * alpha, y: d.prevY + (d.y - d.prevY) * alpha }
}

/** The dummy art to draw: armored for a dummy with defense, else the plain Infinite Dummy. */
export const dummyArt = (d: Pick<DummyView, 'defense'>): 'plain' | 'armored' => (d.defense > 0 ? 'armored' : 'plain')

/** Track dashes: this many cells drawn, then this many skipped (art px), like the reach guides. */
export const TRACK_DASH = 3
export const TRACK_GAP = 2

/**
 * A Moving Dummy's track (game px, top-left of each `px`-sized cell on the art-pixel grid): dashes from its
 * home to the far end of its path — one art pixel above the ground line its feet stand on (away and back),
 * or up the middle of the column its feet rise through (up and back). Empty for a dummy that never moves.
 */
export function dummyTrackCells(d: Pick<DummyView, 'height' | 'path'>, px: number): [number, number][] {
  const p = d.path
  if (!p) return []
  const snap = (v: number) => Math.round(v / px) * px
  const feet = d.height / 2
  const from = { x: p.fromX * GAME_PX_PER_TILE, y: (p.fromY + feet) * GAME_PX_PER_TILE - px }
  const to = { x: p.toX * GAME_PX_PER_TILE, y: (p.toY + feet) * GAME_PX_PER_TILE - px }
  const horizontal = p.fromY === p.toY
  const length = horizontal ? to.x - from.x : to.y - from.y
  const steps = Math.round(Math.abs(length) / px)
  const dir = Math.sign(length)
  const cells: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    if (i % (TRACK_DASH + TRACK_GAP) >= TRACK_DASH) continue
    cells.push(horizontal ? [snap(from.x + dir * i * px), snap(from.y)] : [snap(from.x - px / 2), snap(from.y + dir * i * px)])
  }
  return cells
}
