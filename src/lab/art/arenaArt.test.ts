/**
 * Original arena art (AMENDMENTS-001 A12): deterministic grids, sized to the sim's world, drawn
 * only in design-token colours (no literal colours, ADR D4 tokens).
 */
import { describe, expect, it } from 'vitest'
import type { Weapon } from '../../data-access/types'
import weaponsJson from '../../data/weapons.detail.json'
import { createLabSim } from '../../sim'
import { labWeapons } from '../labWeapons'
import {
  ART_PX_PER_TILE,
  ARENA_CORE_X,
  ARENA_LAYOUT,
  ARENA_SET_PIECES,
  BACKDROP_H,
  BACKDROP_W,
  buildArenaBackdrop,
  buildDeepTile,
  buildDummy,
  buildPlayer,
  DEEP_TILE_H,
  DEEP_TILE_W,
  silhouette,
} from './arenaArt'
import { A, ARENA_PALETTE, tokenProperty } from './arenaPalette'

const grids = { backdrop: buildArenaBackdrop(), dummy: buildDummy(), player: buildPlayer(), deep: buildDeepTile() }

describe('arena art', () => {
  it('is deterministic (identical on every load)', () => {
    expect(buildArenaBackdrop()).toEqual(grids.backdrop)
    expect(buildDummy()).toEqual(grids.dummy)
    expect(buildPlayer()).toEqual(grids.player)
    expect(buildDeepTile()).toEqual(grids.deep)
  })

  it('the rock below the backdrop is textured stone, never a flat slab (design review M2)', () => {
    expect(grids.deep).toHaveLength(DEEP_TILE_H)
    expect(grids.deep[0]).toHaveLength(DEEP_TILE_W)
    const counts = new Map<string, number>()
    for (const ch of grids.deep.join('')) counts.set(ch, (counts.get(ch) ?? 0) + 1)
    const total = DEEP_TILE_W * DEEP_TILE_H
    // The strata's stone colours, none of them dominating: speckle, dither and seams all read.
    for (const ch of [A.s800, A.s900, A.s700]) expect(counts.get(ch) ?? 0, ch).toBeGreaterThan(total * 0.03)
    expect(Math.max(...counts.values())).toBeLessThan(total * 0.8)
    // It continues the stone band the backdrop ends on (same base colour on its last row).
    expect(grids.backdrop.at(-1)).toContain(A.s800)
  })

  it('set pieces: every platform lies inside the core span the camera keeps whole', () => {
    for (const p of ARENA_LAYOUT.platforms) {
      expect(p.x0).toBeGreaterThan(ARENA_CORE_X[0])
      expect(p.x1).toBeLessThan(ARENA_CORE_X[1])
    }
    expect(ARENA_SET_PIECES).toHaveLength(ARENA_LAYOUT.platforms.length + ARENA_LAYOUT.trees.length)
    for (const [a, b] of ARENA_SET_PIECES) expect(b).toBeGreaterThan(a)
  })

  it('grids are rectangular; the backdrop covers its declared world area', () => {
    for (const [name, rows] of Object.entries(grids)) {
      expect(rows.length, name).toBeGreaterThan(0)
      for (const row of rows) expect(row.length, name).toBe(rows[0].length)
    }
    expect(grids.backdrop).toHaveLength(BACKDROP_H)
    expect(grids.backdrop[0]).toHaveLength(BACKDROP_W)
  })

  it('the Infinite Dummy sprite is exactly the sim’s dummy hitbox (2 × 3 tiles), standing on the ground line', () => {
    const created = createLabSim({ weapon: labWeapons(weaponsJson as Weapon[])[0] })
    if (!created.ok) throw new Error('refused')
    const dummy = created.sim.renderState().dummies[0]
    expect(grids.dummy[0].length).toBe(dummy.width * ART_PX_PER_TILE)
    expect(grids.dummy.length).toBe(dummy.height * ART_PX_PER_TILE)
    expect(dummy.y + dummy.height / 2).toBe(ARENA_LAYOUT.groundY)
  })

  it('every pixel colour is a design-token reference (var(--color-*)), never a literal colour', () => {
    const used = new Set(Object.values(grids).flatMap((rows) => [...rows.join('')]))
    used.delete('.')
    for (const ch of used) {
      const expression = ARENA_PALETTE[ch]
      expect(expression, `grid char "${ch}"`).toBeDefined()
      expect(tokenProperty(expression), expression).toMatch(/^--color-[a-z]+(-\d+)?$/)
    }
  })

  it('the hit-flash silhouette keeps the sprite’s exact shape', () => {
    const flash = silhouette(grids.dummy, 'X')
    flash.forEach((row, y) => [...row].forEach((ch, x) => expect(ch === '.').toBe(grids.dummy[y][x] === '.')))
  })
})
