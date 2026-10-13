import { Tooltip } from 'radix-ui'
import type { ReactNode } from 'react'
import { cx } from './cx'
import type { Rarity } from './rarity'
import { TerrariaTooltip, type TerrariaTooltipData } from './TerrariaTooltip'

/**
 * ItemSlot — one inventory square (ADR D4 kit). 48px (>= 44px touch target),
 * zero-radius, pixel bevel. Interactive when `onSelect` is given; shows a
 * TerrariaTooltip on hover/keyboard focus when `tooltip` is given.
 * Requires a `Tooltip.Provider` ancestor (mounted once in the app shell).
 */
export interface ItemSlotItem {
  name: string
  /** Decorative sprite node (sized to 32px by the slot). */
  sprite: ReactNode
  stack?: number
  rarity?: Rarity
}

export interface ItemSlotProps {
  /** Omit for an empty slot. */
  item?: ItemSlotItem
  tooltip?: TerrariaTooltipData
  selected?: boolean
  onSelect?: () => void
  className?: string
}

export function ItemSlot({ item, tooltip, selected = false, onSelect, className }: ItemSlotProps) {
  const frame = cx(
    'relative grid size-slot shrink-0 place-items-center border-2',
    // Selected = gold frame AND a doubled inner frame (weight, not colour alone).
    selected ? 'border-slot-selected bg-slot-hover shadow-slot-selected' : 'border-slot-border bg-slot shadow-pixel',
    className,
  )

  if (!item) return <div aria-hidden="true" className={cx(frame, 'opacity-60')} />

  const hasStack = item.stack !== undefined && item.stack > 1
  const label = hasStack ? `${item.name}, stack of ${item.stack}` : item.name
  const content = (
    <>
      <span aria-hidden="true" className="block size-8 [&>svg]:size-full">
        {item.sprite}
      </span>
      {hasStack ? (
        <span
          aria-hidden="true"
          className="absolute bottom-0 left-1 text-xs font-bold text-fg tabular-nums text-shadow-pixel"
        >
          {item.stack}
        </span>
      ) : null}
    </>
  )

  const slot = onSelect ? (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      onClick={onSelect}
      className={cx(
        frame,
        'transition-[background-color,transform] duration-(--dur-press) ease-out-strong hover:bg-slot-hover active:scale-[0.97]',
      )}
    >
      {content}
    </button>
  ) : (
    <div role="img" aria-label={label} tabIndex={tooltip ? 0 : undefined} className={frame}>
      {content}
    </div>
  )

  if (!tooltip) return slot

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{slot}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side="right" align="start" sideOffset={8} collisionPadding={8} className="z-(--z-popover)">
          <TerrariaTooltip {...tooltip} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
