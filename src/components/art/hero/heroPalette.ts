/**
 * Palette for the procedural hero scenes. Every swatch is a design token
 * (var(--color-*)); scene code refers to swatches by name (`S.n950`) and this
 * module assigns each one a single grid character for <PixelArt>.
 */
import type { PixelPaletteEntry } from '../pixelLayers'

const STATIC_SWATCHES = {
  n950: 'night-950',
  n900: 'night-900',
  n800: 'night-800',
  n700: 'night-700',
  n600: 'night-600',
  n400: 'night-400',
  n200: 'night-200',
  f950: 'forest-950',
  f900: 'forest-900',
  f800: 'forest-800',
  f700: 'forest-700',
  f600: 'forest-600',
  f500: 'forest-500',
  f400: 'forest-400',
  f300: 'forest-300',
  e900: 'earth-900',
  e800: 'earth-800',
  e700: 'earth-700',
  e600: 'earth-600',
  e500: 'earth-500',
  e400: 'earth-400',
  s950: 'stone-950',
  s900: 'stone-900',
  s800: 'stone-800',
  s700: 'stone-700',
  s600: 'stone-600',
  s500: 'stone-500',
  s400: 'stone-400',
  s300: 'stone-300',
  s200: 'stone-200',
  g700: 'gold-700',
  g600: 'gold-600',
  g500: 'gold-500',
  g400: 'gold-400',
  g300: 'gold-300',
  g200: 'gold-200',
  white: 'white',
} as const

/** Animated swatches: stepped opacity loops, motion-safe only (UX_SPEC §9, §12). */
const ANIMATED_SWATCHES = {
  twinkle: { token: 'white', className: 'motion-safe:animate-twinkle' },
  twinkleSlow: { token: 'night-200', className: 'motion-safe:animate-twinkle-slow' },
  firefly: { token: 'gold-300', className: 'motion-safe:animate-flicker' },
  shimmer: { token: 'night-200', className: 'motion-safe:animate-twinkle-slow' },
} as const

export type SwatchName = keyof typeof STATIC_SWATCHES | keyof typeof ANIMATED_SWATCHES

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

function buildPalette() {
  const chars = {} as Record<SwatchName, string>
  const palette: Record<string, PixelPaletteEntry> = {}
  const animated = new Set<string>()
  let next = 0
  for (const [name, token] of Object.entries(STATIC_SWATCHES)) {
    const ch = CHARS[next++]
    chars[name as SwatchName] = ch
    palette[ch] = `var(--color-${token})`
  }
  for (const [name, { token, className }] of Object.entries(ANIMATED_SWATCHES)) {
    const ch = CHARS[next++]
    chars[name as SwatchName] = ch
    palette[ch] = { fill: `var(--color-${token})`, className }
    animated.add(ch)
  }
  return { chars: Object.freeze(chars), palette: Object.freeze(palette), animated: animated as ReadonlySet<string> }
}

const built = buildPalette()

/** Swatch name -> grid character. */
export const S: Readonly<Record<SwatchName, string>> = built.chars
/** Grid character -> token fill, for <PixelArt palette>. */
export const HERO_PALETTE: Readonly<Record<string, PixelPaletteEntry>> = built.palette
/** Grid characters whose swatch animates (rendered on a separate layer). */
export const HERO_ANIMATED_CHARS: ReadonlySet<string> = built.animated
