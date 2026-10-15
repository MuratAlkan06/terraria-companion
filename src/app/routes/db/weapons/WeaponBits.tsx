import type { DamageClass } from '../../../../schemas'
import { cx } from '../../../../components/cx'
import { CLASS_LABELS } from './weaponDisplay'

/** Small text badge: weapon damage class (A1: absent class = "Unclassified"). */
export function ClassBadge({ damageClass, className }: { damageClass: DamageClass | undefined; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center border-2 border-stone-600 bg-night-900 px-1.5 text-xs leading-5 font-semibold tracking-wide text-fg uppercase',
        className,
      )}
    >
      {damageClass ? CLASS_LABELS[damageClass] : 'Unclassified'}
    </span>
  )
}

