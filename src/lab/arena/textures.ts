/**
 * Pixel-art grids → PixiJS textures. Colours are resolved from the design tokens at runtime (the
 * grids name `var(--color-*)` tokens, never literal colours), through a 1×1 canvas so any CSS
 * colour syntax the build emits reads back as exact RGBA bytes.
 */
import { Texture } from 'pixi.js'
import { tokenProperty } from '../art/arenaPalette'
import { topmostOpaque } from '../explosiveVisuals'

export type Rgba = readonly [number, number, number, number]

let probe: CanvasRenderingContext2D | null = null

/** Any CSS colour → RGBA bytes. */
export function cssColorToRgba(color: string): Rgba {
  probe ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!probe) return [255, 0, 255, 255]
  probe.clearRect(0, 0, 1, 1)
  probe.fillStyle = '#000'
  probe.fillStyle = color
  probe.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data
  return [r, g, b, a]
}

const tokenCache = new Map<string, Rgba>()

/** A token expression (`var(--color-x)`) or plain colour → RGBA, read from :root once. */
export function resolveColor(expression: string): Rgba {
  const cached = tokenCache.get(expression)
  if (cached) return cached
  const property = tokenProperty(expression)
  const value = property ? getComputedStyle(document.documentElement).getPropertyValue(property).trim() : expression
  const rgba = cssColorToRgba(value || expression)
  tokenCache.set(expression, rgba)
  return rgba
}

/** RGBA → 0xRRGGBB (Pixi colour). */
export const rgbHex = ([r, g, b]: Rgba): number => (r << 16) | (g << 8) | b

export function tokenHex(expression: string): number {
  return rgbHex(resolveColor(expression))
}

/** Character grid + palette (char → colour expression) → canvas, one pixel per cell. */
export function rowsToCanvas(rows: readonly string[], palette: Readonly<Record<string, string>>): HTMLCanvasElement {
  const width = rows[0]?.length ?? 0
  const height = rows.length
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, width)
  canvas.height = Math.max(1, height)
  const context = canvas.getContext('2d')
  if (!context || width === 0) return canvas
  const image = context.createImageData(width, height)
  const colors = new Map<string, Rgba | null>()
  for (let y = 0; y < height; y++) {
    const row = rows[y]
    for (let x = 0; x < width; x++) {
      const ch = row[x]
      let rgba = colors.get(ch)
      if (rgba === undefined) {
        rgba = ch === '.' || ch === ' ' || palette[ch] === undefined ? null : resolveColor(palette[ch])
        colors.set(ch, rgba)
      }
      if (!rgba) continue
      const i = (y * width + x) * 4
      image.data[i] = rgba[0]
      image.data[i + 1] = rgba[1]
      image.data[i + 2] = rgba[2]
      image.data[i + 3] = rgba[3]
    }
  }
  context.putImageData(image, 0, 0)
  return canvas
}

/** Nearest-filtered texture (TextureStyle default set by the arena) from a grid. Not cached. */
export function textureFromRows(rows: readonly string[], palette: Readonly<Record<string, string>>): Texture {
  return Texture.from(rowsToCanvas(rows, palette), true)
}

/** Soft round light (white centre → transparent), linear-filtered so it stays smooth when scaled. */
export function glowTexture(size = 64): Texture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (context) {
    const r = size / 2
    const gradient = context.createRadialGradient(r, r, 0, r, r, r)
    gradient.addColorStop(0, 'rgba(255,255,255,0.9)')
    gradient.addColorStop(0.35, 'rgba(255,255,255,0.35)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, size, size)
  }
  const texture = Texture.from(canvas, true)
  texture.source.scaleMode = 'linear'
  return texture
}

/**
 * A texture's topmost opaque pixel as an offset from its centre (../explosiveVisuals.ts `topmostOpaque`):
 * where a thrown explosive's fuse ends. Read from its image or canvas; null when it can't be read.
 */
export function textureTopPoint(texture: Texture): { x: number; y: number } | null {
  const resource = texture.source.resource as CanvasImageSource | undefined
  const { width, height } = texture.source
  if (!resource || !(width > 0) || !(height > 0)) return null
  try {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return null
    context.drawImage(resource, 0, 0, width, height)
    const data = context.getImageData(0, 0, width, height).data
    const alpha = new Uint8Array(width * height)
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3]
    return topmostOpaque(alpha, width, height)
  } catch {
    // an unreadable image (never expected: sprites are same-origin) — the caller falls back to the top centre
    return null
  }
}

/** Loads an image file as a texture (the weapon sprite); rejects on a load error. */
export function loadImageTexture(url: string): Promise<Texture> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(Texture.from(image, true))
    image.onerror = () => reject(new Error(`Could not load ${url}`))
    image.src = url
  })
}
