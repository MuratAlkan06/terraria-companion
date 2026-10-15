import { Check, ChevronRight } from 'lucide-react'
import { Link } from 'react-router'
import { cx } from '../../../components/cx'
import { useDocumentTitle } from '../../useDocumentTitle'
import { GUIDE_PATHS } from './content'
import { progressLabel, useGuideProgress } from './checklistStore'
import { ProgressBar, StageBand } from './GuideChecklist'
import { guideHref, type Guide } from './guideModel'

/**
 * /guides (PRD P6-S8; UX_SPEC §3.10, §7): index cards — step number, topic, title, one-line
 * summary, stage band, and the reader's checklist progress from tc.v1.checklists. Static content,
 * so no loading state beyond the route chunk's; tiles are 2 / 3 / 4 columns (UX_SPEC §7), stacking
 * below 375px (AMENDMENTS-009 B43).
 */
const TITLE_ID = 'guides-title'

export default function GuidesIndexPage() {
  useDocumentTitle('Guides')
  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 md:space-y-8 md:px-6 md:py-8">
      <header className="space-y-2">
        <h1
          id={TITLE_ID}
          tabIndex={-1}
          className="font-display text-base leading-relaxed text-accent text-shadow-pixel focus:outline-none md:text-2xl"
        >
          Guides
        </h1>
        <p className="max-w-prose text-fg-muted">
          Short, practical guides with checklists that remember your progress in this browser. Item names link into the
          database, and every fact links its source.
        </p>
      </header>

      {GUIDE_PATHS.map((path) => (
        <section key={path.id} aria-labelledby={`path-${path.id}`} className="space-y-3">
          <div className="space-y-1">
            <h2 id={`path-${path.id}`} className="font-display text-sm leading-relaxed text-accent text-shadow-pixel md:text-base">
              {path.title}
            </h2>
            <p className="text-sm text-fg-muted">{path.description}</p>
          </div>
          <ol className="grid grid-cols-1 gap-3 xs:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {path.guides.map((guide, index) => (
              <li key={guide.slug}>
                <GuideCard guide={guide} step={index + 1} />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}

function GuideCard({ guide, step }: { guide: Guide; step: number }) {
  const progress = useGuideProgress(guide)
  const complete = progress.done === progress.total
  return (
    <Link
      to={guideHref(guide.slug)}
      className="group flex h-full flex-col gap-2.5 border-2 border-panel-border bg-panel p-3 text-fg shadow-pixel transition-colors duration-(--dur-ui) ease-out-strong hover:border-gold-600 md:p-4"
    >
      <span className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="grid size-8 shrink-0 place-items-center border-2 border-gold-600 bg-night-900 font-display text-sm text-accent"
        >
          {step}
        </span>
        <span className="min-w-0 text-xs font-semibold tracking-wide text-fg-muted uppercase">
          <span className="sr-only">Step {step}: </span>
          {guide.topic}
        </span>
        {/* Decorative; on phones the tile is too narrow to spare its width from the topic. */}
        <ChevronRight
          aria-hidden="true"
          className="ml-auto hidden size-5 shrink-0 text-fg-muted transition-colors duration-(--dur-ui) group-hover:text-accent md:block"
        />
      </span>
      <span className="leading-snug font-semibold group-hover:text-accent-strong">{guide.title}</span>
      <span className="text-sm text-fg-muted">{guide.summary}</span>
      <span className="mt-auto flex flex-col gap-2 pt-1">
        <StageBand stages={guide.stages} short className="self-start" />
        <span className={cx('inline-flex items-center gap-1.5 text-xs font-semibold tabular-nums', complete ? 'text-success' : 'text-fg-muted')}>
          {complete ? <Check aria-hidden="true" className="size-3.5" strokeWidth={3} /> : null}
          <span className="sr-only">Checklist: </span>
          {progressLabel(progress)}
        </span>
        <ProgressBar {...progress} />
      </span>
    </Link>
  )
}
