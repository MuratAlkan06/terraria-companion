import { Ellipsis, X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router'
import { cx } from '../../components/cx'
import { isNavCurrent, tabBarLayout } from '../nav'

/**
 * Mobile bottom tab bar (UX_SPEC §2): <= 5 items incl. "More", icon + label,
 * hidden from `lg` up. Entirely data-driven from the route registry; "More"
 * renders only when there is something to put in it.
 */
const TAB_CLASSES =
  'relative flex min-h-tap flex-1 flex-col items-center justify-center gap-1 px-2 text-xs font-semibold transition-colors duration-(--dur-ui) before:absolute before:inset-x-4 before:top-0 before:h-0.5'

export function BottomTabBar() {
  const { tabs, more } = tabBarLayout()
  const { pathname } = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)
  const openedAtPath = useRef<string | null>(null)
  // A sub-path counts (a guide page is in Guides), like the tabs' NavLinks.
  const moreActive = more.some((item) => isNavCurrent(item.to, pathname))

  // Close the sheet whenever navigation happens (including back/forward):
  // adjust state during render when the route changes (no effect needed).
  const [renderedPath, setRenderedPath] = useState(pathname)
  if (renderedPath !== pathname) {
    setRenderedPath(pathname)
    setMoreOpen(false)
  }

  const onOpenChange = (open: boolean) => {
    if (open) openedAtPath.current = window.location.pathname
    setMoreOpen(open)
  }
  // If the sheet closed because the route changed, keep focus where the shell put
  // it (<main>, UX_SPEC §9) instead of returning it to the "More" trigger.
  const onCloseAutoFocus = (event: Event) => {
    if (openedAtPath.current !== window.location.pathname) event.preventDefault()
  }

  return (
    <nav
      aria-label="Primary"
      // Popovers treat this as a collision edge (see components/fixedBottomInset.ts).
      data-fixed-bottom=""
      className="fixed inset-x-0 bottom-0 z-(--z-nav) border-t-2 border-panel-border bg-surface pb-safe lg:hidden"
    >
      <ul className="mx-auto flex h-tabbar max-w-xl items-stretch">
        {tabs.map((item) => (
          <li key={item.id} className="flex flex-1">
            <NavLink
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cx(TAB_CLASSES, isActive ? 'text-accent before:bg-accent' : 'text-fg-muted hover:text-fg')
              }
            >
              <item.icon aria-hidden="true" className="size-5" />
              {item.label}
            </NavLink>
          </li>
        ))}

        {more.length > 0 ? (
          <li className="flex flex-1">
            <Dialog.Root open={moreOpen} onOpenChange={onOpenChange}>
              <Dialog.Trigger
                // The current page is one of its sections: say so, as the tabs' NavLinks do (B82).
                aria-current={moreActive ? 'true' : undefined}
                className={cx(
                  TAB_CLASSES,
                  moreActive || moreOpen ? 'text-accent before:bg-accent' : 'text-fg-muted hover:text-fg',
                )}
              >
                <Ellipsis aria-hidden="true" className="size-5" />
                More
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-(--z-sheet) bg-night-950/75 data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
                <Dialog.Content
                  onCloseAutoFocus={onCloseAutoFocus}
                  className={cx(
                    'fixed inset-x-0 bottom-0 z-(--z-sheet) max-h-[80dvh] overflow-y-auto border-t-2 border-panel-border bg-surface pb-safe text-fg shadow-pixel',
                    'data-[state=closed]:animate-sheet-out data-[state=open]:animate-sheet-in',
                  )}
                >
                  <div className="mx-auto max-w-xl px-4 pt-3 pb-4">
                    <div className="flex items-center justify-between gap-3">
                      <Dialog.Title className="font-display text-base text-accent">More</Dialog.Title>
                      <Dialog.Close
                        aria-label="Close menu"
                        className="grid min-h-tap min-w-tap place-items-center border-2 border-panel-border bg-panel text-fg hover:bg-night-700"
                      >
                        <X aria-hidden="true" className="size-5" />
                      </Dialog.Close>
                    </div>
                    <Dialog.Description className="sr-only">Other sections of Terraria Companion</Dialog.Description>
                    <ul className="mt-3 space-y-2">
                      {more.map((item) => {
                        const current = isNavCurrent(item.to, pathname)
                        return (
                          <li key={item.id}>
                            <Link
                              to={item.to}
                              aria-current={current ? 'page' : undefined}
                              onClick={() => setMoreOpen(false)}
                              className={cx(
                                'flex min-h-tap items-center gap-3 border-2 px-3 py-2 shadow-pixel transition-colors duration-(--dur-ui)',
                                current ? 'border-gold-600 bg-night-700' : 'border-panel-border bg-panel hover:bg-night-700',
                              )}
                            >
                              <item.icon aria-hidden="true" className={cx('size-5 shrink-0', current ? 'text-accent' : 'text-fg-muted')} />
                              <span className="flex flex-col">
                                <span className="font-semibold">{item.label}</span>
                                {item.description ? <span className="text-xs text-fg-muted">{item.description}</span> : null}
                              </span>
                            </Link>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          </li>
        ) : null}
      </ul>
    </nav>
  )
}
