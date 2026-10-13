import { RotateCw } from 'lucide-react'
import { isRouteErrorResponse, Link, useRouteError } from 'react-router'
import { buttonClass } from '../../components/buttonStyles'
import { PixelPanel } from '../../components/PixelPanel'
import { useDocumentTitle } from '../useDocumentTitle'

/**
 * Route-level ErrorState (UX_SPEC §5.4): cause + Retry, shell intact when used as
 * the pathless child boundary. Covers lazy-chunk load failures after a redeploy.
 */
function describe(error: unknown): string {
  if (isRouteErrorResponse(error)) return `${error.status} ${error.statusText}`.trim()
  if (error instanceof Error) {
    if (/dynamically imported module|Importing a module script failed|Failed to fetch/i.test(error.message)) {
      return 'Part of the site failed to download. Check your connection, then retry.'
    }
    return error.message
  }
  return 'An unexpected error occurred.'
}

export default function RouteErrorPage() {
  useDocumentTitle('Something went wrong')
  const error = useRouteError()

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:py-10">
      <PixelPanel as="section" role="alert" aria-labelledby="err-title" tone="earth" className="space-y-4">
        <h1 id="err-title" className="font-display text-base leading-relaxed text-accent text-shadow-pixel md:text-2xl">
          Something went wrong
        </h1>
        <p className="text-fg-muted">{describe(error)}</p>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => window.location.reload()} className={buttonClass('primary')}>
            <RotateCw aria-hidden="true" className="size-5" />
            Retry
          </button>
          <Link to="/" reloadDocument className={buttonClass('secondary')}>
            Back to home
          </Link>
        </div>
      </PixelPanel>
    </div>
  )
}
