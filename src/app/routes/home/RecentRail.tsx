import { History } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { buttonClass } from '../../../components/buttonStyles'
import { EntityCard } from '../../../components/EntityCard'
import { asRarity, rarityLabel } from '../../../components/rarity'
import { SpriteImg } from '../../../components/SpriteImg'
import { ErrorState, SkeletonList } from '../../../components/States'
import type { SpriteIndex } from '../../../data-access/types'
import { pathFor } from '../../routes'
import { useDelayedFlag } from '../../useResource'
import { ClassBadge } from '../db/weapons/WeaponBits'
import { weaponHref } from '../db/weapons/weaponNav'
import { readRecentEntries, resolveRecent, type HomeResource, type RecentWeapon } from './homeData'

/**
 * RecentRail (UX_SPEC §3.2, PRD P2-S5 AC2): the pages the user last opened (`tc.v1.recent`,
 * written by detail pages), most recent first, as a horizontal snap-scroll rail of EntityCards
 * linking back to them. Entries that no longer resolve are skipped silently; nothing to show →
 * the designed one-line invitation + single CTA (UX_SPEC §5.2).
 */
const TITLE_ID = 'recent-title'

export function RecentRail({ home }: { home: HomeResource }) {
  // Read on each visit to the homepage: coming back from a detail page remounts this.
  const [entries] = useState(() => readRecentEntries())
  const weaponsById = home.status === 'ready' ? home.data.weaponsById : undefined
  const items = useMemo(() => (weaponsById ? resolveRecent(entries, weaponsById) : []), [entries, weaponsById])
  const showSkeleton = useDelayedFlag(entries.length > 0 && home.status === 'loading')

  return (
    <section aria-labelledby={TITLE_ID} className="space-y-3">
      <h2
        id={TITLE_ID}
        tabIndex={-1}
        className="font-display text-base leading-relaxed text-accent text-shadow-pixel focus:outline-none"
      >
        Recently viewed
      </h2>
      {entries.length === 0 || (home.status === 'ready' && items.length === 0) ? (
        <RecentEmpty />
      ) : home.status === 'ready' ? (
        <RecentList items={items} sprites={home.data.sprites} />
      ) : home.status === 'error' ? (
        <ErrorState title="Couldn’t load recently viewed" error={home.error} onRetry={home.retry} retryFocusId={TITLE_ID} />
      ) : showSkeleton ? (
        <SkeletonList rows={1} label="Loading recently viewed…" />
      ) : (
        <div className="min-h-[5.5rem] lg:min-h-16" aria-hidden="true" />
      )}
    </section>
  )
}

function RecentList({ items, sprites }: { items: readonly RecentWeapon[]; sprites: SpriteIndex | null }) {
  return (
    // Bleeds to the screen edges below md so cards scroll out from under the page padding. The
    // 4px (`1`) inner room keeps the focus ring (2px + 2px offset) from being clipped by the scroller.
    <ul className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pt-1 pb-3 scheme-dark [scrollbar-color:var(--color-stone-600)_transparent] md:-mx-1 md:scroll-px-1 md:px-1">
      {items.map(({ ref, weapon }) => {
        const rarity = asRarity(weapon.rarity)
        return (
          <li key={ref} className="w-64 shrink-0 snap-start md:w-72">
            <EntityCard
              to={weaponHref(weapon.id)}
              name={weapon.name}
              rarity={rarity}
              sprite={<SpriteImg src={weapon.sprite} sprites={sprites} damageClass={weapon.damageClass} box={40} />}
              badges={
                <>
                  <ClassBadge damageClass={weapon.damageClass} />
                  <span className="text-fg-muted">{rarity === undefined ? 'Rarity unknown' : rarityLabel(rarity)}</span>
                </>
              }
              className="h-full"
            />
          </li>
        )
      })}
    </ul>
  )
}

function RecentEmpty() {
  return (
    <div className="flex flex-col gap-3 border-2 border-dashed border-panel-border bg-surface p-4 md:flex-row md:items-center md:justify-between md:gap-6">
      <p className="flex items-center gap-3 text-fg-muted">
        <History aria-hidden="true" className="size-5 shrink-0 text-accent" />
        Nothing viewed yet — try searching Zenith
      </p>
      <Link to={pathFor('weapons')} className={buttonClass('secondary', 'shrink-0 self-start md:self-auto')}>
        Browse weapons
      </Link>
    </div>
  )
}
