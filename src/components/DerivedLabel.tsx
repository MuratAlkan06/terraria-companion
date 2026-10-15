import { cx } from './cx'
import { Toggletip } from './Toggletip'

/**
 * DerivedLabel — the marker for a value DERIVED by a ratified rule rather than stated by the wiki
 * (`_prov.modeledFields`; AMENDMENTS-016 B105: a drop with no stated quantity of a non-consumable item is
 * 1). Plain word "derived" + a toggletip saying what it is derived from, so a derived value is never
 * mistaken for a wiki-stated one (B49/B105 "visible, auditable, distinguishable"). Interactive: do not nest
 * inside a link; `interactive={false}` renders the bare marker for dense table cells (explain it once in the
 * section's note instead).
 */
export const DERIVED_QUANTITY_EXPLANATION =
  'The wiki states no quantity for this drop. The item can’t be used up or stacked, so its quantity is derived from the item kind: 1.'

export function DerivedLabel({
  explanation = DERIVED_QUANTITY_EXPLANATION,
  interactive = true,
  className,
}: {
  explanation?: string
  interactive?: boolean
  className?: string
}) {
  const look = 'text-fg-muted underline decoration-dotted decoration-1 underline-offset-4'
  if (!interactive) {
    return (
      <span data-derived="" className={cx(look, className)}>
        derived<span className="sr-only"> from the item kind; the wiki states no quantity</span>
      </span>
    )
  }
  return (
    <Toggletip
      data={{ 'data-derived': '' }}
      className={cx(look, 'hover:text-fg', className)}
      label={
        <>
          derived<span className="sr-only"> (show what this means)</span>
        </>
      }
    >
      <p>{explanation}</p>
    </Toggletip>
  )
}
