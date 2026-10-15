import { cx } from './cx'
import { Toggletip } from './Toggletip'

/**
 * CuratedLabel — the user-facing marker for an editorial field (DATA_SCHEMA_SPEC §2.1 rule 4,
 * `getField` status "editorial"; wording per AMENDMENTS-007 B33): the plain word "curated", with a
 * toggletip saying what that means. Internal names (`editorialFields`, "editorial") are unchanged.
 * Interactive: do not nest inside a link (see Toggletip).
 */
export const CURATED_EXPLANATION = 'Curated: maintained by hand from the Terraria Wiki, not extracted from its data.'

/** `explanation` replaces the default toggletip text where the curated content is more specific (readiness TAG_NEEDS lines). */
export function CuratedLabel({ className, explanation = CURATED_EXPLANATION }: { className?: string; explanation?: string }) {
  return (
    <Toggletip
      className={cx(
        'text-fg-muted underline decoration-dotted decoration-1 underline-offset-4 hover:text-fg',
        className,
      )}
      label={
        <>
          curated<span className="sr-only"> (show what this means)</span>
        </>
      }
    >
      <p>{explanation}</p>
    </Toggletip>
  )
}
