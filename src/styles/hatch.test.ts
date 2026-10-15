import { describe, expect, it } from 'vitest'
import css from './index.css?raw'
import tokens from './tokens.css?raw'

/**
 * The Unknown hatch (UX_SPEC §5.3; AMENDMENTS-015 B98): the Unknown text must stay >= 4.5:1 (WCAG AA) where it
 * crosses a hatch stripe, on every surface text sits on — read from the shipped CSS, so changing the stripe
 * strength or a token re-checks it.
 */
/** A token's hex value, following var(--…) references. */
function token(name: string): string {
  const m = new RegExp(`${name}:\\s*([^;]+);`).exec(tokens)
  if (!m) throw new Error(`token missing: ${name}`)
  const value = m[1].trim()
  const ref = /^var\((--[\w-]+)\)$/.exec(value)
  return ref ? token(ref[1]) : value
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const channel = (c: number) => {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
const luminance = (c: number[]) => 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2])
const contrast = (a: number[], b: number[]) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
/** `color-mix(in srgb, fg p%, transparent)` painted over `bg`. */
const over = (fg: number[], bg: number[], p: number) => fg.map((v, i) => v * p + bg[i] * (1 - p))

describe('the Unknown hatch keeps its text readable (B98)', () => {
  const stripe = /@utility bg-hatch-unknown[\s\S]*?color-mix\(in srgb, var\(--color-unknown\) (\d+)%, transparent\)/.exec(css)

  it('the stripe is a share of the Unknown colour, read from the utility', () => {
    expect(stripe).not.toBeNull()
  })

  for (const surface of ['--color-canvas', '--color-surface', '--color-panel', '--color-slot']) {
    it(`Unknown text crossing a stripe on ${surface} is >= 4.5:1`, () => {
      const share = Number(stripe![1]) / 100
      const text = rgb(token('--color-unknown'))
      const ground = rgb(token(surface))
      expect(contrast(text, over(text, ground, share))).toBeGreaterThanOrEqual(4.5)
      // and the stripe is still there to see (pattern, not colour alone)
      expect(contrast(over(text, ground, share), ground)).toBeGreaterThan(1.15)
    })
  }
})
