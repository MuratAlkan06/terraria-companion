import { Popover } from 'radix-ui'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { meta } from '../data/meta'
import { cx } from './cx'
import { ProvenanceLink } from './ProvenanceLink'

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

const HOVER_CLOSE_DELAY_MS = 150

export function UnknownValue({ field, sourceUrl, interactive = true, inCell = false, className }: UnknownValueProps) {
  if (!interactive) {
    return (
      <span data-unknown-field={field} className={cx(marker(inCell), className)}>
        Unknown<span className="sr-only"> (not yet verified)</span>
      </span>
    )
  }
  return <UnknownToggletip field={field} sourceUrl={sourceUrl} inCell={inCell} className={className} />
}

function UnknownToggletip({ field, sourceUrl, inCell = false, className }: Omit<UnknownValueProps, 'interactive'>) {
  const [open, setOpen] = useState(false)
  // Opened by mouse hover (closes on leave, keeps focus on the trigger) vs pinned by click/tap/key.
  const hoverOpened = useRef(false)
  // A hover-close must not return focus to the trigger (that would scroll the page to it).
  const closingFromHover = useRef(false)
  const closeTimer = useRef<number | undefined>(undefined)

  const cancelClose = () => window.clearTimeout(closeTimer.current)
  useEffect(() => cancelClose, [])

  const onPointerEnter = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return
    cancelClose()
    if (!open) {
      hoverOpened.current = true
      setOpen(true)
    }
  }
  const onPointerLeave = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse' || !hoverOpened.current) return
    cancelClose()
    closeTimer.current = window.setTimeout(() => {
      hoverOpened.current = false
      closingFromHover.current = true
      setOpen(false)
    }, HOVER_CLOSE_DELAY_MS)
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        hoverOpened.current = false
        setOpen(next)
      }}
    >
      <Popover.Trigger
        data-unknown-field={field}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onClick={(event) => {
          // A click on a hover-opened tip pins it open instead of toggling it shut.
          if (hoverOpened.current) {
            event.preventDefault()
            hoverOpened.current = false
          }
        }}
        className={cx(
          marker(inCell),
          'relative cursor-help hover:text-fg-muted',
          // >= 44px tap target without changing the inline line box (UX_SPEC §9).
          "before:absolute before:inset-x-0 before:top-1/2 before:h-tap before:-translate-y-1/2 before:content-['']",
          className,
        )}
      >
        Unknown<span className="sr-only"> (not yet verified, show details)</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          onOpenAutoFocus={(event) => {
            if (hoverOpened.current) event.preventDefault()
          }}
          onCloseAutoFocus={(event) => {
            if (closingFromHover.current) event.preventDefault()
            closingFromHover.current = false
          }}
          onPointerEnter={cancelClose}
          onPointerLeave={onPointerLeave}
          className="z-(--z-popover) w-max max-w-[min(--spacing(72),var(--radix-popover-content-available-width,--spacing(72)))] border-2 border-tooltip-border bg-tooltip-bg px-3 py-2 text-sm text-fg shadow-pixel-drop"
        >
          <p>{UNKNOWN_EXPLANATION}.</p>
          {sourceUrl ? <ProvenanceLink href={sourceUrl} className="mt-1" /> : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
