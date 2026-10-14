import { ArrowDown, ArrowLeft, ArrowRight } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { CuratedLabel } from '../../../components/CuratedLabel'
import { cx } from '../../../components/cx'
import { ErrorState, SkeletonPanel } from '../../../components/States'
import { useDelayedFlag, useResource, type ResourceState } from '../../useResource'
import { useDocumentTitle } from '../../useDocumentTitle'
import NotFoundPage from '../NotFoundPage'
import { guideBySlug, guidePosition } from './content'
import { progressLabel, useGuideProgress } from './checklistStore'
import { CHECKLIST_ID, GuideChecklist, StageBand } from './GuideChecklist'
import { GuideContent } from './GuideContent'
import { loadGuideData, peekGuideData, type GuideData } from './guideData'
import { guideHref, type Guide } from './guideModel'

/**
 * /guides/:slug (PRD P6-S8; UX_SPEC §3.10). Header and checklist render at once (no data needed);
 * the prose waits for the link data (SearchDocs + sprite manifest) so every item name resolves to
 * a real page: SkeletonPanel after 300ms, ErrorState + Retry on failure, styled 404 for an unknown
 * slug. From lg the checklist sits in a sticky rail beside the prose; below lg it follows the prose,
 * with a jump link and live progress in the header.
 */
export const GUIDE_TITLE_ID = 'guide-title'

export default function GuidePage() {
  const { slug = '' } = useParams()
  const guide = guideBySlug(slug)
  useDocumentTitle(guide ? guide.title : 'Guide not found')

  if (!guide) {
    return (
      <NotFoundPage
        title="Guide not found"
        message={
          <>
            There’s no guide called{' '}
            <code className="bg-night-950 px-1.5 py-0.5 font-mono text-sm break-all text-fg">{slug}</code>. It may have been
            mistyped — the guides list has every topic.
          </>
        }
        action={{ to: '/guides', label: 'All guides' }}
      />
    )
  }
  return <GuideView key={guide.slug} guide={guide} />
}

function GuideView({ guide }: { guide: Guide }) {
  const resource = useResource('guide-data', loadGuideData, peekGuideData)
  const { path, index } = guidePosition(guide)
  const progress = useGuideProgress(guide)
  const prev = path.guides[index - 2]
  const next = path.guides[index]

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6 md:py-8">
      <Link
        to="/guides"
        className="inline-flex min-h-tap items-center gap-2 font-semibold text-link underline decoration-1 underline-offset-4 hover:text-accent-strong"
      >
        <ArrowLeft aria-hidden="true" className="size-5" />
        All guides
      </Link>

      <header className="mt-2 max-w-3xl space-y-3">
        <p className="text-xs font-semibold tracking-wide text-fg-muted uppercase">
          {path.title} · Guide {index} of {path.guides.length} · {guide.topic}
        </p>
        <h1
          id={GUIDE_TITLE_ID}
          tabIndex={-1}
          className="font-display text-base leading-relaxed text-accent text-shadow-pixel focus:outline-none md:text-2xl"
        >
          {guide.title}
        </h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <StageBand stages={guide.stages} />
          <span className="text-fg-muted">
            Guide text is <CuratedLabel />; facts link to their sources.
          </span>
        </div>
        <a
          href={`#${CHECKLIST_ID}`}
          className="inline-flex min-h-tap items-center gap-2 text-sm font-semibold text-link underline decoration-1 underline-offset-4 hover:text-accent-strong lg:hidden"
        >
          <ArrowDown aria-hidden="true" className="size-4" />
          Checklist: {progressLabel(progress).toLowerCase()}
        </a>
      </header>

      <div className="mt-6 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-10 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <article aria-labelledby={GUIDE_TITLE_ID} className="max-w-3xl min-w-0">
          <GuideArticle guide={guide} resource={resource} />
        </article>
        <GuideChecklist
          guide={guide}
          className="mt-10 lg:sticky lg:top-24 lg:mt-0 lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto"
        />
      </div>

      <nav aria-label="More guides" className="mt-10 grid gap-3 border-t-2 border-panel-border pt-6 md:grid-cols-2">
        {prev ? <NeighborLink guide={prev} direction="prev" /> : null}
        {next ? (
          <NeighborLink guide={next} direction="next" />
        ) : (
          <Link
            to="/guides"
            className="flex min-h-tap items-center justify-end gap-2 border-2 border-panel-border bg-panel px-4 py-3 font-semibold shadow-pixel transition-colors duration-(--dur-ui) hover:border-gold-600 md:col-start-2"
          >
            All guides
            <ArrowRight aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />
          </Link>
        )}
      </nav>
    </div>
  )
}

/** The data-dependent part: loading / error / ready (UX_SPEC §5.1, §5.4). Exported for tests. */
export function GuideArticle({ guide, resource }: { guide: Guide; resource: ResourceState<GuideData> & { retry: () => void } }) {
  const showSkeleton = useDelayedFlag(resource.status === 'loading')
  if (resource.status === 'ready') return <GuideContent guide={guide} data={resource.data} />
  if (resource.status === 'error') {
    return (
      <ErrorState
        title="Couldn’t load this guide’s item links"
        error={resource.error}
        onRetry={resource.retry}
        retryFocusId={GUIDE_TITLE_ID}
      />
    )
  }
  return showSkeleton ? <SkeletonPanel label="Loading guide…" lines={8} /> : <div className="min-h-[50dvh]" aria-hidden="true" />
}

function NeighborLink({ guide, direction }: { guide: Guide; direction: 'prev' | 'next' }) {
  const isNext = direction === 'next'
  return (
    <Link
      to={guideHref(guide.slug)}
      className={cx(
        'flex min-h-tap items-center gap-3 border-2 border-panel-border bg-panel px-4 py-3 shadow-pixel transition-colors duration-(--dur-ui) hover:border-gold-600',
        isNext && 'justify-end text-right md:col-start-2',
      )}
    >
      {isNext ? null : <ArrowLeft aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />}
      <span className="min-w-0">
        <span className="block text-xs font-semibold tracking-wide text-fg-muted uppercase">{isNext ? 'Next guide' : 'Previous guide'}</span>
        <span className="block font-semibold">{guide.title}</span>
      </span>
      {isNext ? <ArrowRight aria-hidden="true" className="size-5 shrink-0 text-fg-muted" /> : null}
    </Link>
  )
}
