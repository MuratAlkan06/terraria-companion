import { Tooltip } from 'radix-ui'
import { Suspense, useEffect, useRef } from 'react'
import { Outlet, ScrollRestoration, useLocation } from 'react-router'
import { FavoritesSaveNotice } from '../../components/FavoriteStar'
import { PixelLoader } from '../../components/PixelLoader'
import { pathFor } from '../routes'
import { useDelayedFlag } from '../useResource'
import { BottomTabBar } from './BottomTabBar'
import { useNavigationPending } from './navigationPending'
import { scrollRestorationKey } from './scrollRestorationKey'
import { useShellChrome } from './shellChrome'
import { SiteFooter } from './SiteFooter'
import { SiteHeader } from './SiteHeader'

/**
 * App shell (UX_SPEC §2): header, routed content, footer, mobile bottom tab bar.
 * On route change, focus moves to <main> (UX_SPEC §9). Below `lg` the footer
 * reserves space for the fixed tab bar so it never covers content.
 *
 * Loading (UX_SPEC §5.1, design review P2-S3 #6): the first load of a lazy route shows the
 * PixelLoader only after 300ms (no flash for fast loads); a slow client-side navigation keeps
 * the previous page up (router transition) and shows a pending bar along the top edge.
 */
const PENDING_BAR_DELAY_MS = 150

export default function AppShell() {
  const { pathname } = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  // Path focus was last settled for. Comparing paths (instead of a "first run"
  // flag) keeps the initial load unfocused even when StrictMode re-runs the
  // effect on mount, and focuses exactly once per real navigation.
  const settledPath = useRef(pathname)
  const navigationPending = useNavigationPending()
  const pending = useDelayedFlag(navigationPending, PENDING_BAR_DELAY_MS)
  // Lab fullscreen (UX_SPEC §2): the page takes the whole viewport, no shell chrome.
  const immersive = useShellChrome((s) => s.immersive)

  useEffect(() => {
    if (settledPath.current === pathname) return
    settledPath.current = pathname
    mainRef.current?.focus({ preventScroll: true })
  }, [pathname])

  return (
    <Tooltip.Provider delayDuration={200} skipDelayDuration={300}>
      <div className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only z-(--z-toast) bg-accent font-semibold text-fg-on-accent focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:px-4 focus:py-3 focus-visible:outline-fg-on-accent focus-visible:outline-offset-[calc(var(--pixel)*-2)]"
        >
          Skip to content
        </a>
        {immersive ? null : <SiteHeader />}
        <RoutePendingBar active={pending} />
        <main id="main" ref={mainRef} tabIndex={-1} aria-busy={pending || undefined} className="flex-1 focus:outline-none">
          <Suspense fallback={<RouteFallback />}>
            <Outlet />
          </Suspense>
        </main>
        {immersive ? null : (
          <>
            <SiteFooter />
            <BottomTabBar />
            {/* One notice when favorites stop saving (the pressed star can't explain it in place);
                /favorites says so inline, in place, so it shows none of its own there. */}
            {pathname === pathFor('favorites') ? null : <FavoritesSaveNotice />}
          </>
        )}
      </div>
      <ScrollRestoration getKey={scrollRestorationKey} />
    </Tooltip.Provider>
  )
}

/** Lazy-route fallback: reserved space first, the PixelLoader only once loading passes 300ms. */
function RouteFallback() {
  const show = useDelayedFlag(true)
  return show ? <PixelLoader label="Loading page…" /> : <div className="min-h-[50dvh]" aria-hidden="true" />
}

/**
 * Top-edge pending bar for slow client-side navigations. The live region stays mounted so the
 * "Loading page…" text is announced when it appears.
 */
function RoutePendingBar({ active }: { active: boolean }) {
  return (
    <>
      <p role="status" className="sr-only">
        {active ? 'Loading page…' : ''}
      </p>
      {active ? (
        <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-(--z-nav) h-1 overflow-hidden bg-night-700">
          <div className="h-full w-full bg-accent motion-safe:w-1/3 motion-safe:animate-route-progress" />
        </div>
      ) : null}
    </>
  )
}
