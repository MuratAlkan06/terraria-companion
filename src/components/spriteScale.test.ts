import { describe, expect, it } from 'vitest'
import manifest from '../../public/sprites/manifest.json'
import { devicePixelOffset, spriteScale, spriteSize } from './spriteScale'

describe('whole-number sprite scaling (design review P2-S3 #4)', () => {
  it('upscales by the largest integer that fits', () => {
    expect(spriteScale(16, 16, 40)).toBe(2)
    expect(spriteScale(30, 28, 96)).toBe(3)
    expect(spriteScale(40, 20, 40)).toBe(1)
    expect(spriteScale(13, 7, 40)).toBe(3)
  })

  it('downscales only by 1/n, never by a fractional factor like 0.67', () => {
    expect(spriteScale(60, 60, 40)).toBe(1 / 2) // Adamantite Sword in a list row
    expect(spriteScale(56, 56, 40)).toBe(1 / 2) // Zenith
    expect(spriteScale(41, 10, 40)).toBe(1 / 2)
    expect(spriteScale(70, 70, 32)).toBe(1 / 3)
    expect(spriteSize(60, 60, 40)).toEqual({ width: 30, height: 30 })
  })

  it('device-pixel snap: moves a half-pixel position onto the grid, leaves whole pixels alone', () => {
    expect(devicePixelOffset(119.5, 815, 1)).toEqual({ dx: 0.5, dy: 0 })
    expect(devicePixelOffset(120, 815, 1)).toEqual({ dx: 0, dy: 0 })
    expect(devicePixelOffset(119.5, 815.25, 2)).toEqual({ dx: 0, dy: 0.25 }) // 2x: half CSS px is a device px
    const { dx } = devicePixelOffset(100.4, 0, 3)
    expect(Math.abs((100.4 + dx) * 3 - Math.round((100.4 + dx) * 3))).toBeLessThan(1e-9)
    expect(devicePixelOffset(10.5, 0, 0)).toEqual({ dx: 0.5, dy: 0 }) // bogus DPR → 1
  })

  it('degenerate sizes fall back to 1x', () => {
    expect(spriteScale(0, 0, 40)).toBe(1)
    expect(spriteScale(10, 10, 0)).toBe(1)
  })

  it('every shipped sprite gets an integer or 1/n factor and fits its box at every used box size', () => {
    for (const box of [32, 40, 96]) {
      for (const f of manifest.files) {
        const scale = spriteScale(f.width, f.height, box)
        const factor = scale >= 1 ? scale : 1 / scale
        expect(Math.abs(factor - Math.round(factor)), `${f.path} @${box}: ${scale}`).toBeLessThan(1e-9)
        const size = spriteSize(f.width, f.height, box)
        expect(Math.max(size.width, size.height), f.path).toBeLessThanOrEqual(box)
      }
    }
  })
})
