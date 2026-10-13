import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { pixelLayers } from './pixelLayers'
import { PLACEHOLDER_ROWS, placeholderVariantFor, type SpritePlaceholderVariant } from './placeholderSprites'
import { SpritePlaceholder } from './SpritePlaceholder'

describe('SpritePlaceholder (A12 placeholder set)', () => {
  const variants = Object.keys(PLACEHOLDER_ROWS) as SpritePlaceholderVariant[]

  it('has one distinct 16x16 original sprite per damage class plus "unknown"', () => {
    expect(variants.sort()).toEqual(['magic', 'melee', 'other', 'ranged', 'summon', 'unknown'])
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

  it('maps a weapon damage class to its variant; unknown class → "unknown"', () => {
    expect(['melee', 'ranged', 'magic', 'summon', 'other', undefined, 'weird'].map(placeholderVariantFor)).toEqual(['melee', 'ranged', 'magic', 'summon', 'other', 'unknown', 'unknown'])
  })
})
