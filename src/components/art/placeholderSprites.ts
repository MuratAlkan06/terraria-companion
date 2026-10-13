import type { PixelPalette } from '../PixelArt'
import { PixelCanvas } from './pixelCanvas'

/**
 * Placeholder item sprites (AMENDMENTS-001 A12: P2-S2 owns the placeholder set; ADR-001 D3
 * fallback mode). ORIGINAL 16x16 pixel art drawn here — not derived from any Re-Logic asset.
 * Shown when a record has no `sprite` (absent ⇒ placeholder, DATA_SCHEMA_SPEC §2.2) or when the
 * sprite manifest's `fallbackMode` is on. Deliberately muted stone silhouettes, so a placeholder
 * never passes for the real item art. Rendered by <SpritePlaceholder>.
 */
export type SpritePlaceholderVariant = 'melee' | 'ranged' | 'magic' | 'summon' | 'other' | 'unknown'

export const PLACEHOLDER_PALETTE: PixelPalette = {
  k: 'var(--color-night-950)',
  b: 'var(--color-stone-300)',
  B: 'var(--color-stone-500)',
  g: 'var(--color-gold-500)',
  h: 'var(--color-earth-500)',
  w: 'var(--color-earth-400)',
  s: 'var(--color-stone-200)',
  m: 'var(--color-gold-300)',
}

const draw = (paint: (c: PixelCanvas) => PixelCanvas): readonly string[] => paint(new PixelCanvas(16, 16)).outline('k').rows()

export const PLACEHOLDER_ROWS: Record<SpritePlaceholderVariant, readonly string[]> = {
  // broadsword: two-tone blade, crossguard, grip, pommel
  melee: draw((c) =>
    c.line(13, 2, 5, 10, 'b').line(13, 3, 6, 10, 'B').line(12, 2, 5, 9, 'b').line(3, 8, 7, 12, 'g').line(4, 11, 2, 13, 'h').set(1, 14, 'g'),
  ),
  // bow with string and nocked arrow
  ranged: draw((c) =>
    c
      .line(5, 2, 8, 4, 'w')
      .line(8, 4, 10, 7, 'w')
      .line(10, 8, 8, 11, 'w')
      .line(8, 11, 5, 13, 'w')
      .line(5, 3, 5, 12, 's')
      .line(2, 8, 12, 8, 'B')
      .set(13, 8, 'b')
      .set(12, 7, 'b')
      .set(12, 9, 'b'),
  ),
  // staff topped with a gem
  magic: draw((c) => c.line(3, 13, 9, 7, 'w').line(4, 13, 10, 7, 'h').rect(10, 3, 3, 3, 'm').set(11, 2, 'm').set(13, 4, 'm').set(10, 3, 's')),
  // whip: grip and a curling lash
  summon: draw((c) => c.line(2, 13, 4, 11, 'h').line(3, 13, 5, 11, 'h').line(5, 10, 8, 6, 'B').line(8, 6, 12, 4, 'B').line(12, 4, 13, 7, 'B').line(13, 7, 11, 9, 'B')),
  // bomb with a lit fuse (classless explosives)
  other: draw((c) => c.rect(4, 7, 7, 6, 'B').rect(5, 6, 5, 8, 'B').set(6, 8, 'b').set(5, 9, 'b').line(9, 6, 11, 3, 'h').set(12, 2, 'g')),
  // question mark
  unknown: draw((c) => c.line(5, 4, 6, 3, 'b').line(7, 2, 9, 2, 'b').line(10, 3, 11, 4, 'b').line(11, 5, 9, 7, 'b').line(8, 8, 8, 9, 'b').rect(8, 11, 1, 2, 'b')),
}

/** Placeholder variant for a weapon: its damage class; unknown class ⇒ "unknown". */
export function placeholderVariantFor(damageClass: string | undefined): SpritePlaceholderVariant {
  return damageClass === 'melee' || damageClass === 'ranged' || damageClass === 'magic' || damageClass === 'summon' || damageClass === 'other' ? damageClass : 'unknown'
}
