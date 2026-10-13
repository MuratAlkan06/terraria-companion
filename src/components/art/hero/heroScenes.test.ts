import { describe, expect, it } from 'vitest'
import { pixelLayers } from '../pixelLayers'
import { HERO_ANIMATED_CHARS, HERO_PALETTE, S } from './heroPalette'
import {
  DEFAULT_HERO_SCENE,
  HERO_H,
  HERO_SCENES,
  HERO_TAGLINE_ZONES,
  HERO_TITLE_ZONES,
  HERO_W,
  type TextZone,
} from './heroScenes'
import { dither, hash2, mulberry32, noise1d, splitAnimated } from './sceneKit'

const scenes = Object.values(HERO_SCENES)

const SKY = new Set([S.n950, S.n900, S.n800, S.n700, S.n600])
/** Swatches only sky details use (terrain shares the other star tones). */
const SKY_DETAIL_ONLY = new Set([S.n200, S.white, S.twinkle, S.twinkleSlow])

/** Distance in CSS px between grid cell (x, y) and a zone at that zone's scale. */
function cellToZonePx(x: number, y: number, z: TextZone): number {
  const dx = Math.max(0, z.x0 - (x + 1), x - z.x1)
  const dy = Math.max(0, z.y0 - (y + 1), y - z.y1)
  return Math.hypot(dx, dy) * z.pxPerCell
}

/** Moon pixels: gold body/shade in the sky plus the white rim cells touching them. */
function moonCells(rows: readonly string[]): Array<[number, number]> {
  const gold = (x: number, y: number) => rows[y]?.[x] === S.g200 || rows[y]?.[x] === S.g300
  const cells: Array<[number, number]> = []
  for (let y = 0; y < 80; y++) {
    for (let x = 0; x < HERO_W; x++) {
      const rim = rows[y][x] === S.white && (gold(x - 1, y) || gold(x + 1, y) || gold(x, y - 1) || gold(x, y + 1))
      if (gold(x, y) || rim) cells.push([x, y])
    }
  }
  return cells
}

describe('hero scenes', () => {
  it('ships three variants and the default is one of them', () => {
    expect(scenes.map((s) => s.id).sort()).toEqual(['crystal-cavern', 'moonlit-forest', 'mountain-ridge'])
    expect(scenes).toContain(DEFAULT_HERO_SCENE)
  })

  describe.each(scenes)('$id', (scene) => {
    const data = scene.build()

    it(`fills the full ${HERO_W}x${HERO_H} grid with no transparent cells (PRD P1-S2 AC1: no blank areas)`, () => {
      expect(data.rows).toHaveLength(HERO_H)
      for (const row of data.rows) {
        expect(row).toHaveLength(HERO_W)
        expect(row).not.toMatch(/[. ]/)
      }
    })

    it('uses only palette characters, so it renders without errors', () => {
      const used = new Set(data.rows.join(''))
      for (const ch of used) expect(HERO_PALETTE).toHaveProperty(ch)
      expect(() => pixelLayers(data.rows, HERO_PALETTE)).not.toThrow()
    })

    it('is deterministic across builds', () => {
      expect(scene.build()).toEqual(data)
    })

    it('has visible scenery texture, not a few flat fills (design review M3)', () => {
      // At least 20 distinct swatches, and no single swatch covers more than 40% of the scene.
      const counts = new Map<string, number>()
      for (const ch of data.rows.join('')) counts.set(ch, (counts.get(ch) ?? 0) + 1)
      expect(counts.size).toBeGreaterThanOrEqual(20)
      expect(Math.max(...counts.values()) / (HERO_W * HERO_H)).toBeLessThan(0.4)
    })

    it('places glows inside the scene with sane strengths', () => {
      expect(data.glows.length).toBeGreaterThan(0)
      for (const glow of data.glows) {
        expect(glow.x).toBeGreaterThanOrEqual(0)
        expect(glow.x).toBeLessThan(HERO_W)
        expect(glow.y).toBeGreaterThanOrEqual(0)
        expect(glow.y).toBeLessThan(HERO_H)
        expect(glow.strength).toBeGreaterThan(0)
        expect(glow.strength).toBeLessThanOrEqual(1)
      }
    })

    it('includes the REQUIREMENTS §1 motifs: night sky, crystals and forest greens', () => {
      const all = data.rows.join('')
      expect(all).toContain(S.n950) // night sky
      expect(all).toContain(S.n200) // crystal light / stars
      expect(all).toContain(S.f600) // forest / grass
      expect(data.glows.some((g) => g.tone === 'crystal')).toBe(true)
    })

    it('keeps the SVG path payload bounded (render cost guard)', () => {
      const size = pixelLayers(data.rows, HERO_PALETTE).reduce((sum, layer) => sum + layer.d.length, 0)
      expect(size).toBeLessThan(600_000)
    })

    it('splits into an opaque static base and a small animated layer', () => {
      const { base, animated } = splitAnimated(data.rows, HERO_ANIMATED_CHARS)
      const baseCells = base.join('')
      const liveCells = animated.join('').replace(/\./g, '')
      expect(baseCells).not.toMatch(/[. ]/)
      for (const ch of HERO_ANIMATED_CHARS) expect(baseCells).not.toContain(ch)
      expect(liveCells.length).toBeGreaterThan(0)
      expect(liveCells.length).toBeLessThan(400)
    })

    it('keeps the moon >= 16px clear of the hero title and tagline at md and lg+ (design review H1)', () => {
      const moon = moonCells(data.rows)
      expect(moon.length).toBeGreaterThan(50)
      for (const zone of [...HERO_TITLE_ZONES, ...HERO_TAGLINE_ZONES]) {
        const nearest = Math.min(...moon.map(([x, y]) => cellToZonePx(x, y, zone)))
        expect(nearest).toBeGreaterThanOrEqual(16)
      }
    })

    it('keeps stars and sparkles out of the tagline zones (design review N5)', () => {
      const strays: string[] = []
      for (const z of HERO_TAGLINE_ZONES) {
        for (let y = Math.floor(z.y0) - 1; y < Math.ceil(z.y1) + 1; y++) {
          for (let x = Math.floor(z.x0) - 1; x < Math.ceil(z.x1) + 1; x++) {
            const ch = data.rows[y][x]
            if (SKY.has(ch)) continue
            let lone = true
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && !SKY.has(data.rows[y + dy][x + dx])) lone = false
            }
            if (SKY_DETAIL_ONLY.has(ch) || lone) strays.push(`${x},${y}`)
          }
        }
      }
      expect(strays).toEqual([])
    })
  })

  it('splitAnimated fills animated cells from the nearest static neighbour', () => {
    expect(splitAnimated(['ab*b', '**cd'], new Set(['*']))).toEqual({
      base: ['abbb', 'cccd'],
      animated: ['..*.', '**..'],
    })
  })

  it('variants are genuinely different compositions', () => {
    const grids = scenes.map((s) => s.build().rows.join(''))
    for (let i = 0; i < grids.length; i++) {
      for (let j = i + 1; j < grids.length; j++) {
        let same = 0
        for (let k = 0; k < grids[i].length; k++) if (grids[i][k] === grids[j][k]) same++
        expect(same / grids[i].length).toBeLessThan(0.6)
      }
    }
  })
})

