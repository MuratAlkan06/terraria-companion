import { ProvenanceLink } from './ProvenanceLink'
import { Toggletip } from './Toggletip'
import { cx } from './cx'

/**
 * AssumptionChip (UX_SPEC §8 family; AMENDMENTS-014 B69/Q3): an explicit assumption the analysis
 * makes about something it can't see (the Demon Heart slot: "assumes Demon Heart used"). Same chip
 * geometry as EstimateLabel, in the estimate colour, dashed so it never reads as a number's "est.";
 * tap / hover opens what is assumed and its wiki source. Interactive: not inside a link.
 */
export interface AssumptionChipProps {
  /** Short chip text ("assumes Demon Heart"). */
  label: string
  title: string
  detail: string
  sourceUrl?: string
  className?: string
}

export function AssumptionChip({ label, title, detail, sourceUrl, className }: AssumptionChipProps) {
  return (
    <Toggletip
      data={{ 'data-assumption-chip': label }}
      className={cx('inline-flex items-center border-2 border-dashed border-estimate px-1 text-[0.6875rem] leading-4 font-semibold text-estimate hover:bg-night-800', className)}
      label={
        <>
          {label}
          <span className="sr-only"> (an assumption — show what is assumed)</span>
        </>
      }
    >
      <p className="font-semibold text-estimate">{title}</p>
      <p className="mt-1 text-xs text-fg-muted">{detail}</p>
      {sourceUrl ? <ProvenanceLink href={sourceUrl} label="Rule source, on the wiki" srContext={`(${title})`} className="text-xs" /> : null}
    </Toggletip>
  )
}
