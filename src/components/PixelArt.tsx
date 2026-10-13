import { useMemo, type ReactNode } from 'react'
import { pixelLayers, type PixelPalette } from './art/pixelLayers'
import { cx } from './cx'

export type { PixelPalette, PixelPaletteEntry } from './art/pixelLayers'

/**
 * Renders original pixel art from a character grid as crisp SVG.
 * Each row is a string; each character maps to a palette entry ('.' = transparent).
 * Colours should be design-token var()s.
 */
export interface PixelArtProps {
  rows: readonly string[]
  palette: PixelPalette
  /** Accessible name. Omit for decorative art (rendered aria-hidden). */
  title?: string
  className?: string
  /** Extra SVG nodes drawn beneath the pixels (e.g. a glow gradient), in grid units. */
  underlay?: ReactNode
}

export function PixelArt({ rows, palette, title, className, underlay }: PixelArtProps) {
  const layers = useMemo(() => pixelLayers(rows, palette), [rows, palette])
  const width = rows[0]?.length ?? 0
  const height = rows.length
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={cx('pixelated', className)}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {underlay}
      {layers.map((layer) => (
        <path key={layer.key} d={layer.d} className={layer.className} style={{ fill: layer.fill }} />
      ))}
    </svg>
  )
}
