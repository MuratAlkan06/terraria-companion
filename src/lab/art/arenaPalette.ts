/**
 * Palette for the Weapon Lab arena art. Reuses the hero kit's token swatches (every colour is a
 * design token, `var(--color-*)`) and adds the two the arena needs that the hero doesn't: skin
 * light and the target ring red (`--color-destructive`, used as a fill only, as tokens.css rules).
 * Grid characters: the hero's for its swatches, punctuation for the extras.
 */
import { HERO_PALETTE, S } from '../../components/art/hero/heroPalette'

const EXTRA_TOKENS = {
  red: { ch: '!', token: 'destructive' },
  skin: { ch: '@', token: 'earth-300' },
} as const

type ExtraName = keyof typeof EXTRA_TOKENS

/** Swatch name → grid character (hero swatches + arena extras). */
export const A: Readonly<Record<keyof typeof S | ExtraName, string>> = {
  ...S,
  red: EXTRA_TOKENS.red.ch,
  skin: EXTRA_TOKENS.skin.ch,
}

/**
 * Grid character → CSS colour expression (a token var). The hero's animated swatches (twinkling
 * stars, fireflies) are drawn static here: the arena backdrop is one baked texture.
 */
export const ARENA_PALETTE: Readonly<Record<string, string>> = Object.freeze({
  ...Object.fromEntries(Object.entries(HERO_PALETTE).map(([ch, entry]) => [ch, typeof entry === 'string' ? entry : entry.fill])),
  ...Object.fromEntries(Object.values(EXTRA_TOKENS).map(({ ch, token }) => [ch, `var(--color-${token})`])),
})

/** `var(--color-x)` → `--color-x` (the custom property to read from :root). */
export function tokenProperty(expression: string): string | undefined {
  return /^var\((--[\w-]+)\)$/.exec(expression.trim())?.[1]
}
