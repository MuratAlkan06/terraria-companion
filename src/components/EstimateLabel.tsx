import type { Assumptions } from './assumptions'
import { ProvenanceLink } from './ProvenanceLink'
import { Toggletip } from './Toggletip'
import { cx } from './cx'

export type { Assumption, Assumptions } from './assumptions'

/**
 * Honesty affordances (UX_SPEC §8, binding):
 * - `EstimateLabel` — warm-gold outlined "est." chip placed immediately after the number it
 *   qualifies. Tap/click/hover opens its paired AssumptionsTip.
 * - `AssumptionsTip` — the exact assumptions behind the estimate, each with its wiki source when
 *   the rule came from one.
 * Rule "every EstimateLabel resolves to a populated AssumptionsTip" is structural: the prop is a
 * non-empty tuple (./assumptions.ts), so an estimate without assumptions does not typecheck.
 */
export interface EstimateLabelProps {
  assumptions: Assumptions
  /** What the estimate is, for screen readers ("estimated DPS"). */
  context: string
  className?: string
}

export function EstimateLabel({ assumptions, context, className }: EstimateLabelProps) {
  return (
    <Toggletip
      data={{ 'data-estimate': context }}
      className={cx(
        'inline-flex items-center border-2 border-estimate px-1 text-[0.6875rem] leading-4 font-semibold text-estimate not-italic hover:bg-night-800',
        className,
      )}
      contentClassName="w-[min(--spacing(88),var(--radix-popover-content-available-width,--spacing(88)))] max-h-[min(26rem,var(--radix-popover-content-available-height,26rem))] overflow-y-auto overscroll-contain"
      label={
        <>
          est.<span className="sr-only"> (an estimate — show the assumptions behind the {context})</span>
        </>
      }
    >
      <AssumptionsTip assumptions={assumptions} context={context} />
    </Toggletip>
  )
}

export function AssumptionsTip({ assumptions, context }: { assumptions: Assumptions; context: string }) {
  return (
    <div className="space-y-2">
      <p className="font-semibold text-estimate">Assumptions behind the {context}</p>
      <ul className="space-y-2">
        {assumptions.map((a) => (
          <li key={a.id} data-assumption={a.id}>
            <p className="font-semibold text-fg">{a.title}</p>
            <p className="text-xs text-fg-muted">{a.detail}</p>
            {a.sourceUrl ? <ProvenanceLink href={a.sourceUrl} label="Rule source, on the wiki" srContext={`(${a.title})`} className="text-xs" /> : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
