/**
 * P3-S6 / P3-S7 render math (./thrownVisuals.ts, ../camera.ts `sceneXFor`): thrown weapons spin in
 * quarter turns, strings and chains and beams sit on the art-pixel grid, and a row of dummies widens
 * the scene framing only as far as it reaches past the arena's core.
 */
import { describe, expect, it } from 'vitest'
import manifest from '../../public/sprites/manifest.json'
import { dummyRow } from '../sim'
import { ARENA_CORE_X, GAME_PX_PER_ART_PX, GAME_PX_PER_TILE } from './art/arenaArt'
import { THRUST_HAND } from './blade'
import { fitCamera, sceneXFor } from './camera'
import { RANGED_TARGET_X_TILES } from './labSetup'
import { ALL_WEAPONS } from './testing/labData'
import { beamCells, dummySignature, handPoint, SPIN_TICKS_PER_QUARTER, spinRotation, tetherCells, tetherFor, thrownPosition, thrownScale, YOYO_SPRITE_SCALE } from './thrownVisuals'

const CELL = GAME_PX_PER_ART_PX
const onGrid = (cells: readonly (readonly [number, number])[]) => cells.every(([x, y]) => x % CELL === 0 && y % CELL === 0)

describe('thrown weapons (P3-S7)', () => {
  it('spin in quarter turns only (every pixel stays square), toward the facing', () => {
    const angles = Array.from({ length: 24 }, (_, t) => spinRotation(t, 1))
    for (const a of angles) expect(Number.isInteger(a / (Math.PI / 2))).toBe(true)
    expect(angles.slice(0, SPIN_TICKS_PER_QUARTER * 4 + 1).map((a) => Math.round(a / (Math.PI / 2)))).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 0])
    expect(spinRotation(3, -1)).toBe(-Math.PI / 2)
    expect(Object.is(spinRotation(0, -1), -0)).toBe(false)
  })

  it('a yoyo hangs on a string, a launched flail on a chain of links, a boomerang flies free', () => {
    expect([tetherFor('yoyo'), tetherFor('flail'), tetherFor('boomerang')]).toEqual(['string', 'chain', null])
    const from = handPoint(1)
    expect(from).toEqual({ x: THRUST_HAND.x, y: THRUST_HAND.y })
    expect(handPoint(-1).x).toBe(-THRUST_HAND.x)
    const to = { x: 120, y: -40 }
    const string = tetherCells('string', from, to, CELL)
    const chain = tetherCells('chain', from, to, CELL)
    expect(onGrid(string)).toBe(true)
    expect(string.length).toBeGreaterThan(20)
    // the chain is every other cell of the same line (its links), counted from the hand
    expect(chain).toEqual(string.filter((_, i) => i % 2 === 0))
    expect(tetherCells(null, from, to, CELL)).toEqual([])
  })

  it('is drawn at its in-game size: a boomerang or flail at native art scale, a yoyo at half its inventory icon', () => {
    expect([thrownScale('boomerang'), thrownScale('flail'), thrownScale('yoyo')]).toEqual([1, 1, YOYO_SPRITE_SCALE])
    expect(YOYO_SPRITE_SCALE).toBe(0.5)
    const spriteOf = new Map(manifest.files.map((f) => [f.path, f]))
    const returning = ALL_WEAPONS.filter((w) => w.labBehavior.kind === 'archetype' && w.labBehavior.params.archetype === 'returning')
    const yoyos = returning.filter((w) => w.labBehavior.kind === 'archetype' && w.labBehavior.params.archetype === 'returning' && w.labBehavior.params.variant === 'yoyo')
    expect(yoyos.length).toBeGreaterThan(5)
    const dummyWidthPx = 2 * GAME_PX_PER_TILE // the Infinite Dummy: 2 tiles wide
    for (const yoyo of yoyos) {
      const sprite = spriteOf.get(yoyo.sprite!)!
      const drawn = { width: sprite.width * YOYO_SPRITE_SCALE, height: sprite.height * YOYO_SPRITE_SCALE }
      // the in-game yoyo is a 16 × 16 px projectile: drawn no larger, and well under the dummy's width
      expect(Math.max(drawn.width, drawn.height), yoyo.name).toBeLessThanOrEqual(16)
      expect(drawn.width, yoyo.name).toBeLessThanOrEqual(dummyWidthPx / 2)
      // the icon's art pixels are 2 × 2 px blocks: at half scale each lands on exactly one game pixel
      expect(sprite.width % 2 === 0 && sprite.height % 2 === 0, yoyo.name).toBe(true)
    }
  })

  it('its drawn position interpolates the engine’s last two ticks', () => {
    const p = { id: 1, prevX: 2, prevY: 0, x: 3, y: -1, vx: 60, vy: -60 }
    expect(thrownPosition(p, 0)).toEqual({ x: 2, y: 0 })
    expect(thrownPosition(p, 0.5)).toEqual({ x: 2.5, y: -0.5 })
    expect(thrownPosition(p, 2)).toEqual({ x: 3, y: -1 })
  })
})

