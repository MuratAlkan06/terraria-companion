/* FilterBar's count wording (AMENDMENTS-016 B136): "Show 1 set", never "Show 1 sets" — for every noun a page passes. */
import { describe, expect, it } from 'vitest'
import { showResults, singularNoun } from './filterBarCopy'

/** Every FilterBar caller's `noun` (read from the sources, so a new caller's noun is checked too). */
const SOURCES = Object.values(import.meta.glob<string>('../app/**/*.tsx', { query: '?raw', import: 'default', eager: true }))
// `noun` is a required prop, so each <FilterBar …> has one (props may hold arrow functions: no [^>] stop)
const callers = SOURCES.flatMap((src) => [...src.matchAll(/<FilterBar\b[\s\S]*?\bnoun="([^"]+)"/g)].map((m) => m[1]))
const callerNouns = [...new Set(callers)].sort()

describe('FilterBar count wording', () => {
  it('the sheet button agrees in number', () => {
    expect(showResults(1, 'sets')).toBe('Show 1 set')
    expect(showResults(14, 'sets')).toBe('Show 14 sets')
    expect(showResults(0, 'sets')).toBe('Show 0 sets')
    expect(showResults(1, 'accessories')).toBe('Show 1 accessory')
    expect(showResults(5276, 'items')).toBe('Show 5,276 items')
  })

  it('every noun a page passes has its regular singular', () => {
    expect(callers).toHaveLength(SOURCES.reduce((n, src) => n + (src.match(/<FilterBar\b/g) ?? []).length, 0))
    expect(callerNouns).toEqual(['accessories', 'items', 'sets', 'weapons'])
    expect(callerNouns.map(singularNoun)).toEqual(['accessory', 'item', 'set', 'weapon'])
  })
})
