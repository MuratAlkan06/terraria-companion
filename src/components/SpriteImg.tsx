import { useLayoutEffect, useRef, useState } from 'react'
import { useSettingsStore } from '../app/settingsStore'
import type { SpriteIndex } from '../data-access/types'
import { placeholderVariantFor, type SpritePlaceholderVariant } from './art/placeholderSprites'
import { SpritePlaceholder } from './art/SpritePlaceholder'
import { cx } from './cx'
import { devicePixelOffset, spriteSize } from './spriteScale'

/**
 * SpriteImg (UX_SPEC §3.1): wiki item sprite in a fixed square box (no layout shift),
 * `image-rendering: pixelated`, only ever whole-number scaled (integer up, 1/n down) and placed
 * on the device-pixel grid — see ./spriteScale.ts — lazy-loaded. Falls back to the
 * original placeholder art (A12) when the record has no sprite, the manifest doesn't list it,
 * the manifest is in fallbackMode (ADR D3 takedown lever), the user chose placeholder art
 * (settings.spriteFallback), or the image fails to load. Always decorative: the item name is
 * rendered next to it.
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

/** Nudges the image onto the device-pixel grid (≤ half a pixel, via the `translate` property). */
function snapToDevicePixels(img: HTMLImageElement): void {
  img.style.translate = ''
  const rect = img.getBoundingClientRect()
  const { dx, dy } = devicePixelOffset(rect.left + window.scrollX, rect.top + window.scrollY, window.devicePixelRatio)
  if (dx !== 0 || dy !== 0) img.style.translate = `${dx}px ${dy}px`
}

export function SpriteImg({ src, sprites, damageClass, placeholder, box, className }: SpriteImgProps) {
  const userFallback = useSettingsStore((s) => s.settings.spriteFallback)
  const [broken, setBroken] = useState(() => (src ? failed.has(src) : false))
  const entry = src ? sprites?.byPath.get(src) : undefined
  const usable = entry && sprites && !sprites.fallbackMode && !userFallback && !broken
  const path = usable ? entry.path : undefined

  // Snap once laid out, and again when the viewport (or zoom / DPR) changes — never per frame.
  const imgRef = useRef<HTMLImageElement>(null)
  useLayoutEffect(() => {
    const img = imgRef.current
    if (!img) return
    const snap = () => snapToDevicePixels(img)
    snap()
    window.addEventListener('resize', snap)
    return () => window.removeEventListener('resize', snap)
  }, [path, box])

  return (
    // No overflow clip: sprites always fit the box, and a clip edge at a half pixel would cut
    // into a snapped sprite's outer column.
    <span aria-hidden="true" className={cx('grid shrink-0 place-items-center', className)} style={{ width: box, height: box }}>
      {usable ? (
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
