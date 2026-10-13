import type { ReactNode } from 'react'
import { cx } from './cx'

/**
 * InventoryGrid — lays ItemSlots out like the in-game inventory (ADR D4 kit).
 * Shows up to `columns` slots per row and wraps onto more rows on narrow screens,
 * so it never causes horizontal scroll at 375px.
 */
export interface InventoryGridProps {
  /** Accessible group name, e.g. "Sample inventory". */
  label: string
  /** Maximum slots per row (in-game inventory rows are 10 wide). */
  columns?: number
  children: ReactNode
  className?: string
}

export function InventoryGrid({ label, columns = 10, children, className }: InventoryGridProps) {
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
