import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import manifest from '../../public/sprites/manifest.json'
import { createDataAccess } from '../data-access'
import type { SpriteIndex } from '../data-access/types'
import { SpriteImg } from './SpriteImg'
import { useReducedMotion } from './useReducedMotion'

vi.mock('./useReducedMotion', () => ({ useReducedMotion: vi.fn(() => false) }))

let sprites: SpriteIndex
beforeAll(async () => {
  sprites = await createDataAccess({ validate: null, importers: { 'sprite-manifest': async () => manifest } }).loadSpriteIndex()
})

const render = (src: string) => renderToStaticMarkup(createElement(SpriteImg, { src, sprites, box: 96 }))

describe('SpriteImg under prefers-reduced-motion (UX_SPEC §9)', () => {
  const gif = manifest.files.find((f) => f.path.endsWith('.gif'))!
  const png = manifest.files.find((f) => f.path.endsWith('.png'))!

  it('animated sprites (GIF) play as an <img> normally', () => {
    vi.mocked(useReducedMotion).mockReturnValue(false)
    const html = render(gif.path)
    expect(html).toContain(`<img src="${gif.path}"`)
    expect(html).not.toContain('<canvas')
  })

  it('with reduced motion, a GIF becomes a still canvas frame at the same whole-number size', () => {
    vi.mocked(useReducedMotion).mockReturnValue(true)
    const html = render(gif.path)
    expect(html).not.toContain('<img')
    expect(html).toContain(`<canvas width="${gif.width}" height="${gif.height}"`)
    expect(html).toContain('pixelated')
  })

  it('static sprites are unaffected by reduced motion', () => {
    vi.mocked(useReducedMotion).mockReturnValue(true)
    expect(render(png.path)).toContain(`<img src="${png.path}"`)
  })
})
