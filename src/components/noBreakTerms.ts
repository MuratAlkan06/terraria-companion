/**
 * Hyphenated names that must never wrap at their hyphen (design review N3).
 * The text stays verbatim (no U+2011 substitution), so the ADR D3 attribution
 * still matches exactly for copy/paste, find-in-page and copy audits; the UI
 * wraps each occurrence in a `white-space: nowrap` span instead.
 */
export const NO_BREAK_TERMS: readonly string[] = ['Re-Logic', 'CC BY-NC-SA 4.0']

export interface TextSegment {
  text: string
  /** True for an occurrence of a protected term. */
  keep: boolean
}

/** Splits `text` into plain runs and protected-term runs, in order, losslessly. */
export function splitNoBreakTerms(text: string, terms: readonly string[] = NO_BREAK_TERMS): TextSegment[] {
  const sorted = [...terms].filter(Boolean).sort((a, b) => b.length - a.length)
  if (sorted.length === 0 || text === '') return text === '' ? [] : [{ text, keep: false }]
  const escaped = sorted.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(`(${escaped.join('|')})`, 'g')
  return text
    .split(pattern)
    .filter((part) => part !== '')
    .map((part) => ({ text: part, keep: sorted.includes(part) }))
}