describe('held beam (P3-S6)', () => {
  it('a core line on the art-pixel grid with a glow cell either side across its axis, never overlapping', () => {
    const flat = beamCells({ x: 7, y: 5 }, 0, 160, CELL)
    expect(onGrid(flat.core) && onGrid(flat.glow)).toBe(true)
    expect(flat.core.length).toBeGreaterThanOrEqual(80)
    const core = new Set(flat.core.map(([x, y]) => `${x},${y}`))
    expect(flat.glow.some(([x, y]) => core.has(`${x},${y}`))).toBe(false)
    // a flat beam glows above and below
    expect(new Set(flat.glow.map(([, y]) => y))).toEqual(new Set([flat.core[0][1] - CELL, flat.core[0][1] + CELL]))
    const steep = beamCells({ x: 0, y: 0 }, Math.PI / 2, 64, CELL)
    expect(new Set(steep.glow.map(([x]) => x))).toEqual(new Set([-CELL, CELL]))
    expect(beamCells({ x: 0, y: 0 }, 0, 0, CELL)).toEqual({ core: [], glow: [] })
  })
})

describe('Multiple Dummies framing (P3-S6)', () => {
  it('a single dummy (melee or ranged) leaves the scene framing exactly as before', () => {
    expect(sceneXFor([{ x: 2, width: 2 }])).toEqual([...ARENA_CORE_X])
    expect(sceneXFor([{ x: RANGED_TARGET_X_TILES, width: 2 }])).toEqual([...ARENA_CORE_X])
  })

  it('a row past the core widens it to the far dummy plus room for its numbers — and the fit shows it all', () => {
    const row = dummyRow(5, RANGED_TARGET_X_TILES).map((d) => ({ x: d.x, width: 2 }))
    const [x0, x1] = sceneXFor(row)
    expect(x0).toBe(ARENA_CORE_X[0])
    expect(x1).toBe(row.at(-1)!.x + 1 + 1.5)
    const fit = fitCamera(860, 640, 1, { sceneX: [x0, x1] })
    const left = -fit.originX / fit.tilePx
    expect(left + fit.cssWidth / fit.tilePx).toBeGreaterThanOrEqual(x1 - 1e-9)
  })

  it('the arena rebuilds its dummy views whenever the engine’s row changes', () => {
    const one = dummySignature([{ id: 'dummy-0', x: 6, y: 0, width: 2, height: 3, defense: 0, debuffs: [], tag: null }])
    const two = dummySignature(dummyRow(2, 6).map((d) => ({ id: d.id as string, x: d.x, y: d.y, width: 2, height: 3, defense: 0, debuffs: [], tag: null })))
    expect(one).not.toBe(two)
    expect(two).toContain('dummy-1@9,0,2x3')
  })
})
