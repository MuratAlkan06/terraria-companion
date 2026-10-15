import { ArrowLeft } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { ErrorState, SkeletonPanel } from '../../../components/States'
import { NotFoundError } from '../../../data-access'
import { useProgressStore } from '../../progressStore'
import { useDelayedFlag, useResource } from '../../useResource'
import { useDocumentTitle } from '../../useDocumentTitle'
import NotFoundPage from '../NotFoundPage'
import { bossMapHref } from './bossNav'
import { loadBossPageData, peekBossPageData } from './bossPageData'
import { BossPageView } from './BossPageView'

/**
 * /bosses/:id — boss page (PRD P5-S2/S3; UX_SPEC §3.7). Pages exist for the bosses in
 * src/schemas/bossPages.ts (every registry boss); any other id gets the styled 404 with a link to
 * that node on the map when it is one (events and milestones: its focus card has the details). Loading → skeleton after 300 ms;
 * a failed chunk → ErrorState with Retry (shell alive). The header's control tracks this boss's defeat
 * (P5-S4) in the shared progress store, so the page's gate badges and next steps follow it live.
 */
const HEADING_ID = 'boss-page-title'

export default function BossPage() {
  const { id = '' } = useParams()
  const resource = useResource(`boss-page:${id}`, () => loadBossPageData(id), () => peekBossPageData(id))
  const showSkeleton = useDelayedFlag(resource.status === 'loading')
  const worldEvil = useProgressStore((s) => s.progress.worldEvil)
  const nodeStates = useProgressStore((s) => s.progress.nodeStates)
  const boss = resource.status === 'ready' ? resource.data.boss : undefined
  const notFound = resource.status === 'error' && resource.error instanceof NotFoundError

  useDocumentTitle(boss ? boss.name : notFound ? 'Boss page not found' : 'Boss')

  if (notFound) {
    return (
      <NotFoundPage
        title="No page for this boss"
        message={
          <>
            There&rsquo;s no boss page at{' '}
            <code className="bg-night-950 px-1.5 py-0.5 font-mono text-sm break-all text-fg">{id}</code>. Every boss has a
            page; events and milestones are on the progression map with their details.
          </>
        }
        action={{ to: bossMapHref(/^[a-z0-9-]+$/.test(id) ? id : undefined), label: 'Open the boss map' }}
      />
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6 md:px-6 md:py-8">
      <Link
        to={bossMapHref(boss?.nodeId ?? undefined)}
        className="inline-flex min-h-tap items-center gap-2 font-semibold text-link underline decoration-1 underline-offset-4 hover:text-accent-strong"
      >
        <ArrowLeft aria-hidden="true" className="size-5" />
        Boss map
      </Link>
      {resource.status === 'ready' ? (
        <BossPageView data={resource.data} worldEvil={worldEvil} nodeStates={nodeStates} headingId={HEADING_ID} />
      ) : resource.status === 'error' ? (
        <ErrorState title="Couldn’t load this boss page" error={resource.error} onRetry={resource.retry} />
      ) : showSkeleton ? (
        <SkeletonPanel label="Loading boss page…" lines={8} />
      ) : (
        <div className="min-h-[60dvh]" aria-hidden="true" />
      )}
    </div>
  )
}
