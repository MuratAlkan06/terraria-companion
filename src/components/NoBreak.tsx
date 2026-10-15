import type { ReactNode } from 'react'
import { splitNoBreakTerms } from './noBreakTerms'

/** Keeps a short phrase on one line, e.g. <NoBreak>Re-Logic</NoBreak> (design review N3). */
export function NoBreak({ children }: { children: ReactNode }) {
  return <span className="whitespace-nowrap">{children}</span>
}

/** Renders `text` verbatim with every protected term (NO_BREAK_TERMS) kept on one line. */
export function NoBreakTerms({ text }: { text: string }) {
  return (
    <>
      {splitNoBreakTerms(text).map((segment, index) =>
        segment.keep ? <NoBreak key={index}>{segment.text}</NoBreak> : segment.text,
      )}
    </>
  )
}
