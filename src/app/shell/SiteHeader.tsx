import { ChevronDown } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import { useRef } from 'react'
import { Link, matchPath, NavLink, useLocation } from 'react-router'
import { LogoMark } from '../../components/art/LogoMark'
import { cx } from '../../components/cx'
import { OmniSearch } from '../../components/OmniSearch'
import { StageSelectorCompact } from '../../components/StageSelectorCompact'
import { headerNavLayout, type NavItem } from '../nav'
import { APP_ROUTES, type AppRoute } from '../routes'
import { SITE } from '../site'

/**
 * Header (UX_SPEC §2). Left: logo mark + wordmark. Centre: OmniSearch (P2-S4; inline from lg, a
 * full-width overlay trigger below). Right: data-driven primary nav (lg up; the bottom tab bar
 * covers smaller screens), StageSelectorCompact far right.
 *
 * Desktop width budget (AMENDMENTS-007 B29): the first HEADER_INLINE_MAX links sit inline and
 * the rest collapse into a "More" menu; the search never shrinks below 240px. The wordmark shows
 * from md, steps aside at lg–xl (1024–1439px, where inline search + nav + stage chip need the
 * room; the logo mark and the accessible name stay) and returns from xl.
 */
export interface SiteHeaderProps {
  /** Route registry the nav is derived from (default: the app's; tests pass a fake config). */
  routes?: readonly AppRoute[]
}

const NAV_ITEM =
  'relative flex min-h-tap items-center px-3 text-sm font-semibold transition-colors duration-(--dur-ui) after:absolute after:inset-x-3 after:bottom-0 after:h-0.5'

const navItemClass = (active: boolean) => cx(NAV_ITEM, active ? 'text-accent after:bg-accent' : 'text-fg-muted hover:text-fg')

/** Same matching as NavLink: "/" only exactly, other links also for their sub-paths. */
const isCurrent = (item: NavItem, pathname: string) => matchPath({ path: item.to, end: item.to === '/' }, pathname) !== null

export function SiteHeader({ routes = APP_ROUTES }: SiteHeaderProps) {
  const { inline, more } = headerNavLayout(routes)

  return (
    // Fully opaque so scrolled content never ghosts through the sticky bar (design review N4).
    <header className="sticky top-0 z-(--z-nav) border-b-2 border-panel-border bg-surface shadow-pixel-drop">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-3 md:px-6">
        <Link to="/" className="flex min-h-tap min-w-tap shrink-0 items-center gap-3 pr-1">
          <LogoMark className="size-9" />
          <span className="sr-only font-display text-base text-accent text-shadow-pixel md:not-sr-only lg:sr-only xl:not-sr-only">
            {SITE.name}
          </span>
        </Link>

        <OmniSearch />

        {inline.length > 0 ? (
          <nav aria-label="Primary" className="hidden shrink-0 lg:block">
            <ul className="flex items-center gap-1">
              {inline.map((item) => (
                <li key={item.id}>
                  <NavLink to={item.to} end={item.to === '/'} className={({ isActive }) => navItemClass(isActive)}>
                    {item.label}
                  </NavLink>
                </li>
              ))}
              {more.length > 0 ? (
                <li>
                  <HeaderMoreMenu items={more} />
                </li>
              ) : null}
            </ul>
          </nav>
        ) : null}

        <div className="shrink-0">
          <StageSelectorCompact />
        </div>
      </div>
    </header>
  )
}

/**
 * Desktop counterpart of the mobile "More" sheet (B29): a Radix dropdown of the overflow links.
 * The trigger carries the active underline while one of its links is the current page.
 */
function HeaderMoreMenu({ items }: { items: readonly NavItem[] }) {
  const { pathname } = useLocation()
  const openedAtPath = useRef<string | null>(null)
  const active = items.some((item) => isCurrent(item, pathname))

  return (
    <DropdownMenu.Root
      onOpenChange={(open) => {
        if (open) openedAtPath.current = window.location.pathname
      }}
    >
      <DropdownMenu.Trigger className={cx(navItemClass(active), 'group gap-1 data-[state=open]:text-fg')}>
        More
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 transition-transform duration-(--dur-ui) group-data-[state=open]:rotate-180"
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          collisionPadding={8}
          // A link was chosen: focus belongs to <main> (UX_SPEC §9), which the shell focuses.
          onCloseAutoFocus={(event) => {
            if (openedAtPath.current !== window.location.pathname) event.preventDefault()
          }}
          className="z-(--z-popover) min-w-56 border-2 border-panel-border bg-surface p-1 text-fg shadow-pixel-drop"
        >
          {items.map((item) => {
            const current = isCurrent(item, pathname)
            return (
              <DropdownMenu.Item key={item.id} asChild>
                <Link
                  to={item.to}
                  aria-current={current ? 'page' : undefined}
                  className={cx(
                    'flex min-h-tap items-center gap-3 px-3 text-sm outline-none select-none',
                    'data-highlighted:bg-night-700 data-highlighted:outline-2 data-highlighted:-outline-offset-2 data-highlighted:outline-ring data-highlighted:outline-solid',
                    current ? 'font-semibold text-accent' : 'text-fg',
                  )}
                >
                  <item.icon aria-hidden="true" className={cx('size-4 shrink-0', current ? 'text-accent' : 'text-fg-muted')} />
                  {item.label}
                </Link>
              </DropdownMenu.Item>
            )
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
