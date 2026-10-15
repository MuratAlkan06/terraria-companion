import { describe, expect, it } from 'vitest'
import tokens from './tokens.css?raw'

/**
 * Responsive variants must name a breakpoint the tokens define (AMENDMENTS-016 B127). tokens.css resets Tailwind's
 * breakpoints (`--breakpoint-*: initial`) and defines its own, so a Tailwind default name it doesn't define (`sm:`,
 * `2xl:`) generates no CSS at all — the class silently does nothing. This sweep reads every source file the app
 * ships (tests excluded: they may quote a bad class on purpose, as this one does).
 */
const SOURCES = import.meta.glob<string>(['../**/*.{ts,tsx,css}', '!../**/*.test.ts'], { query: '?raw', import: 'default', eager: true })

/** Breakpoint names the tokens define, e.g. ['xs', 'md', 'lg', 'xl']. */
const DEFINED = [...tokens.matchAll(/--breakpoint-([\w-]+):\s*[^;]*\d/g)].map((m) => m[1])
/** Tailwind's own breakpoint names, plus the project's `xs`: any of these the tokens don't define is dead. */
const CANDIDATES = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl']
const UNDEFINED = CANDIDATES.filter((name) => !DEFINED.includes(name))

/** `sm:` / `max-sm:` / `min-sm:` as a variant — not `@sm:` (container query), `text-sm` or "mechanism:". */
const variantPattern = (names: readonly string[]) => new RegExp(`(?<![\\w@-])(?:(?:max|min)-)?(?:${names.join('|')}):`, 'g')

describe('responsive variants use defined breakpoints (B127)', () => {
  it('the tokens define the UX_SPEC §7 breakpoints, and the sweep has names to look for', () => {
    expect(DEFINED).toEqual(['xs', 'md', 'lg', 'xl'])
    expect(UNDEFINED).toContain('sm')
  })

  it('the pattern catches the dead forms and leaves look-alikes alone', () => {
    const p = variantPattern(UNDEFINED)
    expect('flex-col sm:flex-row max-sm:hidden 2xl:gap-4'.match(p)).toEqual(['sm:', 'max-sm:', '2xl:'])
    expect('@sm:grid-cols-2 text-sm md:text-sm Determinism: lg:flex'.match(p)).toBeNull()
  })

  it('no shipped source file uses an undefined breakpoint', () => {
    const files = Object.keys(SOURCES)
    expect(files.length).toBeGreaterThan(100)
    // sanity: the scan reads real class strings (defined variants are found)
    expect(Object.values(SOURCES).some((src) => variantPattern(DEFINED).test(src))).toBe(true)
    const p = variantPattern(UNDEFINED)
    const offenders = files.flatMap((file) =>
      SOURCES[file].split('\n').flatMap((line, i) => (line.match(p) ? [`${file.replace(/^\.\.\//, 'src/')}:${i + 1}: ${line.match(p)?.join(' ')}`] : [])),
    )
    expect(offenders).toEqual([])
  })
})
