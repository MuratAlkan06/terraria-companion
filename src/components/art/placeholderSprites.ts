import type { PixelPalette } from '../PixelArt'
import { PixelCanvas } from './pixelCanvas'

/**
 * Placeholder item sprites (AMENDMENTS-001 A12: P2-S2 owns the placeholder set; ADR-001 D3
 * fallback mode). ORIGINAL 16x16 pixel art drawn here — not derived from any Re-Logic asset.
 * Shown when a record has no `sprite` (absent ⇒ placeholder, DATA_SCHEMA_SPEC §2.2) or when the
 * sprite manifest's `fallbackMode` is on. Deliberately muted stone silhouettes, so a placeholder
 * never passes for the real item art — and never for a specific in-game creature (B32). Rendered
 * by <SpritePlaceholder>.
 */
export type SpritePlaceholderVariant = 'melee' | 'ranged' | 'magic' | 'summon' | 'other' | 'unknown' | 'material' | 'creature'

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
  // whip: two-tone grip with a pommel and the lash coiled inward in an open spiral to its tip
  // (an open coil, not a closed loop — a ring on a handle reads as a magnifying glass)
  summon: draw((c) =>
    c
      .line(2, 13, 4, 11, 'h')
      .line(3, 13, 5, 11, 'w')
      .set(1, 14, 'g')
      .set(2, 14, 'g')
      .line(5, 10, 4, 8, 'B')
      .line(4, 7, 4, 5, 'B')
      .line(5, 4, 6, 3, 'B')
      .line(7, 2, 11, 2, 'B')
      .line(12, 3, 13, 4, 'B')
      .line(14, 5, 14, 8, 'B')
      .line(13, 9, 12, 10, 'B')
      .line(11, 10, 9, 10, 'B')
      .line(8, 9, 8, 7, 'B')
      .line(9, 6, 10, 6, 'B')
      .set(11, 7, 's')
      .set(8, 2, 'b')
      .set(9, 2, 'b')
      .set(4, 6, 'b')
      .set(14, 6, 'b'),
  ),
  // bomb with a lit fuse (classless explosives)
  other: draw((c) => c.rect(4, 7, 7, 6, 'B').rect(5, 6, 5, 8, 'B').set(6, 8, 'b').set(5, 9, 'b').line(9, 6, 11, 3, 'h').set(12, 2, 'g')),
  // question mark
  unknown: draw((c) => c.line(5, 4, 6, 3, 'b').line(7, 2, 9, 2, 'b').line(10, 3, 11, 4, 'b').line(11, 5, 9, 7, 'b').line(8, 8, 8, 9, 'b').rect(8, 11, 1, 2, 'b')),
  // generic item (recipe materials without a local sprite): a cloth pouch tied at the neck —
  // deliberately not the "?" so a known material never reads as an Unknown value
  material: draw((c) =>
    c
      .rect(5, 7, 7, 6, 'w')
      .rect(4, 8, 9, 4, 'w')
      .rect(6, 13, 5, 1, 'w')
      .line(6, 6, 10, 6, 'h')
      .rect(7, 4, 3, 2, 'w')
      .set(6, 3, 'w')
      .set(10, 3, 'w')
      .line(5, 8, 5, 11, 'h')
      .line(6, 12, 10, 12, 'h')
      .set(7, 8, 'b')
      .set(6, 9, 'b'),
  ),
  // creature (search rows for bosses/enemies without a local sprite, P2-S4): a paw print — the
  // generic "creature" mark, four toe pads over a main pad (AMENDMENTS-007 B32). Deliberately a
  // symbol, not a figure: no body, no face, nothing that could pass for a slime, zombie or any
  // other in-game creature (honesty rule, UX_SPEC §8).
  creature: draw((c) =>
    c
      .rect(1, 6, 3, 3, 'B')
      .set(1, 6, '.')
      .rect(4, 2, 3, 4, 'B')
      .set(4, 2, '.')
      .set(6, 2, '.')
      .rect(9, 2, 3, 4, 'B')
      .set(9, 2, '.')
      .set(11, 2, '.')
      .rect(12, 6, 3, 3, 'B')
      .set(14, 6, '.')
      .rect(6, 8, 4, 1, 'B')
      .rect(5, 9, 6, 1, 'B')
      .rect(4, 10, 8, 3, 'B')
      .rect(5, 13, 6, 1, 'B')
      .set(2, 7, 'b')
      .set(5, 3, 'b')
      .set(10, 3, 'b')
      .set(13, 7, 'b')
      .set(6, 9, 'b')
      .set(5, 10, 'b'),
  ),
}

/** Placeholder variant for a weapon: its damage class; unknown class ⇒ "unknown". */
export function placeholderVariantFor(damageClass: string | undefined): SpritePlaceholderVariant {
  return damageClass === 'melee' || damageClass === 'ranged' || damageClass === 'magic' || damageClass === 'summon' || damageClass === 'other' ? damageClass : 'unknown'
}
