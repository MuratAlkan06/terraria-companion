import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSettingsStore } from '../app/settingsStore'
import type { SpriteIndex } from '../data-access/types'
import { placeholderVariantFor, type SpritePlaceholderVariant } from './art/placeholderSprites'
import { SpritePlaceholder } from './art/SpritePlaceholder'
import { cx } from './cx'
import { devicePixelOffset, spriteSize } from './spriteScale'
import { useReducedMotion } from './useReducedMotion'

/**
 * SpriteImg (UX_SPEC §3.1): wiki item sprite in a fixed square box (no layout shift),
 * `image-rendering: pixelated`, only ever whole-number scaled (integer up, 1/n down) and placed
 * on the device-pixel grid — see ./spriteScale.ts — lazy-loaded. Falls back to the
 * original placeholder art (A12) when the record has no sprite, the manifest doesn't list it,
 * the manifest is in fallbackMode (ADR D3 takedown lever), the user chose placeholder art
 * (settings.spriteFallback), or the image fails to load. Always decorative: the item name is
 * rendered next to it.
 *
 * Reduced motion (UX_SPEC §9): an animated sprite (GIF — most boss art) is drawn as a still
 * frame on a canvas instead of an <img>, since CSS cannot pause a GIF. Canvas drawing uses the
 * animation's default (first) frame per the HTML spec.
 */
export interface SpriteImgProps {
  /** Record `sprite` path, e.g. "/sprites/weapons/4956.png". */
  src: string | undefined
  sprites: SpriteIndex | null | undefined
  /** Damage class for the placeholder silhouette. */
  damageClass?: string
  /** Explicit placeholder silhouette (overrides the damage-class choice), e.g. "material". */
  placeholder?: SpritePlaceholderVariant
  /** Box edge in CSS px (the box is always square). */
  box: number
  className?: string
}

// Failed URLs are remembered so virtualized rows don't re-request a broken sprite on remount.
const failed = new Set<string>()

/** Sprite formats that can animate (drawn as a still frame under reduced motion). */
const ANIMATABLE = /\.gif$/i

/** Nudges the sprite onto the device-pixel grid (≤ half a pixel, via the `translate` property). */
function snapToDevicePixels(element: HTMLElement): void {
  element.style.translate = ''
  const rect = element.getBoundingClientRect()
  const { dx, dy } = devicePixelOffset(rect.left + window.scrollX, rect.top + window.scrollY, window.devicePixelRatio)
  if (dx !== 0 || dy !== 0) element.style.translate = `${dx}px ${dy}px`
}

export function SpriteImg({ src, sprites, damageClass, placeholder, box, className }: SpriteImgProps) {
  const userFallback = useSettingsStore((s) => s.settings.spriteFallback)
  const reducedMotion = useReducedMotion()
  const [broken, setBroken] = useState(() => (src ? failed.has(src) : false))
  const entry = src ? sprites?.byPath.get(src) : undefined
  const usable = entry && sprites && !sprites.fallbackMode && !userFallback && !broken
  const path = usable ? entry.path : undefined
  const still = path !== undefined && reducedMotion && ANIMATABLE.test(path)

  // Snap once laid out, and again when the viewport (or zoom / DPR) changes — never per frame.
  const imgRef = useRef<HTMLImageElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useLayoutEffect(() => {
    const element = imgRef.current ?? canvasRef.current
    if (!element) return
    const snap = () => snapToDevicePixels(element)
    snap()
    window.addEventListener('resize', snap)
    return () => window.removeEventListener('resize', snap)
  }, [path, box, still])

  // Reduced motion: paint the still frame once the image has loaded.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!still || path === undefined || !canvas) return
    let active = true
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      const context = active ? canvas.getContext('2d') : null
      if (!context) return
      context.imageSmoothingEnabled = false
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
    }
    image.onerror = () => {
      if (!active) return
      failed.add(path)
      setBroken(true)
    }
    image.src = path
    return () => {
      active = false
      image.onload = null
      image.onerror = null
    }
  }, [still, path])

  return (
    // No overflow clip: sprites always fit the box, and a clip edge at a half pixel would cut
    // into a snapped sprite's outer column.
    <span aria-hidden="true" className={cx('grid shrink-0 place-items-center', className)} style={{ width: box, height: box }}>
      {usable && still ? (
        <canvas
          ref={canvasRef}
          width={entry.width}
          height={entry.height}
          style={spriteSize(entry.width, entry.height, box)}
          className="pixelated max-w-none"
        />
      ) : usable ? (
        <img
          ref={imgRef}
          src={entry.path}
          alt=""
          style={spriteSize(entry.width, entry.height, box)}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="pixelated max-w-none"
          onError={() => {
            failed.add(entry.path)
            setBroken(true)
          }}
        />
      ) : (
        <SpritePlaceholder variant={placeholder ?? placeholderVariantFor(damageClass)} className="size-full" />
      )}
    </span>
  )
}
