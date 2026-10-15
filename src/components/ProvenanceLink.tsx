import { ExternalLink } from 'lucide-react'
import { cx } from './cx'

/**
 * ProvenanceLink — "Source: terraria.wiki.gg ↗" (UX_SPEC §3.1). Required on every data-driven
 * view. Opens the wiki page the data was taken from in a new tab.
 */
export interface ProvenanceLinkProps {
  href: string
  /** Visible label; defaults to "Source: <host>". */
  label?: string
  /** Extra screen-reader context, e.g. "for Zenith". */
  srContext?: string
  className?: string
}

function hostOf(href: string): string {
  try {
    return new URL(href).host
  } catch {
    return href
  }
}

export function ProvenanceLink({ href, label, srContext, className }: ProvenanceLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cx(
        'inline-flex min-h-tap items-center gap-1.5 text-sm text-link underline decoration-1 underline-offset-4 hover:text-accent-strong',
        className,
      )}
    >
      <span>
        {label ?? `Source: ${hostOf(href)}`}
        {srContext ? <span className="sr-only"> {srContext}</span> : null}
      </span>
      <ExternalLink aria-hidden="true" className="size-4 shrink-0" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}
