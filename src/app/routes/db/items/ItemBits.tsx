import { cx } from '../../../../components/cx'
import type { ItemCategory } from '../../../../schemas'
import { categoryInfo } from './itemDisplay'

/** Small text badge: the item's encyclopedia category (like the weapon ClassBadge). */
export function CategoryBadge({ category, className }: { category: ItemCategory; className?: string }) {
  return (
    <span
      data-category={category}
      className={cx(
        'inline-flex items-center border-2 border-stone-600 bg-night-900 px-1.5 text-xs leading-5 font-semibold tracking-wide text-fg uppercase',
        className,
      )}
    >
      {categoryInfo(category).badge}
    </span>
  )
}
