import { PixelArt, type PixelPalette } from '../PixelArt'
import { PixelCanvas } from './pixelCanvas'

/**
 * "Empty chest" vignette for designed empty states (UX_SPEC §5.2, AMENDMENTS-001 A12).
 * ORIGINAL 20x16 pixel art drawn here (open wooden chest, nothing inside, a moth flying off) —
 * not derived from any Re-Logic asset. Token colours only. Decorative (aria-hidden).
 */
const PALETTE: PixelPalette = {
  k: 'var(--color-night-950)',
  w: 'var(--color-earth-500)',
  h: 'var(--color-earth-700)',
  l: 'var(--color-earth-400)',
  g: 'var(--color-gold-500)',
  s: 'var(--color-stone-300)',
  m: 'var(--color-stone-400)',
}

const ROWS: readonly string[] = new PixelCanvas(20, 16)
  // lid, opened back
  .rect(3, 2, 14, 4, 'w')
  .rect(3, 2, 14, 1, 'g')
  .rect(9, 2, 2, 4, 'g')
  .rect(4, 4, 5, 1, 'l')
  .rect(11, 4, 5, 1, 'l')
  // empty, dark interior
  .rect(3, 6, 14, 2, 'k')
  // body
  .rect(2, 8, 16, 7, 'w')
  .rect(2, 8, 16, 1, 'g')
  .rect(2, 8, 1, 7, 'g')
  .rect(17, 8, 1, 7, 'g')
  .rect(3, 14, 14, 1, 'h')
  .rect(4, 10, 4, 1, 'l')
  .rect(12, 10, 4, 1, 'l')
  // lock plate + keyhole
  .rect(9, 9, 2, 3, 's')
  .set(9, 10, 'k')
  .outline('k')
  // a moth leaving the empty chest (drawn after the outline so it floats free)
  .set(16, 0, 'm')
  .set(18, 0, 'm')
  .set(17, 1, 's')
  .rows()

export function EmptyChest({ className }: { className?: string }) {
  return <PixelArt rows={ROWS} palette={PALETTE} className={className} />
}
