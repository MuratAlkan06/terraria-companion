import { House } from 'lucide-react'
import { Link, useLocation } from 'react-router'
import { CaveVignette } from '../../components/art/CaveVignette'
import { buttonClass } from '../../components/buttonStyles'
import { PixelPanel } from '../../components/PixelPanel'
import { useDocumentTitle } from '../useDocumentTitle'

/** Styled 404 (UX_SPEC §1 "lost in the caverns"; PRD P1-S1 AC3). Eager and tiny. */
export default function NotFoundPage() {
  useDocumentTitle('Page not found')
  const { pathname } = useLocation()

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:py-10">
      <PixelPanel as="section" aria-labelledby="nf-title" className="space-y-5">
        <div className="border-2 border-night-950 bg-surface-sunken">
          <CaveVignette className="block h-auto w-full" />
        </div>
        <div className="space-y-3">
          <p className="font-display text-sm text-fg-muted">Error 404</p>
          <h1 id="nf-title" className="font-display text-base leading-relaxed text-accent text-shadow-pixel md:text-2xl">
            Lost in the caverns
          </h1>
          <p className="text-fg-muted">
            There&rsquo;s no page at{' '}
            <code className="bg-night-950 px-1.5 py-0.5 font-mono text-sm break-all text-fg">{pathname}</code>. This
            tunnel doesn&rsquo;t lead anywhere — head back up to the surface.
          </p>
        </div>
        <Link to="/" className={buttonClass('primary')}>
          <House aria-hidden="true" className="size-5" />
          Back to home
        </Link>
      </PixelPanel>
    </div>
  )
}
