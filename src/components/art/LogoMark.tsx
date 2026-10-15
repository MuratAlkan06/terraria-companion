import { PixelArt, type PixelPalette } from '../PixelArt'

/**
 * Logo mark — original 16x16 pixel art (a tree on a grass block under a guiding
 * star). Not derived from any Re-Logic asset (ADR D3: brand art is original).
 * public/favicon.svg is a static export of the same grid.
 */
const LOGO_ROWS = [
  '.............s..',
  '............sSs.',
  '.....kkkkk...s..',
  '...kkLLgggkk....',
  '..kLLggggggGk...',
  '.kLggggggggGGk..',
  '.kLgggggggGGGk..',
  '.kggggggggGGGk..',
  '..kgggggGGGGk...',
  '...kkGGGGGkk....',
  '.....kTtTk......',
  '.....kTtTk......',
  'mLmmmLmmmmLmmmLm',
  'dmddDddmddddDddm',
  'ddDdddddDddddDdd',
  'DddDdDDddDdDDdDD',
] as const

const LOGO_PALETTE: PixelPalette = {
  k: 'var(--color-night-950)',
  L: 'var(--color-forest-300)',
  g: 'var(--color-forest-400)',
  G: 'var(--color-forest-600)',
  m: 'var(--color-forest-500)',
  t: 'var(--color-earth-400)',
  T: 'var(--color-earth-600)',
  d: 'var(--color-earth-500)',
  D: 'var(--color-earth-700)',
  s: 'var(--color-gold-300)',
  S: 'var(--color-gold-500)',
}

export function LogoMark({ className, title }: { className?: string; title?: string }) {
  return <PixelArt rows={LOGO_ROWS} palette={LOGO_PALETTE} className={className} title={title} />
}
