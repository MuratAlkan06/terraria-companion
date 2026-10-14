import { Lock } from 'lucide-react'
import { Link } from 'react-router'
import { cx } from './cx'

/**
 * GateBadge (UX_SPEC §3.1, §8): lock glyph + the gating boss's name, inline after an item's name —
 * never colour alone. Links to the gate's page (or its place on the boss map) when given. Callers
 * omit badges for gates the player has marked defeated, so they disappear with tracked progress.
 */
export interface GateBadgeProps {
  /** The gating progression node's name ("Eye of Cthulhu", "Hardmode"). */
  name: string
  /** Its boss page or map position; absent = plain badge. */
  to?: string
  className?: string
}

const BADGE = 'inline-flex items-center gap-1 border-2 border-earth-600 bg-night-900 px-1.5 text-xs font-semibold text-gate'

export function GateBadge({ name, to, className }: GateBadgeProps) {
  const body = (
    <>
      <Lock aria-hidden="true" className="size-3.5 shrink-0" />
      <span>
        <span className="sr-only">Available after you defeat </span>
        <span aria-hidden="true">After </span>
        {name}
      </span>
    </>
  )
  if (!to) return <span data-gate={name} className={cx(BADGE, className)}>{body}</span>
  return (
    <Link to={to} data-gate={name} className={cx(BADGE, 'min-h-tap underline decoration-1 underline-offset-4 hover:text-accent-strong', className)}>
      {body}
    </Link>
  )
}
