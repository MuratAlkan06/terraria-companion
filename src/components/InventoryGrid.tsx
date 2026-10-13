import type { ReactNode } from 'react'
import { cx } from './cx'

/**
 * InventoryGrid — lays ItemSlots out like the in-game inventory (ADR D4 kit).
 * Shows up to `columns` slots per row and wraps onto more rows on narrow screens,
 * so it never causes horizontal scroll at 375px.
 *
 * `cellMinWidth` switches to labelled cells (an ItemSlot plus its visible name, e.g. recipe
 * materials): as many equal columns of at least that width as fit, filling the available width.
 */
export interface InventoryGridProps {
  /** Accessible group name, e.g. "Sample inventory". */
  label: string
  /** Maximum slots per row (in-game inventory rows are 10 wide). */
  columns?: number
  /** Labelled-cell layout: minimum cell width (CSS length, e.g. "12rem"). */
  cellMinWidth?: string
  children: ReactNode
  className?: string
}

export function InventoryGrid({ label, columns = 10, cellMinWidth, children, className }: InventoryGridProps) {
  if (cellMinWidth) {
    return (
      <div
        role="group"
        aria-label={label}
        className={cx('grid w-full gap-x-3 gap-y-2', className)}
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${cellMinWidth}), 1fr))` }}
      >
        {children}
      </div>
    )
  }
  return (
    <div
      role="group"
      aria-label={label}
      className={cx('grid w-full grid-cols-[repeat(auto-fill,var(--spacing-slot))] gap-1', className)}
      style={{ maxWidth: `calc(${columns} * var(--spacing-slot) + ${columns - 1} * var(--spacing))` }}
    >
      {children}
    </div>
  )
}
