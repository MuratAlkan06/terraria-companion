import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSettingsStore } from '../app/settingsStore'
import type { SpriteEntry, SpriteIndex } from '../data-access/types'
import { placeholderVariantFor, type SpritePlaceholderVariant } from './art/placeholderSprites'
import { spriteFallback, type SpriteFallback } from './spriteFallback'
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
 * Thumbnails (AMENDMENTS-007 B30, -009 B42a): when the manifest lists a `thumbnail` for the
 * sprite (heavy files > 100 KB — the big boss GIFs), the still PNG thumbnail is drawn at its own
 * size instead of the full file; `full` opts out where the real animation matters (detail / boss
 * pages).
 *
 * Reduced motion (UX_SPEC §9): an animated sprite (GIF — most boss art) is drawn as a still
 * frame on a canvas instead of an <img>, since CSS cannot pause a GIF. Canvas drawing uses the
 * animation's default (first) frame per the HTML spec. A thumbnail is already a still PNG, so it
 * stays a plain <img>.
 *
 * Lazy manifest parts (AMENDMENTS-016 B104): a page loads only the sprite-manifest parts it knows it
 * needs; when `src` is in a part not loaded yet, the box shows the placeholder and asks the index to
 * load that part (`sprites.load`, once per session), then draws the sprite. A part that fails to load
 * leaves the placeholder — the safe direction for the D3 lever.
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
  /** Draw the full sprite file even when the manifest lists a thumbnail (detail / boss pages). */
  full?: boolean
  /** Largest whole-number upscale (see ./spriteScale); no cap when omitted. */
  maxScale?: number
  className?: string
  /**
   * Told whenever the box changes between the sprite and placeholder art, with why (AMENDMENTS-016 B113d:
   * a page can say so visibly — including a listed sprite whose file failed to load). Undefined: the
   * sprite is drawn, or its manifest part is still loading.
   */
  onFallback?: (reason: SpriteFallback | undefined) => void
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

export function SpriteImg({ src, sprites, damageClass, placeholder, box, full = false, maxScale, className, onFallback }: SpriteImgProps) {
  const userFallback = useSettingsStore((s) => s.settings.spriteFallback)
  const reducedMotion = useReducedMotion()
  // Re-render after a load failure; whether the drawn file is broken is read from `failed`.
  const [, setBroken] = useState<string>()
  const listed = src ? sprites?.byPath.get(src) : undefined
  // B104: the part listing `src` loaded after this render (or not listed anywhere → stays a placeholder)
  const [late, setLate] = useState<{ src: string; entry: SpriteEntry | undefined }>()
  const needsPart = src !== undefined && listed === undefined && sprites?.load !== undefined && !sprites.fallbackMode && !userFallback
  useEffect(() => {
    if (!needsPart || !sprites?.load) return
    let active = true
    sprites.load(src).then(
      (loaded) => {
        if (active) setLate({ src, entry: loaded })
      },
      (error: unknown) => {
        console.warn('[sprites] Manifest part unavailable; showing placeholder art.', error)
        // settled without an entry: the placeholder stays, and it is now a fallback ("unlisted"), not a wait
        if (active) setLate({ src, entry: undefined })
      },
    )
    return () => {
      active = false
    }
  }, [needsPart, sprites, src])
  const entry = listed ?? (late !== undefined && late.src === src ? late.entry : undefined)
  const enabled = entry && sprites && !sprites.fallbackMode && !userFallback
  // The file actually drawn: the still thumbnail when listed (B30), else the sprite itself.
  const drawn = enabled ? (full ? entry : (entry.thumbnail ?? entry)) : undefined
  const usable = drawn !== undefined && !failed.has(drawn.path)
  const path = usable ? drawn.path : undefined
  const still = path !== undefined && reducedMotion && ANIMATABLE.test(path)

  // B113d: tell the page why placeholder art shows (a part still loading isn't a fallback yet)
  const partPending = needsPart && (late === undefined || late.src !== src)
  const reason = spriteFallback({ src, sprites, userFallback, listed: entry !== undefined, loadingPart: partPending, failed: drawn !== undefined && !usable })
  useEffect(() => {
    onFallback?.(reason)
  }, [onFallback, reason])

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
  }, [path, box, maxScale, still])

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
      setBroken(path)
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
          width={drawn.width}
          height={drawn.height}
          style={spriteSize(drawn.width, drawn.height, box, maxScale)}
          className="pixelated max-w-none"
        />
      ) : usable ? (
        <img
          ref={imgRef}
          src={drawn.path}
          alt=""
          style={spriteSize(drawn.width, drawn.height, box, maxScale)}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="pixelated max-w-none"
          onError={() => {
            failed.add(drawn.path)
            setBroken(drawn.path)
          }}
        />
      ) : (
        <SpritePlaceholder variant={placeholder ?? placeholderVariantFor(damageClass)} className="size-full" />
      )}
    </span>
  )
}
