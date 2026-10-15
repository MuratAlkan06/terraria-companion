/**
 * Converts a character grid into one SVG path per palette entry (horizontal runs
 * merged), so even a large scene renders as a handful of DOM nodes.
 * '.' or ' ' = transparent.
 */
export type PixelPaletteEntry = string | { fill: string; className?: string }
export type PixelPalette = Readonly<Record<string, PixelPaletteEntry>>

export interface PixelLayer {
  key: string
  fill: string
  className?: string
  d: string
}

export function pixelLayers(rows: readonly string[], palette: PixelPalette): PixelLayer[] {
  const width = rows[0]?.length ?? 0
  const paths = new Map<string, string[]>()
  rows.forEach((row, y) => {
    if (row.length !== width) {
      throw new Error(`PixelArt: row ${y} has ${row.length} columns, expected ${width}`)
    }
    let x = 0
    while (x < row.length) {
      const ch = row[x]
      let run = 1
      while (x + run < row.length && row[x + run] === ch) run++
      if (ch !== '.' && ch !== ' ') {
        if (!(ch in palette)) throw new Error(`PixelArt: no palette entry for "${ch}"`)
        const list = paths.get(ch) ?? []
        list.push(`M${x} ${y}h${run}v1h-${run}z`)
        paths.set(ch, list)
      }
      x += run
    }
  })
  return [...paths.entries()].map(([ch, segments]) => {
    const entry = palette[ch]
    const { fill, className } = typeof entry === 'string' ? { fill: entry, className: undefined } : entry
    return { key: ch, fill, className, d: segments.join('') }
  })
}
