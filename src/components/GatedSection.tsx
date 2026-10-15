import { Lock } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { cx } from './cx'

/**
 * GatedSection (UX_SPEC §3.1, §8): the separated container "After you defeat {Boss}" (each boss
 * linked) that gated items may appear in — never unlabeled among obtainable items. The heading names
 * the exact bosses still to defeat (tracked progress), joined with "and".
 */
export interface GatedSectionProps {
  /** The bosses still to defeat, with their page (or map position) when they have one. */
  gates: readonly { id: string; name: string; to?: string }[]
  /** Heading level inside the surrounding section. */
  as?: 'h3' | 'h4' | 'h5'
  id?: string
  children: ReactNode
  className?: string
}

const LINK = 'text-link underline decoration-1 underline-offset-4 hover:text-accent-strong'

export function GatedSection({ gates, as: Heading = 'h4', id, children, className }: GatedSectionProps) {
  return (
    <section aria-labelledby={id} data-gated-section={gates.map((g) => g.id).join('+')} className={cx('space-y-2 border-2 border-dashed border-earth-600 bg-earth-900 p-3', className)}>
      <Heading id={id} className="flex flex-wrap items-center gap-x-1.5 text-sm font-semibold text-gate">
        <Lock aria-hidden="true" className="size-4 shrink-0" />
        <span>After you defeat</span>
        {gates.map((g, i) => (
          // the comma hugs its name (no flex gap before it); "and" is its own word before the last name
          <span key={g.id} className="inline-flex items-center gap-x-1.5">
            {i > 0 && i === gates.length - 1 ? <span>and</span> : null}
            <span className="inline-flex items-center">
              {g.to ? (
                <Link to={g.to} className={cx('inline-flex min-h-tap items-center', LINK)}>
                  {g.name}
                </Link>
              ) : (
                <span>{g.name}</span>
              )}
              {i < gates.length - 2 ? ',' : null}
            </span>
          </span>
        ))}
      </Heading>
      {children}
    </section>
  )
}
