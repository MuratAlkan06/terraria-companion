import { BookOpenText, CircleHelp, HeartHandshake, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { cx } from '../../components/cx'
import { NoBreak } from '../../components/NoBreak'
import { PixelPanel } from '../../components/PixelPanel'
import { StageSelector } from '../../components/StageSelector'
import { meta } from '../../data/meta'
import { pathFor } from '../routes'
import { useSelectedStage, useSettingsStore } from '../settingsStore'
import { SITE } from '../site'
import { useDocumentTitle } from '../useDocumentTitle'
import { HomeHero } from './home/HomeHero'

/**
 * Homepage v1 (PRD P1-S2; UX_SPEC §3.2): pixel-art hero with the site identity,
 * the full stage selector, and a short "what this is" row. Primary actions,
 * OmniSearch and the featured/recent/saved rails arrive with their target
 * features (P2–P5); until then they are absent, never disabled placeholders.
 */
export default function HomePage() {
  useDocumentTitle()

  return (
    <>
      <HomeHero />
      <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 md:space-y-8 md:px-6 md:py-10">
        <StageSection />
        <AboutSection />
      </div>
    </>
  )
}

function StageSection() {
  const stage = useSelectedStage()
  const persistError = useSettingsStore((s) => s.persistError)

  return (
    <PixelPanel as="section" aria-labelledby="stage-title">
      <h2 id="stage-title" className="font-display text-base leading-relaxed text-accent text-shadow-pixel">
        Your game stage
      </h2>
      <p id="stage-help" className="mt-2 max-w-prose text-sm text-fg-muted">
        Where are you in your playthrough? Your pick is saved on this device and shared with the stage menu at the top
        of the page.
      </p>
      <StageSelector labelledBy="stage-title" describedBy="stage-help" className="mt-4" />
      <p aria-live="polite" className={cx('mt-3 text-xs', persistError ? 'text-negative' : 'text-fg-muted')}>
        {persistError
          ? "Couldn't save on this device — kept for this visit only."
          : stage
            ? 'Saved on this device.'
            : 'No stage picked yet.'}
      </p>
    </PixelPanel>
  )
}

interface Point {
  icon: LucideIcon
  title: string
  body: ReactNode
}

const POINTS: readonly Point[] = [
  {
    icon: BookOpenText,
    title: 'Built on wiki data',
    body: (
      <>
        Sourced from the Official Terraria Wiki and pinned to Terraria {meta.gameVersion} ({SITE.platformLabel}).
      </>
    ),
  },
  {
    icon: CircleHelp,
    title: 'Unknown, never guessed',
    body: <>If a value can&rsquo;t be verified, it&rsquo;s shown as Unknown — never estimated or invented.</>,
  },
  {
    icon: HeartHandshake,
    title: 'Free and unofficial',
    body: (
      <>
        A non-commercial fan project with no ads, not affiliated with <NoBreak>Re-Logic</NoBreak> or the wiki.
      </>
    ),
  },
]

function AboutSection() {
  return (
    <PixelPanel as="section" tone="stone" aria-labelledby="about-title">
      <h2 id="about-title" className="font-display text-base leading-relaxed text-accent text-shadow-pixel">
        What this is
      </h2>
      <ul className="mt-4 grid gap-5 md:grid-cols-3 md:gap-6">
        {POINTS.map(({ icon: Icon, title, body }) => (
          <li key={title} className="flex gap-3">
            <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-accent" />
            <div className="min-w-0">
              <p className="font-semibold text-fg">{title}</p>
              <p className="mt-1 text-sm text-fg-muted">{body}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-5 flex flex-col gap-1 border-t-2 border-stone-700 pt-4 md:flex-row md:items-center md:justify-between md:gap-6">
        <p className="text-sm text-fg-muted">
          New sections appear in the navigation as each one is finished — nothing here is a mock-up.
        </p>
        <Link
          to={pathFor('licensing')}
          className="inline-flex min-h-tap shrink-0 items-center font-semibold text-link underline decoration-1 underline-offset-4 hover:text-accent-strong"
        >
          Licensing &amp; attribution
        </Link>
      </div>
    </PixelPanel>
  )
}