describe('hero palette', () => {
  it('maps every swatch to a design token, never a literal colour', () => {
    for (const entry of Object.values(HERO_PALETTE)) {
      const fill = typeof entry === 'string' ? entry : entry.fill
      expect(fill).toMatch(/^var\(--color-[a-z]+(-\d+)?\)$/)
    }
  })

  it('assigns each swatch a unique single grid character', () => {
    const chars = Object.values(S)
    expect(new Set(chars).size).toBe(chars.length)
    for (const ch of chars) expect(ch).toMatch(/^[A-Za-z0-9]$/)
  })
})

describe('scene kit primitives', () => {
  it('mulberry32 is seeded and stays in [0, 1)', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const values = Array.from({ length: 200 }, () => a())
    expect(values).toEqual(Array.from({ length: 200 }, () => b()))
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
    expect(mulberry32(43)()).not.toBe(values[0])
  })

  it('dither coverage is exact over a 4x4 Bayer tile', () => {
    const covered = (t: number) => {
      let n = 0
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (dither(x, y, t)) n++
      return n
    }
    expect(covered(0)).toBe(0)
    expect(covered(0.25)).toBe(4)
    expect(covered(0.5)).toBe(8)
    expect(covered(1)).toBe(16)
    // Negative coordinates tile seamlessly.
    expect(dither(-4, -4, 0.5)).toBe(dither(0, 0, 0.5))
  })

  it('hash2 is stable and in [0, 1)', () => {
    expect(hash2(3, 7, 1)).toBe(hash2(3, 7, 1))
    expect(hash2(3, 7, 1)).not.toBe(hash2(3, 7, 2))
    for (let i = 0; i < 100; i++) {
      const v = hash2(i, i * 3, 5)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('noise1d returns a smooth profile of the requested length within [-1, 1]', () => {
    const profile = noise1d(mulberry32(7), 300, 40, 3)
    expect(profile).toHaveLength(300)
    for (let i = 0; i < profile.length; i++) {
      expect(Math.abs(profile[i])).toBeLessThanOrEqual(1)
      if (i > 0) expect(Math.abs(profile[i] - profile[i - 1])).toBeLessThan(0.5)
    }
  })
})
