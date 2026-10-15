import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { cx } from './cx'
import type { Rarity } from './rarity'
import { RarityText } from './RarityText'

/**
 * EntityCard (UX_SPEC §3.1): sprite + rarity-coloured name + type/class badges + stage chip,
 * as one link to the entity's page (whole row = >= 44px target). The link contains no
 * interactive children, so Unknown markers inside must use `UnknownValue interactive={false}`.
 * An `action` (e.g. FavoriteStar, P7-S1) sits beside the link inside the same card frame, in its
 * own cell — never inside the link, since a control can't nest in another.
 * Stacked on small screens; from lg the stats align in fixed columns ("wide rows", UX_SPEC §7).
 */
export interface EntityCardStat {
  key: string
  label: string
  value: ReactNode
}

export interface EntityCardProps {
  to: string
  /** Router location state, e.g. `{ fromList: true }` so the detail page can go back. */
  state?: unknown
  sprite: ReactNode
  name: string
  rarity: Rarity | undefined
  badges?: ReactNode
  stats?: readonly EntityCardStat[]
  /** A control shown in its own cell at the card's end (outside the link). */
  action?: ReactNode
  className?: string
}

const FRAME = 'border-2 border-panel-border bg-panel text-fg shadow-pixel transition-colors duration-(--dur-ui) ease-out-strong'

export function EntityCard({ to, state, sprite, name, rarity, badges, stats = [], action, className }: EntityCardProps) {
  const content = (
    <>
      <span className="grid size-slot shrink-0 place-items-center border-2 border-slot-border bg-slot">{sprite}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-1 lg:flex-row lg:items-center lg:gap-4">
        <span className="flex min-w-0 flex-col gap-1 lg:flex-1">
          <RarityText rarity={rarity} className="font-semibold leading-snug">
            {name}
          </RarityText>
          {badges ? <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">{badges}</span> : null}
        </span>
        {stats.length > 0 ? (
          <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm lg:flex-nowrap lg:gap-x-0">
            {stats.map((stat) => (
              <div key={stat.key} className="flex items-baseline gap-1.5 lg:w-36 lg:flex-col lg:items-start lg:gap-0">
                <dt className="text-fg-muted lg:text-xs">{stat.label}</dt>
                <dd className="font-semibold tabular-nums">{stat.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </span>
      <ChevronRight
        aria-hidden="true"
        className="size-5 shrink-0 text-fg-muted transition-colors duration-(--dur-ui) ease-out-strong group-hover:text-accent"
      />
    </>
  )

  if (action === undefined) {
    return (
      <Link
        to={to}
        state={state}
        className={cx('group flex min-h-tap items-center gap-3 px-3 py-2 hover:border-gold-600', FRAME, className)}
      >
        {content}
      </Link>
    )
  }

  return (
    <div className={cx('flex items-stretch has-[a:hover]:border-gold-600', FRAME, className)}>
      <Link to={to} state={state} className="group flex min-h-tap min-w-0 flex-1 items-center gap-3 py-2 pr-2 pl-3">
        {content}
      </Link>
      <div className="flex shrink-0 items-center border-l-2 border-panel-border px-1">{action}</div>
    </div>
  )
}
