import { PixelArt } from '../PixelArt'
import { PLACEHOLDER_PALETTE, PLACEHOLDER_ROWS, type SpritePlaceholderVariant } from './placeholderSprites'

/** Original placeholder sprite (see ./placeholderSprites.ts) for an item without a wiki sprite. */
export interface SpritePlaceholderProps {
  variant: SpritePlaceholderVariant
  /** Accessible name; omit when the item name is rendered next to it (decorative). */
  title?: string
  className?: string
}

export function SpritePlaceholder({ variant, title, className }: SpritePlaceholderProps) {
  return <PixelArt rows={PLACEHOLDER_ROWS[variant]} palette={PLACEHOLDER_PALETTE} title={title} className={className} />
}
