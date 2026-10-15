import { ArrowLeft } from 'lucide-react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { ErrorState, SkeletonPanel } from '../../../../components/States'
import { loadSearchDocs, NotFoundError, parseItemId, peekDetailIndex, peekSearchDocs } from '../../../../data-access'
import type { Item, SpriteIndex } from '../../../../data-access/types'
import type { SearchDoc } from '../../../../schemas'
import { resolveTarget } from '../../../../search/links'
import { useHashTarget } from '../../../useHashTarget'
import { useDelayedFlag, useResource, type ResourceState } from '../../../useResource'
import { useDocumentTitle } from '../../../useDocumentTitle'
import NotFoundPage from '../../NotFoundPage'
import { ACQUISITION_TITLE_ID, AcquisitionPanel, AcquisitionView } from '../weapons/AcquisitionView'
import * as copy from './itemCopy'
import { ItemDetailView, UsedInPanel } from './ItemDetailView'
import { cameFromItemList, ITEM_SECTION_IDS, ITEMS_PATH, itemListHref } from './itemNav'
import { loadItemPageData, loadItemSections, peekItemPageData, peekItemSections, refInfoFrom, type ItemSectionsData } from './itemsData'

/** The Back link's id: where focus goes when Retry replaces the page's error panel (B113 M7 — never <body>). */
export const ITEM_BACK_ID = 'item-back'

/**
 * /items/:id (P6 encyclopedia, AMENDMENTS-016). Loads the Item record through the shard index (only its
 * own file), and the manifest part listing its sprite; the sections below the header (acquisition, "Used
 * in", buff names) load after, so the header and stats paint first. Unknown / malformed id → styled 404;
 * chunk failures → ErrorState with Retry (shell alive). Skeletons only after 300ms (UX_SPEC §5.1).
 */
export default function ItemDetailPage() {
  const { id = '' } = useParams()
  const resource = useResource(`item:${id}`, () => loadItemPageData(id), () => peekItemPageData(id))
  const showSkeleton = useDelayedFlag(resource.status === 'loading')
  const item = resource.status === 'ready' ? resource.data.item : undefined
  const notFound = resource.status === 'error' && resource.error instanceof NotFoundError

  useDocumentTitle(item ? item.name : notFound ? 'Item not found' : 'Item')

  if (notFound) return <ItemNotFound id={id} />

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6 md:px-6 md:py-8">
      <BackLink />
      {resource.status === 'ready' ? (
        <ItemBody key={resource.data.item.id} item={resource.data.item} sprites={resource.data.sprites} />
      ) : resource.status === 'error' ? (
        <ErrorState title={copy.DETAIL_ERROR} error={resource.error} onRetry={resource.retry} retryFocusId={ITEM_BACK_ID} />
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
  const fromList = cameFromItemList(state)
  return (
    <Link
      id={ITEM_BACK_ID}
      to={itemListHref()}
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
      {copy.BACK_TO_ITEMS}
    </Link>
  )
}

function ItemBody({ item, sprites }: { item: Item; sprites: SpriteIndex | null }) {
  const sections = useResource(`item-sections:${item.id}`, () => loadItemSections(item), () => peekItemSections(item))
  const data = sections.status === 'ready' ? sections.data : undefined
  // B113c: `#acq-title` (the readiness checker's "how to get it") and the other section headings mount with
  // this body, after the record loads — the browser's own jump has already given up by then
  useHashTarget(ITEM_SECTION_IDS)
  return (
    <ItemDetailView
      item={item}
      sprites={sprites}
      sections={data}
      acquisition={<AcquisitionSection item={item} sprites={sprites} resource={sections} />}
      usedIn={<UsedInSection item={item} sprites={sprites} resource={sections} />}
    />
  )
}

type SectionsResource = ResourceState<ItemSectionsData> & { retry: () => void }

function AcquisitionSection({ item, sprites, resource }: { item: Item; sprites: SpriteIndex | null; resource: SectionsResource }) {
  const showSkeleton = useDelayedFlag(resource.status === 'loading')
  return (
    <AcquisitionPanel weapon={item}>
      {resource.status === 'ready' ? (
        <AcquisitionView weapon={item} noun="item" data={resource.data.acquisition} weaponsById={peekDetailIndex('weapons')} sprites={sprites} refInfo={refInfoFrom(resource.data.docs)} />
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

function UsedInSection({ item, sprites, resource }: { item: Item; sprites: SpriteIndex | null; resource: SectionsResource }) {
  const showSkeleton = useDelayedFlag(resource.status === 'loading')
  if (resource.status === 'ready') return <UsedInPanel item={item} sections={resource.data} sprites={sprites} />
  return (
    <UsedInPanel item={item} sections={undefined} sprites={sprites}>
      {resource.status === 'error' ? (
        <ErrorState title={copy.USED_IN_ERROR} error={resource.error} onRetry={resource.retry} retryFocusId="item-used-title" />
      ) : showSkeleton ? (
        <p role="status" className="text-fg-muted">
          {copy.USED_IN_LOADING}
        </p>
      ) : (
        <div className="min-h-24" aria-hidden="true" />
      )}
    </UsedInPanel>
  )
}

/**
 * The styled 404 (B113(e) M5): an id that is a weapon, armor piece or accessory says which and links its
 * page in-app — /weapons/:id, /armor/:id, /accessories/:id (PRD P6-S1/S2; AMENDMENTS-016 B131(b) retires the
 * armor / accessory wiki fallback) — read from the search docs; otherwise the item list.
 */
export function ItemNotFound({ id }: { id: string }) {
  const itemId = parseItemId(id)
  const docs = useResource('search-docs', loadSearchDocs, peekSearchDocs)
  const doc: SearchDoc | undefined = itemId !== undefined && docs.status === 'ready' ? docs.data.find((d) => d.id === `i:${itemId}` && d.type !== 'item') : undefined
  const target = doc ? resolveTarget(doc) : undefined
  const code = <code className="bg-night-950 px-1.5 py-0.5 font-mono text-sm break-all text-fg">{id}</code>
  return (
    <NotFoundPage
      title={copy.NOT_FOUND_TITLE}
      message={
        doc && target ? (
          <span data-not-item={doc.type}>
            ID {code} is {doc.name}, {copy.KIND_PHRASE[doc.type as keyof typeof copy.KIND_PHRASE] ?? copy.KIND_PHRASE.other} — {target.kind === 'internal' ? copy.HAS_OWN_PAGE : copy.HAS_WIKI_PAGE}{' '}
            {target.kind === 'external' ? (
              <a href={target.href} target="_blank" rel="noopener noreferrer" className="font-semibold text-link underline decoration-1 underline-offset-4 hover:text-accent-strong">
                {copy.wikiArticle(doc.name)}
                <span className="sr-only"> on terraria.wiki.gg (opens in a new tab)</span>
              </a>
            ) : null}
          </span>
        ) : (
          <>
            There&rsquo;s no item with ID {code} in the encyclopedia. It may have been mistyped, or it is a weapon, armor piece or accessory — browse the item list instead.
          </>
        )
      }
      action={target?.kind === 'internal' && doc ? { to: target.to, label: copy.openPage(doc.name) } : { to: ITEMS_PATH, label: copy.BACK_TO_ITEMS }}
    />
  )
}
