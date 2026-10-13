import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { pixelLayers } from './pixelLayers'
import { PLACEHOLDER_ROWS, placeholderVariantFor, type SpritePlaceholderVariant } from './placeholderSprites'
import { SpritePlaceholder } from './SpritePlaceholder'

describe('SpritePlaceholder (A12 placeholder set)', () => {
  const variants = Object.keys(PLACEHOLDER_ROWS) as SpritePlaceholderVariant[]

  it('has one distinct 16x16 original sprite per damage class plus "unknown", a generic "material" and "creature"', () => {
    expect(variants.sort()).toEqual(['creature', 'magic', 'material', 'melee', 'other', 'ranged', 'summon', 'unknown'])
    for (const v of variants) {
      const rows = PLACEHOLDER_ROWS[v]
      expect(rows).toHaveLength(16)
      for (const r of rows) expect(r).toHaveLength(16)
      expect(rows.join('').replaceAll('.', '').length, v).toBeGreaterThan(20)
    }
    expect(new Set(variants.map((v) => PLACEHOLDER_ROWS[v].join('\n'))).size).toBe(variants.length)
  })

  it('renders token-coloured SVG (no hard-coded colours) with an accessible name when titled', () => {
    const html = renderToStaticMarkup(createElement(SpritePlaceholder, { variant: 'melee', title: 'Zenith (placeholder)' }))
    expect(html).toContain('<title>Zenith (placeholder)</title>')
    expect(html).toMatch(/fill:var\(--color-/)
    expect(html).not.toMatch(/fill(?::|=")#/)
    for (const v of variants) expect(() => pixelLayers(PLACEHOLDER_ROWS[v], { k: 'a', b: 'a', B: 'a', g: 'a', h: 'a', w: 'a', s: 'a', m: 'a' })).not.toThrow()
  })

  it('"creature" is a generic paw-print mark, not a creature figure (AMENDMENTS-007 B32)', () => {
    const rows = PLACEHOLDER_ROWS.creature
    const at = (x: number, y: number) => rows[y]?.[x] ?? '.'
    const isFill = (x: number, y: number) => !['.', 'k'].includes(at(x, y))
    // Separate filled regions (4-connected): four toe pads + one main pad. A body-shaped figure
    // (the old slime blob, any enemy silhouette) is a single region.
    const flood = (seeds: number[][], passable: (x: number, y: number) => boolean, seen: Set<string>) => {
      const stack = [...seeds]
      while (stack.length > 0) {
        const [x, y] = stack.pop()!
        if (x < 0 || y < 0 || x > 15 || y > 15 || !passable(x, y) || seen.has(`${x},${y}`)) continue
        seen.add(`${x},${y}`)
        stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1])
      }
    }
    const filled = new Set<string>()
    let regions = 0
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        if (!isFill(x, y) || filled.has(`${x},${y}`)) continue
        regions++
        flood([[x, y]], isFill, filled)
      }
    }
    expect(regions).toBe(5)
    // Featureless: every dark cell is reachable from the edge without crossing a pad, i.e. it is
    // outline or a gap between pads — never enclosed by fill (eyes, mouth, any face).
    const outside = new Set<string>()
    const edge = Array.from({ length: 16 }, (_, i) => [[i, 0], [i, 15], [0, i], [15, i]]).flat()
    flood(edge, (x, y) => !isFill(x, y), outside)
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        if (at(x, y) === 'k') expect(outside.has(`${x},${y}`), `enclosed dark cell at ${x},${y}`).toBe(true)
      }
    }
    // Neutral stone only (no coloured features that could read as a specific creature).
    expect(new Set(rows.join('').replaceAll('.', ''))).toEqual(new Set(['k', 'B', 'b']))
  })

  it('maps a weapon damage class to its variant; unknown class → "unknown"', () => {
    expect(['melee', 'ranged', 'magic', 'summon', 'other', undefined, 'weird'].map(placeholderVariantFor)).toEqual(['melee', 'ranged', 'magic', 'summon', 'other', 'unknown', 'unknown'])
  })
})
