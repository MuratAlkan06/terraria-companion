import { ArrowLeft } from 'lucide-react'
import { useEffect } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { ErrorState, SkeletonPanel } from '../../../../components/States'
import {
  loadAcquisitionData,
  loadDetail,
  loadSpriteIndex,
  NotFoundError,
  peekAcquisitionData,
  peekDetail,
  peekDetailIndex,
  peekSpriteIndex,
  type AcquisitionData,
} from '../../../../data-access'
import type { SpriteIndex, Weapon } from '../../../../data-access/types'
import { recordRecentVisit } from '../../../recent'
import { useDelayedFlag, useResource, type ResourceState } from '../../../useResource'
import { useDocumentTitle } from '../../../useDocumentTitle'
import NotFoundPage from '../../NotFoundPage'
import { ACQUISITION_TITLE_ID, AcquisitionPanel, AcquisitionView } from './AcquisitionView'
import { acquisitionNeeds } from './weaponDisplay'
import { WeaponDetailView } from './WeaponDetailView'
import { cameFromList, listHref } from './weaponNav'

/**
 * /weapons/:id (PRD P2-S3 AC3/AC4). Loads the weapon (+ sprite manifest), records the visit in
 * `tc.v1.recent`, and renders WeaponDetailView. Unknown/malformed id → styled 404; chunk
 * failures → ErrorState with Retry (shell stays alive). The acquisition indexes
 * (recipes/drops/names) load after the weapon so stats paint first; the header's
 * partially-verified badge and the acquisition section share them.
 */
interface DetailData {
  weapon: Weapon
  sprites: SpriteIndex | null
}

async function loadDetailData(id: string): Promise<DetailData> {
  const [weapon, sprites] = await Promise.all([
    loadDetail('weapons', id),
    loadSpriteIndex().catch((error: unknown) => {
      console.warn('[sprites] Manifest unavailable; showing placeholder art.', error)
      return null
    }),
  ])
  return { weapon, sprites }
}

function peekDetailData(id: string): DetailData | undefined {
  const weapon = peekDetail('weapons', id)
  return weapon ? { weapon, sprites: peekSpriteIndex() ?? null } : undefined
}

export default function WeaponDetailPage() {
  const { id = '' } = useParams()
  const resource = useResource(`weapon:${id}`, () => loadDetailData(id), () => peekDetailData(id))
  const showSkeleton = useDelayedFlag(resource.status === 'loading')
  const weapon = resource.status === 'ready' ? resource.data.weapon : undefined
  const notFound = resource.status === 'error' && resource.error instanceof NotFoundError

  useDocumentTitle(weapon ? weapon.name : notFound ? 'Weapon not found' : 'Weapon')

  const weaponId = weapon?.id
  useEffect(() => {
    if (weaponId !== undefined) recordRecentVisit(`i:${weaponId}`)
  }, [weaponId])

  if (notFound) {
    return (
      <NotFoundPage
        title="No such weapon"
        message={
          <>
            There&rsquo;s no weapon with ID{' '}
            <code className="bg-night-950 px-1.5 py-0.5 font-mono text-sm break-all text-fg">{id}</code> in the Terraria
            dataset. It may have been mistyped — browse the full list instead.
          </>
        }
        action={{ to: '/weapons', label: 'All weapons' }}
      />
    )
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6 md:px-6 md:py-8">
      <BackLink />
      {resource.status === 'ready' ? (
        <WeaponDetailBody weapon={resource.data.weapon} sprites={resource.data.sprites} />
      ) : resource.status === 'error' ? (
        <ErrorState title="Couldn’t load this weapon" error={resource.error} onRetry={resource.retry} />
      ) : showSkeleton ? (
        <SkeletonPanel label="Loading weapon…" lines={6} />
      ) : (
        <div className="min-h-[50dvh]" aria-hidden="true" />
      )}
    </div>
  )
}

function BackLink() {
  const { state } = useLocation()
  const navigate = useNavigate()
  const fromList = cameFromList(state)
  return (
    <Link
      to={listHref()}
      onClick={(event) => {
        // Came from the list: go back in history so its filters AND scroll position restore.
        if (fromList && !event.metaKey && !event.ctrlKey && !event.shiftKey && event.button === 0) {
          event.preventDefault()
          navigate(-1)
        }
      }}
      className="inline-flex min-h-tap items-center gap-2 font-semibold text-link underline decoration-1 underline-offset-4 hover:text-accent-strong"
    >
      <ArrowLeft aria-hidden="true" className="size-5" />
      All weapons
    </Link>
  )
}

function WeaponDetailBody({ weapon, sprites }: DetailData) {
  const needs = acquisitionNeeds(weapon)
  const acquisition = useResource(
    `acq:${weapon.id}`,
    () => loadAcquisitionData(needs),
    () => peekAcquisitionData(needs),
  )
  return (
    <WeaponDetailView
      weapon={weapon}
      sprites={sprites}
      acquisitionData={acquisition.status === 'ready' ? acquisition.data : undefined}
      acquisition={<AcquisitionSection weapon={weapon} sprites={sprites} resource={acquisition} />}
    />
  )
}

function AcquisitionSection({
  weapon,
  sprites,
  resource,
}: {
  weapon: Weapon
  sprites: SpriteIndex | null
  resource: ResourceState<AcquisitionData> & { retry: () => void }
}) {
  const showSkeleton = useDelayedFlag(resource.status === 'loading')
  const weaponsById = peekDetailIndex('weapons')

  return (
    <AcquisitionPanel weapon={weapon}>
      {resource.status === 'ready' ? (
        <AcquisitionView weapon={weapon} data={resource.data} weaponsById={weaponsById} sprites={sprites} />
      ) : resource.status === 'error' ? (
        <ErrorState
          title="Couldn’t load how to obtain this weapon"
          error={resource.error}
          onRetry={resource.retry}
          retryFocusId={ACQUISITION_TITLE_ID}
        />
      ) : showSkeleton ? (
        <p role="status" className="text-fg-muted">
          Loading recipes and drops…
        </p>
      ) : (
        <div className="min-h-24" aria-hidden="true" />
      )}
    </AcquisitionPanel>
  )
}
