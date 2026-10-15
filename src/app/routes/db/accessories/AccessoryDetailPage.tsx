import { ArrowLeft } from 'lucide-react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { ErrorState, SkeletonPanel } from '../../../../components/States'
import { parseItemId, peekDetailIndex } from '../../../../data-access'
import type { Accessory } from '../../../../data-access/types'
import { useHashTarget } from '../../../useHashTarget'
import { useDelayedFlag, useResource, type ResourceState } from '../../../useResource'
import { useDocumentTitle } from '../../../useDocumentTitle'
import NotFoundPage from '../../NotFoundPage'
import { refInfoFrom } from '../items/itemsData'
import { ACQUISITION_TITLE_ID, AcquisitionPanel, AcquisitionView } from '../weapons/AcquisitionView'
import * as copy from './accessoryCopy'
import { loadAccessoryData, loadAccessorySections, peekAccessoryData, peekAccessorySections, type AccessoryData, type AccessorySectionsData } from './accessoryData'
import { AccessoryDetailView } from './AccessoryDetailView'
import { ACCESSORIES_PATH, ACCESSORY_SECTION_IDS, ACCESSORY_TREE_ID, accessoryListHref, cameFromAccessoryList } from './accessoryNav'

/** The Back link's id: where focus goes when Retry replaces the page's error panel (B113 M7 — never <body>). */
export const ACCESSORY_BACK_ID = 'accessory-back'

/**
 * /accessories/:id (PRD P6-S2; UX_SPEC §1). The records load first (header, effects and class notes paint at once);
 * the recipes, drops and search docs for "how to obtain" and the combination tree load after. Unknown / malformed
 * id → styled 404 linking the list; chunk failures → ErrorState with Retry (shell alive); skeletons after 300ms.
 */
export default function AccessoryDetailPage() {
  const { id = '' } = useParams()
  const resource = useResource('accessory-data', loadAccessoryData, peekAccessoryData)
  const showSkeleton = useDelayedFlag(resource.status === 'loading')
  const itemId = parseItemId(id)
  const accessory = resource.status === 'ready' && itemId !== undefined ? resource.data.accessories.get(itemId) : undefined
  const notFound = resource.status === 'ready' && accessory === undefined

  useDocumentTitle(accessory ? accessory.name : notFound ? copy.NOT_FOUND_TITLE : copy.ACCESSORIES_TITLE)

  if (notFound) return <NotFoundPage title={copy.NOT_FOUND_TITLE} message={copy.notFoundBody} action={{ to: ACCESSORIES_PATH, label: copy.BACK_TO_ACCESSORIES }} />

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6 md:px-6 md:py-8">
      <BackLink />
      {resource.status === 'ready' && accessory ? (
        <AccessoryBody key={accessory.id} accessory={accessory} data={resource.data} />
      ) : resource.status === 'error' ? (
        <ErrorState title={copy.DETAIL_ERROR} error={resource.error} onRetry={resource.retry} retryFocusId={ACCESSORY_BACK_ID} />
      ) : showSkeleton ? (
        <SkeletonPanel label={copy.DETAIL_LOADING} lines={6} />
      ) : (
        <div className="min-h-[50dvh]" aria-hidden="true" />
      )}
    </div>
  )
}

function BackLink() {
  const { state } = useLocation()
  const navigate = useNavigate()
  const fromList = cameFromAccessoryList(state)
  return (
    <Link
      id={ACCESSORY_BACK_ID}
      to={accessoryListHref()}
      onClick={(event) => {
        if (fromList && !event.metaKey && !event.ctrlKey && !event.shiftKey && event.button === 0) {
          event.preventDefault()
          navigate(-1)
        }
      }}
      className="inline-flex min-h-tap items-center gap-2 font-semibold text-link underline decoration-1 underline-offset-4 hover:text-accent-strong"
    >
      <ArrowLeft aria-hidden="true" className="size-5" />
      {copy.BACK_TO_ACCESSORIES}
    </Link>
  )
}

type SectionsResource = ResourceState<AccessorySectionsData> & { retry: () => void }

function AccessoryBody({ accessory, data }: { accessory: Accessory; data: AccessoryData }) {
  const sections = useResource(`accessory-sections:${accessory.id}`, () => loadAccessorySections(accessory), () => peekAccessorySections(accessory))
  // B113c: `#acq-title` and the other section headings — revealed once the sections below the header have settled
  useHashTarget(ACCESSORY_SECTION_IDS, sections.status !== 'loading')
  const showSkeleton = useDelayedFlag(sections.status === 'loading')
  return (
    <AccessoryDetailView
      accessory={accessory}
      accessories={data.accessories}
      sprites={data.sprites}
      sections={sections.status === 'ready' ? sections.data : undefined}
      acquisition={<AcquisitionSection accessory={accessory} data={data} resource={sections} />}
      treeFallback={
        sections.status === 'error' ? (
          <ErrorState title={copy.TREE_ERROR} error={sections.error} onRetry={sections.retry} retryFocusId={ACCESSORY_TREE_ID} />
        ) : showSkeleton ? (
          <p role="status" className="text-sm text-fg-muted">
            {copy.TREE_LOADING}
          </p>
        ) : (
          <div className="min-h-16" aria-hidden="true" />
        )
      }
    />
  )
}

function AcquisitionSection({ accessory, data, resource }: { accessory: Accessory; data: AccessoryData; resource: SectionsResource }) {
  const showSkeleton = useDelayedFlag(resource.status === 'loading')
  return (
    <AcquisitionPanel weapon={accessory}>
      {resource.status === 'ready' ? (
        <AcquisitionView weapon={accessory} noun="accessory" data={resource.data.acquisition} weaponsById={peekDetailIndex('weapons')} sprites={data.sprites} refInfo={refInfoFrom(resource.data.docs)} />
      ) : resource.status === 'error' ? (
        <ErrorState title={copy.ACQ_ERROR} error={resource.error} onRetry={resource.retry} retryFocusId={ACQUISITION_TITLE_ID} />
      ) : showSkeleton ? (
        <p role="status" className="text-fg-muted">
          {copy.ACQ_LOADING}
        </p>
      ) : (
        <div className="min-h-24" aria-hidden="true" />
      )}
    </AcquisitionPanel>
  )
}
