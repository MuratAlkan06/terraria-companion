import { Tooltip } from 'radix-ui'
import { Suspense, useEffect, useRef } from 'react'
import { Outlet, ScrollRestoration, useLocation } from 'react-router'
import { PixelLoader } from '../../components/PixelLoader'
import { BottomTabBar } from './BottomTabBar'
import { scrollRestorationKey } from './scrollRestorationKey'
import { SiteFooter } from './SiteFooter'
import { SiteHeader } from './SiteHeader'

/**
 * App shell (UX_SPEC §2): header, routed content, footer, mobile bottom tab bar.
 * On route change, focus moves to <main> (UX_SPEC §9). Below `lg` the footer
 * reserves space for the fixed tab bar so it never covers content.
 */
export default function AppShell() {
  const { pathname } = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const isFirstRender = useRef(true)

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
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
        <SiteHeader />
        <main id="main" ref={mainRef} tabIndex={-1} className="flex-1 focus:outline-none">
          <Suspense fallback={<PixelLoader label="Loading page…" />}>
            <Outlet />
          </Suspense>
        </main>
        <SiteFooter />
        <BottomTabBar />
      </div>
      <ScrollRestoration getKey={scrollRestorationKey} />
    </Tooltip.Provider>
  )
}
