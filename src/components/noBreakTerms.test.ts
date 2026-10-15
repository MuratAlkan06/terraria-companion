import { describe, expect, it } from 'vitest'
import { SITE } from '../app/site'
import { NO_BREAK_TERMS, splitNoBreakTerms } from './noBreakTerms'

describe('splitNoBreakTerms (design review N3)', () => {
  it('protects "Re-Logic" and the licence name inside the ADR D3 attribution, losslessly', () => {
    const segments = splitNoBreakTerms(SITE.attribution)
    expect(segments.map((s) => s.text).join('')).toBe(SITE.attribution)
    expect(segments.filter((s) => s.keep).map((s) => s.text)).toEqual(['CC BY-NC-SA 4.0', 'Re-Logic'])
  })

  it('keeps the text verbatim (no non-breaking-hyphen substitution)', () => {
    const joined = splitNoBreakTerms('© Re-Logic').map((s) => s.text).join('')
    expect(joined).toBe('© Re-Logic')
    expect(joined).not.toContain('‑')
  })

  it('handles repeated terms, terms at the edges and text without terms', () => {
    expect(splitNoBreakTerms('Re-Logic and Re-Logic')).toEqual([
      { text: 'Re-Logic', keep: true },
      { text: ' and ', keep: false },
      { text: 'Re-Logic', keep: true },
    ])
    expect(splitNoBreakTerms('nothing here')).toEqual([{ text: 'nothing here', keep: false }])
    expect(splitNoBreakTerms('')).toEqual([])
  })

  it('prefers the longest overlapping term and escapes regex characters', () => {
    expect(splitNoBreakTerms('a.b a.b.c', ['a.b', 'a.b.c'])).toEqual([
      { text: 'a.b', keep: true },
      { text: ' ', keep: false },
      { text: 'a.b.c', keep: true },
    ])
    expect(splitNoBreakTerms('aXb', ['a.b'])).toEqual([{ text: 'aXb', keep: false }])
  })

  it('lists only hyphenated proper names', () => {
    for (const term of NO_BREAK_TERMS) expect(term).toContain('-')
  })
})
