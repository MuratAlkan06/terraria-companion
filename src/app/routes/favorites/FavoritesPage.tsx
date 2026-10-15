import { CircleAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { EmptyChest } from '../../../components/art/EmptyChest'
import { buttonClass } from '../../../components/buttonStyles'
import { EntityCard } from '../../../components/EntityCard'
import { FAVORITE_UNSAVED, FavoriteStarButton } from '../../../components/FavoriteStar'
import { QuarantineNotice } from '../../../components/QuarantineNotice'
import { asRarity, rarityLabel } from '../../../components/rarity'
import { SpriteImg } from '../../../components/SpriteImg'
import { EmptyState, ErrorState, SkeletonList } from '../../../components/States'
import { UnknownValue } from '../../../components/UnknownValue'
import type { SpriteIndex } from '../../../data-access/types'
import { getField } from '../../../schemas/getField'
import { useFavoritesStore } from '../../favoritesStore'
import { pathFor } from '../../routes'
import { useDelayedFlag, useResource } from '../../useResource'
import { useDocumentTitle } from '../../useDocumentTitle'
import { ClassBadge } from '../db/weapons/WeaponBits'
import { stageLabel } from '../db/weapons/weaponDisplay'
import { loadFavoritesData, peekFavoritesData, type FavoritesPageData } from './favoritesData'
import { focusAfterRemoval, groupFavorites, type FavoriteEntry, type FavoriteGroup } from './favoritesModel'

/**
 * /favorites (PRD P7-S1; UX_SPEC §1, §5.2): everything the user starred, grouped by entity type,
 * each an EntityCard linking to its page. Reads the shared favorites store, so unstarring here
 * updates every other surface at once (and vice versa). Unstarring removes the card; focus moves
 * to the next card's star (else the previous one's, else the page title) and the removal is
 * announced politely. States: designed empty state (no data loaded), SkeletonList after 300ms,
 * ErrorState + Retry, and the storage notices (quarantined payload, failed save — UX_SPEC §5.6).
 */
export const TITLE_ID = 'favorites-title'

export const EMPTY_TITLE = 'Nothing starred yet'
export const EMPTY_MESSAGE = 'Tap the star on any weapon or boss to keep it here.'
export const QUARANTINE_NOTICE = 'Some saved data couldn’t be read and was set aside (not deleted).'
const FAVORITES_DOMAIN = ['favorites'] as const
export const PERSIST_ERROR_NOTICE = 'Couldn’t save to this browser’s storage. Your favorites are kept until you reload or close this tab.'

export default function FavoritesPage() {
  useDocumentTitle('Favorites')
  const refs = useFavoritesStore((s) => s.refs)
  const loadStatus = useFavoritesStore((s) => s.loadStatus)
  const persistError = useFavoritesStore((s) => s.persistError)
  const setFavorite = useFavoritesStore((s) => s.setFavorite)
  const [announcement, setAnnouncement] = useState('')
  // Wrapped so removing two cards that hand focus to the same place still re-runs the effect.
  const [focusTarget, setFocusTarget] = useState<{ ref: string | null } | null>(null)

  useEffect(() => {
    if (!focusTarget) return
    const star = focusTarget.ref ? document.querySelector<HTMLElement>(`button[data-favorite-ref="${focusTarget.ref}"]`) : null
    ;(star ?? document.getElementById(TITLE_ID))?.focus()
  }, [focusTarget])

  const onRemove = (entry: FavoriteEntry, next: string | null) => {
    const saved = setFavorite(entry.ref, false)
    setAnnouncement(`Removed ${entry.name} from favorites${saved ? '' : `. ${FAVORITE_UNSAVED}`}.`)
    setFocusTarget({ ref: next })
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6 md:space-y-5 md:px-6 md:py-8">
      <header className="space-y-2">
        <h1
          id={TITLE_ID}
          tabIndex={-1}
          className="font-display text-base leading-relaxed text-accent text-shadow-pixel focus:outline-none md:text-2xl"
        >
          Favorites
        </h1>
        <p className="max-w-prose text-fg-muted">
          The weapons and bosses you starred, saved in this browser only.{refs.length > 0 ? ' Tap a star to remove one.' : null}
        </p>
      </header>

      <QuarantineNotice domains={FAVORITES_DOMAIN} active={loadStatus === 'quarantined'} message={QUARANTINE_NOTICE} />
      {persistError ? (
        <p role="status" className="flex gap-2 text-sm text-negative">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {PERSIST_ERROR_NOTICE}
        </p>
      ) : null}

      {refs.length === 0 ? <FavoritesEmpty /> : <FavoritesBrowser refs={refs} unsaved={persistError} onRemove={onRemove} />}

      {/* Always mounted, so the removal is announced even when its card (and star) is gone. */}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  )
}

function FavoritesBrowser({
  refs,
  unsaved,
  onRemove,
}: {
  refs: readonly string[]
  unsaved: boolean
  onRemove: (entry: FavoriteEntry, next: string | null) => void
}) {
  const resource = useResource('favorites-data', loadFavoritesData, peekFavoritesData)
  const showSkeleton = useDelayedFlag(resource.status === 'loading')
  const data = resource.status === 'ready' ? resource.data : undefined
  const groups = useMemo(() => (data ? groupFavorites(refs, data) : []), [refs, data])

  if (resource.status === 'error') {
    return <ErrorState title="Couldn’t load your favorites" error={resource.error} onRetry={resource.retry} retryFocusId={TITLE_ID} />
  }
  if (!data) {
    return showSkeleton ? (
      <SkeletonList rows={Math.min(refs.length, 8)} label="Loading favorites…" />
    ) : (
      <div className="min-h-[50dvh]" aria-hidden="true" />
    )
  }
  // Everything stored has drifted out of the dataset: nothing to show, same as nothing starred.
  if (groups.length === 0) return <FavoritesEmpty />
  return (
    <FavoritesView
      groups={groups}
      sprites={data.sprites}
      unsaved={unsaved}
      onRemove={(entry) => onRemove(entry, focusAfterRemoval(groups, entry.ref))}
    />
  )
}

export interface FavoritesViewProps {
  groups: readonly FavoriteGroup[]
  sprites: FavoritesPageData['sprites']
  unsaved?: boolean
  onRemove: (entry: FavoriteEntry) => void
}

/** The grouped cards, driven by props (the page binds them to the store; tests render them directly). */
export function FavoritesView({ groups, sprites, unsaved = false, onRemove }: FavoritesViewProps) {
  return (
    <div className="space-y-6 md:space-y-8">
      {groups.map((group) => {
        const headingId = `favorites-${group.id}`
        return (
          <section key={group.id} aria-labelledby={headingId} className="space-y-3">
            <h2 id={headingId} className="flex items-baseline gap-3">
              <span className="font-display text-sm leading-relaxed text-accent text-shadow-pixel md:text-base">{group.title}</span>
              <span className="text-sm font-semibold text-fg-muted tabular-nums">
                {group.entries.length}
                <span className="sr-only"> starred</span>
              </span>
            </h2>
            <ul role="list" className="grid gap-2 lg:grid-cols-2">
              {group.entries.map((entry) => (
                <li key={entry.ref}>
                  <FavoriteCard entry={entry} sprites={sprites} unsaved={unsaved} onRemove={onRemove} />
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function FavoriteCard({
  entry,
  sprites,
  unsaved,
  onRemove,
}: {
  entry: FavoriteEntry
  sprites: SpriteIndex | null
  unsaved: boolean
  onRemove: (entry: FavoriteEntry) => void
}) {
  // Everything listed here is starred by definition: the star is pressed and only ever removes.
  const action = <FavoriteStarButton entityRef={entry.ref} name={entry.name} pressed unsaved={unsaved} onToggle={() => onRemove(entry)} />

  if (entry.kind === 'weapon') {
    const { weapon } = entry
    const rarity = asRarity(weapon.rarity)
    return (
      <EntityCard
        to={entry.href}
        name={weapon.name}
        rarity={rarity}
        sprite={<SpriteImg src={weapon.sprite} sprites={sprites} damageClass={weapon.damageClass} box={40} />}
        badges={
          <>
            <ClassBadge damageClass={weapon.damageClass} />
            <span className="text-fg-muted">{rarity === undefined ? 'Rarity unknown' : rarityLabel(rarity)}</span>
          </>
        }
        action={action}
        className="h-full"
      />
    )
  }

  const { boss } = entry
  const stage = getField(boss, 'stage')
  return (
    <EntityCard
      to={entry.href}
      name={boss.name}
      rarity={undefined}
      sprite={<SpriteImg src={boss.sprite} sprites={sprites} placeholder="creature" box={40} />}
      badges={
        <>
          <span className="inline-flex items-center border-2 border-stone-600 bg-night-900 px-1.5 text-xs leading-5 font-semibold tracking-wide text-fg uppercase">
            Boss
          </span>
          {stage.status === 'unverified' ? (
            <UnknownValue field="stage" interactive={false} />
          ) : stage.status === 'not-applicable' ? null : (
            <span className="text-fg-muted">{stageLabel(String(stage.value))}</span>
          )}
        </>
      }
      action={action}
      className="h-full"
    />
  )
}

function FavoritesEmpty() {
  return (
    <EmptyState
      titleId="favorites-empty"
      title={EMPTY_TITLE}
      art={<EmptyChest className="h-auto w-30" />}
      actions={
        <Link to={pathFor('weapons')} className={buttonClass('primary')}>
          Browse weapons
        </Link>
      }
    >
      <p>{EMPTY_MESSAGE}</p>
    </EmptyState>
  )
}
