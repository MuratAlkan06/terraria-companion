import { FlaskConical } from 'lucide-react'
import { cx } from '../../../components/cx'

/**
 * SimDisclaimerBar (UX_SPEC §5.5, PRD P3-S1 AC1): permanent, never dismissible, at the top of the
 * Lab at every breakpoint and in fullscreen. Copy is exact per §5.5; on phones (UX_SPEC §3.4 "one-
 * line sticky strip") the strip SHOWS a shorter line with the same meaning, while assistive tech
 * still reads the exact copy.
 */
export const SIM_DISCLAIMER = 'Browser simulation — values are approximations, not Terraria engine output.'
/** Fits one line at 375 px (with room for a font fallback). */
export const SIM_DISCLAIMER_SHORT = 'Browser sim — approximate, not Terraria’s engine.'

export function SimDisclaimerBar({ className }: { className?: string }) {
  return (
    <div
      role="note"
      aria-label="Simulation disclaimer"
      data-sim-disclaimer=""
      className={cx('border-b-2 border-gold-700 bg-night-950 text-fg', className)}
    >
      <p className="flex items-center gap-2 px-3 py-1.5 text-xs leading-snug md:px-4 md:text-sm">
        <FlaskConical aria-hidden="true" className="size-4 shrink-0 text-accent" />
        <span aria-hidden="true" className="md:hidden">
          {SIM_DISCLAIMER_SHORT}
        </span>
        <span className="max-md:sr-only">{SIM_DISCLAIMER}</span>
      </p>
    </div>
  )
}
