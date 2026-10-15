import { ExternalLink } from 'lucide-react'
import { cx } from './cx'

/**
 * ConditionChip (AMENDMENTS-014 B69/Q4; SCORING_SPEC §2.4): a non-node requirement — biome, event,
 * time, world — rendered as a chip ("Requires: Blood Moon"), never folded into "obtainable" and never
 * a block. Links the condition's wiki article when the registry has it (new tab, with the ↗ glyph); text-labeled, not colour alone.
 */
export interface ConditionChipProps {
  name: string
  /** The condition's terraria.wiki.gg article (conditions registry). */
  href?: string
  /** Prefix the chip with "Requires:" (item requirement) — off for a plain list of conditions. */
  requires?: boolean
  className?: string
}

const CHIP = 'inline-flex min-h-tap items-center gap-1 border-2 border-panel-border bg-night-900 px-2 text-xs font-semibold'

export function ConditionChip({ name, href, requires = false, className }: ConditionChipProps) {
  const label = (
    <>
      {requires ? <span className="font-normal text-fg-muted">Requires:</span> : null}
      {name}
    </>
  )
  if (!href) return <span data-condition-chip={name} className={cx(CHIP, className)}>{label}</span>
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" data-condition-chip={name} className={cx(CHIP, 'text-link underline decoration-1 underline-offset-4 hover:text-accent-strong', className)}>
      {label}
      {/* the ↗ every other new-tab wiki link carries (AMENDMENTS-016 B113(e)) */}
      <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="sr-only"> on terraria.wiki.gg (opens in a new tab)</span>
    </a>
  )
}
