import { RotateCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { ChunkLoadError } from '../data-access/errors'
import { buttonClass } from './buttonStyles'
import { cx } from './cx'
import { PixelPanel } from './PixelPanel'

/**
 * Designed loading / empty / error states (UX_SPEC §3.1, §5): never blank.
 * - SkeletonList / SkeletonPanel reserve the space of the content they stand in for (CLS < 0.1);
 *   callers show them only after 300ms (useDelayedFlag).
 * - EmptyState: art + message + actions.
 * - ErrorState: cause + Retry; the shell stays alive.
 */

const SHIMMER = 'bg-night-700 motion-safe:animate-pixel-march'

/** `rows` placeholder rows sized like EntityCard rows. */
export function SkeletonList({ rows = 8, label = 'Loading…' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <ul aria-hidden="true" className="space-y-2">
        {Array.from({ length: rows }, (_, index) => (
          <li key={index} className="flex min-h-[5.5rem] items-center gap-3 border-2 border-panel-border bg-panel px-3 py-2 lg:min-h-16">
            <span className={cx('size-slot shrink-0', SHIMMER)} style={{ animationDelay: `${(index % 4) * 0.15}s` }} />
            <span className="flex flex-1 flex-col gap-2">
              <span className={cx('h-4 w-2/5', SHIMMER)} />
              <span className={cx('h-3 w-3/5', SHIMMER)} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Panel-shaped placeholder: a header block plus `lines` text bars. */
export function SkeletonPanel({ lines = 4, label = 'Loading…', className }: { lines?: number; label?: string; className?: string }) {
  return (
    <PixelPanel role="status" aria-live="polite" className={cx('space-y-3', className)}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="flex items-center gap-4">
        <span className={cx('size-20 shrink-0', SHIMMER)} />
        <span className={cx('h-6 w-1/2', SHIMMER)} />
      </div>
      <div aria-hidden="true" className="space-y-2">
        {Array.from({ length: lines }, (_, index) => (
          <span key={index} className={cx('block h-4', index % 2 ? 'w-2/3' : 'w-5/6', SHIMMER)} />
        ))}
      </div>
    </PixelPanel>
  )
}

export interface EmptyStateProps {
  art?: ReactNode
  title: string
  children?: ReactNode
  actions?: ReactNode
  titleId?: string
}

export function EmptyState({ art, title, children, actions, titleId }: EmptyStateProps) {
  return (
    <PixelPanel as="section" aria-labelledby={titleId} className="flex flex-col items-center gap-4 text-center">
      {art ? <div aria-hidden="true">{art}</div> : null}
      <h2 id={titleId} className="font-display text-sm leading-relaxed text-accent text-shadow-pixel md:text-base">
        {title}
      </h2>
      {children ? <div className="max-w-prose space-y-2 text-fg-muted">{children}</div> : null}
      {actions ? <div className="flex flex-wrap justify-center gap-3">{actions}</div> : null}
    </PixelPanel>
  )
}

/** Human cause for a data/route error. */
function describeDataError(error: unknown): string {
  if (error instanceof ChunkLoadError) {
    return 'Part of the site’s data failed to download. Check your connection, then retry.'
  }
  if (error instanceof Error) return error.message
  return 'An unexpected error occurred.'
}

export interface ErrorStateProps {
  title?: string
  error: unknown
  onRetry: () => void
  /**
   * Retry replaces this panel (and its focused button) with the loading state, so focus moves
   * to a stable element first: the element with this id (e.g. the section heading, which needs
   * tabIndex={-1}), else the page's <main>. Never left on <body>.
   */
  retryFocusId?: string
  className?: string
}

/** A failed module chunk can't be re-imported in this document (module map caches it): reload. */
function retryNeedsReload(error: unknown): boolean {
  return error instanceof ChunkLoadError && error.moduleImport
}

export function ErrorState({ title = 'Couldn’t load this data', error, onRetry, retryFocusId, className }: ErrorStateProps) {
  const retry = () => {
    if (retryNeedsReload(error)) {
      window.location.reload()
      return
    }
    const target = (retryFocusId ? document.getElementById(retryFocusId) : null) ?? document.querySelector('main')
    onRetry()
    target?.focus({ preventScroll: true })
  }
  return (
    <PixelPanel role="alert" tone="earth" className={cx('space-y-3', className)}>
      <p className="font-display text-sm leading-relaxed text-accent text-shadow-pixel">{title}</p>
      <p className="text-fg-muted">{describeDataError(error)}</p>
      <button type="button" onClick={retry} className={buttonClass('primary')}>
        <RotateCw aria-hidden="true" className="size-5" />
        Retry
      </button>
    </PixelPanel>
  )
}
