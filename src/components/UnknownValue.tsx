import { meta } from '../data/meta'
import { cx } from './cx'
import { ProvenanceLink } from './ProvenanceLink'
import { Toggletip } from './Toggletip'

/**
 * UnknownValue — the ONLY rendering for an unverified field (REQUIREMENTS §13, UX_SPEC §5.3):
 * literal "Unknown" in stone-gray italic Inter, dotted underline, diagonal-hatch background
 * (pattern + text, never colour alone). Never blank, never 0, never a dash.
 *
 * Interactive (default): a toggletip — opens on mouse hover, tap, click, Enter/Space; shows
 * "Not yet verified against the Terraria Wiki for <version>" + ProvenanceLink. Esc closes and
 * returns focus. Use `interactive={false}` inside links/rows (no nested interactive content).
 *
 * `field` is emitted as `data-unknown-field` so audits/tests can check that Unknown markers
 * sit exactly on the record's unverified fields (PRD P2-S3 AC4).
 */
export interface UnknownValueProps {
  /** Dot-path of the unverified field, e.g. "damage" or "acquisition.1.priceCopper". */
  field: string
  /** Wiki page to check against (usually the record's wikiUrl). */
  sourceUrl?: string
  interactive?: boolean
  /**
   * The marker sits in a table cell that carries the hatch itself (UX_SPEC §5.3: "table cells add
   * a subtle diagonal-hatch background" — add `bg-hatch-unknown` to the cell); the marker then
   * drops its own hatch so the two patterns never overlap.
   */
  inCell?: boolean
  className?: string
}

const MARKER_BASE =
  'inline-flex items-center px-1 font-sans whitespace-nowrap italic text-unknown underline decoration-dotted decoration-1 underline-offset-4'

const marker = (inCell: boolean) => cx(MARKER_BASE, !inCell && 'bg-hatch-unknown')

/** Tooltip copy; the version comes from meta.json (ADR D1), never hard-coded. */
export const UNKNOWN_EXPLANATION = `Not yet verified against the Terraria Wiki for ${meta.gameVersion}`

export function UnknownValue({ field, sourceUrl, interactive = true, inCell = false, className }: UnknownValueProps) {
  if (!interactive) {
    return (
      <span data-unknown-field={field} className={cx(marker(inCell), className)}>
        Unknown<span className="sr-only"> (not yet verified)</span>
      </span>
    )
  }
  return (
    <Toggletip
      data={{ 'data-unknown-field': field }}
      className={cx(marker(inCell), 'hover:text-fg-muted', className)}
      label={
        <>
          Unknown<span className="sr-only"> (not yet verified, show details)</span>
        </>
      }
    >
      <p>{UNKNOWN_EXPLANATION}.</p>
      {sourceUrl ? <ProvenanceLink href={sourceUrl} className="mt-1" /> : null}
    </Toggletip>
  )
}
