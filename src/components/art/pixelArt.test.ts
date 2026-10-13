import { describe, expect, it } from 'vitest'
import { pixelLayers } from './pixelLayers'
import { PixelCanvas } from './pixelCanvas'

describe('pixelLayers', () => {
  it('merges horizontal runs into one path per palette entry', () => {
    const layers = pixelLayers(['aab', '.bb'], { a: 'red', b: { fill: 'blue', className: 'x' } })
    expect(layers).toEqual([
      { key: 'a', fill: 'red', className: undefined, d: 'M0 0h2v1h-2z' },
      { key: 'b', fill: 'blue', className: 'x', d: 'M2 0h1v1h-1zM1 1h2v1h-2z' },
    ])
  })

  it('rejects ragged rows and unknown palette characters', () => {
    expect(() => pixelLayers(['aa', 'a'], { a: 'red' })).toThrow(/row 1/)
    expect(() => pixelLayers(['az'], { a: 'red' })).toThrow(/"z"/)
  })
})

describe('PixelCanvas', () => {
  it('outlines filled regions on the 4-neighbourhood only', () => {
    const rows = new PixelCanvas(3, 3).set(1, 1, 'x').outline('k').rows()
    expect(rows).toEqual(['.k.', 'kxk', '.k.'])
  })

  it('draws inclusive lines and clips out-of-bounds pixels', () => {
    const rows = new PixelCanvas(3, 3).line(-1, -1, 2, 2, 'x').rows()
    expect(rows).toEqual(['x..', '.x.', '..x'])
  })

  it('stamps sprites skipping transparent cells', () => {
    const rows = new PixelCanvas(3, 2).rect(0, 0, 3, 2, 'a').stamp(1, 0, ['.b', 'b.']).rows()
    expect(rows).toEqual(['aab', 'aba'])
  })
})
