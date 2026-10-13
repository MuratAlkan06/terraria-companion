import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import manifest from '../../public/sprites/manifest.json'
import { createDataAccess } from '../data-access'
import type { SpriteIndex } from '../data-access/types'
import type { SpriteManifestFile } from '../schemas/sprites'
import { SpriteImg, type SpriteImgProps } from './SpriteImg'
import { spriteSize } from './spriteScale'
import { useReducedMotion } from './useReducedMotion'

vi.mock('./useReducedMotion', () => ({ useReducedMotion: vi.fn(() => false) }))

let sprites: SpriteIndex
beforeAll(async () => {
  sprites = await createDataAccess({ validate: null, importers: { 'sprite-manifest': async () => manifest } }).loadSpriteIndex()
})

const files = manifest.files as SpriteManifestFile[]
const render = (src: string, props: Partial<SpriteImgProps> = {}) =>
  renderToStaticMarkup(createElement(SpriteImg, { src, sprites, box: 96, ...props }))

describe('SpriteImg under prefers-reduced-motion (UX_SPEC §9)', () => {
  // An animated GIF with no thumbnail: the full file is what rows and cards draw.
  const gif = files.find((f) => f.path.endsWith('.gif') && !f.thumbnail)!
  const png = files.find((f) => f.path.endsWith('.png'))!

  it('animated sprites (GIF) play as an <img> normally', () => {
    vi.mocked(useReducedMotion).mockReturnValue(false)
    const html = render(gif.path)
    expect(html).toContain(`<img src="${gif.path}"`)
    expect(html).not.toContain('<canvas')
  })

  it('with reduced motion, a GIF without a thumbnail becomes a still canvas frame at the same whole-number size', () => {
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

describe('SpriteImg thumbnails for heavy sprites (AMENDMENTS-007 B30, -009 B42a)', () => {
  const heavy = files.filter((f) => f.thumbnail)

  it('the manifest lists thumbnails for the heavy (> 100 KB) files', () => {
    expect(heavy.length).toBeGreaterThan(0)
    for (const f of heavy) expect(f.bytes, f.path).toBeGreaterThan(100_000)
  })

  it('rows and cards draw the still PNG thumbnail at its own dimensions, never the heavy file', () => {
    vi.mocked(useReducedMotion).mockReturnValue(false)
    for (const f of heavy) {
      const thumb = f.thumbnail!
      const html = render(f.path, { box: 152 })
      expect(html, f.path).toContain(`<img src="${thumb.path}"`)
      expect(html, f.path).not.toContain(f.path)
      // Sized from the thumbnail's own pixels (whole-number factor), not the full file's.
      const size = spriteSize(thumb.width, thumb.height, 152)
      expect(html, f.path).toContain(`style="width:${size.width}px;height:${size.height}px"`)
    }
  })

  it('with reduced motion a thumbnail is already still: a plain <img>, no canvas freeze', () => {
    vi.mocked(useReducedMotion).mockReturnValue(true)
    for (const f of heavy) {
      const html = render(f.path)
      expect(html, f.path).toContain(`<img src="${f.thumbnail!.path}"`)
      expect(html, f.path).not.toContain('<canvas')
    }
  })

  it('`full` opts out: the real (animated) file, frozen to a canvas under reduced motion', () => {
    const [f] = heavy
    vi.mocked(useReducedMotion).mockReturnValue(false)
    expect(render(f.path, { full: true })).toContain(`<img src="${f.path}"`)
    vi.mocked(useReducedMotion).mockReturnValue(true)
    const still = render(f.path, { full: true })
    expect(still).toContain(`<canvas width="${f.width}" height="${f.height}"`)
    expect(still).not.toContain(f.thumbnail!.path)
  })

  it('placeholder art still wins when the user chose it or the manifest is in fallback mode', () => {
    const [f] = heavy
    const html = renderToStaticMarkup(createElement(SpriteImg, { src: f.path, sprites: { ...sprites, fallbackMode: true }, box: 96 }))
    expect(html).not.toContain('<img')
    expect(html).not.toContain('/sprites/')
  })
})

describe('SpriteImg maxScale (featured-card 3× cap)', () => {
  // A small sprite that a 152px box would otherwise upscale past 3×.
  const small = files.find((f) => f.path.endsWith('.png') && Math.floor(152 / Math.max(f.width, f.height)) > 3)!

  it('caps the whole-number upscale', () => {
    vi.mocked(useReducedMotion).mockReturnValue(false)
    expect(render(small.path, { box: 152, maxScale: 3 })).toContain(`style="width:${small.width * 3}px;height:${small.height * 3}px"`)
    const uncapped = Math.floor(152 / Math.max(small.width, small.height))
    expect(render(small.path, { box: 152 })).toContain(`style="width:${small.width * uncapped}px;height:${small.height * uncapped}px"`)
  })
})
