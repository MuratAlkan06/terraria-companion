import { CircleAlert } from 'lucide-react'
import { Popover } from 'radix-ui'
import { useId, useState } from 'react'
import { meta } from '../data/meta'
import { fixedBottomInset } from './fixedBottomInset'
import { unknownItemLine } from './unknownItemLine'

/**
 * "Partially verified" badge (UX_SPEC §5.3): shown next to the ProvenanceLink when anything on
 * the page is Unknown. Glyph + text (not colour alone); click/tap/Enter opens a labelled dialog
 * listing every Unknown on the page, worded like the section it sits in, so the page's Unknown
 * markers are explained in one place. Pages pass ALL rendered Unknowns (the record's own and
 * those of related records it shows, e.g. drop tables), so the count matches the page.
 */
export interface PartiallyVerifiedItem {
  key: string
  /** Human label, e.g. "Sold by Demolitionist — price". */
  label: string
  /** Unknown markers this item stands for (default 1). */
  count?: number
}

export interface PartiallyVerifiedBadgeProps {
  /** Unknowns on the page, in page order. Renders nothing when empty. */
  items: readonly PartiallyVerifiedItem[]
}

const EDGE = 8

export function PartiallyVerifiedBadge({ items }: PartiallyVerifiedBadgeProps) {
  const titleId = useId()
  const descriptionId = useId()
  const [open, setOpen] = useState(false)
  // Measured when opening: below lg the fixed tab bar is a collision edge (never open under it).
  const [bottomInset, setBottomInset] = useState(0)

  const total = items.reduce((n, item) => n + (item.count ?? 1), 0)
  if (total === 0) return null

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setBottomInset(fixedBottomInset())
        setOpen(next)
      }}
    >
      <Popover.Trigger className="inline-flex min-h-tap items-center gap-1.5 border-2 border-dashed border-stone-500 bg-slot px-2.5 text-sm font-semibold text-fg-muted shadow-pixel hover:border-stone-400 hover:text-fg data-[state=open]:border-stone-400">
        <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
        Partially verified
        <span className="sr-only">: show which {total === 1 ? 'value is' : `${total} values are`} unknown</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={{ top: EDGE, right: EDGE, left: EDGE, bottom: EDGE + bottomInset }}
          className="z-(--z-popover) max-h-(--radix-popover-content-available-height) w-max max-w-[min(--spacing(80),var(--radix-popover-content-available-width,--spacing(80)))] overflow-y-auto border-2 border-tooltip-border bg-tooltip-bg px-3 py-2 text-sm text-fg shadow-pixel-drop"
        >
          <p id={titleId} className="font-semibold">
            Partially verified
          </p>
          <p id={descriptionId} className="mt-1">
            {total === 1 ? 'One value' : `${total} values`} on this page could not be verified against the Terraria
            Wiki for {meta.gameVersion} and {total === 1 ? 'is' : 'are'} shown as Unknown:
          </p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-fg-muted">
            {items.map((item) => (
              <li key={item.key}>{unknownItemLine(item)}</li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
